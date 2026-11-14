// 3D Orbital Camera Widget for Qwen Multiangle
import * as THREE from "./vendor/three.module.min.js";
import { el, icon } from "./util.js";

const CENTER_Y = 0.5;

function cameraPoseFromValues(f) {
  const hzDeg = Number(f.values.horizontal_angle ?? 0);
  const vtDeg = Number(f.values.vertical_angle ?? 0);
  const zoom = Number(f.values.zoom ?? 5.0);
  const azRad = (hzDeg * Math.PI) / 180;
  const elRad = (vtDeg * Math.PI) / 180;
  const dist = 3.4 - (zoom / 10.0) * 2.2;
  return {
    cx: dist * Math.sin(azRad) * Math.cos(elRad),
    cy: CENTER_Y + dist * Math.sin(elRad),
    cz: dist * Math.cos(azRad) * Math.cos(elRad),
    hzDeg,
    vtDeg,
    zoom,
  };
}

function tryCreateWebGLRenderer(w, h) {
  const attempts = [
    { antialias: true, alpha: true, powerPreference: "default" },
    { antialias: false, alpha: true, failIfMajorPerformanceCaveat: false },
  ];
  for (const opts of attempts) {
    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    try {
      const gl = canvas.getContext("webgl2", opts);
      if (!gl || (typeof WebGL2RenderingContext !== "undefined" && !(gl instanceof WebGL2RenderingContext))) {
        continue;
      }
      const renderer = new THREE.WebGLRenderer({ ...opts, canvas, context: gl });
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      return renderer;
    } catch {
      // Try next options on a fresh canvas
    }
  }
  return null;
}

/**
 * Interactive 2D-canvas 3D projection fallback used when WebGL2 cannot be created
 * (e.g., GPU context exhaustion or browser privacy extensions interfering with canvas).
 */
function create2DFallbackRenderer(container, getPose) {
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  container.appendChild(canvas);

  let width = 320;
  let height = 220;
  let imgEl = null;

  const setSize = (w, h) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, Math.round(w));
    height = Math.max(1, Math.round(h));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const setImage = (url) => {
    if (!url) return;
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => { imgEl = im; render(); };
    im.src = url;
  };

  const render = () => {
    const { cx, cy, cz } = getPose();
    ctx.fillStyle = "#0c0c10";
    ctx.fillRect(0, 0, width, height);

    // Camera basis looking from (cx, cy, cz) at (0, CENTER_Y, 0)
    let fx = -cx, fy = CENTER_Y - cy, fz = -cz;
    const fLen = Math.hypot(fx, fy, fz) || 1;
    fx /= fLen; fy /= fLen; fz /= fLen;

    let rx = -fz, ry = 0, rz = fx;
    const rLen = Math.hypot(rx, rz);
    if (rLen < 1e-4) { rx = 1; rz = 0; } else { rx /= rLen; rz /= rLen; }

    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;

    const focal = (height / 2) / Math.tan((45 * Math.PI) / 360);
    const project = (px, py, pz) => {
      const dx = px - cx, dy = py - cy, dz = pz - cz;
      const vx = dx * rx + dy * ry + dz * rz;
      const vy = dx * ux + dy * uy + dz * uz;
      const vz = dx * fx + dy * fy + dz * fz;
      if (vz <= 0.05) return null;
      return [width / 2 + (vx / vz) * focal, height / 2 - (vy / vz) * focal, vz];
    };

    const drawLine = (a, b, color, lw = 1) => {
      const pa = project(a[0], a[1], a[2]);
      const pb = project(b[0], b[1], b[2]);
      if (!pa || !pb) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
      ctx.stroke();
    };

    // Floor grid (5x5 centered at 0)
    for (let i = -2.5; i <= 2.501; i += 0.25) {
      const isAxis = Math.abs(i) < 0.01;
      const col = isAxis ? "rgba(90, 90, 110, 0.7)" : "rgba(40, 40, 52, 0.65)";
      drawLine([i, 0, -2.5], [i, 0, 2.5], col);
      drawLine([-2.5, 0, i], [2.5, 0, i], col);
    }

    // Azimuth ring
    const segs = 48;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      drawLine([Math.cos(a0) * 1.7, 0.01, Math.sin(a0) * 1.7], [Math.cos(a1) * 1.7, 0.01, Math.sin(a1) * 1.7], "rgba(110, 110, 130, 0.5)");
    }

    // Subject card at (0, CENTER_Y, 0), size 0.9 x 1.1
    const hw = 0.45, hh = 0.55;
    const corners3d = [
      [-hw, CENTER_Y + hh, 0],
      [hw, CENTER_Y + hh, 0],
      [hw, CENTER_Y - hh, 0],
      [-hw, CENTER_Y - hh, 0],
    ];
    const pts = corners3d.map(([x, y, z]) => project(x, y, z));
    if (pts.every(Boolean)) {
      const isFront = cz >= 0;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fillStyle = isFront ? "#242430" : "#3a1a2a";
      ctx.fill();
      if (isFront && imgEl) {
        // Approximate affine projection for the card front
        const x0 = pts[0][0], y0 = pts[0][1];
        const x1 = pts[1][0], y1 = pts[1][1];
        const x3 = pts[3][0], y3 = pts[3][1];
        ctx.clip();
        ctx.setTransform(
          (x1 - x0) / imgEl.width * (canvas.width / width),
          (y1 - y0) / imgEl.width * (canvas.width / width),
          (x3 - x0) / imgEl.height * (canvas.height / height),
          (y3 - y0) / imgEl.height * (canvas.height / height),
          x0 * (canvas.width / width),
          y0 * (canvas.height / height)
        );
        ctx.drawImage(imgEl, 0, 0);
      }
      ctx.restore();

      ctx.strokeStyle = "#e8ff5a";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.stroke();
    }
  };

  const r = container.getBoundingClientRect();
  setSize(r.width || 320, r.height || 220);

  return {
    setSize,
    setImage,
    render,
    dispose: () => canvas.remove(),
  };
}

/**
 * Creates an interactive 3D Camera Gimbal/Orbit controller:
 * - Shows an image billboard/subject in the center
 * - Viewport camera is aligned in first-person with the generation camera
 * - User can drag to orbit azimuth (0-360°) and elevation (-30° to +60°)
 * - Sliders sync both ways
 * - Nothing is rendered until "Genera"
 */
export function createCamera3DWidget({
  f,
  inpHz,
  inpVt,
  inpZoom,
  initialImageUrl = null,
  onRelease = null,
}) {
  const container = el("div", {
    class: "camera-3d-widget",
    style: {
      position: "relative",
      width: "100%",
      aspectRatio: "16 / 10",
      minHeight: "260px",
      background: "radial-gradient(circle at 50% 50%, #15151c 0%, #08080a 100%)",
      borderRadius: "12px",
      border: "1px solid rgba(232, 255, 90, 0.25)",
      overflow: "hidden",
      margin: "10px 0 14px",
      cursor: "grab",
      userSelect: "none",
    }
  });

  const badgeOverlay = el("div", {
    style: {
      position: "absolute",
      top: "10px",
      left: "10px",
      zIndex: "5",
      display: "flex",
      gap: "6px",
      alignItems: "center",
      background: "rgba(10, 10, 14, 0.82)",
      backdropFilter: "blur(6px)",
      border: "1px solid rgba(255, 255, 255, 0.15)",
      borderRadius: "8px",
      padding: "4px 8px",
      fontSize: "11px",
      color: "#e8ff5a",
      fontWeight: "600",
      pointerEvents: "none",
    }
  }, icon("camera"), "3D Orbit Camera");
  container.appendChild(badgeOverlay);

  const angleDisplay = el("div", {
    style: {
      position: "absolute",
      bottom: "10px",
      left: "10px",
      zIndex: "5",
      background: "rgba(10, 10, 14, 0.82)",
      backdropFilter: "blur(6px)",
      border: "1px solid rgba(255, 255, 255, 0.15)",
      borderRadius: "8px",
      padding: "4px 8px",
      fontSize: "11.5px",
      color: "#f4f4f8",
      fontVariantNumeric: "tabular-nums",
      pointerEvents: "none",
    }
  }, "0° Azimut · 0° Elevazione");
  container.appendChild(angleDisplay);

  const previewBadge = el("div", {
    class: "cam-fast-preview",
    style: {
      position: "absolute",
      top: "10px",
      right: "10px",
      zIndex: "6",
      background: "rgba(232, 255, 90, 0.15)",
      border: "1px solid rgba(232, 255, 90, 0.4)",
      borderRadius: "8px",
      padding: "4px 8px",
      fontSize: "11px",
      color: "#f4ff9a",
      display: "none",
      alignItems: "center",
      gap: "5px",
    }
  }, icon("spark"), el("span", {}, "Calcolo bozza rapida..."));
  container.appendChild(previewBadge);

  let renderer, scene, mainCamera, cameraIndicator, imageMesh;
  let fallback2D = null;
  let resizeObserver = null;
  let animId = null;
  let isDisposed = false;
  let pendingImageUrl = initialImageUrl;

  const updateAngleDisplay = () => {
    const az = Math.round(f.values.horizontal_angle ?? 0) % 360;
    const elv = Math.round(f.values.vertical_angle ?? 0);
    const z = Number(f.values.zoom ?? 5).toFixed(1);
    angleDisplay.textContent = `${az}° Azimut · ${elv}° Elevazione · Zoom ${z}`;
  };

  const updateCameraPosition = () => {
    const { cx, cy, cz } = cameraPoseFromValues(f);
    if (cameraIndicator) {
      cameraIndicator.position.set(cx, cy, cz);
      cameraIndicator.lookAt(0, CENTER_Y, 0);
    }
    if (mainCamera) {
      mainCamera.position.set(cx, cy, cz);
      mainCamera.lookAt(0, CENTER_Y, 0);
    }
    if (fallback2D) fallback2D.render();
    updateAngleDisplay();
  };

  // Pointer & wheel interaction (works identically in WebGL and 2D fallback)
  let isMouseDown = false;
  let startX = 0, startY = 0;
  let startHz = 0, startVt = 0;

  const onPointerDown = (e) => {
    isMouseDown = true;
    startX = e.clientX;
    startY = e.clientY;
    startHz = Number(f.values.horizontal_angle ?? 0);
    startVt = Number(f.values.vertical_angle ?? 0);
    container.style.cursor = "grabbing";
  };

  const onPointerMove = (e) => {
    if (!isMouseDown) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let nextHz = (startHz - dx * 0.6) % 360;
    if (nextHz < 0) nextHz += 360;
    const nextVt = Math.max(-30, Math.min(60, startVt + dy * 0.4));

    f.values.horizontal_angle = Math.round(nextHz);
    f.values.vertical_angle = Math.round(nextVt);

    updateCameraPosition();
    container.dispatchEvent(new CustomEvent("camchange", {
      detail: { hz: f.values.horizontal_angle, vt: f.values.vertical_angle }
    }));
  };

  const onPointerUp = () => {
    if (!isMouseDown) return;
    isMouseDown = false;
    container.style.cursor = "grab";
    // No render here: generation starts ONLY from the "Genera" button
  };

  const onWheel = (e) => {
    e.preventDefault();
    const curZ = Number(f.values.zoom ?? 5.0);
    const delta = e.deltaY > 0 ? -0.5 : 0.5;
    f.values.zoom = Math.max(0.0, Math.min(10.0, Number((curZ + delta).toFixed(1))));
    updateCameraPosition();
    container.dispatchEvent(new CustomEvent("camchange", { detail: { zoom: f.values.zoom } }));
  };

  container.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  container.addEventListener("wheel", onWheel, { passive: false });

  const applyTexture = (url) => {
    if (!url || isDisposed) return;
    pendingImageUrl = url;
    if (fallback2D) {
      fallback2D.setImage(url);
      return;
    }
    if (!imageMesh) return;
    new THREE.TextureLoader().load(url, (tex) => {
      if (isDisposed || !imageMesh) return;
      tex.colorSpace = THREE.SRGBColorSpace;
      imageMesh.material[4] = new THREE.MeshBasicMaterial({ map: tex });
    });
  };

  const init = () => {
    if (isDisposed) return;
    const rect = container.getBoundingClientRect();
    const w = rect.width || 320;
    const h = rect.height || 220;

    renderer = tryCreateWebGLRenderer(w, h);
    if (!renderer) {
      fallback2D = create2DFallbackRenderer(container, () => cameraPoseFromValues(f));
      if (pendingImageUrl) fallback2D.setImage(pendingImageUrl);
      updateCameraPosition();
      if (window.ResizeObserver) {
        resizeObserver = new ResizeObserver(() => {
          const r = container.getBoundingClientRect();
          if (!r.width || !r.height || isDisposed || !fallback2D) return;
          fallback2D.setSize(r.width, r.height);
          fallback2D.render();
        });
        resizeObserver.observe(container);
      }
      return;
    }

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0c10);

    mainCamera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    mainCamera.position.set(2.8, 2.2, 3.2);
    container.appendChild(renderer.domElement);

    // Grid Floor
    const grid = new THREE.GridHelper(5, 20, 0x3a3a46, 0x16161e);
    grid.position.y = 0;
    scene.add(grid);

    // Azimuth Circle Guide
    const ringGeo = new THREE.RingGeometry(1.68, 1.72, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x4a4a58, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    scene.add(ring);

    // Subject Billboard
    const cardGeo = new THREE.BoxGeometry(0.9, 1.1, 0.02);
    const edgeM = new THREE.MeshBasicMaterial({ color: 0x16161e });
    const frontM = new THREE.MeshBasicMaterial({ color: 0x242430 });
    const backM = new THREE.MeshBasicMaterial({ color: 0x3a1a2a });
    imageMesh = new THREE.Mesh(cardGeo, [edgeM, edgeM, edgeM, edgeM, frontM, backM]);
    imageMesh.position.set(0, CENTER_Y, 0);
    scene.add(imageMesh);

    // Subject Frame Outline
    const wire = new THREE.LineSegments(new THREE.EdgesGeometry(cardGeo), new THREE.LineBasicMaterial({ color: 0xe8ff5a }));
    imageMesh.add(wire);

    // Camera Indicator (hidden in first-person viewport mode)
    const coneGeo = new THREE.ConeGeometry(0.16, 0.38, 4);
    coneGeo.rotateX(Math.PI / 2);
    const coneMat = new THREE.MeshBasicMaterial({ color: 0xe8ff5a, wireframe: true });
    cameraIndicator = new THREE.Mesh(coneGeo, coneMat);
    cameraIndicator.visible = false;
    scene.add(cameraIndicator);

    if (pendingImageUrl) applyTexture(pendingImageUrl);
    updateCameraPosition();

    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(() => {
        const r = container.getBoundingClientRect();
        if (!r.width || !r.height || isDisposed || !renderer || !mainCamera) return;
        mainCamera.aspect = r.width / r.height;
        mainCamera.updateProjectionMatrix();
        renderer.setSize(r.width, r.height);
      });
      resizeObserver.observe(container);
    }

    const animate = () => {
      if (isDisposed || !renderer) return;
      animId = requestAnimationFrame(animate);
      renderer.render(scene, mainCamera);
    };
    animate();
  };

  const initTimer = setTimeout(init, 0);

  container._dispose = () => {
    if (isDisposed) return;
    isDisposed = true;
    clearTimeout(initTimer);
    if (animId !== null) cancelAnimationFrame(animId);
    resizeObserver?.disconnect();
    container.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    container.removeEventListener("wheel", onWheel);
    fallback2D?.dispose();
    renderer?.dispose();
    renderer?.domElement?.remove();
  };

  container._updateVisuals = updateCameraPosition;
  container._showPreviewLoading = (show) => {
    previewBadge.style.display = show ? "inline-flex" : "none";
  };
  container._setImage = applyTexture;

  return container;
}
