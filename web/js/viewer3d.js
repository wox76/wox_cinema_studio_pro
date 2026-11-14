// Three.js interactive 3D WebGL canvas with OrbitControls and GLTF loading
import * as THREE from "./vendor/three.module.min.js";
import { GLTFLoader } from "./vendor/GLTFLoader.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { el, icon } from "./util.js";

/**
 * Creates an interactive 3D canvas container for .glb files
 * with OrbitControls (rotate, zoom, pan) and studio lighting.
 */
export function create3DViewer(glbUrl, { width = "100%", height = "100%", onLoaded = null } = {}) {
  const container = el("div", {
    class: "interactive-3d-box",
    style: {
      position: "relative",
      width: typeof width === "number" ? `${width}px` : width,
      height: typeof height === "number" ? `${height}px` : height,
      minHeight: "360px",
      background: "radial-gradient(circle at 50% 40%, #1e1e24 0%, #0d0d11 100%)",
      borderRadius: "14px",
      overflow: "hidden",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "grab",
    }
  });

  const loadingOverlay = el("div", {
    class: "three-loading",
    style: {
      position: "absolute",
      inset: "0",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "10px",
      background: "rgba(10, 10, 14, 0.75)",
      backdropFilter: "blur(4px)",
      color: "#e8ff5a",
      fontSize: "13px",
      zIndex: "5",
      pointerEvents: "none",
    }
  }, icon("cube"), el("span", {}, "Caricamento Modello 3D..."));
  container.appendChild(loadingOverlay);

  const hintOverlay = el("div", {
    style: {
      position: "absolute",
      bottom: "12px",
      left: "12px",
      background: "rgba(0, 0, 0, 0.65)",
      backdropFilter: "blur(6px)",
      border: "1px solid rgba(255, 255, 255, 0.15)",
      borderRadius: "8px",
      padding: "4px 10px",
      color: "#e3e3e8",
      fontSize: "11px",
      pointerEvents: "none",
      zIndex: "4",
      display: "flex",
      gap: "6px",
      alignItems: "center",
    }
  }, icon("cube"), "Trascina per ruotare 3D · Rotellina per Zoom");
  container.appendChild(hintOverlay);

  let renderer, scene, camera, controls, animId;
  let isDisposed = false;

  const init = () => {
    const rect = container.getBoundingClientRect();
    const w = rect.width || 600;
    const h = rect.height || 450;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, w / h, 0.05, 100);
    camera.position.set(0, 1.2, 2.5);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0.6, 0);

    // Studio lighting
    const amb = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(amb);

    const dir1 = new THREE.DirectionalLight(0xffffff, 1.8);
    dir1.position.set(3, 6, 4);
    scene.add(dir1);

    const dir2 = new THREE.DirectionalLight(0x8cb4ff, 1.2);
    dir2.position.set(-4, 3, -3);
    scene.add(dir2);

    // Grid Floor
    const grid = new THREE.GridHelper(6, 20, 0x3a3a46, 0x1f1f26);
    grid.position.y = 0;
    scene.add(grid);

    // Load GLB
    const loader = new GLTFLoader();
    loader.load(
      glbUrl,
      (gltf) => {
        if (isDisposed) return;
        loadingOverlay.remove();
        const root = gltf.scene;

        // Auto center and scale
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) {
          const scale = 1.5 / maxDim;
          root.scale.setScalar(scale);
          root.position.x = -center.x * scale;
          root.position.y = -box.min.y * scale; // sit on grid
          root.position.z = -center.z * scale;
        }

        scene.add(root);
        controls.target.set(0, (size.y * (1.5 / (maxDim || 1))) * 0.5, 0);
        camera.position.set(0, 1.2, 2.4);
        controls.update();

        onLoaded?.(gltf);
      },
      undefined,
      (err) => {
        if (isDisposed) return;
        loadingOverlay.replaceChildren(icon("x"), el("span", { style: { color: "var(--bad, #ff6b5e)" } }, `Errore caricamento: ${err.message || "File .GLB non valido"}`));
      }
    );

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: rw, height: rh } = entry.contentRect;
        if (rw && rh && camera && renderer) {
          camera.aspect = rw / rh;
          camera.updateProjectionMatrix();
          renderer.setSize(rw, rh);
        }
      }
    });
    resizeObserver.observe(container);

    const animate = () => {
      if (isDisposed) return;
      animId = requestAnimationFrame(animate);
      controls?.update();
      renderer?.render(scene, camera);
    };
    animate();

    container._dispose = () => {
      isDisposed = true;
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      controls?.dispose();
      renderer?.dispose();
      renderer?.domElement?.remove();
    };
  };

  setTimeout(init, 0);

  return container;
}
