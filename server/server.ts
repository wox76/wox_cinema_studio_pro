// Minimal HTTP API for the web UI. Node's built-in http plus the Fetch API types; no framework.
//   GET    /api/apps                         catalog (what the UI needs to draw cards and forms)
//   GET    /api/apps/:id/workflow            the app's ComfyUI workflow in API format, as a download (open it in ComfyUI)
//   POST   /api/apps/:id/run                 multipart form: one field per input id, optional "preset"
//                                            → 202 with the history entry; the run continues in the background
//   GET    /api/history[?app=id]             every run started here, newest first (out/history/)
//   GET    /api/history/:id                  one run, with live progress while it is going
//   GET    /api/history/:id/files/:file      its inputs and outputs (byte ranges)
//   GET    /api/history/:id/preview          the latest live preview frame, when the backend sends them
//   POST   /api/history/:id/cancel           ask the backend to stop it
//   DELETE /api/history/:id                  forget it (and its files)
//   GET    /api/gpu[?device=1]               is the backend warm? (never wakes it; device=1 adds VRAM in use, only when warm)
//   POST   /api/gpu/wake                     start the GPU container now, while you prepare inputs
//   GET    /api/jobs/:id[/outputs/:oid]      raw SDK job view (kept for scripts)
//   GET    /api/flags                        lab examples marked "mediocre" from the UI (lab/flags.json)
//   POST   /api/flags                        JSON { key, mediocre, note? }: mark or unmark one example
// Everything else is served from web/ when it exists (with byte ranges, so videos seek everywhere).
// Hosted (server/guard.ts): WOX_PASSCODE (or FREEFIELD_PASSCODE) closes every route behind a passcode, WOX_MAX_RUNS_PER_DAY and
// WOX_MAX_ACTIVE cap the runs (429 past them), lab marks become read-only and uploads are capped at
// WOX_MAX_UPLOAD_MB. WOX_OUT moves out/ (history, the run count), WOX_HOST the listening address.
// web/examples/ holds one example per app, written by lab/publish.py; /api/apps carries it along.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, readFileSync, statSync, openSync, readSync, closeSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extname, join, normalize } from "node:path";
import { homedir, tmpdir } from "node:os";
import { loadRegistry, repoRoot, isFileInput, type App } from "./registry.ts";
import { explainSubmitError, InputError, resolveValues, Runner, type Values } from "./runner.ts";
import { History } from "./history.ts";
import { Flags } from "./flags.ts";
import { DOOR_HTML, Guard } from "./guard.ts";
import { thermalGuard } from "./thermal.ts";
import { InstallerManager, type ModelDef } from "./installer.ts";
import { TunnelManager } from "./tunnel.ts";

const execFileAsync = promisify(execFile);

async function runFaceTool(args: string[]): Promise<string> {
  const pyBin = installer.detectPython();
  const script = join(root, "server", "face_tools.py");
  const { stdout } = await execFileAsync(pyBin, [script, ...args], { maxBuffer: 25 * 1024 * 1024, timeout: 60000 });
  return stdout;
}

function parseBoxParam(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(s)) {
    throw new InputError("invalid box parameter");
  }
  return s;
}

const root = repoRoot();
const installer = new InstallerManager(root);
let { apps, problems } = loadRegistry(root);
for (const p of problems.filter((x) => x.severity === "error")) console.error(`[registry] ${p.app}: ${p.message}`);
let byId = new Map(apps.map((a) => [a.id, a]));

function refreshRegistry() {
  const reg = loadRegistry(root);
  apps = reg.apps;
  byId = new Map(apps.map((a) => [a.id, a]));
}

// VRAM verdicts from tools/catalog.py (optional: the UI just shows less without it)
type VramRow = { id: string; whole_gb: number; largest_phase_gb: number; verdict_24gb: string; measured_peak_gb: number | null };
const vramFile = join(root, "docs", "vram-map.json");
function findComfyLog(): string | null {
  const custom = process.env.COMFYUI_LOG_PATH;
  if (custom && existsSync(custom)) return custom;
  const termLog = join(root, "out", "terminal.log");
  if (existsSync(termLog) && statSync(termLog).size > 0) return termLog;
  const candidates = [
    join(installer.detectComfyDir(), "user"),
    join(homedir(), "opt", "ComfyUI", "user"),
    join(homedir(), "ComfyUI", "user"),
    join(root, "..", "ComfyUI", "user"),
    "/home/wox76/opt/ComfyUI/user",
    join(root, "out"),
  ];
  for (const dir of candidates) {
    if (!dir || !existsSync(dir)) continue;
    try {
      const files = readdirSync(dir)
        .filter((f) => f.startsWith("comfyui") && f.endsWith(".log") && !f.includes("prev"))
        .map((f) => ({ path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      if (files.length > 0) return files[0].path;
    } catch {}
  }
  return null;
}

const vram = new Map<string, VramRow>(
  existsSync(vramFile) ? (JSON.parse(readFileSync(vramFile, "utf-8")).apps as VramRow[]).map((r) => [r.id, r]) : [],
);
let runner: Runner | null = null;
const getRunner = () => (runner ??= new Runner());
const isDraftsAllowed = () => process.env.WOX_DRAFTS === "1" || process.env.FREEFIELD_DRAFTS === "1";
const outDir = process.env.WOX_OUT || process.env.FREEFIELD_OUT || join(root, "out");
const port = Number(process.env.PORT ?? 3000);
const tunnel = new TunnelManager(root, outDir, port);
const guard = Guard.fromEnv(join(outDir, "limits.json"));
const maxUploadMb = Number(process.env.WOX_MAX_UPLOAD_MB || process.env.FREEFIELD_MAX_UPLOAD_MB || (guard.hosted ? 100 : 0));

// the backend scales to zero 10 minutes after its last request (infra/modal_app.py scaledown_window).
// lastContact only moves on real work (a run, a wake): status checks must not keep the GPU alive.
const WARM_MS = 9 * 60 * 1000;
let lastContact = 0;
let waking: { since: number; error?: string } | null = null;
const contact = () => { lastContact = Date.now(); };
const history = new History(join(outDir, "history"), {
  onContact: contact,
  appInfo: (id) => {
    const app = apps.find((a) => a.id === id);
    if (!app) return undefined;
    const graph = app.graph ?? {};
    return { outputs: app.outputs.map((o) => o.node), nodes: Object.keys(graph).length, classOf: (n) => graph[n]?.class_type ?? null };
  },
  frames: (jobId, signal) => getRunner().frames(jobId, signal),
  transformOutput: async ({ entry, folder, bytes, index }) => {
    if (entry.app !== "wonderfull" || index !== 1) return;
    const wfMetaPath = join(folder, "wonderfull.json");
    if (!existsSync(wfMetaPath)) return;
    const baseInput = entry.inputs.find((i) => i.id === "image") ?? entry.inputs[0];
    if (!baseInput) return;
    const basePath = join(folder, baseInput.file);
    if (!existsSync(basePath)) return;
    const wfMeta = JSON.parse(readFileSync(wfMetaPath, "utf-8")) as {
      box: string;
      faceBox?: string;
      mode?: "face" | "head";
      keepGlasses?: boolean;
    };
    const tmpDir = mkdtempSync(join(tmpdir(), "wox-wf-out-"));
    try {
      const patchPath = join(tmpDir, "patch.png");
      const outPath = join(tmpDir, "composite.png");
      writeFileSync(patchPath, bytes);
      const modelsDir = installer.detectModelsDir();
      const insightRoot = join(modelsDir, "insightface");
      const args = [
        "composite", "--base", basePath, "--patch", patchPath, "--box", wfMeta.box,
        "--mode", wfMeta.mode === "head" ? "head" : "face",
        "--models-dir", modelsDir, "--insightface-root", insightRoot, "--out", outPath,
      ];
      if (wfMeta.faceBox) args.push("--face-box", wfMeta.faceBox);
      if (wfMeta.keepGlasses === false) args.push("--no-keep-glasses");
      await runFaceTool(args);
      return new Uint8Array(readFileSync(outPath));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  },
});
const flags = new Flags(join(root, "lab", "flags.json"), apps);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2", ".woff": "font/woff",
  ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
  ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".fbx": "application/octet-stream", ".bin": "application/octet-stream",
  ".wasm": "application/wasm", ".tflite": "application/octet-stream", ".task": "application/octet-stream",
};

function withAssetVersion(relPath: unknown): unknown {
  if (typeof relPath !== "string" || !relPath) return relPath;
  const clean = relPath.split(/[?#]/)[0];
  const diskPath = join(root, "web", ...clean.replace(/^\/+/, "").split("/"));
  try {
    const st = statSync(diskPath);
    if (st.isFile()) return `${clean}?v=${Math.floor(st.mtimeMs)}`;
  } catch { /* missing asset */ }
  return relPath;
}

// one example per app (lab/publish.py); read on every catalog request so a new publish shows up without a restart
const examplesFile = join(root, "web", "examples", "index.json");
function loadExamples(): Record<string, unknown> {
  try {
    if (!existsSync(examplesFile)) return {};
    const appsMap = (JSON.parse(readFileSync(examplesFile, "utf-8")).apps ?? {}) as Record<string, Record<string, unknown>>;
    const out: Record<string, unknown> = {};
    for (const [id, raw] of Object.entries(appsMap)) {
      if (!raw || typeof raw !== "object") { out[id] = raw; continue; }
      const item: Record<string, unknown> = {
        ...raw,
        card: withAssetVersion(raw.card),
        poster: withAssetVersion(raw.poster),
        full: withAssetVersion(raw.full),
        glb: withAssetVersion(raw.glb),
      };
      if (Array.isArray(raw.inputs)) {
        item.inputs = raw.inputs.map((inp) => (
          inp && typeof inp === "object"
            ? { ...(inp as Record<string, unknown>), src: withAssetVersion((inp as Record<string, unknown>).src), full: withAssetVersion((inp as Record<string, unknown>).full) }
            : inp
        ));
      }
      if (raw.options && typeof raw.options === "object") {
        const opts: Record<string, Record<string, unknown>> = {};
        for (const [k, group] of Object.entries(raw.options as Record<string, Record<string, unknown>>)) {
          if (!group || typeof group !== "object") continue;
          const mappedGroup: Record<string, unknown> = {};
          for (const [optVal, shot] of Object.entries(group)) {
            mappedGroup[optVal] = shot && typeof shot === "object"
              ? { ...(shot as Record<string, unknown>), card: withAssetVersion((shot as Record<string, unknown>).card), poster: withAssetVersion((shot as Record<string, unknown>).poster) }
              : shot;
          }
          opts[k] = mappedGroup;
        }
        item.options = opts;
      }
      out[id] = item;
    }
    return out;
  } catch {
    return {};
  }
}

const runnable = (a: App) => Boolean(a.workflowPath) && (a.status === "ready" || isDraftsAllowed());

function publicApp(a: App) {
  return {
    id: a.id, name: a.name, section: a.section, summary: a.summary ?? "", status: a.status, pack: a.pack,
    runnable: runnable(a),
    higgsfield_feature: a.higgsfield_feature ?? null,
    modes: a.modes ?? null,
    mode_label: a.mode_label ?? null,
    inputs: a.inputs.map(({ bind: _bind, options, ...rest }) => ({
      ...rest, ...(options ? { options: options.map(({ sets: _sets, ...o }) => o) } : {}),
    })),
    presets: (a.presets ?? []).map((p) => ({ id: p.id, label: p.label })),
    outputs: a.outputs.map((o) => ({ type: o.type, label: o.label ?? null })),
    models: a.models.map((m) => ({
      name: m.file.split("/").pop(), repo: m.repo, gb: m.gb, license: m.license ?? null,
      gated: Boolean(m.gated), optional: Boolean(m.optional), phase: m.phase,
    })),
    vram: vram.has(a.id) ? {
      whole_gb: vram.get(a.id)!.whole_gb, largest_phase_gb: vram.get(a.id)!.largest_phase_gb,
      verdict: vram.get(a.id)!.verdict_24gb, measured_gb: vram.get(a.id)!.measured_peak_gb,
    } : null,
    credits: a.credits ?? [],
    notes: a.notes ?? null,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/** A file from disk, honouring Range so <video> can seek. */
function sendFile(req: IncomingMessage, res: ServerResponse, file: string, cache = "no-store, no-cache, must-revalidate") {
  const size = statSync(file).size;
  const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { "content-range": `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { "content-type": type, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${size}`,
      "accept-ranges": "bytes", "cache-control": cache });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes", "cache-control": cache });
  if (req.method === "HEAD") return res.end();
  return createReadStream(file).pipe(res);
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).byteLength;
    if (maxUploadMb && size > maxUploadMb * 2 ** 20) throw new InputError(`uploads are limited to ${maxUploadMb} MB here`);
    chunks.push(c as Buffer);
  }
  return new Request(`http://local${req.url}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
}

interface WonderfullCrop {
  box: string;
  faceBox?: string;
  mode: "face" | "head";
  keepGlasses: boolean;
}

async function readValues(app: App, request: Request): Promise<{ values: Values; preset?: string; wfCrop?: WonderfullCrop }> {
  const form = await request.formData();
  const values: Values = {};
  for (const input of app.inputs) {
    const v = form.get(input.id);
    if (v === null) continue;
    if (isFileInput(input)) {
      if (typeof v === "string") {
        if (!v && input.required === false) continue;
        throw new InputError(`${input.id}: expected a file upload`);
      }
      if (v.size === 0 && input.required === false) continue;
      values[input.id] = { bytes: new Uint8Array(await v.arrayBuffer()), name: v.name, type: v.type };
    } else {
      values[input.id] = v;
    }
  }
  // Collect dynamic references (e.g. ref1, ref2, ref3, ...)
  for (const [key, v] of form.entries()) {
    if (/^ref\d+$/.test(key) && !values[key]) {
      if (typeof v === "object" && v && "arrayBuffer" in v) {
        const file = v as File;
        if (file.size > 0) {
          values[key] = { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name, type: file.type };
        }
      }
    }
  }
  let wfCrop: WonderfullCrop | undefined;
  if (app.id === "wonderfull") {
    const rawBox = form.get("wf_crop_box");
    if (typeof rawBox === "string" && rawBox.trim()) {
      const box = parseBoxParam(rawBox);
      const rawFaceBox = form.get("wf_face_box");
      const faceBox = typeof rawFaceBox === "string" && rawFaceBox.trim() ? parseBoxParam(rawFaceBox) : undefined;
      const mode = form.get("wf_mode") === "head" ? "head" : "face";
      const keepGlasses = form.get("wf_keep_glasses") !== "0";
      wfCrop = { box, faceBox, mode, keepGlasses };
    }
  }
  const preset = form.get("preset");
  return { values, preset: typeof preset === "string" && preset ? preset : undefined, wfCrop };
}

async function jobView(id: string) {
  const job = await getRunner().jobs().get(id);
  return {
    id: job.id,
    status: job.status,
    error: job.error ?? null,
    outputs: job.outputs.map((o) => ({ id: o.id, node: o.nodeId, name: o.name, type: o.type, url: `/api/jobs/${job.id}/outputs/${o.id}` })),
  };
}

/** Submit in the background; the entry tells the UI how it goes. */
function startRun(app: App, values: Values, preset?: string, wfCrop?: WonderfullCrop) {
  const entry = history.start(app, values, preset);
  if (wfCrop) {
    writeFileSync(join(outDir, "history", entry.id, "wonderfull.json"), JSON.stringify(wfCrop));
  }
  void (async () => {
    try {
      let submitValues = values;
      const img = values.image;
      if (wfCrop && typeof img === "object" && img !== null && "bytes" in img && img.bytes instanceof Uint8Array) {
        const tmpDir = mkdtempSync(join(tmpdir(), "wox-wf-crop-"));
        try {
          const inPath = join(tmpDir, "base.png");
          const outPath = join(tmpDir, "crop.png");
          writeFileSync(inPath, img.bytes);
          await runFaceTool(["crop", "--image", inPath, "--box", wfCrop.box, "--out", outPath]);
          submitValues = {
            ...values,
            image: { bytes: new Uint8Array(readFileSync(outPath)), name: "face_crop.png", type: "image/png" },
          };
        } finally {
          rmSync(tmpDir, { recursive: true, force: true });
        }
      }
      const job = await getRunner().submit(app, submitValues, preset);
      contact();
      await history.follow(entry, job);
    } catch (e) {
      const explained = explainSubmitError(app, e);
      const message = explained ?? (e as Error).message ?? String(e);
      console.error(`[${app.id}] ${message}`);
      history.fail(entry, message);
    }
  })();
  return history.view(entry);
}

const DONE = ["succeeded", "failed", "canceled", "expired", "lost"];
const activeRuns = () => history.list(undefined, 50).filter((e) => !DONE.includes(e.status)).length;

let gpuCache: { at: number; body: unknown } | null = null;
async function gpuStatus(withDevice = false) {
  const configured = Boolean(process.env.COMFY_BASE_URL);
  const host = configured ? (guard.hosted ? "Modal" : new URL(process.env.COMFY_BASE_URL!).host) : null;
  const warm = Date.now() - lastContact < WARM_MS;
  const running = activeRuns();
  const safe = thermalGuard.status();
  const base = { configured, host, warm, last_contact: lastContact ? new Date(lastContact).toISOString() : null,
    waking: waking ? { seconds: Math.round((Date.now() - waking.since) / 1000), error: waking.error ?? null } : null,
    running, demo: guard.hosted ? guard.status(running) : null, safe };
  // only on request and only while warm: looking never starts a GPU, and the background poll never touches it
  if (!withDevice || !warm || !configured) return { ...base, device: null };
  if (gpuCache && Date.now() - gpuCache.at < 5000) return { ...base, device: gpuCache.body };
  let device: unknown = null;
  try {
    const r = getRunner();
    let res = await fetch(`${r.baseUrl}/wox/status`, {
      headers: r.token ? { authorization: `Bearer ${r.token}` } : {}, signal: AbortSignal.timeout(4000),
    });
    if (res.status === 404) {
      res = await fetch(`${r.baseUrl}/freefield/status`, {
        headers: r.token ? { authorization: `Bearer ${r.token}` } : {}, signal: AbortSignal.timeout(4000),
      });
    }
    if (res.ok) {
      const s = (await res.json()) as { app?: string; comfyui?: { devices?: { name?: string; vram_total?: number; vram_free?: number }[] } };
      const d = s.comfyui?.devices?.[0];
      device = { app: s.app ?? null, name: d?.name ?? null,
        vram_total_gb: d?.vram_total ? +(d.vram_total / 2 ** 30).toFixed(1) : null,
        vram_used_gb: d?.vram_total && d.vram_free !== undefined ? +((d.vram_total - d.vram_free) / 2 ** 30).toFixed(1) : null };
    }
  } catch { /* status is best effort */ }
  gpuCache = { at: Date.now(), body: device };
  return { ...base, device };
}

function wake() {
  if (waking && !waking.error) return;
  const r = getRunner();   // throws without COMFY_BASE_URL: the caller answers 400
  waking = { since: Date.now() };
  const started = waking;
  fetch(`${r.baseUrl}/health`, { signal: AbortSignal.timeout(15 * 60 * 1000) })
    .then((res) => {
      if (!res.ok) throw new Error(`/health answered ${res.status}`);
      contact();
      if (waking === started) waking = null;
    })
    .catch((e) => { if (waking === started) waking = { ...started, error: (e as Error).message }; });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://local");
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (guard.passcode) {
      const key = url.searchParams.get("key");
      const cookie = key !== null ? guard.login(key) : null;
      if (cookie) {   // the passcode leaves the address bar and lives on as a cookie
        url.searchParams.delete("key");
        res.writeHead(303, { "set-cookie": cookie, location: url.pathname + url.search, "cache-control": "no-store" });
        return res.end();
      }
      if (!guard.admits(req.headers.cookie)) {
        if (parts[0] === "api") return send(res, 401, { error: "this demo needs its passcode: open the link you were given" });
        res.writeHead(401, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        return res.end(DOOR_HTML);
      }
    }
    if (parts[0] === "api") {
      const [, area, id, sub, arg] = parts;
      if (req.method === "GET" && area === "apps" && parts.length === 2) {
        refreshRegistry();
        const order = { image: 0, video: 1, audio: 2, utility: 3 } as Record<string, number>;
        const sorted = [...apps].sort((a, b) => order[a.section] - order[b.section]
          || Number(b.status === "ready") - Number(a.status === "ready") || a.name.localeCompare(b.name));
        const examples = loadExamples();
        return send(res, 200, { apps: sorted.map((a) => ({ ...publicApp(a), example: examples[a.id] ?? null })), drafts: isDraftsAllowed(),
          hosted: guard.hosted });
      }
      if (req.method === "GET" && area === "apps" && sub === "workflow") {
        // the app's ComfyUI workflow (API format) as a file: drag it onto ComfyUI's canvas to open the app as nodes
        const app = byId.get(id);
        if (!app?.workflowPath) return send(res, 404, { error: "no workflow" });
        const body = readFileSync(app.workflowPath);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-length": body.byteLength, "cache-control": "no-cache",
          "content-disposition": `attachment; filename="wox-${app.id}.json"` });
        return res.end(body);
      }
      if (req.method === "POST" && area === "apps" && sub === "run") {
        refreshRegistry();
        const app = byId.get(id);
        if (!app) return send(res, 404, { error: "unknown app" });
        if (!app.workflowPath) throw new InputError(`${app.id} has no workflow yet`);
        if (!runnable(app)) throw new InputError(`${app.id} is a draft; start the server with WOX_DRAFTS=1 to run it anyway`);
        const refused = guard.refuse(activeRuns());
        if (refused) return send(res, 429, { error: refused });
        const { values, preset, wfCrop } = await readValues(app, await toRequest(req));
        const view = startRun(app, resolveValues(app, values), preset, wfCrop);
        guard.record();
        return send(res, 202, view);
      }
      if (area === "history") {
        if (req.method === "POST" && id === "upload") {
          const reqObj = await toRequest(req);
          const form = await reqObj.formData();
          const file = form.get("file");
          if (!file || typeof file === "string") return send(res, 400, { error: "expected file" });
          const bytes = new Uint8Array(await file.arrayBuffer());
          const entry = history.addUpload(file.name, file.type, bytes);
          return send(res, 201, history.view(entry));
        }
        if (req.method === "GET" && !id) {
          const appFilter = url.searchParams.get("app") || undefined;
          const rawLimit = url.searchParams.get("limit");
          const rawOffset = url.searchParams.get("offset");
          const rawMedia = url.searchParams.get("media");
          if (rawLimit !== null || rawOffset !== null || rawMedia !== null) {
            const parsedLimit = rawLimit !== null ? Number.parseInt(rawLimit, 10) : 60;
            const limit = Number.isFinite(parsedLimit) ? Math.min(500, Math.max(1, parsedLimit)) : 60;
            const parsedOffset = rawOffset !== null ? Number.parseInt(rawOffset, 10) : 0;
            const offset = Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0;
            const media = rawMedia === "image" || rawMedia === "video" || rawMedia === "audio" ? rawMedia : undefined;
            return send(res, 200, history.page(appFilter, limit, offset, media));
          }
          return send(res, 200, { entries: history.list(appFilter) });
        }
        if (req.method === "GET" && id && !sub) {
          const e = history.get(id);
          return e ? send(res, 200, e) : send(res, 404, { error: "unknown run" });
        }
        if ((req.method === "GET" || req.method === "HEAD") && sub === "files" && arg) {
          const file = history.file(id, arg);
          return file ? sendFile(req, res, file, "private, max-age=31536000, immutable") : send(res, 404, { error: "not found" });
        }
        if (req.method === "GET" && sub === "preview") {
          const p = history.preview(id);
          if (!p) return send(res, 404, { error: "no preview" });
          res.writeHead(200, { "content-type": p.type, "content-length": p.bytes.byteLength, "cache-control": "no-store" });
          return res.end(p.bytes);
        }
        if (req.method === "POST" && sub === "cancel") return send(res, 200, { canceled: await history.cancel(id) });
        if (req.method === "DELETE" && id && !sub) return send(res, history.remove(id) ? 200 : 404, { removed: id });
      }
      if (area === "gpu") {
        if (req.method === "GET" && !id) return send(res, 200, await gpuStatus(url.searchParams.get("device") === "1"));
        if (req.method === "GET" && id === "safe") return send(res, 200, thermalGuard.status());
        if (req.method === "POST" && id === "safe") {
          const body = await (await toRequest(req)).json().catch(() => null) as { enabled?: boolean; threshold?: number } | null;
          return send(res, 200, thermalGuard.configure(body || {}));
        }
        if (req.method === "POST" && id === "wake") {
          try { wake(); } catch (e) { throw new InputError((e as Error).message); }
          return send(res, 202, await gpuStatus());
        }
      }
      if (area === "comfy") {
        if (req.method === "GET" && (!id || id === "shell" || id === "logs")) {
          const logPath = findComfyLog();
          let logs = "";
          if (logPath && existsSync(logPath)) {
            try {
              const stat = statSync(logPath);
              const maxBytes = 262144;
              const start = Math.max(0, stat.size - maxBytes);
              const fd = openSync(logPath, "r");
              const buf = Buffer.alloc(stat.size - start);
              readSync(fd, buf, 0, buf.length, start);
              closeSync(fd);
              logs = buf.toString("utf-8");
              if (start > 0) {
                const firstNewline = logs.indexOf("\n");
                if (firstNewline !== -1) logs = logs.slice(firstNewline + 1);
              }
            } catch (err) {
              logs = `[Error reading log file: ${(err as Error).message}]`;
            }
          } else {
            logs = "[ComfyUI log file not found or backend not yet started]";
          }

          const comfyUrl = process.env.COMFYUI_URL || "http://127.0.0.1:8188";
          let systemStats: any = null;
          let queueInfo: any = null;
          let connected = false;
          try {
            const [statsRes, queueRes] = await Promise.all([
              fetch(`${comfyUrl}/system_stats`, { signal: AbortSignal.timeout(1500) }),
              fetch(`${comfyUrl}/queue`, { signal: AbortSignal.timeout(1500) }),
            ]);
            if (statsRes.ok) {
              systemStats = await statsRes.json();
              connected = true;
            }
            if (queueRes.ok) {
              queueInfo = await queueRes.json();
            }
          } catch {
            // offline or starting
          }

          const activeEntry = history.list(undefined, 10).find((e) => !DONE.includes(e.status));
          const runningCount = activeRuns();

          return send(res, 200, {
            ok: true,
            connected,
            comfy_url: comfyUrl,
            logs,
            log_path: logPath,
            safe: thermalGuard.status(),
            queue: queueInfo || { queue_running: [], queue_pending: [] },
            system: systemStats?.system || null,
            devices: systemStats?.devices || null,
            active_job: activeEntry ? {
              id: activeEntry.id,
              app: activeEntry.app,
              status: activeEntry.status,
              started_at: activeEntry.started,
              progress: activeEntry.progress ?? null,
            } : null,
            running_count: runningCount,
          });
        }
        if (req.method === "POST" && id === "free") {
          const comfyUrl = process.env.COMFYUI_URL || "http://127.0.0.1:8188";
          try {
            const resp = await fetch(`${comfyUrl}/free`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ unload_models: true, free_memory: true }),
              signal: AbortSignal.timeout(3000),
            });
            return send(res, 200, { ok: resp.ok, status: resp.status });
          } catch (e) {
            return send(res, 500, { ok: false, error: (e as Error).message });
          }
        }
      }
      if (area === "installer") {
        if (req.method === "GET" && (!id || id === "status")) {
          return send(res, 200, { ...installer.getStatus(), safe: thermalGuard.status() });
        }
        if (req.method === "POST" && id === "run") {
          if (guard.hosted) return send(res, 403, { error: "installer is disabled on hosted demo" });
          const body = await (await toRequest(req)).json().catch(() => null) as {
            action?: "install_all_starter" | "install_all_everything" | "install_nodes" | "download_packs" | "download_model";
            nodes?: string[];
            packs?: string[];
            model?: ModelDef;
          } | null;
          if (!body || !body.action) throw new InputError("expected JSON { action }");
          const task = installer.startJob(body as any);
          return send(res, 202, { ok: true, task });
        }
        if (req.method === "POST" && id === "cancel") {
          return send(res, 200, { canceled: installer.cancelTask() });
        }
        if (req.method === "POST" && id === "settings") {
          if (guard.hosted) return send(res, 403, { error: "settings are read-only on hosted demo" });
          const body = await (await toRequest(req)).json().catch(() => null) as {
            comfy_dir?: string;
            models_dir?: string;
            hf_token?: string;
            drafts?: boolean;
            safe_enabled?: boolean;
            safe_threshold?: number;
          } | null;
          if (!body) throw new InputError("expected JSON settings");
          installer.updateSettings(body);
          if (typeof body.safe_enabled === "boolean" || typeof body.safe_threshold === "number") {
            thermalGuard.configure({ enabled: body.safe_enabled, threshold: body.safe_threshold });
          }
          return send(res, 200, { ok: true, ...installer.getStatus(), safe: thermalGuard.status() });
        }
      }
      if (area === "wonderfull" && id === "share") {
        if (req.method === "GET") {
          return send(res, 200, tunnel.getStatus());
        }
        if (req.method === "POST") {
          const body = await (await toRequest(req)).json().catch(() => null) as { action?: "start" | "restart" | "stop" } | null;
          const act = body?.action || "start";
          if (act === "stop") return send(res, 200, tunnel.stop());
          if (act === "restart") return send(res, 200, await tunnel.restart());
          return send(res, 200, await tunnel.start());
        }
      }
      if (area === "wonderfull" && req.method === "POST") {
        const form = await (await toRequest(req)).formData();
        const dir = mkdtempSync(join(tmpdir(), "wox-wf-"));
        try {
          if (id === "detect-faces") {
            const img = form.get("image");
            if (!(img instanceof File) || !img.size) throw new InputError("image file is required");
            const inPath = join(dir, "input.png");
            writeFileSync(inPath, Buffer.from(await img.arrayBuffer()));
            const modelsDir = installer.detectModelsDir();
            const insightRoot = join(modelsDir, "insightface");
            const raw = await runFaceTool(["detect", "--image", inPath, "--insightface-root", insightRoot]);
            return send(res, 200, JSON.parse(raw));
          }
          if (id === "crop-face") {
            const img = form.get("image");
            if (!(img instanceof File) || !img.size) throw new InputError("image file is required");
            const box = parseBoxParam(form.get("box"));
            const inPath = join(dir, "input.png");
            const outPath = join(dir, "crop.png");
            writeFileSync(inPath, Buffer.from(await img.arrayBuffer()));
            await runFaceTool(["crop", "--image", inPath, "--box", box, "--out", outPath]);
            const bytes = readFileSync(outPath);
            res.writeHead(200, { "content-type": "image/png", "content-length": bytes.byteLength });
            return res.end(bytes);
          }
          if (id === "composite-face") {
            const base = form.get("base");
            const patch = form.get("patch");
            if (!(base instanceof File) || !base.size || !(patch instanceof File) || !patch.size) {
              throw new InputError("base and patch files are required");
            }
            const box = parseBoxParam(form.get("box"));
            const faceBoxRaw = form.get("faceBox");
            const faceBox = typeof faceBoxRaw === "string" && faceBoxRaw.trim() ? parseBoxParam(faceBoxRaw) : "";
            const mode = form.get("mode") === "head" ? "head" : "face";
            const keepGlasses = form.get("keepGlasses") !== "0";
            const modelsDir = installer.detectModelsDir();
            const insightRoot = join(modelsDir, "insightface");
            const basePath = join(dir, "base.png");
            const patchPath = join(dir, "patch.png");
            const outPath = join(dir, "out.png");
            writeFileSync(basePath, Buffer.from(await base.arrayBuffer()));
            writeFileSync(patchPath, Buffer.from(await patch.arrayBuffer()));
            const args = [
              "composite", "--base", basePath, "--patch", patchPath, "--box", box,
              "--mode", mode, "--models-dir", modelsDir, "--insightface-root", insightRoot, "--out", outPath,
            ];
            if (faceBox) args.push("--face-box", faceBox);
            if (!keepGlasses) args.push("--no-keep-glasses");
            await runFaceTool(args);
            const bytes = readFileSync(outPath);
            res.writeHead(200, { "content-type": "image/png", "content-length": bytes.byteLength });
            return res.end(bytes);
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }
      if (area === "flags" && parts.length === 2) {
        if (req.method === "GET") return send(res, 200, { mediocre: flags.list() });
        if (req.method === "POST") {
          if (guard.hosted) return send(res, 403, { error: "lab marks are read-only on the hosted demo" });
          const body = await (await toRequest(req)).json().catch(() => null) as { key?: unknown; mediocre?: unknown; note?: unknown } | null;
          if (!body || typeof body.key !== "string" || typeof body.mediocre !== "boolean") throw new InputError("expected JSON { key, mediocre, note? }");
          try {
            return send(res, 200, { mediocre: flags.set(body.key, body.mediocre, typeof body.note === "string" ? body.note : undefined) });
          } catch (e) {
            throw new InputError((e as Error).message);
          }
        }
      }
      if (req.method === "GET" && area === "jobs" && parts.length === 3) {
        return send(res, 200, await jobView(id));
      }
      if (req.method === "GET" && area === "jobs" && sub === "outputs" && arg) {
        const job = await getRunner().jobs().get(id);
        const out = job.outputs.find((o) => o.id === arg);
        if (!out) return send(res, 404, { error: "unknown output" });
        const bytes = await out.toBytes();
        res.writeHead(200, { "content-type": out.contentType || "application/octet-stream", "content-length": bytes.byteLength });
        return res.end(bytes);
      }
      return send(res, 404, { error: "not found" });
    }
    // static web/
    if (url.pathname === "/wonderfull" || url.pathname === "/wonderfull/") {
      res.writeHead(302, { Location: "/?wonderfull=1#/app/wonderfull" });
      return res.end();
    }
    if (url.pathname.startsWith("/app/") || url.pathname === "/apps") {
      res.writeHead(302, { Location: `/#${url.pathname}` });
      return res.end();
    }
    const webRoot = join(root, "web");
    const rel = normalize(url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1))).replace(/^(\.\.[/\\])+/, "");
    let file = join(webRoot, rel);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (file.startsWith(webRoot) && existsSync(file) && statSync(file).isFile()) return sendFile(req, res, file);
    return send(res, 404, { error: "not found" });
  } catch (e) {
    const status = e instanceof InputError ? 400 : 500;
    if (status === 500) console.error(e);
    return send(res, status, { error: (e as Error).message });
  }
});

// runs that were still going when the server stopped are followed again
history.resume(async (jobId) => getRunner().jobs().get(jobId));

const host = process.env.WOX_HOST || process.env.FREEFIELD_HOST || "0.0.0.0";
server.listen(port, host, () => {
  console.log(`Wox Cinema Studio Pro on http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port} (${apps.length} apps)`
    + (guard.passcode ? " · passcode required" : "") + (guard.maxRunsPerDay ? ` · ${guard.maxRunsPerDay} runs a day` : ""));
  const st = tunnel.getStatus();
  console.log(`📱 Wonderfull Mobile (Wi-Fi LAN): ${st.lan_url}`);
  if (process.env.WOX_TUNNEL !== "0") {
    void tunnel.start();
  }
});

