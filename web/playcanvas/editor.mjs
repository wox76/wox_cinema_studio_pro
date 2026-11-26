import * as pc from 'playcanvas';
import { Grid } from '/playcanvas/node_modules/playcanvas/scripts/esm/grid.mjs';
import { CameraControls } from '/playcanvas/node_modules/playcanvas/scripts/esm/camera-controls.mjs';

document.getElementById('pc-ver').textContent = `v${pc.version}`;

const canvas = document.getElementById('application-canvas');
const app = new pc.Application(canvas, {
  mouse: new pc.Mouse(canvas),
  touch: new pc.TouchDevice(canvas),
  keyboard: new pc.Keyboard(window),
  graphicsDeviceOptions: { antialias: true, alpha: false }
});

app.setCanvasFillMode(pc.FILLMODE_NONE);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.start();

const resizeCanvas = () => {
  const wrap = document.getElementById('viewport-wrap');
  app.resizeCanvas(wrap.clientWidth, wrap.clientHeight);
};
new ResizeObserver(resizeCanvas).observe(document.getElementById('viewport-wrap'));
resizeCanvas();

// Scene lighting & sky
app.scene.ambientLight = new pc.Color(0.22, 0.25, 0.3);
app.scene.exposure = 1.25;

// Editor Camera + Official PlayCanvas CameraControls
const cameraEntity = new pc.Entity('EditorCamera');
cameraEntity.addComponent('camera', {
  clearColor: new pc.Color(0.09, 0.11, 0.13),
  farClip: 1000,
  nearClip: 0.1,
  fov: 50
});
cameraEntity.setPosition(7, 6, 9);
cameraEntity.lookAt(0, 1, 0);
cameraEntity.addComponent('script');
const camControls = cameraEntity.script.create(CameraControls);
if (camControls) {
  camControls.focusPoint = new pc.Vec3(0, 1, 0);
}
app.root.addChild(cameraEntity);

// Infinite 3D Grid (Official PlayCanvas Grid script)
const gridEntity = new pc.Entity('EditorGrid');
gridEntity.setLocalScale(100, 1, 100);
gridEntity.addComponent('script');
gridEntity.script.create(Grid);
app.root.addChild(gridEntity);

// Official PlayCanvas Transform Gizmos
const gizmoLayer = pc.Gizmo.createLayer(app);
const gizmos = {
  translate: new pc.TranslateGizmo(cameraEntity.camera, gizmoLayer),
  rotate: new pc.RotateGizmo(cameraEntity.camera, gizmoLayer),
  scale: new pc.ScaleGizmo(cameraEntity.camera, gizmoLayer)
};
let activeGizmoMode = 'translate';
let coordSpace = 'world';
let isDraggingGizmo = false;

for (const g of Object.values(gizmos)) {
  g.size = 1.15;
  g.on('transform:start', () => {
    isDraggingGizmo = true;
    if (camControls) camControls.enabled = false;
  });
  g.on('transform:move', () => syncInspectorTransform());
  g.on('transform:end', () => {
    setTimeout(() => { isDraggingGizmo = false; }, 30);
    if (camControls && !isPlaying) camControls.enabled = true;
    syncInspectorTransform();
  });
}

// Scene management
const sceneEntities = [];
let selectedEntity = null;
let isPlaying = false;
let savedSnapshot = null;
let score = 0;

function makePbrMaterial(hex = '#ff6600', metalness = 0.15, gloss = 0.65, emissiveHex = '#000000') {
  const mat = new pc.StandardMaterial();
  mat.diffuse.fromString(hex);
  mat.useMetalness = true;
  mat.metalness = metalness;
  mat.gloss = gloss;
  mat.emissive.fromString(emissiveHex);
  mat.update();
  return mat;
}

function registerEntity(ent, meta) {
  ent.__wox = {
    id: crypto.randomUUID().slice(0, 8),
    kind: meta.kind || 'box',
    color: meta.color || '#d8dee2',
    metalness: meta.metalness ?? 0.15,
    gloss: meta.gloss ?? 0.65,
    behavior: meta.behavior || 'none',
    speed: meta.speed ?? 4.5,
    glbUrl: meta.glbUrl || null,
    vy: 0
  };
  app.root.addChild(ent);
  sceneEntities.push(ent);
  refreshHierarchy();
  return ent;
}

function addPrimitive(kind, opts = {}) {
  const names = { box: 'Cube', sphere: 'Sphere', capsule: 'Player', coin: 'Coin', plane: 'Ground', light: 'DirectionalLight' };
  const count = sceneEntities.filter(e => e.__wox.kind === kind).length + 1;
  const ent = new pc.Entity(opts.name || `${names[kind] || 'Entity'}_${count}`);

  if (kind === 'light') {
    ent.addComponent('light', {
      type: 'directional',
      color: new pc.Color(1, 0.97, 0.92),
      intensity: 1.8,
      castShadows: true,
      shadowBias: 0.2,
      normalOffsetBias: 0.05,
      shadowDistance: 40,
      shadowResolution: 2048
    });
    ent.setEulerAngles(48, 35, 0);
    ent.setPosition(0, 8, 0);
    return registerEntity(ent, { kind: 'light', color: '#fff7eb', ...opts });
  }

  const renderType = kind === 'coin' ? 'cylinder' : kind;
  const color = opts.color || (kind === 'capsule' ? '#ff6600' : kind === 'coin' ? '#ffd43b' : kind === 'plane' ? '#2c393c' : '#58a6ff');
  const mat = makePbrMaterial(color, kind === 'coin' ? 0.85 : 0.15, kind === 'plane' ? 0.35 : 0.7, kind === 'coin' ? '#3a2a00' : '#000000');

  ent.addComponent('render', {
    type: renderType,
    material: mat,
    castShadows: kind !== 'plane',
    receiveShadows: true
  });

  if (kind === 'plane') {
    ent.setLocalScale(18, 1, 18);
    ent.setPosition(0, 0, 0);
  } else if (kind === 'capsule') {
    ent.setPosition(opts.pos?.[0] ?? 0, opts.pos?.[1] ?? 1, opts.pos?.[2] ?? 0);
  } else if (kind === 'coin') {
    ent.setLocalScale(0.7, 0.14, 0.7);
    ent.setEulerAngles(90, 0, 0);
    ent.setPosition(opts.pos?.[0] ?? (Math.random() * 6 - 3), 0.8, opts.pos?.[2] ?? (Math.random() * 6 - 3));
  } else {
    ent.setPosition(opts.pos?.[0] ?? (Math.random() * 4 - 2), opts.pos?.[1] ?? 0.5, opts.pos?.[2] ?? (Math.random() * 4 - 2));
  }

  const defaultBehavior = kind === 'capsule' ? 'player' : kind === 'coin' ? 'coin' : (opts.behavior || 'none');
  return registerEntity(ent, { kind, color, behavior: defaultBehavior, ...opts });
}

async function loadGlbEntity(url, name = 'Model3D', pos = [0, 0, 0]) {
  return new Promise((resolve, reject) => {
    const asset = new pc.Asset(name, 'container', { url });
    app.assets.add(asset);
    asset.once('load', (loaded) => {
      const ent = loaded.resource.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
      ent.name = name.replace(/\.(glb|gltf)$/i, '');
      // Normalize scale roughly to ~2 units
      const aabb = new pc.BoundingBox();
      let hasMesh = false;
      ent.findComponents('render').forEach((r) => {
        r.meshInstances.forEach((mi) => {
          if (!hasMesh) { aabb.copy(mi.aabb); hasMesh = true; }
          else aabb.add(mi.aabb);
        });
      });
      if (hasMesh) {
        const maxDim = Math.max(aabb.halfExtents.x, aabb.halfExtents.y, aabb.halfExtents.z, 0.001) * 2;
        if (maxDim > 4 || maxDim < 0.3) {
          const s = 2.0 / maxDim;
          ent.setLocalScale(s, s, s);
        }
      }
      ent.setPosition(pos[0], pos[1], pos[2]);
      registerEntity(ent, { kind: 'glb', glbUrl: url, color: '#ffffff', behavior: 'none' });
      selectEntity(ent);
      resolve(ent);
    });
    asset.once('error', (err) => reject(err));
    app.assets.load(asset);
  });
}

function updateGizmoAttachment() {
  for (const [mode, g] of Object.entries(gizmos)) {
    g.detach();
    g.coordSpace = coordSpace;
    if (!isPlaying && selectedEntity && mode === activeGizmoMode) {
      g.attach([selectedEntity]);
    }
  }
}

function selectEntity(ent) {
  selectedEntity = ent;
  updateGizmoAttachment();
  refreshHierarchy();
  renderInspector();
}

// Viewport Raycast Picking
canvas.addEventListener('pointerdown', (e) => {
  if (isPlaying || e.button !== 0 || isDraggingGizmo) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const from = cameraEntity.camera.screenToWorld(x, y, cameraEntity.camera.nearClip);
  const to = cameraEntity.camera.screenToWorld(x, y, cameraEntity.camera.farClip);
  const dir = to.clone().sub(from).normalize();
  const ray = new pc.Ray(from, dir);

  let bestEnt = null;
  let bestDist = Infinity;
  const hitPt = new pc.Vec3();

  for (const ent of sceneEntities) {
    if (!ent.enabled) continue;
    const renders = ent.findComponents('render');
    for (const r of renders) {
      for (const mi of r.meshInstances) {
        if (mi.aabb.intersectsRay(ray, hitPt)) {
          const d = hitPt.distance(from);
          if (d < bestDist) {
            bestDist = d;
            bestEnt = ent;
          }
        }
      }
    }
  }
  if (bestEnt && bestEnt.__wox?.kind !== 'plane') {
    selectEntity(bestEnt);
  } else if (bestEnt && !selectedEntity) {
    selectEntity(bestEnt);
  }
});

// UI: Hierarchy
function refreshHierarchy() {
  const list = document.getElementById('hierarchy-list');
  document.getElementById('entity-count').textContent = String(sceneEntities.length);
  list.innerHTML = '';
  const icons = { light: '☀️', capsule: '🏃', coin: '🪙', sphere: '⚪', box: '🧊', plane: '⬛', glb: '📦' };
  for (const ent of sceneEntities) {
    const row = document.createElement('div');
    row.className = 'tree-item' + (ent === selectedEntity ? ' selected' : '');
    const ic = icons[ent.__wox.kind] || '🔹';
    const beh = ent.__wox.behavior !== 'none' ? `<span class="meta">[${ent.__wox.behavior}]</span>` : '';
    row.innerHTML = `<span>${ic} ${ent.name}</span>${beh}`;
    row.onclick = () => selectEntity(ent);
    row.ondblclick = () => {
      if (camControls) camControls.focusPoint = ent.getPosition().clone();
    };
    list.appendChild(row);
  }
}

// UI: Inspector
function numInput(val, step, onChange) {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.step = String(step);
  inp.value = Number(val).toFixed(2);
  inp.addEventListener('input', () => {
    const v = parseFloat(inp.value);
    if (!Number.isNaN(v)) onChange(v);
  });
  return inp;
}

let transformInputs = null;
function syncInspectorTransform() {
  if (!selectedEntity || !transformInputs) return;
  const p = selectedEntity.getLocalPosition();
  const r = selectedEntity.getLocalEulerAngles();
  const s = selectedEntity.getLocalScale();
  const vals = [p.x, p.y, p.z, r.x, r.y, r.z, s.x, s.y, s.z];
  transformInputs.forEach((inp, idx) => {
    if (document.activeElement !== inp) inp.value = vals[idx].toFixed(2);
  });
}

function renderInspector() {
  const body = document.getElementById('inspector-body');
  body.innerHTML = '';
  transformInputs = null;
  if (!selectedEntity) {
    body.innerHTML = `<div style="color:var(--pc-dim);padding:12px;text-align:center;">Seleziona un'entità nella scena o nella Hierarchy.</div>`;
    return;
  }

  const ent = selectedEntity;
  const p = ent.getLocalPosition();
  const r = ent.getLocalEulerAngles();
  const s = ent.getLocalScale();

  // Entity group
  const gEnt = document.createElement('div');
  gEnt.className = 'insp-group';
  gEnt.innerHTML = `<div class="insp-title">Entity</div><div class="insp-row"><label>Nome</label><input type="text" id="insp-name" value="${ent.name}" /></div>`;
  body.appendChild(gEnt);
  gEnt.querySelector('#insp-name').addEventListener('input', (e) => {
    ent.name = e.target.value || 'Entity';
    refreshHierarchy();
  });

  // Transform group
  const gTr = document.createElement('div');
  gTr.className = 'insp-group';
  gTr.innerHTML = `<div class="insp-title">Transform</div>`;
  const inputs = [];
  const makeVecRow = (label, vec, step, applyFn) => {
    const row = document.createElement('div');
    row.className = 'insp-row';
    row.innerHTML = `<label>${label}</label>`;
    const wrap = document.createElement('div');
    wrap.className = 'vec3';
    ['x', 'y', 'z'].forEach((axis) => {
      const inp = numInput(vec[axis], step, (v) => {
        const cur = applyFn();
        cur[axis] = v;
        applyFn(cur);
        updateGizmoAttachment();
      });
      inputs.push(inp);
      wrap.appendChild(inp);
    });
    row.appendChild(wrap);
    gTr.appendChild(row);
  };
  makeVecRow('Position', p, 0.1, (v) => v ? ent.setLocalPosition(v.x, v.y, v.z) : ent.getLocalPosition().clone());
  makeVecRow('Rotation', r, 5, (v) => v ? ent.setLocalEulerAngles(v.x, v.y, v.z) : ent.getLocalEulerAngles().clone());
  makeVecRow('Scale', s, 0.1, (v) => v ? ent.setLocalScale(v.x, v.y, v.z) : ent.getLocalScale().clone());
  transformInputs = inputs;
  body.appendChild(gTr);

  // Material group (if primitive)
  if (ent.render && ent.__wox.kind !== 'glb') {
    const gMat = document.createElement('div');
    gMat.className = 'insp-group';
    gMat.innerHTML = `
      <div class="insp-title">PBR Material</div>
      <div class="insp-row"><label>Colore</label><input type="color" id="insp-col" value="${ent.__wox.color}" style="width:100%;height:26px;padding:1px;" /></div>
      <div class="insp-row"><label>Metalness</label><input type="range" id="insp-met" min="0" max="1" step="0.05" value="${ent.__wox.metalness}" /></div>
      <div class="insp-row"><label>Gloss</label><input type="range" id="insp-glo" min="0" max="1" step="0.05" value="${ent.__wox.gloss}" /></div>
    `;
    body.appendChild(gMat);
    const rebuildMat = () => {
      ent.render.material = makePbrMaterial(ent.__wox.color, ent.__wox.metalness, ent.__wox.gloss);
    };
    gMat.querySelector('#insp-col').addEventListener('input', (e) => { ent.__wox.color = e.target.value; rebuildMat(); });
    gMat.querySelector('#insp-met').addEventListener('input', (e) => { ent.__wox.metalness = parseFloat(e.target.value); rebuildMat(); });
    gMat.querySelector('#insp-glo').addEventListener('input', (e) => { ent.__wox.gloss = parseFloat(e.target.value); rebuildMat(); });
  }

  // Light group
  if (ent.light) {
    const gLight = document.createElement('div');
    gLight.className = 'insp-group';
    gLight.innerHTML = `
      <div class="insp-title">Light Component</div>
      <div class="insp-row"><label>Intensità</label><input type="range" id="insp-int" min="0" max="5" step="0.1" value="${ent.light.intensity}" /></div>
    `;
    body.appendChild(gLight);
    gLight.querySelector('#insp-int').addEventListener('input', (e) => { ent.light.intensity = parseFloat(e.target.value); });
  }

  // Game Behavior Script group
  if (ent.__wox.kind !== 'light' && ent.__wox.kind !== 'plane') {
    const gBeh = document.createElement('div');
    gBeh.className = 'insp-group';
    gBeh.innerHTML = `
      <div class="insp-title">Game Script (Play Mode)</div>
      <div class="insp-row">
        <label>Behavior</label>
        <select id="insp-beh">
          <option value="none">Nessuno (Statico)</option>
          <option value="player">Player Controller (WASD + Salto)</option>
          <option value="coin">Moneta / Raccoglibile (+10 pt)</option>
          <option value="spin">Rotazione continua</option>
          <option value="hover">Fluttuazione verticale</option>
          <option value="patrol">Pattuglia avanti/indietro</option>
        </select>
      </div>
      <div class="insp-row"><label>Velocità</label><input type="number" id="insp-spd" step="0.5" value="${ent.__wox.speed}" /></div>
    `;
    body.appendChild(gBeh);
    const sel = gBeh.querySelector('#insp-beh');
    sel.value = ent.__wox.behavior;
    sel.addEventListener('change', () => { ent.__wox.behavior = sel.value; refreshHierarchy(); });
    gBeh.querySelector('#insp-spd').addEventListener('input', (e) => { ent.__wox.speed = parseFloat(e.target.value) || 4; });
  }
}

// Toolbar wiring
document.querySelectorAll('[data-gizmo]').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('[data-gizmo]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeGizmoMode = btn.dataset.gizmo;
    updateGizmoAttachment();
  };
});

document.getElementById('btn-space').onclick = (e) => {
  coordSpace = coordSpace === 'world' ? 'local' : 'world';
  e.currentTarget.textContent = coordSpace === 'world' ? '🌐 World' : '📐 Local';
  updateGizmoAttachment();
};

document.querySelectorAll('[data-add]').forEach((btn) => {
  btn.onclick = () => {
    const ent = addPrimitive(btn.dataset.add);
    selectEntity(ent);
  };
});

document.getElementById('btn-delete').onclick = () => {
  if (!selectedEntity || isPlaying) return;
  const idx = sceneEntities.indexOf(selectedEntity);
  if (idx >= 0) sceneEntities.splice(idx, 1);
  selectedEntity.destroy();
  selectEntity(null);
};

// Keyboard shortcuts + Play Mode Runtime
let playTime = 0;
window.addEventListener('keydown', (e) => {
  if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  if (!isPlaying) {
    if (e.key === 'w' || e.key === 'W') document.querySelector('[data-gizmo="translate"]').click();
    if (e.key === 'e' || e.key === 'E') document.querySelector('[data-gizmo="rotate"]').click();
    if (e.key === 'r' || e.key === 'R') document.querySelector('[data-gizmo="scale"]').click();
    if (e.key === 'Delete') document.getElementById('btn-delete').click();
    if ((e.key === 'f' || e.key === 'F') && selectedEntity && camControls) {
      camControls.focusPoint = selectedEntity.getPosition().clone();
    }
  }
});

// PLAY / STOP Game Engine Loop
const playBtn = document.getElementById('btn-play');
playBtn.onclick = () => {
  isPlaying = !isPlaying;
  playBtn.classList.toggle('running', isPlaying);
  playBtn.textContent = isPlaying ? '■ STOP' : '▶ PLAY GAME';
  document.getElementById('play-banner').style.display = isPlaying ? 'block' : 'none';
  document.getElementById('hud-score').style.display = isPlaying ? 'inline-block' : 'none';
  gridEntity.enabled = !isPlaying;

  if (isPlaying) {
    score = 0;
    playTime = 0;
    document.getElementById('score-val').textContent = '0';
    savedSnapshot = sceneEntities.map(e => ({
      ent: e,
      pos: e.getLocalPosition().clone(),
      rot: e.getLocalEulerAngles().clone(),
      scale: e.getLocalScale().clone(),
      enabled: e.enabled
    }));
    if (camControls) camControls.enabled = false;
    updateGizmoAttachment();
    canvas.focus();
  } else {
    if (savedSnapshot) {
      for (const s of savedSnapshot) {
        s.ent.enabled = s.enabled;
        s.ent.setLocalPosition(s.pos);
        s.ent.setLocalEulerAngles(s.rot);
        s.ent.setLocalScale(s.scale);
        s.ent.__wox.vy = 0;
      }
    }
    if (camControls) camControls.enabled = true;
    updateGizmoAttachment();
    syncInspectorTransform();
  }
};

let fpsFrames = 0;
let fpsAcc = 0;
app.on('update', (dt) => {
  fpsFrames++;
  fpsAcc += dt;
  if (fpsAcc >= 0.5) {
    document.querySelector('#hud-fps b').textContent = String(Math.round(fpsFrames / fpsAcc));
    fpsFrames = 0;
    fpsAcc = 0;
  }

  if (!isPlaying) return;
  playTime += dt;
  const kb = app.keyboard;
  let playerEnt = null;

  for (const ent of sceneEntities) {
    if (!ent.enabled) continue;
    const w = ent.__wox;
    if (w.behavior === 'player') {
      playerEnt = ent;
      const spd = w.speed || 5;
      let mx = 0, mz = 0;
      if (kb.isPressed(pc.KEY_W) || kb.isPressed(pc.KEY_UP)) mz -= 1;
      if (kb.isPressed(pc.KEY_S) || kb.isPressed(pc.KEY_DOWN)) mz += 1;
      if (kb.isPressed(pc.KEY_A) || kb.isPressed(pc.KEY_LEFT)) mx -= 1;
      if (kb.isPressed(pc.KEY_D) || kb.isPressed(pc.KEY_RIGHT)) mx += 1;
      const p = ent.getLocalPosition();
      const len = Math.hypot(mx, mz) || 1;
      p.x += (mx / len) * spd * dt * (mx || mz ? 1 : 0);
      p.z += (mz / len) * spd * dt * (mx || mz ? 1 : 0);
      if ((kb.wasPressed(pc.KEY_SPACE)) && p.y <= 1.05) {
        w.vy = 6.5;
      }
      w.vy = (w.vy || 0) - 16 * dt;
      p.y += w.vy * dt;
      if (p.y < 1.0) { p.y = 1.0; w.vy = 0; }
      ent.setLocalPosition(p);
      if (mx || mz) {
        const angle = Math.atan2(mx, mz) * (180 / Math.PI);
        ent.setLocalEulerAngles(0, angle, 0);
      }
    } else if (w.behavior === 'spin' || w.behavior === 'coin') {
      ent.rotate(0, (w.speed || 3) * 45 * dt, 0);
    } else if (w.behavior === 'hover') {
      const p = ent.getLocalPosition();
      ent.setLocalPosition(p.x, p.y + Math.sin(playTime * (w.speed || 3)) * 0.015, p.z);
    } else if (w.behavior === 'patrol') {
      const p = ent.getLocalPosition();
      ent.setLocalPosition(p.x + Math.cos(playTime * 1.8) * (w.speed || 3) * dt, p.y, p.z);
    }
  }

  if (playerEnt) {
    const pp = playerEnt.getPosition();
    cameraEntity.setPosition(pp.x, pp.y + 5.5, pp.z + 8.5);
    cameraEntity.lookAt(pp.x, pp.y + 0.8, pp.z);
    for (const ent of sceneEntities) {
      if (ent.enabled && ent.__wox.behavior === 'coin') {
        if (ent.getPosition().distance(pp) < 1.25) {
          ent.enabled = false;
          score += 10;
          document.getElementById('score-val').textContent = String(score);
        }
      }
    }
  }
});

// Import / Drag & Drop .GLB + Scene Save/Load
const glbInput = document.getElementById('file-glb');
document.getElementById('btn-import-glb').onclick = () => glbInput.click();
glbInput.onchange = () => {
  const f = glbInput.files[0];
  if (f) loadGlbEntity(URL.createObjectURL(f), f.name);
  glbInput.value = '';
};

const vpWrap = document.getElementById('viewport-wrap');
vpWrap.addEventListener('dragover', (e) => e.preventDefault());
vpWrap.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f && /\.(glb|gltf)$/i.test(f.name)) {
    loadGlbEntity(URL.createObjectURL(f), f.name);
  }
});

document.getElementById('btn-save').onclick = () => {
  const data = sceneEntities.map(e => ({
    name: e.name,
    pos: [e.getLocalPosition().x, e.getLocalPosition().y, e.getLocalPosition().z],
    rot: [e.getLocalEulerAngles().x, e.getLocalEulerAngles().y, e.getLocalEulerAngles().z],
    scale: [e.getLocalScale().x, e.getLocalScale().y, e.getLocalScale().z],
    wox: e.__wox
  }));
  const blob = new Blob([JSON.stringify({ engine: 'PlayCanvas', version: pc.version, entities: data }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'playcanvas-scene.json';
  a.click();
};

const sceneInput = document.getElementById('file-scene');
document.getElementById('btn-load').onclick = () => sceneInput.click();
sceneInput.onchange = async () => {
  const f = sceneInput.files[0];
  if (!f) return;
  const json = JSON.parse(await f.text());
  while (sceneEntities.length) sceneEntities.pop().destroy();
  for (const item of (json.entities || [])) {
    let ent;
    if (item.wox?.kind === 'glb' && item.wox.glbUrl) {
      ent = await loadGlbEntity(item.wox.glbUrl, item.name, item.pos);
    } else {
      ent = addPrimitive(item.wox?.kind || 'box', { ...item.wox, name: item.name, pos: item.pos });
    }
    ent.setLocalPosition(...item.pos);
    ent.setLocalEulerAngles(...item.rot);
    ent.setLocalScale(...item.scale);
  }
  selectEntity(sceneEntities[0] || null);
  sceneInput.value = '';
};

// Load Wox 3D Library (.glb models from /api/history & /api/games/dataset)
async function loadWoxAssets() {
  const strip = document.getElementById('asset-strip');
  strip.innerHTML = '';
  const presets = [
    { name: 'Player Capsule', sub: 'WASD + Jump', ic: '🏃', action: () => selectEntity(addPrimitive('capsule')) },
    { name: 'Gold Coin', sub: '+10 Score', ic: '🪙', action: () => selectEntity(addPrimitive('coin')) },
    { name: 'Patrol Block', sub: 'Ostacolo mobile', ic: '🧱', action: () => selectEntity(addPrimitive('box', { color: '#ef4444', behavior: 'patrol' })) },
    { name: 'Floating Orb', sub: 'Hover VFX', ic: '🔮', action: () => selectEntity(addPrimitive('sphere', { color: '#a855f7', behavior: 'hover' })) }
  ];
  for (const p of presets) {
    const card = document.createElement('div');
    card.className = 'asset-card';
    card.innerHTML = `<div class="ic">${p.ic}</div><div class="nm">${p.name}</div><div class="sub">${p.sub}</div>`;
    card.onclick = p.action;
    strip.appendChild(card);
  }

  try {
    const res = await fetch('/api/history');
    if (res.ok) {
      const hist = await res.json();
      const entries = Array.isArray(hist) ? hist : (hist.entries || hist.items || []);
      for (const e of entries) {
        for (const o of (e.outputs || [])) {
          if (o.url && /\.glb(\?|$)/i.test(o.url)) {
            const card = document.createElement('div');
            card.className = 'asset-card';
            const nm = o.name || e.app || 'Modello 3D';
            card.innerHTML = `<div class="ic">📦</div><div class="nm" title="${nm}">${nm}</div><div class="sub">Wox 3D .GLB</div>`;
            card.onclick = () => loadGlbEntity(o.url, nm, [0, 0.5, 0]);
            strip.appendChild(card);
          }
        }
      }
    }
  } catch { /* offline */ }
}
document.getElementById('btn-refresh-assets').onclick = loadWoxAssets;

// Build starter playable 3D scene
addPrimitive('light', { name: 'SunLight' });
addPrimitive('plane', { name: 'ArenaFloor' });
const player = addPrimitive('capsule', { name: 'HeroPlayer', pos: [0, 1, 2], color: '#ff6600', behavior: 'player' });
addPrimitive('coin', { name: 'Coin_1', pos: [-2.5, 0.8, -1.5] });
addPrimitive('coin', { name: 'Coin_2', pos: [0, 0.8, -3] });
addPrimitive('coin', { name: 'Coin_3', pos: [2.5, 0.8, -1.5] });
addPrimitive('box', { name: 'MovingPlatform', pos: [0, 0.5, -5.5], color: '#38bdf8', behavior: 'patrol' });
selectEntity(player);
loadWoxAssets();
