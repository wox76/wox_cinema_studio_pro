// WoxOS Desktop Environment
// Hybrid Linux + macOS + ChromeOS + Android window manager with macOS Finder Applications menu
// and live inter-window communication via WoxOSBus.

import { el, api } from "./util.js";
import { loadCatalog, apps as catalogApps } from "./catalog.js";
import { osBus } from "./os_bus.js";
import { openSettingsModal } from "./settings.js";

const GRADIENTS = [
  "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
  "linear-gradient(135deg, #ec4899 0%, #f43f5e 100%)",
  "linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)",
  "linear-gradient(135deg, #10b981 0%, #059669 100%)",
  "linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)",
  "linear-gradient(135deg, #14b8a6 0%, #0284c7 100%)",
  "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
  "linear-gradient(135deg, #84cc16 0%, #10b981 100%)",
];

const SECTION_GLYPH = {
  video: "🎬",
  image: "🖼️",
  "3d": "🧊",
  audio: "🎵",
  studio: "✨",
  system: "⚙️",
};

const SPECIAL_APPS = [
  { id: "cinema-video", name: "Cinema Studio Video", route: "#/app/cinema-video", category: "video", glyph: "🎬", grad: "linear-gradient(135deg, #f43f5e 0%, #f59e0b 100%)", pinned: true },
  { id: "__carosello__", name: "Carosello", route: "wox://carosello", category: "studio", glyph: "🎠", thumb: "/icons/carosello.png", grad: "linear-gradient(135deg, #a855f7 0%, #3b82f6 100%)", pinned: true },
  { id: "cinema-studio", name: "Cinema Studio Image", route: "#/app/cinema-studio", category: "image", glyph: "📷", grad: "linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)", pinned: true },
  { id: "trellis-3d", name: "3D Studio (TRELLIS)", route: "#/app/trellis-3d", category: "3d", glyph: "🧊", grad: "linear-gradient(135deg, #0ea5e9 0%, #10b981 100%)", pinned: true },
  { id: "video-editor", name: "Video Studio Editor", route: "/editor/index.html", external: true, category: "studio", glyph: "🎞️", thumb: "/editor/icon-192.png", grad: "linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)", pinned: true },
  { id: "game-studio", name: "Game Studio", route: "#/game", category: "studio", glyph: "🎮", thumb: "/icons/game-studio.png", grad: "linear-gradient(135deg, #22c55e 0%, #0ea5e9 100%)", pinned: true },
  { id: "wonderfull", name: "Wonderfull", route: "#/app/wonderfull", category: "image", glyph: "✨", grad: "linear-gradient(135deg, #ec4899 0%, #a855f7 100%)", pinned: true },
  { id: "wox-code", name: "Wox Code", route: "#/code", category: "studio", glyph: "💻", thumb: "/icons/wox-code.png", grad: "linear-gradient(135deg, #334155 0%, #0f172a 100%)", pinned: true },
  { id: "library", name: "Library & History", route: "#/library", category: "system", glyph: "🗂️", grad: "linear-gradient(135deg, #f59e0b 0%, #eab308 100%)", pinned: true },
  { id: "marketing", name: "Marketing Studio", route: "#/marketing", category: "studio", glyph: "📢", grad: "linear-gradient(135deg, #fb7185 0%, #f97316 100%)", pinned: false },
  { id: "kinetic", name: "Kinetic Typography", route: "#/kinetic", category: "studio", glyph: "🔤", grad: "linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)", pinned: false },
  { id: "layers", name: "Layers Editor", route: "#/layers", category: "studio", glyph: "📑", grad: "linear-gradient(135deg, #2dd4bf 0%, #3b82f6 100%)", pinned: false },
  { id: "playcanvas", name: "PlayCanvas 3D", route: "/playcanvas/", external: true, category: "3d", glyph: "🕹️", grad: "linear-gradient(135deg, #f97316 0%, #ef4444 100%)", pinned: false },
  { id: "vram", name: "VRAM & GPU Monitor", route: "#/vram", category: "system", glyph: "📊", grad: "linear-gradient(135deg, #10b981 0%, #3b82f6 100%)", pinned: false },
  { id: "__installer__", name: "Auto Install & Options", route: "wox://installer", category: "system", glyph: "⚙️", grad: "linear-gradient(135deg, #64748b 0%, #334155 100%)", pinned: false },
];

function hashColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

export async function bootWoxOS() {
  document.body.classList.add("wox-os-active");
  document.title = "WoxOS · Wox Cinema Studio PRO";

  try {
    await loadCatalog();
  } catch (err) {
    console.warn("[WoxOS] catalog load warning:", err);
  }

  // Load real Wox Cinema Studio Pro app thumbnails from /examples/index.json
  let examplesMap = {};
  try {
    const r = await fetch("/examples/index.json");
    if (r.ok) {
      const data = await r.json();
      examplesMap = data?.apps || {};
    }
  } catch {
    examplesMap = {};
  }

  function thumbForApp(appId) {
    const ex = examplesMap[appId];
    if (!ex) return null;
    const isImg = (s) => typeof s === "string" && /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(s);
    if (isImg(ex.poster)) return `/${ex.poster.replace(/^\/+/, "")}`;
    if (isImg(ex.card)) return `/${ex.card.replace(/^\/+/, "")}`;
    if (isImg(ex.full)) return `/${ex.full.replace(/^\/+/, "")}`;
    const inpImg = (ex.inputs || []).find((i) => isImg(i?.src));
    if (inpImg) return `/${inpImg.src.replace(/^\/+/, "")}`;
    return null;
  }

  function appIconContent(app) {
    if (!app?.thumb) return app?.glyph || "⚡";
    const img = el("img", {
      src: app.thumb,
      alt: app.name || app.id,
      loading: "lazy",
      style: { width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit", display: "block" },
    });
    img.onerror = () => {
      img.replaceWith(document.createTextNode(app.glyph || "⚡"));
    };
    return img;
  }

  // Build unified app directory (special apps + all catalog apps)
  const specialById = new Map(SPECIAL_APPS.map((a) => [a.id, a]));
  const allApps = SPECIAL_APPS.map((a) => ({ ...a, thumb: a.thumb || thumbForApp(a.id) }));
  for (const a of catalogApps) {
    if (specialById.has(a.id)) continue;
    allApps.push({
      id: a.id,
      name: a.name || a.id,
      route: `#/app/${a.id}`,
      category: a.section || "video",
      glyph: SECTION_GLYPH[a.section] || "⚡",
      grad: hashColor(a.id),
      thumb: thumbForApp(a.id),
      summary: a.summary || "",
      pinned: false,
    });
  }
  const appLookup = new Map(allApps.map((a) => [a.id, a]));

  // OS State
  let winCounter = 0;
  let zTop = 100;
  const windows = new Map(); // winId -> record
  let focusedWinId = null;
  let activePopover = null;
  const sharedAssets = []; // Shared inter-window clipboard/outputs
  const pendingInjections = new Map(); // winId -> [{ item, slotId, prompt }]

  const savedWallpaper = localStorage.getItem("wox.os.wallpaper") || "aurora";
  const desktop = el("div", { class: "os-desktop", "data-wallpaper": savedWallpaper });
  const windowsLayer = el("div", { class: "os-windows-layer" });
  const dragShield = el("div", { class: "os-drag-shield" });
  const toastStack = el("div", { class: "os-toast-stack" });

  function osToast(msg) {
    const t = el("div", { class: "os-toast" }, msg);
    toastStack.append(t);
    setTimeout(() => t.remove(), 3400);
  }

  function closeOsPopover() {
    if (activePopover) {
      activePopover.remove();
      activePopover = null;
    }
  }
  document.addEventListener("pointerdown", (e) => {
    if (activePopover && !activePopover.contains(e.target) && !e.target.closest?.("[data-os-pop-trigger]")) {
      closeOsPopover();
    }
  });

  // ---- TOP STATUS BAR ----
  const activeTitleEl = el("span", { class: "os-active-title" }, "WoxOS Desktop");
  const clockEl = el("span", { class: "os-clock" }, "");
  const gpuPillText = el("span", {}, "GPU Ready");
  const hubBadge = el("span", {}, "⇄ Hub (0)");

  function updateClock() {
    const now = new Date();
    const str = now.toLocaleString("it-IT", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    clockEl.textContent = str.charAt(0).toUpperCase() + str.slice(1);
  }
  updateClock();
  setInterval(updateClock, 15000);

  async function pollOsGpu() {
    try {
      const g = await api("/api/gpu");
      if (g?.device) {
        gpuPillText.textContent = g.warm ? `${g.device.split(" ").slice(-2).join(" ")} · Warm` : g.device.split(" ").slice(-2).join(" ");
      }
    } catch {
      gpuPillText.textContent = "Local GPU";
    }
  }
  pollOsGpu();
  setInterval(pollOsGpu, 20000);

  const topbar = el(
    "header",
    { class: "os-topbar" },
    el(
      "div",
      { class: "os-top-left" },
      el(
        "button",
        {
          class: "os-top-btn brand",
          type: "button",
          "data-os-pop-trigger": "1",
          title: "Menu WoxOS (Salva Layout, Desktop, Sistema)",
          onclick: (e) => openWoxSystemMenu(e.currentTarget),
        },
        el("span", { class: "os-brand-dot" }),
        "WoxOS"
      ),
      el(
        "button",
        { class: "os-top-btn", type: "button", title: "Apri menu Applicazioni (macOS)", onclick: () => toggleApplicationsWindow() },
        "Apps"
      ),
      el(
        "button",
        { class: "os-top-btn", type: "button", title: "Apri / Mostra App Carosello", onclick: () => toggleCaroselloWindow() },
        "🎠 Carosello"
      ),
      el(
        "button",
        { class: "os-top-btn", type: "button", title: "Apri Auto-Installer & Opzioni", onclick: () => openSettingsModal({ tab: "installer" }) },
        "⚙️ Auto Install"
      ),
      el(
        "button",
        { class: "os-top-btn", type: "button", title: "Cambia finestra attiva (Alt+Q o Ctrl+\\)", onclick: () => cycleWindows(1) },
        "⇄ Switch (Alt+Q)"
      ),
      el(
        "button",
        { class: "os-top-btn", type: "button", title: "Affianca tutte le finestre", onclick: () => tileWindows() },
        "◫ Tile"
      ),
      el(
        "button",
        { class: "os-top-btn", type: "button", title: "Disponi a cascata", onclick: () => cascadeWindows() },
        "❐ Cascade"
      ),
      activeTitleEl
    ),
    el("div", { class: "os-top-center" }, clockEl),
    el(
      "div",
      { class: "os-top-right" },
      el(
        "button",
        {
          class: "os-status-pill",
          type: "button",
          "data-os-pop-trigger": "1",
          title: "Hub condiviso tra finestre",
          onclick: (e) => openSharedHubPopover(e.currentTarget),
        },
        hubBadge
      ),
      el(
        "button",
        {
          class: "os-status-pill",
          type: "button",
          "data-os-pop-trigger": "1",
          title: "Impostazioni Rapide WoxOS",
          onclick: (e) => openQuickSettings(e.currentTarget),
        },
        el("span", { class: "os-dot-live" }),
        gpuPillText,
        " ▾"
      )
    )
  );

  // ---- CENTERED START / DOCK BAR (Supports Drag & Drop from Applications + Reorder) ----
  const DOCK_STORAGE_KEY = "wox.os.dock.v1";
  const DEFAULT_PINNED_IDS = SPECIAL_APPS.filter((a) => a.pinned).map((a) => a.id);
  let pinnedAppIds = (() => {
    try {
      const saved = JSON.parse(localStorage.getItem(DOCK_STORAGE_KEY) || "null");
      if (Array.isArray(saved) && saved.length) {
        const valid = saved.filter((id) => appLookup.has(id));
        if (valid.length) return valid;
      }
    } catch { /* fallback to default */ }
    return [...DEFAULT_PINNED_IDS];
  })();

  function persistDockPins() {
    try { localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify(pinnedAppIds)); } catch { /* ignore */ }
  }

  function pinAppToDock(appId, beforeAppId = null) {
    if (!appId || !appLookup.has(appId)) return;
    const existed = pinnedAppIds.includes(appId);
    pinnedAppIds = pinnedAppIds.filter((id) => id !== appId);
    if (beforeAppId && pinnedAppIds.includes(beforeAppId)) {
      pinnedAppIds.splice(pinnedAppIds.indexOf(beforeAppId), 0, appId);
    } else {
      pinnedAppIds.push(appId);
    }
    persistDockPins();
    renderDock();
    const app = appLookup.get(appId);
    if (!existed) osToast(`📌 "${app?.name || appId}" aggiunta alla barra Start!`);
  }

  function unpinAppFromDock(appId) {
    if (!pinnedAppIds.includes(appId)) return;
    pinnedAppIds = pinnedAppIds.filter((id) => id !== appId);
    persistDockPins();
    renderDock();
    const app = appLookup.get(appId);
    osToast(`Rimossa "${app?.name || appId}" dalla barra Start`);
  }

  const dockEl = el("nav", { class: "os-dock", "aria-label": "WoxOS Start Dock" });
  dockEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    dockEl.classList.add("drag-over");
  });
  dockEl.addEventListener("dragleave", (e) => {
    if (!dockEl.contains(e.relatedTarget)) dockEl.classList.remove("drag-over");
  });
  dockEl.addEventListener("drop", (e) => {
    e.preventDefault();
    dockEl.classList.remove("drag-over");
    const appId = e.dataTransfer?.getData("text/wox-app-id") || e.dataTransfer?.getData("text/plain");
    if (!appId || !appLookup.has(appId)) return;
    const dropTarget = e.target.closest?.("[data-dock-app-id]");
    const beforeId = dropTarget?.getAttribute("data-dock-app-id") || null;
    pinAppToDock(appId, beforeId && beforeId !== appId ? beforeId : null);
  });

  const dockWrap = el("div", { class: "os-dock-wrap" }, dockEl);

  function renderDock() {
    const items = [];

    // Start / Applications Launcher button
    const finderWin = [...windows.values()].find((w) => w.appId === "__applications__");
    items.push(
      el(
        "button",
        {
          class: `os-dock-item start-btn${finderWin && !finderWin.minimized && focusedWinId === finderWin.id ? " focused" : ""}`,
          type: "button",
          title: "Applicazioni (Menu stile macOS — trascina un'app qui per fissarla)",
          onclick: () => toggleApplicationsWindow(),
        },
        "⊞",
        finderWin ? el("span", { class: "os-dock-dot" }) : null
      )
    );

    items.push(el("div", { class: "os-dock-sep" }));

    // Pinned apps (draggable to reorder, right-click to unpin)
    const pinnedIds = new Set();
    for (const pid of pinnedAppIds) {
      const app = appLookup.get(pid);
      if (!app) continue;
      pinnedIds.add(app.id);
      const running = [...windows.values()].find((w) => w.appId === app.id);
      const cls = [
        "os-dock-item",
        running && focusedWinId === running.id && !running.minimized ? "focused" : "",
        running && running.minimized ? "minimized" : "",
      ].filter(Boolean).join(" ");

      items.push(
        el(
          "button",
          {
            class: cls,
            type: "button",
            draggable: "true",
            "data-dock-app-id": app.id,
            title: running
              ? `${app.name} (${running.minimized ? "Ridotta a icona — clicca per ripristinare" : "Aperta"}) · Tasto destro per rimuovere`
              : `${app.name} · Trascina per riordinare, tasto destro per rimuovere`,
            style: { background: app.grad, padding: app.thumb ? "0" : undefined, overflow: "hidden" },
            ondragstart: (e) => {
              e.dataTransfer?.setData("text/wox-app-id", app.id);
              e.dataTransfer?.setData("text/plain", app.id);
              if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
            },
            oncontextmenu: (e) => {
              e.preventDefault();
              e.stopPropagation();
              unpinAppFromDock(app.id);
            },
            onclick: () => {
              if (running) {
                if (running.minimized) restoreWindow(running.id);
                else if (focusedWinId === running.id) minimizeWindow(running.id);
                else focusWindow(running.id);
              } else {
                openAppWindow(app.id);
              }
            },
          },
          appIconContent(app),
          running ? el("span", { class: "os-dock-dot" }) : null
        )
      );
    }

    // Extra open/minimized windows (not pinned)
    const extraWins = [...windows.values()].filter((w) => w.appId !== "__applications__" && !pinnedIds.has(w.appId));
    if (extraWins.length) {
      items.push(el("div", { class: "os-dock-sep" }));
      for (const w of extraWins) {
        const wApp = appLookup.get(w.appId) || w;
        const cls = [
          "os-dock-item",
          focusedWinId === w.id && !w.minimized ? "focused" : "",
          w.minimized ? "minimized" : "",
        ].filter(Boolean).join(" ");
        items.push(
          el(
            "button",
            {
              class: cls,
              type: "button",
              title: `${w.title}${w.minimized ? " (Ridotta a icona)" : ""}`,
              style: { background: w.grad, padding: wApp.thumb ? "0" : undefined, overflow: "hidden" },
              onclick: () => {
                if (w.minimized) restoreWindow(w.id);
                else if (focusedWinId === w.id) minimizeWindow(w.id);
                else focusWindow(w.id);
              },
            },
            appIconContent(wApp),
            el("span", { class: "os-dock-dot" })
          )
        );
      }
    }

    dockEl.replaceChildren(...items);
  }

  // ---- WINDOW MANAGEMENT ----
  function focusWindow(winId) {
    const rec = windows.get(winId);
    if (!rec) return;
    if (rec.minimized) {
      rec.minimized = false;
      rec.el.classList.remove("minimized");
    }
    zTop += 1;
    rec.el.style.zIndex = String(zTop);
    for (const [id, w] of windows) {
      w.el.classList.toggle("focused", id === winId);
    }
    focusedWinId = winId;
    activeTitleEl.textContent = rec.title;
    renderDock();
  }

  function minimizeWindow(winId) {
    const rec = windows.get(winId);
    if (!rec) return;
    rec.minimized = true;
    rec.el.classList.add("minimized");
    rec.el.classList.remove("focused");
    if (focusedWinId === winId) {
      focusedWinId = null;
      const next = [...windows.values()].filter((w) => !w.minimized).sort((a, b) => Number(b.el.style.zIndex) - Number(a.el.style.zIndex))[0];
      if (next) focusWindow(next.id);
      else activeTitleEl.textContent = "WoxOS Desktop";
    }
    renderDock();
  }

  function restoreWindow(winId) {
    const rec = windows.get(winId);
    if (!rec) return;
    rec.minimized = false;
    rec.el.classList.remove("minimized");
    focusWindow(winId);
  }

  function toggleMaximizeWindow(winId) {
    const rec = windows.get(winId);
    if (!rec) return;
    rec.maximized = !rec.maximized;
    rec.el.classList.toggle("maximized", rec.maximized);
    focusWindow(winId);
  }

  function closeWindow(winId) {
    const rec = windows.get(winId);
    if (!rec) return;
    rec.el.remove();
    windows.delete(winId);
    if (focusedWinId === winId) {
      focusedWinId = null;
      const next = [...windows.values()].filter((w) => !w.minimized).sort((a, b) => Number(b.el.style.zIndex) - Number(a.el.style.zIndex))[0];
      if (next) focusWindow(next.id);
      else activeTitleEl.textContent = "WoxOS Desktop";
    }
    renderDock();
  }

  function tileWindows() {
    const visible = [...windows.values()].filter((w) => !w.minimized);
    if (!visible.length) return;
    const topOffset = 82;
    const vw = window.innerWidth;
    const vh = window.innerHeight - 34 - topOffset - 16;
    const cols = visible.length === 1 ? 1 : visible.length <= 4 ? 2 : Math.ceil(Math.sqrt(visible.length));
    const rows = Math.ceil(visible.length / cols);
    const pad = 10;
    const cellW = Math.floor((vw - pad * (cols + 1)) / cols);
    const cellH = Math.floor((vh - pad * (rows + 1)) / rows);
    visible.forEach((w, idx) => {
      const c = idx % cols;
      const r = Math.floor(idx / cols);
      w.maximized = false;
      w.el.classList.remove("maximized");
      w.el.style.left = `${pad + c * (cellW + pad)}px`;
      w.el.style.top = `${topOffset + pad + r * (cellH + pad)}px`;
      w.el.style.width = `${cellW}px`;
      w.el.style.height = `${cellH}px`;
    });
    osToast(`Affiancate ${visible.length} finestre`);
  }

  function cascadeWindows() {
    const visible = [...windows.values()].filter((w) => !w.minimized);
    const vw = window.innerWidth;
    const vh = window.innerHeight - 34 - 120;
    const w = Math.min(1180, Math.floor(vw * 0.84));
    const h = Math.min(480, Math.floor(vh * 0.62));
    visible.forEach((rec, i) => {
      rec.maximized = false;
      rec.el.classList.remove("maximized");
      rec.el.style.left = `${28 + i * 32}px`;
      rec.el.style.top = `${110 + i * 28}px`;
      rec.el.style.width = `${w}px`;
      rec.el.style.height = `${h}px`;
      focusWindow(rec.id);
    });
  }

  function makeDraggableAndResizable(rec, titlebar) {
    titlebar.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      focusWindow(rec.id);
      if (rec.maximized) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const rect = rec.el.getBoundingClientRect();
      const origLeft = rect.left;
      const origTop = rect.top - 34;

      rec.el.classList.add("dragging");
      dragShield.classList.add("active");
      dragShield.style.cursor = "grabbing";

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        rec.el.style.left = `${Math.max(-rect.width + 120, Math.min(window.innerWidth - 120, origLeft + dx))}px`;
        rec.el.style.top = `${Math.max(0, Math.min(window.innerHeight - 90, origTop + dy))}px`;
      };
      const onUp = () => {
        rec.el.classList.remove("dragging");
        dragShield.classList.remove("active");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });

    titlebar.addEventListener("dblclick", (e) => {
      if (e.target.closest("button")) return;
      toggleMaximizeWindow(rec.id);
    });

    for (const dir of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
      const handle = el("div", { class: `os-resizer ${dir}` });
      handle.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        if (rec.maximized) return;
        focusWindow(rec.id);
        const startX = e.clientX;
        const startY = e.clientY;
        const rect = rec.el.getBoundingClientRect();
        const origL = rect.left;
        const origT = rect.top - 34;
        const origW = rect.width;
        const origH = rect.height;

        rec.el.classList.add("resizing");
        dragShield.classList.add("active");
        dragShield.style.cursor = getComputedStyle(handle).cursor;

        const onMove = (ev) => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          let l = origL, t = origT, w = origW, h = origH;
          if (dir.includes("e")) w = Math.max(380, origW + dx);
          if (dir.includes("s")) h = Math.max(260, origH + dy);
          if (dir.includes("w")) {
            w = Math.max(380, origW - dx);
            l = origL + (origW - w);
          }
          if (dir.includes("n")) {
            h = Math.max(260, origH - dy);
            t = Math.max(0, origT + (origH - h));
          }
          rec.el.style.left = `${l}px`;
          rec.el.style.top = `${t}px`;
          rec.el.style.width = `${w}px`;
          rec.el.style.height = `${h}px`;
        };
        const onUp = () => {
          rec.el.classList.remove("resizing");
          dragShield.classList.remove("active");
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      });
      rec.el.append(handle);
    }
  }

  function createWindowFrame({ appId, title, displayUrl, glyph, grad, width, height, left, top, bodyNode, iframe, onSend }) {
    winCounter += 1;
    const id = `win-${winCounter}`;
    const vw = window.innerWidth;
    const vh = window.innerHeight - 34;
    const w = Math.min(width || 650, vw - 16);
    const h = Math.min(height || 1005, vh - 84);
    const offset = ((winCounter - 1) % 6) * 22;
    const l = left !== undefined ? left : Math.max(8, Math.floor((vw - w) / 2) + offset);
    const t = top !== undefined ? top : Math.max(8, 12 + offset);

    const actions = [];
    if (onSend) {
      actions.push(
        el(
          "button",
          {
            class: "os-win-act",
            type: "button",
            "data-os-pop-trigger": "1",
            title: "Invia output/media a un'altra finestra aperta",
            onclick: (e) => {
              e.stopPropagation();
              onSend(e.currentTarget, id);
            },
          },
          "⇄ Invia"
        )
      );
    }
    if (iframe) {
      actions.push(
        el(
          "button",
          {
            class: "os-win-act",
            type: "button",
            title: "Ricarica finestra",
            onclick: (e) => {
              e.stopPropagation();
              iframe.src = iframe.src;
            },
          },
          "↻"
        )
      );
    }

    const titlebar = el(
      "div",
      { class: "os-win-titlebar" },
      el("div", { class: "os-win-actions" }, ...actions),
      el(
        "div",
        { class: "os-win-center" },
        el("span", { class: "os-win-icon", style: { background: grad, overflow: "hidden" } }, appIconContent(appLookup.get(appId) || { glyph, name: title })),
        el("span", { class: "os-win-title" }, title),
        displayUrl ? el("span", { class: "os-win-url", title: displayUrl }, displayUrl) : null
      ),
      el(
        "div",
        { class: "os-traffic" },
        el("button", { class: "os-tl min", type: "button", title: "Riduci a icona", onclick: (e) => { e.stopPropagation(); minimizeWindow(id); } }, "−"),
        el("button", { class: "os-tl max", type: "button", title: "Tutto schermo / Ripristina", onclick: (e) => { e.stopPropagation(); toggleMaximizeWindow(id); } }, "+"),
        el("button", { class: "os-tl close", type: "button", title: "Chiudi", onclick: (e) => { e.stopPropagation(); closeWindow(id); } }, "×")
      )
    );

    const winEl = el(
      "section",
      {
        class: "os-window",
        style: { left: `${l}px`, top: `${t}px`, width: `${w}px`, height: `${h}px` },
        onpointerdown: () => focusWindow(id),
      },
      titlebar,
      el("div", { class: "os-win-body" }, bodyNode)
    );

    const rec = { id, appId, title, displayUrl, glyph, grad, el: winEl, iframe: iframe || null, minimized: false, maximized: false, lastOutput: null };
    makeDraggableAndResizable(rec, titlebar);
    windows.set(id, rec);
    windowsLayer.append(winEl);
    focusWindow(id);
    return rec;
  }

  function openAppWindow(appId, opts = {}) {
    if (appId === "__carosello__") return toggleCaroselloWindow();
    if (appId === "__installer__") { openSettingsModal({ tab: "installer" }); return null; }
    const info = appLookup.get(appId) || {
      id: appId,
      name: appId,
      route: `#/app/${appId}`,
      glyph: "⚡",
      grad: hashColor(appId),
    };

    const nextWinId = `win-${winCounter + 1}`;
    const route = opts.routeOverride || info.route;
    const iframeSrc = info.external
      ? `${route}?os_win=1&win_id=${nextWinId}`
      : `/?os_win=1&win_id=${nextWinId}${route}`;
    const displayUrl = info.external
      ? `${location.origin}${route}`
      : `${location.origin}/${info.route}`;

    const iframe = el("iframe", {
      class: "os-win-iframe",
      src: iframeSrc,
      allow: "clipboard-read; clipboard-write; autoplay; microphone; camera; fullscreen",
    });

    const rec = createWindowFrame({
      appId: info.id,
      title: info.name,
      displayUrl,
      glyph: info.glyph,
      grad: info.grad,
      width: opts.width ?? 650,
      height: opts.height ?? 1005,
      left: opts.left,
      top: opts.top,
      bodyNode: iframe,
      iframe,
      onSend: (anchor, winId) => openSendWindowPopover(anchor, winId),
    });
    rec.iframeLoaded = false;

    if (opts.inject) {
      const q = pendingInjections.get(rec.id) || [];
      q.push(opts.inject);
      pendingInjections.set(rec.id, q);
    }

    iframe.addEventListener("load", () => {
      rec.iframeLoaded = true;
      if (info.external) {
        const queued = pendingInjections.get(rec.id);
        if (queued?.length) {
          pendingInjections.delete(rec.id);
          for (const payload of queued) {
            setTimeout(() => deliverToWindow(rec, payload), 450);
          }
        }
      }
    });

    return rec;
  }

  // ---- STANDALONE APP CAROSELLO (floating, draggable, resizable) ----
  function toggleCaroselloWindow() {
    const existing = [...windows.values()].find((w) => w.appId === "__carosello__");
    if (existing) {
      if (existing.minimized) restoreWindow(existing.id);
      else if (focusedWinId === existing.id) minimizeWindow(existing.id);
      else focusWindow(existing.id);
      return existing;
    }

    let items = [];
    let idx = 0;
    const stageEl = el("div", { class: "os-car-stage" });
    const infoEl = el("span", { class: "os-car-info" }, "Caricamento carosello...");
    const countEl = el("span", { style: { fontWeight: "700", color: "var(--os-accent)", flexShrink: "0" } }, "0/0");

    function renderSlide() {
      if (!items.length) {
        stageEl.replaceChildren(el("div", { style: { color: "var(--os-muted)", fontSize: "13px" } }, "Nessun media generato ancora. Genera un video o un'immagine e apparirà qui!"));
        infoEl.textContent = "Carosello vuoto";
        countEl.textContent = "0/0";
        return;
      }
      idx = ((idx % items.length) + items.length) % items.length;
      const it = items[idx];
      const media = it.type === "video"
        ? el("video", { class: "os-car-media", src: it.url, controls: true, autoplay: true, muted: true, loop: true, playsinline: true })
        : it.type === "audio"
          ? el("audio", { src: it.url, controls: true, style: { width: "80%" } })
          : el("img", { class: "os-car-media", src: it.url, alt: it.name });

      stageEl.replaceChildren(
        el("button", { class: "os-car-nav prev", type: "button", title: "Precedente", onclick: () => { idx -= 1; renderSlide(); } }, "‹"),
        media,
        el("button", { class: "os-car-nav next", type: "button", title: "Successivo", onclick: () => { idx += 1; renderSlide(); } }, "›")
      );
      infoEl.textContent = `${it.app || "WoxOS"} · ${it.prompt || it.name}`;
      countEl.textContent = `${idx + 1} / ${items.length}`;
    }

    async function loadSlides() {
      try {
        const res = await api("/api/history?limit=60");
        const runs = Array.isArray(res) ? res : (res?.entries || res?.items || res?.runs || []);
        const next = [];
        for (const r of runs) {
          for (const o of r.outputs || []) {
            if (!["image", "video", "audio"].includes(o.type)) continue;
            next.push({
              url: o.url || `/api/history/${r.id}/files/${o.file}`,
              name: o.name || o.file,
              type: o.type,
              app: r.app,
              prompt: r.values?.prompt || r.values?.line || "",
            });
          }
        }
        items = next;
        renderSlide();
      } catch {
        infoEl.textContent = "Impossibile caricare la cronologia";
      }
    }

    const editorBtn = el(
      "button",
      {
        class: "os-widget-btn",
        type: "button",
        title: "Invia direttamente alla Timeline di Video Studio Editor",
        onclick: () => {
          const it = items[idx];
          if (!it) return;
          const existing = [...windows.values()].find((w) => w.appId === "video-editor");
          if (existing) void importIntoVideoEditorWindow(existing, it);
          else openAppWindow("video-editor", { inject: { item: it } });
        },
      },
      "🎞️ Editor"
    );

    const sendBtn = el(
      "button",
      {
        class: "os-widget-btn",
        type: "button",
        "data-os-pop-trigger": "1",
        onclick: (e) => {
          const it = items[idx];
          if (!it) return;
          rec.lastOutput = it;
          const others = [...windows.values()].filter((w) => w.id !== rec.id && w.iframe);
          if (others.length === 1) deliverToWindow(others[0], { item: it });
          else openSendWindowPopover(e.currentTarget, rec.id);
        },
      },
      "⇄ Invia"
    );

    const refreshBtn = el("button", { class: "os-widget-btn", type: "button", onclick: () => loadSlides() }, "↻");

    const carNode = el(
      "div",
      { class: "os-carousel-app" },
      stageEl,
      el("div", { class: "os-car-bar" }, countEl, infoEl, el("div", { class: "os-widget-actions" }, editorBtn, sendBtn, refreshBtn))
    );

    const rec = createWindowFrame({
      appId: "__carosello__",
      title: "Carosello",
      displayUrl: "WoxOS ▸ Carosello Media",
      glyph: "🎠",
      grad: "linear-gradient(135deg, #a855f7 0%, #3b82f6 100%)",
      width: 650,
      height: 1005,
      bodyNode: carNode,
    });

    loadSlides();
    osBus.on((msg) => {
      if (msg.type === "wox:generation-done") loadSlides();
    });
    return rec;
  }

  // ---- macOS FINDER-STYLE APPLICATIONS WINDOW ----
  function toggleApplicationsWindow() {
    const existing = [...windows.values()].find((w) => w.appId === "__applications__");
    if (existing) {
      if (existing.minimized) restoreWindow(existing.id);
      else if (focusedWinId === existing.id) minimizeWindow(existing.id);
      else focusWindow(existing.id);
      return;
    }

    let activeCat = "all";
    let searchQ = "";
    let viewMode = "grid";
    let iconSize = 64;

    const categories = [
      { id: "all", label: "Applications", icon: "🅰️" },
      { id: "video", label: "Video & Cinema", icon: "🎬" },
      { id: "image", label: "Image & Photo", icon: "🖼️" },
      { id: "3d", label: "3D & Spatial", icon: "🧊" },
      { id: "audio", label: "Audio & Voice", icon: "🎵" },
      { id: "studio", label: "Studios & Editors", icon: "✨" },
      { id: "system", label: "Library & System", icon: "⚙️" },
    ];

    const gridEl = el("div", { class: "os-finder-grid" });
    const titleEl = el("span", { class: "os-finder-title" }, "Applications");
    const statusText = el("span", {}, "");
    const navWrap = el("div", { class: "os-finder-nav" });

    function filtered() {
      const q = searchQ.trim().toLowerCase();
      return allApps.filter((a) => {
        if (activeCat !== "all" && a.category !== activeCat) return false;
        if (!q) return true;
        return a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q) || (a.summary || "").toLowerCase().includes(q);
      });
    }

    function renderSidebar() {
      navWrap.replaceChildren(
        ...categories.map((c) => {
          const count = c.id === "all" ? allApps.length : allApps.filter((a) => a.category === c.id).length;
          return el(
            "button",
            {
              class: `os-finder-nav-btn${activeCat === c.id ? " active" : ""}`,
              type: "button",
              onclick: () => {
                activeCat = c.id;
                titleEl.textContent = c.label;
                renderSidebar();
                renderGrid();
              },
            },
            el("span", {}, c.icon),
            el("span", {}, c.label),
            el("span", { class: "os-finder-nav-count" }, String(count))
          );
        })
      );
    }

    function renderGrid() {
      const list = filtered();
      gridEl.classList.toggle("list-mode", viewMode === "list");
      gridEl.style.setProperty("--os-icon-size", `${iconSize}px`);
      gridEl.style.setProperty("--os-icon-cell", `${Math.max(88, iconSize + 40)}px`);

      gridEl.replaceChildren(
        ...list.map((app) =>
          el(
            "button",
            {
              class: "os-app-tile",
              type: "button",
              draggable: "true",
              title: `${app.name}${app.summary ? ` — ${app.summary}` : ""} (Trascina nella barra Start in basso per fissarla)`,
              ondragstart: (e) => {
                e.dataTransfer?.setData("text/wox-app-id", app.id);
                e.dataTransfer?.setData("text/plain", app.id);
                if (e.dataTransfer) e.dataTransfer.effectAllowed = "copyMove";
              },
              onclick: () => {
                openAppWindow(app.id);
              },
            },
            el("div", { class: "os-app-squircle", style: { background: app.grad } }, appIconContent(app)),
            el("span", { class: "os-app-name" }, app.name),
            viewMode === "list" ? el("span", { class: "os-app-sub" }, app.category) : null
          )
        )
      );
      statusText.textContent = `${list.length} items · WoxOS Applications`;
    }

    const searchInput = el("input", {
      class: "os-finder-search",
      type: "search",
      placeholder: "Cerca app...",
      oninput: (e) => {
        searchQ = e.target.value;
        renderGrid();
      },
    });

    const btnGrid = el("button", {
      class: "active",
      type: "button",
      title: "Vista Griglia",
      onclick: () => {
        viewMode = "grid";
        btnGrid.classList.add("active");
        btnList.classList.remove("active");
        renderGrid();
      },
    }, "⊞");
    const btnList = el("button", {
      type: "button",
      title: "Vista Lista",
      onclick: () => {
        viewMode = "list";
        btnList.classList.add("active");
        btnGrid.classList.remove("active");
        renderGrid();
      },
    }, "☰");

    const sizeSlider = el("input", {
      type: "range",
      min: "48",
      max: "92",
      value: String(iconSize),
      style: { width: "90px", accentColor: "#e8ff5a" },
      oninput: (e) => {
        iconSize = Number(e.target.value);
        renderGrid();
      },
    });

    const finderNode = el(
      "div",
      { class: "os-finder" },
      el(
        "aside",
        { class: "os-finder-sidebar" },
        el("div", {}, el("div", { class: "os-finder-sec-title" }, "Favorites"), navWrap)
      ),
      el(
        "div",
        { class: "os-finder-main" },
        el(
          "div",
          { class: "os-finder-toolbar" },
          titleEl,
          el("div", { class: "os-finder-tools" }, el("div", { class: "os-finder-seg" }, btnGrid, btnList), searchInput)
        ),
        gridEl,
        el("div", { class: "os-finder-status" }, statusText, sizeSlider)
      )
    );

    renderSidebar();
    renderGrid();

    createWindowFrame({
      appId: "__applications__",
      title: "Applications",
      displayUrl: "WoxOS ▸ Applications",
      glyph: "⊞",
      grad: "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)",
      width: 650,
      height: 1005,
      bodyNode: finderNode,
    });
  }

  // ---- INTER-WINDOW SHARE & HUB POPOVERS ----
  function updateHubBadge() {
    hubBadge.textContent = `⇄ Hub (${sharedAssets.length})`;
  }

  async function importIntoVideoEditorWindow(targetRec, item) {
    if (!targetRec?.iframe || !item) return;
    focusWindow(targetRec.id);
    const rawUrl = item.url || item.full || item.src;
    if (!rawUrl) {
      osToast("Nessun media trovato da inviare a Video Studio Editor");
      return;
    }
    const absUrl = new URL(rawUrl, location.origin).href;
    const type = item.type || (/\.(mp4|webm|mov|mkv)(\?|$)/i.test(absUrl) ? "video" : /\.(mp3|wav|ogg|m4a)(\?|$)/i.test(absUrl) ? "audio" : "image");
    const name = item.fileName || item.name || item.file || (type === "video" ? "clip.mp4" : type === "audio" ? "audio.mp3" : "immagine.png");
    const mime = item.mime || (type === "video" ? "video/mp4" : type === "audio" ? "audio/mpeg" : "image/png");

    osToast(`🎞️ Caricamento "${name}" in Video Studio Editor...`);

    const runImport = async () => {
      try {
        const win = targetRec.iframe?.contentWindow;
        for (let i = 0; i < 60 && !win?.vs?.importMediaFiles; i++) {
          await new Promise((r) => setTimeout(r, 100));
        }
        if (win?.vs?.importMediaFiles) {
          const resp = await win.fetch(absUrl);
          const blob = await resp.blob();
          const file = new win.File([blob], name, { type: mime || blob.type });
          const assets = await win.vs.importMediaFiles([file], { addToTimeline: true });
          if (assets && assets.length > 0) {
            osToast(`✔ "${name}" aggiunto alla Timeline di Video Studio Editor!`);
            return;
          }
        }
      } catch (err) {
        console.warn("[WoxOS] direct Video Studio import fallback:", err);
      }
      targetRec.iframe?.contentWindow?.postMessage(
        { type: "WOX_IMPORT_MEDIA", url: absUrl, name, mime, addToTimeline: true },
        "*"
      );
    };

    if (targetRec.iframeLoaded) {
      await runImport();
    } else {
      targetRec.iframe.addEventListener("load", () => setTimeout(runImport, 500), { once: true });
    }
  }

  function deliverToWindow(targetRec, payload) {
    if (!targetRec?.iframe) return;
    if (targetRec.appId === "video-editor" && payload?.item) {
      void importIntoVideoEditorWindow(targetRec, payload.item);
      return;
    }
    osBus.sendToFrame(targetRec.iframe, {
      type: "wox:inject-media",
      item: payload.item,
      slotId: payload.slotId || null,
      prompt: payload.prompt || null,
    });
    focusWindow(targetRec.id);
    osToast(`Inviato a ${targetRec.title}`);
  }

  function openSendWindowPopover(anchor, sourceWinId) {
    closeOsPopover();
    const src = windows.get(sourceWinId);
    const others = [...windows.values()].filter((w) => w.id !== sourceWinId && w.iframe);
    const asset = src?.lastOutput || sharedAssets[0] || null;
    const rect = anchor.getBoundingClientRect();

    const list = el("div", { class: "os-pop-list" });
    if (!asset) {
      list.append(el("div", { style: { fontSize: "12px", color: "var(--os-muted)", padding: "6px" } }, "Genera un media o usa 'Use in' dentro un'app: comparirà qui per inviarlo subito alle altre finestre."));
    } else if (!others.length) {
      list.append(
        el(
          "button",
          {
            class: "os-pop-item",
            type: "button",
            onclick: () => {
              closeOsPopover();
              openAppWindow(src?.appId === "cinema-video" ? "cinema-studio" : "cinema-video", { inject: { item: asset } });
            },
          },
          "➕ Apri nuova finestra e invia"
        )
      );
    } else {
      for (const target of others) {
        list.append(
          el(
            "button",
            {
              class: "os-pop-item",
              type: "button",
              onclick: () => {
                closeOsPopover();
                deliverToWindow(target, { item: asset });
              },
            },
            el("span", {}, target.glyph),
            el("span", {}, `Invia a ${target.title}`)
          )
        );
      }
      if (!others.some((w) => w.appId === "video-editor")) {
        list.append(
          el(
            "button",
            {
              class: "os-pop-item",
              type: "button",
              onclick: () => {
                closeOsPopover();
                openAppWindow("video-editor", { inject: { item: asset } });
              },
            },
            el("span", {}, "🎞️"),
            el("span", {}, "Apri & Invia a Video Studio Editor")
          )
        );
      }
    }

    activePopover = el(
      "div",
      { class: "os-popover", style: { top: `${rect.bottom + 8}px`, right: `${Math.max(12, window.innerWidth - rect.right)}px` } },
      el("div", { class: "os-pop-title" }, "Comunicazione tra Finestre"),
      list
    );
    document.body.append(activePopover);
  }

  function openSharedHubPopover(anchor) {
    closeOsPopover();
    const rect = anchor.getBoundingClientRect();
    const list = el("div", { class: "os-pop-list" });
    if (!sharedAssets.length) {
      list.append(el("div", { style: { fontSize: "12px", color: "var(--os-muted)", padding: "6px" } }, "Nessun media condiviso ancora. Appena una finestra genera un video/immagine, apparirà qui."));
    } else {
      for (const item of sharedAssets.slice(0, 8)) {
        list.append(
          el(
            "button",
            {
              class: "os-pop-item",
              type: "button",
              onclick: () => {
                closeOsPopover();
                const target = windows.get(focusedWinId);
                if (target?.iframe) deliverToWindow(target, { item });
                else openAppWindow("cinema-video", { inject: { item } });
              },
            },
            el("span", {}, item.type === "video" ? "🎬" : item.type === "audio" ? "🎵" : "🖼️"),
            el("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, item.name || item.url || "Output")
          )
        );
      }
    }
    activePopover = el(
      "div",
      { class: "os-popover", style: { top: `${rect.bottom + 8}px`, right: "14px" } },
      el("div", { class: "os-pop-title" }, "WoxOS Shared Hub (Clicca per inviare alla finestra attiva)"),
      list
    );
    document.body.append(activePopover);
  }

  function openQuickSettings(anchor) {
    closeOsPopover();
    const rect = anchor.getBoundingClientRect();
    const curWp = desktop.getAttribute("data-wallpaper") || "aurora";
    const wallpapers = [
      { id: "aurora", label: "🌌 Aurora" },
      { id: "ocean", label: "🌊 Ocean" },
      { id: "lime", label: "⚡ Cyber Lime" },
      { id: "obsidian", label: "🖤 Obsidian" },
    ];

    activePopover = el(
      "div",
      { class: "os-popover", style: { top: `${rect.bottom + 8}px`, right: "14px" } },
      el("div", { class: "os-pop-title" }, "WoxOS Quick Settings"),
      el(
        "div",
        { class: "os-pop-grid" },
        ...wallpapers.map((wp) =>
          el(
            "button",
            {
              class: `os-qs-tile${curWp === wp.id ? " active" : ""}`,
              type: "button",
              onclick: () => {
                desktop.setAttribute("data-wallpaper", wp.id);
                localStorage.setItem("wox.os.wallpaper", wp.id);
                closeOsPopover();
              },
            },
            wp.label
          )
        )
      ),
      el(
        "div",
        { class: "os-pop-grid" },
        el(
          "button",
          {
            class: "os-qs-tile",
            type: "button",
            onclick: () => {
              closeOsPopover();
              tileWindows();
            },
          },
          "◫ Affianca"
        ),
        el(
          "button",
          {
            class: "os-qs-tile",
            type: "button",
            onclick: () => {
              closeOsPopover();
              for (const w of windows.values()) minimizeWindow(w.id);
            },
          },
          "− Mostra Desktop"
        ),
        el(
          "button",
          {
            class: "os-qs-tile",
            type: "button",
            onclick: () => {
              location.href = "/?classic=1#/app/cinema-video";
            },
          },
          "↩ Vista Classica"
        ),
        el(
          "button",
          {
            class: "os-qs-tile",
            type: "button",
            onclick: () => {
              closeOsPopover();
              openAppWindow("vram");
            },
          },
          "📊 Monitor GPU"
        )
      )
    );
    document.body.append(activePopover);
  }

  // ---- LISTEN TO INTER-WINDOW BUS MESSAGES ----
  osBus.on((msg) => {
    if (msg.type === "wox:win-ready" && msg.winId) {
      const queued = pendingInjections.get(msg.winId);
      const rec = windows.get(msg.winId);
      if (queued?.length && rec) {
        pendingInjections.delete(msg.winId);
        for (const payload of queued) {
          setTimeout(() => deliverToWindow(rec, payload), 250);
        }
      }
    } else if (msg.type === "wox:focus" && msg.winId) {
      focusWindow(msg.winId);
    } else if (msg.type === "wox:cycle-windows") {
      cycleWindows(msg.dir || 1);
    } else if (msg.type === "wox:open-app" && msg.appId) {
      const existing = [...windows.values()].find((w) => w.appId === msg.appId);
      if (existing && !msg.newWindow) {
        focusWindow(existing.id);
        if (msg.inject) deliverToWindow(existing, msg.inject);
      } else {
        openAppWindow(msg.appId, { inject: msg.inject || null });
      }
    } else if (msg.type === "wox:send-to-editor" && msg.item) {
      sharedAssets.unshift(msg.item);
      if (sharedAssets.length > 20) sharedAssets.pop();
      updateHubBadge();
      const existing = [...windows.values()].find((w) => w.appId === "video-editor");
      if (existing) {
        void importIntoVideoEditorWindow(existing, msg.item);
      } else {
        openAppWindow("video-editor", { inject: { item: msg.item } });
      }
    } else if (msg.type === "wox:send-item" && msg.targetAppId && msg.item) {
      sharedAssets.unshift(msg.item);
      if (sharedAssets.length > 20) sharedAssets.pop();
      updateHubBadge();
      const existing = [...windows.values()].find((w) => w.appId === msg.targetAppId);
      if (existing) {
        deliverToWindow(existing, { item: msg.item, slotId: msg.slotId || null });
      } else {
        openAppWindow(msg.targetAppId, { inject: { item: msg.item, slotId: msg.slotId || null } });
      }
    } else if (msg.type === "wox:generation-done" && msg.item) {
      const src = msg.winId ? windows.get(msg.winId) : null;
      if (src) src.lastOutput = msg.item;
      sharedAssets.unshift(msg.item);
      if (sharedAssets.length > 20) sharedAssets.pop();
      updateHubBadge();
      // Relay to all other open windows so their libraries stay live in sync
      for (const w of windows.values()) {
        if (w.id !== msg.winId && w.iframe) {
          osBus.sendToFrame(w.iframe, { type: "wox:refresh-feed", item: msg.item });
        }
      }
      osToast(`✨ Nuovo output pronto (${msg.item.appName || "WoxOS"}) — condiviso con tutte le finestre`);
    }
  });

  // ---- PERSISTENT DRAGGABLE & RESIZABLE DESKTOP WIDGETS (GPU + SHELL + LIBRARY) ----
  let widgetZTop = 10;
  function makeWidgetMovableAndResizable(widgetEl, headEl) {
    widgetEl.addEventListener("pointerdown", () => {
      widgetZTop = widgetZTop >= 50 ? 11 : widgetZTop + 1;
      widgetEl.style.zIndex = String(widgetZTop);
    });

    headEl.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button") || e.target.closest("input")) return;
      if (widgetEl.classList.contains("maximized")) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const rect = widgetEl.getBoundingClientRect();
      widgetEl.style.bottom = "auto";
      widgetEl.style.right = "auto";
      widgetEl.style.left = `${rect.left}px`;
      widgetEl.style.top = `${rect.top}px`;
      dragShield.classList.add("active");
      dragShield.style.cursor = "grabbing";
      const onMove = (ev) => {
        widgetEl.style.left = `${Math.max(4, Math.min(window.innerWidth - 100, rect.left + (ev.clientX - startX)))}px`;
        widgetEl.style.top = `${Math.max(38, Math.min(window.innerHeight - 80, rect.top + (ev.clientY - startY)))}px`;
      };
      const onUp = () => {
        dragShield.classList.remove("active");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });

    headEl.addEventListener("dblclick", (e) => {
      if (e.target.closest("button")) return;
      widgetEl.classList.toggle("maximized");
    });

    for (const dir of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
      const handle = el("div", { class: `os-resizer ${dir}` });
      handle.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        if (widgetEl.classList.contains("maximized")) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const rect = widgetEl.getBoundingClientRect();
        widgetEl.style.bottom = "auto";
        widgetEl.style.right = "auto";
        const origL = rect.left, origT = rect.top, origW = rect.width, origH = rect.height;
        widgetEl.style.left = `${origL}px`;
        widgetEl.style.top = `${origT}px`;
        widgetEl.style.width = `${origW}px`;
        widgetEl.style.height = `${origH}px`;
        dragShield.classList.add("active");
        dragShield.style.cursor = getComputedStyle(handle).cursor;

        const onMove = (ev) => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          let l = origL, t = origT, w = origW, h = origH;
          if (dir.includes("e")) w = Math.max(260, origW + dx);
          if (dir.includes("s")) h = Math.max(150, origH + dy);
          if (dir.includes("w")) { w = Math.max(260, origW - dx); l = origL + (origW - w); }
          if (dir.includes("n")) { h = Math.max(150, origH - dy); t = Math.max(38, origT + (origH - h)); }
          widgetEl.style.left = `${l}px`;
          widgetEl.style.top = `${t}px`;
          widgetEl.style.width = `${w}px`;
          widgetEl.style.height = `${h}px`;
        };
        const onUp = () => {
          dragShield.classList.remove("active");
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      });
      widgetEl.append(handle);
    }
  }

  // ---- GPU WIDGET (Full Info + Click to Wake + Safe Mode + Resizable) ----
  let gpuData = null;
  const gpuBadgeDot = el("span", { class: "os-gpu-dot" });
  const gpuBadgeLabel = el("span", {}, "GPU INATTIVA");
  const gpuBadgeBtn = el(
    "button",
    {
      class: "os-gpu-badge",
      type: "button",
      style: { border: "none", cursor: "pointer" },
      title: "Clicca per svegliare / attivare la GPU",
      onclick: async () => {
        if (!gpuData?.warm) {
          gpuBadgeLabel.textContent = "SVEGLIO GPU...";
          try {
            gpuData = await api("/api/gpu/wake", { method: "POST" });
            osToast("⚡ Sveglia GPU avviata");
            await refreshGpuWidget();
          } catch (err) {
            osToast(`Errore GPU: ${err?.message || err}`);
          }
        } else {
          await refreshGpuWidget();
        }
      },
    },
    gpuBadgeDot,
    gpuBadgeLabel
  );

  const gpuBodyEl = el("div", { class: "os-widget-body" }, el("div", { class: "os-widget-meta" }, "Rilevamento GPU..."));

  function renderGpuBody() {
    const g = gpuData;
    const safe = g?.safe;
    const active = Boolean(g?.warm);
    gpuBadgeBtn.classList.toggle("active", active);
    gpuBadgeLabel.textContent = g?.waking ? "SVEGLIO..." : active ? "GPU ATTIVA" : "GPU INATTIVA";

    const nodes = [];
    if (!g?.configured) {
      nodes.push(el("div", { class: "os-widget-meta" }, "Backend GPU non configurato"));
    } else {
      nodes.push(el("div", { class: "os-widget-meta" }, `Backend: ${g.host || "locale"}${g.device?.name ? ` · ${g.device.name}` : ""}`));
      if (g.waking?.error) {
        nodes.push(el("div", { style: { color: "#f87171", fontSize: "11.5px" } }, String(g.waking.error)));
      }
      if (safe?.supported && (safe.current_temp !== null || safe.power_draw !== null)) {
        const stats = el("div", { class: "os-gpu-stats" });
        if (safe.current_temp !== null && safe.current_temp !== undefined) {
          const tv = Math.round(safe.current_temp);
          stats.append(el("div", { class: "os-stat-box" }, el("span", { style: { color: "var(--os-muted)" } }, "Temp"), el("b", { style: { color: tv >= 80 ? "#f87171" : tv >= 75 ? "#fbbf24" : "#34d399" } }, `${tv}°C`)));
        }
        if (safe.power_draw !== null && safe.power_draw !== undefined) {
          stats.append(el("div", { class: "os-stat-box" }, el("span", { style: { color: "var(--os-muted)" } }, "Power"), el("b", {}, `${Math.round(safe.power_draw)} W`)));
        }
        nodes.push(stats);
      }
      if (g.device?.vram_total_gb) {
        const pct = Math.min(100, Math.round((g.device.vram_used_gb / g.device.vram_total_gb) * 100));
        nodes.push(
          el(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "4px" } },
            el("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "11.5px" } },
              el("span", { style: { color: "var(--os-muted)" } }, "VRAM"),
              el("b", {}, `${g.device.vram_used_gb} / ${g.device.vram_total_gb} GB (${pct}%)`)
            ),
            el("div", { class: "os-vbar" }, el("i", { style: { width: `${pct}%` } }))
          )
        );
      }
      if (g.device?.app) {
        nodes.push(el("div", { class: "os-widget-meta" }, `Modello attivo: ${g.device.app}`));
      }
      if (safe?.supported) {
        const safeBtn = el(
          "button",
          {
            class: "os-widget-btn",
            type: "button",
            style: safe.enabled ? { background: "rgba(52,211,153,0.18)", color: "#34d399", borderColor: "rgba(52,211,153,0.35)" } : {},
            onclick: async () => {
              try {
                gpuData.safe = await api("/api/gpu/safe", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ enabled: !safe.enabled }),
                });
                renderGpuBody();
              } catch (err) {
                osToast(String(err?.message || err));
              }
            },
          },
          safe.enabled ? `Safe ON (${safe.threshold}°C)` : "Safe OFF"
        );
        const slider = el("input", {
          type: "range",
          min: "65",
          max: "88",
          value: String(safe.threshold || 78),
          style: { width: "76px", accentColor: "#e8ff5a" },
          onchange: async (e) => {
            try {
              gpuData.safe = await api("/api/gpu/safe", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ threshold: Number(e.target.value) }),
              });
              renderGpuBody();
            } catch { /* ignore */ }
          },
        });
        nodes.push(el("div", { class: "os-safe-row" }, el("span", {}, "🛡️ Safe Mode"), slider, safeBtn));
      }
    }

    nodes.push(
      el(
        "div",
        { class: "os-widget-actions", style: { flexWrap: "wrap" } },
        !active
          ? el("button", { class: "os-widget-btn", type: "button", onclick: () => gpuBadgeBtn.click() }, "⚡ Attiva GPU")
          : null,
        el(
          "button",
          {
            class: "os-widget-btn",
            type: "button",
            onclick: async () => {
              try {
                await api("/api/comfy/free", { method: "POST" });
                osToast("VRAM liberata");
                refreshGpuWidget();
              } catch {
                osToast("Impossibile liberare VRAM");
              }
            },
          },
          "🧹 Libera VRAM"
        ),
        el("button", { class: "os-widget-btn", type: "button", onclick: () => openAppWindow("vram") }, "📊 Mappa VRAM")
      )
    );

    gpuBodyEl.replaceChildren(...nodes);
  }

  async function refreshGpuWidget() {
    try {
      gpuData = await api("/api/gpu?device=1");
      renderGpuBody();
    } catch {
      gpuData = { configured: false, warm: false };
      renderGpuBody();
    }
  }
  refreshGpuWidget();
  setInterval(refreshGpuWidget, 4000);

  const gpuHead = el(
    "div",
    { class: "os-widget-head" },
    el("div", { class: "os-widget-title" }, "⚡ GPU"),
    el(
      "div",
      { class: "os-widget-actions" },
      gpuBadgeBtn,
      el("button", { class: "os-widget-btn", type: "button", title: "Espandi / Ripristina", onclick: () => gpuWidget.classList.toggle("maximized") }, "⤢")
    )
  );
  const gpuWidget = el(
    "section",
    {
      class: "os-widget",
      "aria-label": "Widget GPU",
      style: { left: "16px", bottom: "84px", width: "330px", height: "240px" },
    },
    gpuHead,
    gpuBodyEl
  );
  makeWidgetMovableAndResizable(gpuWidget, gpuHead);

  // ---- LIVE SHELL WIDGET (Full Features + Resizable as large as you want) ----
  let shellAutoScroll = true;
  let shellPaused = false;
  let shellRawText = "";
  const shellLogEl = el("div", { class: "os-shell-log" }, "// WoxOS Live Shell pronta...");

  function formatShellHtml(rawText) {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const lines = [];
    for (const r of rawText.split("\n")) {
      if (r.includes("\r")) {
        const parts = r.split("\r").map((p) => p.trimEnd()).filter(Boolean);
        if (parts.length) lines.push(parts[parts.length - 1]);
      } else {
        lines.push(r);
      }
    }
    return lines.slice(-160).map((line) => {
      const safe = esc(line);
      if (/error|exception|traceback|failed|oom/i.test(line)) return `<span class="log-err">${safe}</span>`;
      if (/warn|warning/i.test(line)) return `<span class="log-warn">${safe}</span>`;
      if (/100%|prompt executed|done|✓|saved/i.test(line)) return `<span class="log-ok">${safe}</span>`;
      return safe;
    }).join("\n");
  }

  async function refreshShellWidget() {
    if (shellPaused) return;
    try {
      const data = await api("/api/comfy/shell");
      const raw = typeof data === "string" ? data : (data?.logs || data?.output || data?.text || "");
      if (!raw || raw === shellRawText) return;
      shellRawText = raw;
      shellLogEl.innerHTML = formatShellHtml(raw) || '<span class="log-dim">// In attesa di output...</span>';
      if (shellAutoScroll) shellLogEl.scrollTop = shellLogEl.scrollHeight;
    } catch {
      /* keep previous log */
    }
  }
  refreshShellWidget();
  setInterval(refreshShellWidget, 2000);

  const btnAuto = el("button", {
    class: "os-widget-btn",
    type: "button",
    style: { color: "var(--os-accent)", borderColor: "rgba(232,255,90,0.35)" },
    onclick: () => {
      shellAutoScroll = !shellAutoScroll;
      btnAuto.textContent = shellAutoScroll ? "Auto-scroll" : "Scroll OFF";
      btnAuto.style.color = shellAutoScroll ? "var(--os-accent)" : "";
    },
  }, "Auto-scroll");

  const btnPause = el("button", {
    class: "os-widget-btn",
    type: "button",
    onclick: () => {
      shellPaused = !shellPaused;
      btnPause.textContent = shellPaused ? "▶ Riprendi" : "⏸ Pausa";
      if (!shellPaused) refreshShellWidget();
    },
  }, "⏸ Pausa");

  const shellHead = el(
    "div",
    { class: "os-widget-head" },
    el("div", { class: "os-widget-title" }, el("span", { class: "os-dot-live" }), ">_ SHELL LIVE"),
    el(
      "div",
      { class: "os-widget-actions" },
      btnAuto,
      btnPause,
      el("button", {
        class: "os-widget-btn",
        type: "button",
        onclick: () => {
          navigator.clipboard?.writeText(shellRawText || shellLogEl.textContent || "");
          osToast("Log copiati negli appunti");
        },
      }, "Copia"),
      el("button", {
        class: "os-widget-btn",
        type: "button",
        onclick: () => {
          shellRawText = "";
          shellLogEl.innerHTML = '<span class="log-dim">// Console pulita</span>';
        },
      }, "Pulisci"),
      el("button", {
        class: "os-widget-btn",
        type: "button",
        title: "Espandi / Ripristina",
        onclick: () => shellWidget.classList.toggle("maximized"),
      }, "⤢")
    )
  );

  const shellWidget = el(
    "section",
    {
      class: "os-widget",
      "aria-label": "Widget Shell",
      style: { right: "16px", bottom: "84px", width: "520px", height: "240px" },
    },
    shellHead,
    shellLogEl
  );
  makeWidgetMovableAndResizable(shellWidget, shellHead);

  // ---- PERSISTENT DESKTOP LIBRARY WIDGET (Small Thumbs + Hover Options + Resizable) ----
  let libFilter = "all";
  let libItems = [];
  const libGridEl = el("div", { class: "os-lib-grid" }, el("div", { class: "os-widget-meta" }, "Caricamento libreria..."));
  const libCountEl = el("span", { style: { fontSize: "11px", color: "var(--os-muted)" } }, "");

  function openLibLightbox(it) {
    const existing = [...windows.values()].find((w) => w.appId === "library");
    if (existing?.iframe) {
      focusWindow(existing.id);
      if (it?.runId) {
        osBus.sendToFrame(existing.iframe, { type: "wox:open-viewer-item", runId: it.runId });
      }
      return;
    }
    openAppWindow("library", {
      routeOverride: it?.runId ? `#/library?item=${encodeURIComponent(it.runId)}` : "#/library",
    });
  }

  function libTypeBadge(type) {
    const svg = type === "video"
      ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>'
      : type === "3d"
        ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M12 2l9 5v10l-9 5-9-5V7l9-5z"/><path d="M12 22V12M21 7l-9 5-9-5"/></svg>'
        : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.5" fill="currentColor"/><path d="M21 16l-5-5-6 6-2-2-5 5"/></svg>';
    const badge = el("span", { class: `os-lib-badge is-${type}`, title: type === "video" ? "Video" : type === "3d" ? "Oggetto 3D" : "Immagine" });
    badge.innerHTML = svg;
    return badge;
  }

  function renderLibGrid() {
    const list = libItems.filter((it) => libFilter === "all" || it.type === libFilter);
    libCountEl.textContent = `(${list.length})`;
    if (!list.length) {
      libGridEl.replaceChildren(el("div", { class: "os-widget-meta" }, "Nessun media trovato"));
      return;
    }
    libGridEl.replaceChildren(
      ...list.map((it) => {
        const mediaEl = it.type === "video"
          ? el("video", { src: it.url, muted: true, loop: true, playsinline: true, preload: "metadata" })
          : it.type === "3d"
            ? (it.previewUrl
                ? el("img", { src: it.previewUrl, loading: "lazy", alt: it.name })
                : el("div", { class: "os-lib-3d-placeholder" }, "3D GLB"))
            : el("img", { src: it.url, loading: "lazy", alt: it.name });

        const card = el(
          "div",
          {
            class: "os-lib-thumb",
            title: `${it.app || "WoxOS"} · ${it.name}`,
            onmouseenter: () => { if (it.type === "video") mediaEl.play?.().catch(() => {}); },
            onmouseleave: () => { if (it.type === "video") { mediaEl.pause?.(); mediaEl.currentTime = 0; } },
            onclick: () => openLibLightbox(it),
          },
          mediaEl,
          libTypeBadge(it.type)
        );
        return card;
      })
    );
  }

  let lastLibSig = "";
  async function refreshLibWidget(force = false) {
    try {
      const res = await api("/api/history?limit=80");
      const runs = Array.isArray(res) ? res : (res?.entries || res?.items || res?.runs || []);
      const next = [];
      for (const r of runs) {
        const fallbackPreview = (r.inputs || []).find((x) => x?.type === "image")?.url || null;
        for (const o of r.outputs || []) {
          const is3d = o.type === "3d" || /\.(glb|gltf|obj|fbx|ply)(\?|$)/i.test(o.file || o.name || "");
          if (o.type !== "image" && o.type !== "video" && !is3d) continue;
          next.push({
            runId: r.id,
            url: o.url || `/api/history/${r.id}/files/${o.file}`,
            previewUrl: is3d ? fallbackPreview : null,
            name: o.name || o.file,
            type: is3d ? "3d" : o.type,
            app: r.app,
            prompt: r.values?.prompt || r.values?.line || "",
          });
        }
      }
      const sig = `${next.length}:${next[0]?.runId || ""}:${next[0]?.url || ""}`;
      if (!force && sig === lastLibSig) return;
      lastLibSig = sig;
      libItems = next;
      renderLibGrid();
    } catch {
      if (!libItems.length) {
        libGridEl.replaceChildren(el("div", { class: "os-widget-meta" }, "Errore caricamento libreria"));
      }
    }
  }
  refreshLibWidget(true);
  setInterval(() => refreshLibWidget(false), 5000);
  osBus.on((msg) => {
    if (msg.type === "wox:generation-done") refreshLibWidget(true);
  });

  const libFilterBtns = [
    { id: "all", label: "Tutti" },
    { id: "video", label: "Video" },
    { id: "image", label: "Foto" },
    { id: "3d", label: "3D" },
  ].map((f) => {
    const b = el("button", {
      class: `os-lib-tab${f.id === "all" ? " active" : ""}`,
      type: "button",
      onclick: () => {
        libFilter = f.id;
        for (const x of libFilterBtns) x.classList.toggle("active", x === b);
        renderLibGrid();
      },
    }, f.label);
    return b;
  });

  const libHead = el(
    "div",
    { class: "os-widget-head" },
    el("div", { class: "os-widget-title" }, "LIBRERIA ", libCountEl),
    el(
      "div",
      { class: "os-widget-actions" },
      el("div", { class: "os-lib-filters" }, ...libFilterBtns),
      el("button", { class: "os-widget-btn", type: "button", title: "Aggiorna libreria", onclick: () => refreshLibWidget() }, "↻"),
      el("button", { class: "os-widget-btn", type: "button", title: "Espandi / Ripristina", onclick: () => libWidget.classList.toggle("maximized") }, "⤢")
    )
  );

  const libWidget = el(
    "section",
    {
      class: "os-widget",
      "aria-label": "Widget Libreria",
      style: { left: "16px", top: "48px", width: "330px", height: "420px" },
    },
    libHead,
    libGridEl
  );
  makeWidgetMovableAndResizable(libWidget, libHead);

  // Restore custom wallpaper if set
  const savedCustomWp = localStorage.getItem("wox.os.wallpaperCustom");
  if (savedCustomWp) {
    desktop.style.backgroundImage = `url("${savedCustomWp}")`;
    desktop.style.backgroundSize = "cover";
    desktop.style.backgroundPosition = "center";
  }

  function applyWallpaper(id, customDataUrl = null) {
    if (customDataUrl) {
      desktop.style.backgroundImage = `url("${customDataUrl}")`;
      desktop.style.backgroundSize = "cover";
      desktop.style.backgroundPosition = "center";
      desktop.setAttribute("data-wallpaper", "custom");
      try {
        localStorage.setItem("wox.os.wallpaper", "custom");
        localStorage.setItem("wox.os.wallpaperCustom", customDataUrl);
      } catch { /* quota */ }
    } else {
      desktop.style.backgroundImage = "";
      desktop.style.backgroundSize = "";
      desktop.style.backgroundPosition = "";
      desktop.setAttribute("data-wallpaper", id);
      localStorage.setItem("wox.os.wallpaper", id);
      localStorage.removeItem("wox.os.wallpaperCustom");
    }
  }

  // ---- DESKTOP OPTIONS WINDOW (Right-Click on Desktop) ----
  function openDesktopOptionsWindow() {
    const existing = [...windows.values()].find((w) => w.appId === "__desktop_prefs__");
    if (existing) {
      if (existing.minimized) restoreWindow(existing.id);
      else focusWindow(existing.id);
      return existing;
    }

    const presets = [
      { id: "aurora", name: "Aurora Nebula" },
      { id: "ocean", name: "Midnight Ocean" },
      { id: "lime", name: "Cyber Lime" },
      { id: "obsidian", name: "Obsidian Studio" },
    ];

    const wpGrid = el("div", { class: "os-wp-grid" });
    function renderWpCards() {
      const cur = desktop.getAttribute("data-wallpaper") || "aurora";
      wpGrid.replaceChildren(
        ...presets.map((p) =>
          el(
            "button",
            {
              class: `os-wp-card${cur === p.id ? " active" : ""}`,
              type: "button",
              onclick: () => {
                applyWallpaper(p.id);
                renderWpCards();
                if (typeof renderWpLibCards === "function") renderWpLibCards();
                osToast(`Wallpaper: ${p.name}`);
              },
            },
            el("div", { class: `os-wp-preview ${p.id}` }),
            el("div", { class: "os-wp-label" }, el("span", {}, p.name), cur === p.id ? el("span", { style: { color: "var(--os-accent)" } }, "Attivo") : null)
          )
        )
      );
    }
    renderWpCards();

    const wpLibGrid = el("div", { class: "os-wp-lib-grid" }, el("div", { class: "os-widget-meta" }, "Caricamento immagini libreria..."));

    function renderWpLibCards() {
      const curCustom = localStorage.getItem("wox.os.wallpaperCustom") || "";
      const imgs = libItems.filter((it) => it.type === "image");
      if (!imgs.length) {
        wpLibGrid.replaceChildren(el("div", { class: "os-widget-meta" }, "Nessuna immagine ancora in libreria"));
        return;
      }
      wpLibGrid.replaceChildren(
        ...imgs.map((it) =>
          el(
            "button",
            {
              class: `os-wp-lib-thumb${curCustom === it.url ? " active" : ""}`,
              type: "button",
              title: `${it.app || "Libreria"} · ${it.name}`,
              onclick: () => {
                applyWallpaper("custom", it.url);
                renderWpCards();
                renderWpLibCards();
                osToast(`Wallpaper impostato: ${it.name}`);
              },
            },
            el("img", { src: it.url, loading: "lazy", alt: it.name })
          )
        )
      );
    }

    if (libItems.length) {
      renderWpLibCards();
    } else {
      refreshLibWidget(true).then(() => renderWpLibCards());
    }

    const customInput = el("input", {
      type: "file",
      accept: "image/*",
      hidden: true,
      onchange: (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          applyWallpaper("custom", String(reader.result));
          renderWpCards();
          renderWpLibCards();
          osToast("Wallpaper personalizzato applicato");
        };
        reader.readAsDataURL(file);
      },
    });

    function widgetToggleBtn(label, widgetEl) {
      const isShown = () => widgetEl.style.display !== "none";
      const btn = el("button", {
        class: `os-qs-tile${isShown() ? " active" : ""}`,
        type: "button",
        onclick: () => {
          const next = !isShown();
          widgetEl.style.display = next ? "" : "none";
          btn.classList.toggle("active", next);
          btn.textContent = `${label}: ${next ? "ON" : "OFF"}`;
        },
      }, `${label}: ${isShown() ? "ON" : "OFF"}`);
      return btn;
    }

    const prefsBody = el(
      "div",
      { class: "os-desktop-prefs" },
      el(
        "section",
        { class: "os-prefs-sec" },
        el("h3", {}, "Cambia Wallpaper"),
        wpGrid,
        el("h3", { style: { marginTop: "6px" } }, "Immagini dalla tua Libreria"),
        wpLibGrid,
        el(
          "div",
          { class: "os-prefs-row" },
          customInput,
          el("button", { class: "os-widget-btn", type: "button", onclick: () => customInput.click() }, "Carica immagine dal PC...")
        )
      ),
      el(
        "section",
        { class: "os-prefs-sec" },
        el("h3", {}, "Widget sul Desktop"),
        el(
          "div",
          { class: "os-prefs-row" },
          widgetToggleBtn("Libreria", libWidget),
          widgetToggleBtn("GPU Monitor", gpuWidget),
          widgetToggleBtn("Shell Live", shellWidget)
        )
      ),
      el(
        "section",
        { class: "os-prefs-sec" },
        el("h3", {}, "Finestre & Sistema"),
        el(
          "div",
          { class: "os-prefs-row" },
          el("button", { class: "os-widget-btn", type: "button", onclick: () => tileWindows() }, "◫ Affianca finestre"),
          el("button", { class: "os-widget-btn", type: "button", onclick: () => cascadeWindows() }, "❐ Cascata"),
          el("button", { class: "os-widget-btn", type: "button", onclick: () => { for (const w of windows.values()) minimizeWindow(w.id); } }, "− Mostra Desktop"),
          el("button", { class: "os-widget-btn", type: "button", onclick: () => toggleApplicationsWindow() }, "⊞ Applicazioni"),
          el("button", { class: "os-widget-btn", type: "button", onclick: () => openSettingsModal({ tab: "installer" }) }, "⚙️ Auto Install")
        )
      )
    );

    return createWindowFrame({
      appId: "__desktop_prefs__",
      title: "Opzioni Desktop",
      displayUrl: "WoxOS ▸ Desktop & Wallpaper",
      glyph: "🎨",
      grad: "linear-gradient(135deg, #6366f1 0%, #10b981 100%)",
      width: 650,
      height: 1005,
      bodyNode: prefsBody,
    });
  }

  desktop.addEventListener("contextmenu", (e) => {
    if (e.target === desktop || e.target === windowsLayer) {
      e.preventDefault();
      openDesktopOptionsWindow();
    }
  });

  // ---- SAVE / RESTORE DESKTOP LAYOUT & WOXOS SYSTEM MENU ----
  const LAYOUT_STORAGE_KEY = "wox.os.layout.v1";

  function snapshotWidget(widgetEl) {
    const visible = widgetEl.style.display !== "none";
    const maximized = widgetEl.classList.contains("maximized");
    let rect = null;
    if (visible && !maximized) {
      const r = widgetEl.getBoundingClientRect();
      rect = {
        left: Math.round(r.left),
        top: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    }
    return { visible, maximized, rect };
  }

  function applyWidgetSnapshot(widgetEl, snap) {
    if (!snap) return;
    widgetEl.style.display = snap.visible === false ? "none" : "";
    widgetEl.classList.toggle("maximized", Boolean(snap.maximized));
    if (snap.rect) {
      widgetEl.style.right = "auto";
      widgetEl.style.bottom = "auto";
      widgetEl.style.left = `${Math.max(4, Math.min(window.innerWidth - 120, snap.rect.left))}px`;
      widgetEl.style.top = `${Math.max(38, Math.min(window.innerHeight - 100, snap.rect.top))}px`;
      widgetEl.style.width = `${Math.max(260, snap.rect.width)}px`;
      widgetEl.style.height = `${Math.max(150, snap.rect.height)}px`;
    }
  }

  function saveLayout() {
    const orderedWins = [...windows.values()].sort(
      (a, b) => (Number(a.el.style.zIndex) || 0) - (Number(b.el.style.zIndex) || 0)
    );
    const savedWins = orderedWins.map((w) => {
      const l = parseFloat(w.el.style.left) || 20;
      const t = parseFloat(w.el.style.top) || 20;
      const wd = parseFloat(w.el.style.width) || Math.round(w.el.getBoundingClientRect().width) || 640;
      const ht = parseFloat(w.el.style.height) || Math.round(w.el.getBoundingClientRect().height) || 560;
      return {
        appId: w.appId,
        left: Math.round(l),
        top: Math.round(t),
        width: Math.round(wd),
        height: Math.round(ht),
        maximized: Boolean(w.maximized),
        minimized: Boolean(w.minimized),
      };
    });

    const layout = {
      version: 1,
      savedAt: Date.now(),
      wallpaper: desktop.getAttribute("data-wallpaper") || "aurora",
      wallpaperCustom: localStorage.getItem("wox.os.wallpaperCustom") || null,
      pinnedApps: [...pinnedAppIds],
      widgets: {
        library: snapshotWidget(libWidget),
        gpu: snapshotWidget(gpuWidget),
        shell: snapshotWidget(shellWidget),
      },
      windows: savedWins,
    };

    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
      persistDockPins();
      osToast(`💾 Layout salvato (${savedWins.length} finestre + ${pinnedAppIds.length} app nel Dock + widget + desktop)`);
    } catch (err) {
      osToast(`Errore salvataggio layout: ${err?.message || err}`);
    }
  }

  function restoreSavedLayout() {
    let layout = null;
    try {
      const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (raw) layout = JSON.parse(raw);
    } catch {
      layout = null;
    }
    if (!layout || typeof layout !== "object") return false;

    // 0. Restore Dock pinned apps
    if (Array.isArray(layout.pinnedApps) && layout.pinnedApps.length) {
      const valid = layout.pinnedApps.filter((id) => appLookup.has(id));
      if (valid.length) {
        pinnedAppIds = valid;
        persistDockPins();
      }
    }

    // 1. Restore desktop wallpaper
    if (layout.wallpaper === "custom" && layout.wallpaperCustom) {
      applyWallpaper("custom", layout.wallpaperCustom);
    } else if (layout.wallpaper) {
      applyWallpaper(layout.wallpaper);
    }

    // 2. Restore desktop widgets geometry & visibility
    if (layout.widgets) {
      applyWidgetSnapshot(libWidget, layout.widgets.library);
      applyWidgetSnapshot(gpuWidget, layout.widgets.gpu);
      applyWidgetSnapshot(shellWidget, layout.widgets.shell);
    }

    // 3. Close any current windows before reopening saved windows
    for (const id of [...windows.keys()]) closeWindow(id);

    // 4. Reopen saved windows in exact z-order with exact position, size & state
    const savedWins = Array.isArray(layout.windows) ? layout.windows : [];
    if (!savedWins.length) return false;

    for (const sw of savedWins) {
      let rec = null;
      if (sw.appId === "__applications__") {
        toggleApplicationsWindow();
        rec = [...windows.values()].find((w) => w.appId === "__applications__");
      } else if (sw.appId === "__carosello__") {
        rec = toggleCaroselloWindow();
      } else if (sw.appId === "__desktop_prefs__") {
        rec = openDesktopOptionsWindow();
      } else if (sw.appId && sw.appId !== "__installer__") {
        rec = openAppWindow(sw.appId, {
          left: sw.left,
          top: sw.top,
          width: sw.width,
          height: sw.height,
        });
      }
      if (rec) {
        const clampedL = Math.max(0, Math.min(window.innerWidth - 140, sw.left ?? 20));
        const clampedT = Math.max(0, Math.min(window.innerHeight - 120, sw.top ?? 20));
        rec.el.style.left = `${clampedL}px`;
        rec.el.style.top = `${clampedT}px`;
        if (sw.width) rec.el.style.width = `${Math.max(380, Math.min(window.innerWidth - 12, sw.width))}px`;
        if (sw.height) rec.el.style.height = `${Math.max(260, Math.min(window.innerHeight - 60, sw.height))}px`;
        if (sw.maximized) {
          rec.maximized = true;
          rec.el.classList.add("maximized");
        }
        if (sw.minimized) {
          minimizeWindow(rec.id);
        } else {
          focusWindow(rec.id);
        }
      }
    }

    renderDock();
    return true;
  }

  function openWoxSystemMenu(anchor) {
    closeOsPopover();
    const rect = anchor.getBoundingClientRect();
    const hasSaved = Boolean(localStorage.getItem(LAYOUT_STORAGE_KEY));

    const menu = el(
      "div",
      { class: "os-popover", style: { top: `${rect.bottom + 6}px`, left: "10px", minWidth: "240px" } },
      el("div", { class: "os-pop-title" }, "WoxOS"),
      el(
        "div",
        { class: "os-pop-list" },
        el(
          "button",
          {
            class: "os-pop-item",
            type: "button",
            style: { background: "rgba(232,255,90,0.16)", color: "var(--os-accent)", fontWeight: "700" },
            onclick: () => {
              closeOsPopover();
              saveLayout();
            },
          },
          "💾 Salva Layout"
        ),
        hasSaved
          ? el(
              "button",
              {
                class: "os-pop-item",
                type: "button",
                onclick: () => {
                  closeOsPopover();
                  if (restoreSavedLayout()) osToast("↺ Layout salvato ripristinato");
                },
              },
              "↺ Ripristina Layout Salvato"
            )
          : null,
        hasSaved
          ? el(
              "button",
              {
                class: "os-pop-item",
                type: "button",
                onclick: () => {
                  localStorage.removeItem(LAYOUT_STORAGE_KEY);
                  localStorage.removeItem(DOCK_STORAGE_KEY);
                  pinnedAppIds = [...DEFAULT_PINNED_IDS];
                  renderDock();
                  closeOsPopover();
                  osToast("Layout salvato resettato (al prossimo avvio usa default)");
                },
              },
              "🧹 Reset Layout Predefinito"
            )
          : null,
        el("div", { style: { height: "1px", background: "rgba(255,255,255,0.10)", margin: "4px 0" } }),
        el(
          "button",
          {
            class: "os-pop-item",
            type: "button",
            onclick: () => {
              closeOsPopover();
              openDesktopOptionsWindow();
            },
          },
          "🎨 Opzioni Desktop & Wallpaper"
        ),
        el(
          "button",
          {
            class: "os-pop-item",
            type: "button",
            onclick: () => {
              closeOsPopover();
              toggleApplicationsWindow();
            },
          },
          "⊞ Applicazioni"
        ),
        el(
          "button",
          {
            class: "os-pop-item",
            type: "button",
            onclick: () => {
              closeOsPopover();
              openSettingsModal({ tab: "installer" });
            },
          },
          "⚙️ Auto Install & Opzioni"
        ),
        el(
          "button",
          {
            class: "os-pop-item",
            type: "button",
            onclick: () => {
              location.href = "/?classic=1#/app/cinema-video";
            },
          },
          "↩ Vista Classica"
        )
      )
    );

    activePopover = menu;
    document.body.append(activePopover);
  }

  // ---- CTRL+TAB WINDOW SWITCHER (Desktop + All Open Windows + Visual HUD) ----
  let switcherHud = null;
  let switcherTimer = null;

  function showSwitcherHud(allWins, activeId) {
    if (!switcherHud) {
      switcherHud = el("div", { class: "os-switcher-hud" });
      desktop.append(switcherHud);
    }
    switcherHud.replaceChildren(
      ...allWins.map((w) => {
        const wApp = appLookup.get(w.appId) || w;
        return el(
          "div",
          { class: `os-sw-item${w.id === activeId ? " active" : ""}` },
          el("div", { class: "os-sw-icon", style: { background: w.grad } }, appIconContent(wApp)),
          el("span", { class: "os-sw-label" }, w.title)
        );
      })
    );
    switcherHud.style.display = "flex";
    clearTimeout(switcherTimer);
    switcherTimer = setTimeout(() => {
      if (switcherHud) switcherHud.style.display = "none";
    }, 950);
  }

  function cycleWindows(dir = 1) {
    const list = [...windows.values()];
    if (!list.length) return;
    if (list.length === 1) {
      if (list[0].minimized) restoreWindow(list[0].id);
      else focusWindow(list[0].id);
      showSwitcherHud(list, list[0].id);
      return;
    }
    const curIdx = list.findIndex((w) => w.id === focusedWinId);
    const nextIdx = curIdx === -1 ? 0 : (curIdx + dir + list.length) % list.length;
    const target = list[nextIdx];
    if (target.minimized) restoreWindow(target.id);
    else focusWindow(target.id);
    try { window.focus(); } catch { /* ignore */ }
    showSwitcherHud(list, target.id);
  }

  function isSwitchKey(e) {
    if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === "Tab") return true;
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === "KeyQ" || e.key.toLowerCase() === "q")) return true;
    if ((e.ctrlKey || e.altKey) && !e.metaKey && (e.code === "Backquote" || e.key === "`" || e.key === "\\" || e.key === "|")) return true;
    return false;
  }

  window.addEventListener("keydown", (e) => {
    if (isSwitchKey(e)) {
      e.preventDefault();
      e.stopPropagation();
      cycleWindows(e.shiftKey ? -1 : 1);
    }
  }, true);

  window.addEventListener("keyup", (e) => {
    if ((e.key === "Control" || e.key === "Alt") && switcherHud) {
      clearTimeout(switcherTimer);
      switcherTimer = setTimeout(() => {
        if (switcherHud) switcherHud.style.display = "none";
      }, 220);
    }
  });

  // Mount Desktop
  desktop.append(topbar, dockWrap, libWidget, gpuWidget, shellWidget, windowsLayer, dragShield, toastStack);
  document.body.replaceChildren(desktop);
  renderDock();

  // Restore saved layout if present; otherwise open Cinema Studio Video (650x1005)
  if (!restoreSavedLayout()) {
    const initialW = Math.min(650, window.innerWidth - 16);
    const initialH = Math.min(1005, window.innerHeight - 118);
    openAppWindow("cinema-video", {
      width: initialW,
      height: initialH,
      left: Math.max(8, Math.floor((window.innerWidth - initialW) / 2)),
      top: 12,
    });
  }
}
