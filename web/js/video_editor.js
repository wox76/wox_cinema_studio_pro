// Video Studio (multi-track video editor from HeyPuter/everything) integration for Wox Cinema Studio Pro
import { el, icon, toast } from "./util.js";

let panel = null;
let iframe = null;
let toggleBtn = null;
let isOpen = false;

export function initVideoEditor() {
  if (panel) return panel;

  panel = el("div", { id: "wox-video-editor-panel", class: "wox-video-editor-panel" });

  const dragHandle = el("div", { class: "ve-drag-handle", title: "Trascina per ridimensionare l'editor video" });
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
    document.body.classList.remove("ve-resizing");
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  };

  dragHandle.addEventListener("pointerdown", (e) => {
    // Only drag on primary mouse button or touch
    if (e.button !== 0) return;
    e.preventDefault();
    isDragging = true;
    startY = e.clientY;
    startH = panel.getBoundingClientRect().height;
    try {
      dragHandle.setPointerCapture(e.pointerId);
    } catch {}
    panel.classList.add("resizing");
    document.body.classList.add("ve-resizing");
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ns-resize";
  });

  dragHandle.addEventListener("pointermove", (e) => {
    if (!isDragging) return;
    const dy = startY - e.clientY;
    const newH = Math.max(200, Math.min(window.innerHeight * 0.95, startH + dy));
    panel.style.height = `${newH}px`;
    document.documentElement.style.setProperty("--ve-height", `${newH}px`);
  });

  dragHandle.addEventListener("pointerup", stopDrag);
  dragHandle.addEventListener("pointercancel", stopDrag);
  window.addEventListener("pointerup", stopDrag);
  window.addEventListener("blur", stopDrag);

  const iframeBox = el("div", { class: "ve-iframe-box" });
  panel.append(dragHandle, iframeBox);
  document.body.append(panel);

  return panel;
}

export function toggleEditorExpand() {
  if (!panel) return;
  const curH = panel.getBoundingClientRect().height;
  let nextH;
  if (curH > window.innerHeight * 0.75) {
    nextH = "52vh";
  } else {
    nextH = "88vh";
  }
  panel.style.height = nextH;
  document.documentElement.style.setProperty("--ve-height", nextH);
}

export function openVideoEditor() {
  toggleVideoEditor(true);
}

export function isVideoEditorOpen() {
  return isOpen;
}

export function toggleVideoEditor(force) {
  initVideoEditor();
  const next = force !== undefined ? force : !isOpen;
  isOpen = next;

  if (isOpen) {
    panel.classList.add("open");
    document.body.classList.add("video-editor-open");

    const curH = panel.style.height || "52vh";
    document.documentElement.style.setProperty("--ve-height", curH);

    if (!iframe) {
      const box = panel.querySelector(".ve-iframe-box");
      iframe = el("iframe", {
        id: "wox-video-editor-frame",
        src: "/editor/index.html",
        allow: "clipboard-read; clipboard-write; autoplay",
        dataset: { ready: "false" }
      });
      iframe.addEventListener("load", () => {
        iframe.dataset.ready = "true";
      });
      box.replaceChildren(iframe);
    }
    toggleBtn?.classList.add("active");

    // Automatically switch to LIBRERIA if not already there
    if (location.hash !== "#/library") {
      location.hash = "#/library";
    }

    // Adapt and smoothly scroll to the top of the library
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 60);
  } else {
    panel.classList.remove("open");
    document.body.classList.remove("video-editor-open");
    toggleBtn?.classList.remove("active");
  }

  window.dispatchEvent(new CustomEvent("wox:video-editor-toggle", { detail: { open: isOpen } }));
}

export function createEditorToggleBtn() {
  toggleBtn = el("button", {
    class: "video-editor-toggle-btn",
    type: "button",
    title: "Montaggio video · Timeline Studio",
    "aria-label": "Montaggio video",
    onclick: () => toggleVideoEditor()
  }, icon("film"), el("span", { class: "lbl-long" }, "Montaggio video"));
  return toggleBtn;
}

export async function sendToVideoEditor(mediaItem) {
  openVideoEditor();

  const url = mediaItem.url || mediaItem.full || mediaItem.src;
  if (!url) {
    toast("Nessun media trovato da inviare", { error: true });
    return;
  }

  const name = mediaItem.fileName || mediaItem.name || mediaItem.file || (mediaItem.type === "video" ? "clip.mp4" : mediaItem.type === "audio" ? "audio.mp3" : "immagine.png");
  const mime = mediaItem.type === "video" ? "video/mp4" : mediaItem.type === "audio" ? "audio/mpeg" : "image/png";
  const absUrl = new URL(url, location.origin).href;

  toast(`Caricamento "${name}" in Video Studio...`, { duration: 2500 });

  const frame = document.getElementById("wox-video-editor-frame");
  if (!frame) return;

  const performImport = async () => {
    try {
      const win = frame.contentWindow;
      // Wait up to 3s if editor is booting
      for (let i = 0; i < 30 && !win?.vs?.importMediaFiles; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }

      if (win?.vs?.importMediaFiles) {
        // Fetch from inside the iframe context
        const resp = await win.fetch(absUrl);
        const blob = await resp.blob();
        const file = new win.File([blob], name, { type: mime || blob.type });
        const assets = await win.vs.importMediaFiles([file], { addToTimeline: true });
        if (assets && assets.length > 0) {
          toast(`✔ "${name}" aggiunto alla Timeline di Video Studio!`, { duration: 4000 });
          return;
        }
      }
    } catch (e) {
      console.warn("Direct import error, trying postMessage:", e);
    }

    // Fallback: postMessage
    frame.contentWindow?.postMessage({
      type: "WOX_IMPORT_MEDIA",
      url: absUrl,
      name,
      mime,
      addToTimeline: true
    }, "*");
  };

  if (frame.dataset.ready === "true") {
    setTimeout(performImport, 250);
  } else {
    frame.addEventListener("load", () => {
      setTimeout(performImport, 800);
    }, { once: true });
  }
}

window.addEventListener("message", (ev) => {
  if (ev.data?.type === "WOX_IMPORT_SUCCESS") {
    toast(`✔ "${ev.data.name || "Media"}" importato nella Timeline di Video Studio!`);
  } else if (ev.data?.type === "WOX_IMPORT_ERROR") {
    toast(`Errore importazione media: ${ev.data.error}`, { error: true });
  } else if (ev.data?.type === "wox:close-video-editor") {
    toggleVideoEditor(false);
  } else if (ev.data?.type === "wox:toggle-expand-video-editor") {
    toggleEditorExpand();
  }
});
