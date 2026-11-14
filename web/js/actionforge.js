// ActionForge 3D Rigging & Animation Studio Integration for Wox Cinema Studio [PRO]
import { el, icon, toast } from "./util.js";
import { t } from "./i18n.js";
import { feed } from "./feed.js";

let panel = null;
let afIframe = null;
let toggleBtn = null;
let isOpen = false;
let afReady = false;
let pendingImport = null;
let pickerBackdrop = null;

// Global listener for ActionForge iframe messages
window.addEventListener("message", (ev) => {
  const data = ev.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "WOX_ACTIONFORGE_READY") {
    afReady = true;
    if (pendingImport) {
      const msg = pendingImport;
      pendingImport = null;
      postToActionForge(msg);
    }
  } else if (data.type === "WOX_OPEN_3D_LIBRARY_PICKER") {
    openLibrary3dPicker({ intent: data.intent || "unrigged" });
  }
});

export function isActionForgeOpen() {
  return isOpen;
}

export function initActionForgePanel() {
  if (panel) return panel;

  panel = el("div", { id: "wox-actionforge-panel", class: "wox-actionforge-panel" });

  const dragHandle = el("div", {
    class: "af-drag-handle",
    title: "Trascina per ridimensionare ActionForge 3D Studio",
  });
  let isDragging = false;
  let startY = 0;
  let startH = 0;

  const stopDrag = (e) => {
    if (!isDragging) return;
    isDragging = false;
    try {
      if (e?.pointerId !== undefined && dragHandle.hasPointerCapture?.(e.pointerId)) {
        dragHandle.releasePointerCapture(e.pointerId);
      }
    } catch {}
    panel.classList.remove("resizing");
    document.body.classList.remove("af-resizing");
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  };

  dragHandle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    isDragging = true;
    startY = e.clientY;
    startH = panel.getBoundingClientRect().height;
    try {
      dragHandle.setPointerCapture(e.pointerId);
    } catch {}
    panel.classList.add("resizing");
    document.body.classList.add("af-resizing");
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ns-resize";
  });

  dragHandle.addEventListener("pointermove", (e) => {
    if (!isDragging) return;
    const dy = startY - e.clientY;
    const newH = Math.max(220, Math.min(window.innerHeight * 0.95, startH + dy));
    panel.style.height = `${newH}px`;
    document.documentElement.style.setProperty("--af-height", `${newH}px`);
  });

  dragHandle.addEventListener("pointerup", stopDrag);
  dragHandle.addEventListener("pointercancel", stopDrag);
  window.addEventListener("pointerup", stopDrag);
  window.addEventListener("blur", stopDrag);

  const statusBadge = el(
    "span",
    {
      class: "af-studio-badge",
      style: {
        fontSize: "11px",
        padding: "2px 8px",
        borderRadius: "999px",
        background: "rgba(84, 197, 255, 0.15)",
        color: "#54c5ff",
        border: "1px solid rgba(84, 197, 255, 0.35)",
        fontWeight: "600",
      },
    },
    "Auto-Rig · 195 Animazioni · GLB/FBX"
  );

  const openNewTabBtn = el(
    "button",
    {
      type: "button",
      class: "btn ghost sm",
      style: { fontSize: "11px", padding: "3px 8px" },
      onclick: () => {
        const currentUrl = afIframe?.dataset?.lastGlbUrl || "";
        const target = currentUrl
          ? `/actionforge/index.html?wox_model=${encodeURIComponent(currentUrl)}`
          : `/actionforge/index.html`;
        window.open(target, "_blank", "noopener");
      },
    },
    "↗ Nuova Scheda"
  );

  const expandBtn = el(
    "button",
    {
      type: "button",
      class: "btn ghost sm",
      style: { fontSize: "11px", padding: "3px 8px" },
      onclick: () => toggleActionForgeExpand(),
    },
    "↕ Espandi"
  );

  const closeBtn = el(
    "button",
    {
      type: "button",
      class: "btn ghost sm",
      style: { fontSize: "11px", padding: "3px 8px" },
      onclick: () => toggleActionForge(false),
    },
    `✕ ${t("act.close")}`
  );

  const header = el(
    "div",
    { class: "af-panel-header" },
    el(
      "div",
      { style: { display: "flex", alignItems: "center", gap: "8px" } },
      el("span", { style: { fontSize: "15px" } }, "🦴"),
      el(
        "strong",
        { style: { fontSize: "13px", letterSpacing: "0.02em", color: "#fff" } },
        "ActionForge 3D Studio"
      ),
      statusBadge
    ),
    el(
      "div",
      { style: { display: "flex", alignItems: "center", gap: "6px" } },
      openNewTabBtn,
      expandBtn,
      closeBtn
    )
  );

  const iframeBox = el("div", { class: "af-iframe-box" });

  panel.append(dragHandle, header, iframeBox);
  document.body.append(panel);

  return panel;
}

export function toggleActionForgeExpand() {
  if (!panel) return;
  const curH = panel.getBoundingClientRect().height;
  let nextH = curH > window.innerHeight * 0.72 ? "55vh" : "90vh";
  panel.style.height = nextH;
  document.documentElement.style.setProperty("--af-height", nextH);
}

function postToActionForge(msg) {
  if (!afIframe || !afIframe.contentWindow) return;
  afIframe.contentWindow.postMessage(msg, "*");
}

export function toggleActionForge(force) {
  initActionForgePanel();
  const next = force !== undefined ? Boolean(force) : !isOpen;
  isOpen = next;

  if (isOpen) {
    panel.classList.add("open");
    document.body.classList.add("actionforge-open");

    const curH = panel.style.height || "55vh";
    document.documentElement.style.setProperty("--af-height", curH);

    if (!afIframe) {
      const box = panel.querySelector(".af-iframe-box");
      afIframe = el("iframe", {
        id: "wox-actionforge-frame",
        src: "/actionforge/index.html",
        class: "af-studio-iframe",
        allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen",
      });

      afIframe.addEventListener("load", () => {
        const ping = () => {
          try {
            afIframe?.contentWindow?.postMessage({ type: "WOX_PING" }, "*");
          } catch (e) {}
        };
        ping();
        setTimeout(ping, 400);
        setTimeout(ping, 1000);
        setTimeout(ping, 2000);

        if (pendingImport) {
          setTimeout(() => {
            if (pendingImport) {
              const msg = pendingImport;
              pendingImport = null;
              postToActionForge(msg);
            }
          }, 800);
        }
      });

      box.replaceChildren(afIframe);
    }
    toggleBtn?.classList.add("active");

    // Smoothly scroll or adapt if in library
    if (location.hash !== "#/library") {
      location.hash = "#/library";
    }
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 60);
  } else {
    panel.classList.remove("open");
    document.body.classList.remove("actionforge-open");
    toggleBtn?.classList.remove("active");
  }

  window.dispatchEvent(new CustomEvent("wox:actionforge-toggle", { detail: { open: isOpen } }));
  return isOpen;
}

/**
 * Open a modal picker showing all 3D (.glb) models from the user's Library / history
 * allowing the user to select and immediately load any created 3D asset into ActionForge.
 */
export async function openLibrary3dPicker({ intent = "unrigged" } = {}) {
  if (pickerBackdrop) pickerBackdrop.remove();

  try {
    await feed.load();
  } catch {}

  const entries = feed.list();
  const models3d = [];

  for (const e of entries) {
    if (e.status !== "succeeded") continue;
    const glbUrl = resolveGlbUrl(e);
    if (!glbUrl) continue;
    const prompt = e.values?.prompt || e.values?.text || "";
    const previewImg = (e.outputs || []).find((o) => o.type === "image")?.url || null;
    const dateStr = e.created ? new Date(e.created).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    models3d.push({
      id: e.id,
      title: prompt ? (prompt.length > 55 ? prompt.slice(0, 52) + "…" : prompt) : `Modello 3D #${e.id.slice(-6)}`,
      glbUrl,
      preview: previewImg,
      app: e.app || "trellis-3d",
      date: dateStr,
      entry: e,
    });
  }

  // Include example trellis-3d latest if available
  models3d.push({
    id: "trellis-latest",
    title: "TRELLIS 3D Studio (Ultimo generato)",
    glbUrl: "/examples/trellis-3d/latest.glb",
    preview: "/examples/trellis-3d/out.png",
    app: "trellis-3d",
    date: "Predefinito",
    entry: { id: "trellis-latest", app: "trellis-3d" },
  });

  pickerBackdrop = el("div", {
    class: "shell-backdrop af-picker-backdrop",
    style: { zIndex: "10000" },
  });

  const close = () => {
    pickerBackdrop?.remove();
    pickerBackdrop = null;
    document.removeEventListener("keydown", onKey);
  };

  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  document.addEventListener("keydown", onKey);

  pickerBackdrop.addEventListener("click", (e) => {
    if (e.target === pickerBackdrop) close();
  });

  const cardsContainer = el("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
      gap: "14px",
      padding: "16px",
      overflowY: "auto",
      flex: "1",
    },
  });

  models3d.forEach((item) => {
    const card = el(
      "div",
      {
        class: "af-picker-card",
        style: {
          background: "#161820",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          borderRadius: "10px",
          overflow: "hidden",
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          transition: "transform 0.15s, border-color 0.15s, box-shadow 0.15s",
        },
        onmouseenter: () => {
          card.style.borderColor = "#54c5ff";
          card.style.transform = "translateY(-2px)";
          card.style.boxShadow = "0 8px 24px rgba(84, 197, 255, 0.25)";
        },
        onmouseleave: () => {
          card.style.borderColor = "rgba(255, 255, 255, 0.1)";
          card.style.transform = "none";
          card.style.boxShadow = "none";
        },
        onclick: async () => {
          close();
          toast(`Caricamento "${item.title}" in ActionForge...`);
          await sendToActionForge(item.entry || item.glbUrl, { intent });
        },
      },
      el(
        "div",
        {
          style: {
            width: "100%",
            aspectRatio: "1 / 1",
            background: "#0c0d12",
            display: "grid",
            placeItems: "center",
            position: "relative",
            overflow: "hidden",
          },
        },
        item.preview
          ? el("img", {
              src: item.preview,
              alt: item.title,
              style: { width: "100%", height: "100%", objectFit: "cover" },
            })
          : el(
              "div",
              { style: { fontSize: "36px", opacity: "0.6" } },
              "🧊"
            ),
        el(
          "span",
          {
            style: {
              position: "absolute",
              top: "8px",
              left: "8px",
              background: "rgba(0,0,0,0.7)",
              color: "#54c5ff",
              border: "1px solid rgba(84,197,255,0.4)",
              borderRadius: "4px",
              padding: "2px 6px",
              fontSize: "10px",
              fontWeight: "600",
            },
          },
          ".GLB"
        )
      ),
      el(
        "div",
        {
          style: {
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            flex: "1",
            justifyContent: "space-between",
          },
        },
        el("strong", { style: { fontSize: "12px", color: "#fff", lineHeight: "1.3" } }, item.title),
        el(
          "div",
          {
            style: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "11px",
              color: "rgba(255,255,255,0.5)",
              marginTop: "6px",
            },
          },
          el("span", {}, item.app),
          el(
            "button",
            {
              type: "button",
              class: "btn sm",
              style: {
                background: "rgba(84, 197, 255, 0.15)",
                color: "#54c5ff",
                border: "1px solid rgba(84, 197, 255, 0.4)",
                padding: "3px 8px",
                fontSize: "11px",
              },
            },
            "Scegli ➔"
          )
        )
      )
    );
    cardsContainer.appendChild(card);
  });

  const dialog = el(
    "div",
    {
      class: "shell-dialog",
      style: {
        width: "min(780px, 92vw)",
        height: "min(620px, 85vh)",
        display: "flex",
        flexDirection: "column",
      },
    },
    el(
      "div",
      { class: "shell-head" },
      el(
        "div",
        { class: "shell-head-left" },
        el("span", { style: { fontSize: "18px" } }, "🧊"),
        el(
          "div",
          {},
          el("div", { class: "shell-title" }, "Libreria Modelli 3D · Carica in ActionForge"),
          el(
            "div",
            { style: { fontSize: "12px", color: "rgba(255,255,255,0.5)" } },
            "Seleziona l'oggetto 3D creato in Trellis / 3D Studio da importare e riggare"
          )
        )
      ),
      el(
        "div",
        { class: "shell-head-right" },
        el(
          "button",
          {
            class: "shell-close-btn",
            type: "button",
            title: "Chiudi (Esc)",
            onclick: close,
          },
          icon("x")
        )
      )
    ),
    cardsContainer
  );

  pickerBackdrop.appendChild(dialog);
  document.body.appendChild(pickerBackdrop);
}

/**
 * Resolve the .glb URL for any history entry or example item.
 */
export function resolveGlbUrl(item) {
  if (!item) return null;
  if (item.glbUrl) return item.glbUrl;
  const glbOut = (item.outputs || []).find((o) => /\.glb($|\?)/i.test(o.url || o.file || ""));
  if (glbOut?.url) return glbOut.url;
  if (item.app === "trellis-3d") {
    if (item.id && item.kind === "history") return `/api/history/${item.id}/files/out-model.glb`;
    return "/examples/trellis-3d/latest.glb";
  }
  return null;
}

/**
 * Detect whether a GLB file buffer contains skinning / skeletal rigging.
 */
export function checkIsGlbRigged(buffer) {
  try {
    if (!buffer || buffer.byteLength < 24) return false;
    const view = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer);
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (magic !== "glTF") return false;
    const jsonLen = view.getUint32(12, true);
    if (jsonLen <= 0 || jsonLen > buffer.byteLength - 20) return false;
    const jsonBytes = new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer, 20, jsonLen);
    const jsonStr = new TextDecoder("utf-8").decode(jsonBytes);
    const gltf = JSON.parse(jsonStr);
    const hasSkins = Array.isArray(gltf.skins) && gltf.skins.length > 0;
    const hasSkinNodes = Array.isArray(gltf.nodes) && gltf.nodes.some((n) => n.skin !== undefined);
    return Boolean(hasSkins || hasSkinNodes);
  } catch (err) {
    console.warn("[actionforge] checkIsGlbRigged error:", err);
    return false;
  }
}

/**
 * Send a generated 3D object (.glb) directly to ActionForge for auto-rigging & animation.
 */
export async function sendToActionForge(item, { intent = null, newTab = false } = {}) {
  let glbUrl = typeof item === "string" ? item : resolveGlbUrl(item);
  if (!glbUrl) {
    toast("Nessun file 3D (.glb) trovato per questo elemento");
    return;
  }

  // Verify and fetch the GLB bytes directly to avoid cross-origin / iframe relative fetch 404s
  let bytes = null;
  try {
    const res = await fetch(glbUrl);
    if (res.ok) {
      bytes = await res.arrayBuffer();
    } else {
      // Fallback: check latest.glb
      const fallback = await fetch("/examples/trellis-3d/latest.glb");
      if (fallback.ok) {
        bytes = await fallback.arrayBuffer();
        glbUrl = "/examples/trellis-3d/latest.glb";
      }
    }
  } catch (err) {
    console.warn("[actionforge] direct fetch failed, will try url postMessage", err);
  }

  // Auto-detect whether the 3D model is rigged or unrigged
  const isRigged = bytes ? checkIsGlbRigged(bytes) : false;
  const determinedIntent = intent || (isRigged ? "rigged" : "unrigged");

  const absUrl = new URL(glbUrl, window.location.origin).href;
  const name =
    typeof item === "object" && item
      ? `wox-trellis-${item.id || "model"}.glb`
      : "wox-trellis-model.glb";

  if (newTab) {
    const url = `/actionforge/index.html?wox_model=${encodeURIComponent(absUrl)}&wox_name=${encodeURIComponent(name)}&wox_intent=${encodeURIComponent(determinedIntent)}`;
    window.open(url, "_blank", "noopener");
    toast(isRigged ? "Caricato come RIGGED CHARACTER in nuova scheda!" : "Caricato come UNRIGGED MODEL in nuova scheda!");
    return;
  }

  initActionForgePanel();
  if (afIframe) {
    afIframe.dataset.lastGlbUrl = absUrl;
  }
  toggleActionForge(true);

  // If we have downloaded the bytes, send WOX_IMPORT_GLB_BYTES with transferable ArrayBuffer
  const msg = bytes ? {
    type: "WOX_IMPORT_GLB_BYTES",
    bytes,
    name,
    isRigged,
    intent: determinedIntent,
  } : {
    type: "WOX_IMPORT_GLB",
    url: absUrl,
    name,
    isRigged,
    intent: determinedIntent,
  };

  const deliver = () => {
    if (afIframe?.contentWindow) {
      if (bytes) {
        afIframe.contentWindow.postMessage(msg, "*", [bytes]);
      } else {
        afIframe.contentWindow.postMessage(msg, "*");
      }
    }
  };

  if (afReady && afIframe?.contentWindow) {
    deliver();
  } else {
    pendingImport = msg;
    // Send repeated bursts as ActionForge initializes its canvas
    setTimeout(deliver, 500);
    setTimeout(deliver, 1200);
    setTimeout(deliver, 2200);
  }

  if (isRigged) {
    toast("🦴 Modello Riggato rilevato: caricamento come RIGGED CHARACTER!");
  } else {
    toast("🧊 Modello non riggato rilevato: caricamento come UNRIGGED MODEL!");
  }
}

export function createActionForgeToggleBtn() {
  toggleBtn = el(
    "button",
    {
      class: `ve-toggle-btn af-toggle-btn ${isOpen ? "active" : ""}`,
      type: "button",
      title: "Apri/Chiudi ActionForge 3D Rigging & Animation Studio (Pannello)",
      onclick: () => toggleActionForge(),
    },
    el("span", { style: { fontSize: "14px", lineHeight: "1" } }, "🦴"),
    el("span", {}, "ActionForge 3D")
  );
  return toggleBtn;
}
