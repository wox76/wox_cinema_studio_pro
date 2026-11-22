import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, readdirSync, copyFileSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const BLENDER_BIN = process.env.BLENDER_BIN || "/home/wox76/.local/bin/blender";

const ROOT = resolve(process.cwd());
export const DATASET_DIR = join(ROOT, "out", "assets_library");
export const POLYFORK_DIR = join(DATASET_DIR, "polyfork");
export const OGA_DIR = join(DATASET_DIR, "opengameart");
const POLYFORK_INDEX = join(POLYFORK_DIR, "index.json");
const OGA_INDEX = join(OGA_DIR, "index.json");

export interface PolyforkCachedAsset {
  id: string;
  title: string;
  category: string;
  query: string;
  filePath: string;
  sizeBytes: number;
  downloadedAt: string;
}

function ensurePolyforkDir() {
  if (!existsSync(POLYFORK_DIR)) mkdirSync(POLYFORK_DIR, { recursive: true });
}

export function loadPolyforkIndex(): Record<string, PolyforkCachedAsset> {
  ensurePolyforkDir();
  if (!existsSync(POLYFORK_INDEX)) return {};
  try {
    return JSON.parse(readFileSync(POLYFORK_INDEX, "utf-8")) as Record<string, PolyforkCachedAsset>;
  } catch {
    return {};
  }
}

function savePolyforkIndex(idx: Record<string, PolyforkCachedAsset>) {
  ensurePolyforkDir();
  writeFileSync(POLYFORK_INDEX, JSON.stringify(idx, null, 2), "utf-8");
}

/**
 * Search Polyfork (3,489+ free game-ready & rigged GLB models), download to local persistent library
 * `out/assets_library/polyfork/<category>/<id>.glb`, and reuse cached files on subsequent games.
 */
export async function resolvePolyforkAsset(
  searchQuery: string,
  preferRigged = false
): Promise<{ asset: PolyforkCachedAsset; fromCache: boolean } | null> {
  const q = searchQuery.trim();
  if (!q) return null;

  const index = loadPolyforkIndex();
  const qLower = q.toLowerCase();

  // 1. Check local library cache first (by exact query or matching title/id)
  for (const item of Object.values(index)) {
    if (
      existsSync(item.filePath) &&
      statSync(item.filePath).size > 500 &&
      (item.query.toLowerCase() === qLower || item.id.toLowerCase() === qLower)
    ) {
      return { asset: item, fromCache: true };
    }
  }

  // 2. Query Polyfork public API (no API key required for free low-poly GLBs)
  const url = `https://polyfork.dev/api/assets?q=${encodeURIComponent(q)}&limit=8`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const data = (await res.json()) as any;
  const rows: any[] = Array.isArray(data?.assets) ? data.assets : [];
  const freeRows = rows.filter((r) => r && r.id && r.free !== false);
  if (!freeRows.length) return null;

  // Prefer rigged models when requested (e.g., characters/enemies)
  const chosen = (preferRigged ? freeRows.find((r) => r.has_rig) : null) || freeRows[0];
  const id = String(chosen.id);
  const title = String(chosen.title || id);
  const category = String(chosen.class || "misc").toLowerCase().replace(/[^a-z0-9_-]/g, "_") || "misc";

  // Check if this exact Polyfork ID is already in our local library!
  if (index[id] && existsSync(index[id].filePath) && statSync(index[id].filePath).size > 500) {
    return { asset: index[id], fromCache: true };
  }

  // 3. Download GLB directly from Polyfork CDN into persistent local library
  const catDir = join(POLYFORK_DIR, category);
  if (!existsSync(catDir)) mkdirSync(catDir, { recursive: true });
  const filePath = join(catDir, `${id}.glb`);

  const glbUrl = `https://polyfork.dev/cdn/${encodeURIComponent(id)}.glb`;
  const dlRes = await fetch(glbUrl, { signal: AbortSignal.timeout(45_000) });
  if (!dlRes.ok) return null;
  const bytes = new Uint8Array(await dlRes.arrayBuffer());
  if (bytes.byteLength < 500) return null;

  writeFileSync(filePath, bytes);
  const entry: PolyforkCachedAsset = {
    id,
    title,
    category,
    query: q,
    filePath,
    sizeBytes: bytes.byteLength,
    downloadedAt: new Date().toISOString(),
  };
  index[id] = entry;
  savePolyforkIndex(index);
  return { asset: entry, fromCache: false };
}

/**
 * Save an existing .glb asset (e.g. from a deleted game project) into the persistent local library
 * (`out/assets_library/saved/`) and index it so future games can reuse it automatically.
 */
export function saveAssetToLocalLibrary(
  srcGlbPath: string,
  opts: { id: string; title: string; query: string; category?: string }
): PolyforkCachedAsset | null {
  if (!existsSync(srcGlbPath)) return null;
  const st = statSync(srcGlbPath);
  if (!st.isFile() || st.size < 200) return null;

  const savedDir = join(DATASET_DIR, "saved");
  if (!existsSync(savedDir)) mkdirSync(savedDir, { recursive: true });

  const safeId = opts.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 80) || `asset_${Date.now()}`;
  const dstPath = join(savedDir, `${safeId}.glb`);
  copyFileSync(srcGlbPath, dstPath);

  const index = loadPolyforkIndex();
  const entry: PolyforkCachedAsset = {
    id: safeId,
    title: opts.title || safeId,
    category: opts.category || "saved",
    query: (opts.query || opts.title || safeId).trim(),
    filePath: dstPath,
    sizeBytes: st.size,
    downloadedAt: new Date().toISOString(),
  };
  index[safeId] = entry;
  savePolyforkIndex(index);
  return entry;
}

/** Build a Blender 5.1 script to import a Polyfork GLB, apply optional color/scale tweaks, and re-export. */
export function buildBlenderRemixScript(
  inputGlbPath: string,
  outputGlbPath: string,
  opts: { tintRgb?: [number, number, number]; rotateYDeg?: number; scale?: number }
): string {
  const inP = inputGlbPath.replace(/\\/g, "/");
  const outP = outputGlbPath.replace(/\\/g, "/");
  const rotRad = ((opts.rotateYDeg || 0) * Math.PI) / 180;
  const sc = opts.scale || 1.0;
  const tintCode = opts.tintRgb
    ? `
for mat in bpy.data.materials:
    if mat.use_nodes:
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf and "Base Color" in bsdf.inputs:
            c = bsdf.inputs["Base Color"].default_value
            bsdf.inputs["Base Color"].default_value = (
                c[0] * 0.45 + ${opts.tintRgb[0]} * 0.55,
                c[1] * 0.45 + ${opts.tintRgb[1]} * 0.55,
                c[2] * 0.45 + ${opts.tintRgb[2]} * 0.55,
                1.0
            )
`
    : "";

  return `import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=${JSON.stringify(inP)})
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH' or obj.type == 'ARMATURE':
        obj.rotation_euler[2] += ${rotRad}
        obj.scale = (obj.scale[0] * ${sc}, obj.scale[1] * ${sc}, obj.scale[2] * ${sc})
${tintCode}
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=${JSON.stringify(outP)}, export_format='GLB')
`;
}

function findFirst3DFile(dir: string): string | null {
  const exts = [".glb", ".gltf", ".blend", ".fbx", ".obj"];
  const queue = [dir];
  const found: string[] = [];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const ent of readdirSync(cur, { withFileTypes: true })) {
      const p = join(cur, ent.name);
      if (ent.isDirectory()) queue.push(p);
      else if (exts.includes(extname(ent.name).toLowerCase())) found.push(p);
    }
  }
  for (const ext of exts) {
    const match = found.find((f) => extname(f).toLowerCase() === ext);
    if (match) return match;
  }
  return null;
}

/**
 * Search or fetch a 3D asset from OpenGameArt.org (CC0 / Open Source),
 * extract & convert (.blend/.obj/.fbx/.zip -> .glb) via Blender 5.1,
 * and cache in `out/assets_library/opengameart/<slug>/model.glb`.
 */
export async function resolveOpenGameArtAsset(
  queryOrUrl: string
): Promise<{ asset: PolyforkCachedAsset; fromCache: boolean } | null> {
  const q = queryOrUrl.trim();
  if (!q) return null;
  if (!existsSync(OGA_DIR)) mkdirSync(OGA_DIR, { recursive: true });

  const idx: Record<string, PolyforkCachedAsset> = existsSync(OGA_INDEX)
    ? JSON.parse(readFileSync(OGA_INDEX, "utf-8"))
    : {};
  const slug = q.replace(/^https?:\/\/opengameart\.org\/content\//i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "oga-asset";

  if (idx[slug] && existsSync(idx[slug].filePath) && statSync(idx[slug].filePath).size > 500) {
    return { asset: idx[slug], fromCache: true };
  }

  let pageUrl = q.startsWith("http") ? q : "";
  if (!pageUrl) {
    // Search OpenGameArt 3D Art category (tid=10)
    const searchUrl = `https://opengameart.org/art-search-advanced?keys=${encodeURIComponent(q)}&field_art_type_tid[]=10`;
    const sRes = await fetch(searchUrl, { signal: AbortSignal.timeout(15_000) });
    if (!sRes.ok) return null;
    const html = await sRes.text();
    const m = /href="(\/content\/[a-zA-Z0-9_-]+)"/.exec(html);
    if (!m) return null;
    pageUrl = `https://opengameart.org${m[1]}`;
  }

  const pRes = await fetch(pageUrl, { signal: AbortSignal.timeout(15_000) });
  if (!pRes.ok) return null;
  const pHtml = await pRes.text();
  const fileMatches = [...pHtml.matchAll(/https:\/\/opengameart\.org\/sites\/default\/files\/[^"' <>]+\.(?:glb|gltf|zip|blend|fbx|obj)/gi)].map((m) => m[0]);
  if (!fileMatches.length) return null;
  const dlUrl = fileMatches[0];

  const assetDir = join(OGA_DIR, slug);
  mkdirSync(assetDir, { recursive: true });
  const rawName = dlUrl.split("/").pop() || "asset.zip";
  const rawPath = join(assetDir, rawName);

  const dlRes = await fetch(dlUrl, { signal: AbortSignal.timeout(60_000) });
  if (!dlRes.ok) return null;
  writeFileSync(rawPath, new Uint8Array(await dlRes.arrayBuffer()));

  if (rawName.toLowerCase().endsWith(".zip")) {
    await execFileAsync("unzip", ["-o", rawPath, "-d", assetDir], { timeout: 20_000 }).catch(() => {});
  }

  const src3d = findFirst3DFile(assetDir);
  if (!src3d) return null;

  const outGlb = join(assetDir, "model.glb");
  const ext = extname(src3d).toLowerCase();
  if (ext === ".glb") {
    if (src3d !== outGlb) writeFileSync(outGlb, readFileSync(src3d));
  } else {
    // Convert .blend / .obj / .fbx / .gltf to .glb using Blender 5.1
    const convPy = join(assetDir, "_convert.py");
    const safeSrc = src3d.replace(/\\/g, "/");
    const safeOut = outGlb.replace(/\\/g, "/");
    const importCmd =
      ext === ".blend" ? `bpy.ops.wm.open_mainfile(filepath=${JSON.stringify(safeSrc)})` :
      ext === ".obj" ? `bpy.ops.wm.obj_import(filepath=${JSON.stringify(safeSrc)})` :
      ext === ".fbx" ? `bpy.ops.import_scene.fbx(filepath=${JSON.stringify(safeSrc)})` :
      `bpy.ops.import_scene.gltf(filepath=${JSON.stringify(safeSrc)})`;
    writeFileSync(
      convPy,
      `import bpy\nbpy.ops.wm.read_factory_settings(use_empty=True)\n${importCmd}\nbpy.ops.object.select_all(action='SELECT')\nbpy.ops.export_scene.gltf(filepath=${JSON.stringify(safeOut)}, export_format='GLB')\n`,
      "utf-8"
    );
    await execFileAsync(BLENDER_BIN, ["--background", "--factory-startup", "--python-exit-code", "1", "--python", convPy], { timeout: 60_000 });
  }

  if (!existsSync(outGlb) || statSync(outGlb).size < 200) return null;
  const entry: PolyforkCachedAsset = {
    id: slug,
    title: slug,
    category: "opengameart",
    query: q,
    filePath: outGlb,
    sizeBytes: statSync(outGlb).size,
    downloadedAt: new Date().toISOString(),
  };
  idx[slug] = entry;
  writeFileSync(OGA_INDEX, JSON.stringify(idx, null, 2), "utf-8");
  return { asset: entry, fromCache: false };
}

// Keep lightweight exports for server.ts compatibility
export const OPEN_3D_DATASET: any[] = [];
export function getDatasetFilePath(_a: any): string { return ""; }
export function listDatasetAssets() { return Object.values(loadPolyforkIndex()); }
export async function downloadDatasetAsset(id: string) {
  const res = await resolvePolyforkAsset(id, true);
  if (!res) throw new Error(`Modello non trovato su Polyfork: ${id}`);
  return res.asset;
}
