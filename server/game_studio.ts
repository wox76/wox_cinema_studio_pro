import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, statSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { GAME_ENGINE_JS, DEFAULT_STYLE_CSS, buildIndexHtml } from "./game_engine_template.ts";
import { build1942SceneryBlenderScript, build1942GameJs } from "./template_1942.ts";
import { resolvePolyforkAsset, resolveOpenGameArtAsset, buildBlenderRemixScript, saveAssetToLocalLibrary } from "./asset_dataset.ts";
import { loadRegistry } from "./registry.ts";
import { Runner } from "./runner.ts";

const execFileAsync = promisify(execFile);

const ROOT = resolve(process.cwd());
export const GAMES_DIR = join(ROOT, "out", "games");
const VENDOR_DIR = join(ROOT, "web", "js", "vendor");

const BONSAI_HOST = process.env.BONSAI_HOST || "127.0.0.1";
const BONSAI_PORT = process.env.BONSAI_PORT || "8080";
const BONSAI_URL = `http://${BONSAI_HOST}:${BONSAI_PORT}`;
const BONSAI_START_SCRIPT = process.env.BONSAI_START_SCRIPT || "/home/wox76/opt/Bonsai-demo/start_bonsai.sh";
const BLENDER_BIN = process.env.BLENDER_BIN || "/home/wox76/.local/bin/blender";

export interface GameAssetRecord {
  name: string;
  role: string;
  description: string;
  file: string;
  targetHeight: number;
  searchQuery?: string;
  tintRgb?: [number, number, number];
  status: "pending" | "modeling" | "done" | "fallback" | "error";
  sizeBytes?: number;
  error?: string;
}

export type AssetSource = "library" | "blender" | "pixal3d";

export interface GameJob {
  id: string;
  title: string;
  tagline: string;
  prompt: string;
  genre: string;
  camera: string;
  style: string;
  assetSource?: AssetSource;
  status: "queued" | "designing" | "modeling" | "coding" | "packaging" | "done" | "error";
  step: string;
  progress: number;
  createdAt: string;
  outputDir: string;
  assets: GameAssetRecord[];
  files: string[];
  logs: string[];
  design?: any;
  liveStream?: string;
  liveLabel?: string;
  error?: string;
}

const activeJobs = new Map<string, GameJob>();
const activeControllers = new Map<string, AbortController>();

function ensureGamesDir() {
  if (!existsSync(GAMES_DIR)) mkdirSync(GAMES_DIR, { recursive: true });
}

function saveManifest(job: GameJob) {
  ensureGamesDir();
  if (!existsSync(job.outputDir)) mkdirSync(job.outputDir, { recursive: true });
  writeFileSync(join(job.outputDir, "manifest.json"), JSON.stringify(job, null, 2), "utf-8");
}

function addLog(job: GameJob, msg: string) {
  const ts = new Date().toTimeString().slice(0, 8);
  job.logs.push(`[${ts}] ${msg}`);
  if (job.logs.length > 200) job.logs.shift();
  saveManifest(job);
}

function loadDiskManifest(mf: string): GameJob {
  const job = JSON.parse(readFileSync(mf, "utf-8")) as GameJob;
  if (!["done", "error"].includes(job.status)) {
    job.status = "error";
    job.step = "Interrotto (pronto per riprendere)";
    job.error = "Generazione interrotta dal riavvio del server. Clicca ▶ Riprendi per continuare dallo stesso step.";
  }
  return job;
}

export function listGames(): GameJob[] {
  ensureGamesDir();
  const out: GameJob[] = [];
  for (const name of readdirSync(GAMES_DIR)) {
    const dir = join(GAMES_DIR, name);
    const mf = join(dir, "manifest.json");
    if (!existsSync(mf)) continue;
    try {
      const live = activeJobs.get(name);
      if (live) {
        out.push(live);
      } else {
        out.push(loadDiskManifest(mf));
      }
    } catch { /* ignore broken manifest */ }
  }
  return out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export function getGame(id: string): GameJob | null {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  if (activeJobs.has(safeId)) return activeJobs.get(safeId)!;
  const mf = join(GAMES_DIR, safeId, "manifest.json");
  if (!existsSync(mf)) return null;
  try {
    return loadDiskManifest(mf);
  } catch {
    return null;
  }
}

export function deleteGame(id: string, keepAssets = false): { deleted: boolean; savedAssets: number } {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  const dir = join(GAMES_DIR, safeId);
  if (!existsSync(dir)) return { deleted: false, savedAssets: 0 };

  let savedAssets = 0;
  if (keepAssets) {
    const assetsDir = join(dir, "assets");
    const manifestPath = join(dir, "manifest.json");
    let manifestAssets: GameAssetRecord[] = [];
    if (existsSync(manifestPath)) {
      try {
        const mf = JSON.parse(readFileSync(manifestPath, "utf-8")) as GameJob;
        if (Array.isArray(mf.assets)) manifestAssets = mf.assets;
      } catch { /* ignore */ }
    }
    if (existsSync(assetsDir)) {
      for (const file of readdirSync(assetsDir)) {
        if (!file.toLowerCase().endsWith(".glb")) continue;
        const fullPath = join(assetsDir, file);
        const baseName = file.replace(/\.glb$/i, "");
        const rec = manifestAssets.find((a) => a.file === file || a.name === baseName);
        const saved = saveAssetToLocalLibrary(fullPath, {
          id: `${safeId.slice(0, 24)}_${baseName}`,
          title: rec?.name ? `${rec.name} (${rec.role || "3D"})` : baseName,
          query: rec?.searchQuery || baseName.replace(/_/g, " "),
          category: rec?.role || "saved",
        });
        if (saved) savedAssets++;
      }
    }
  }

  const ctrl = activeControllers.get(safeId);
  if (ctrl) {
    ctrl.abort(new Error("Gioco eliminato"));
    activeControllers.delete(safeId);
  }
  activeJobs.delete(safeId);
  rmSync(dir, { recursive: true, force: true });
  return { deleted: true, savedAssets };
}

export async function checkBonsaiHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BONSAI_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function checkBlenderVersion(): Promise<{ available: boolean; version: string; path: string }> {
  if (!existsSync(BLENDER_BIN)) {
    return { available: false, version: "", path: BLENDER_BIN };
  }
  try {
    const { stdout } = await execFileAsync(BLENDER_BIN, ["--version"], { timeout: 5000 });
    const firstLine = stdout.split("\n")[0]?.trim() || "Blender";
    return { available: true, version: firstLine, path: BLENDER_BIN };
  } catch {
    return { available: false, version: "", path: BLENDER_BIN };
  }
}

export async function getStudioStatus() {
  const [bonsaiOnline, blender] = await Promise.all([checkBonsaiHealth(), checkBlenderVersion()]);
  return {
    bonsai: {
      online: bonsaiOnline,
      url: BONSAI_URL,
      model: "Ternary-Bonsai-2-27B",
      canAutoStart: existsSync(BONSAI_START_SCRIPT),
    },
    blender,
    pixal3d: {
      available: Boolean(process.env.COMFY_BASE_URL),
    },
    gamesDir: GAMES_DIR,
  };
}

async function generateAssetWithPixal3D(
  asset: GameAssetRecord,
  styleHint: string,
  outGlb: string,
  job: GameJob
): Promise<boolean> {
  if (!process.env.COMFY_BASE_URL) {
    throw new Error("COMFY_BASE_URL non configurato (ComfyUI / Pixal3D non disponibile)");
  }
  const { apps } = loadRegistry(ROOT);
  const app = apps.find((a) => a.id === "text-to-3d");
  if (!app) {
    throw new Error('App "text-to-3d" (Pixal3D) non trovata nel registro');
  }
  const runner = new Runner();
  const promptText = `${asset.description || asset.name.replace(/_/g, " ")}, ${styleHint}, game-ready 3D asset`;
  addLog(job, `💎 Pixal3D: avvio generazione "${asset.name}" (Z-Image + Pixal3D)...`);
  job.liveLabel = `Pixal3D (${asset.name})`;
  job.liveStream = `Prompt Pixal3D: ${promptText}\nInvio richiesta a ComfyUI...`;

  const submitted = await runner.submit(app, {
    prompt: promptText,
    texture_size: 1024,
    seed: -1,
  });

  const jobCtrl = activeControllers.get(job.id);
  const startedAt = Date.now();
  const maxWaitMs = 600_000; // 10 minutes max per 3D asset

  while (Date.now() - startedAt < maxWaitMs) {
    if (jobCtrl?.signal.aborted) {
      throw new Error("Fermato dall'utente");
    }
    await new Promise((r) => setTimeout(r, 2500));
    const st = await runner.jobs().get(submitted.id);
    const s = String(st.status || "running").toLowerCase();
    const sec = Math.round((Date.now() - startedAt) / 1000);
    job.liveStream = `Pixal3D job ${submitted.id} · stato: ${s} (${sec}s)`;

    if (s === "succeeded" || s === "completed" || s === "done") {
      const files3d = await runner.fetch3dOutputs(submitted.id);
      const glb = files3d.find((f) => f.ext === ".glb") || files3d[0];
      if (!glb || glb.bytes.byteLength < 200) {
        throw new Error("Pixal3D completato ma nessun file .glb trovato negli output");
      }
      writeFileSync(outGlb, glb.bytes);
      return true;
    }
    if (s === "failed" || s === "canceled" || s === "cancelled" || s === "expired" || s === "error") {
      throw new Error(`Job Pixal3D terminato con stato "${s}"`);
    }
  }
  throw new Error("Timeout generazione Pixal3D");
}

let startingBonsai = false;

export async function startBonsaiServer(): Promise<{ ok: boolean; message: string }> {
  if (await checkBonsaiHealth()) {
    return { ok: true, message: "Bonsai 2 è già attivo." };
  }
  if (!existsSync(BONSAI_START_SCRIPT)) {
    return { ok: false, message: `Script non trovato: ${BONSAI_START_SCRIPT}` };
  }
  if (startingBonsai) {
    return { ok: true, message: "Avvio di Bonsai 2 già in corso..." };
  }
  startingBonsai = true;
  try {
    const child = spawn("bash", [BONSAI_START_SCRIPT, "start"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, PORT: BONSAI_PORT, BONSAI_HOST },
    });
    child.unref();
    // Wait up to 45s for /health
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await checkBonsaiHealth()) {
        startingBonsai = false;
        return { ok: true, message: "Bonsai 2 avviato e pronto!" };
      }
    }
    startingBonsai = false;
    return { ok: true, message: "Bonsai 2 avviato in background (caricamento modello in corso)..." };
  } catch (err: any) {
    startingBonsai = false;
    return { ok: false, message: String(err?.message || err) };
  }
}

async function callBonsai(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 8192,
  temperature = 0.6,
  job?: GameJob,
  streamLabel?: string
): Promise<string> {
  // Bonsai 2 is a reasoning model (--reasoning-budget 2048), so max_tokens must always
  // leave generous headroom beyond the reasoning budget for the actual answer.
  const effectiveMaxTokens = Math.max(maxTokens, 6144);
  const jobCtrl = job ? activeControllers.get(job.id) : undefined;
  const signal = jobCtrl
    ? AbortSignal.any([AbortSignal.timeout(300_000), jobCtrl.signal])
    : AbortSignal.timeout(300_000);
  const res = await fetch(`${BONSAI_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "bonsai-2",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature,
      max_tokens: effectiveMaxTokens,
      stream: true,
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Bonsai 2 HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }

  let content = "";
  let reasoning = "";
  let finish = "unknown";
  let chunks = 0;
  const startedAt = Date.now();
  let lastLogAt = startedAt;
  let lastPreviewAt = 0;
  let buf = "";

  if (job) {
    job.liveLabel = streamLabel || "Bonsai 2";
    job.liveStream = "Connessione a Bonsai 2...";
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl = buf.indexOf("\n");
    while (nl !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith("data:")) {
        const payload = line.slice(5).trim();
        if (payload && payload !== "[DONE]") {
          try {
            const parsed = JSON.parse(payload);
            const choice = parsed?.choices?.[0];
            if (choice?.finish_reason) finish = choice.finish_reason;
            const delta = choice?.delta;
            if (typeof delta?.content === "string" && delta.content) {
              content += delta.content;
              chunks++;
            }
            if (typeof delta?.reasoning_content === "string" && delta.reasoning_content) {
              reasoning += delta.reasoning_content;
              chunks++;
            }
          } catch { /* ignore partial JSON */ }
        }
      }
      nl = buf.indexOf("\n");
    }

    const now = Date.now();
    if (job && now - lastPreviewAt > 800) {
      lastPreviewAt = now;
      const previewSource = content || reasoning;
      const modeTag = content ? "CODICE / OUTPUT" : "RAGIONAMENTO";
      const secs = Math.max(1, Math.round((now - startedAt) / 1000));
      job.liveLabel = `${streamLabel || "Bonsai 2"} · ${modeTag} (${chunks} tok · ${secs}s)`;
      job.liveStream = previewSource.slice(-900);
    }
    if (job && now - lastLogAt > 4000) {
      lastLogAt = now;
      const secs = Math.max(1, Math.round((now - startedAt) / 1000));
      const modeTag = content ? "scrittura codice" : "ragionamento";
      addLog(job, `⚡ ${streamLabel || "Bonsai 2"} (${modeTag}): ${chunks} token in ${secs}s...`);
    }
  }

  if (job) {
    const secs = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    job.liveLabel = `${streamLabel || "Bonsai 2"} · Completato (${chunks} tok in ${secs}s)`;
  }

  const finalContent = content.trim();
  if (finalContent) return finalContent;
  const finalReasoning = reasoning.trim();
  if (finalReasoning) return finalReasoning;

  throw new Error(`Risposta vuota da Bonsai 2 (finish_reason=${finish})`);
}

function extractCodeBlock(text: string, langHint = ""): string {
  const regex = langHint
    ? new RegExp("```(?:" + langHint + ")?\\s*\\n([\\s\\S]*?)```", "i")
    : /```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)```/;
  const m = regex.exec(text);
  return (m ? m[1] : text).trim();
}

function extractJsonObject(text: string): any {
  const cleaned = extractCodeBlock(text, "json");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Nessun oggetto JSON valido nella risposta di Bonsai 2");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "game-3d";
}

function fallbackBlenderScript(asset: GameAssetRecord, outGlbPath: string): string {
  const colorByRole: Record<string, [number, number, number]> = {
    player: [0.2, 0.85, 1.0],
    enemy: [1.0, 0.22, 0.3],
    collectible: [0.91, 1.0, 0.35],
    obstacle: [0.45, 0.5, 0.62],
    prop: [0.35, 0.78, 0.45],
  };
  const rgb = colorByRole[asset.role] || [0.8, 0.8, 0.85];
  const safePath = outGlbPath.replace(/\\/g, "/");
  return `import bpy, math

bpy.ops.wm.read_factory_settings(use_empty=True)

def make_mat(name, color, metallic=0.25, roughness=0.35, emission=0.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission > 0 and "Emission Strength" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = (color[0], color[1], color[2], 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission
    return mat

role = ${JSON.stringify(asset.role)}
mat_main = make_mat("MainMat", (${rgb[0]}, ${rgb[1]}, ${rgb[2]}), metallic=0.35, roughness=0.3)
mat_accent = make_mat("AccentMat", (0.92, 0.96, 1.0), metallic=0.6, roughness=0.2, emission=0.6)

if role == "player":
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.45, depth=1.1, location=(0, 0, 0.65))
    body = bpy.context.active_object
    body.data.materials.append(mat_main)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=12, radius=0.38, location=(0, 0, 1.45))
    head = bpy.context.active_object
    head.data.materials.append(mat_accent)
elif role == "enemy":
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.65, location=(0, 0, 0.75))
    body = bpy.context.active_object
    body.data.materials.append(mat_main)
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.35, depth=0.6, location=(0, 0, 1.5))
    horn = bpy.context.active_object
    horn.data.materials.append(mat_accent)
elif role == "collectible":
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.45, location=(0, 0, 0.6))
    gem = bpy.context.active_object
    gem.scale = (1.0, 1.0, 1.4)
    gem.data.materials.append(make_mat("GemMat", (${rgb[0]}, ${rgb[1]}, ${rgb[2]}), 0.1, 0.15, 1.2))
else:
    bpy.ops.mesh.primitive_cube_add(size=1.2, location=(0, 0, 0.6))
    box = bpy.context.active_object
    box.data.materials.append(mat_main)
    bpy.ops.mesh.primitive_cube_add(size=0.85, location=(0, 0, 1.45))
    top = bpy.context.active_object
    top.data.materials.append(mat_accent)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=${JSON.stringify(safePath)}, export_format='GLB')
`;
}

async function runBlenderScript(scriptPath: string, timeoutMs = 60_000): Promise<{ ok: boolean; stderr: string }> {
  try {
    const { stderr } = await execFileAsync(
      BLENDER_BIN,
      ["--background", "--factory-startup", "--python-exit-code", "1", "--python", scriptPath],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }
    );
    return { ok: true, stderr: stderr || "" };
  } catch (err: any) {
    return { ok: false, stderr: String(err?.stderr || err?.message || err) };
  }
}

function buildFallbackGameJs(design: any, assets: GameAssetRecord[], genre = "arcade-3d"): string {
  const playerAsset = assets.find((a) => a.role === "player") || assets[0];
  const enemyAsset = assets.find((a) => a.role === "enemy") || assets[1] || assets[0];
  const collectAsset = assets.find((a) => a.role === "collectible" || a.role === "powerup") || assets[2] || assets[0];
  const obstacleAsset = assets.find((a) => a.role === "obstacle" || a.role === "environment") || assets[3];

  if (genre === "shootemup-1942-3d") {
    const bomberAsset = assets.find((a) => a.name.includes("bomber")) || enemyAsset;
    const bossAsset = assets.find((a) => a.name.includes("boss")) || bomberAsset;
    return build1942GameJs({
      playerFile: playerAsset.file,
      enemyFile: enemyAsset.file,
      bomberFile: bomberAsset.file,
      bossFile: bossAsset.file,
      powerupFile: collectAsset.file,
    });
  }

  return `import { WoxGameEngine, THREE } from "./engine.js";

const engine = new WoxGameEngine({
  skyColor: ${JSON.stringify(design.skyColor || "#0b0e1a")},
  fogColor: ${JSON.stringify(design.fogColor || "#0b0e1a")},
  groundColor: ${JSON.stringify(design.groundColor || "#161b2a")},
  cameraMode: ${JSON.stringify(design.cameraMode || "third-person")},
});

let player = null;
let playerVelY = 0;
let onGround = true;
const enemies = [];
const collectibles = [];
const obstacles = [];
const ARENA = 26;

async function init() {
  engine.setStatus("Caricamento modelli 3D Blender...");
  await Promise.all([
    engine.loadModel("player", "./assets/${playerAsset.file}", { targetHeight: ${playerAsset.targetHeight || 2.0}, fallbackColor: 0x38bdf8 }),
    engine.loadModel("enemy", "./assets/${enemyAsset.file}", { targetHeight: ${enemyAsset.targetHeight || 2.0}, fallbackColor: 0xff5c72 }),
    engine.loadModel("collectible", "./assets/${collectAsset.file}", { targetHeight: ${collectAsset.targetHeight || 1.2}, fallbackColor: 0xe8ff5a }),
    ${obstacleAsset ? `engine.loadModel("obstacle", "./assets/${obstacleAsset.file}", { targetHeight: ${obstacleAsset.targetHeight || 2.8}, fallbackColor: 0x64748b }),` : ""}
  ]);

  resetGame();
  engine.setStatus("Pronto");
  document.getElementById("overlay-btn").onclick = () => {
    resetGame();
    engine.showOverlay("playing");
    engine.setStatus("In gioco");
  };

  engine.start((dt, elapsed) => {
    if (!player) return;
    const axis = engine.input.getAxis();
    const speed = engine.input.isDown("ShiftLeft") ? 15 : 10;
    const move = new THREE.Vector3(axis.x, 0, axis.z);
    if (move.lengthSq() > 0) {
      move.normalize();
      player.position.addScaledVector(move, speed * dt);
      player.rotation.y = Math.atan2(move.x, move.z);
    }

    // Jump & gravity
    if (engine.input.consume("Space") && onGround) {
      playerVelY = 9.5;
      onGround = false;
      engine.sfx.jump();
    }
    playerVelY -= 24 * dt;
    player.position.y += playerVelY * dt;
    if (player.position.y <= 0) {
      player.position.y = 0;
      playerVelY = 0;
      onGround = true;
    }

    player.position.x = THREE.MathUtils.clamp(player.position.x, -ARENA, ARENA);
    player.position.z = THREE.MathUtils.clamp(player.position.z, -ARENA, ARENA);

    // Collectibles
    for (const c of collectibles) {
      c.rotation.y += dt * 2.4;
      c.position.y = 0.4 + Math.sin(elapsed * 3 + c.userData.phase) * 0.25;
      if (engine.checkSphereCollision(player, c, 1.7)) {
        engine.sfx.collect();
        engine.particles.burst(c.position, 0xe8ff5a, 14);
        engine.addScore(100);
        c.position.set((Math.random() - 0.5) * ARENA * 1.7, 0.4, (Math.random() - 0.5) * ARENA * 1.7);
      }
    }

    // Enemies
    for (const e of enemies) {
      const dir = player.position.clone().sub(e.position);
      dir.y = 0;
      if (dir.lengthSq() > 0.01) {
        dir.normalize();
        e.position.addScaledVector(dir, (3.2 + Math.min(4, engine.score / 500)) * dt);
        e.rotation.y = Math.atan2(dir.x, dir.z);
      }
      if (engine.checkSphereCollision(player, e, 1.5)) {
        engine.sfx.hit();
        engine.particles.burst(player.position, 0xff5c72, 18);
        engine.setHealth(engine.health - 25);
        e.position.set((Math.random() > 0.5 ? 1 : -1) * (ARENA - 2), 0, (Math.random() - 0.5) * ARENA * 1.6);
        if (engine.health <= 0) {
          engine.sfx.gameover();
          engine.showOverlay("gameover", "Game Over", \`Punteggio finale: \${engine.score}\`);
          engine.setStatus("Game Over");
        }
      }
    }
  });
}

function clearEntities() {
  if (player) engine.scene.remove(player);
  enemies.splice(0).forEach((m) => engine.scene.remove(m));
  collectibles.splice(0).forEach((m) => engine.scene.remove(m));
  obstacles.splice(0).forEach((m) => engine.scene.remove(m));
}

function resetGame() {
  clearEntities();
  engine.setScore(0);
  engine.setHealth(100);
  player = engine.spawn("player", new THREE.Vector3(0, 0, 0));
  engine.setFollowTarget(player, new THREE.Vector3(0, 8, 12));

  for (let i = 0; i < 6; i++) {
    const c = engine.spawn("collectible", new THREE.Vector3((Math.random() - 0.5) * ARENA * 1.6, 0.4, (Math.random() - 0.5) * ARENA * 1.6));
    c.userData.phase = i * 1.1;
    collectibles.push(c);
  }
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const e = engine.spawn("enemy", new THREE.Vector3(Math.cos(angle) * 18, 0, Math.sin(angle) * 18));
    enemies.push(e);
  }
  ${obstacleAsset ? `for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + 0.4;
    const dist = 10 + (i % 2) * 8;
    obstacles.push(engine.spawn("obstacle", new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist)));
  }` : ""}
}

init();
`;
}

const GENRE_HINTS: Record<string, string> = {
  "shootemup-1942-3d": "Vertical-scrolling 3D shoot-'em-up inspired by 1980s 1942: fixed top-down vertical camera over scrolling blue ocean with islands/carriers underneath, player fighter plane with banking tilt, SPACE fires rapid bullets upward (upgradeable to double/triple fire), SHIFT performs invulnerable 360-degree barrel-roll loop, structured enemy waves (V-formations of 5 fighters, heavy bombers, bosses) that award a Wave Clear Bonus (+500 points + guaranteed power-up drop) when every enemy in the wave is destroyed.",
  "shootemup-rtype-3d": "Horizontal side-scrolling 2.5D/3D space shoot-'em-up inspired by R-Type: side camera, player starfighter flying left-to-right, rapid fire & charged laser beam, orbiting Force pod/drone, biomechanical alien waves, terrain hazards, and giant boss.",
  "platform-mario-3d": "Colorful 3D platformer inspired by Super Mario: responsive running and jumping across floating 3D platforms, collecting spinning coins/stars, stomping on patrolling enemies from above, mystery blocks, and reaching the goal flag.",
  "platform-ghostsngoblins-3d": "Gothic 3D action-platformer inspired by Ghosts 'n Goblins: armored knight moving across haunted graveyard/castle platforms, throwing lances/daggers at rising zombies and flying demons, armor-break hit system, and treasure chests.",
  "beatemup-3d": "3D side-scrolling / arena beat-'em-up: player brawler with punch/kick combos (Space/J/K), waves of street/fantasy enemies approaching, knockback, health pickups, destructible props.",
  "soccer-sidekicks-3d": "Fast-paced 3D arcade soccer inspired by NeoGeo Super Sidekicks: 3D football pitch with goals, dynamic side/angled broadcast camera, player dribbling the 3D soccer ball, passing/shooting (Space) with power shots, goalkeeper & opposing defenders, goal celebrations and scoreboard.",
  "shooter-8way-3d": "Classic 8-way directional 3D arcade shooter: player moves and fires in all 8 directions (WASD/Arrows + Space), relentless waves of enemies from all sides, weapon upgrades, arena cover.",
  "arcade-3d": "Fast-paced 3D arcade action game with crisp controls, collectibles, hazards, and escalating difficulty.",
  "action-arena": "3D arena combat game with agile movement, attacks/dashes, enemy waves, and power-ups.",
  "racing-runner": "High-speed 3D runner/racing game with lanes or open track, boost, obstacles, and checkpoints.",
  "platformer-3d": "3D platformer with jumping, elevated platforms, collectibles, and patrolling enemies.",
  "exploration": "3D adventure/exploration game with treasures, landmarks, and roaming enemies.",
};

const STYLE_BLENDER_HINTS: Record<string, string> = {
  "low-poly-stylized": "Low-Poly Stylized: clean faceted geometry, bold silhouette, vibrant matte/satin Principled BSDF colors.",
  "high-poly-ultra": "High-Poly Ultra Quality: rich multi-part detailed geometry, higher segment counts (32-48), smooth shading (bpy.ops.object.shade_smooth()), bevel/subdivision modifiers where appropriate, layered metallic/roughness/clearcoat PBR materials.",
  "cyberpunk-neon": "Cyberpunk Neon: dark metallic chassis with glowing emissive neon trim (cyan, magenta, lime).",
  "scifi-metallic": "Sci-Fi Metallic: brushed steel, titanium panels, glowing reactor cores, sleek hard-surface forms.",
  "fantasy-cartoon": "Fantasy Cartoon: chunky heroic proportions, warm saturated colors, stylized silhouettes.",
  "retro-arcade-3d": "Retro Arcade 80s/90s 3D: bold primary arcade colors, crisp readable shapes inspired by NeoGeo/Capcom classics.",
  "photorealistic-pbr": "Photorealistic PBR: realistic proportions, high-detail mesh parts, smooth shading, physically accurate roughness/metallic values.",
  "cel-shaded-anime": "Cel-Shaded / Anime 3D: clean stylized forms, high-contrast vivid colors, crisp silhouette.",
  "voxel-blocky": "Voxel / Blocky 3D: constructed from crisp aligned cube/block clusters with vibrant colors.",
};

const CAMERA_HINTS: Record<string, string> = {
  "top-down-vertical": "Vertical top-down angled arcade camera (1942 style): positioned high above and slightly behind (e.g. offset (0, 22, 8)), looking down at the scrolling ocean/sky playfield.",
  "side-scroll-25d": "2.5D side-scrolling camera (R-Type / Super Mario / Ghosts 'n Goblins / Beat'em up style): positioned on the side/front-angle (e.g. offset (0, 5, 16)), following horizontal X progression.",
  "broadcast-soccer": "Dynamic angled broadcast soccer camera (Super Sidekicks style): elevated side-pitch angle (e.g. offset (0, 14, 18)) tracking the ball and active player smoothly across the 3D pitch.",
  "top-down-isometric": "Top-down / isometric 3D camera (8-Way / Arcade style): high angled view (e.g. offset (0, 18, 12)) showing enemies approaching from all 8 directions.",
  "third-person": "Third-person follow camera behind the player (e.g. offset (0, 7, 12)).",
  "first-person": "First-person camera attached at player eye level looking forward.",
};

async function runGamePipeline(job: GameJob) {
  try {
    // Ensure Bonsai 2 is online
    const bonsaiOk = await checkBonsaiHealth();
    if (!bonsaiOk) {
      addLog(job, "Bonsai 2 non attivo: avvio automatico in corso...");
      const startRes = await startBonsaiServer();
      if (!startRes.ok || !(await checkBonsaiHealth())) {
        throw new Error(`Impossibile avviare Bonsai 2: ${startRes.message}`);
      }
      addLog(job, "Bonsai 2 pronto su " + BONSAI_URL);
    }

    const blenderInfo = await checkBlenderVersion();
    if (!blenderInfo.available) {
      throw new Error(`Blender non trovato in ${BLENDER_BIN}`);
    }

    const assetsDir = join(job.outputDir, "assets");
    const scriptsDir = join(job.outputDir, "blender_scripts");
    const vendorOutDir = join(job.outputDir, "vendor");
    const utilsOutDir = join(job.outputDir, "utils");
    mkdirSync(assetsDir, { recursive: true });
    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(vendorOutDir, { recursive: true });
    mkdirSync(utilsOutDir, { recursive: true });

    const genreHint = GENRE_HINTS[job.genre] || job.genre;
    const styleHint = STYLE_BLENDER_HINTS[job.style] || job.style;
    const cameraHint = CAMERA_HINTS[job.camera] || job.camera;

    // PHASE 1: GAME DESIGN (BONSAI 2) — skip if already present on resume
    let design = job.design;
    if (design && Array.isArray(job.assets) && job.assets.length > 0) {
      addLog(job, `↷ Fase 1/4 già completata ("${job.title}", ${job.assets.length} asset): riprendo da Fase 2...`);
      job.progress = Math.max(job.progress, 22);
    } else {
      job.status = "designing";
      job.step = "Architettura & Game Design (Bonsai 2)";
      job.progress = 10;
      addLog(job, "Fase 1/4: Progettazione gioco 3D con Bonsai 2...");

      const designRaw = await callBonsai(
        "You are a senior 3D game architect. Return ONLY valid JSON (no markdown commentary outside JSON).",
        `Design a fun, playable 3D browser game in Three.js based on this request:
Prompt: ${job.prompt}
Genre: ${job.genre} (${genreHint})
Camera: ${job.camera} (${cameraHint})
Visual Style: ${job.style} (${styleHint})

Return a single JSON object with this exact schema:
{
  "title": "Short catchy game title",
  "tagline": "1 sentence Italian description of the objective",
  "skyColor": "#0b0e1a",
  "fogColor": "#0b0e1a",
  "groundColor": "#161b2a",
  "cameraMode": "${job.camera}",
  "controlsHint": "WASD / Frecce: Muovi · Spazio: Azione / Spara / Tira · Shift: Sprint",
  "mechanics": "Detailed summary of core gameplay loop, controls, scoring, win/lose conditions",
  "assets": [
    {
      "name": "player",
      "role": "player",
      "targetHeight": 2.0,
      "searchQuery": "short 1-3 word English keyword for Polyfork 3D library (e.g. fighter plane, soldier, robot, soccer ball, knight, sports car)",
      "description": "Detailed 3D visual description for Blender modeling or remixing"
    }
  ]
}
Rules:
- There is NO fixed limit on the number of 3D assets: include EVERY 3D object genuinely needed to make this game rich and complete.
- Provide a clean English "searchQuery" for each asset so we can fetch rigged/game-ready 3D models from Polyfork (and cache them locally) or remix/model them in Blender.
- Always include a "player" asset.
- Asset "name" must be lowercase alphanumeric + underscore only.`,
        3072,
        0.5,
        job,
        "Design Gioco 3D (JSON)"
      );

      design = extractJsonObject(designRaw);
      job.design = design;
      job.title = String(design.title || job.title);
      job.tagline = String(design.tagline || job.prompt);
      const rawAssets: any[] = Array.isArray(design.assets) && design.assets.length > 0 ? design.assets : [
        { name: "player", role: "player", targetHeight: 2.0, description: "Futuristic hero character" },
        { name: "enemy", role: "enemy", targetHeight: 2.0, description: "Red mechanical drone enemy" },
        { name: "collectible", role: "collectible", targetHeight: 1.2, description: "Glowing energy crystal" },
      ];

      job.assets = rawAssets.map((a, idx) => {
        const cleanName = String(a.name || `asset_${idx}`).toLowerCase().replace(/[^a-z0-9_]/g, "_") || `asset_${idx}`;
        const q = typeof a.searchQuery === "string" && a.searchQuery.trim() ? a.searchQuery.trim() : cleanName.replace(/_/g, " ");
        return {
          name: cleanName,
          role: String(a.role || "prop"),
          description: String(a.description || cleanName),
          file: `${cleanName}.glb`,
          targetHeight: Number(a.targetHeight) || 2.0,
          searchQuery: q,
          status: "pending",
        };
      });
      job.progress = 22;
      addLog(job, `Design completato: "${job.title}" con ${job.assets.length} modelli 3D da creare in Blender.`);
    }

    // PHASE 2: 3D ASSET GENERATION (LIBRARY / PIXAL3D / BLENDER)
    const assetSource: AssetSource = job.assetSource || "library";
    job.status = "modeling";
    job.step =
      assetSource === "pixal3d"
        ? "Generazione 3D con Pixal3D (.glb)"
        : assetSource === "blender"
          ? "Modellazione 3D in Blender (.glb)"
          : "Ricerca nelle Librerie 3D (.glb)";
    addLog(
      job,
      assetSource === "pixal3d"
        ? `Fase 2/4: Generazione ${job.assets.length} oggetti 3D con Pixal3D (Z-Image + PBR .GLB)...`
        : assetSource === "blender"
          ? `Fase 2/4: Modellazione ${job.assets.length} oggetti 3D in ${blenderInfo.version} (solo Blender)...`
          : `Fase 2/4: Recupero ${job.assets.length} oggetti 3D dalle librerie (Polyfork / OGA) con fallback Blender...`
    );

    for (let i = 0; i < job.assets.length; i++) {
      const asset = job.assets[i];
      const outGlb = join(assetsDir, asset.file);
      if ((asset.status === "done" || asset.status === "fallback") && existsSync(outGlb) && statSync(outGlb).size > 200) {
        addLog(job, `↷ "${asset.file}" già pronto, salto.`);
        continue;
      }
      asset.status = "modeling";
      job.progress = 25 + Math.round((i / job.assets.length) * 40);

      // Option A: "library" — Try Polyfork 3D Library, then OpenGameArt.org 3D Library (both auto-cached locally!)
      if (assetSource === "library") {
        const query = asset.searchQuery || asset.name.replace(/_/g, " ");
        const preferRigged = ["player", "enemy", "boss", "character"].includes(asset.role);
        try {
          const fetched = (await resolvePolyforkAsset(query, preferRigged)) || (await resolveOpenGameArtAsset(query));
          if (fetched) {
            const srcLabel = fetched.fromCache ? "Libreria Locale (cache)" : `${fetched.asset.category === "opengameart" ? "OpenGameArt.org" : "Polyfork.dev"} (salvato in libreria)`;
            addLog(job, `📦 ${srcLabel}: "${fetched.asset.title}" [${fetched.asset.category}] → ${asset.file}`);
            if (asset.tintRgb) {
              const remixScript = join(scriptsDir, `${asset.name}_remix.py`);
              writeFileSync(remixScript, buildBlenderRemixScript(fetched.asset.filePath, outGlb, { tintRgb: asset.tintRgb }), "utf-8");
              const rRes = await runBlenderScript(remixScript);
              if (!rRes.ok || !existsSync(outGlb)) copyFileSync(fetched.asset.filePath, outGlb);
            } else {
              copyFileSync(fetched.asset.filePath, outGlb);
            }
            asset.status = "done";
            asset.sizeBytes = statSync(outGlb).size;
            addLog(job, `✓ "${asset.file}" pronto (${Math.round(asset.sizeBytes / 1024)} KB)`);
            continue;
          }
        } catch (err: any) {
          addLog(job, `⚠ Libreria online non disponibile per "${query}", passo a Blender: ${String(err?.message || err)}`);
        }
      }

      // Option B: "pixal3d" — Generate PBR 3D mesh with ComfyUI text-to-3d (Z-Image + Pixal3D)
      if (assetSource === "pixal3d") {
        try {
          const ok = await generateAssetWithPixal3D(asset, styleHint, outGlb, job);
          if (ok && existsSync(outGlb) && statSync(outGlb).size > 200) {
            asset.status = "done";
            asset.sizeBytes = statSync(outGlb).size;
            addLog(job, `✓ "${asset.file}" generato con Pixal3D (${Math.round(asset.sizeBytes / 1024)} KB)`);
            continue;
          }
        } catch (err: any) {
          if (activeControllers.get(job.id)?.signal.aborted) throw err;
          addLog(job, `⚠ Pixal3D non riuscito per "${asset.name}" (${String(err?.message || err)}), passo a Blender...`);
        }
      }

      // Option C: "blender" (or fallback when library/pixal3d didn't produce a mesh)
      addLog(job, `Blender AI: modellazione "${asset.name}" (${asset.role})...`);

      const scriptFile = join(scriptsDir, `${asset.name}.py`);

      const blenderSys = `You are an expert Blender 5.1 Python (bpy) 3D modeler.
Return ONLY executable Python code (no explanation).
Requirements:
- Start with: import bpy, math
- Clear scene with: bpy.ops.wm.read_factory_settings(use_empty=True)
- Build a recognizable, multi-part, stylish 3D model using bpy.ops.mesh primitives (cubes, cylinders, spheres, cones, torus, icospheres) with transforms, scales, and rotations.
- Create Principled BSDF materials (use "Base Color", "Metallic", "Roughness"; do NOT use deprecated Blender 3.x inputs like "Specular" or "Subsurface Color").
- Place the model centered on X=0, Y=0 with its base resting near Z=0.
- At the end, select all objects and export GLB:
  bpy.ops.object.select_all(action='SELECT')
  bpy.ops.export_scene.gltf(filepath=${JSON.stringify(outGlb)}, export_format='GLB')`;

      let success = false;
      let lastErr = "";

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const userMsg = attempt === 1
            ? `Model this 3D game asset in Blender.\nVisual Style: ${styleHint}\nName: ${asset.name}\nRole: ${asset.role}\nDescription: ${asset.description}\nExport to: ${outGlb}`
            : `Fix this Blender 5.1 Python script error and return the complete corrected script:\nError:\n${lastErr.slice(-800)}`;

          const pyRaw = await callBonsai(blenderSys, userMsg, 2500, 0.4, job, `Blender Python (${asset.name})`);
          const pyCode = extractCodeBlock(pyRaw, "python");
          writeFileSync(scriptFile, pyCode, "utf-8");

          const runRes = await runBlenderScript(scriptFile);
          if (runRes.ok && existsSync(outGlb) && statSync(outGlb).size > 200) {
            success = true;
            asset.status = "done";
            asset.sizeBytes = statSync(outGlb).size;
            addLog(job, `✓ "${asset.file}" esportato da Blender (${Math.round(asset.sizeBytes / 1024)} KB)`);
            break;
          }
          lastErr = runRes.stderr || "File GLB non generato";
          addLog(job, `Tentativo ${attempt} per "${asset.name}" fallito, correzione automatica...`);
        } catch (err: any) {
          lastErr = String(err?.message || err);
        }
      }

      if (!success) {
        addLog(job, `Fallback procedurale Blender per "${asset.name}"...`);
        const fbCode = fallbackBlenderScript(asset, outGlb);
        writeFileSync(scriptFile, fbCode, "utf-8");
        const fbRes = await runBlenderScript(scriptFile);
        if (fbRes.ok && existsSync(outGlb)) {
          asset.status = "fallback";
          asset.sizeBytes = statSync(outGlb).size;
          addLog(job, `✓ "${asset.file}" generato con fallback Blender (${Math.round(asset.sizeBytes / 1024)} KB)`);
        } else {
          asset.status = "error";
          asset.error = lastErr.slice(0, 300);
          addLog(job, `⚠ Impossibile esportare "${asset.file}", l'engine userà una mesh procedurale.`);
        }
      }
    }

    // For 1942 Shoot'em up genre, attach modular Polyfork terrain tiles from local library (or fallback Blender tile)
    if (job.genre === "shootemup-1942-3d") {
      const refGameAssets = join(GAMES_DIR, "shoot-em-up-verticale-3d-ispirat-20261121121111", "assets");
      let copiedModular = 0;
      for (const tf of ["terrain_tile_0.glb", "terrain_tile_1.glb", "terrain_tile_2.glb"]) {
        const srcTile = join(refGameAssets, tf);
        const dstTile = join(assetsDir, tf);
        if (existsSync(srcTile) && !existsSync(dstTile)) {
          copyFileSync(srcTile, dstTile);
          copiedModular++;
        }
      }
      if (copiedModular > 0) {
        addLog(job, `✓ Template 1942: copiati ${copiedModular} terreni modulari Polyfork 3D.`);
      } else {
        const tileGlb = join(assetsDir, "environment_pacific_tile.glb");
        if (!existsSync(tileGlb)) {
          addLog(job, "Blender 1942 Template: generazione scenario 3D Pacifico a blocchi...");
          const tileScript = join(scriptsDir, "environment_pacific_tile.py");
          writeFileSync(tileScript, build1942SceneryBlenderScript(tileGlb), "utf-8");
          const tileRes = await runBlenderScript(tileScript);
          if (tileRes.ok && existsSync(tileGlb)) {
            addLog(job, `✓ Scenario 1942 "environment_pacific_tile.glb" generato (${Math.round(statSync(tileGlb).size / 1024)} KB)`);
          }
        }
      }
    }

    // PHASE 3: ENGINE & VENDOR ASSEMBLY
    job.status = "packaging";
    job.step = "Assemblaggio Engine Three.js & Risorse";
    job.progress = 70;
    addLog(job, "Fase 3/4: Copia Three.js locale (offline) e WoxGameEngine...");

    for (const vf of ["three.module.min.js", "GLTFLoader.js", "OrbitControls.js"]) {
      const src = join(VENDOR_DIR, vf);
      if (existsSync(src)) copyFileSync(src, join(vendorOutDir, vf));
    }
    const bufUtilsSrc = join(ROOT, "web", "js", "utils", "BufferGeometryUtils.js");
    if (existsSync(bufUtilsSrc)) copyFileSync(bufUtilsSrc, join(utilsOutDir, "BufferGeometryUtils.js"));
    writeFileSync(join(job.outputDir, "engine.js"), GAME_ENGINE_JS, "utf-8");
    writeFileSync(join(job.outputDir, "style.css"), DEFAULT_STYLE_CSS, "utf-8");
    writeFileSync(
      join(job.outputDir, "index.html"),
      buildIndexHtml(job.title, job.tagline, String(design.controlsHint || "WASD / Frecce: Muovi · Spazio: Salta · Shift: Sprint")),
      "utf-8"
    );

    // PHASE 4: GAME LOGIC CODE GENERATION (BONSAI 2)
    job.status = "coding";
    job.step = "Scrittura Codice Gioco Three.js (Bonsai 2)";
    job.progress = 80;
    addLog(job, "Fase 4/4: Generazione logica di gioco (game.js) con Bonsai 2...");

    const assetManifestText = job.assets
      .map((a) => `- name: "${a.name}", role: "${a.role}", url: "./assets/${a.file}", targetHeight: ${a.targetHeight}`)
      .join("\n");

    const codePrompt = `Write a complete, bug-free ES module \`game.js\` that uses \`WoxGameEngine\` from \`./engine.js\`.

Game Design:
- Title: ${job.title}
- Tagline: ${job.tagline}
- Genre: ${job.genre} (${genreHint})
- Camera: ${job.camera} (${cameraHint})
- Visual Style: ${job.style}
- Mechanics: ${design.mechanics || job.prompt}
- Colors: skyColor="${design.skyColor || "#0b0e1a"}", fogColor="${design.fogColor || "#0b0e1a"}", groundColor="${design.groundColor || "#161b2a"}"

Available Blender 3D Models in ./assets/:
${assetManifestText}

Exact WoxGameEngine API (already implemented in ./engine.js):
- import { WoxGameEngine, THREE } from "./engine.js";
- const engine = new WoxGameEngine({ skyColor, fogColor, groundColor, cameraMode });
- await engine.loadModel(name, url, { targetHeight, fallbackColor });
- const obj = engine.spawn(name, new THREE.Vector3(x, y, z), scale);
- engine.setFollowTarget(obj, new THREE.Vector3(0, 8, 12));
- engine.input.getAxis() -> { x, z } (-1..1 for WASD/Arrows)
- engine.input.isDown("ShiftLeft" | "Space" | "KeyE")
- engine.input.consume("Space") -> true once per key press
- engine.checkSphereCollision(objA, objB, radiusSum) -> boolean
- engine.particles.burst(pos, colorHex, count)
- engine.sfx.jump() | collect() | hit() | shoot() | win() | gameover()
- engine.setScore(n) | engine.addScore(delta) | engine.setHealth(n) | engine.setStatus(str)
- engine.showOverlay("playing" | "gameover" | "victory" | "menu", title, subtitle)
- engine.start((dt, elapsed) => { ... })
- Start button in DOM: document.getElementById("overlay-btn").onclick = () => { resetGame(); engine.showOverlay("playing"); };

Requirements:
- Load ALL listed Blender models with await Promise.all([...]).
- Make the gameplay genuinely fun, responsive, and visually polished (smooth movement, jumping or shooting/dashing, animations, particles, sound effects, score & health updates, restartable on Game Over or Victory).
- Return ONLY the JavaScript code for \`game.js\`. No markdown explanations outside the code block.`;

    let gameJs = "";
    try {
      const rawJs = await callBonsai(
        "You are an expert Three.js game developer. Return ONLY clean, valid ES module JavaScript code.",
        codePrompt,
        4096,
        0.45,
        job,
        "Codice Three.js (game.js)"
      );
      const extracted = extractCodeBlock(rawJs, "javascript");
      if (extracted.includes("WoxGameEngine") && extracted.includes("engine.start")) {
        gameJs = extracted;
        addLog(job, "✓ Codice game.js generato da Bonsai 2.");
      } else {
        throw new Error("Codice generato incompleto");
      }
    } catch (err: any) {
      addLog(job, `Fallback template game.js (${String(err?.message || err)})`);
      gameJs = buildFallbackGameJs(design, job.assets, job.genre);
    }

    writeFileSync(join(job.outputDir, "game.js"), gameJs, "utf-8");

    // Launcher script & README in the game folder
    const playSh = `#!/usr/bin/env bash
cd "$(dirname "$0")"
echo "Avvio ${job.title} su http://127.0.0.1:8787 ..."
python3 -m http.server 8787
`;
    writeFileSync(join(job.outputDir, "play.sh"), playSh, { mode: 0o755 });
    writeFileSync(
      join(job.outputDir, "README.md"),
      `# ${job.title}\n\n${job.tagline}\n\nGenerato in locale con **Wox 3D Game Studio** (Blender 3D AI + Bonsai 2 + Three.js).\n\n## Come giocare in locale\n\n\`\`\`bash\n./play.sh\n\`\`\`\nPoi apri \`http://127.0.0.1:8787\` nel browser.\n`,
      "utf-8"
    );

    // Collect generated file list
    job.files = [
      "index.html",
      "style.css",
      "engine.js",
      "game.js",
      "play.sh",
      "README.md",
      ...job.assets.map((a) => `assets/${a.file}`),
    ];
    job.status = "done";
    job.step = "Gioco 3D pronto!";
    job.progress = 100;
    addLog(job, `🎉 Gioco "${job.title}" completato nella cartella: ${job.outputDir}`);
    saveManifest(job);
  } catch (err: any) {
    job.status = "error";
    job.error = String(err?.message || err);
    job.step = "Errore nella generazione";
    addLog(job, `❌ Errore: ${job.error}`);
    saveManifest(job);
  }
}

export function startGameGeneration(input: {
  prompt: string;
  genre?: string;
  camera?: string;
  style?: string;
  assetSource?: AssetSource;
}): GameJob {
  ensureGamesDir();
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new Error("Inserisci una descrizione del gioco 3D.");

  const rawSource = String(input.assetSource || "library").toLowerCase();
  const assetSource: AssetSource =
    rawSource === "blender" || rawSource === "pixal3d" || rawSource === "library"
      ? (rawSource as AssetSource)
      : "library";

  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const id = `${slugify(prompt)}-${stamp}`;
  const outputDir = join(GAMES_DIR, id);
  mkdirSync(outputDir, { recursive: true });

  const job: GameJob = {
    id,
    title: prompt.slice(0, 42),
    tagline: prompt,
    prompt,
    genre: input.genre || "arcade-3d",
    camera: input.camera || "third-person",
    style: input.style || "low-poly-stylized",
    assetSource,
    status: "queued",
    step: "Inizializzazione pipeline...",
    progress: 3,
    createdAt: new Date().toISOString(),
    outputDir,
    assets: [],
    files: [],
    logs: [],
  };

  activeJobs.set(id, job);
  activeControllers.set(id, new AbortController());
  saveManifest(job);
  void runGamePipeline(job).finally(() => activeControllers.delete(id));
  return job;
}

export function resumeGameGeneration(id: string): GameJob {
  const job = getGame(id);
  if (!job) throw new Error("Gioco non trovato.");
  job.error = undefined;
  job.status = "queued";
  job.step = "Ripresa generazione dallo step precedente...";
  activeJobs.set(job.id, job);
  activeControllers.set(job.id, new AbortController());
  addLog(job, "▶ Ripresa manuale della pipeline dallo step interrotto...");
  void runGamePipeline(job).finally(() => activeControllers.delete(job.id));
  return job;
}

export function stopGameGeneration(id: string): GameJob {
  const job = getGame(id);
  if (!job) throw new Error("Gioco non trovato.");
  const ctrl = activeControllers.get(job.id);
  if (ctrl) {
    ctrl.abort(new Error("Fermato dall'utente"));
    activeControllers.delete(job.id);
  }
  activeJobs.delete(job.id);
  job.status = "error";
  job.step = "Generazione fermata dall'utente";
  job.error = "Generazione fermata manualmente. Clicca ▶ Riprendi per continuare dallo stesso step.";
  addLog(job, "⏹ Generazione fermata dall'utente.");
  saveManifest(job);
  return job;
}

async function runGameModification(job: GameJob, instruction: string) {
  try {
    const bonsaiOk = await checkBonsaiHealth();
    if (!bonsaiOk) {
      addLog(job, "Bonsai 2 non attivo: avvio automatico in corso...");
      const startRes = await startBonsaiServer();
      if (!startRes.ok || !(await checkBonsaiHealth())) {
        throw new Error(`Impossibile avviare Bonsai 2: ${startRes.message}`);
      }
    }

    const gameJsPath = join(job.outputDir, "game.js");
    if (!existsSync(gameJsPath)) throw new Error("game.js non trovato nella cartella del gioco.");
    const currentCode = readFileSync(gameJsPath, "utf-8");

    job.status = "coding";
    job.step = "Modifica codice Three.js (Bonsai 2)...";
    job.progress = 35;
    addLog(job, `✏️ Richiesta modifica: "${instruction}"`);

    const rawUpdated = await callBonsai(
      "You are an expert Three.js game developer. Apply the user's requested modification to the existing `game.js` ES module. Return ONLY the complete updated JavaScript code for `game.js` inside a single ```javascript code block. Preserve all existing working imports, assets, and engine calls unless the user asks to change them.",
      `Current game.js:\n\`\`\`javascript\n${currentCode}\n\`\`\`\n\nUser modification request (in Italian):\n${instruction}\n\nReturn the COMPLETE updated game.js file:`,
      8192,
      0.35,
      job,
      "Modifica game.js (Bonsai 2)"
    );

    const updatedCode = extractCodeBlock(rawUpdated, "javascript");
    if (!updatedCode || !updatedCode.includes("WoxGameEngine")) {
      throw new Error("Il codice modificato da Bonsai 2 non è valido.");
    }

    // Validate JS syntax before overwriting
    const tmpPath = join(job.outputDir, ".game.tmp.mjs");
    writeFileSync(tmpPath, updatedCode, "utf-8");
    try {
      await execFileAsync(process.execPath, ["--check", tmpPath], { timeout: 10_000 });
    } catch (synErr: any) {
      rmSync(tmpPath, { force: true });
      throw new Error(`Errore di sintassi nel codice generato: ${String(synErr?.stderr || synErr?.message || synErr).slice(0, 240)}`);
    }
    rmSync(tmpPath, { force: true });

    // Backup previous version and save new game.js
    writeFileSync(join(job.outputDir, "game.prev.js"), currentCode, "utf-8");
    writeFileSync(gameJsPath, updatedCode, "utf-8");

    job.status = "done";
    job.step = "Modifica applicata!";
    job.progress = 100;
    addLog(job, "✓ Modifica applicata a game.js (sintassi verificata, backup in game.prev.js).");
    saveManifest(job);
  } catch (err: any) {
    job.status = "done"; // keep game playable even if modification failed
    job.error = String(err?.message || err);
    job.step = "Modifica non riuscita (versione precedente mantenuta)";
    addLog(job, `❌ Modifica fallita: ${job.error}`);
    saveManifest(job);
  }
}

export function startGameModification(id: string, instruction: string): GameJob {
  const job = getGame(id);
  if (!job) throw new Error("Gioco non trovato.");
  const text = String(instruction || "").trim();
  if (!text) throw new Error("Scrivi la modifica che vuoi applicare nel campo Idea del Gioco 3D.");
  job.error = undefined;
  job.status = "coding";
  job.step = "Avvio modifica codice con Bonsai 2...";
  job.progress = 15;
  activeJobs.set(job.id, job);
  activeControllers.set(job.id, new AbortController());
  saveManifest(job);
  void runGameModification(job, text).finally(() => activeControllers.delete(job.id));
  return job;
}
