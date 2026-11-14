import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, createWriteStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// ---------------------------------------------------------------------------
// Minimal zero-dependency ISO/IEC 18004 QR Code SVG generator (Byte mode, ECC-L, v1..10)
// ---------------------------------------------------------------------------
const QR_CAP_L = [0, 17, 32, 53, 78, 106, 134, 154, 192, 230, 271];
const QR_EC_CODEWORDS_L = [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18];
const QR_BLOCKS_L = [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4];
const QR_ALIGN: number[][] = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(deg: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < deg; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    for (let j = 0; j < ecLen; j++) {
      rem[j] ^= gfMul(gen[j + 1], factor);
    }
  }
  return rem;
}

export function generateQrSvg(text: string): string {
  const bytes = Buffer.from(text, "utf-8");
  let ver = 1;
  while (ver <= 10 && QR_CAP_L[ver] < bytes.length) ver++;
  if (ver > 10) return "";

  const size = ver * 4 + 17;
  const totalModules = (() => {
    let n = size * size - 3 * 64 - 2 * (size - 16) - 31;
    const al = QR_ALIGN[ver];
    if (al.length > 0) {
      const count = al.length * al.length - 3;
      n -= count * 25;
      if (al.length > 2) n += (al.length - 2) * 10;
    }
    if (ver >= 7) n -= 36;
    return n;
  })();
  const totalCodewords = totalModules >> 3;
  const ecPerBlock = QR_EC_CODEWORDS_L[ver];
  const numBlocks = QR_BLOCKS_L[ver];
  const dataCodewords = totalCodewords - ecPerBlock * numBlocks;

  // Build bit stream
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  pushBits(0b0100, 4); // Byte mode
  pushBits(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) pushBits(b, 8);
  for (let i = 0; i < 4 && bits.length < dataCodewords * 8; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataBytes = new Uint8Array(dataCodewords);
  for (let i = 0; i < bits.length >> 3; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
    dataBytes[i] = b;
  }
  let padIdx = bits.length >> 3;
  let padToggle = 0;
  while (padIdx < dataCodewords) {
    dataBytes[padIdx++] = padToggle ? 0x11 : 0xec;
    padToggle ^= 1;
  }

  // Split into blocks & compute Reed-Solomon EC
  const shortBlockLen = Math.floor(dataCodewords / numBlocks);
  const numLongBlocks = dataCodewords % numBlocks;
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let b = 0; b < numBlocks; b++) {
    const len = shortBlockLen + (b >= numBlocks - numLongBlocks ? 1 : 0);
    const blk = dataBytes.subarray(offset, offset + len);
    offset += len;
    dataBlocks.push(blk);
    ecBlocks.push(rsEncode(blk, ecPerBlock));
  }

  const finalBytes: number[] = [];
  const maxDataLen = shortBlockLen + (numLongBlocks > 0 ? 1 : 0);
  for (let i = 0; i < maxDataLen; i++) {
    for (let b = 0; b < numBlocks; b++) {
      if (i < dataBlocks[b].length) finalBytes.push(dataBlocks[b][i]);
    }
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (let b = 0; b < numBlocks; b++) {
      finalBytes.push(ecBlocks[b][i]);
    }
  }

  const grid = Array.from({ length: size }, () => new Int8Array(size));
  const reserved = Array.from({ length: size }, () => new Uint8Array(size));

  const setFunc = (r: number, c: number, val: number) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      grid[r][c] = val ? 1 : 0;
      reserved[r][c] = 1;
    }
  };

  const placeFinder = (row: number, col: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const isBorder = dr === -1 || dr === 7 || dc === -1 || dc === 7;
        const isOuter = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const isInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunc(row + dr, col + dc, !isBorder && (isOuter || isInner) ? 1 : 0);
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    setFunc(6, i, i % 2 === 0 ? 1 : 0);
    setFunc(i, 6, i % 2 === 0 ? 1 : 0);
  }

  const al = QR_ALIGN[ver];
  for (let i = 0; i < al.length; i++) {
    for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
      const cr = al[i];
      const cc = al[j];
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const v = Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0;
          setFunc(cr + dr, cc + dc, v);
        }
      }
    }
  }

  // Reserve format info & dark module
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      reserved[8][i] = 1;
      reserved[i][8] = 1;
    }
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = 1;
    reserved[size - 1 - i][8] = 1;
  }
  setFunc(size - 8, 8, 1);

  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
    const verBits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = (verBits >> i) & 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunc(b, a, bit);
      setFunc(a, b, bit);
    }
  }

  // Place data bits in upward/downward 2-column zig-zag
  let bitIdx = 0;
  const totalBits = finalBytes.length * 8;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!reserved[r][c]) {
          let bit = 0;
          if (bitIdx < totalBits) {
            bit = (finalBytes[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
            bitIdx++;
          }
          // Mask pattern 0: (r + c) % 2 === 0
          if ((r + c) % 2 === 0) bit ^= 1;
          grid[r][c] = bit;
        }
      }
    }
    upward = !upward;
  }

  // Format information for ECC-L (01) and Mask 0 (000) -> data = 0b01000
  let fmtRem = 0b01000;
  for (let i = 0; i < 10; i++) fmtRem = (fmtRem << 1) ^ ((fmtRem >> 9) * 0x537);
  const fmtBits = ((0b01000 << 10) | fmtRem) ^ 0x5412;
  for (let i = 0; i <= 5; i++) setFunc(8, i, (fmtBits >> i) & 1);
  setFunc(8, 7, (fmtBits >> 6) & 1);
  setFunc(8, 8, (fmtBits >> 7) & 1);
  setFunc(7, 8, (fmtBits >> 8) & 1);
  for (let i = 9; i < 15; i++) setFunc(14 - i, 8, (fmtBits >> i) & 1);
  for (let i = 0; i < 8; i++) setFunc(size - 1 - i, 8, (fmtBits >> i) & 1);
  for (let i = 8; i < 15; i++) setFunc(8, size - 15 + i, (fmtBits >> i) & 1);

  const margin = 3;
  const viewSize = size + margin * 2;
  let path = "";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c]) path += `M${c + margin},${r + margin}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" shape-rendering="crispEdges"><rect width="${viewSize}" height="${viewSize}" rx="2" fill="#ffffff"/><path d="${path}" fill="#09090b"/></svg>`;
}

// ---------------------------------------------------------------------------
// LAN & Remote Internet Tunnel Manager (Cloudflare Quick Tunnel + SSH fallback)
// ---------------------------------------------------------------------------
export interface ShareStatus {
  status: "running" | "starting" | "stopped" | "error";
  provider: "cloudflared" | "localhost.run" | null;
  public_url: string | null;
  public_base_url: string | null;
  lan_url: string;
  lan_base_url: string;
  lan_ips: string[];
  port: number;
  qr_svg: string;
  error: string | null;
}

export function detectLanIps(): string[] {
  const nets = networkInterfaces();
  const ips: string[] = [];
  for (const [name, list] of Object.entries(nets)) {
    if (!list) continue;
    if (/^(docker|br-|veth|virbr|lo)/i.test(name)) continue;
    for (const info of list) {
      if (info.family === "IPv4" && !info.internal && info.address) {
        ips.push(info.address);
      }
    }
  }
  // Prefer 192.168.x.x / 10.x.x.x / 172.16-31.x.x
  ips.sort((a, b) => {
    const score = (ip: string) => (ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : 2);
    return score(a) - score(b);
  });
  return [...new Set(ips)];
}

export class TunnelManager {
  private root: string;
  private outDir: string;
  private port: number;
  private proc: ChildProcess | null = null;
  private state: "running" | "starting" | "stopped" | "error" = "stopped";
  private provider: "cloudflared" | "localhost.run" | null = null;
  private publicBaseUrl: string | null = null;
  private lastError: string | null = null;
  private autoRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private manualStop = false;

  constructor(root: string, outDir: string, port: number) {
    this.root = root;
    this.outDir = outDir;
    this.port = port;
  }

  getStatus(): ShareStatus {
    const ips = detectLanIps();
    const primaryIp = ips[0] || "127.0.0.1";
    const lanBase = `http://${primaryIp}:${this.port}`;
    const lanUrl = `${lanBase}/wonderfull`;
    const pubUrl = this.publicBaseUrl ? `${this.publicBaseUrl}/wonderfull` : null;
    const qrTarget = pubUrl || lanUrl;
    return {
      status: this.state,
      provider: this.provider,
      public_url: pubUrl,
      public_base_url: this.publicBaseUrl,
      lan_url: lanUrl,
      lan_base_url: lanBase,
      lan_ips: ips,
      port: this.port,
      qr_svg: generateQrSvg(qrTarget),
      error: this.lastError,
    };
  }

  private binPath(): string {
    const isWin = process.platform === "win32";
    return join(this.outDir, "bin", isWin ? "cloudflared.exe" : "cloudflared");
  }

  private async ensureCloudflaredBinary(): Promise<string> {
    const localBin = this.binPath();
    if (existsSync(localBin)) return localBin;

    mkdirSync(join(this.outDir, "bin"), { recursive: true });
    const isWin = process.platform === "win32";
    const isArm = process.arch === "arm64";
    let asset = "cloudflared-linux-amd64";
    if (isWin) {
      asset = "cloudflared-windows-amd64.exe";
    } else if (process.platform === "darwin") {
      asset = isArm ? "cloudflared-darwin-arm64.tgz" : "cloudflared-darwin-amd64.tgz";
    } else if (isArm) {
      asset = "cloudflared-linux-arm64";
    }

    const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`;
    const resp = await fetch(url, { redirect: "follow" });
    if (!resp.ok || !resp.body) {
      throw new Error(`Impossibile scaricare cloudflared (${resp.status})`);
    }
    const tmpPath = `${localBin}.tmp`;
    await pipeline(Readable.fromWeb(resp.body as any), createWriteStream(tmpPath));
    if (!isWin) chmodSync(tmpPath, 0o755);
    const { renameSync } = await import("node:fs");
    renameSync(tmpPath, localBin);
    return localBin;
  }

  async start(): Promise<ShareStatus> {
    if (this.state === "running" || this.state === "starting") {
      return this.getStatus();
    }
    this.manualStop = false;
    if (this.autoRestartTimer) {
      clearTimeout(this.autoRestartTimer);
      this.autoRestartTimer = null;
    }
    this.state = "starting";
    this.lastError = null;
    this.publicBaseUrl = null;

    try {
      const bin = await this.ensureCloudflaredBinary();
      await this.spawnCloudflared(bin);
    } catch (err) {
      try {
        await this.spawnLocalhostRun();
      } catch (err2) {
        this.state = "error";
        this.lastError = (err as Error).message || (err2 as Error).message;
      }
    }
    return this.getStatus();
  }

  private spawnCloudflared(bin: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("Timeout avvio tunnel Cloudflare"));
        }
      }, 25000);

      const proc = spawn(bin, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${this.port}`], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.proc = proc;
      this.provider = "cloudflared";

      const onOutput = (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(text);
        if (m && !this.publicBaseUrl) {
          this.publicBaseUrl = m[0];
          this.state = "running";
          this.lastError = null;
          this.saveUrlFile();
          console.log(`📱 Wonderfull Mobile (Remoto 4G/5G): ${this.publicBaseUrl}/wonderfull`);
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve();
          }
        }
      };

      proc.stdout?.on("data", onOutput);
      proc.stderr?.on("data", onOutput);

      proc.on("error", (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });

      proc.on("close", () => {
        if (this.proc === proc) {
          this.proc = null;
          this.publicBaseUrl = null;
          if (!this.manualStop) {
            this.state = "stopped";
            this.autoRestartTimer = setTimeout(() => {
              if (!this.manualStop) void this.start();
            }, 5000);
          }
        }
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error("Processo cloudflared terminato prima di generare l'URL"));
        }
      });
    });
  }

  private spawnLocalhostRun(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("Timeout avvio tunnel SSH localhost.run"));
        }
      }, 20000);

      const proc = spawn(
        "ssh",
        [
          "-o", "StrictHostKeyChecking=no",
          "-o", "UserKnownHostsFile=/dev/null",
          "-o", "ServerAliveInterval=30",
          "-R", `80:127.0.0.1:${this.port}`,
          "nokey@localhost.run",
        ],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
      this.proc = proc;
      this.provider = "localhost.run";

      const onOutput = (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        const m = /https:\/\/[a-z0-9-]+\.lhr\.life/i.exec(text);
        if (m && !this.publicBaseUrl) {
          this.publicBaseUrl = m[0];
          this.state = "running";
          this.lastError = null;
          this.saveUrlFile();
          console.log(`📱 Wonderfull Mobile (Remoto 4G/5G): ${this.publicBaseUrl}/wonderfull`);
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve();
          }
        }
      };

      proc.stdout?.on("data", onOutput);
      proc.stderr?.on("data", onOutput);

      proc.on("error", (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });

      proc.on("close", () => {
        if (this.proc === proc) {
          this.proc = null;
          this.publicBaseUrl = null;
          if (!this.manualStop) {
            this.state = "stopped";
          }
        }
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error("Tunnel SSH terminato"));
        }
      });
    });
  }

  private saveUrlFile() {
    try {
      mkdirSync(this.outDir, { recursive: true });
      const status = this.getStatus();
      const lines = [
        `WONDERFULL_REMOTE_URL=${status.public_url || ""}`,
        `WONDERFULL_LAN_URL=${status.lan_url}`,
      ];
      writeFileSync(join(this.outDir, "wonderfull-url.txt"), lines.join("\n") + "\n", "utf-8");
    } catch {
      // ignore
    }
  }

  stop(): ShareStatus {
    this.manualStop = true;
    if (this.autoRestartTimer) {
      clearTimeout(this.autoRestartTimer);
      this.autoRestartTimer = null;
    }
    if (this.proc) {
      try {
        this.proc.kill("SIGTERM");
      } catch {}
      this.proc = null;
    }
    this.publicBaseUrl = null;
    this.provider = null;
    this.state = "stopped";
    return this.getStatus();
  }

  async restart(): Promise<ShareStatus> {
    this.stop();
    return this.start();
  }
}
