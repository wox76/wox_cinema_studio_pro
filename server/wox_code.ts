import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  rmSync,
} from "node:fs";
import { join, resolve, relative, dirname, extname, basename } from "node:path";
import { exec, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import { checkBonsaiHealth, startBonsaiServer } from "./game_studio.ts";

const execAsync = promisify(exec);

const ROOT = resolve(process.cwd());
const DATA_DIR = join(ROOT, "out", "wox_code");
const PROJECTS_ROOT = join(DATA_DIR, "projects");
const CHATS_DIR = join(DATA_DIR, "chats");
const PROJECTS_FILE = join(DATA_DIR, "projects.json");

const BONSAI_HOST = process.env.BONSAI_HOST || "127.0.0.1";
const BONSAI_PORT = process.env.BONSAI_PORT || "8080";
const BONSAI_URL = `http://${BONSAI_HOST}:${BONSAI_PORT}`;

export interface WoxProject {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

export interface WoxToolCall {
  id: string;
  tool: string;
  args: Record<string, any>;
  status: "running" | "done" | "error";
  output: string;
  summary: string;
}

export interface WoxAttachment {
  path: string;
  kind: "image" | "pdf" | "text";
  mime?: string;
}

export interface WoxChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: WoxToolCall[];
  attachments?: WoxAttachment[];
  createdAt: string;
}

export type WoxReasoningEffort = "low" | "medium" | "high";

export interface WoxChat {
  id: string;
  projectId: string;
  title: string;
  mode: "agent" | "chat";
  reasoningEffort?: WoxReasoningEffort;
  createdAt: string;
  updatedAt: string;
  messages: WoxChatMessage[];
  running?: boolean;
  liveText?: string;
  liveStatus?: string;
  liveTools?: WoxToolCall[];
  error?: string;
}

const activeChats = new Map<string, WoxChat>();
const activeControllers = new Map<string, AbortController>();

function ensureDirs() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(PROJECTS_ROOT)) mkdirSync(PROJECTS_ROOT, { recursive: true });
  if (!existsSync(CHATS_DIR)) mkdirSync(CHATS_DIR, { recursive: true });
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 36) || "project"
  );
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function loadProjectsFile(): WoxProject[] {
  ensureDirs();
  if (!existsSync(PROJECTS_FILE)) {
    const defaultProj: WoxProject = {
      id: "default-workspace",
      name: "Wox Workspace",
      path: join(PROJECTS_ROOT, "wox-workspace"),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (!existsSync(defaultProj.path)) mkdirSync(defaultProj.path, { recursive: true });
    writeFileSync(PROJECTS_FILE, JSON.stringify([defaultProj], null, 2), "utf-8");
    return [defaultProj];
  }
  try {
    return JSON.parse(readFileSync(PROJECTS_FILE, "utf-8")) as WoxProject[];
  } catch {
    return [];
  }
}

function saveProjectsFile(list: WoxProject[]) {
  ensureDirs();
  writeFileSync(PROJECTS_FILE, JSON.stringify(list, null, 2), "utf-8");
}

export function listProjects(): WoxProject[] {
  return loadProjectsFile().sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export function getProject(id: string): WoxProject | null {
  return loadProjectsFile().find((p) => p.id === id) || null;
}

function scaffoldProjectTemplate(projPath: string, name: string, template?: string) {
  const writeIfMissing = (rel: string, content: string) => {
    const abs = join(projPath, rel);
    if (existsSync(abs)) return;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf-8");
  };

  if (template === "web") {
    writeIfMissing("index.html", `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${name}</title>
  <link rel="stylesheet" href="./css/style.css" />
</head>
<body>
  <div id="app"></div>
  <script type="module" src="./js/main.js"></script>
</body>
</html>
`);
    writeIfMissing("css/style.css", `* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #0e1016; color: #f8fafc; min-height: 100vh; }
`);
    writeIfMissing("js/main.js", `// ${name} - Entry point
console.log("${name} avviato");
`);
    writeIfMissing("README.md", `# ${name}\n\nProgetto Web / Videogioco strutturato con \`index.html\`, \`css/style.css\` e \`js/main.js\`.\n`);
  } else if (template === "python") {
    writeIfMissing("main.py", `#!/usr/bin/env python3
from src.utils import greet

def main():
    print(greet("${name}"))

if __name__ == "__main__":
    main()
`);
    writeIfMissing("src/__init__.py", "");
    writeIfMissing("src/utils.py", `def greet(name: str) -> str:
    return f"Benvenuto in {name}!"
`);
    writeIfMissing("requirements.txt", "");
    writeIfMissing("README.md", `# ${name}\n\nProgetto Python strutturato (\`main.py\`, \`src/\`, \`requirements.txt\`).\n`);
  } else if (template === "c") {
    writeIfMissing("include/app.h", `#ifndef APP_H
#define APP_H

void app_run(void);

#endif
`);
    writeIfMissing("src/main.c", `#include <stdio.h>
#include "../include/app.h"

void app_run(void) {
    printf("Avvio ${name}\\n");
}

int main(void) {
    app_run();
    return 0;
}
`);
    writeIfMissing("Makefile", `CC = gcc
CFLAGS = -Wall -Wextra -O2 -Iinclude
TARGET = app

all: $(TARGET)

$(TARGET): src/main.c
\t$(CC) $(CFLAGS) -o $(TARGET) src/main.c

clean:
\trm -f $(TARGET)
`);
    writeIfMissing("README.md", `# ${name}\n\nProgetto C strutturato (\`src/main.c\`, \`include/app.h\`, \`Makefile\`).\n`);
  }
}

export function createProject(input: { name: string; path?: string; template?: string }): WoxProject {
  ensureDirs();
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Inserisci un nome per il progetto.");
  const customPath = String(input.path || "").trim();
  const projPath = customPath ? resolve(customPath) : join(PROJECTS_ROOT, `${slugify(name)}-${Date.now().toString(36).slice(-4)}`);
  if (!existsSync(projPath)) mkdirSync(projPath, { recursive: true });
  if (input.template && input.template !== "empty") {
    scaffoldProjectTemplate(projPath, name, input.template);
  }

  const now = new Date().toISOString();
  const proj: WoxProject = {
    id: uid("proj"),
    name,
    path: projPath,
    createdAt: now,
    updatedAt: now,
  };
  const list = loadProjectsFile();
  list.unshift(proj);
  saveProjectsFile(list);
  return proj;
}

export function deleteProject(id: string, removeFolder = false): boolean {
  const list = loadProjectsFile();
  const idx = list.findIndex((p) => p.id === id);
  if (idx < 0) return false;
  const [removed] = list.splice(idx, 1);
  saveProjectsFile(list);
  if (removeFolder && removed.path.startsWith(PROJECTS_ROOT) && existsSync(removed.path)) {
    rmSync(removed.path, { recursive: true, force: true });
  }
  return true;
}

function chatPath(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return join(CHATS_DIR, `${safe}.json`);
}

function saveChat(chat: WoxChat) {
  ensureDirs();
  const toSave: WoxChat = {
    id: chat.id,
    projectId: chat.projectId,
    title: chat.title,
    mode: chat.mode,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messages: chat.messages,
  };
  writeFileSync(chatPath(chat.id), JSON.stringify(toSave, null, 2), "utf-8");
}

export function listChats(projectId?: string): WoxChat[] {
  ensureDirs();
  const out: WoxChat[] = [];
  for (const file of readdirSync(CHATS_DIR)) {
    if (!file.endsWith(".json")) continue;
    const id = file.replace(/\.json$/, "");
    try {
      const live = activeChats.get(id);
      const c = live || (JSON.parse(readFileSync(join(CHATS_DIR, file), "utf-8")) as WoxChat);
      if (projectId && c.projectId !== projectId) continue;
      out.push(c);
    } catch { /* ignore */ }
  }
  return out.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export function getChat(id: string): WoxChat | null {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
  if (activeChats.has(safe)) return activeChats.get(safe)!;
  const fp = chatPath(safe);
  if (!existsSync(fp)) return null;
  try {
    return JSON.parse(readFileSync(fp, "utf-8")) as WoxChat;
  } catch {
    return null;
  }
}

export function createChat(input: { projectId?: string; title?: string; mode?: "agent" | "chat" }): WoxChat {
  ensureDirs();
  const projects = listProjects();
  const projectId = input.projectId && projects.some((p) => p.id === input.projectId)
    ? input.projectId
    : projects[0]?.id || "default-workspace";
  const now = new Date().toISOString();
  const chat: WoxChat = {
    id: uid("chat"),
    projectId,
    title: String(input.title || "Nuova chat").trim() || "Nuova chat",
    mode: input.mode === "chat" ? "chat" : "agent",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  saveChat(chat);
  return chat;
}

export function deleteChat(id: string): boolean {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
  const ctrl = activeControllers.get(safe);
  if (ctrl) {
    ctrl.abort(new Error("Chat eliminata"));
    activeControllers.delete(safe);
  }
  activeChats.delete(safe);
  const fp = chatPath(safe);
  if (!existsSync(fp)) return false;
  rmSync(fp, { force: true });
  return true;
}

export function stopChatTurn(id: string): WoxChat | null {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
  const ctrl = activeControllers.get(safe);
  if (ctrl) {
    ctrl.abort(new Error("Fermato dall'utente"));
    activeControllers.delete(safe);
  }
  const chat = activeChats.get(safe) || getChat(safe);
  if (chat) {
    chat.running = false;
    chat.liveStatus = "Fermato dall'utente";
    saveChat(chat);
    activeChats.delete(safe);
  }
  return chat;
}

export async function getWoxCodeStatus() {
  const bonsaiOnline = await checkBonsaiHealth();
  return {
    bonsai: {
      online: bonsaiOnline,
      url: BONSAI_URL,
      model: "Ternary-Bonsai-2-27B",
    },
    projectsCount: listProjects().length,
    chatsCount: listChats().length,
  };
}

// ---------- SAFE PROJECT FILE OPERATIONS ----------

function safeResolveInProject(projectRoot: string, relPath: string): string {
  const rootAbs = resolve(projectRoot);
  const target = resolve(rootAbs, relPath || ".");
  if (target !== rootAbs && !target.startsWith(rootAbs + "/")) {
    throw new Error(`Percorso fuori dal progetto non consentito: ${relPath}`);
  }
  return target;
}

const IGNORED_DIRS = new Set(["node_modules", ".git", ".next", "dist", "__pycache__", ".venv", "venv"]);

export function listProjectFiles(projectId: string, subPath = ""): { path: string; isDir: boolean; size: number }[] {
  const proj = getProject(projectId);
  if (!proj) throw new Error("Progetto non trovato.");
  if (!existsSync(proj.path)) mkdirSync(proj.path, { recursive: true });
  const startDir = safeResolveInProject(proj.path, subPath);
  const out: { path: string; isDir: boolean; size: number }[] = [];

  function walk(dir: string, depth: number) {
    if (depth > 4 || out.length >= 250) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      if (IGNORED_DIRS.has(name) || name.startsWith(".DS_Store")) continue;
      const full = join(dir, name);
      try {
        const st = statSync(full);
        const rel = relative(proj!.path, full);
        out.push({ path: rel, isDir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size });
        if (st.isDirectory()) walk(full, depth + 1);
      } catch { /* ignore */ }
      if (out.length >= 250) break;
    }
  }
  walk(startDir, 0);
  return out;
}

export function readProjectFile(projectId: string, relPath: string): { path: string; content: string; size: number } {
  const proj = getProject(projectId);
  if (!proj) throw new Error("Progetto non trovato.");
  const abs = safeResolveInProject(proj.path, relPath);
  if (!existsSync(abs) || statSync(abs).isDirectory()) {
    throw new Error(`File non trovato: ${relPath}`);
  }
  const st = statSync(abs);
  const raw = readFileSync(abs, "utf-8");
  return { path: relPath, content: raw.slice(0, 120_000), size: st.size };
}

export function openProjectFolder(projectId: string): { ok: boolean; path: string } {
  const proj = getProject(projectId);
  if (!proj) throw new Error("Progetto non trovato.");
  if (!existsSync(proj.path)) mkdirSync(proj.path, { recursive: true });
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  const child = spawn(cmd, [proj.path], { detached: true, stdio: "ignore" });
  child.unref();
  return { ok: true, path: proj.path };
}

// ---------- AUTONOMOUS TOOLS FOR BONSAI 2 ----------

async function executeTool(
  projectRoot: string,
  tool: string,
  args: Record<string, any>
): Promise<{ ok: boolean; output: string; summary: string }> {
  try {
    if (tool === "list_files") {
      const sub = String(args.path || "");
      const abs = safeResolveInProject(projectRoot, sub);
      if (!existsSync(abs)) return { ok: false, output: `Directory non trovata: ${sub}`, summary: `list_files(${sub || "."}) fallito` };
      const items: string[] = [];
      const walk = (d: string, depth: number) => {
        if (depth > 3 || items.length >= 150) return;
        for (const name of readdirSync(d).sort()) {
          if (IGNORED_DIRS.has(name)) continue;
          const full = join(d, name);
          const st = statSync(full);
          const rel = relative(projectRoot, full);
          items.push(st.isDirectory() ? `${rel}/` : `${rel} (${st.size} B)`);
          if (st.isDirectory()) walk(full, depth + 1);
        }
      };
      walk(abs, 0);
      const out = items.length ? items.join("\n") : "(cartella vuota)";
      return { ok: true, output: out, summary: `Elencati ${items.length} elementi in ${sub || "."}` };
    }

    if (tool === "read_file") {
      const p = String(args.path || "").trim();
      if (!p) return { ok: false, output: "Parametro 'path' mancante", summary: "read_file fallito" };
      const abs = safeResolveInProject(projectRoot, p);
      if (!existsSync(abs) || statSync(abs).isDirectory()) {
        return { ok: false, output: `File non trovato: ${p}`, summary: `read_file(${p}) non trovato` };
      }
      const lines = readFileSync(abs, "utf-8").split("\n");
      const start = Math.max(1, Number(args.startLine) || 1);
      const end = Math.min(lines.length, Number(args.endLine) || Math.min(lines.length, start + 299));
      const slice = lines.slice(start - 1, end).map((l, idx) => `${start + idx}: ${l}`).join("\n");
      return {
        ok: true,
        output: `File: ${p} (righe ${start}-${end} di ${lines.length})\n${slice.slice(0, 24_000)}`,
        summary: `Letto ${p} (${end - start + 1} righe)`,
      };
    }

    if (tool === "write_file") {
      const p = String(args.path || "").trim();
      const content = String(args.content ?? "");
      if (!p) return { ok: false, output: "Parametro 'path' mancante", summary: "write_file fallito" };
      const abs = safeResolveInProject(projectRoot, p);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, "utf-8");
      return {
        ok: true,
        output: `File scritto con successo: ${p} (${Buffer.byteLength(content, "utf-8")} byte)`,
        summary: `Creato/aggiornato ${p}`,
      };
    }

    if (tool === "edit_file") {
      const p = String(args.path || "").trim();
      const target = String(args.target ?? "");
      const replacement = String(args.replacement ?? "");
      if (!p || !target) return { ok: false, output: "Parametri 'path' o 'target' mancanti", summary: "edit_file fallito" };
      const abs = safeResolveInProject(projectRoot, p);
      if (!existsSync(abs)) return { ok: false, output: `File non trovato: ${p}`, summary: `edit_file(${p}) non trovato` };
      const raw = readFileSync(abs, "utf-8");
      if (!raw.includes(target)) {
        return { ok: false, output: `Blocco target non trovato in ${p}`, summary: `edit_file(${p}) target non trovato` };
      }
      const updated = raw.replace(target, replacement);
      writeFileSync(abs, updated, "utf-8");
      return { ok: true, output: `Modifica applicata a ${p}`, summary: `Modificato ${p}` };
    }

    if (tool === "delete_file") {
      const p = String(args.path || "").trim();
      if (!p) return { ok: false, output: "Parametro 'path' mancante", summary: "delete_file fallito" };
      const abs = safeResolveInProject(projectRoot, p);
      if (!existsSync(abs)) return { ok: false, output: `File non trovato: ${p}`, summary: `delete_file(${p}) non trovato` };
      rmSync(abs, { recursive: true, force: true });
      return { ok: true, output: `Eliminato: ${p}`, summary: `Eliminato ${p}` };
    }

    if (tool === "search_files") {
      const query = String(args.query || "").trim();
      if (!query) return { ok: false, output: "Parametro 'query' mancante", summary: "search_files fallito" };
      const hits: string[] = [];
      const qLower = query.toLowerCase();
      const walk = (d: string, depth: number) => {
        if (depth > 4 || hits.length >= 60) return;
        for (const name of readdirSync(d)) {
          if (IGNORED_DIRS.has(name)) continue;
          const full = join(d, name);
          const st = statSync(full);
          if (st.isDirectory()) {
            walk(full, depth + 1);
          } else if (st.size < 250_000) {
            try {
              const lines = readFileSync(full, "utf-8").split("\n");
              const rel = relative(projectRoot, full);
              lines.forEach((line, i) => {
                if (hits.length < 60 && line.toLowerCase().includes(qLower)) {
                  hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 140)}`);
                }
              });
            } catch { /* ignore binary */ }
          }
        }
      };
      walk(projectRoot, 0);
      return {
        ok: true,
        output: hits.length ? hits.join("\n") : `Nessuna corrispondenza per "${query}"`,
        summary: `Ricerca "${query}": ${hits.length} risultati`,
      };
    }

    if (tool === "run_command") {
      const command = String(args.command || "").trim();
      if (!command) return { ok: false, output: "Parametro 'command' mancante", summary: "run_command fallito" };
      const { stdout, stderr } = await execAsync(command, {
        cwd: projectRoot,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
      const combined = [stdout, stderr].filter(Boolean).join("\n").trim().slice(0, 12_000);
      return {
        ok: true,
        output: combined || "(comando eseguito senza output)",
        summary: `Eseguito: ${command.slice(0, 60)}`,
      };
    }

    return { ok: false, output: `Tool sconosciuto: ${tool}`, summary: `Tool sconosciuto: ${tool}` };
  } catch (err: any) {
    const msg = String(err?.stderr || err?.message || err).slice(0, 4000);
    return { ok: false, output: msg, summary: `${tool} errore` };
  }
}

// ---------- BONSAI 2 STREAMING & TOOL PARSING ----------

function tryParseLooseJson(raw: string): any | null {
  const s = raw.trim();
  try {
    return JSON.parse(s);
  } catch { /* try lenient repair */ }
  try {
    // Fix common LLM JSON mistakes: \' -> ', literal newlines inside strings
    const fixed = s.replace(/\\'/g, "'").replace(/\r?\n/g, "\\n");
    return JSON.parse(fixed);
  } catch { /* try regex fallback for write_file */ }
  const toolMatch = /"tool"\s*:\s*"([^"]+)"/.exec(s);
  const pathMatch = /"path"\s*:\s*"([^"]+)"/.exec(s);
  if (toolMatch && toolMatch[1] === "write_file" && pathMatch) {
    const contentIdx = s.indexOf('"content"');
    if (contentIdx >= 0) {
      const colonIdx = s.indexOf(":", contentIdx);
      const firstQuote = s.indexOf('"', colonIdx + 1);
      const lastQuote = s.lastIndexOf('"');
      if (firstQuote >= 0 && lastQuote > firstQuote) {
        const rawContent = s
          .slice(firstQuote + 1, lastQuote)
          .replace(/\\n/g, "\n")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
        return { tool: "write_file", args: { path: pathMatch[1], content: rawContent } };
      }
    }
  }
  return null;
}

function parseToolCalls(text: string): { tool: string; args: Record<string, any> }[] {
  const calls: { tool: string; args: Record<string, any> }[] = [];

  // 1. Direct <write_file path="...">...</write_file> blocks (zero JSON escaping issues!)
  const wfRe = /<write_file\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/write_file>/gi;
  let wm: RegExpExecArray | null;
  while ((wm = wfRe.exec(text)) !== null) {
    const p = wm[1].trim();
    const content = wm[2].replace(/^\r?\n/, "");
    if (p) calls.push({ tool: "write_file", args: { path: p, content } });
  }

  // 2. Standard <tool_call>{...}</tool_call> blocks (with tolerant JSON fallback)
  const re = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const parsed = tryParseLooseJson(m[1]);
    if (parsed && typeof parsed.tool === "string") {
      calls.push({ tool: parsed.tool, args: parsed.args && typeof parsed.args === "object" ? parsed.args : {} });
    }
  }
  return calls;
}

function stripToolCalls(text: string): string {
  return text
    .replace(/<write_file\s+path=["'][^"']+["']\s*>[\s\S]*?<\/write_file>/gi, "")
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .trim();
}

type BonsaiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type BonsaiMessage = {
  role: "system" | "user" | "assistant";
  content: string | BonsaiContentPart[];
};

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

function detectAttachmentKind(filePath: string): { kind: "image" | "pdf" | "text"; mime?: string } {
  const ext = extname(filePath).toLowerCase();
  if (IMAGE_MIME_BY_EXT[ext]) return { kind: "image", mime: IMAGE_MIME_BY_EXT[ext] };
  if (ext === ".pdf") return { kind: "pdf", mime: "application/pdf" };
  return { kind: "text", mime: "text/plain" };
}

function extractPdfText(absPath: string): string {
  try {
    const out = execFileSync("pdftotext", ["-layout", absPath, "-"], {
      timeout: 15_000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf-8",
    });
    return String(out || "").trim();
  } catch {
    return "";
  }
}

export function uploadProjectFiles(
  projectId: string,
  files: { name: string; mime?: string; dataBase64: string }[]
): { uploaded: { path: string; name: string; size: number; kind: "image" | "pdf" | "text" }[] } {
  const proj = getProject(projectId);
  if (!proj) throw new Error("Progetto non trovato.");
  if (!existsSync(proj.path)) mkdirSync(proj.path, { recursive: true });
  const uploadsDir = join(proj.path, "uploads");
  if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

  const uploaded: { path: string; name: string; size: number; kind: "image" | "pdf" | "text" }[] = [];
  for (const f of files.slice(0, 20)) {
    const rawName = basename(String(f?.name || "file")).replace(/[^\w.\- ()]/g, "_").trim() || "file";
    const ext = extname(rawName);
    const stem = rawName.slice(0, rawName.length - ext.length) || "file";
    let finalName = rawName;
    let counter = 1;
    while (existsSync(join(uploadsDir, finalName))) {
      finalName = `${stem}-${counter}${ext}`;
      counter++;
    }
    const b64 = String(f?.dataBase64 || "").replace(/^data:[^;]+;base64,/, "");
    const buf = Buffer.from(b64, "base64");
    const absPath = join(uploadsDir, finalName);
    writeFileSync(absPath, buf);
    const relPath = `uploads/${finalName}`;
    const { kind } = detectAttachmentKind(relPath);
    uploaded.push({ path: relPath, name: finalName, size: buf.length, kind });
  }
  return { uploaded };
}

const REASONING_CONFIG: Record<WoxReasoningEffort, { budget: number; maxTokens: number }> = {
  low: { budget: 512, maxTokens: 4096 },
  medium: { budget: 2048, maxTokens: 6144 },
  high: { budget: 4096, maxTokens: 10240 },
};

async function streamBonsaiMessages(
  messages: BonsaiMessage[],
  chat: WoxChat,
  signal: AbortSignal
): Promise<string> {
  const effort: WoxReasoningEffort =
    chat.reasoningEffort === "low" || chat.reasoningEffort === "high"
      ? chat.reasoningEffort
      : "medium";
  const cfg = REASONING_CONFIG[effort];

  const res = await fetch(`${BONSAI_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "bonsai-2",
      messages,
      temperature: 0.35,
      max_tokens: cfg.maxTokens,
      reasoning_budget: cfg.budget,
      stream: true,
    }),
    signal: AbortSignal.any([AbortSignal.timeout(300_000), signal]),
  });

  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Bonsai 2 HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }

  let content = "";
  let reasoning = "";
  let buf = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith("data:")) {
        const payload = line.slice(5).trim();
        if (payload && payload !== "[DONE]") {
          try {
            const j = JSON.parse(payload);
            const delta = j?.choices?.[0]?.delta;
            if (typeof delta?.content === "string") {
              content += delta.content;
              chat.liveStatus = `Bonsai 2 sta scrivendo (${content.length} caratteri)...`;
              chat.liveText = content.length > 3500 ? "…\n" + content.slice(-3500) : content;
            }
            if (typeof delta?.reasoning_content === "string") {
              reasoning += delta.reasoning_content;
              if (!content) {
                chat.liveStatus = `Bonsai 2 sta ragionando (${reasoning.length} caratteri)...`;
                const tail = reasoning.length > 3500 ? "…\n" + reasoning.slice(-3500) : reasoning;
                chat.liveText = `[Ragionamento]\n${tail}`;
              }
            }
          } catch { /* ignore partial SSE */ }
        }
      }
      nl = buf.indexOf("\n");
    }
  }
  return content.trim() || reasoning.trim();
}

function buildAgentSystemPrompt(proj: WoxProject): string {
  return `Sei **Wox Code**, un assistente di programmazione e agente autonomo 100% locale (stile Claude Code) alimentato da Bonsai 2.
Rispondi nella lingua dell'utente (principalmente italiano).

Progetto attivo:
- Nome: ${proj.name}
- Cartella: ${proj.path}

Hai a disposizione questi strumenti locali che puoi invocare in autonomia per leggere file, creare/modificare codice, cercare nel progetto ed eseguire comandi:
1. list_files: {"tool": "list_files", "args": {"path": ""}}
2. read_file: {"tool": "read_file", "args": {"path": "percorso/file.ext", "startLine": 1, "endLine": 300}}
3. write_file: {"tool": "write_file", "args": {"path": "percorso/file.ext", "content": "contenuto completo"}}
4. edit_file: {"tool": "edit_file", "args": {"path": "percorso/file.ext", "target": "testo esatto", "replacement": "nuovo testo"}}
5. delete_file: {"tool": "delete_file", "args": {"path": "percorso/file.ext"}}
6. search_files: {"tool": "search_files", "args": {"query": "testo da cercare"}}
7. run_command: {"tool": "run_command", "args": {"command": "comando shell nella cartella del progetto"}}

Per CREARE o SCRIVERE un file (HTML, CSS, JS, Python, C, ecc.), usa SEMPRE questo tag diretto (senza escape JSON):
<write_file path="index.html">
<!DOCTYPE html>
...
</write_file>

Per gli altri strumenti, usa questo blocco JSON:
<tool_call>
{"tool": "read_file", "args": {"path": "index.html"}}
</tool_call>

Regole operative:
- Se l'utente chiede di creare codice, un'app, un videogioco, uno script o modificare file: USA SUBITO write_file / edit_file in autonomia, non limitarti a mostrare il codice in chat.
- STRUTTURA SEMPRE I FILE IN MODO ORDINATO E MODULARE (evita di mettere tutto in un solo file monolitico):
  • Web / Videogiochi Web: separa \`index.html\`, \`css/style.css\`, \`js/main.js\` (e moduli dedicati in \`js/\` come \`js/game.js\`, \`js/engine.js\`, \`js/ui.js\`), più \`README.md\`.
  • Python: separa \`main.py\`, moduli in \`src/\` (es. \`src/logic.py\`, \`src/utils.py\`), \`requirements.txt\` e \`README.md\`.
  • C / C++: separa \`src/main.c\` (o \`.cpp\`), header in \`include/\` (\`.h\`), \`Makefile\` e \`README.md\`.
- Se l'utente chiede di riassumere o analizzare un file: USA read_file per leggerlo prima di rispondere.
- Se devi verificare il codice creato, puoi usare run_command (es. node --check, python3 -m py_compile, gcc, ecc.).
- Dopo aver eseguito gli strumenti e ricevuto i risultati, fornisci una risposta finale chiara e concisa senza altri <tool_call>.`;
}

async function runWoxCodeTurn(chat: WoxChat, proj: WoxProject, signal: AbortSignal) {
  try {
    chat.running = true;
    chat.error = undefined;
    chat.liveStatus = "Verifica Bonsai 2...";
    chat.liveText = "";

    if (!(await checkBonsaiHealth())) {
      chat.liveStatus = "Avvio automatico Bonsai 2...";
      const startRes = await startBonsaiServer();
      if (!startRes.ok || !(await checkBonsaiHealth())) {
        throw new Error(`Bonsai 2 non disponibile: ${startRes.message}`);
      }
    }

    const sysPrompt =
      chat.mode === "agent"
        ? buildAgentSystemPrompt(proj)
        : `Sei Wox Code, un assistente AI 100% locale alimentato da Bonsai 2. Progetto attivo: ${proj.name} (${proj.path}). Rispondi in modo chiaro, preciso e conciso.`;

    const convo: BonsaiMessage[] = [
      { role: "system", content: sysPrompt },
      ...chat.messages.slice(-16).map((m): BonsaiMessage => {
        const imgAtts = (m.attachments || []).filter((a) => a.kind === "image");
        if (m.role === "user" && imgAtts.length > 0) {
          const parts: BonsaiContentPart[] = [{ type: "text", text: m.content }];
          for (const att of imgAtts.slice(0, 6)) {
            try {
              const abs = resolve(proj.path, att.path);
              if (abs.startsWith(resolve(proj.path)) && existsSync(abs)) {
                const buf = readFileSync(abs);
                const mime = att.mime || detectAttachmentKind(abs).mime || "image/png";
                parts.push({
                  type: "image_url",
                  image_url: { url: `data:${mime};base64,${buf.toString("base64")}` },
                });
              }
            } catch { /* ignore unreadable image */ }
          }
          return { role: "user", content: parts };
        }
        return { role: m.role, content: m.content };
      }),
    ];

    const executedTools: WoxToolCall[] = [];
    chat.liveTools = executedTools;
    let finalReply = "";
    const maxSteps = chat.mode === "agent" ? 8 : 1;

    for (let step = 1; step <= maxSteps; step++) {
      if (signal.aborted) throw new Error("Fermato dall'utente");
      chat.liveStatus = step === 1 ? "Bonsai 2 sta elaborando..." : `Passo autonomo ${step}/${maxSteps}...`;
      const raw = await streamBonsaiMessages(convo, chat, signal);
      const calls = chat.mode === "agent" ? parseToolCalls(raw) : [];
      const cleanText = stripToolCalls(raw);

      if (!calls.length) {
        finalReply = cleanText || raw;
        break;
      }

      convo.push({ role: "assistant", content: raw });
      const resultsText: string[] = [];

      for (const c of calls) {
        if (signal.aborted) throw new Error("Fermato dall'utente");
        const rec: WoxToolCall = {
          id: uid("tc"),
          tool: c.tool,
          args: c.args,
          status: "running",
          output: "",
          summary: `Esecuzione ${c.tool}...`,
        };
        executedTools.push(rec);
        chat.liveStatus = `Esecuzione tool: ${c.tool}...`;

        const res = await executeTool(proj.path, c.tool, c.args);
        rec.status = res.ok ? "done" : "error";
        rec.output = res.output;
        rec.summary = res.summary;
        resultsText.push(`[TOOL RESULT: ${c.tool} (${rec.status})]\n${res.output}`);
      }

      convo.push({
        role: "user",
        content: `Risultati degli strumenti eseguiti:\n\n${resultsText.join("\n\n")}\n\nContinua con il passo successivo se necessario, oppure fornisci la risposta finale all'utente.`,
      });

      if (step === maxSteps) {
        finalReply = cleanText || "Operazioni completate.";
      }
    }

    const assistantMsg: WoxChatMessage = {
      id: uid("msg"),
      role: "assistant",
      content: finalReply || "Fatto.",
      toolCalls: executedTools.length ? executedTools : undefined,
      createdAt: new Date().toISOString(),
    };
    chat.messages.push(assistantMsg);
    chat.updatedAt = new Date().toISOString();
    chat.running = false;
    chat.liveText = "";
    chat.liveStatus = "";
    chat.liveTools = undefined;
    saveChat(chat);
  } catch (err: any) {
    chat.running = false;
    chat.error = String(err?.message || err);
    chat.liveStatus = "";
    chat.liveTools = undefined;
    chat.messages.push({
      id: uid("msg"),
      role: "assistant",
      content: `❌ Errore: ${chat.error}`,
      createdAt: new Date().toISOString(),
    });
    chat.updatedAt = new Date().toISOString();
    saveChat(chat);
  } finally {
    activeChats.delete(chat.id);
    activeControllers.delete(chat.id);
  }
}

export function sendChatMessage(
  chatId: string,
  input: {
    text: string;
    mode?: "agent" | "chat";
    reasoningEffort?: WoxReasoningEffort;
    attachedFiles?: string[];
  }
): WoxChat {
  const chat = getChat(chatId);
  if (!chat) throw new Error("Chat non trovata.");
  if (chat.running) throw new Error("Attendi il completamento della risposta in corso o clicca Stop.");

  const proj = getProject(chat.projectId) || listProjects()[0];
  if (!proj) throw new Error("Nessun progetto attivo.");
  if (!existsSync(proj.path)) mkdirSync(proj.path, { recursive: true });

  const attached = Array.isArray(input.attachedFiles) ? input.attachedFiles.filter(Boolean) : [];
  let text = String(input.text || "").trim();
  if (!text && !attached.length) throw new Error("Scrivi un messaggio o allega almeno un file.");
  if (!text && attached.length) text = "Analizza i file allegati.";

  if (input.mode === "agent" || input.mode === "chat") {
    chat.mode = input.mode;
  }
  if (
    input.reasoningEffort === "low" ||
    input.reasoningEffort === "medium" ||
    input.reasoningEffort === "high"
  ) {
    chat.reasoningEffort = input.reasoningEffort;
  }

  // Handle attached files context cleanly (images, PDFs, text/code)
  const msgAttachments: WoxAttachment[] = [];
  if (attached.length) {
    const fileSnippets: string[] = [];
    for (const rel of attached.slice(0, 15)) {
      try {
        const abs = resolve(proj.path, rel);
        if (!abs.startsWith(resolve(proj.path)) || !existsSync(abs)) continue;
        const { kind, mime } = detectAttachmentKind(rel);
        msgAttachments.push({ path: rel, kind, mime });
        if (kind === "image") {
          fileSnippets.push(`[IMMAGINE ALLEGATA: ${rel}]`);
        } else if (kind === "pdf") {
          const pdfText = extractPdfText(abs);
          fileSnippets.push(
            pdfText
              ? `--- PDF ALLEGATO: ${rel} ---\n${pdfText.slice(0, 24_000)}`
              : `[PDF ALLEGATO: ${rel} — nessun testo estraibile, potrebbe essere un PDF scansionato]`
          );
        } else {
          const f = readProjectFile(proj.id, rel);
          fileSnippets.push(`--- FILE ALLEGATO: ${f.path} ---\n${f.content.slice(0, 24_000)}`);
        }
      } catch { /* ignore */ }
    }
    if (fileSnippets.length) {
      text = `${text}\n\n${fileSnippets.join("\n\n")}`;
    }
  }

  if (chat.messages.length === 0) {
    chat.title = (String(input.text || "").trim() || `Analisi ${attached[0] || "file"}`).slice(0, 48) || "Nuova chat";
  }

  chat.messages.push({
    id: uid("msg"),
    role: "user",
    content: text,
    attachments: msgAttachments.length ? msgAttachments : undefined,
    createdAt: new Date().toISOString(),
  });
  chat.updatedAt = new Date().toISOString();
  chat.running = true;
  chat.liveStatus = "Connessione a Bonsai 2...";
  chat.liveText = "";

  activeChats.set(chat.id, chat);
  const ctrl = new AbortController();
  activeControllers.set(chat.id, ctrl);
  saveChat(chat);

  void runWoxCodeTurn(chat, proj, ctrl.signal);
  return chat;
}
