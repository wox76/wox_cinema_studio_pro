import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, linkSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, resolve, win32 } from "node:path";

export interface CustomNodeDef {
  id: string;
  name: string;
  description: string;
  essential: boolean;
  type: "bundled_dir" | "bundled_file" | "git" | "backend_deps";
  repo?: string;
  commit?: string;
  targetRel: string;
  sourceRel?: string;
  altTargetRel?: string;
  usedBy: string[];
}

export interface ModelDef {
  repo: string;
  file: string;
  dir: string;
  name: string;
  gb: number;
  gated: boolean;
  license?: string | null;
  used_by: string[];
  directUrl?: string;
}

export interface PackStatus {
  id: string;
  title: string;
  description: string;
  essential: boolean;
  apps: string[];
  download_gb: number;
  missing_gb: number;
  needs_hf_token: boolean;
  installed_count: number;
  total_count: number;
  installed: boolean;
  models: (ModelDef & { installed: boolean })[];
}

export interface InstallerTask {
  id: string;
  title: string;
  status: "running" | "completed" | "failed" | "canceled";
  startedAt: number;
  finishedAt: number | null;
  currentStep: string;
  currentIndex: number;
  totalSteps: number;
  percent: number;
  logs: string[];
  error: string | null;
}

const CUSTOM_NODES: CustomNodeDef[] = [
  {
    id: "wox-cinema-studio",
    name: "ComfyUI-WOX-Cinema-Studio [PRO]",
    description: "Nodi nativi Wox Cinema Studio Pro: Cinema Studio, Storyboard Scene/Render/Out, Video Auto-Length & Upscaler, Music Reference Guide.",
    essential: true,
    type: "bundled_dir",
    sourceRel: "custom_nodes/ComfyUI-WOX-Cinema-Studio",
    targetRel: "custom_nodes/ComfyUI-WOX-Cinema-Studio",
    usedBy: ["cinema-studio", "cinema-video", "director", "music", "upscale-video"],
  },
  {
    id: "reference-multi-latent",
    name: "ReferenceMultiLatent (@ref Engine)",
    description: "Motore nativo per riferimenti multipli @ref1, @ref2... che codifica e concatena i latent di riferimento nei workflow di editing e generazione.",
    essential: true,
    type: "bundled_file",
    sourceRel: "custom_nodes/reference_multi_latent.py",
    targetRel: "custom_nodes/reference_multi_latent.py",
    usedBy: ["cinema-studio", "create-image", "character-studio", "edit", "relight", "product-shot"],
  },
  {
    id: "comfyui-ltxvideo",
    name: "ComfyUI-LTXVideo",
    description: "Nodi ufficiali Lightricks per LTX-2.5 Video, Audio VAE Decode/Encode, IC-LoRA Guide, Latent Upsampler e Inpainting Video.",
    essential: true,
    type: "git",
    repo: "https://github.com/Lightricks/ComfyUI-LTXVideo",
    commit: "44c8a36b7c31ee00b4271daed11dc2a4aa481140",
    targetRel: "custom_nodes/ComfyUI-LTXVideo",
    usedBy: ["video", "video-t2v", "camera-copy", "dub", "genjutsu", "mixed-media", "reframe", "sdr-hdr", "talking", "speak"],
  },
  {
    id: "comfyui-crossviewwarp",
    name: "ComfyUI-CrossViewWarp",
    description: "Nodo geometrico 3D CrossViewWarp per riprese multi-angolo e Reshoot cinematografico con profondità MoGe.",
    essential: true,
    type: "git",
    repo: "https://github.com/comfyrob/ComfyUI-CrossViewWarp",
    commit: "fbb1e93c7193329ff3ce7c17f95166b539687876",
    targetRel: "custom_nodes/ComfyUI-CrossViewWarp",
    usedBy: ["reshoot"],
  },
  {
    id: "comfyui-reactor",
    name: "ComfyUI-ReActor (Face Swap & Restore)",
    description: "Motore neurale InsightFace + GFPGAN / CodeFormer / GPEN per Face Swap fotorealistico e preservazione identità in Character Studio.",
    essential: true,
    type: "git",
    repo: "https://github.com/Gourieff/comfyui-reactor-node",
    commit: "0763f707e3f791323f2e7450d100a25860df546c",
    targetRel: "custom_nodes/ComfyUI-ReActor",
    altTargetRel: "custom_nodes/comfyui-reactor-node",
    usedBy: ["face-swap", "character-studio", "fashion-factory"],
  },
  {
    id: "comfyui-kjnodes",
    name: "ComfyUI-KJNodes",
    description: "Suite di nodi di utilità per maschere, ridimensionamento immagini, condizionamento e gestione matematica nei workflow.",
    essential: true,
    type: "git",
    repo: "https://github.com/kijai/ComfyUI-KJNodes",
    targetRel: "custom_nodes/ComfyUI-KJNodes",
    usedBy: ["inpaint", "expand-image", "recast", "effects"],
  },
  {
    id: "comfyui-vhs",
    name: "ComfyUI-VideoHelperSuite (VHS)",
    description: "Nodi avanzati per il caricamento, lo slicing, l'unione audio/video e l'esportazione di clip nei workflow video.",
    essential: true,
    type: "git",
    repo: "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite",
    targetRel: "custom_nodes/ComfyUI-VideoHelperSuite",
    usedBy: ["video", "h3-video", "upscale-video", "motion-transfer"],
  },
  {
    id: "comfyui-qwenmultiangle",
    name: "ComfyUI-qwenmultiangle",
    description: "Nodo 3D interattivo per controllo angolazione camera (azimut, elevazione, zoom) per Qwen Multiangle Camera.",
    essential: true,
    type: "git",
    repo: "https://github.com/jtydhr88/ComfyUI-qwenmultiangle",
    commit: "bf8d032a36f1b78296568cda939418b88f0950b3",
    targetRel: "custom_nodes/ComfyUI-qwenmultiangle",
    usedBy: ["qwen-multiangle"],
  },
  {
    id: "comfyui-manager",
    name: "ComfyUI-Manager",
    description: "Gestore ufficiale dei pacchetti e dei nodi per ComfyUI.",
    essential: false,
    type: "git",
    repo: "https://github.com/ltdrdata/ComfyUI-Manager",
    targetRel: "custom_nodes/ComfyUI-Manager",
    usedBy: [],
  },
  {
    id: "backend-deps",
    name: "Wox Gateway & Comfy API Proxy",
    description: "Dipendenze Python essenziali per Wox Cinema Studio Pro (comfy-api-proxy, huggingface_hub[hf-xet], aiohttp) e configurazione extra_model_paths.yaml.",
    essential: true,
    type: "backend_deps",
    targetRel: "extra_model_paths.yaml",
    usedBy: ["all"],
  },
];

const PACK_META: Record<string, { title: string; description: string; essential: boolean }> = {
  "image-krea2": {
    title: "Cinema Studio Image · Krea 2 Turbo",
    description: "Modelli principali per Cinema Studio (Immagine), Style Reference e Stili artistici Krea 2.",
    essential: true,
  },
  "video-h3": {
    title: "Cinema Studio Video & Director · MiniMax H3",
    description: "Modello video principale con audio sincronizzato per Cinema Studio Video, Director, Create Video, Extend e Reshoot.",
    essential: true,
  },
  "image": {
    title: "Create Image · Z-Image Turbo",
    description: "Generazione immagini ultraveloce (Z-Image Turbo + Qwen 3 4B + VAE).",
    essential: true,
  },
  "image-qwen-edit": {
    title: "Character Studio, Edit & Relight · Qwen-Image-Edit 2509",
    description: "Editing fotografico, preservazione personaggio/vestiti (Character Studio), Relight, Angles, Shots e Zooms.",
    essential: true,
  },
  "upscale": {
    title: "Upscale, Remove BG, Depth & Smooth · SeedVR2 + BiRefNet + MoGe",
    description: "Super-risoluzione video/foto SeedVR2 3B, rimozione sfondo BiRefNet, mappa profondità MoGe e frame interpolation FILM.",
    essential: true,
  },
  "audio": {
    title: "Audio Studio · MiniMax Music 3 & Stable Audio 3",
    description: "Generazione brani musicali cantati con testo (MiniMax Music 3) ed effetti sonori cinematografici (Stable Audio 3).",
    essential: true,
  },
  "reactor-face": {
    title: "Face Swap & Restoration · InsightFace + GFPGAN + CodeFormer",
    description: "Modelli neurali per lo scambio del volto (inswapper_128) e il restauro estetico del viso (GFPGAN v1.4, CodeFormer, GPEN).",
    essential: true,
  },
  "image-flux3": {
    title: "FLUX 3 Image Klein · 58+ App & Template Fotografici",
    description: "Motore FLUX 3 Image Klein per oltre 50 app di ritratti, poster, product shot, fumetti e template creativi.",
    essential: false,
  },
  "video-ltx25": {
    title: "LTX-2.5 22B Video & IC-LoRAs · VFX, Dub, Talking, Camera",
    description: "Suite completa LTX-2.5 22B con 12+ IC-LoRA (Clean Plate, Day-to-Night, Water VFX, Dubbing, Talking Head, Cameraman).",
    essential: false,
  },
  "video-wan": {
    title: "Motion Transfer · Wan Animate 2",
    description: "Trasferisce il movimento e la recitazione di un video guida su qualsiasi personaggio (Motion Transfer).",
    essential: false,
  },
  "video-wan-camera": {
    title: "Camera Moves · Wan 2.2 Fun Camera 14B",
    description: "Controllo dedicato dei movimenti di macchina cinematografici su immagini statiche.",
    essential: false,
  },
  "video-wan-effects": {
    title: "VFX & Bullet Time · Wan 2.1 I2V 14B + 24 LoRA",
    description: "24 effetti speciali video e Bullet Time 360° con Wan 2.1 14B.",
    essential: false,
  },
  "video-scail": {
    title: "Recast Actor · SCAIL-2 + SAM 3.1",
    description: "Sostituisce l'attore all'interno di un video esistente mantenendo scena e illuminazione (Recast).",
    essential: false,
  },
  "image-moss": {
    title: "MOSS-Image · Layout & Design",
    description: "Generazione immagini con controllo spaziale e tipografico preciso.",
    essential: false,
  },
};

const REACTOR_MODELS: ModelDef[] = [
  {
    repo: "ezioruan/inswapper_128.onnx",
    file: "inswapper_128.onnx",
    dir: "insightface",
    name: "inswapper_128.onnx",
    gb: 0.53,
    gated: false,
    license: "InsightFace",
    used_by: ["face-swap", "character-studio", "fashion-factory"],
  },
  {
    repo: "TencentARC/GFPGAN",
    file: "GFPGANv1.4.pth",
    dir: "facerestore_models",
    name: "GFPGANv1.4.pth",
    gb: 0.35,
    gated: false,
    license: "Apache-2.0",
    used_by: ["face-swap", "character-studio"],
    directUrl: "https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.4.pth",
  },
  {
    repo: "sczhou/CodeFormer",
    file: "codeformer-v0.1.0.pth",
    dir: "facerestore_models",
    name: "codeformer-v0.1.0.pth",
    gb: 0.38,
    gated: false,
    license: "S-Lab-1.0",
    used_by: ["face-swap"],
    directUrl: "https://github.com/sczhou/CodeFormer/releases/download/v0.1.0/codeformer.pth",
  },
];

// Known local compatibility aliases so existing downloaded weights satisfy updated pack filenames
const MODEL_ALIASES: Record<string, string[]> = {
  "diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors": ["diffusion_models/qwen_image_edit_fp8_e4m3fn.safetensors"],
  "diffusion_models/z_image_turbo_int8_convrot.safetensors": ["diffusion_models/z-image-turbo-fp8-e4m3fn.safetensors"],
  "loras/Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors": ["loras/Qwen-Image-Edit-Lightning-4steps-V1.0-bf16.safetensors"],
  "loras/minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors": ["loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors"],
  "text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors": ["text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"],
  "text_encoders/qwen_3_4b_fp8_mixed.safetensors": ["text_encoders/qwen_3_4b.safetensors"],
  "vae/minimax_h3_video_vae_int8_convrot.safetensors": ["vae/minimax_h3_video_vae_fp16.safetensors"],
};

const MODEL_DIRS = [
  "diffusion_models", "text_encoders", "vae", "loras", "checkpoints", "clip_vision",
  "latent_upscale_models", "upscale_models", "model_patches", "geometry_estimation",
  "background_removal", "frame_interpolation", "audio_encoders", "embeddings", "detection",
  "insightface", "facerestore_models",
];

export function comfyDirCandidates(
  root: string,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const pathMod = platform === "win32" ? win32 : posix;
  const raw = [
    env.COMFYUI_DIR ? pathMod.resolve(env.COMFYUI_DIR) : "",
    pathMod.join(home, "opt", "ComfyUI"),
    pathMod.join(home, "ComfyUI"),
    pathMod.resolve(root, "..", "ComfyUI"),
    ...(platform === "win32"
      ? [
          pathMod.join(home, "Documents", "ComfyUI"),
          pathMod.join(home, "Desktop", "ComfyUI"),
          pathMod.resolve(root, "..", "ComfyUI_windows_portable", "ComfyUI"),
          pathMod.join(home, "ComfyUI_windows_portable", "ComfyUI"),
          "C:\\ComfyUI",
          "D:\\ComfyUI",
          "C:\\ComfyUI_windows_portable\\ComfyUI",
          "D:\\ComfyUI_windows_portable\\ComfyUI",
          env.LOCALAPPDATA ? pathMod.join(env.LOCALAPPDATA, "Programs", "@comfyorgcomfyui-electron", "resources", "ComfyUI") : "",
        ]
      : ["/home/wox76/opt/ComfyUI", "/opt/ComfyUI"]),
  ];
  return [...new Set(raw.filter(Boolean))];
}

export function pythonCandidates(
  comfyDir: string,
  root: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const isWin = platform === "win32";
  const pathMod = isWin ? win32 : posix;
  const raw = [
    env.PYTHON_BIN || "",
    env.COMFY_PYTHON || "",
    isWin ? pathMod.join(comfyDir, "venv", "Scripts", "python.exe") : pathMod.join(comfyDir, "venv", "bin", "python"),
    isWin ? pathMod.join(comfyDir, ".venv", "Scripts", "python.exe") : pathMod.join(comfyDir, ".venv", "bin", "python"),
    ...(isWin
      ? [
          pathMod.resolve(comfyDir, "..", "python_embeded", "python.exe"),
          pathMod.resolve(comfyDir, "..", "python_embedded", "python.exe"),
          pathMod.join(comfyDir, "python_embeded", "python.exe"),
          pathMod.join(comfyDir, "python_embedded", "python.exe"),
          pathMod.join(root, "venv", "Scripts", "python.exe"),
          pathMod.join(root, ".venv", "Scripts", "python.exe"),
        ]
      : [
          pathMod.join(root, "venv", "bin", "python"),
          pathMod.join(root, ".venv", "bin", "python"),
        ]),
  ];
  return [...new Set(raw.filter(Boolean))];
}

export function proxyBinaryCandidates(
  comfyDir: string,
  pythonBin?: string,
  platform: NodeJS.Platform = process.platform
): string[] {
  const isWin = platform === "win32";
  const pathMod = isWin ? win32 : posix;
  const exe = isWin ? "comfy-api-proxy.exe" : "comfy-api-proxy";
  const raw = [
    ...(pythonBin && (pythonBin.includes("/") || pythonBin.includes("\\"))
      ? [
          pathMod.join(pathMod.dirname(pythonBin), exe),
          pathMod.join(pathMod.dirname(pythonBin), "Scripts", exe),
        ]
      : []),
    isWin ? pathMod.join(comfyDir, "venv", "Scripts", exe) : pathMod.join(comfyDir, "venv", "bin", exe),
    isWin ? pathMod.join(comfyDir, ".venv", "Scripts", exe) : pathMod.join(comfyDir, ".venv", "bin", exe),
    ...(isWin
      ? [
          pathMod.resolve(comfyDir, "..", "python_embeded", "Scripts", exe),
          pathMod.resolve(comfyDir, "..", "python_embedded", "Scripts", exe),
          pathMod.join(comfyDir, "python_embeded", "Scripts", exe),
          pathMod.join(comfyDir, "python_embedded", "Scripts", exe),
        ]
      : []),
  ];
  return [...new Set(raw.filter(Boolean))];
}

export function createModelAliasLink(altPath: string, targetPath: string): boolean {
  try {
    // Remove dangling symlink if present so symlink/hardlink creation does not fail with EEXIST
    if (!existsSync(targetPath)) {
      try {
        lstatSync(targetPath);
        unlinkSync(targetPath);
      } catch {
        // does not exist
      }
    }
    if (existsSync(targetPath)) return true;
    mkdirSync(dirname(targetPath), { recursive: true });
    try {
      symlinkSync(altPath, targetPath);
      return true;
    } catch {
      // On Windows without Developer Mode / Admin, symlinkSync throws EPERM; hard link works on NTFS
      linkSync(altPath, targetPath);
      return true;
    }
  } catch {
    return false;
  }
}

export function buildExtraModelPathsYaml(modelsDir: string): string {
  const yamlLines = ["wox_studio:", `  base_path: ${modelsDir.replace(/\\/g, "/")}`];
  for (const d of MODEL_DIRS) yamlLines.push(`  ${d}: ${d}`);
  return yamlLines.join("\n") + "\n";
}

function isWorkingPython(bin: string): boolean {
  try {
    const res = spawnSync(bin, ["--version"], { timeout: 3000, encoding: "utf-8" });
    return res.status === 0 && /Python 3\./i.test(`${res.stdout || ""}${res.stderr || ""}`);
  } catch {
    return false;
  }
}

export class InstallerManager {
  private root: string;
  private customComfyDir: string | null = null;
  private customModelsDir: string | null = null;
  private activeTask: InstallerTask | null = null;
  private activeProc: ChildProcess | null = null;
  private cancelRequested = false;

  constructor(root: string) {
    this.root = root;
    this.loadSavedSettings();
  }

  private settingsFile(): string {
    return join(this.root, "out", "settings.json");
  }

  private loadSavedSettings() {
    try {
      const f = this.settingsFile();
      if (existsSync(f)) {
        const data = JSON.parse(readFileSync(f, "utf-8"));
        if (typeof data.comfyDir === "string" && data.comfyDir.trim()) this.customComfyDir = resolve(data.comfyDir.trim());
        if (typeof data.modelsDir === "string" && data.modelsDir.trim()) this.customModelsDir = resolve(data.modelsDir.trim());
      }
    } catch {
      // ignore
    }
  }

  private saveSettingsFile(patch: Record<string, unknown>) {
    try {
      const f = this.settingsFile();
      mkdirSync(dirname(f), { recursive: true });
      const prev = existsSync(f) ? JSON.parse(readFileSync(f, "utf-8")) : {};
      writeFileSync(f, JSON.stringify({ ...prev, ...patch }, null, 2) + "\n", "utf-8");
    } catch {
      // ignore
    }
  }

  detectComfyDir(): string {
    if (this.customComfyDir) return this.customComfyDir;
    const candidates = comfyDirCandidates(this.root);
    for (const c of candidates) {
      if (existsSync(join(c, "main.py"))) return c;
    }
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
    return process.platform === "win32" ? join(homedir(), "ComfyUI") : join(homedir(), "opt", "ComfyUI");
  }

  detectModelsDir(comfyDir = this.detectComfyDir()): string {
    if (this.customModelsDir) return this.customModelsDir;
    if (process.env.COMFYUI_MODELS_DIR && existsSync(process.env.COMFYUI_MODELS_DIR)) {
      return resolve(process.env.COMFYUI_MODELS_DIR);
    }
    return join(comfyDir, "models");
  }

  detectPython(comfyDir = this.detectComfyDir()): string {
    for (const py of pythonCandidates(comfyDir, this.root)) {
      if (existsSync(py)) return py;
    }
    const sysFallbacks = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
    for (const bin of sysFallbacks) {
      if (isWorkingPython(bin)) return bin;
    }
    return process.platform === "win32" ? "python" : "python3";
  }

  getHfToken(): string | null {
    if (process.env.HF_TOKEN) return process.env.HF_TOKEN.trim();
    const envPath = join(this.root, ".env");
    if (existsSync(envPath)) {
      const m = /^HF_TOKEN\s*=\s*(\S+)\s*$/m.exec(readFileSync(envPath, "utf-8"));
      if (m?.[1]) return m[1].trim();
    }
    const hfHome = process.env.HF_HOME || join(homedir(), ".cache", "huggingface");
    const tokFile = join(hfHome, "token");
    if (existsSync(tokFile)) {
      const t = readFileSync(tokFile, "utf-8").trim();
      if (t) return t;
    }
    return null;
  }

  setHfToken(token: string) {
    const clean = token.trim();
    process.env.HF_TOKEN = clean;
    // Save to ~/.cache/huggingface/token
    try {
      const hfHome = process.env.HF_HOME || join(homedir(), ".cache", "huggingface");
      mkdirSync(hfHome, { recursive: true });
      writeFileSync(join(hfHome, "token"), clean, "utf-8");
    } catch {
      // ignore
    }
    // Save to .env
    this.updateEnvFile("HF_TOKEN", clean);
  }

  updateEnvFile(key: string, value: string) {
    const envPath = join(this.root, ".env");
    let content = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
    const re = new RegExp(`^\\s*#?\\s*${key}\\s*=.*$`, "m");
    if (re.test(content)) {
      content = content.replace(re, `${key}=${value}`);
    } else {
      if (content && !content.endsWith("\n")) content += "\n";
      content += `${key}=${value}\n`;
    }
    writeFileSync(envPath, content, "utf-8");
  }

  updateSettings(body: { comfy_dir?: string; models_dir?: string; hf_token?: string; drafts?: boolean }) {
    if (typeof body.comfy_dir === "string" && body.comfy_dir.trim()) {
      this.customComfyDir = resolve(body.comfy_dir.trim());
      this.saveSettingsFile({ comfyDir: this.customComfyDir });
    }
    if (typeof body.models_dir === "string" && body.models_dir.trim()) {
      this.customModelsDir = resolve(body.models_dir.trim());
      this.saveSettingsFile({ modelsDir: this.customModelsDir });
    }
    if (typeof body.hf_token === "string") {
      this.setHfToken(body.hf_token);
    }
    if (typeof body.drafts === "boolean") {
      const val = body.drafts ? "1" : "0";
      process.env.WOX_DRAFTS = val;
      process.env.FREEFIELD_DRAFTS = val;
      this.updateEnvFile("FREEFIELD_DRAFTS", val);
    }
  }

  isNodeInstalled(node: CustomNodeDef, comfyDir: string): boolean {
    if (node.type === "backend_deps") {
      const yamlOk = existsSync(join(comfyDir, "extra_model_paths.yaml"));
      const pyBin = this.detectPython(comfyDir);
      const proxyOk = proxyBinaryCandidates(comfyDir, pyBin).some((p) => existsSync(p));
      return yamlOk && proxyOk;
    }
    const nonEmpty = (p: string): boolean => {
      try {
        if (!existsSync(p)) return false;
        const st = statSync(p);
        return st.isDirectory() ? readdirSync(p).length > 0 : st.size > 0;
      } catch {
        return false;
      }
    };
    if (nonEmpty(join(comfyDir, node.targetRel))) return true;
    if (node.altTargetRel && nonEmpty(join(comfyDir, node.altTargetRel))) return true;
    return false;
  }

  isModelInstalled(modelsDir: string, dir: string, name: string): boolean {
    const p = join(modelsDir, dir, name);
    try {
      if (existsSync(p) && statSync(p).size > 0) return true;
    } catch {
      // broken symlink or permission error
    }
    const key = `${dir}/${name}`;
    for (const alt of MODEL_ALIASES[key] || []) {
      const altPath = join(modelsDir, alt);
      try {
        if (existsSync(altPath) && statSync(altPath).size > 0) return true;
      } catch {
        // ignore
      }
    }
    return false;
  }

  ensureAliasSymlinks(modelsDir: string): number {
    let created = 0;
    for (const [targetRel, alts] of Object.entries(MODEL_ALIASES)) {
      const targetPath = join(modelsDir, targetRel);
      if (existsSync(targetPath)) continue;
      for (const altRel of alts) {
        const altPath = join(modelsDir, altRel);
        try {
          if (existsSync(altPath) && statSync(altPath).size > 0) {
            if (createModelAliasLink(altPath, targetPath)) {
              created++;
              break;
            }
          }
        } catch {
          // ignore
        }
      }
    }
    return created;
  }

  loadPacksStatus(modelsDir: string): PackStatus[] {
    this.ensureAliasSymlinks(modelsDir);
    const packsDir = join(this.root, "packs");
    const files = existsSync(packsDir)
      ? readdirSync(packsDir).filter((f) => f.endsWith(".json") && f !== "index.json").sort()
      : [];

    const out: PackStatus[] = [];

    for (const f of files) {
      const raw = JSON.parse(readFileSync(join(packsDir, f), "utf-8"));
      const id = raw.pack as string;
      if (id === "core") continue;
      const meta = PACK_META[id] || {
        title: id,
        description: `Pack modelli ${id}`,
        essential: false,
      };
      const models: (ModelDef & { installed: boolean })[] = (raw.models || []).map((m: any) => {
        const name = m.name || m.file.split("/").pop();
        return {
          repo: m.repo,
          file: m.file,
          dir: m.dir,
          name,
          gb: Number(m.gb || 0),
          gated: Boolean(m.gated),
          license: m.license ?? null,
          used_by: m.used_by || [],
          installed: this.isModelInstalled(modelsDir, m.dir, name),
        };
      });
      const installedCount = models.filter((m) => m.installed).length;
      const missingGb = +models.filter((m) => !m.installed).reduce((s, m) => s + m.gb, 0).toFixed(2);
      const totalGb = +models.reduce((s, m) => s + m.gb, 0).toFixed(2);

      out.push({
        id,
        title: meta.title,
        description: meta.description,
        essential: meta.essential,
        apps: raw.apps || [],
        download_gb: totalGb,
        missing_gb: missingGb,
        needs_hf_token: Boolean(raw.needs_hf_token),
        installed_count: installedCount,
        total_count: models.length,
        installed: installedCount === models.length,
        models,
      });
    }

    // Add ReActor Face Swap & Restore Pack
    const reactorMeta = PACK_META["reactor-face"];
    const reactorModels = REACTOR_MODELS.map((m) => ({
      ...m,
      installed: this.isModelInstalled(modelsDir, m.dir, m.name),
    }));
    const rInstalled = reactorModels.filter((m) => m.installed).length;
    const rMissingGb = +reactorModels.filter((m) => !m.installed).reduce((s, m) => s + m.gb, 0).toFixed(2);
    const rTotalGb = +reactorModels.reduce((s, m) => s + m.gb, 0).toFixed(2);
    out.push({
      id: "reactor-face",
      title: reactorMeta.title,
      description: reactorMeta.description,
      essential: true,
      apps: ["face-swap", "character-studio", "fashion-factory"],
      download_gb: rTotalGb,
      missing_gb: rMissingGb,
      needs_hf_token: false,
      installed_count: rInstalled,
      total_count: reactorModels.length,
      installed: rInstalled === reactorModels.length,
      models: reactorModels,
    });

    // Sort: essential packs first, then alphabetical
    out.sort((a, b) => Number(b.essential) - Number(a.essential) || a.id.localeCompare(b.id));
    return out;
  }

  getStatus() {
    const comfyDir = this.detectComfyDir();
    const modelsDir = this.detectModelsDir(comfyDir);
    const pythonBin = this.detectPython(comfyDir);
    const comfyExists = existsSync(join(comfyDir, "main.py"));
    const hfToken = this.getHfToken();

    const nodes = CUSTOM_NODES.map((n) => ({
      ...n,
      installed: this.isNodeInstalled(n, comfyDir),
    }));

    const packs = this.loadPacksStatus(modelsDir);

    // Deduplicate models across packs for accurate global totals
    const uniqueModels = new Map<string, { gb: number; installed: boolean; essential: boolean }>();
    for (const p of packs) {
      for (const m of p.models) {
        const key = `${m.dir}/${m.name}`;
        const prev = uniqueModels.get(key);
        uniqueModels.set(key, {
          gb: m.gb,
          installed: m.installed,
          essential: (prev?.essential ?? false) || p.essential,
        });
      }
    }

    let totalModels = 0, installedModels = 0, totalGb = 0, installedGb = 0;
    let essentialTotal = 0, essentialInstalled = 0, essentialMissingGb = 0;
    for (const m of uniqueModels.values()) {
      totalModels++;
      totalGb += m.gb;
      if (m.installed) {
        installedModels++;
        installedGb += m.gb;
      }
      if (m.essential) {
        essentialTotal++;
        if (m.installed) essentialInstalled++;
        else essentialMissingGb += m.gb;
      }
    }

    const installedNodes = nodes.filter((n) => n.installed).length;

    return {
      comfy_dir: comfyDir,
      comfy_exists: comfyExists,
      models_dir: modelsDir,
      python_bin: pythonBin,
      hf_token_configured: Boolean(hfToken),
      hf_token_preview: hfToken ? `${hfToken.slice(0, 6)}…${hfToken.slice(-4)}` : null,
      drafts_allowed: process.env.WOX_DRAFTS === "1" || process.env.FREEFIELD_DRAFTS === "1",
      summary: {
        nodes_installed: installedNodes,
        nodes_total: nodes.length,
        nodes_ready: installedNodes === nodes.length,
        essential_models_installed: essentialInstalled,
        essential_models_total: essentialTotal,
        essential_missing_gb: +essentialMissingGb.toFixed(2),
        all_models_installed: installedModels,
        all_models_total: totalModels,
        all_installed_gb: +installedGb.toFixed(1),
        all_total_gb: +totalGb.toFixed(1),
        all_missing_gb: +Math.max(0, totalGb - installedGb).toFixed(1),
      },
      nodes,
      packs,
      task: this.activeTask,
    };
  }

  private log(line: string) {
    if (!this.activeTask) return;
    const clean = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trimEnd();
    if (!clean) return;
    this.activeTask.logs.push(clean);
    if (this.activeTask.logs.length > 350) {
      this.activeTask.logs.splice(0, this.activeTask.logs.length - 350);
    }
  }

  private runCmd(cmd: string, args: string[], cwd?: string, env?: NodeJS.ProcessEnv): Promise<void> {
    return new Promise((resolvePromise, rejectPromise) => {
      if (this.cancelRequested) return rejectPromise(new Error("Operazione annullata dall'utente"));
      this.log(`$ ${cmd} ${args.join(" ")}`);
      const proc = spawn(cmd, args, {
        cwd: cwd && existsSync(cwd) ? cwd : this.root,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1",
          PYTHONUTF8: "1",
          PYTHONIOENCODING: "utf-8",
          HF_HUB_DISABLE_TELEMETRY: "1",
          ...env,
        },
      });
      this.activeProc = proc;

      const onData = (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        for (const rawLine of text.split(/[\r\n]+/)) {
          if (rawLine.trim()) this.log(rawLine);
        }
      };

      proc.stdout?.on("data", onData);
      proc.stderr?.on("data", onData);

      proc.on("error", (err) => {
        this.activeProc = null;
        rejectPromise(err);
      });
      proc.on("close", (code) => {
        this.activeProc = null;
        if (this.cancelRequested) {
          rejectPromise(new Error("Operazione annullata dall'utente"));
        } else if (code === 0) {
          resolvePromise();
        } else {
          rejectPromise(new Error(`Comando terminato con codice ${code}`));
        }
      });
    });
  }

  cancelTask() {
    if (this.activeTask && this.activeTask.status === "running") {
      this.cancelRequested = true;
      this.log("⚠️ Interruzione richiesta dall'utente...");
      try {
        if (process.platform === "win32" && this.activeProc?.pid) {
          spawn("taskkill", ["/pid", String(this.activeProc.pid), "/T", "/F"], { stdio: "ignore" });
        } else {
          this.activeProc?.kill("SIGTERM");
        }
      } catch {
        // ignore
      }
      this.activeTask.status = "canceled";
      this.activeTask.finishedAt = Date.now();
      return true;
    }
    return false;
  }

  private async pipInstall(pythonBin: string, args: string[], cwd?: string) {
    await this.runCmd(pythonBin, ["-m", "pip", "install", "--no-warn-script-location", ...args], cwd);
  }

  private async ensureHfHub(pythonBin: string) {
    const check = spawnSync(pythonBin, ["-c", "import huggingface_hub"], { timeout: 10000 });
    if (check.status === 0) return;
    this.log("Installazione huggingface_hub per il download dei modelli...");
    try {
      await this.pipInstall(pythonBin, ["huggingface_hub[hf-xet]"]);
    } catch {
      await this.pipInstall(pythonBin, ["huggingface_hub"]);
    }
  }

  private async installSingleNode(node: CustomNodeDef, comfyDir: string, modelsDir: string, pythonBin: string) {
    this.log(`▶ Configurazione nodo: ${node.name}...`);
    mkdirSync(join(comfyDir, "custom_nodes"), { recursive: true });

    if (node.type === "bundled_dir" && node.sourceRel) {
      const src = join(this.root, node.sourceRel);
      const dst = join(comfyDir, node.targetRel);
      if (existsSync(src)) {
        mkdirSync(dst, { recursive: true });
        cpSync(src, dst, { recursive: true, force: true });
        this.log(`✓ Copiato ${node.name} in ${dst}`);
      } else if (existsSync(dst)) {
        this.log(`✓ ${node.name} già presente in ${dst}`);
      } else {
        throw new Error(`Sorgente non trovata: ${src}`);
      }
      const req = join(dst, "requirements.txt");
      if (existsSync(req)) {
        await this.pipInstall(pythonBin, ["-q", "-r", req], dst);
      }
      return;
    }

    if (node.type === "bundled_file" && node.sourceRel) {
      const src = join(this.root, node.sourceRel);
      const dst = join(comfyDir, node.targetRel);
      if (existsSync(src)) {
        mkdirSync(dirname(dst), { recursive: true });
        cpSync(src, dst, { force: true });
        this.log(`✓ Installato ${node.name} in ${dst}`);
      } else if (existsSync(dst)) {
        this.log(`✓ ${node.name} già presente in ${dst}`);
      } else {
        throw new Error(`File sorgente non trovato: ${src}`);
      }
      return;
    }

    if (node.type === "git" && node.repo) {
      let dst = join(comfyDir, node.targetRel);
      if (!existsSync(dst) && node.altTargetRel && existsSync(join(comfyDir, node.altTargetRel))) {
        dst = join(comfyDir, node.altTargetRel);
      }
      if (existsSync(dst) && !existsSync(join(dst, ".git"))) {
        if (readdirSync(dst).length === 0) {
          rmSync(dst, { recursive: true, force: true });
        } else {
          this.log(`! Directory ${dst} già presente senza .git, salto clone`);
          const req = join(dst, "requirements.txt");
          if (existsSync(req)) {
            this.log(`Installazione requirements.txt per ${node.name}...`);
            await this.pipInstall(pythonBin, ["-r", req], dst);
          }
          this.log(`✓ Nodo ${node.name} pronto.`);
          return;
        }
      }
      if (!existsSync(join(dst, ".git"))) {
        this.log(`Clonazione repository ${node.repo}...`);
        await this.runCmd("git", ["clone", node.repo, dst]);
      } else {
        this.log(`Repository ${node.name} già clonato in ${dst}`);
      }
      if (node.commit) {
        try {
          await this.runCmd("git", ["fetch", "--all", "--quiet"], dst);
          await this.runCmd("git", ["checkout", "--quiet", node.commit], dst);
          this.log(`✓ Checkout commit verificato ${node.commit.slice(0, 7)}`);
        } catch {
          this.log(`! Mantengo la versione corrente di ${node.name}`);
        }
      }
      const req = join(dst, "requirements.txt");
      if (existsSync(req)) {
        this.log(`Installazione requirements.txt per ${node.name}...`);
        await this.pipInstall(pythonBin, ["-r", req], dst);
      }
      this.log(`✓ Nodo ${node.name} pronto.`);
      return;
    }

    if (node.type === "backend_deps") {
      this.log("Installazione comfy-api-proxy, aiohttp e huggingface_hub[hf-xet]...");
      try {
        await this.pipInstall(pythonBin, ["comfy-api-proxy==0.1.6", "aiohttp", "huggingface_hub[hf-xet]"]);
      } catch {
        this.log("! Fallback installazione senza hf-xet...");
        await this.pipInstall(pythonBin, ["comfy-api-proxy==0.1.6", "aiohttp", "huggingface_hub"]);
      }
      const yamlPath = join(comfyDir, "extra_model_paths.yaml");
      writeFileSync(yamlPath, buildExtraModelPathsYaml(modelsDir), "utf-8");
      this.log(`✓ Scritto ${yamlPath}`);
      return;
    }
  }

  private async downloadSingleModel(model: ModelDef, modelsDir: string, pythonBin: string) {
    const dest = join(modelsDir, model.dir, model.name);
    if (this.isModelInstalled(modelsDir, model.dir, model.name)) {
      this.log(`✓ Modello già presente: ${model.dir}/${model.name}`);
      return;
    }
    mkdirSync(dirname(dest), { recursive: true });
    this.log(`↓ Download ${model.dir}/${model.name} (${model.gb} GB) da ${model.repo}...`);

    const hfToken = this.getHfToken();
    if (model.directUrl) {
      const pyScript = `
import os, sys, urllib.request
url, dest = sys.argv[1], sys.argv[2]
tmp = dest + ".part"
print(f"Scaricamento da {url}...", flush=True)
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
    total = int(r.headers.get("Content-Length") or 0)
    done = 0
    last_pct = -10
    while True:
        chunk = r.read(1024 * 1024)
        if not chunk:
            break
        f.write(chunk)
        done += len(chunk)
        if total > 0:
            pct = int(done * 100 / total)
            if pct >= last_pct + 10:
                last_pct = pct
                print(f"  {pct}% ({done // (1024*1024)} / {total // (1024*1024)} MB)", flush=True)
os.replace(tmp, dest)
print("Completato:", dest, flush=True)
`;
      await this.runCmd(pythonBin, ["-c", pyScript, model.directUrl, dest]);
      this.log(`✓ Scaricato ${model.dir}/${model.name}`);
      return;
    }

    const pyScript = `
import os, shutil, sys
from pathlib import Path
from huggingface_hub import hf_hub_download

repo, file_in_repo, dest_str = sys.argv[1], sys.argv[2], sys.argv[3]
token = os.environ.get("HF_TOKEN") or None
dest = Path(dest_str)
tmp_dir = dest.parent.parent / ".incoming" / repo.replace("/", "__")
tmp_dir.mkdir(parents=True, exist_ok=True)
path = hf_hub_download(repo_id=repo, filename=file_in_repo, local_dir=str(tmp_dir), token=token)
dest.parent.mkdir(parents=True, exist_ok=True)
shutil.move(path, str(dest))
shutil.rmtree(str(tmp_dir), ignore_errors=True)
if not dest.exists() or dest.stat().st_size == 0:
    raise RuntimeError(f"File scaricato non valido: {dest}")
print(f"✓ Salvato in {dest}", flush=True)
`;
    await this.runCmd(
      pythonBin,
      ["-c", pyScript, model.repo, model.file, dest],
      this.root,
      hfToken ? { HF_TOKEN: hfToken } : undefined
    );
  }

  startJob(opts: {
    action: "install_all_starter" | "install_all_everything" | "install_nodes" | "download_packs" | "download_model";
    nodes?: string[];
    packs?: string[];
    model?: ModelDef;
  }): InstallerTask {
    if (this.activeTask && this.activeTask.status === "running") {
      throw new Error("Un'operazione di installazione è già in corso.");
    }

    const comfyDir = this.detectComfyDir();
    const modelsDir = this.detectModelsDir(comfyDir);
    let pythonBin = this.detectPython(comfyDir);

    const titles: Record<string, string> = {
      install_all_starter: "Auto-Install Wox Cinema Studio [PRO] (Nodi + Modelli Core)",
      install_all_everything: "Auto-Install Completo (Tutti i Nodi + Tutti i Pack Modelli)",
      install_nodes: "Installazione & Verifica Nodi ComfyUI",
      download_packs: `Download Pack Modelli (${(opts.packs || []).join(", ")})`,
      download_model: `Download Modello ${opts.model?.name || ""}`,
    };

    this.cancelRequested = false;
    const task: InstallerTask = {
      id: `inst_${Date.now()}`,
      title: titles[opts.action] || "Auto-Installer Wox Cinema Studio Pro",
      status: "running",
      startedAt: Date.now(),
      finishedAt: null,
      currentStep: "Inizializzazione...",
      currentIndex: 0,
      totalSteps: 1,
      percent: 0,
      logs: [],
      error: null,
    };
    this.activeTask = task;

    void (async () => {
      try {
        this.log(`=== ${task.title} ===`);
        this.log(`OS Platform  : ${process.platform} (${process.arch})`);
        this.log(`ComfyUI Path : ${comfyDir}`);
        this.log(`Models Path  : ${modelsDir}`);
        this.log(`Python Env   : ${pythonBin}`);

        // Verify git if needed
        const needComfyClone = !existsSync(join(comfyDir, "main.py"));
        if (needComfyClone || opts.action === "install_nodes" || opts.action === "install_all_starter" || opts.action === "install_all_everything") {
          const gitCheck = spawnSync("git", ["--version"], { timeout: 5000 });
          if (gitCheck.status !== 0) {
            throw new Error("Git non trovato nel PATH. Installa Git prima di eseguire l'Auto-Installer (https://git-scm.com).");
          }
        }

        // Ensure ComfyUI exists if missing
        if (needComfyClone) {
          task.currentStep = "Clonazione ComfyUI base...";
          this.log("ComfyUI non trovato: clonazione repository ufficiale ComfyUI...");
          mkdirSync(dirname(comfyDir), { recursive: true });
          await this.runCmd("git", ["clone", "https://github.com/Comfy-Org/ComfyUI.git", comfyDir]);

          // Create an isolated ComfyUI venv if no local venv/embedded Python exists
          const hasLocalPy = pythonCandidates(comfyDir, this.root).some((p) => p.startsWith(comfyDir) && existsSync(p));
          if (!hasLocalPy) {
            const venvDir = join(comfyDir, "venv");
            this.log(`Creazione virtualenv Python in ${venvDir}...`);
            await this.runCmd(pythonBin, ["-m", "venv", venvDir], comfyDir);
            pythonBin = this.detectPython(comfyDir);
            this.log(`✓ Virtualenv attivo: ${pythonBin}`);
          }
          await this.pipInstall(pythonBin, ["-r", join(comfyDir, "requirements.txt")], comfyDir);
        }

        // Determine nodes and models to process
        let nodesToInstall: CustomNodeDef[] = [];
        let modelsToDownload: ModelDef[] = [];

        if (opts.action === "install_nodes") {
          const wantedIds = opts.nodes && opts.nodes.length > 0 ? new Set(opts.nodes) : null;
          nodesToInstall = CUSTOM_NODES.filter((n) => (wantedIds ? wantedIds.has(n.id) : !this.isNodeInstalled(n, comfyDir)));
          if (nodesToInstall.length === 0) nodesToInstall = [...CUSTOM_NODES];
        } else if (opts.action === "install_all_starter" || opts.action === "install_all_everything") {
          nodesToInstall = CUSTOM_NODES.filter((n) => !this.isNodeInstalled(n, comfyDir));
          // Always ensure native Wox nodes & extra_model_paths are up-to-date
          for (const n of CUSTOM_NODES) {
            if ((n.type === "bundled_dir" || n.type === "bundled_file" || n.type === "backend_deps") && !nodesToInstall.includes(n)) {
              nodesToInstall.push(n);
            }
          }
          const allPacks = this.loadPacksStatus(modelsDir);
          const targetPacks = opts.action === "install_all_starter"
            ? allPacks.filter((p) => p.essential)
            : allPacks;
          const seen = new Set<string>();
          for (const p of targetPacks) {
            for (const m of p.models) {
              const key = `${m.dir}/${m.name}`;
              if (!m.installed && !seen.has(key)) {
                seen.add(key);
                modelsToDownload.push(m);
              }
            }
          }
        } else if (opts.action === "download_packs") {
          const allPacks = this.loadPacksStatus(modelsDir);
          const wanted = new Set(opts.packs || []);
          const targetPacks = wanted.has("all")
            ? allPacks
            : wanted.has("essential")
              ? allPacks.filter((p) => p.essential)
              : allPacks.filter((p) => wanted.has(p.id));
          const seen = new Set<string>();
          for (const p of targetPacks) {
            for (const m of p.models) {
              const key = `${m.dir}/${m.name}`;
              if (!m.installed && !seen.has(key)) {
                seen.add(key);
                modelsToDownload.push(m);
              }
            }
          }
        } else if (opts.action === "download_model" && opts.model) {
          modelsToDownload = [opts.model];
        }

        const totalSteps = Math.max(1, nodesToInstall.length + modelsToDownload.length);
        task.totalSteps = totalSteps;
        let step = 0;

        for (const node of nodesToInstall) {
          if (this.cancelRequested) throw new Error("Operazione annullata dall'utente");
          step++;
          task.currentIndex = step;
          task.currentStep = `Installazione nodo (${step}/${totalSteps}): ${node.name}`;
          task.percent = Math.round(((step - 1) / totalSteps) * 100);
          await this.installSingleNode(node, comfyDir, modelsDir, pythonBin);
        }

        const symlinks = this.ensureAliasSymlinks(modelsDir);
        if (symlinks > 0) {
          this.log(`✓ Creati ${symlinks} link di compatibilità modelli.`);
        }

        if (modelsToDownload.some((m) => !m.directUrl)) {
          await this.ensureHfHub(pythonBin);
        }

        const failedModels: string[] = [];
        for (const model of modelsToDownload) {
          if (this.cancelRequested) throw new Error("Operazione annullata dall'utente");
          step++;
          task.currentIndex = step;
          task.currentStep = `Download modello (${step}/${totalSteps}): ${model.name} (${model.gb} GB)`;
          task.percent = Math.round(((step - 1) / totalSteps) * 100);
          try {
            await this.downloadSingleModel(model, modelsDir, pythonBin);
          } catch (err) {
            const msg = (err as Error).message || String(err);
            failedModels.push(model.name);
            this.log(`✗ Errore download ${model.name}: ${msg}`);
            if (model.gated) {
              this.log(`  → Il repository ${model.repo} richiede di accettare la licenza su https://huggingface.co/${model.repo} e impostare HF_TOKEN nelle Opzioni.`);
            }
          }
        }

        task.percent = 100;
        task.finishedAt = Date.now();
        if (failedModels.length > 0) {
          task.status = "failed";
          task.error = `${failedModels.length} modelli non scaricati (${failedModels.slice(0, 3).join(", ")}). Verifica HF_TOKEN o la licenza su Hugging Face.`;
          task.currentStep = `Completato con ${failedModels.length} avvisi`;
          this.log(`! ${task.error}`);
        } else {
          task.status = "completed";
          task.currentStep = "Installazione completata con successo!";
          this.log("✓ Tutti i nodi e i modelli selezionati sono pronti!");
        }
      } catch (err) {
        if (task.status !== "canceled") {
          task.status = "failed";
          task.error = (err as Error).message || String(err);
          task.currentStep = `Errore: ${task.error}`;
          this.log(`✗ ERRORE: ${task.error}`);
        }
        task.finishedAt = Date.now();
      }
    })();

    return task;
  }
}
