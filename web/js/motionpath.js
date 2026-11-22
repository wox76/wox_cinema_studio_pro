// Interactive Motion Path Drawing Canvas for Draw-to-Video (Wan-Move).
// Draws normalized multi-path trajectories directly over the source image.
import { el } from "./util.js";

const COLORS = ["#e8ff5a", "#38bdf8", "#fb7185", "#34d399", "#a78bfa", "#fbbf24"];

function parseAspect(aspectVal) {
  if (typeof aspectVal === "string" && aspectVal.includes("x")) {
    const [w, h] = aspectVal.split("x").map(Number);
    if (w > 0 && h > 0) return [w, h];
  }
  return [832, 480];
}

function parsePathsJson(raw, fallbackAspect) {
  try {
    const parsed = JSON.parse(String(raw || ""));
    if (parsed && Array.isArray(parsed.paths)) {
      const valid = parsed.paths
        .filter((p) => Array.isArray(p) && p.length >= 2)
        .map((p) => p.map((pt) => [
          Math.max(0, Math.min(1, Number(pt[0]) || 0)),
          Math.max(0, Math.min(1, Number(pt[1]) || 0)),
        ]));
      return { aspect: Array.isArray(parsed.aspect) && parsed.aspect.length === 2 ? parsed.aspect : fallbackAspect, paths: valid };
    }
  } catch {}
  return { aspect: fallbackAspect, paths: [[[0.3, 0.6], [0.6, 0.35]]] };
}

/** Create the interactive motion-path canvas widget for draw-to-video. */
export function createMotionPathWidget({ f, inpTracks, initialImageUrl = null, onChange = null }) {
  const aspect = parseAspect(f.values.aspect);
  const state = parsePathsJson(f.values[inpTracks.id], aspect);
  let paths = state.paths;
  let activePath = null;
  let imgEl = null;
  let animRaf = 0;
  let animStart = 0;

  const canvas = el("canvas", {
    width: 480,
    height: Math.round((480 * aspect[1]) / aspect[0]),
    style: {
      width: "100%",
      display: "block",
      borderRadius: "8px",
      background: "#121318",
      border: "1px solid rgba(255,255,255,0.12)",
      cursor: "crosshair",
      touchAction: "none",
    },
  });
  const ctx = canvas.getContext("2d");

  const badge = el("span", {
    style: { fontSize: "11px", color: "rgba(255,255,255,0.7)" },
  }, `${paths.length} traiettori${paths.length === 1 ? "a" : "e"}`);

  function syncJson() {
    const curAspect = parseAspect(f.values.aspect);
    const payload = JSON.stringify({
      aspect: curAspect,
      paths: paths.map((p) => p.map(([x, y]) => [Number(x.toFixed(4)), Number(y.toFixed(4))])),
    });
    f.values[inpTracks.id] = payload;
    badge.textContent = `${paths.length} traiettori${paths.length === 1 ? "a" : "e"}`;
    if (typeof onChange === "function") onChange(payload);
  }

  function resizeCanvasFromAspect() {
    const [aw, ah] = imgEl && imgEl.naturalWidth > 0
      ? [imgEl.naturalWidth, imgEl.naturalHeight]
      : parseAspect(f.values.aspect);
    const targetW = 480;
    const targetH = Math.max(220, Math.min(540, Math.round((targetW * ah) / aw)));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
  }

  function drawArrowHead(x1, y1, x2, y2, color) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const len = 11;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - len * Math.cos(angle - Math.PI / 6), y2 - len * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - len * Math.cos(angle + Math.PI / 6), y2 - len * Math.sin(angle + Math.PI / 6));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  function samplePointAt(path, t) {
    if (path.length === 1) return path[0];
    const scaled = t * (path.length - 1);
    const idx = Math.min(path.length - 2, Math.floor(scaled));
    const frac = scaled - idx;
    const [x0, y0] = path[idx];
    const [x1, y1] = path[idx + 1];
    return [x0 + (x1 - x0) * frac, y0 + (y1 - y0) * frac];
  }

  function draw(progress = null) {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
      ctx.drawImage(imgEl, 0, 0, w, h);
      ctx.fillStyle = "rgba(8, 10, 14, 0.22)";
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = "#12131a";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      for (let gx = 40; gx < w; gx += 40) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
      }
      for (let gy = 40; gy < h; gy += 40) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
      }
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.font = "12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Carica un'immagine e disegna le frecce di movimento", w / 2, h / 2);
    }

    const list = activePath ? [...paths, activePath] : paths;
    list.forEach((path, idx) => {
      if (!path || path.length < 1) return;
      const color = COLORS[idx % COLORS.length];
      ctx.beginPath();
      path.forEach(([nx, ny], i) => {
        const px = nx * w;
        const py = ny * h;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();

      const [sx, sy] = path[0];
      ctx.beginPath();
      ctx.arc(sx * w, sy * h, 6, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#0b0c10";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = "#0b0c10";
      ctx.font = "bold 9px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(idx + 1), sx * w, sy * h + 0.5);

      if (path.length >= 2) {
        const [px1, py1] = path[path.length - 2];
        const [px2, py2] = path[path.length - 1];
        drawArrowHead(px1 * w, py1 * h, px2 * w, py2 * h, color);
      }

      if (progress !== null && path.length >= 2) {
        const [mx, my] = samplePointAt(path, progress);
        ctx.beginPath();
        ctx.arc(mx * w, my * h, 7, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
    });
  }

  function stopAnim() {
    if (animRaf) cancelAnimationFrame(animRaf);
    animRaf = 0;
  }

  function playPreview() {
    stopAnim();
    if (!paths.length) return;
    animStart = performance.now();
    const duration = 2200;
    const step = (now) => {
      const t = Math.min(1, (now - animStart) / duration);
      draw(t);
      if (t < 1) animRaf = requestAnimationFrame(step);
      else {
        animRaf = 0;
        draw(null);
      }
    };
    animRaf = requestAnimationFrame(step);
  }

  function pointFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
    return [nx, ny];
  }

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    stopAnim();
    canvas.setPointerCapture?.(e.pointerId);
    const pt = pointFromEvent(e);
    activePath = [pt];
    draw();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!activePath) return;
    const pt = pointFromEvent(e);
    const prev = activePath[activePath.length - 1];
    const dist = Math.hypot((pt[0] - prev[0]) * canvas.width, (pt[1] - prev[1]) * canvas.height);
    if (dist >= 6) {
      activePath.push(pt);
      draw();
    }
  });

  const finishStroke = () => {
    if (!activePath) return;
    if (activePath.length >= 2) {
      paths.push(activePath);
      syncJson();
    }
    activePath = null;
    draw();
  };
  canvas.addEventListener("pointerup", finishStroke);
  canvas.addEventListener("pointercancel", finishStroke);

  function setPreset(kind) {
    stopAnim();
    if (kind === "pan_right") {
      paths = [[[0.25, 0.5], [0.75, 0.5]], [[0.35, 0.3], [0.65, 0.3]]];
    } else if (kind === "pan_left") {
      paths = [[[0.75, 0.5], [0.25, 0.5]], [[0.65, 0.7], [0.35, 0.7]]];
    } else if (kind === "zoom_in") {
      paths = [
        [[0.42, 0.42], [0.18, 0.18]],
        [[0.58, 0.42], [0.82, 0.18]],
        [[0.42, 0.58], [0.18, 0.82]],
        [[0.58, 0.58], [0.82, 0.82]],
      ];
    } else if (kind === "orbit") {
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI * 0.25 + (i / 10) * Math.PI * 0.9;
        pts.push([0.5 + Math.cos(a) * 0.26, 0.52 - Math.sin(a) * 0.22]);
      }
      paths = [pts];
    }
    syncJson();
    draw();
  }

  const btnStyle = {
    padding: "4px 8px",
    fontSize: "11px",
    borderRadius: "6px",
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.14)",
    color: "#f4f4f5",
    cursor: "pointer",
  };

  const toolbar = el("div", {
    style: { display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center", marginTop: "8px" },
  },
    el("button", { type: "button", style: btnStyle, onclick: () => setPreset("pan_right") }, "Pan →"),
    el("button", { type: "button", style: btnStyle, onclick: () => setPreset("pan_left") }, "Pan ←"),
    el("button", { type: "button", style: btnStyle, onclick: () => setPreset("zoom_in") }, "Zoom +"),
    el("button", { type: "button", style: btnStyle, onclick: () => setPreset("orbit") }, "Arco ↻"),
    el("button", {
      type: "button",
      style: { ...btnStyle, marginLeft: "auto" },
      onclick: () => {
        stopAnim();
        if (paths.length) {
          paths.pop();
          syncJson();
          draw();
        }
      },
    }, "Annulla"),
    el("button", {
      type: "button",
      style: btnStyle,
      onclick: () => {
        stopAnim();
        paths = [];
        syncJson();
        draw();
      },
    }, "Pulisci"),
    el("button", {
      type: "button",
      style: { ...btnStyle, background: "rgba(232,255,90,0.16)", borderColor: "#e8ff5a", color: "#e8ff5a" },
      onclick: playPreview,
    }, "Anteprima ▶")
  );

  const wrap = el("div", {
    class: "motionpath-widget",
    style: {
      padding: "10px",
      borderRadius: "10px",
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.1)",
      marginBottom: "10px",
    },
  },
    el("div", {
      style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" },
    },
      el("strong", { style: { fontSize: "12px", color: "#e8ff5a" } }, "Tela Traiettorie Wan-Move"),
      badge
    ),
    canvas,
    toolbar
  );

  wrap._setImage = (url) => {
    if (!url) {
      imgEl = null;
      resizeCanvasFromAspect();
      draw();
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgEl = img;
      resizeCanvasFromAspect();
      draw();
    };
    img.src = url;
  };

  if (initialImageUrl) wrap._setImage(initialImageUrl);
  else draw();

  return wrap;
}
