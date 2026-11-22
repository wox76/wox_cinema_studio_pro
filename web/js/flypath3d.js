// Interactive 3D Camera Flight Path Composer for Fly Path 3D (Wan 2.1 + Uni3C).
// Implements Fuobe's 10 camera trajectory presets in Three.js (with 2D fallback)
// and renders a synchronized WebM guide video directly into the app's `video` slot.
import { el, toast } from "./util.js";
import * as THREE from "./vendor/three.module.min.js";

const DEG = Math.PI / 180;

export const PATH_PRESETS = [
  { id: "orbit_360", label: "Orbit 360°", desc: "Giro completo attorno al soggetto" },
  { id: "orbit_90_cw", label: "Arco 90° Sinistra", desc: "Quarto di giro verso sinistra" },
  { id: "orbit_90_ccw", label: "Arco 90° Destra", desc: "Quarto di giro verso destra" },
  { id: "orbit_180_push", label: "Arco Push-Pull 180°", desc: "Mezzo giro con avvicinamento ritmico" },
  { id: "orbit_tilt_20", label: "Anello Inclinato 20°", desc: "Orbita 360° inclinata in quota" },
  { id: "lemniscate", label: "Figura a 8", desc: "Traiettoria continua a otto frontale" },
  { id: "zoom_in", label: "Dolly In", desc: "Avvicinamento frontale fino a 0.6×" },
  { id: "zoom_out", label: "Dolly Out", desc: "Allontanamento frontale fino a 1.5×" },
  { id: "truck_left", label: "Truck Sinistra", desc: "Scorrimento laterale verso sinistra" },
  { id: "truck_right", label: "Truck Destra", desc: "Scorrimento laterale verso destra" },
];

function orbitKeys(sweep) {
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / 90 - 1e-9));
  return Array.from({ length: n + 1 }, (_, i) => ({
    t: i / n,
    azimuth: (sweep * i) / n,
    elevation: 0,
    distance: 1,
    truck: 0,
  }));
}

export function presetKeys(id) {
  const orbit = /^orbit_(\d+(?:\.\d+)?)(?:_(cw|ccw))?$/.exec(id);
  if (orbit) {
    const n = Number(orbit[1]);
    return orbitKeys(orbit[2] === "cw" ? -n : n);
  }
  const eight = (fn) => Array.from({ length: 9 }, (_, i) => ({ t: i / 8, truck: 0, ...fn(i) }));
  switch (id) {
    case "orbit_tilt_20":
      return eight((i) => ({
        azimuth: i * 45,
        elevation: Math.asin(Math.sin(20 * DEG) * Math.sin(i * 45 * DEG)) / DEG,
        distance: 1,
      }));
    case "orbit_180_push":
      return eight((i) => ({
        azimuth: i * 22.5,
        elevation: 0,
        distance: 1 - 0.25 * Math.sin(2 * Math.PI * (i / 8)) ** 2,
      }));
    case "lemniscate": {
      const across = 30;
      const up = (across * Math.tan(30 * DEG)) / 2;
      return eight((i) => {
        const th = Math.PI / 2 + (i * Math.PI) / 4;
        return {
          azimuth: -across * Math.cos(th),
          elevation: up * Math.sin(2 * th),
          distance: 1,
        };
      });
    }
    case "zoom_in":
      return [
        { t: 0, azimuth: 0, elevation: 0, distance: 1, truck: 0 },
        { t: 1, azimuth: 0, elevation: 0, distance: 0.6, truck: 0 },
      ];
    case "zoom_out":
      return [
        { t: 0, azimuth: 0, elevation: 0, distance: 1, truck: 0 },
        { t: 1, azimuth: 0, elevation: 0, distance: 1.5, truck: 0 },
      ];
    case "truck_left":
      return [
        { t: 0, azimuth: 0, elevation: 0, distance: 1, truck: 0 },
        { t: 1, azimuth: 0, elevation: 0, distance: 1, truck: -0.5 },
      ];
    case "truck_right":
      return [
        { t: 0, azimuth: 0, elevation: 0, distance: 1, truck: 0 },
        { t: 1, azimuth: 0, elevation: 0, distance: 1, truck: 0.5 },
      ];
    default:
      return orbitKeys(360);
  }
}

export function sampleCameraKey(keys, t) {
  if (!keys.length) return { t: 0, azimuth: 0, elevation: 0, distance: 1, truck: 0 };
  if (t <= keys[0].t) return keys[0];
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = Math.max(1e-6, b.t - a.t);
      const u = (t - a.t) / span;
      // Smoothstep easing at ends while preserving key progression
      const s = u * u * (3 - 2 * u);
      return {
        t,
        azimuth: a.azimuth + (b.azimuth - a.azimuth) * s,
        elevation: a.elevation + (b.elevation - a.elevation) * s,
        distance: a.distance + (b.distance - a.distance) * s,
        truck: (a.truck || 0) + ((b.truck || 0) - (a.truck || 0)) * s,
      };
    }
  }
  return keys[keys.length - 1];
}

function parseAspect(aspectVal) {
  if (typeof aspectVal === "string" && aspectVal.includes("x")) {
    const [w, h] = aspectVal.split("x").map(Number);
    if (w > 0 && h > 0) return [w, h];
  }
  return [832, 480];
}

/** Create interactive 3D Fly Path composer widget. */
export function createFlyPath3DWidget({ f, initialImageUrl = null, onVideoRendered }) {
  let presetId = f.values._flyPreset || "orbit_90_ccw";
  let intensity = Number(f.values._flyIntensity ?? 1.0);
  let tPreview = 0;
  let playing = false;
  let rendering = false;
  let rafId = 0;

  const [aw, ah] = parseAspect(f.values.aspect);
  const viewW = 460;
  const viewH = Math.max(220, Math.min(460, Math.round((viewW * ah) / aw)));

  const stageWrap = el("div", {
    style: {
      position: "relative",
      width: "100%",
      borderRadius: "8px",
      overflow: "hidden",
      background: "#0d0f14",
      border: "1px solid rgba(255,255,255,0.12)",
    },
  });

  const statusNode = el("span", {
    style: { fontSize: "11px", color: "rgba(255,255,255,0.68)" },
  }, f.files.video ? "Guida 3D pronta ✓" : "Scegli traiettoria");

  // 3D WebGL renderer with graceful 2D fallback
  let renderer = null;
  let scene = null;
  let camera = null;
  let photoMesh = null;
  let canvas = null;
  let ctx2d = null;
  let imgFor2d = null;
  const BASE_DIST = 2.6;

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(viewW, viewH, false);
    canvas = renderer.domElement;
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    canvas.style.display = "block";

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0e14);
    camera = new THREE.PerspectiveCamera(42, viewW / viewH, 0.1, 40);

    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const grid = new THREE.GridHelper(10, 20, 0x3b82f6, 0x1e293b);
    grid.position.y = -0.95;
    scene.add(grid);

    const frameGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(2.2, 1.5, 1.8));
    const frameLines = new THREE.LineSegments(
      frameGeo,
      new THREE.LineBasicMaterial({ color: 0xe8ff5a, transparent: true, opacity: 0.18 })
    );
    scene.add(frameLines);

    const planeGeo = new THREE.PlaneGeometry(2.0, 2.0 * (viewH / viewW));
    const planeMat = new THREE.MeshBasicMaterial({ color: 0x334155, side: THREE.DoubleSide });
    photoMesh = new THREE.Mesh(planeGeo, planeMat);
    scene.add(photoMesh);
  } catch {
    renderer = null;
    canvas = el("canvas", {
      width: viewW,
      height: viewH,
      style: { width: "100%", display: "block" },
    });
    ctx2d = canvas.getContext("2d");
  }

  stageWrap.appendChild(canvas);

  function scaledKey(t) {
    const k = sampleCameraKey(presetKeys(presetId), t);
    return {
      azimuth: k.azimuth * intensity,
      elevation: k.elevation * intensity,
      distance: 1 + (k.distance - 1) * intensity,
      truck: (k.truck || 0) * intensity,
    };
  }

  function renderAt(t) {
    const pose = scaledKey(t);
    if (renderer && camera && scene) {
      const az = pose.azimuth * DEG;
      const elv = pose.elevation * DEG;
      const r = Math.max(0.4, BASE_DIST * pose.distance);
      const tx = pose.truck * BASE_DIST;
      const cx = r * Math.cos(elv) * Math.sin(az) + tx;
      const cy = r * Math.sin(elv);
      const cz = r * Math.cos(elv) * Math.cos(az);
      camera.position.set(cx, cy, cz);
      camera.lookAt(tx, 0, 0);
      renderer.render(scene, camera);
    } else if (ctx2d) {
      const w = canvas.width;
      const h = canvas.height;
      ctx2d.fillStyle = "#0b0e14";
      ctx2d.fillRect(0, 0, w, h);
      const scale = 1 / Math.max(0.4, pose.distance);
      const dx = (-Math.sin(pose.azimuth * DEG) * 0.55 - pose.truck) * w * 0.45;
      const dy = Math.sin(pose.elevation * DEG) * h * 0.45;
      ctx2d.save();
      ctx2d.translate(w / 2 + dx, h / 2 + dy);
      ctx2d.scale(scale, scale);
      if (imgFor2d && imgFor2d.complete && imgFor2d.naturalWidth > 0) {
        ctx2d.drawImage(imgFor2d, -w * 0.42, -h * 0.42, w * 0.84, h * 0.84);
      } else {
        ctx2d.strokeStyle = "#e8ff5a";
        ctx2d.strokeRect(-w * 0.35, -h * 0.35, w * 0.7, h * 0.7);
      }
      ctx2d.restore();
    }
  }

  function updateTexture(url) {
    if (!url) {
      imgFor2d = null;
      if (photoMesh) {
        photoMesh.material.map = null;
        photoMesh.material.color.setHex(0x334155);
        photoMesh.material.needsUpdate = true;
      }
      renderAt(tPreview);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgFor2d = img;
      if (photoMesh && renderer) {
        const tex = new THREE.Texture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
        photoMesh.geometry.dispose();
        const planeH = 1.65;
        photoMesh.geometry = new THREE.PlaneGeometry(planeH * aspect, planeH);
        photoMesh.material.map = tex;
        photoMesh.material.color.setHex(0xffffff);
        photoMesh.material.needsUpdate = true;
      }
      renderAt(tPreview);
    };
    img.src = url;
  }

  function stopPlay() {
    playing = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function togglePlay() {
    if (playing) {
      stopPlay();
      return;
    }
    playing = true;
    const start = performance.now();
    const dur = 2600;
    const tick = (now) => {
      if (!playing) return;
      tPreview = ((now - start) % dur) / dur;
      scrub.value = String(Math.round(tPreview * 100));
      renderAt(tPreview);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  async function renderGuideVideo() {
    if (rendering) return null;
    if (typeof canvas.captureStream !== "function" || typeof MediaRecorder === "undefined") {
      throw new Error("Il browser non supporta MediaRecorder / captureStream per la guida 3D.");
    }
    stopPlay();
    rendering = true;
    renderBtn.disabled = true;
    statusNode.textContent = "Rendering guida 3D...";
    try {
      const stream = canvas.captureStream(25);
      const track = stream.getVideoTracks()[0];
      const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
        .find((m) => MediaRecorder.isTypeSupported(m)) || "";
      const chunks = [];
      const rec = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 2_500_000 } : undefined);
      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      const done = new Promise((resolve, reject) => {
        rec.onstop = () => resolve(new Blob(chunks, { type: mimeType || "video/webm" }));
        rec.onerror = (e) => reject(e.error || new Error("Errore registrazione guida 3D"));
      });
      rec.start(100);
      const totalFrames = 49;
      for (let i = 0; i < totalFrames; i++) {
        tPreview = i / (totalFrames - 1);
        scrub.value = String(Math.round(tPreview * 100));
        renderAt(tPreview);
        track?.requestFrame?.();
        statusNode.textContent = `Rendering guida 3D... ${Math.round(((i + 1) / totalFrames) * 100)}%`;
        await new Promise((r) => setTimeout(r, 38));
      }
      rec.stop();
      const blob = await done;
      stream.getTracks().forEach((tr) => tr.stop());
      if (!blob.size) throw new Error("Video guida 3D vuoto");
      const file = new File([blob], `flypath-${presetId}.webm`, { type: blob.type || "video/webm" });
      statusNode.textContent = `Guida ${presetId} pronta ✓ (${(file.size / 1024).toFixed(0)} KB)`;
      if (typeof onVideoRendered === "function") onVideoRendered(file);
      return file;
    } finally {
      rendering = false;
      renderBtn.disabled = false;
    }
  }

  const presetSelect = el("select", {
    style: {
      flex: "1 1 auto",
      padding: "5px 8px",
      borderRadius: "6px",
      background: "#161822",
      color: "#f4f4f5",
      border: "1px solid rgba(255,255,255,0.14)",
      fontSize: "12px",
    },
    onchange: (e) => {
      presetId = e.target.value;
      f.values._flyPreset = presetId;
      tPreview = 0;
      scrub.value = "0";
      renderAt(0);
    },
  }, ...PATH_PRESETS.map((p) => el("option", { value: p.id, selected: p.id === presetId }, `${p.label} — ${p.desc}`)));

  const scrub = el("input", {
    type: "range",
    min: "0",
    max: "100",
    value: "0",
    style: { flex: "1 1 auto", accentColor: "#e8ff5a" },
    oninput: (e) => {
      stopPlay();
      tPreview = Number(e.target.value) / 100;
      renderAt(tPreview);
    },
  });

  const ampInput = el("input", {
    type: "range",
    min: "0.3",
    max: "1.8",
    step: "0.05",
    value: String(intensity),
    style: { width: "90px", accentColor: "#38bdf8" },
    oninput: (e) => {
      intensity = Number(e.target.value);
      f.values._flyIntensity = intensity;
      ampLabel.textContent = `${intensity.toFixed(2)}×`;
      renderAt(tPreview);
    },
  });
  const ampLabel = el("span", { style: { fontSize: "11px", minWidth: "36px", textAlign: "right" } }, `${intensity.toFixed(2)}×`);

  const renderBtn = el("button", {
    type: "button",
    style: {
      padding: "5px 10px",
      fontSize: "11px",
      fontWeight: "600",
      borderRadius: "6px",
      background: "rgba(232,255,90,0.18)",
      border: "1px solid #e8ff5a",
      color: "#e8ff5a",
      cursor: "pointer",
    },
    onclick: () => renderGuideVideo().catch((err) => toast(err.message, { error: true })),
  }, "Renderizza Guida 3D");

  const playBtn = el("button", {
    type: "button",
    style: {
      padding: "5px 10px",
      fontSize: "11px",
      borderRadius: "6px",
      background: "rgba(255,255,255,0.08)",
      border: "1px solid rgba(255,255,255,0.14)",
      color: "#f4f4f5",
      cursor: "pointer",
    },
    onclick: togglePlay,
  }, "Anteprima ▶");

  const wrap = el("div", {
    class: "flypath3d-widget",
    style: {
      padding: "10px",
      borderRadius: "10px",
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.1)",
      marginBottom: "10px",
      display: "grid",
      gap: "8px",
    },
  },
    el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
      el("strong", { style: { fontSize: "12px", color: "#e8ff5a" } }, "Compositore Volo 3D · Uni3C"),
      statusNode
    ),
    stageWrap,
    el("div", { style: { display: "flex", gap: "6px", alignItems: "center" } }, presetSelect),
    el("div", { style: { display: "flex", gap: "8px", alignItems: "center", fontSize: "11px" } },
      el("span", {}, "Timeline"),
      scrub,
      el("span", {}, "Ampiezza"),
      ampInput,
      ampLabel
    ),
    el("div", { style: { display: "flex", gap: "6px", justifyContent: "space-between" } },
      playBtn,
      renderBtn
    )
  );

  wrap._setImage = updateTexture;
  wrap._renderGuideVideo = renderGuideVideo;

  if (initialImageUrl) updateTexture(initialImageUrl);
  else renderAt(0);

  return wrap;
}
