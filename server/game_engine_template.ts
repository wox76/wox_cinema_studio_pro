// Reusable Three.js 3D Game Engine (WoxGameEngine) bundled into every generated game folder.
// Uses local vendored Three.js (./vendor/three.module.min.js + GLTFLoader.js) for 100% offline play.

export const GAME_ENGINE_JS = `import * as THREE from "./vendor/three.module.min.js";
import { GLTFLoader } from "./vendor/GLTFLoader.js";
import { OrbitControls } from "./vendor/OrbitControls.js";

export { THREE, GLTFLoader, OrbitControls };

/** Procedural WebAudio synthesizer so every game has crisp SFX with zero external files. */
export class SoundFX {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }
  _ensure() {
    if (this.muted) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }
  tone(freq = 440, duration = 0.12, type = "sine", gainVal = 0.15, slideTo = null) {
    const ctx = this._ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), now + duration);
    gain.gain.setValueAtTime(gainVal, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }
  jump() { this.tone(240, 0.16, "triangle", 0.18, 560); }
  collect() {
    this.tone(587, 0.09, "sine", 0.16, 880);
    setTimeout(() => this.tone(880, 0.14, "sine", 0.14, 1175), 65);
  }
  hit() { this.tone(150, 0.22, "sawtooth", 0.2, 48); }
  shoot() { this.tone(720, 0.09, "square", 0.1, 180); }
  win() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, "triangle", 0.16), i * 90));
  }
  gameover() {
    [330, 277, 220, 146].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, "sawtooth", 0.14), i * 110));
  }
}

/** Lightweight particle bursts for impacts, pickups, and trails. */
export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.geo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
  }
  burst(pos, color = 0xe8ff5a, count = 14, speed = 7) {
    const mat = new THREE.MeshBasicMaterial({ color });
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.geo, mat);
      m.position.copy(pos);
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        Math.random() * 1.4 + 0.3,
        (Math.random() - 0.5) * 2
      ).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      this.scene.add(m);
      this.particles.push({ mesh: m, vel, life: 0.45 + Math.random() * 0.35, maxLife: 0.8 });
    }
  }
  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= 15 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += dt * 6;
      p.mesh.rotation.y += dt * 4;
      const s = Math.max(0.01, p.life / p.maxLife);
      p.mesh.scale.setScalar(s);
    }
  }
}

/** Keyboard + mouse input tracker. */
export class InputManager {
  constructor() {
    this.keys = new Set();
    this.justPressed = new Set();
    this.mouse = { x: 0, y: 0, down: false };
    window.addEventListener("keydown", (e) => {
      const k = e.code;
      if (!this.keys.has(k)) this.justPressed.add(k);
      this.keys.add(k);
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(k)) {
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("mousemove", (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });
    window.addEventListener("mousedown", () => { this.mouse.down = true; });
    window.addEventListener("mouseup", () => { this.mouse.down = false; });
  }
  isDown(code) { return this.keys.has(code); }
  consume(code) {
    if (this.justPressed.has(code)) {
      this.justPressed.delete(code);
      return true;
    }
    return false;
  }
  getAxis() {
    let x = 0, z = 0;
    if (this.isDown("KeyA") || this.isDown("ArrowLeft")) x -= 1;
    if (this.isDown("KeyD") || this.isDown("ArrowRight")) x += 1;
    if (this.isDown("KeyW") || this.isDown("ArrowUp")) z -= 1;
    if (this.isDown("KeyS") || this.isDown("ArrowDown")) z += 1;
    return { x, z };
  }
  endFrame() { this.justPressed.clear(); }
}

/** Core Three.js 3D Game Engine. */
export class WoxGameEngine {
  constructor(options = {}) {
    this.options = {
      skyColor: 0x0b0e1a,
      fogColor: 0x0b0e1a,
      fogNear: 24,
      fogFar: 110,
      groundColor: 0x161b2a,
      groundSize: 120,
      gridColor: 0x2a3554,
      cameraMode: "third-person",
      ...options,
    };

    this.state = "menu"; // menu | playing | paused | gameover | victory
    this.score = 0;
    this.health = 100;
    this.maxHealth = 100;
    this.elapsed = 0;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    const mount = document.getElementById("game-canvas") || document.body;
    mount.innerHTML = "";
    mount.appendChild(this.renderer.domElement);

    // Scene & Fog
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.options.skyColor);
    this.scene.fog = new THREE.Fog(this.options.fogColor, this.options.fogNear, this.options.fogFar);

    // Camera
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300);
    this.camera.position.set(0, 7, 12);

    // Lighting Rig
    this.hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.9);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff7ed, 2.0);
    this.sunLight.position.set(18, 32, 16);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 120;
    const d = 40;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.scene.add(this.sunLight);

    this.rimLight = new THREE.DirectionalLight(0x60a5fa, 0.65);
    this.rimLight.position.set(-16, 12, -18);
    this.scene.add(this.rimLight);

    // Default Ground & Grid
    const groundGeo = new THREE.PlaneGeometry(this.options.groundSize, this.options.groundSize);
    const groundMat = new THREE.MeshStandardMaterial({
      color: this.options.groundColor,
      roughness: 0.85,
      metalness: 0.1,
    });
    this.ground = new THREE.Mesh(groundGeo, groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.grid = new THREE.GridHelper(this.options.groundSize, 40, this.options.gridColor, this.options.gridColor);
    this.grid.position.y = 0.02;
    this.grid.material.opacity = 0.28;
    this.grid.material.transparent = true;
    this.scene.add(this.grid);

    // Subsystems
    this.loader = new GLTFLoader();
    this.models = new Map();
    this.input = new InputManager();
    this.sfx = new SoundFX();
    this.particles = new ParticleSystem(this.scene);

    this._followTarget = null;
    this._followOffset = new THREE.Vector3(0, 6.5, 11);
    this._updateFn = null;
    this._lastTime = performance.now();

    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  /** Load a Blender-exported .glb model, normalize its height, center XZ, and place bottom at Y=0. */
  async loadModel(name, url, { targetHeight = 2.0, fallbackColor = 0xe8ff5a } = {}) {
    try {
      const gltf = await this.loader.loadAsync(url);
      const root = gltf.scene || new THREE.Group();
      root.traverse((obj) => {
        if (obj.isMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
        }
      });
      const box = new THREE.Box3().setFromObject(root);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      const maxDim = Math.max(size.x, size.y, size.z, 0.001);
      const scale = targetHeight / maxDim;
      root.scale.setScalar(scale);
      root.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

      const wrapper = new THREE.Group();
      wrapper.add(root);
      wrapper.name = name;
      this.models.set(name, wrapper);
      return wrapper;
    } catch (err) {
      console.warn("[WoxGameEngine] Fallback mesh for", name, err);
      const geo = new THREE.BoxGeometry(targetHeight * 0.7, targetHeight, targetHeight * 0.7);
      const mat = new THREE.MeshStandardMaterial({ color: fallbackColor, roughness: 0.4, metalness: 0.2 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = targetHeight * 0.5;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const wrapper = new THREE.Group();
      wrapper.add(mesh);
      wrapper.name = name;
      this.models.set(name, wrapper);
      return wrapper;
    }
  }

  /** Clone a previously loaded model for spawning instances. */
  spawn(name, position = new THREE.Vector3(), scale = 1) {
    const proto = this.models.get(name);
    if (!proto) return new THREE.Group();
    const inst = proto.clone(true);
    inst.position.copy(position);
    if (scale !== 1) inst.scale.multiplyScalar(scale);
    this.scene.add(inst);
    return inst;
  }

  setFollowTarget(obj, offset = null) {
    this._followTarget = obj;
    if (offset) this._followOffset.copy(offset);
  }

  checkSphereCollision(a, b, radiusSum = 1.4) {
    return a.position.distanceToSquared(b.position) <= radiusSum * radiusSum;
  }

  setScore(val) {
    this.score = val;
    const el = document.getElementById("hud-score");
    if (el) el.textContent = String(Math.floor(val));
  }

  addScore(delta) {
    this.setScore(this.score + delta);
  }

  setHealth(val) {
    this.health = Math.max(0, Math.min(this.maxHealth, val));
    const el = document.getElementById("hud-health");
    if (el) el.textContent = \`\${Math.ceil(this.health)}%\`;
    const bar = document.getElementById("hud-health-bar");
    if (bar) bar.style.width = \`\${(this.health / this.maxHealth) * 100}%\`;
  }

  setStatus(text) {
    const el = document.getElementById("hud-status");
    if (el) el.textContent = text;
  }

  showOverlay(mode, title = "", subtitle = "") {
    this.state = mode;
    const overlay = document.getElementById("game-overlay");
    if (!overlay) return;
    if (mode === "playing") {
      overlay.classList.add("hidden");
      return;
    }
    overlay.classList.remove("hidden");
    const tEl = document.getElementById("overlay-title");
    const sEl = document.getElementById("overlay-subtitle");
    const btn = document.getElementById("overlay-btn");
    if (tEl && title) tEl.textContent = title;
    if (sEl && subtitle) sEl.textContent = subtitle;
    if (btn) btn.textContent = mode === "menu" ? "GIOCA ORA" : "RIPROVA";
  }

  start(updateFn) {
    this._updateFn = updateFn;
    this._lastTime = performance.now();
    const tick = (now) => {
      requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - this._lastTime) / 1000);
      this._lastTime = now;

      if (this.state === "playing") {
        this.elapsed += dt;
        if (this._updateFn) this._updateFn(dt, this.elapsed);
        this.particles.update(dt);
      }

      if (this._followTarget) {
        const desired = this._followTarget.position.clone().add(this._followOffset);
        this.camera.position.lerp(desired, 1 - Math.exp(-6 * dt));
        const lookAt = this._followTarget.position.clone();
        lookAt.y += 1.2;
        this.camera.lookAt(lookAt);
      }

      this.renderer.render(this.scene, this.camera);
      this.input.endFrame();
    };
    requestAnimationFrame(tick);
  }
}
`;

export const DEFAULT_STYLE_CSS = `:root {
  --bg: #09090a;
  --panel: rgba(15, 17, 23, 0.78);
  --border: rgba(255, 255, 255, 0.12);
  --accent: #e8ff5a;
  --text: #f4f6fa;
  --dim: #9aa3b2;
  --danger: #ff5c72;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  width: 100%; height: 100%; overflow: hidden;
  background: var(--bg); color: var(--text);
  font-family: Inter, system-ui, -apple-system, sans-serif;
  user-select: none;
}
#game-canvas { position: fixed; inset: 0; width: 100%; height: 100%; }
#hud {
  position: fixed; top: 16px; left: 16px; right: 16px;
  display: flex; justify-content: space-between; align-items: flex-start;
  pointer-events: none; z-index: 10; gap: 12px;
}
.hud-card {
  background: var(--panel); border: 1px solid var(--border);
  backdrop-filter: blur(12px); border-radius: 14px;
  padding: 10px 16px; display: flex; align-items: center; gap: 14px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
}
.hud-metric { display: flex; flex-direction: column; gap: 2px; }
.hud-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--dim); }
.hud-value { font-size: 20px; font-weight: 800; color: var(--accent); font-variant-numeric: tabular-nums; }
.health-track { width: 120px; height: 8px; background: rgba(255,255,255,0.1); border-radius: 99px; overflow: hidden; margin-top: 4px; }
.health-fill { height: 100%; width: 100%; background: linear-gradient(90deg, #4ade80, var(--accent)); transition: width 0.2s ease; }
#hud-controls {
  position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
  background: var(--panel); border: 1px solid var(--border);
  backdrop-filter: blur(10px); border-radius: 99px;
  padding: 8px 18px; font-size: 12px; color: var(--dim); z-index: 10;
  pointer-events: none;
}
#game-overlay {
  position: fixed; inset: 0; z-index: 20;
  display: flex; align-items: center; justify-content: center;
  background: rgba(9, 9, 12, 0.72); backdrop-filter: blur(10px);
  transition: opacity 0.25s ease;
}
#game-overlay.hidden { opacity: 0; pointer-events: none; }
.overlay-box {
  background: rgba(17, 20, 28, 0.92); border: 1px solid var(--border);
  border-radius: 22px; padding: 34px 40px; max-width: 460px; width: 90%;
  text-align: center; box-shadow: 0 24px 60px rgba(0,0,0,0.55);
}
.overlay-box h1 { font-size: 28px; font-weight: 800; margin-bottom: 10px; letter-spacing: -0.02em; }
.overlay-box p { font-size: 14px; color: var(--dim); line-height: 1.5; margin-bottom: 24px; }
#overlay-btn {
  background: var(--accent); color: #11140a; border: none; border-radius: 12px;
  padding: 13px 28px; font-size: 14px; font-weight: 800; letter-spacing: 0.04em;
  cursor: pointer; transition: transform 0.15s ease, filter 0.15s ease;
}
#overlay-btn:hover { transform: translateY(-1px); filter: brightness(1.06); }
`;

export function buildIndexHtml(title: string, tagline: string, controlsHint: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <link rel="stylesheet" href="./style.css" />
</head>
<body>
  <div id="game-canvas"></div>
  <div id="hud">
    <div class="hud-card">
      <div class="hud-metric">
        <span class="hud-label">Punteggio</span>
        <span class="hud-value" id="hud-score">0</span>
      </div>
      <div class="hud-metric">
        <span class="hud-label">Energia</span>
        <span class="hud-value" id="hud-health">100%</span>
        <div class="health-track"><div class="health-fill" id="hud-health-bar"></div></div>
      </div>
    </div>
    <div class="hud-card">
      <div class="hud-metric">
        <span class="hud-label">Stato</span>
        <span class="hud-value" id="hud-status" style="font-size:14px;color:#f4f6fa;">Pronto</span>
      </div>
    </div>
  </div>
  <div id="hud-controls">${esc(controlsHint)}</div>
  <div id="game-overlay">
    <div class="overlay-box">
      <h1 id="overlay-title">${esc(title)}</h1>
      <p id="overlay-subtitle">${esc(tagline)}</p>
      <button id="overlay-btn" type="button">GIOCA ORA</button>
    </div>
  </div>
  <script type="module" src="./game.js"></script>
</body>
</html>
`;
}
