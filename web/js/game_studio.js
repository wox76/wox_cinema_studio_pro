// Wox 3D Game Studio (#/game)
// Interfaccia coerente con la creazione Immagini/Video: pannello controlli a sinistra, stage interattivo e cronologia a destra.
import { el, icon, api, toast } from "./util.js";
import * as THREE from "./vendor/three.module.min.js";
import { GLTFLoader } from "./vendor/GLTFLoader.js";
import { OrbitControls } from "./vendor/OrbitControls.js";

const thumbCache = new Map();
let thumbRenderer = null;
let thumbQueue = Promise.resolve();

function renderGlbThumbnail(glbUrl) {
  if (thumbCache.has(glbUrl)) return Promise.resolve(thumbCache.get(glbUrl));
  const task = thumbQueue.then(async () => {
    if (thumbCache.has(glbUrl)) return thumbCache.get(glbUrl);
    if (!thumbRenderer) {
      thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      thumbRenderer.setSize(280, 200);
      thumbRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      thumbRenderer.toneMappingExposure = 1.2;
    }
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0e15);
    scene.add(new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 1.2));
    const dir = new THREE.DirectionalLight(0xffffff, 2.0);
    dir.position.set(4, 6, 5);
    scene.add(dir);
    const rim = new THREE.DirectionalLight(0x60a5fa, 0.9);
    rim.position.set(-4, 3, -4);
    scene.add(rim);

    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(glbUrl);
    const root = gltf.scene;
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const scale = 2.0 / maxDim;
    root.scale.setScalar(scale);
    root.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    scene.add(root);

    const camera = new THREE.PerspectiveCamera(40, 280 / 200, 0.1, 50);
    camera.position.set(2.4, 1.8, 2.8);
    camera.lookAt(0, 0, 0);
    thumbRenderer.render(scene, camera);
    const url = thumbRenderer.domElement.toDataURL("image/png");
    thumbCache.set(glbUrl, url);
    return url;
  }).catch(() => null);
  thumbQueue = task.catch(() => {});
  return task;
}

function openGlbModal(title, glbUrl) {
  const host = el("div", { class: "gs-modal-canvas" });
  let disposed = false;
  let rafId = 0;

  const close = () => {
    disposed = true;
    cancelAnimationFrame(rafId);
    overlay.remove();
    window.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  window.addEventListener("keydown", onKey);

  const overlay = el("div", {
    class: "gs-modal-bg",
    onclick: (e) => { if (e.target === overlay) close(); },
  },
    el("div", { class: "gs-modal-box" },
      el("div", { class: "gs-modal-head" },
        el("strong", {}, `Modello 3D · ${title}`),
        el("span", { style: { fontSize: "12px", color: "var(--dim)" } }, "Trascina per ruotare · Rotellina per zoom"),
        el("button", { class: "btn small ghost", type: "button", onclick: close }, "✕ Chiudi")
      ),
      host
    )
  );
  document.body.appendChild(overlay);

  const w = host.clientWidth || 720;
  const h = host.clientHeight || 500;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090b11);
  scene.add(new THREE.GridHelper(10, 20, 0x2a3554, 0x1a2236));
  scene.add(new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(5, 8, 6);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xe8ff5a, 0.65);
  rim.position.set(-5, 4, -5);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
  camera.position.set(3.2, 2.4, 3.8);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.6;

  let mixer = null;
  const clock = new THREE.Clock();

  new GLTFLoader().load(glbUrl, (gltf) => {
    if (disposed) return;
    const root = gltf.scene;
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const scale = 2.6 / maxDim;
    root.scale.setScalar(scale);
    root.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    scene.add(root);
    controls.target.set(0, (size.y * scale) * 0.5, 0);
    controls.update();
    if (gltf.animations && gltf.animations.length > 0) {
      mixer = new THREE.AnimationMixer(root);
      const action = mixer.clipAction(gltf.animations[0]);
      action.play();
    }
  });

  const tick = () => {
    if (disposed) {
      renderer.dispose();
      return;
    }
    rafId = requestAnimationFrame(tick);
    if (mixer) mixer.update(clock.getDelta());
    controls.update();
    renderer.render(scene, camera);
  };
  tick();
}

const PRESETS = [
  {
    label: "1942 Shoot'em up 3D",
    genre: "shootemup-1942-3d",
    camera: "top-down-vertical",
    style: "retro-arcade-3d",
    prompt: "Shoot'em up verticale 3D ispirato a 1942 degli anni '80: piloto un caccia d'epoca sopra l'oceano con isole e portaerei, sparo raffiche continue contro squadriglie di caccia nemici, bombardieri pesanti e boss, raccogliendo power-up.",
  },
  {
    label: "Super Sidekicks 3D",
    genre: "soccer-sidekicks-3d",
    camera: "broadcast-soccer",
    style: "high-poly-ultra",
    prompt: "Gioco di calcio arcade 3D ispirato a Super Sidekicks del NeoGeo: campo verde 3D con porte, calciatori, portieri e pallone 3D. Dribbling veloce, tiri potenti verso la porta, difensori avversari e tabellone gol.",
  },
  {
    label: "Beat 'em up 3D",
    genre: "beatemup-3d",
    camera: "side-scroll-25d",
    style: "cyberpunk-neon",
    prompt: "Picchiaduro a scorrimento 3D (Beat'em up) in una strada cyberpunk al neon: combo di pugni e calci, ondate di teppisti meccanici, casse distruttibili e medikit.",
  },
  {
    label: "Sparatutto 8-Way",
    genre: "shooter-8way-3d",
    camera: "top-down-isometric",
    style: "low-poly-stylized",
    prompt: "Sparatutto arcade 8-Way in 3D: movimento e fuoco in tutte e 8 le direzioni dentro un'arena futuristica, ondate di robot nemici da ogni lato, potenziamenti armi e ripari.",
  },
];

const SUGGESTED_CAMERA_BY_GENRE = {
  "shootemup-1942-3d": "top-down-vertical",
  "shootemup-rtype-3d": "side-scroll-25d",
  "platform-mario-3d": "side-scroll-25d",
  "platform-ghostsngoblins-3d": "side-scroll-25d",
  "beatemup-3d": "side-scroll-25d",
  "soccer-sidekicks-3d": "broadcast-soccer",
  "shooter-8way-3d": "top-down-isometric",
  "arcade-3d": "top-down-isometric",
  "action-arena": "third-person",
  "racing-runner": "third-person",
  "platformer-3d": "third-person",
  "exploration": "third-person",
};

function injectStyles() {
  if (document.getElementById("wox-game-studio-css")) return;
  const css = `
.gs-wrap { display: grid; grid-template-columns: 370px minmax(0, 1fr); gap: 18px; padding: 18px 22px 32px; max-width: 1680px; margin: 0 auto; min-height: calc(100vh - 110px); }
@media (max-width: 980px) { .gs-wrap { grid-template-columns: 1fr; } }
.gs-panel { background: var(--surf, #111216); border: 1px solid var(--line, rgba(255,255,255,0.09)); border-radius: 18px; padding: 18px; display: flex; flex-direction: column; gap: 14px; align-self: start; }
.gs-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.gs-head h2 { margin: 0; font-size: 17px; font-weight: 800; letter-spacing: -0.02em; display: flex; align-items: center; gap: 8px; }
.gs-badge { font-size: 10.5px; font-weight: 700; padding: 3px 8px; border-radius: 99px; background: rgba(232,255,90,0.14); color: #e8ff5a; border: 1px solid rgba(232,255,90,0.28); }
.gs-status-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 12px; border-radius: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); font-size: 12px; }
.gs-pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 99px; background: rgba(255,255,255,0.05); font-size: 11.5px; }
.gs-dot { width: 7px; height: 7px; border-radius: 50%; background: #64748b; }
.gs-dot.ok { background: #4ade80; box-shadow: 0 0 8px rgba(74,222,128,0.6); }
.gs-dot.off { background: #f59e0b; }
.gs-field { display: flex; flex-direction: column; gap: 6px; }
.gs-field label { font-size: 11.5px; font-weight: 600; color: var(--dim, #9aa3b2); text-transform: uppercase; letter-spacing: 0.05em; }
.gs-textarea { width: 100%; min-height: 112px; resize: vertical; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 11px 12px; color: inherit; font: inherit; font-size: 13.5px; line-height: 1.45; }
.gs-textarea:focus { outline: none; border-color: #e8ff5a; }
.gs-presets { display: flex; flex-wrap: wrap; gap: 6px; }
.gs-chip { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--dim, #cbd5e1); border-radius: 99px; padding: 5px 10px; font-size: 11.5px; cursor: pointer; transition: all 0.15s ease; }
.gs-chip:hover { border-color: #e8ff5a; color: #fff; background: rgba(232,255,90,0.1); }
.gs-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.gs-select { width: 100%; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; padding: 8px 10px; color: inherit; font-size: 12.5px; }
.gs-stage { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.gs-stage-card { background: var(--surf, #111216); border: 1px solid var(--line, rgba(255,255,255,0.09)); border-radius: 18px; overflow: hidden; display: flex; flex-direction: column; min-height: 540px; }
.gs-stage-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.08); flex-wrap: wrap; }
.gs-tabs { display: flex; gap: 6px; }
.gs-tab { background: transparent; border: 1px solid rgba(255,255,255,0.1); color: var(--dim, #9aa3b2); border-radius: 9px; padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer; }
.gs-tab.active { background: rgba(232,255,90,0.14); border-color: rgba(232,255,90,0.45); color: #e8ff5a; }
.gs-iframe-wrap { position: relative; flex: 1; min-height: 500px; background: #07080d; }
.gs-iframe { width: 100%; height: 100%; min-height: 500px; border: 0; display: block; }
.gs-progress-box { padding: 26px; display: flex; flex-direction: column; gap: 18px; flex: 1; }
.gs-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
@media (max-width: 720px) { .gs-steps { grid-template-columns: 1fr 1fr; } }
.gs-step { padding: 12px; border-radius: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); font-size: 12px; color: var(--dim, #9aa3b2); }
.gs-step.active { border-color: #e8ff5a; color: #fff; background: rgba(232,255,90,0.08); }
.gs-step.done { border-color: rgba(74,222,128,0.4); color: #86efac; }
.gs-bar { height: 8px; border-radius: 99px; background: rgba(255,255,255,0.08); overflow: hidden; }
.gs-bar > i { display: block; height: 100%; background: linear-gradient(90deg, #a3e635, #e8ff5a); transition: width 0.35s ease; }
.gs-logs { background: #07080b; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 12px 14px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.55; color: #cbd5e1; height: calc(6 * 1.55em + 24px); max-height: calc(6 * 1.55em + 24px); overflow-y: auto; white-space: pre-wrap; }
.gs-assets-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; padding: 18px; }
.gs-asset-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.09); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.gs-thumb-box { position: relative; width: 100%; aspect-ratio: 14 / 10; border-radius: 9px; overflow: hidden; background: #0c0e15; border: 1px solid rgba(255,255,255,0.07); display: flex; align-items: center; justify-content: center; font-size: 11.5px; color: var(--dim); cursor: pointer; }
.gs-thumb-box img { width: 100%; height: 100%; object-fit: cover; display: block; }
.gs-live-thumbs { display: flex; gap: 10px; overflow-x: auto; padding: 4px 0; }
.gs-live-thumb { min-width: 132px; max-width: 132px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.09); border-radius: 10px; padding: 6px; display: flex; flex-direction: column; gap: 5px; }
.gs-modal-bg { position: fixed; inset: 0; z-index: 9999; background: rgba(5, 6, 10, 0.82); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; padding: 20px; }
.gs-modal-box { width: min(860px, 95vw); height: min(620px, 88vh); background: #11131a; border: 1px solid rgba(255,255,255,0.14); border-radius: 18px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 24px 70px rgba(0,0,0,0.65); }
.gs-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.09); }
.gs-modal-canvas { flex: 1; width: 100%; min-height: 0; position: relative; }
.gs-history { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; }
.gs-hist-card { min-width: 220px; max-width: 240px; background: var(--surf, #111216); border: 1px solid rgba(255,255,255,0.09); border-radius: 14px; padding: 12px; cursor: pointer; display: flex; flex-direction: column; gap: 6px; transition: border-color 0.15s ease; }
.gs-hist-card.active, .gs-hist-card:hover { border-color: #e8ff5a; }
.gs-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 40px; text-align: center; color: var(--dim, #9aa3b2); }
`;
  document.head.appendChild(el("style", { id: "wox-game-studio-css" }, css));
}

export function gameStudioView() {
  injectStyles();

  let statusData = null;
  let games = [];
  let datasetAssets = [];
  let datasetCat = "all";
  let selectedId = null;
  let activeTab = "play"; // play | assets | dataset | files | logs
  let pollTimer = null;
  let disposed = false;

  const statusRow = el("div", { class: "gs-status-row" }, "Verifica Bonsai 2 & Blender...");
  const promptEl = el("textarea", {
    class: "gs-textarea",
    placeholder: "Descrivi il tuo gioco 3D (es. un cyber-runner al neon dove un drone raccoglie cristalli schivando sentinelle)...",
  });
  const genreEl = el("select", { class: "gs-select" },
    el("option", { value: "shootemup-1942-3d" }, "Shoot'em up 3D (stile 1942)"),
    el("option", { value: "shootemup-rtype-3d" }, "Sparatutto 3D (stile R-Type)"),
    el("option", { value: "platform-mario-3d" }, "Platform 3D (stile Super Mario)"),
    el("option", { value: "platform-ghostsngoblins-3d" }, "Platform Action 3D (stile Ghosts 'n Goblins)"),
    el("option", { value: "beatemup-3d" }, "Beat'em up 3D"),
    el("option", { value: "soccer-sidekicks-3d" }, "Calcio 3D (stile Super Sidekicks)"),
    el("option", { value: "shooter-8way-3d" }, "Sparatutto 8-Way 3D"),
    el("option", { value: "arcade-3d" }, "Arcade 3D"),
    el("option", { value: "action-arena" }, "Action / Arena"),
    el("option", { value: "racing-runner" }, "Runner / Racing"),
    el("option", { value: "platformer-3d" }, "Platformer 3D"),
    el("option", { value: "exploration" }, "Esplorazione 3D"),
  );
  const cameraEl = el("select", { class: "gs-select" },
    el("option", { value: "top-down-vertical" }, "Verticale dall'alto (stile 1942)"),
    el("option", { value: "side-scroll-25d" }, "Laterale 2.5D (R-Type / Platform / Beat'em up)"),
    el("option", { value: "broadcast-soccer" }, "Regia Calcio Inclinata (Super Sidekicks)"),
    el("option", { value: "top-down-isometric" }, "Top-Down / Isometrica (8-Way / Arcade)"),
    el("option", { value: "third-person" }, "Terza Persona (Follow 3D)"),
    el("option", { value: "first-person" }, "Prima Persona (FPS)"),
  );
  genreEl.onchange = () => {
    const suggested = SUGGESTED_CAMERA_BY_GENRE[genreEl.value];
    if (suggested) cameraEl.value = suggested;
  };
  cameraEl.value = SUGGESTED_CAMERA_BY_GENRE[genreEl.value] || "third-person";
  const styleEl = el("select", { class: "gs-select" },
    el("option", { value: "low-poly-stylized" }, "Low-Poly Stilizzato"),
    el("option", { value: "high-poly-ultra" }, "High-Poly Ultra Quality"),
    el("option", { value: "cyberpunk-neon" }, "Cyberpunk Neon"),
    el("option", { value: "scifi-metallic" }, "Sci-Fi Metallico"),
    el("option", { value: "fantasy-cartoon" }, "Fantasy Cartoon"),
    el("option", { value: "retro-arcade-3d" }, "Retro Arcade 80s/90s 3D"),
    el("option", { value: "photorealistic-pbr" }, "Fotorealistico PBR"),
    el("option", { value: "cel-shaded-anime" }, "Cel-Shaded / Anime 3D"),
    el("option", { value: "voxel-blocky" }, "Voxel / Blocky 3D"),
  );
  const assetSourceEl = el("select", { class: "gs-select" },
    el("option", { value: "library" }, "Librerie Nostre (Polyfork / OGA)"),
    el("option", { value: "blender" }, "Blender 3D (AI Python)"),
    el("option", { value: "pixal3d" }, "Pixal3D (Z-Image + PBR .GLB)"),
  );

  const genBtn = el("button", { class: "btn lime", type: "button", style: { width: "100%", justifyContent: "center", height: "44px", fontWeight: "800" } },
    icon("spark"), "Genera Gioco 3D"
  );
  const modifyBtn = el("button", { class: "btn ghost", type: "button", style: { width: "100%", justifyContent: "center", height: "38px", fontWeight: "700", borderColor: "rgba(232,255,90,0.35)", color: "#e8ff5a" } },
    "✏️ Modifica Gioco Selezionato"
  );

  const presetBar = el("div", { class: "gs-presets" }, ...PRESETS.map((p) =>
    el("button", {
      class: "gs-chip",
      type: "button",
      onclick: () => {
        promptEl.value = p.prompt;
        genreEl.value = p.genre;
        cameraEl.value = p.camera;
        styleEl.value = p.style;
      },
    }, p.label)
  ));

  const leftPanel = el("aside", { class: "gs-panel" },
    el("div", { class: "gs-head" },
      el("h2", {}, icon("cube"), "Game Studio 3D"),
      el("span", { class: "gs-badge" }, "Bonsai 2 · Blender · Pixal3D")
    ),
    statusRow,
    el("div", { class: "gs-field" },
      el("label", {}, "Idea del Gioco 3D"),
      promptEl,
      presetBar
    ),
    el("div", { class: "gs-grid2" },
      el("div", { class: "gs-field" }, el("label", {}, "Genere"), genreEl),
      el("div", { class: "gs-field" }, el("label", {}, "Telecamera"), cameraEl),
      el("div", { class: "gs-field" }, el("label", {}, "Stile 3D"), styleEl),
      el("div", { class: "gs-field" }, el("label", {}, "Oggetti 3D"), assetSourceEl),
    ),
    genBtn,
    modifyBtn,
    el("p", { style: { margin: "0", fontSize: "11.5px", color: "var(--dim)", lineHeight: "1.45" } },
      "Pipeline autonoma 100% locale: Bonsai 2 progetta il gioco, gli oggetti 3D vengono creati con Librerie Nostre, Blender o Pixal3D (.glb), e WoxGameEngine (Three.js + HTML + CSS) assembla il gioco in out/games/."
    )
  );

  const stageCard = el("section", { class: "gs-stage-card" });
  const historyTitle = el("div", { style: { fontSize: "12px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--dim)", marginTop: "4px" } }, "Storico Giochi 3D");
  const historyStrip = el("div", { class: "gs-history" });
  const rightStage = el("div", { class: "gs-stage" }, stageCard, historyTitle, historyStrip);

  const root = el("div", { class: "gs-wrap" }, leftPanel, rightStage);

  function renderStatus() {
    if (!statusData) return;
    const bOk = Boolean(statusData.bonsai?.online);
    const blOk = Boolean(statusData.blender?.available);
    const items = [
      el("span", { class: "gs-pill" },
        el("span", { class: `gs-dot ${bOk ? "ok" : "off"}` }),
        bOk ? "Bonsai 2: Online" : "Bonsai 2: Spento"
      ),
      el("span", { class: "gs-pill" },
        el("span", { class: `gs-dot ${blOk ? "ok" : "off"}` }),
        blOk ? (statusData.blender.version || "Blender OK") : "Blender mancante"
      ),
    ];
    if (!bOk && statusData.bonsai?.canAutoStart) {
      const startBtn = el("button", {
        class: "btn small lime",
        type: "button",
        style: { height: "26px", padding: "0 10px", fontSize: "11px" },
        onclick: async () => {
          startBtn.disabled = true;
          startBtn.textContent = "Avvio...";
          try {
            const res = await api("/api/games/bonsai/start", { method: "POST" });
            toast(res.message || "Bonsai 2 avviato");
            await refreshStatus();
          } catch (err) {
            toast(err.message, { error: true });
          } finally {
            startBtn.disabled = false;
          }
        },
      }, "Avvia Bonsai 2");
      items.push(startBtn);
    }
    statusRow.replaceChildren(...items);
  }

  async function handleResumeGame(game) {
    try {
      const updated = await api(`/api/games/${encodeURIComponent(game.id)}/resume`, { method: "POST" });
      const idx = games.findIndex((x) => x.id === game.id);
      if (idx >= 0) games[idx] = updated;
      selectedId = updated.id;
      activeTab = "logs";
      renderStage();
      renderHistory();
      toast(`Ripresa generazione di "${updated.title}"...`);
      clearTimeout(pollTimer);
      pollTimer = setTimeout(refreshGames, 1000);
    } catch (err) {
      toast(err.message || "Errore durante la ripresa", { error: true });
    }
  }

  function openDeleteGameModal(game) {
    return new Promise((resolve) => {
      const assetCount = (game.assets || []).length;
      const close = (choice) => {
        overlay.remove();
        window.removeEventListener("keydown", onKey);
        resolve(choice);
      };
      const onKey = (e) => { if (e.key === "Escape") close(null); };
      window.addEventListener("keydown", onKey);

      const overlay = el("div", {
        class: "gs-modal-bg",
        onclick: (e) => { if (e.target === overlay) close(null); },
      },
        el("div", {
          class: "gs-modal-box",
          style: { width: "min(480px, 92vw)", height: "auto", padding: "0" },
        },
          el("div", { class: "gs-modal-head" },
            el("strong", {}, `Elimina "${game.title}"`),
            el("button", { class: "btn small ghost", type: "button", onclick: () => close(null) }, "✕")
          ),
          el("div", { style: { padding: "18px 20px", display: "flex", flexDirection: "column", gap: "14px" } },
            el("p", { style: { margin: "0", fontSize: "13.5px", lineHeight: "1.5", color: "var(--dim, #cbd5e1)" } },
              assetCount > 0
                ? `Questo progetto contiene ${assetCount} modelli 3D (.glb). Vuoi salvarli nella tua Libreria Locale per riutilizzarli in altri giochi oppure eliminare tutto?`
                : "Vuoi eliminare questo progetto e la sua cartella?"
            ),
            el("div", { style: { display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px" } },
              el("button", {
                class: "btn lime",
                type: "button",
                style: { width: "100%", justifyContent: "center", fontWeight: "700" },
                onclick: () => close("keep"),
              }, "📦 Tieni gli asset in Libreria ed Elimina progetto"),
              el("button", {
                class: "btn ghost danger",
                type: "button",
                style: { width: "100%", justifyContent: "center", borderColor: "rgba(255,92,114,0.45)", color: "#ff5c72", fontWeight: "700" },
                onclick: () => close("delete"),
              }, "🗑️ Cancella progetto e tutti gli asset"),
              el("button", {
                class: "btn ghost",
                type: "button",
                style: { width: "100%", justifyContent: "center" },
                onclick: () => close(null),
              }, "Annulla")
            )
          )
        )
      );
      document.body.appendChild(overlay);
    });
  }

  async function handleDeleteGame(game) {
    const choice = await openDeleteGameModal(game);
    if (!choice) return;
    const keepAssets = choice === "keep";
    try {
      const res = await api(`/api/games/${encodeURIComponent(game.id)}?keepAssets=${keepAssets ? "1" : "0"}`, { method: "DELETE" });
      games = games.filter((x) => x.id !== game.id);
      if (selectedId === game.id) selectedId = games[0]?.id || null;
      renderStage();
      renderHistory();
      if (keepAssets) {
        const n = res?.savedAssets ?? 0;
        toast(n > 0 ? `Progetto eliminato · ${n} asset 3D salvati in Libreria!` : "Progetto eliminato (nessun .glb da salvare).");
      } else {
        toast("Progetto e relativi asset eliminati.");
      }
    } catch (err) {
      toast(err.message, { error: true });
    }
  }

  function renderHistory() {
    historyTitle.textContent = games.length ? `Storico Giochi 3D (${games.length})` : "Storico Giochi 3D (vuoto)";
    if (!games.length) {
      historyStrip.replaceChildren();
      return;
    }
    historyStrip.replaceChildren(...games.map((g) => {
      const isAct = g.id === selectedId;
      const stLabel = g.status === "done" ? "✓ Pronto" : g.status === "error" ? "Errore" : `⏳ ${g.progress}%`;
      const resumeBtn = g.status === "error" ? el("button", {
        type: "button",
        title: "Riprendi dallo step interrotto",
        style: {
          background: "rgba(232,255,90,0.16)",
          border: "1px solid rgba(232,255,90,0.45)",
          color: "#e8ff5a",
          borderRadius: "7px",
          height: "22px",
          padding: "0 7px",
          cursor: "pointer",
          fontSize: "10.5px",
          fontWeight: "700",
          flex: "none",
        },
        onclick: (e) => {
          e.stopPropagation();
          void handleResumeGame(g);
        },
      }, "▶ Riprendi") : null;
      const delBtn = el("button", {
        type: "button",
        title: "Elimina gioco",
        "aria-label": "Elimina gioco",
        style: {
          background: "rgba(255,92,114,0.14)",
          border: "1px solid rgba(255,92,114,0.35)",
          color: "#ff5c72",
          borderRadius: "7px",
          width: "22px",
          height: "22px",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          fontSize: "12px",
          flex: "none",
          padding: "0",
        },
        onclick: (e) => {
          e.stopPropagation();
          void handleDeleteGame(g);
        },
      }, "✕");
      return el("div", {
        class: `gs-hist-card ${isAct ? "active" : ""}`,
        onclick: () => {
          selectedId = g.id;
          activeTab = g.status === "done" ? "play" : "logs";
          renderStage();
          renderHistory();
        },
      },
        el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px" } },
          el("strong", { style: { fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "1" } }, g.title),
          resumeBtn,
          delBtn
        ),
        el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px" } },
          el("span", { style: { fontSize: "11px", color: "var(--dim)" } }, `${g.assets?.length || 0} modelli · ${g.genre}`),
          el("span", { style: { fontSize: "11px", fontWeight: "700", color: g.status === "done" ? "#4ade80" : g.status === "error" ? "#ff5c72" : "#e8ff5a" } }, stLabel)
        )
      );
    }));
  }

  function renderStage() {
    const game = games.find((g) => g.id === selectedId);
    if (!game) {
      stageCard.replaceChildren(
        el("div", { class: "gs-empty" },
          el("div", { style: { fontSize: "34px" } }, "🎮"),
          el("h3", { style: { margin: "0", color: "#fff" } }, "Crea il tuo primo gioco 3D in locale"),
          el("p", { style: { maxWidth: "440px", margin: "0", fontSize: "13.5px", lineHeight: "1.5" } },
            "Descrivi la tua idea a sinistra e premi Genera Gioco 3D. L'app progetterà il gioco con Bonsai 2, modellerà gli oggetti 3D in Blender (.glb) e genererà la cartella completa con Three.js, HTML e CSS."
          )
        )
      );
      return;
    }

    const playUrl = `/api/games/${encodeURIComponent(game.id)}/play/index.html`;
    const isRunning = !["done", "error"].includes(game.status);

    const actions = el("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } });
    if (isRunning) {
      actions.append(
        el("button", {
          class: "btn small ghost danger",
          type: "button",
          style: { borderColor: "rgba(255,92,114,0.5)", color: "#ff5c72", fontWeight: "700" },
          onclick: async () => {
            try {
              const stopped = await api(`/api/games/${encodeURIComponent(game.id)}/stop`, { method: "POST" });
              const idx = games.findIndex((x) => x.id === game.id);
              if (idx >= 0) games[idx] = stopped;
              renderStage();
              renderHistory();
              toast("Generazione fermata.");
            } catch (err) {
              toast(err.message || "Errore stop", { error: true });
            }
          },
        }, "⏹ Stop Generazione")
      );
    }
    if (game.status === "error") {
      actions.append(
        el("button", {
          class: "btn small lime",
          type: "button",
          onclick: () => handleResumeGame(game),
        }, "▶ Riprendi da questo step")
      );
    }
    if (game.status === "done") {
      actions.append(
        el("a", { class: "btn small lime", href: playUrl, target: "_blank", rel: "noopener" }, "Apri in Nuova Scheda"),
        el("button", {
          class: "btn small ghost",
          type: "button",
          onclick: () => {
            const iframe = stageCard.querySelector("iframe");
            if (iframe) iframe.src = playUrl + "?t=" + Date.now();
          },
        }, "Ricarica")
      );
    }
    actions.append(
      el("button", {
        class: "btn small ghost danger",
        type: "button",
        onclick: () => handleDeleteGame(game),
      }, "Elimina")
    );

    const tabs = el("div", { class: "gs-tabs" },
      ...[
        ["play", "Gioca Live"],
        ["assets", `Modelli 3D (${game.assets?.length || 0})`],
        ["files", "Cartella & File"],
        ["logs", "Log AI"],
      ].map(([k, label]) =>
        el("button", {
          class: `gs-tab ${activeTab === k ? "active" : ""}`,
          type: "button",
          onclick: () => { activeTab = k; renderStage(); },
        }, label)
      )
    );

    const bar = el("div", { class: "gs-stage-bar" },
      el("div", { style: { display: "flex", flexDirection: "column", gap: "2px" } },
        el("strong", { style: { fontSize: "14.5px" } }, game.title),
        el("span", { style: { fontSize: "11.5px", color: "var(--dim)", fontFamily: "ui-monospace, monospace" } }, game.outputDir)
      ),
      game.status === "done" ? tabs : null,
      actions
    );

    let bodyNode;
    if (isRunning || (game.status === "error" && activeTab !== "files")) {
      const stepOrder = ["designing", "modeling", "packaging", "coding"];
      const curIdx = stepOrder.indexOf(game.status);
      const step2Def =
        game.assetSource === "pixal3d"
          ? ["2. Pixal3D", "Generazione mesh PBR .glb"]
          : game.assetSource === "blender"
            ? ["2. Blender 3D", "Modellazione e export .glb"]
            : ["2. Librerie 3D", "Polyfork / OGA + cache locale"];
      const stepsDef = [
        ["1. Design", "Bonsai 2 progetta meccaniche e asset"],
        step2Def,
        ["3. Engine 3D", "Three.js + WoxGameEngine locale"],
        ["4. Codice", "Bonsai 2 scrive game.js"],
      ];
      const liveBox = game.liveStream ? el("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } },
        el("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11.5px", color: "#e8ff5a", fontWeight: "700" } },
          el("span", { style: { display: "inline-flex", alignItems: "center", gap: "6px" } },
            el("span", { class: "gs-dot ok" }),
            game.liveLabel || "Bonsai 2 Live Output"
          ),
          el("span", { style: { opacity: "0.75", fontFamily: "ui-monospace, monospace" } }, "LIVE STREAM")
        ),
        el("div", { class: "gs-logs", style: { maxHeight: "190px", color: "#e8ff5a", borderColor: "rgba(232,255,90,0.28)" } }, game.liveStream)
      ) : null;

      const readyAssets = (game.assets || []).filter((a) => a.status === "done" || a.status === "fallback");
      const liveThumbsBar = readyAssets.length ? el("div", { class: "gs-live-thumbs" }, ...readyAssets.map((a) => {
        const glbUrl = `/api/games/${encodeURIComponent(game.id)}/play/assets/${encodeURIComponent(a.file)}`;
        const tBox = el("div", {
          class: "gs-thumb-box",
          title: "Clicca per aprire il Viewer 3D",
          onclick: () => openGlbModal(a.name, glbUrl),
        }, "Render 3D...");
        renderGlbThumbnail(glbUrl).then((dataUrl) => {
          if (dataUrl) tBox.replaceChildren(el("img", { src: dataUrl, alt: a.name }));
          else tBox.textContent = "🧊 .glb";
        });
        return el("div", { class: "gs-live-thumb" },
          tBox,
          el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "4px" } },
            el("span", { style: { fontSize: "11px", fontWeight: "700", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, a.name),
            el("button", {
              class: "btn small ghost",
              type: "button",
              style: { height: "20px", padding: "0 6px", fontSize: "10px" },
              onclick: () => openGlbModal(a.name, glbUrl),
            }, "View")
          )
        );
      })) : null;

      const logsEl = el("div", { class: "gs-logs" }, (game.logs || []).join("\n") || "Avvio pipeline...");
      bodyNode = el("div", { class: "gs-progress-box" },
        el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
          el("strong", { style: { fontSize: "15px" } }, game.step || "Elaborazione..."),
          el("span", { style: { fontWeight: "800", color: game.status === "error" ? "#ff5c72" : "#e8ff5a" } },
            game.status === "error" ? "ERRORE" : `${game.progress}%`
          )
        ),
        el("div", { class: "gs-bar" }, el("i", { style: { width: `${game.progress || 5}%` } })),
        el("div", { class: "gs-steps" }, ...stepsDef.map(([t, d], i) => {
          const cls = game.status === "error" ? "" : (i < curIdx ? "done" : i === curIdx ? "active" : "");
          return el("div", { class: `gs-step ${cls}` },
            el("div", { style: { fontWeight: "700", marginBottom: "4px" } }, t),
            el("div", { style: { fontSize: "11px", opacity: "0.85" } }, d)
          );
        })),
        game.error ? el("div", { style: { color: "#ff5c72", fontSize: "13px", padding: "10px 12px", background: "rgba(255,92,114,0.1)", borderRadius: "10px" } }, game.error) : null,
        liveThumbsBar,
        liveBox,
        logsEl
      );
      requestAnimationFrame(() => {
        logsEl.scrollTop = logsEl.scrollHeight;
        const liveLog = liveBox?.querySelector(".gs-logs");
        if (liveLog) liveLog.scrollTop = liveLog.scrollHeight;
      });
    } else if (activeTab === "play") {
      bodyNode = el("div", { class: "gs-iframe-wrap" },
        el("iframe", {
          class: "gs-iframe",
          src: playUrl,
          "data-game-id": game.id,
          allow: "fullscreen; autoplay",
          title: game.title,
        })
      );
    } else if (activeTab === "assets") {
      bodyNode = el("div", { class: "gs-assets-grid" }, ...(game.assets || []).map((a) => {
        const glbUrl = `/api/games/${encodeURIComponent(game.id)}/play/assets/${encodeURIComponent(a.file)}`;
        const tBox = el("div", {
          class: "gs-thumb-box",
          title: "Clicca per ispezionare in 3D",
          onclick: () => openGlbModal(a.name, glbUrl),
        }, "Caricamento 3D...");
        renderGlbThumbnail(glbUrl).then((dataUrl) => {
          if (dataUrl) tBox.replaceChildren(el("img", { src: dataUrl, alt: a.name }));
          else tBox.textContent = "🧊 Modello .glb";
        });
        return el("div", { class: "gs-asset-card" },
          tBox,
          el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
            el("strong", { style: { fontSize: "13.5px" } }, a.name),
            el("span", { class: "gs-badge" }, a.role)
          ),
          el("div", { style: { fontSize: "12px", color: "var(--dim)", lineHeight: "1.4" } }, a.description),
          el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginTop: "auto" } },
            el("span", { style: { fontSize: "11px", fontFamily: "ui-monospace, monospace", color: "#86efac" } },
              `${a.file} ${a.sizeBytes ? `(${Math.round(a.sizeBytes / 1024)} KB)` : ""}`
            ),
            el("button", {
              class: "btn small lime",
              type: "button",
              style: { height: "26px", padding: "0 10px", fontSize: "11px" },
              onclick: () => openGlbModal(a.name, glbUrl),
            }, "View 3D")
          )
        );
      }));
    } else if (activeTab === "dataset") {
      const cats = [
        ["all", "Tutti"],
        ["personaggi", "Personaggi Riggati"],
        ["veicoli-aerei", "Veicoli & Aerei"],
        ["creature-nemici", "Creature & Nemici"],
        ["oggetti-scenari", "Oggetti & Scenari"],
      ];
      const filterBar = el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", padding: "14px 18px 0" } },
        ...cats.map(([cid, clabel]) =>
          el("button", {
            class: `gs-tab ${datasetCat === cid ? "active" : ""}`,
            type: "button",
            onclick: () => { datasetCat = cid; renderStage(); },
          }, clabel)
        )
      );
      const filtered = datasetCat === "all" ? datasetAssets : datasetAssets.filter((x) => x.category === datasetCat);
      const grid = el("div", { class: "gs-assets-grid" }, ...filtered.map((a) => {
        const tBox = el("div", {
          class: "gs-thumb-box",
          title: a.downloaded ? "Clicca per aprire Viewer 3D Animato" : "Scarica prima per vedere l'anteprima 3D",
          onclick: () => { if (a.downloaded && a.localUrl) openGlbModal(a.name, a.localUrl); },
        }, a.downloaded ? "Caricamento 3D..." : "⬇ Da scaricare (.glb)");
        if (a.downloaded && a.localUrl) {
          renderGlbThumbnail(a.localUrl).then((dataUrl) => {
            if (dataUrl) tBox.replaceChildren(el("img", { src: dataUrl, alt: a.name }));
          });
        }
        const dlBtn = el("button", {
          class: `btn small ${a.downloaded ? "lime" : "ghost"}`,
          type: "button",
          style: { height: "26px", padding: "0 10px", fontSize: "11px" },
          onclick: async () => {
            if (a.downloaded && a.localUrl) {
              openGlbModal(a.name, a.localUrl);
              return;
            }
            dlBtn.disabled = true;
            dlBtn.textContent = "Download...";
            try {
              const updated = await api(`/api/games/dataset/${encodeURIComponent(a.id)}/download`, { method: "POST" });
              const idx = datasetAssets.findIndex((x) => x.id === a.id);
              if (idx >= 0) datasetAssets[idx] = updated;
              toast(`✓ "${a.name}" scaricato in locale!`);
              renderStage();
            } catch (err) {
              toast(err.message || "Errore download", { error: true });
              dlBtn.disabled = false;
              dlBtn.textContent = "⬇ Scarica";
            }
          },
        }, a.downloaded ? "▶ View 3D" : "⬇ Scarica");
        return el("div", { class: "gs-asset-card" },
          tBox,
          el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px" } },
            el("strong", { style: { fontSize: "13px" } }, a.name),
            a.rigged ? el("span", { class: "gs-badge" }, "Riggato") : null
          ),
          el("div", { style: { fontSize: "11.5px", color: "var(--dim)", lineHeight: "1.4" } }, a.description),
          a.animations?.length ? el("div", { style: { fontSize: "10.5px", color: "#86efac" } }, `Anim: ${a.animations.slice(0, 4).join(", ")}`) : null,
          el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto", gap: "6px" } },
            el("span", { style: { fontSize: "10.5px", color: "var(--dim)" } }, a.downloaded ? `${Math.round((a.sizeBytes || 0) / 1024)} KB` : a.license),
            dlBtn
          )
        );
      }));
      bodyNode = el("div", { style: { display: "flex", flexDirection: "column" } }, filterBar, grid);
    } else if (activeTab === "files") {
      bodyNode = el("div", { class: "gs-progress-box" },
        el("div", { style: { fontSize: "13px", color: "var(--dim)" } },
          "Cartella autonoma del gioco (puoi eseguirla anche fuori dall'app con ",
          el("code", {}, "./play.sh"), "):"
        ),
        el("div", { class: "gs-logs" },
          `${game.outputDir}\n\n` + (game.files || []).map((f) => `  • ${f}`).join("\n")
        )
      );
    } else {
      bodyNode = el("div", { class: "gs-progress-box" },
        el("div", { class: "gs-logs", style: { maxHeight: "460px" } }, (game.logs || []).join("\n"))
      );
    }

    stageCard.replaceChildren(bar, bodyNode);
  }

  async function refreshStatus() {
    try {
      statusData = await api("/api/games/status");
      renderStatus();
    } catch { /* ignore */ }
  }

  async function refreshGames() {
    try {
      const res = await api("/api/games");
      const prev = games.find((g) => g.id === selectedId);
      games = res.games || [];
      if (!selectedId && games.length) selectedId = games[0].id;
      const cur = games.find((g) => g.id === selectedId);
      if (prev && cur && prev.status !== "done" && cur.status === "done") {
        activeTab = "play";
        toast(`Gioco "${cur.title}" pronto!`);
      }
      const existingIframe = stageCard.querySelector("iframe.gs-iframe");
      const playingSameGame = activeTab === "play" && cur?.status === "done" && existingIframe?.getAttribute("data-game-id") === cur.id;
      if (!playingSameGame) {
        renderStage();
      }
      renderHistory();
      const anyActive = games.some((g) => !["done", "error"].includes(g.status));
      if (!disposed) {
        clearTimeout(pollTimer);
        pollTimer = setTimeout(refreshGames, anyActive ? 1000 : 10000);
      }
    } catch { /* ignore */ }
  }

  modifyBtn.onclick = async () => {
    const cur = games.find((g) => g.id === selectedId);
    if (!cur) {
      toast("Seleziona prima un gioco dallo storico per modificarlo.", { error: true });
      return;
    }
    const instruction = promptEl.value.trim();
    if (!instruction) {
      toast("Scrivi la modifica desiderata nel campo Idea del Gioco 3D.", { error: true });
      promptEl.focus();
      return;
    }
    modifyBtn.disabled = true;
    try {
      const updated = await api(`/api/games/${encodeURIComponent(cur.id)}/modify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction }),
      });
      const idx = games.findIndex((x) => x.id === cur.id);
      if (idx >= 0) games[idx] = updated;
      activeTab = "logs";
      renderStage();
      renderHistory();
      toast(`Modifica di "${cur.title}" avviata con Bonsai 2!`);
      clearTimeout(pollTimer);
      pollTimer = setTimeout(refreshGames, 1000);
    } catch (err) {
      toast(err.message || "Errore avvio modifica", { error: true });
    } finally {
      modifyBtn.disabled = false;
    }
  };

  genBtn.onclick = async () => {
    const prompt = promptEl.value.trim();
    if (!prompt) {
      toast("Descrivi prima il gioco 3D che vuoi creare.", { error: true });
      promptEl.focus();
      return;
    }
    genBtn.disabled = true;
    try {
      const job = await api("/api/games/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          genre: genreEl.value,
          camera: cameraEl.value,
          style: styleEl.value,
          assetSource: assetSourceEl.value,
        }),
      });
      games.unshift(job);
      selectedId = job.id;
      activeTab = "logs";
      renderStage();
      renderHistory();
      toast("Generazione autonoma del gioco 3D avviata!");
      clearTimeout(pollTimer);
      pollTimer = setTimeout(refreshGames, 1200);
    } catch (err) {
      toast(err.message || "Errore avvio generazione", { error: true });
    } finally {
      genBtn.disabled = false;
    }
  };

  async function refreshDataset() {
    try {
      const res = await api("/api/games/dataset");
      datasetAssets = res.assets || [];
    } catch { /* ignore */ }
  }

  refreshStatus();
  refreshDataset();
  refreshGames();

  return {
    node: root,
    active: "game",
    dispose() {
      disposed = true;
      clearTimeout(pollTimer);
    },
  };
}
