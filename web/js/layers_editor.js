// Interactive RGBA Layers Studio & Compositor for Fuobe Layers (qwen-layered / layers-control).
// Reorder Z-order, toggle visibility, drag X/Y, scale, blend, add text, and export composited PNG.
import { el, icon, toast } from "./util.js";
import { feed } from "./feed.js";

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Impossibile caricare il livello: ${src}`));
    img.src = src;
  });
}

function buildLayersComposer({ initialUrls = [], onClose = null } = {}) {
  const layers = [];
  let selectedId = null;
  let canvasW = 1024;
  let canvasH = 1024;
  let bgMode = "checker"; // "checker" | "solid"
  let bgColor = "#0e1017";
  let dragging = null;
  let seq = 1;

  const canvas = el("canvas", {
    width: canvasW,
    height: canvasH,
    style: {
      maxWidth: "100%",
      maxHeight: "68vh",
      width: "auto",
      height: "auto",
      borderRadius: "10px",
      border: "1px solid rgba(255,255,255,0.14)",
      cursor: "grab",
      touchAction: "none",
      display: "block",
      margin: "0 auto",
    },
  });
  const ctx = canvas.getContext("2d");

  function drawChecker(w, h) {
    const sz = 24;
    for (let y = 0; y < h; y += sz) {
      for (let x = 0; x < w; x += sz) {
        ctx.fillStyle = ((x / sz + y / sz) % 2 === 0) ? "#1c1e26" : "#121319";
        ctx.fillRect(x, y, sz, sz);
      }
    }
  }

  function render(forExport = false) {
    if (canvas.width !== canvasW || canvas.height !== canvasH) {
      canvas.width = canvasW;
      canvas.height = canvasH;
    }
    ctx.clearRect(0, 0, canvasW, canvasH);
    if (!forExport && bgMode === "checker") drawChecker(canvasW, canvasH);
    else if (bgMode === "solid") {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, canvasW, canvasH);
    }

    for (const ly of layers) {
      if (!ly.visible) continue;
      ctx.save();
      ctx.globalAlpha = ly.opacity;
      ctx.globalCompositeOperation = ly.blend || "source-over";
      ctx.translate(canvasW / 2 + ly.x, canvasH / 2 + ly.y);
      ctx.scale(ly.scale, ly.scale);
      if (ly.kind === "image" && ly.img) {
        ctx.drawImage(ly.img, -ly.img.naturalWidth / 2, -ly.img.naturalHeight / 2);
      } else if (ly.kind === "text") {
        ctx.fillStyle = ly.color || "#ffffff";
        ctx.font = `800 ${ly.fontSize || 72}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(ly.text || "Testo", 0, 0);
      }
      ctx.restore();

      if (!forExport && ly.id === selectedId && ly.kind === "image" && ly.img) {
        ctx.save();
        ctx.strokeStyle = "#e8ff5a";
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        const bw = ly.img.naturalWidth * ly.scale;
        const bh = ly.img.naturalHeight * ly.scale;
        ctx.strokeRect(canvasW / 2 + ly.x - bw / 2, canvasH / 2 + ly.y - bh / 2, bw, bh);
        ctx.restore();
      }
    }
  }

  const listBox = el("div", { style: { display: "grid", gap: "6px", maxHeight: "230px", overflowY: "auto" } });
  const propsBox = el("div", { style: { display: "grid", gap: "8px", padding: "10px", borderRadius: "8px", background: "rgba(255,255,255,0.04)" } });

  function renderUI() {
    listBox.replaceChildren(...[...layers].reverse().map((ly, revIdx) => {
      const idx = layers.length - 1 - revIdx;
      const isSel = ly.id === selectedId;
      return el("div", {
        style: {
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 8px",
          borderRadius: "8px",
          background: isSel ? "rgba(232,255,90,0.12)" : "rgba(255,255,255,0.04)",
          border: `1px solid ${isSel ? "#e8ff5a" : "rgba(255,255,255,0.08)"}`,
          cursor: "pointer",
        },
        onclick: () => { selectedId = ly.id; renderUI(); render(); },
      },
        el("button", {
          type: "button",
          class: "mini",
          title: ly.visible ? "Nascondi" : "Mostra",
          onclick: (e) => { e.stopPropagation(); ly.visible = !ly.visible; renderUI(); render(); },
        }, ly.visible ? "👁" : "🚫"),
        el("span", { style: { flex: "1", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, ly.name),
        el("button", {
          type: "button",
          class: "mini",
          disabled: idx === layers.length - 1,
          onclick: (e) => {
            e.stopPropagation();
            if (idx < layers.length - 1) {
              [layers[idx], layers[idx + 1]] = [layers[idx + 1], layers[idx]];
              renderUI();
              render();
            }
          },
        }, "↑"),
        el("button", {
          type: "button",
          class: "mini",
          disabled: idx === 0,
          onclick: (e) => {
            e.stopPropagation();
            if (idx > 0) {
              [layers[idx], layers[idx - 1]] = [layers[idx - 1], layers[idx]];
              renderUI();
              render();
            }
          },
        }, "↓"),
        el("button", {
          type: "button",
          class: "mini",
          onclick: (e) => {
            e.stopPropagation();
            layers.splice(idx, 1);
            if (selectedId === ly.id) selectedId = layers[layers.length - 1]?.id || null;
            renderUI();
            render();
          },
        }, "✕")
      );
    }));

    const sel = layers.find((l) => l.id === selectedId);
    if (!sel) {
      propsBox.replaceChildren(el("span", { style: { fontSize: "12px", color: "var(--dim)" } }, "Seleziona o carica un livello PNG/testo per modificarlo."));
    } else {
      propsBox.replaceChildren(
        el("div", { style: { fontSize: "12px", fontWeight: "600", color: "#e8ff5a" } }, sel.name),
        ...(sel.kind === "text" ? [
          el("div", { class: "field" }, el("label", {}, "Testo"), el("input", {
            type: "text",
            value: sel.text,
            oninput: (e) => { sel.text = e.target.value; render(); },
          })),
          el("div", { class: "field" }, el("label", {}, "Colore Testo"), el("input", {
            type: "color",
            value: sel.color,
            oninput: (e) => { sel.color = e.target.value; render(); },
          })),
        ] : []),
        el("div", { class: "field" }, el("label", {}, `Scala (${sel.scale.toFixed(2)}×)`), el("input", {
          type: "range", min: "0.1", max: "3", step: "0.02", value: String(sel.scale),
          oninput: (e) => { sel.scale = Number(e.target.value); render(); },
        })),
        el("div", { class: "field" }, el("label", {}, `Opacità (${Math.round(sel.opacity * 100)}%)`), el("input", {
          type: "range", min: "0", max: "1", step: "0.02", value: String(sel.opacity),
          oninput: (e) => { sel.opacity = Number(e.target.value); render(); },
        })),
        el("div", { class: "field" }, el("label", {}, "Fusione (Blend)"), el("select", {
          onchange: (e) => { sel.blend = e.target.value; render(); },
        }, ...["source-over", "multiply", "screen", "overlay"].map((b) => el("option", { value: b, selected: b === sel.blend }, b))))
      );
    }
  }

  async function addImageUrl(url, label) {
    const img = await loadImage(url);
    if (!layers.length && img.naturalWidth > 0) {
      canvasW = img.naturalWidth;
      canvasH = img.naturalHeight;
    }
    const id = `ly_${seq++}`;
    layers.push({ id, kind: "image", name: label || `Livello ${layers.length + 1}`, img, visible: true, x: 0, y: 0, scale: 1, opacity: 1, blend: "source-over" });
    selectedId = id;
    renderUI();
    render();
  }

  canvas.addEventListener("pointerdown", (e) => {
    const sel = layers.find((l) => l.id === selectedId);
    if (!sel) return;
    canvas.setPointerCapture?.(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    dragging = { sx: e.clientX, sy: e.clientY, ox: sel.x, oy: sel.y, rx: canvasW / Math.max(1, rect.width), ry: canvasH / Math.max(1, rect.height) };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const sel = layers.find((l) => l.id === selectedId);
    if (!sel) return;
    sel.x = dragging.ox + (e.clientX - dragging.sx) * dragging.rx;
    sel.y = dragging.oy + (e.clientY - dragging.sy) * dragging.ry;
    render();
  });
  const endDrag = () => { dragging = null; };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  function exportFlattened(saveToLib = false) {
    render(true);
    canvas.toBlob(async (blob) => {
      render(false);
      if (!blob) return;
      const file = new File([blob], `layers-composite-${Date.now()}.png`, { type: "image/png" });
      if (saveToLib) {
        const fd = new FormData();
        fd.append("file", file, file.name);
        const res = await fetch("/api/history/upload", { method: "POST", body: fd });
        if (!res.ok) return toast(`Upload error ${res.status}`, { error: true });
        await feed.load().catch(() => {});
        toast("Composizione salvata in Libreria!");
      } else {
        const a = el("a", { href: URL.createObjectURL(file), download: file.name });
        a.click();
      }
    }, "image/png");
  }

  const uploadInput = el("input", {
    type: "file",
    accept: "image/*",
    multiple: true,
    onchange: async () => {
      for (const file of uploadInput.files || []) {
        await addImageUrl(URL.createObjectURL(file), file.name).catch((err) => toast(err.message, { error: true }));
      }
      uploadInput.value = "";
    },
  });

  Promise.all(initialUrls.map((u, idx) => addImageUrl(u, `Livello ${idx + 1}`).catch(() => null))).then(() => {
    renderUI();
    render();
  });
  renderUI();
  render();

  const side = el("aside", { class: "side", style: { padding: "14px", display: "grid", gap: "10px", alignContent: "start", overflowY: "auto" } },
    el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
      el("h2", { class: "display", style: { margin: 0, fontSize: "20px" } }, "Layers Studio RGBA"),
      onClose ? el("button", { class: "btn ghost small", type: "button", onclick: onClose }, "Chiudi") : null
    ),
    el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
      el("a", { class: "btn ghost small", href: "#/app/qwen-layered" }, "Estrai Livelli (AI)"),
      el("a", { class: "btn ghost small", href: "#/app/layers-control" }, "Estrai Guidato"),
      el("button", {
        class: "btn ghost small",
        type: "button",
        onclick: () => {
          const id = `ly_${seq++}`;
          layers.push({ id, kind: "text", name: `Testo ${seq - 1}`, text: "WOX STUDIO", fontSize: Math.round(canvasW * 0.08), color: "#ffffff", visible: true, x: 0, y: 0, scale: 1, opacity: 1, blend: "source-over" });
          selectedId = id;
          renderUI();
          render();
        },
      }, "+ Testo")
    ),
    el("div", { class: "field" }, el("label", {}, "Aggiungi Immagini / PNG Livelli"), uploadInput),
    el("div", { class: "field" }, el("label", {}, "Sfondo Tela"),
      el("div", { style: { display: "flex", gap: "6px", alignItems: "center" } },
        el("select", {
          onchange: (e) => { bgMode = e.target.value; render(); },
        }, el("option", { value: "checker" }, "Trasparente (PNG)"), el("option", { value: "solid" }, "Colore Solido")),
        el("input", { type: "color", value: bgColor, oninput: (e) => { bgColor = e.target.value; bgMode = "solid"; render(); } })
      )
    ),
    listBox,
    propsBox,
    el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
      el("button", { class: "btn lime", type: "button", onclick: () => exportFlattened(false) }, icon("download"), "Esporta PNG"),
      el("button", { class: "btn ghost", type: "button", onclick: () => exportFlattened(true) }, "Salva in Libreria")
    )
  );

  const stage = el("section", { style: { flex: 1, padding: "20px", display: "grid", alignContent: "center" } },
    canvas,
    el("p", { style: { textAlign: "center", fontSize: "12px", color: "var(--dim)", marginTop: "8px" } }, "Trascina il livello selezionato sulla tela per riposizionarlo.")
  );

  return el("div", { class: "ws" }, side, stage);
}

export function layersView() {
  return { node: buildLayersComposer({}), active: "image" };
}

export function openLayersModal(layerUrls = []) {
  const wrap = el("div", {
    style: {
      position: "fixed",
      inset: "0",
      zIndex: "9999",
      background: "rgba(6,8,12,0.92)",
      display: "flex",
      flexDirection: "column",
    },
  });
  const close = () => wrap.remove();
  const content = buildLayersComposer({ initialUrls: layerUrls, onClose: close });
  content.style.flex = "1";
  content.style.minHeight = "0";
  wrap.appendChild(content);
  document.body.appendChild(wrap);
}
