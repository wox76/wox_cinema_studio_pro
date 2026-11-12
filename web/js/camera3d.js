// 3D Orbital Camera Widget for Qwen Multiangle
import * as THREE from "./vendor/three.module.min.js";
import { el, icon } from "./util.js";

/**
 * Creates an interactive 3D Camera Gimbal/Orbit controller:
 * - Shows an image billboard/subject in the center
 * - Shows a 3D camera frustum/indicator orbiting around the subject
 * - User can drag to orbit azimuth (0-360°) and elevation (-30° to +60°)
 * - Sliders sync both ways
 * - The viewport camera is the generation camera; nothing is rendered until "Genera"
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

  let renderer, scene, mainCamera, cameraIndicator, imageMesh, orbitControls;
  let animId;
  let isDisposed = false;

  const CENTER_Y = 0.5;

  const updateAngleDisplay = () => {
    const az = Math.round(f.values.horizontal_angle ?? 0) % 360;
    const elv = Math.round(f.values.vertical_angle ?? 0);
    const z = Number(f.values.zoom ?? 5).toFixed(1);
    angleDisplay.textContent = `${az}° Azimut · ${elv}° Elevazione · Zoom ${z}`;
  };

  const updateCameraPosition = () => {
    if (!cameraIndicator) return;
    const hzDeg = Number(f.values.horizontal_angle ?? 0);
    const vtDeg = Number(f.values.vertical_angle ?? 0);
    const zoom = Number(f.values.zoom ?? 5.0);

    const azRad = (hzDeg * Math.PI) / 180;
    const elRad = (vtDeg * Math.PI) / 180;
    const dist = 3.4 - (zoom / 10.0) * 2.2;

    const cx = dist * Math.sin(azRad) * Math.cos(elRad);
    const cy = CENTER_Y + dist * Math.sin(elRad);
    const cz = dist * Math.cos(azRad) * Math.cos(elRad);

    // The viewport camera IS the generation camera: what you see is what you get
    cameraIndicator.position.set(cx, cy, cz);
    cameraIndicator.lookAt(0, CENTER_Y, 0);
    if (mainCamera) {
      mainCamera.position.set(cx, cy, cz);
      mainCamera.lookAt(0, CENTER_Y, 0);
    }

    updateAngleDisplay();
  };

  const init = () => {
    const rect = container.getBoundingClientRect();
    const w = rect.width || 320;
    const h = rect.height || 220;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0c10);

    mainCamera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    mainCamera.position.set(2.8, 2.2, 3.2);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
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

    // Camera Indicator (Stylized camera cone)
    const coneGeo = new THREE.ConeGeometry(0.16, 0.38, 4);
    coneGeo.rotateX(Math.PI / 2);
    const coneMat = new THREE.MeshBasicMaterial({ color: 0xe8ff5a, wireframe: true });
    cameraIndicator = new THREE.Mesh(coneGeo, coneMat);

    const bodyGeo = new THREE.BoxGeometry(0.24, 0.16, 0.2);
    const bodyMat = new THREE.MeshBasicMaterial({ color: 0x22222a });
    const camBody = new THREE.Mesh(bodyGeo, bodyMat);
    camBody.position.z = 0.15;
    cameraIndicator.add(camBody);

    cameraIndicator.visible = false;
    scene.add(cameraIndicator);

    // Pointer Interaction: Dragging directly modifies Camera Azimuth and Elevation
    let isMouseDown = false;
    let startX = 0, startY = 0;
    let startHz = 0, startVt = 0;

    container.addEventListener("pointerdown", (e) => {
      isMouseDown = true;
      startX = e.clientX;
      startY = e.clientY;
      startHz = Number(f.values.horizontal_angle ?? 0);
      startVt = Number(f.values.vertical_angle ?? 0);
      container.style.cursor = "grabbing";
    });

    window.addEventListener("pointermove", (e) => {
      if (!isMouseDown) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      // Sensitivity: 0.8 deg per pixel
      let nextHz = (startHz - dx * 0.6) % 360;
      if (nextHz < 0) nextHz += 360;

      let nextVt = Math.max(-30, Math.min(60, startVt + dy * 0.4));

      f.values.horizontal_angle = Math.round(nextHz);
      f.values.vertical_angle = Math.round(nextVt);

      updateCameraPosition();
      container.dispatchEvent(new CustomEvent("camchange", { detail: { hz: f.values.horizontal_angle, vt: f.values.vertical_angle } }));
    });

    const onPointerUp = () => {
      if (!isMouseDown) return;
      isMouseDown = false;
      container.style.cursor = "grab";
      // No render here: generation starts ONLY from the "Genera" button
    };

    window.addEventListener("pointerup", onPointerUp);

    // Zoom on Wheel
    container.addEventListener("wheel", (e) => {
      e.preventDefault();
      const curZ = Number(f.values.zoom ?? 5.0);
      const delta = e.deltaY > 0 ? -0.5 : 0.5;
      f.values.zoom = Math.max(0.0, Math.min(10.0, Number((curZ + delta).toFixed(1))));
      updateCameraPosition();
      container.dispatchEvent(new CustomEvent("camchange", { detail: { zoom: f.values.zoom } }));
    }, { passive: false });

    // Load reference image texture if available
    if (initialImageUrl) {
      new THREE.TextureLoader().load(initialImageUrl, (tex) => {
        if (isDisposed) return;
        tex.colorSpace = THREE.SRGBColorSpace;
        imageMesh.material[4] = new THREE.MeshBasicMaterial({ map: tex });
      });
    }

    updateCameraPosition();

    if (window.ResizeObserver) {
      new ResizeObserver(() => {
        const r = container.getBoundingClientRect();
        if (!r.width || !r.height || isDisposed) return;
        mainCamera.aspect = r.width / r.height;
        mainCamera.updateProjectionMatrix();
        renderer.setSize(r.width, r.height);
      }).observe(container);
    }

    const animate = () => {
      if (isDisposed) return;
      animId = requestAnimationFrame(animate);
      renderer.render(scene, mainCamera);
    };
    animate();

    container._dispose = () => {
      isDisposed = true;
      cancelAnimationFrame(animId);
      window.removeEventListener("pointerup", onPointerUp);
      renderer?.dispose();
      renderer?.domElement?.remove();
    };
  };

  setTimeout(init, 0);

  container._updateVisuals = updateCameraPosition;
  container._showPreviewLoading = (show) => {
    previewBadge.style.display = show ? "inline-flex" : "none";
  };
  container._setImage = (url) => {
    if (!imageMesh || !url) return;
    new THREE.TextureLoader().load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      imageMesh.material[4] = new THREE.MeshBasicMaterial({ map: tex });
    });
  };

  return container;
}
