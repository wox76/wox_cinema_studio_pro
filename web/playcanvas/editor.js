import * as pc from 'playcanvas';
import { Grid } from '/playcanvas/vendor/grid.js';
import { CameraControls } from '/playcanvas/vendor/camera-controls.js';

document.getElementById('pc-ver').textContent = `v${pc.version}`;

const canvas = document.getElementById('application-canvas');
const app = new pc.Application(canvas, {
  mouse: new pc.Mouse(canvas),
  touch: new pc.TouchDevice(canvas),
  keyboard: new pc.Keyboard(window),
  graphicsDeviceOptions: { antialias: true, alpha: false, preserveDrawingBuffer: true }
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
cameraEntity.lookAt(0, 0, 0);
cameraEntity.addComponent('script');
const camControls = cameraEntity.script.create(CameraControls);
if (camControls) {
  camControls.leftButton = 'orbit';
  camControls.rightButton = 'orbit';
  camControls.middleButton = 'pan';
}
app.root.addChild(cameraEntity);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function focusCameraOn(targetVec) {
  if (!camControls || !targetVec) return;
  const v = targetVec.clone();
  camControls.focusPoint = v;
  if (typeof camControls.focus === 'function' && camControls._camera) {
    camControls.focus(v, false);
  }
}
if (camControls) {
  focusCameraOn(new pc.Vec3(0, 0, 0));
}

// Re-enable camera controls immediately whenever the user clicks/drags on the 3D canvas
canvas.addEventListener('pointerdown', () => {
  if (document.activeElement && isTypingTarget(document.activeElement)) {
    document.activeElement.blur();
  }
  if (camControls && !isPlaying && !isDraggingGizmo) {
    camControls.enabled = true;
  }
}, true);

// Prevent camera / PlayCanvas keyboard listeners from firing while typing in inputs or textareas
const isTypingTarget = (el) => {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};
for (const evName of ['keydown', 'keyup', 'keypress']) {
  window.addEventListener(evName, (e) => {
    if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) {
      e.stopPropagation();
    }
  }, true);
}
document.addEventListener('focusin', (e) => {
  if (isTypingTarget(e.target) && camControls) {
    camControls.enabled = false;
  }
});
document.addEventListener('focusout', (e) => {
  if (isTypingTarget(e.target) && camControls && !isPlaying && !isDraggingGizmo) {
    camControls.enabled = true;
  }
});

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

// Scene management & Programmable World Settings
const sceneEntities = [];
let selectedEntity = null;
let isPlaying = false;
let savedSnapshot = null;
let score = 0;

const sceneSettings = {
  skyColor: '#171c21',
  ambientColor: '#38404d',
  exposure: 1.25,
  fogColor: '#171c21',
  fogDensity: 0,
  gravity: 16,
  cameraMode: 'follow', // follow | top-down | first-person | side-scroll | fixed
  cameraOffset: [0, 5.5, 8.5],
  cameraFov: 50,
};

function applySceneSettings(partial = {}) {
  Object.assign(sceneSettings, partial);
  try {
    cameraEntity.camera.clearColor = new pc.Color().fromString(sceneSettings.skyColor);
    cameraEntity.camera.fov = Number(sceneSettings.cameraFov) || 50;
    app.scene.ambientLight = new pc.Color().fromString(sceneSettings.ambientColor);
    app.scene.exposure = Number(sceneSettings.exposure) || 1.25;
    if (sceneSettings.fogDensity > 0.0001) {
      app.scene.fog = pc.FOG_EXP2;
      app.scene.fogColor = new pc.Color().fromString(sceneSettings.fogColor);
      app.scene.fogDensity = Number(sceneSettings.fogDensity);
    } else {
      app.scene.fog = pc.FOG_NONE;
    }
  } catch {}
}
applySceneSettings();

function makePbrMaterial(hex = '#ff6600', metalness = 0.15, gloss = 0.65, emissiveHex = '#000000') {
  const mat = new pc.StandardMaterial();
  mat.diffuse.fromString(hex);
  mat.useMetalness = true;
  mat.metalness = metalness;
  mat.gloss = gloss;
  mat.emissive.fromString(emissiveHex || '#000000');
  mat.update();
  return mat;
}

function ensureBehaviorConfig(ent) {
  const w = ent.__wox;
  if (!w.cfg) {
    w.cfg = {
      maxHp: 100,
      canJump: true,
      jumpForce: 7.2,
      doubleJump: true,
      attackKey: 'F',
      attackType: 'laser',
      attackDamage: 25,
      camZoom: w.behavior === 'player-25d' ? 13 : 8.5,
      camHeight: w.behavior === 'player-25d' ? 3.2 : 5.5,
      pointerLock: true,
      mouseSens: 0.18,
      eyeHeight: 0.75,
      activateMode: 'range',
      detectRange: 10,
      stopDist: 1.65,
      contactDamage: 10,
      enemyHp: 50,
      patrolRange: 3.5,
      patrolAxis: 'x',
      hoverAmp: 0.45,
      spinAxis: 'y',
      coinValue: 10,
    };
  }
  return w.cfg;
}

function ensurePbrData(ent) {
  const w = ent.__wox;
  if (!w.pbr) {
    w.pbr = {
      name: `${ent.name}_Mat`,
      applyAllMaps: true,
      offset: [0, 0],
      tiling: [1, 1],
      rotation: 0,
      // Ambient
      aoMap: null,
      aoMapName: '',
      aoVertexColor: false,
      ambientColor: '#ffffff',
      aoIntensity: 1,
      // Diffuse
      diffuseMap: null,
      diffuseMapName: '',
      diffuseVertexColor: false,
      diffuseColor: w.color || '#ff6600',
      // Specular / Metalness / Glossiness
      enableGGX: false,
      useMetalness: true,
      metalnessMap: null,
      metalnessMapName: '',
      metalnessVertexColor: false,
      metalness: w.metalness ?? 0.15,
      useSpecularColor: false,
      specularColor: '#ffffff',
      glossMap: null,
      glossMapName: '',
      glossVertexColor: false,
      glossiness: Math.round((w.gloss ?? 0.65) * 100),
      glossInvert: false,
      // Emissive
      emissiveMap: null,
      emissiveMapName: '',
      emissiveVertexColor: false,
      emissiveColor: w.emissive || '#000000',
      emissiveIntensity: 1,
      // Opacity
      blendType: 'none', // none | normal | additive | multiply | premultiplied
      opacityMap: null,
      opacityMapName: '',
      opacityVertexColor: false,
      opacity: 1,
      alphaTest: 0,
      // Normal & ClearCoat
      normalMap: null,
      normalMapName: '',
      bumpiness: 1,
      clearCoat: 0,
      clearCoatGloss: 0.9,
      // Runtime pc.Texture cache (not serialized)
      _tex: {},
    };
  }
  return w.pbr;
}

function stylePbrSphere(el, pbr) {
  if (!el || !pbr) return;
  const base = pbr.diffuseColor || '#ff6600';
  const emi = pbr.emissiveColor && pbr.emissiveColor !== '#000000' ? pbr.emissiveColor : null;
  const glossPct = Math.max(5, Math.min(100, pbr.glossInvert ? (100 - pbr.glossiness) : pbr.glossiness));
  const specSize = Math.round(14 + (100 - glossPct) * 0.34);
  const specAlpha = Math.min(0.95, 0.22 + (glossPct / 100) * 0.55 + (pbr.useMetalness ? pbr.metalness * 0.22 : 0)).toFixed(2);
  el.style.backgroundColor = base;
  if (pbr.diffuseMap) {
    el.style.backgroundImage = `radial-gradient(circle at 32% 28%, rgba(255,255,255,${specAlpha}) 0%, rgba(255,255,255,0) ${specSize}%), radial-gradient(circle at 35% 32%, rgba(0,0,0,0) 48%, rgba(0,0,0,0.72) 100%), url("${pbr.diffuseMap}")`;
    el.style.backgroundSize = '100% 100%, 100% 100%, cover';
    el.style.backgroundPosition = 'center';
  } else {
    el.style.backgroundImage = `radial-gradient(circle at 32% 28%, rgba(255,255,255,${specAlpha}) 0%, rgba(255,255,255,0) ${specSize}%), radial-gradient(circle at 35% 32%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.72) 100%)`;
    el.style.backgroundSize = '100% 100%';
    el.style.backgroundPosition = 'center';
  }
  el.style.opacity = String(Math.max(0.15, Math.min(1, pbr.opacity ?? 1)));
  el.style.boxShadow = emi
    ? `inset -8px -8px 16px rgba(0,0,0,0.55), inset 4px 4px 10px rgba(255,255,255,0.18), 0 0 14px ${emi}`
    : `inset -8px -8px 16px rgba(0,0,0,0.55), inset 4px 4px 10px rgba(255,255,255,0.18), 0 4px 12px rgba(0,0,0,0.45)`;
}

function loadPbrTexture(dataUrl, onReady) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const tex = new pc.Texture(app.graphicsDevice, {
      width: img.width,
      height: img.height,
      format: pc.PIXELFORMAT_RGBA8,
      mipmaps: true,
      minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
      magFilter: pc.FILTER_LINEAR,
      addressU: pc.ADDRESS_REPEAT,
      addressV: pc.ADDRESS_REPEAT,
    });
    tex.setSource(img);
    onReady(tex);
  };
  img.src = dataUrl;
}

function applyPbrToEntity(ent) {
  if (!ent || !ent.__wox) return;
  const pbr = ensurePbrData(ent);
  ent.__wox.color = pbr.diffuseColor;
  ent.__wox.emissive = pbr.emissiveColor;
  ent.__wox.metalness = pbr.metalness;
  ent.__wox.gloss = (pbr.glossiness ?? 60) / 100;

  const mat = new pc.StandardMaterial();
  mat.name = pbr.name || `${ent.name}_Mat`;
  mat.ambient.fromString(pbr.ambientColor || '#ffffff');
  mat.aoIntensity = Number(pbr.aoIntensity ?? 1);
  mat.aoVertexColor = Boolean(pbr.aoVertexColor);

  mat.diffuse.fromString(pbr.diffuseColor || '#ff6600');
  mat.diffuseVertexColor = Boolean(pbr.diffuseVertexColor);

  mat.enableGGXSpecular = Boolean(pbr.enableGGX);
  mat.useMetalness = Boolean(pbr.useMetalness);
  mat.metalness = Number(pbr.metalness ?? 0);
  mat.metalnessVertexColor = Boolean(pbr.metalnessVertexColor);
  mat.useMetalnessSpecularColor = Boolean(pbr.useSpecularColor);
  if (pbr.specularColor) mat.specular.fromString(pbr.specularColor);

  mat.gloss = Math.max(0, Math.min(1, (Number(pbr.glossiness ?? 60)) / 100));
  mat.glossInvert = Boolean(pbr.glossInvert);
  mat.glossVertexColor = Boolean(pbr.glossVertexColor);

  mat.emissive.fromString(pbr.emissiveColor || '#000000');
  mat.emissiveIntensity = Number(pbr.emissiveIntensity ?? 1);
  mat.emissiveVertexColor = Boolean(pbr.emissiveVertexColor);

  const blendMap = {
    none: pc.BLEND_NONE,
    normal: pc.BLEND_NORMAL,
    additive: pc.BLEND_ADDITIVE,
    multiply: pc.BLEND_MULTIPLICATIVE,
    premultiplied: pc.BLEND_PREMULTIPLIED,
  };
  mat.blendType = blendMap[pbr.blendType] ?? pc.BLEND_NONE;
  mat.opacity = Number(pbr.opacity ?? 1);
  mat.opacityVertexColor = Boolean(pbr.opacityVertexColor);
  mat.alphaTest = Number(pbr.alphaTest ?? 0);
  mat.bumpiness = Number(pbr.bumpiness ?? 1);
  mat.clearCoat = Number(pbr.clearCoat ?? 0);
  mat.clearCoatGloss = Number(pbr.clearCoatGloss ?? 0.9);

  // Assign cached pc.Texture maps & UV transforms
  const tx = pbr._tex || {};
  const mapSlots = [
    ['aoMap', 'aoMapOffset', 'aoMapTiling', 'aoMapRotation'],
    ['diffuseMap', 'diffuseMapOffset', 'diffuseMapTiling', 'diffuseMapRotation'],
    ['metalnessMap', 'metalnessMapOffset', 'metalnessMapTiling', 'metalnessMapRotation'],
    ['glossMap', 'glossMapOffset', 'glossMapTiling', 'glossMapRotation'],
    ['emissiveMap', 'emissiveMapOffset', 'emissiveMapTiling', 'emissiveMapRotation'],
    ['opacityMap', 'opacityMapOffset', 'opacityMapTiling', 'opacityMapRotation'],
    ['normalMap', 'normalMapOffset', 'normalMapTiling', 'normalMapRotation'],
  ];
  const offV = new pc.Vec2(Number(pbr.offset?.[0] || 0), Number(pbr.offset?.[1] || 0));
  const tilV = new pc.Vec2(Number(pbr.tiling?.[0] || 1), Number(pbr.tiling?.[1] || 1));
  const rotDeg = Number(pbr.rotation || 0);
  for (const [mKey, oKey, tKey, rKey] of mapSlots) {
    if (tx[mKey]) mat[mKey] = tx[mKey];
    if (pbr.applyAllMaps) {
      mat[oKey] = offV.clone();
      mat[tKey] = tilV.clone();
      mat[rKey] = rotDeg;
    }
  }
  mat.update();

  if (ent.render && ent.render.enabled) {
    ent.render.material = mat;
  } else {
    ent.findComponents('render').forEach((r) => {
      r.meshInstances.forEach((mi) => { mi.material = mat; });
    });
  }
  return mat;
}

function registerEntity(ent, meta) {
  ent.__wox = {
    id: crypto.randomUUID().slice(0, 8),
    kind: meta.kind || 'box',
    color: meta.color || '#d8dee2',
    emissive: meta.emissive || (meta.kind === 'coin' ? '#3a2a00' : '#000000'),
    metalness: meta.metalness ?? 0.15,
    gloss: meta.gloss ?? 0.65,
    behavior: meta.behavior || 'none',
    speed: meta.speed ?? 4.5,
    followTarget: meta.followTarget || '',
    solid: meta.solid ?? (meta.kind !== 'light' && meta.kind !== 'plane' && meta.kind !== 'coin'),
    tag: meta.tag || '',
    script: meta.script || '',
    glbUrl: meta.glbUrl || null,
    _runtime: Boolean(meta._runtime || isPlaying),
    vy: 0
  };
  app.root.addChild(ent);
  sceneEntities.push(ent);
  if (!isPlaying) refreshHierarchy();
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
  const emissive = opts.emissive || (kind === 'coin' ? '#3a2a00' : '#000000');
  const mat = makePbrMaterial(color, opts.metalness ?? (kind === 'coin' ? 0.85 : 0.15), opts.gloss ?? (kind === 'plane' ? 0.35 : 0.7), emissive);

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

function resolveGlbAsset(urlOrName) {
  const raw = String(urlOrName || '').trim();
  if (!raw) return { url: '', name: 'Model3D' };
  const low = raw.toLowerCase();
  const lowBase = low.split('/').pop().replace(/\.(glb|gltf)$/i, '');
  const match = availableGlbAssets.find((a) => {
    const aName = String(a.name || '').toLowerCase();
    const aBase = aName.replace(/\.(glb|gltf)$/i, '');
    const aUrl = String(a.url || '').toLowerCase();
    return aUrl === low || aName === low || aBase === lowBase || aUrl.endsWith('/' + low) || (lowBase.length >= 4 && (aName.includes(lowBase) || aUrl.includes(lowBase)));
  });
  if (match) return { url: match.url, name: match.name };
  return { url: raw, name: raw.split('/').pop() || 'Model3D' };
}

async function loadGlbEntity(url, name = 'Model3D', pos = [0, 0.5, 0]) {
  const st = document.getElementById('ai-status');
  const resolved = url.startsWith('blob:') ? { url, name } : resolveGlbAsset(url);
  const finalUrl = resolved.url || url;
  const safeName = String(name && name !== 'Model3D' ? name : resolved.name || 'Model3D').replace(/\.(glb|gltf)$/i, '');
  let blobUrl = finalUrl;
  let revokeAfter = false;

  try {
    if (!finalUrl.startsWith('blob:')) {
      const res = await fetch(finalUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (!blob.size) throw new Error('File .GLB vuoto');
      blobUrl = URL.createObjectURL(blob);
      revokeAfter = true;
    }
  } catch (err) {
    if (st) st.textContent = `❌ Impossibile scaricare "${safeName}": ${err.message || err}`;
    throw err;
  }

  return new Promise((resolve, reject) => {
    const asset = new pc.Asset(`${safeName}_${Date.now()}`, 'container', {
      url: blobUrl,
      filename: `${safeName}.glb`,
    });
    app.assets.add(asset);
    asset.once('load', (loaded) => {
      if (revokeAfter) {
        try { URL.revokeObjectURL(blobUrl); } catch {}
      }
      const ent = loaded.resource.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
      ent.name = safeName;
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
      if (st) st.textContent = `✅ Modello 3D "${safeName}" inserito in WOX Engine!`;
      resolve(ent);
    });
    asset.once('error', (err) => {
      if (revokeAfter) {
        try { URL.revokeObjectURL(blobUrl); } catch {}
      }
      if (st) st.textContent = `❌ Errore caricamento "${safeName}": ${err}`;
      reject(err);
    });
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

let materialEditMode = false;

function selectEntity(ent) {
  if (selectedEntity !== ent) materialEditMode = false;
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
      focusCameraOn(ent.getPosition());
    };
    list.appendChild(row);
  }
}

// UI: Inspector — Click & drag scrubbing on numeric inputs
// Normal drag: baseStep | SHIFT: finer (0.1x) | CTRL: step of 0.05
function enableNumericScrub(inp, { baseStep = 0.1, ctrlStep = 0.05, decimals = 2, onChange } = {}) {
  inp.classList.add('scrub-num');
  inp.title = 'Trascina orizzontalmente per modificare · SHIFT: fine · CTRL: ±0.05 · Click: digita';

  inp.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (document.activeElement === inp) return;

    e.preventDefault();
    const startX = e.clientX;
    const startVal = parseFloat(inp.value) || 0;
    let dragging = false;

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      if (!dragging && Math.abs(dx) < 3) return;
      if (!dragging) {
        dragging = true;
        document.body.style.cursor = 'ew-resize';
      }

      let next;
      if (ev.ctrlKey || ev.metaKey) {
        const steps = Math.trunc(dx / 12);
        next = startVal + steps * ctrlStep;
      } else if (ev.shiftKey) {
        const fineStep = baseStep * 0.1;
        next = startVal + (dx / 4) * fineStep;
      } else {
        next = startVal + (dx / 4) * baseStep;
      }

      const d = ev.shiftKey && baseStep * 0.1 < 0.01 ? 3 : decimals;
      inp.value = next.toFixed(d);
      if (onChange) onChange(next);
      else inp.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      if (!dragging) {
        inp.focus();
        inp.select();
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

function numInput(val, step, onChange) {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.step = String(step);
  inp.value = Number(val).toFixed(2);
  inp.addEventListener('input', () => {
    const v = parseFloat(inp.value);
    if (!Number.isNaN(v)) onChange(v);
  });
  enableNumericScrub(inp, { baseStep: step, ctrlStep: 0.05, decimals: 2, onChange });
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

function renderSceneInspector(body) {
  const gEnv = document.createElement('div');
  gEnv.className = 'insp-group';
  gEnv.innerHTML = `
    <div class="insp-title" style="color:var(--pc-accent);">🌍 Scena &amp; Ambiente</div>
    <div class="insp-row"><label>Cielo</label><input type="color" id="sc-sky" value="${sceneSettings.skyColor}" style="width:100%;height:24px;padding:1px;" /></div>
    <div class="insp-row"><label>Ambient</label><input type="color" id="sc-amb" value="${sceneSettings.ambientColor}" style="width:100%;height:24px;padding:1px;" /></div>
    <div class="insp-row"><label>Exposure</label><input type="range" id="sc-exp" min="0.2" max="3" step="0.05" value="${sceneSettings.exposure}" /></div>
    <div class="insp-row"><label>Nebbia</label><input type="color" id="sc-fogc" value="${sceneSettings.fogColor}" style="width:100%;height:24px;padding:1px;" /></div>
    <div class="insp-row"><label>Dens. Nebbia</label><input type="number" id="sc-fogd" step="0.005" value="${sceneSettings.fogDensity}" /></div>
  `;
  body.appendChild(gEnv);
  gEnv.querySelector('#sc-sky').addEventListener('input', (e) => applySceneSettings({ skyColor: e.target.value }));
  gEnv.querySelector('#sc-amb').addEventListener('input', (e) => applySceneSettings({ ambientColor: e.target.value }));
  gEnv.querySelector('#sc-exp').addEventListener('input', (e) => applySceneSettings({ exposure: parseFloat(e.target.value) }));
  gEnv.querySelector('#sc-fogc').addEventListener('input', (e) => applySceneSettings({ fogColor: e.target.value }));
  const fogD = gEnv.querySelector('#sc-fogd');
  fogD.addEventListener('input', (e) => applySceneSettings({ fogDensity: Math.max(0, parseFloat(e.target.value) || 0) }));
  enableNumericScrub(fogD, { baseStep: 0.005, ctrlStep: 0.01, decimals: 3, onChange: (v) => applySceneSettings({ fogDensity: Math.max(0, v) }) });

  const gPhys = document.createElement('div');
  gPhys.className = 'insp-group';
  gPhys.innerHTML = `
    <div class="insp-title">⚙ Fisica &amp; Camera (Play Mode)</div>
    <div class="insp-row"><label>Gravità</label><input type="number" id="sc-grav" step="0.5" value="${sceneSettings.gravity}" /></div>
    <div class="insp-row">
      <label>Camera</label>
      <select id="sc-cam">
        <option value="follow">Terza Persona (Follow)</option>
        <option value="top-down">Dall'alto (Top-Down)</option>
        <option value="first-person">Prima Persona (FPS)</option>
        <option value="side-scroll">Laterale (2.5D)</option>
        <option value="fixed">Fissa (Editor)</option>
      </select>
    </div>
    <div class="insp-row"><label>FOV</label><input type="number" id="sc-fov" step="1" value="${sceneSettings.cameraFov}" /></div>
  `;
  body.appendChild(gPhys);
  const gravInp = gPhys.querySelector('#sc-grav');
  gravInp.addEventListener('input', (e) => applySceneSettings({ gravity: Math.max(0, parseFloat(e.target.value) || 0) }));
  enableNumericScrub(gravInp, { baseStep: 0.5, ctrlStep: 0.05, decimals: 2, onChange: (v) => applySceneSettings({ gravity: Math.max(0, v) }) });
  const camSel = gPhys.querySelector('#sc-cam');
  camSel.value = sceneSettings.cameraMode;
  camSel.addEventListener('change', () => applySceneSettings({ cameraMode: camSel.value }));
  const fovInp = gPhys.querySelector('#sc-fov');
  fovInp.addEventListener('input', (e) => applySceneSettings({ cameraFov: Math.max(20, Math.min(110, parseFloat(e.target.value) || 50)) }));
  enableNumericScrub(fovInp, { baseStep: 1, ctrlStep: 0.05, decimals: 1, onChange: (v) => applySceneSettings({ cameraFov: Math.max(20, Math.min(110, v)) }) });
}

function renderMaterialEditor(body, ent) {
  const pbr = ensurePbrData(ent);
  const top = document.createElement('div');
  top.className = 'insp-group';
  top.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <button type="button" class="tb-btn" id="btn-mat-back" style="padding:3px 9px;font-size:11px;border-color:rgba(200,255,61,0.45);color:var(--pc-accent);">← Torna a ${ent.name}</button>
      <span style="font-size:10px;font-weight:800;color:var(--pc-accent);letter-spacing:0.06em;">PBR EDITOR</span>
    </div>
    <div style="display:flex;align-items:center;gap:12px;">
      <div class="pbr-sphere lg" id="pbr-edit-sphere"></div>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;">
        <input type="text" id="pbr-mat-name" value="${pbr.name}" style="width:100%;font-weight:700;" />
        <span style="font-size:10px;color:var(--pc-dim);">StandardMaterial · WebGL2 PBR</span>
      </div>
    </div>
  `;
  body.appendChild(top);
  const bigSphere = top.querySelector('#pbr-edit-sphere');
  stylePbrSphere(bigSphere, pbr);
  top.querySelector('#btn-mat-back').onclick = () => { materialEditMode = false; renderInspector(); };
  top.querySelector('#pbr-mat-name').addEventListener('input', (e) => { pbr.name = e.target.value || 'Material'; });

  const updateAll = () => {
    applyPbrToEntity(ent);
    stylePbrSphere(bigSphere, pbr);
  };

  const makeSection = (title, collapsed = false) => {
    const sec = document.createElement('div');
    sec.className = 'pbr-sec' + (collapsed ? ' collapsed' : '');
    const head = document.createElement('div');
    head.className = 'pbr-sec-head';
    head.innerHTML = `<span class="pbr-sec-dot">${collapsed ? '▸' : '▾'}</span><span>${title}</span>`;
    const secBody = document.createElement('div');
    secBody.className = 'pbr-sec-body';
    head.onclick = () => {
      sec.classList.toggle('collapsed');
      head.querySelector('.pbr-sec-dot').textContent = sec.classList.contains('collapsed') ? '▸' : '▾';
    };
    sec.appendChild(head);
    sec.appendChild(secBody);
    body.appendChild(sec);
    return secBody;
  };

  const addCheckboxRow = (parent, label, checked, onChange) => {
    const row = document.createElement('div');
    row.className = 'pbr-row';
    row.innerHTML = `<label>${label}</label><div><input type="checkbox" ${checked ? 'checked' : ''} /></div>`;
    row.querySelector('input').addEventListener('change', (e) => { onChange(e.target.checked); updateAll(); });
    parent.appendChild(row);
  };

  const addColorRow = (parent, label, val, onChange) => {
    const row = document.createElement('div');
    row.className = 'pbr-row';
    row.innerHTML = `<label>${label}</label><input type="color" value="${val}" style="width:100%;height:24px;padding:1px;" />`;
    row.querySelector('input').addEventListener('input', (e) => { onChange(e.target.value); updateAll(); });
    parent.appendChild(row);
  };

  const addSliderRow = (parent, label, val, min, max, step, onChange) => {
    const row = document.createElement('div');
    row.className = 'pbr-row';
    row.innerHTML = `<label>${label}</label><div class="pbr-slider-row"><input type="number" step="${step}" value="${val}" /><input type="range" min="${min}" max="${max}" step="${step}" value="${val}" /></div>`;
    const numEl = row.querySelector('input[type="number"]');
    const rngEl = row.querySelector('input[type="range"]');
    const setVal = (v) => {
      const clamped = Math.max(min, Math.min(max, v));
      numEl.value = Number(clamped).toFixed(step < 0.1 ? 2 : step < 1 ? 2 : 0);
      rngEl.value = String(clamped);
      onChange(clamped);
      updateAll();
    };
    numEl.addEventListener('input', () => { const v = parseFloat(numEl.value); if (!Number.isNaN(v)) setVal(v); });
    rngEl.addEventListener('input', () => { const v = parseFloat(rngEl.value); if (!Number.isNaN(v)) setVal(v); });
    enableNumericScrub(numEl, { baseStep: step, ctrlStep: 0.05, decimals: step < 1 ? 2 : 0, onChange: setVal });
    parent.appendChild(row);
  };

  const addMapSlot = (parent, label, mapKey, nameKey) => {
    const wrap = document.createElement('div');
    wrap.className = 'pbr-map-row';
    const thumb = document.createElement('div');
    thumb.className = 'pbr-checker';
    thumb.title = 'Clicca per caricare una texture';
    const refreshThumb = () => {
      thumb.innerHTML = pbr[mapKey] ? `<img src="${pbr[mapKey]}" alt="" />` : '';
      nameSpan.textContent = pbr[nameKey] || 'Empty';
    };
    const fileInp = document.createElement('input');
    fileInp.type = 'file';
    fileInp.accept = 'image/*';
    fileInp.hidden = true;
    fileInp.onchange = () => {
      const f = fileInp.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        pbr[mapKey] = dataUrl;
        pbr[nameKey] = f.name;
        loadPbrTexture(dataUrl, (tex) => {
          if (!pbr._tex) pbr._tex = {};
          pbr._tex[mapKey] = tex;
          refreshThumb();
          updateAll();
        });
      };
      reader.readAsDataURL(f);
      fileInp.value = '';
    };
    thumb.onclick = () => fileInp.click();

    const ctrl = document.createElement('div');
    ctrl.className = 'pbr-map-ctrl';
    ctrl.innerHTML = `<div class="pbr-map-label">${label}</div>`;
    const bar = document.createElement('div');
    bar.className = 'pbr-map-bar';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'pbr-map-name';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'pbr-map-btn';
    editBtn.title = 'Carica texture';
    editBtn.textContent = '✎';
    editBtn.onclick = () => fileInp.click();
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'pbr-map-btn';
    clearBtn.title = 'Rimuovi texture';
    clearBtn.textContent = '✕';
    clearBtn.onclick = () => {
      pbr[mapKey] = null;
      pbr[nameKey] = '';
      if (pbr._tex) delete pbr._tex[mapKey];
      refreshThumb();
      updateAll();
    };
    bar.appendChild(nameSpan);
    bar.appendChild(editBtn);
    bar.appendChild(clearBtn);
    ctrl.appendChild(bar);
    wrap.appendChild(thumb);
    wrap.appendChild(ctrl);
    wrap.appendChild(fileInp);
    parent.appendChild(wrap);
    refreshThumb();
  };

  // 1. TEXTURE TRANSFORM
  const sTex = makeSection('TEXTURE TRANSFORM', false);
  addCheckboxRow(sTex, 'Apply To All Maps', pbr.applyAllMaps, (v) => { pbr.applyAllMaps = v; });
  const makeUvRow = (label, arr, step) => {
    const row = document.createElement('div');
    row.className = 'pbr-row';
    row.innerHTML = `<label>${label}</label><div class="pbr-uv"><div class="pbr-uv-box"><input type="number" step="${step}" value="${arr[0]}" /><span>U</span></div><div class="pbr-uv-box"><input type="number" step="${step}" value="${arr[1]}" /><span>V</span></div></div>`;
    const [uInp, vInp] = row.querySelectorAll('input');
    const onU = (val) => { arr[0] = val; updateAll(); };
    const onV = (val) => { arr[1] = val; updateAll(); };
    uInp.addEventListener('input', () => { const v = parseFloat(uInp.value); if (!Number.isNaN(v)) onU(v); });
    vInp.addEventListener('input', () => { const v = parseFloat(vInp.value); if (!Number.isNaN(v)) onV(v); });
    enableNumericScrub(uInp, { baseStep: step, ctrlStep: 0.05, decimals: 2, onChange: onU });
    enableNumericScrub(vInp, { baseStep: step, ctrlStep: 0.05, decimals: 2, onChange: onV });
    sTex.appendChild(row);
  };
  makeUvRow('Offset', pbr.offset, 0.05);
  makeUvRow('Tiling', pbr.tiling, 0.1);
  const rotRow = document.createElement('div');
  rotRow.className = 'pbr-row';
  rotRow.innerHTML = `<label>Rotation</label><div class="pbr-uv-box"><input type="number" step="1" value="${pbr.rotation}" /><span>degrees</span></div>`;
  const rotInp = rotRow.querySelector('input');
  rotInp.addEventListener('input', () => { pbr.rotation = parseFloat(rotInp.value) || 0; updateAll(); });
  enableNumericScrub(rotInp, { baseStep: 1, ctrlStep: 0.05, decimals: 1, onChange: (v) => { pbr.rotation = v; updateAll(); } });
  sTex.appendChild(rotRow);

  // 2. AMBIENT
  const sAmb = makeSection('AMBIENT', false);
  addMapSlot(sAmb, 'Ambient Occlusion', 'aoMap', 'aoMapName');
  addCheckboxRow(sAmb, 'Vertex Color', pbr.aoVertexColor, (v) => { pbr.aoVertexColor = v; });
  addColorRow(sAmb, 'Color', pbr.ambientColor, (v) => { pbr.ambientColor = v; });
  addSliderRow(sAmb, 'Intensity', pbr.aoIntensity, 0, 2, 0.05, (v) => { pbr.aoIntensity = v; });

  // 3. DIFFUSE
  const sDiff = makeSection('DIFFUSE', false);
  addMapSlot(sDiff, 'Diffuse', 'diffuseMap', 'diffuseMapName');
  addCheckboxRow(sDiff, 'Vertex Color', pbr.diffuseVertexColor, (v) => { pbr.diffuseVertexColor = v; });
  addColorRow(sDiff, 'Color', pbr.diffuseColor, (v) => { pbr.diffuseColor = v; });

  // 4. SPECULAR
  const sSpec = makeSection('SPECULAR', false);
  addCheckboxRow(sSpec, 'Enable GGX Spec...', pbr.enableGGX, (v) => { pbr.enableGGX = v; });
  addCheckboxRow(sSpec, 'Use Metalness', pbr.useMetalness, (v) => { pbr.useMetalness = v; });
  addMapSlot(sSpec, 'Metalness', 'metalnessMap', 'metalnessMapName');
  addCheckboxRow(sSpec, 'Vertex Color', pbr.metalnessVertexColor, (v) => { pbr.metalnessVertexColor = v; });
  addSliderRow(sSpec, 'Metalness', pbr.metalness, 0, 1, 0.02, (v) => { pbr.metalness = v; });
  addCheckboxRow(sSpec, 'Use Specular Col...', pbr.useSpecularColor, (v) => { pbr.useSpecularColor = v; });
  addColorRow(sSpec, 'Specular Color', pbr.specularColor, (v) => { pbr.specularColor = v; });
  addMapSlot(sSpec, 'Glossiness', 'glossMap', 'glossMapName');
  addCheckboxRow(sSpec, 'Vertex Color', pbr.glossVertexColor, (v) => { pbr.glossVertexColor = v; });
  addSliderRow(sSpec, 'Glossiness', pbr.glossiness, 0, 100, 1, (v) => { pbr.glossiness = v; });
  addCheckboxRow(sSpec, 'Invert', pbr.glossInvert, (v) => { pbr.glossInvert = v; });

  // 5. EMISSIVE
  const sEmi = makeSection('EMISSIVE', false);
  addMapSlot(sEmi, 'Emissive', 'emissiveMap', 'emissiveMapName');
  addCheckboxRow(sEmi, 'Vertex Color', pbr.emissiveVertexColor, (v) => { pbr.emissiveVertexColor = v; });
  addColorRow(sEmi, 'Color', pbr.emissiveColor, (v) => { pbr.emissiveColor = v; });
  addSliderRow(sEmi, 'Intensity', pbr.emissiveIntensity, 0, 5, 0.1, (v) => { pbr.emissiveIntensity = v; });

  // 6. OPACITY
  const sOpa = makeSection('OPACITY', false);
  const blendRow = document.createElement('div');
  blendRow.className = 'pbr-row';
  blendRow.innerHTML = `
    <label>Blend Type</label>
    <select>
      <option value="none">None</option>
      <option value="normal">Normal (Alpha)</option>
      <option value="additive">Additive</option>
      <option value="multiply">Multiply</option>
      <option value="premultiplied">Premultiplied</option>
    </select>
  `;
  const blendSel = blendRow.querySelector('select');
  blendSel.value = pbr.blendType || 'none';
  blendSel.addEventListener('change', () => { pbr.blendType = blendSel.value; updateAll(); });
  sOpa.appendChild(blendRow);
  addMapSlot(sOpa, 'Opacity', 'opacityMap', 'opacityMapName');
  addCheckboxRow(sOpa, 'Vertex Color', pbr.opacityVertexColor, (v) => { pbr.opacityVertexColor = v; });
  addSliderRow(sOpa, 'Opacity', pbr.opacity, 0, 1, 0.02, (v) => { pbr.opacity = v; });
  addSliderRow(sOpa, 'Alpha Test', pbr.alphaTest, 0, 1, 0.02, (v) => { pbr.alphaTest = v; });

  // 7. NORMAL & CLEARCOAT
  const sNorm = makeSection('NORMAL & CLEARCOAT', true);
  addMapSlot(sNorm, 'Normal Map', 'normalMap', 'normalMapName');
  addSliderRow(sNorm, 'Bumpiness', pbr.bumpiness, 0, 2, 0.05, (v) => { pbr.bumpiness = v; });
  addSliderRow(sNorm, 'Clear Coat', pbr.clearCoat, 0, 1, 0.05, (v) => { pbr.clearCoat = v; });
  addSliderRow(sNorm, 'Clear Gloss', pbr.clearCoatGloss, 0, 1, 0.05, (v) => { pbr.clearCoatGloss = v; });
}

function renderInspector() {
  const body = document.getElementById('inspector-body');
  body.innerHTML = '';
  transformInputs = null;
  if (!selectedEntity) {
    renderSceneInspector(body);
    return;
  }

  const ent = selectedEntity;
  if (materialEditMode && (ent.render || ent.findComponents('render').length > 0)) {
    renderMaterialEditor(body, ent);
    return;
  }
  const p = ent.getLocalPosition();
  const r = ent.getLocalEulerAngles();
  const s = ent.getLocalScale();

  // Entity group
  const gEnt = document.createElement('div');
  gEnt.className = 'insp-group';
  gEnt.innerHTML = `
    <div class="insp-title">Entity</div>
    <div class="insp-row"><label>Nome</label><input type="text" id="insp-name" value="${ent.name}" /></div>
    <div class="insp-row"><label>Tag</label><input type="text" id="insp-tag" value="${ent.__wox.tag || ''}" placeholder="es. enemy, platform, goal" /></div>
  `;
  body.appendChild(gEnt);
  gEnt.querySelector('#insp-name').addEventListener('input', (e) => {
    ent.name = e.target.value || 'Entity';
    refreshHierarchy();
  });
  gEnt.querySelector('#insp-tag').addEventListener('input', (e) => {
    ent.__wox.tag = e.target.value.trim();
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
  makeVecRow('Rotation', r, 1, (v) => v ? ent.setLocalEulerAngles(v.x, v.y, v.z) : ent.getLocalEulerAngles().clone());
  makeVecRow('Scale', s, 0.1, (v) => v ? ent.setLocalScale(v.x, v.y, v.z) : ent.getLocalScale().clone());
  transformInputs = inputs;
  body.appendChild(gTr);

  // Material group: compact PBR MATERIAL preview card (double-click to open full PBR Editor!)
  if (ent.render || ent.findComponents('render').length > 0) {
    const pbr = ensurePbrData(ent);
    const gMat = document.createElement('div');
    gMat.className = 'insp-group';
    gMat.innerHTML = `
      <div class="insp-title"><span>PBR MATERIAL</span><span style="font-size:10px;color:var(--pc-accent);font-weight:600;">Click edit</span></div>
      <div class="pbr-preview-card" id="pbr-preview-card" title="Clicca per aprire l'editor completo PBR Material">
        <div class="pbr-sphere" id="pbr-mini-sphere"></div>
        <div style="min-width:0;flex:1;display:flex;flex-direction:column;gap:2px;">
          <b style="font-size:12px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${pbr.name}</b>
          <span style="font-size:10.5px;color:var(--pc-dim);">Met ${Math.round((pbr.metalness ?? 0) * 100)}% · Gloss ${Math.round(pbr.glossiness ?? 60)}%</span>
          <span style="font-size:10px;color:var(--pc-accent);">Clicca per modificare</span>
        </div>
      </div>
    `;
    body.appendChild(gMat);
    stylePbrSphere(gMat.querySelector('#pbr-mini-sphere'), pbr);
    gMat.querySelector('#pbr-preview-card').onclick = () => {
      materialEditMode = true;
      renderInspector();
    };
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

  // Game Behavior Script group (Wox Studio Mega-Menu with Submenus & SVG Icons)
  if (ent.__wox.kind !== 'light' && ent.__wox.kind !== 'plane') {
    const BEH_ICONS = {
      none: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>`,
      catPlayer: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4m-2-2v4"/><circle cx="15.5" cy="11" r="1"/><circle cx="18" cy="13" r="1"/></svg>`,
      catMove: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/><path d="m12 19-7-7 7-7"/></svg>`,
      player: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2.5"/><path d="M9 20l2-6 3 2v4"/><path d="M7 13l3-3 4 1 3-2"/></svg>`,
      playerFps: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/><circle cx="12" cy="12" r="1.5"/></svg>`,
      player25d: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="16" width="18" height="4" rx="1"/><path d="M7 16v-5l4-4 3 3 3-3"/><circle cx="11" cy="5" r="1.5"/></svg>`,
      followPlayer: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="7" r="2.5"/><path d="M4 17c2-4 5-6 9-6"/><path d="m10 8 3 3-3 3"/></svg>`,
      followObject: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
      spin: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>`,
      hover: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="m8 7 4-4 4 4"/><path d="m8 17 4 4 4-4"/></svg>`,
      patrol: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18"/><path d="m7 8-4 4 4 4"/><path d="m17 8 4 4-4 4"/></svg>`,
      coin: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v10"/><path d="M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4"/></svg>`,
    };
    const BEH_META = {
      none: { label: 'Nessuno (Statico)', icon: BEH_ICONS.none },
      player: { label: 'Player Third Person', icon: BEH_ICONS.player },
      'player-fps': { label: 'Player FPS', icon: BEH_ICONS.playerFps },
      'player-25d': { label: 'Player 2.5D', icon: BEH_ICONS.player25d },
      'follow-player': { label: 'Follow Player', icon: BEH_ICONS.followPlayer },
      'follow-object': { label: 'Follow Object', icon: BEH_ICONS.followObject },
      spin: { label: 'Rotazione continua', icon: BEH_ICONS.spin },
      hover: { label: 'Fluttuazione verticale', icon: BEH_ICONS.hover },
      patrol: { label: 'Pattuglia', icon: BEH_ICONS.patrol },
      coin: { label: 'Moneta (+10 pt)', icon: BEH_ICONS.coin },
    };
    const BEH_TREE = [
      { value: 'none', label: 'Nessuno', sub: 'Oggetto statico senza movimento', tag: 'STATIC', icon: BEH_ICONS.none, accent: '#9aa8b0' },
      {
        category: 'PLAYER',
        sub: 'Third Person, FPS e 2.5D',
        icon: BEH_ICONS.catPlayer,
        accent: '#c8ff3d',
        items: [
          { value: 'player', label: 'Player Controller Third Person', sub: 'WASD / Frecce + Salto + Camera Follow 3D', tag: '3RD', icon: BEH_ICONS.player, accent: '#c8ff3d' },
          { value: 'player-fps', label: 'Player Controller FPS', sub: 'Prima Persona: WASD + Q/E/Frecce/Mouse + Salto', tag: 'FPS', icon: BEH_ICONS.playerFps, accent: '#38bdf8' },
          { value: 'player-25d', label: 'Player Controller 2.5D', sub: 'Scorrimento laterale A/D + Salto + Camera 2.5D', tag: '2.5D', icon: BEH_ICONS.player25d, accent: '#f472b6' },
        ],
      },
      {
        category: 'MOVEMENT',
        sub: 'Follow, animazioni, piattaforme e bonus',
        icon: BEH_ICONS.catMove,
        accent: '#38bdf8',
        items: [
          { value: 'follow-player', label: 'Follow Player', sub: 'Insegue automaticamente il Player attivo', tag: 'FOLLOW', icon: BEH_ICONS.followPlayer, accent: '#c8ff3d' },
          { value: 'follow-object', label: 'Follow Object', sub: 'Segue un oggetto target scelto nell\'Inspector', tag: 'TARGET', icon: BEH_ICONS.followObject, accent: '#38bdf8' },
          { value: 'spin', label: 'Rotazione continua', sub: 'Ruota sull\'asse Y in Play Mode', tag: 'LOOP', icon: BEH_ICONS.spin, accent: '#22d3ee' },
          { value: 'hover', label: 'Fluttuazione verticale', sub: 'Oscillazione fluida su e giù', tag: 'VFX', icon: BEH_ICONS.hover, accent: '#c084fc' },
          { value: 'patrol', label: 'Pattuglia avanti/indietro', sub: 'Movimento lineare · trasporta il Player', tag: 'PLAT', icon: BEH_ICONS.patrol, accent: '#fb923c' },
          { value: 'coin', label: 'Moneta / Raccoglibile', sub: 'Raccogli con +10 pt, suono e particelle', tag: '+10 PT', icon: BEH_ICONS.coin, accent: '#ffd43b' },
        ],
      },
    ];

    const curMeta = BEH_META[ent.__wox.behavior] || { label: ent.__wox.behavior, icon: BEH_ICONS.none };
    const otherEnts = sceneEntities.filter(e => e !== ent && e.__wox?.kind !== 'light' && e.__wox?.kind !== 'plane');
    const followTargetRow = ent.__wox.behavior === 'follow-object'
      ? `<div class="insp-row">
          <label>Target</label>
          <select id="insp-follow-target">
            <option value="">-- Scegli Oggetto --</option>
            ${otherEnts.map(o => `<option value="${o.name}" ${ent.__wox.followTarget === o.name ? 'selected' : ''}>${o.name}</option>`).join('')}
          </select>
        </div>`
      : '';

    const gBeh = document.createElement('div');
    gBeh.className = 'insp-group';
    gBeh.innerHTML = `
      <div class="insp-title">Game Script (Play Mode)</div>
      <div class="insp-row">
        <label>Behavior</label>
        <button type="button" class="beh-trigger" id="insp-beh-btn">
          <span class="beh-trigger-left">
            <span class="beh-trigger-ic" id="insp-beh-ic">${curMeta.icon}</span>
            <span id="insp-beh-label" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${curMeta.label}</span>
          </span>
          <span style="color:var(--pc-accent);font-size:11px;">▾</span>
        </button>
      </div>
      ${followTargetRow}
      <div class="insp-row"><label>Velocità</label><input type="number" id="insp-spd" step="0.5" value="${ent.__wox.speed}" /></div>
      <div class="insp-row"><label>Collisioni</label><label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="insp-solid" ${ent.__wox.solid !== false ? 'checked' : ''} /> Solido</label></div>
    `;
    body.appendChild(gBeh);

    const followSel = gBeh.querySelector('#insp-follow-target');
    if (followSel) {
      followSel.addEventListener('change', () => { ent.__wox.followTarget = followSel.value; });
    }

    const behBtn = gBeh.querySelector('#insp-beh-btn');
    const closeBehMenu = () => {
      document.querySelectorAll('.beh-menu').forEach(m => m.remove());
    };

    behBtn.onclick = (e) => {
      e.stopPropagation();
      const existing = document.querySelector('.beh-menu');
      if (existing) { closeBehMenu(); return; }

      const menu = document.createElement('div');
      menu.className = 'beh-menu';
      const rect = behBtn.getBoundingClientRect();
      menu.style.top = `${Math.min(window.innerHeight - 250, rect.bottom + 6)}px`;
      menu.style.right = `${Math.max(10, window.innerWidth - rect.right)}px`;

      const head = document.createElement('div');
      head.className = 'beh-menu-head';
      head.innerHTML = `<span>Behavior Studio</span><span style="color:var(--pc-accent);">WOX ENGINE</span>`;
      menu.appendChild(head);

      const pickValue = (val) => {
        ent.__wox.behavior = val;
        if (val === 'player-fps') applySceneSettings({ cameraMode: 'first-person' });
        else if (val === 'player-25d') applySceneSettings({ cameraMode: 'side-scroll' });
        else if (val === 'player') applySceneSettings({ cameraMode: 'follow' });
        refreshHierarchy();
        closeBehMenu();
        renderInspector();
      };

      for (const node of BEH_TREE) {
        if (node.items) {
          const catEl = document.createElement('div');
          catEl.className = 'beh-item';
          const hasSelected = node.items.some(it => it.value === ent.__wox.behavior);
          if (hasSelected) catEl.classList.add('selected');
          catEl.innerHTML = `
            <span class="beh-arrow">◂</span>
            <span class="beh-thumb" style="color:${node.accent};">${node.icon}</span>
            <span class="beh-txt">
              <span class="beh-title">${node.category} <span class="beh-tag">${node.items.length}</span></span>
              <span class="beh-sub">${node.sub}</span>
            </span>
          `;

          const sub = document.createElement('div');
          sub.className = 'beh-submenu';
          const subHead = document.createElement('div');
          subHead.className = 'beh-menu-head';
          subHead.innerHTML = `<span style="color:${node.accent};">${node.category}</span><span>${node.items.length} preset</span>`;
          sub.appendChild(subHead);

          for (const item of node.items) {
            const subBtn = document.createElement('button');
            subBtn.type = 'button';
            subBtn.className = 'beh-item' + (ent.__wox.behavior === item.value ? ' selected' : '');
            subBtn.innerHTML = `
              <span class="beh-thumb" style="color:${item.accent};">${item.icon}</span>
              <span class="beh-txt">
                <span class="beh-title">${item.label}${item.tag ? `<span class="beh-tag">${item.tag}</span>` : ''}</span>
                <span class="beh-sub">${item.sub}</span>
              </span>
            `;
            subBtn.onclick = (ev) => { ev.stopPropagation(); pickValue(item.value); };
            sub.appendChild(subBtn);
          }
          const positionSubmenu = () => {
            sub.style.top = '-8px';
            const catRect = catEl.getBoundingClientRect();
            const subRect = sub.getBoundingClientRect();
            const overflowBottom = (catRect.top - 8 + subRect.height) - (window.innerHeight - 12);
            if (overflowBottom > 0) {
              const shifted = Math.max(-(catRect.top - 10), -8 - overflowBottom);
              sub.style.top = `${Math.round(shifted)}px`;
            }
          };
          catEl.onmouseenter = () => {
            menu.querySelectorAll('.beh-item.open').forEach(o => { if (o !== catEl) o.classList.remove('open'); });
            catEl.classList.add('open');
            positionSubmenu();
          };
          catEl.onclick = (ev) => {
            ev.stopPropagation();
            menu.querySelectorAll('.beh-item.open').forEach(o => { if (o !== catEl) o.classList.remove('open'); });
            catEl.classList.toggle('open');
            if (catEl.classList.contains('open')) positionSubmenu();
          };
          catEl.appendChild(sub);
          menu.appendChild(catEl);
        } else {
          const itemBtn = document.createElement('button');
          itemBtn.type = 'button';
          itemBtn.className = 'beh-item' + (ent.__wox.behavior === node.value ? ' selected' : '');
          itemBtn.innerHTML = `
            <span class="beh-thumb" style="color:${node.accent};">${node.icon}</span>
            <span class="beh-txt">
              <span class="beh-title">${node.label}${node.tag ? `<span class="beh-tag" style="background:rgba(255,255,255,0.08);color:#9aa8b0;">${node.tag}</span>` : ''}</span>
              <span class="beh-sub">${node.sub}</span>
            </span>
          `;
          itemBtn.onclick = (ev) => { ev.stopPropagation(); pickValue(node.value); };
          menu.appendChild(itemBtn);
        }
      }

      document.body.appendChild(menu);
      const menuRect = menu.getBoundingClientRect();
      const clampedTop = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - menuRect.height - 12));
      menu.style.top = `${Math.round(clampedTop)}px`;
      const onDocClick = () => {
        closeBehMenu();
        document.removeEventListener('click', onDocClick);
      };
      setTimeout(() => document.addEventListener('click', onDocClick), 0);
    };

    const spdInp = gBeh.querySelector('#insp-spd');
    spdInp.addEventListener('input', (e) => { ent.__wox.speed = parseFloat(e.target.value) || 0; });
    enableNumericScrub(spdInp, { baseStep: 0.5, ctrlStep: 0.05, decimals: 2, onChange: (v) => { ent.__wox.speed = v; } });
    const solidInp = gBeh.querySelector('#insp-solid');
    if (solidInp) solidInp.addEventListener('change', () => { ent.__wox.solid = solidInp.checked; });

    // Dynamic Parameters specific to the selected Behavior
    const beh = ent.__wox.behavior;
    if (beh && beh !== 'none') {
      const cfg = ensureBehaviorConfig(ent);
      const pWrap = document.createElement('div');
      pWrap.style.marginTop = '8px';
      pWrap.style.paddingTop = '8px';
      pWrap.style.borderTop = '1px solid rgba(255,255,255,0.08)';
      const pTitle = document.createElement('div');
      pTitle.className = 'insp-title';
      pTitle.style.color = 'var(--pc-accent)';
      pTitle.textContent = `⚙ Parametri ${curMeta.label}`;
      pWrap.appendChild(pTitle);

      const addCfgNum = (label, key, step, min, max, decimals = 2) => {
        const row = document.createElement('div');
        row.className = 'insp-row';
        row.innerHTML = `<label>${label}</label><input type="number" step="${step}" value="${cfg[key]}" />`;
        const inp = row.querySelector('input');
        const apply = (v) => {
          const clamped = Math.max(min, Math.min(max, v));
          cfg[key] = clamped;
        };
        inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (!Number.isNaN(v)) apply(v); });
        enableNumericScrub(inp, { baseStep: step, ctrlStep: 0.05, decimals, onChange: apply });
        pWrap.appendChild(row);
      };
      const addCfgBool = (label, key, text = 'Attivo') => {
        const row = document.createElement('div');
        row.className = 'insp-row';
        row.innerHTML = `<label>${label}</label><label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" ${cfg[key] ? 'checked' : ''} /> ${text}</label>`;
        row.querySelector('input').addEventListener('change', (e) => { cfg[key] = e.target.checked; });
        pWrap.appendChild(row);
      };
      const addCfgSel = (label, key, options) => {
        const row = document.createElement('div');
        row.className = 'insp-row';
        row.innerHTML = `<label>${label}</label><select>${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`;
        const sel = row.querySelector('select');
        sel.value = cfg[key];
        sel.addEventListener('change', () => { cfg[key] = sel.value; });
        pWrap.appendChild(row);
      };

      if (beh === 'player' || beh === 'player-fps' || beh === 'player-25d') {
        addCfgNum('Vita (HP)', 'maxHp', 5, 1, 9999, 0);
        if (beh === 'player') {
          addCfgNum('Zoom Cam', 'camZoom', 0.25, 2, 30, 2);
          addCfgNum('Altezza Cam', 'camHeight', 0.25, 0.5, 25, 2);
        } else if (beh === 'player-fps') {
          addCfgBool('Mouse Look', 'pointerLock', 'Cattura Mouse (Testa)');
          addCfgNum('Sensibilità', 'mouseSens', 0.02, 0.02, 2, 2);
          addCfgNum('Altezza Occhi', 'eyeHeight', 0.05, 0.1, 4, 2);
        } else if (beh === 'player-25d') {
          addCfgNum('Zoom 2.5D', 'camZoom', 0.5, 4, 35, 1);
          addCfgNum('Altezza Cam', 'camHeight', 0.25, 0.5, 20, 2);
        }
        addCfgBool('Salto', 'canJump', 'Abilitato');
        addCfgBool('Doppio Salto', 'doubleJump', 'Abilitato');
        addCfgNum('Forza Salto', 'jumpForce', 0.25, 1, 30, 2);
        addCfgSel('Tasto Colpo', 'attackKey', [
          ['F', 'Tasto F'],
          ['E', 'Tasto E'],
          ['CLICK', 'Click Sinistro Mouse'],
          ['SHIFT', 'Tasto SHIFT'],
          ['NONE', 'Nessuno (Disattivo)'],
        ]);
        addCfgSel('Tipo Colpo', 'attackType', [
          ['laser', '⚡ Laser'],
          ['fireball', '🔥 Sfera di Fuoco'],
          ['melee', '💥 Onda d\'Urto (Melee)'],
        ]);
        addCfgNum('Danno Colpo', 'attackDamage', 5, 1, 500, 0);
      } else if (beh === 'follow-player' || beh === 'follow-object') {
        addCfgSel('Attivazione', 'activateMode', [
          ['always', 'Sempre attivo'],
          ['range', 'Entro distanza'],
          ['sight', 'Nel campo visivo'],
        ]);
        addCfgNum('Raggio Attiv.', 'detectRange', 0.5, 1, 100, 1);
        addCfgNum('Dist. Stop', 'stopDist', 0.1, 0.4, 20, 2);
        addCfgNum('Danno Cont.', 'contactDamage', 5, 0, 500, 0);
        addCfgNum('Vita Nemico', 'enemyHp', 5, 1, 5000, 0);
      } else if (beh === 'patrol') {
        addCfgSel('Asse', 'patrolAxis', [['x', 'Asse X (Destra/Sinistra)'], ['z', 'Asse Z (Avanti/Indietro)'], ['y', 'Asse Y (Su/Giù)']]);
        addCfgNum('Ampiezza', 'patrolRange', 0.25, 0.5, 50, 2);
      } else if (beh === 'hover') {
        addCfgNum('Ampiezza', 'hoverAmp', 0.05, 0.05, 10, 2);
      } else if (beh === 'spin') {
        addCfgSel('Asse', 'spinAxis', [['y', 'Asse Y'], ['x', 'Asse X'], ['z', 'Asse Z']]);
      } else if (beh === 'coin') {
        addCfgNum('Punti', 'coinValue', 5, 1, 1000, 0);
      }

      gBeh.appendChild(pWrap);
    }
  }

  // Per-Entity Programmable Script + AI Shortcut
  const gScript = document.createElement('div');
  gScript.className = 'insp-group';
  gScript.innerHTML = `
    <div class="insp-title">
      <span style="color:var(--pc-accent);">⚡ Script Entità (JS)</span>
      <button class="tb-btn" id="btn-ask-ai-ent" style="padding:1px 6px;font-size:10px;border-color:rgba(200,255,61,0.45);color:var(--pc-accent);">✨ Chiedi ad AI</button>
    </div>
    <textarea id="insp-script" class="ai-code" style="min-height:76px;width:100%;" spellcheck="false" placeholder="// Eseguito ogni frame in Play Mode su questa entità&#10;// Variabili: self, wox, dt, t, state"></textarea>
  `;
  body.appendChild(gScript);
  const scrEl = gScript.querySelector('#insp-script');
  scrEl.value = ent.__wox.script || '';
  scrEl.addEventListener('input', () => { ent.__wox.script = scrEl.value; });
  gScript.querySelector('#btn-ask-ai-ent').onclick = () => {
    const appGrid = document.getElementById('app');
    if (appGrid && appGrid.classList.contains('ai-hidden')) {
      document.getElementById('btn-show-ai-col')?.click();
    }
    const pEl = document.getElementById('ai-prompt');
    if (pEl) {
      pEl.value = `Modifica "${ent.name}": `;
      pEl.focus();
      pEl.setSelectionRange(pEl.value.length, pEl.value.length);
    }
  };
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

const addMenuBtn = document.getElementById('btn-add-menu');
const addMenuDrop = document.getElementById('add-menu-dropdown');
if (addMenuBtn && addMenuDrop) {
  addMenuBtn.onclick = (e) => {
    e.stopPropagation();
    addMenuDrop.classList.toggle('open');
  };
  document.addEventListener('click', () => addMenuDrop.classList.remove('open'));
}

document.querySelectorAll('[data-add]').forEach((btn) => {
  btn.onclick = () => {
    const ent = addPrimitive(btn.dataset.add);
    selectEntity(ent);
    if (addMenuDrop) addMenuDrop.classList.remove('open');
  };
});

document.getElementById('btn-delete').onclick = () => {
  if (!selectedEntity || isPlaying) return;
  const idx = sceneEntities.indexOf(selectedEntity);
  if (idx >= 0) sceneEntities.splice(idx, 1);
  selectedEntity.destroy();
  selectEntity(null);
};

const btnSceneSettings = document.getElementById('btn-scene-settings');
if (btnSceneSettings) {
  btnSceneSettings.onclick = () => {
    selectEntity(null);
  };
}

// ============================================================
// WOX ENGINE PROGRAMMABLE API (window.WOX / wox)
// ============================================================
let audioCtx = null;
let audioMuted = false;
function playWoxAudio(presetOrFreq = 'coin', dur = 0.14, type = 'sine') {
  if (audioMuted) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const tone = (f1, f2, d, oscType = 'sine', gainVal = 0.15, delay = 0) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = oscType;
      o.frequency.setValueAtTime(f1, now + delay);
      if (f2 && f2 !== f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), now + delay + d);
      g.gain.setValueAtTime(gainVal, now + delay);
      g.gain.exponentialRampToValueAtTime(0.001, now + delay + d);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start(now + delay);
      o.stop(now + delay + d + 0.02);
    };
    if (typeof presetOrFreq === 'number') {
      tone(presetOrFreq, presetOrFreq, dur, type, 0.14);
      return;
    }
    switch (String(presetOrFreq).toLowerCase()) {
      case 'coin': tone(880, 1320, 0.12, 'triangle', 0.14); tone(1320, 1760, 0.14, 'triangle', 0.12, 0.07); break;
      case 'jump': tone(220, 560, 0.14, 'sine', 0.14); break;
      case 'bounce': tone(190, 740, 0.18, 'triangle', 0.15); break;
      case 'laser': tone(960, 180, 0.15, 'sawtooth', 0.1); break;
      case 'hit': tone(180, 70, 0.16, 'square', 0.14); break;
      case 'explosion': tone(140, 35, 0.35, 'sawtooth', 0.18); tone(90, 28, 0.3, 'square', 0.12, 0.04); break;
      case 'powerup': tone(440, 660, 0.1, 'triangle', 0.14, 0); tone(660, 880, 0.1, 'triangle', 0.14, 0.08); tone(880, 1320, 0.18, 'triangle', 0.15, 0.16); break;
      case 'pickup': tone(620, 930, 0.1, 'sine', 0.13); break;
      case 'portal': tone(260, 820, 0.28, 'sine', 0.14); tone(520, 180, 0.28, 'triangle', 0.1, 0.06); break;
      case 'shield': tone(300, 600, 0.16, 'sine', 0.14); tone(600, 450, 0.14, 'triangle', 0.1, 0.1); break;
      case 'alarm': tone(740, 520, 0.12, 'square', 0.1, 0); tone(740, 520, 0.12, 'square', 0.1, 0.16); break;
      case 'step': tone(120, 70, 0.05, 'triangle', 0.07); break;
      case 'click': tone(900, 700, 0.04, 'sine', 0.08); break;
      case 'win': tone(523, 523, 0.12, 'triangle', 0.14, 0); tone(659, 659, 0.12, 'triangle', 0.14, 0.1); tone(784, 1046, 0.25, 'triangle', 0.16, 0.2); break;
      case 'gameover': tone(392, 330, 0.18, 'sawtooth', 0.12, 0); tone(330, 220, 0.32, 'sawtooth', 0.12, 0.18); break;
      default: tone(520, 680, 0.12, 'sine', 0.12);
    }
  } catch {}
}

const activeParticles = [];
function spawnFxBurst(pos, hexColor = '#c8ff3d', count = 10) {
  const px = Array.isArray(pos) ? pos[0] : (pos?.x ?? 0);
  const py = Array.isArray(pos) ? pos[1] : (pos?.y ?? 1);
  const pz = Array.isArray(pos) ? pos[2] : (pos?.z ?? 0);
  const mat = makePbrMaterial(hexColor, 0.1, 0.9, hexColor);
  const n = Math.min(28, Math.max(2, Number(count) || 10));
  for (let i = 0; i < n; i++) {
    const p = new pc.Entity('FxParticle');
    p.addComponent('render', { type: 'box', material: mat, castShadows: false, receiveShadows: false });
    p.setLocalScale(0.18, 0.18, 0.18);
    p.setLocalPosition(px, py, pz);
    app.root.addChild(p);
    activeParticles.push({
      ent: p,
      vx: (Math.random() - 0.5) * 7,
      vy: Math.random() * 5 + 2,
      vz: (Math.random() - 0.5) * 7,
      life: 0.55 + Math.random() * 0.35,
      maxLife: 0.9,
    });
  }
}

function clearFxParticles() {
  while (activeParticles.length) {
    try { activeParticles.pop().ent.destroy(); } catch {}
  }
}

const woxEventBus = new Map();
const woxHudMap = new Map();
const woxHudBars = new Map();
const frameContacts = new Map();
const woxTimers = [];
const woxCooldowns = new Map();
const woxTweens = [];
const activeFxShapes = [];
let woxTimeScale = 1.0;
let camShakeAmp = 0;
let camShakeTime = 0;
let woxToastTimer = null;
let woxFlashTimer = null;

function clearRuntimeSdkState() {
  woxTimers.length = 0;
  woxCooldowns.clear();
  woxTweens.length = 0;
  woxHudBars.clear();
  woxTimeScale = 1.0;
  camShakeAmp = 0;
  camShakeTime = 0;
  while (activeFxShapes.length) {
    try { activeFxShapes.pop().ent.destroy(); } catch {}
  }
  const ch = document.getElementById('wox-crosshair');
  if (ch) ch.style.display = 'none';
}

function recordFrameContact(a, b) {
  if (!frameContacts.has(a)) frameContacts.set(a, new Set());
  if (!frameContacts.has(b)) frameContacts.set(b, new Set());
  frameContacts.get(a).add(b);
  frameContacts.get(b).add(a);
}

function resolveKeyCode(key) {
  if (typeof key === 'number') return key;
  const k = String(key || '').toUpperCase().replace(/^KEY_/, '');
  if (pc[`KEY_${k}`] !== undefined) return pc[`KEY_${k}`];
  if (k === 'SPACE' || k === ' ') return pc.KEY_SPACE;
  if (k === 'SHIFT') return pc.KEY_SHIFT;
  if (k === 'CTRL' || k === 'CONTROL') return pc.KEY_CONTROL;
  if (k === 'ENTER') return pc.KEY_RETURN;
  if (k === 'ESC' || k === 'ESCAPE') return pc.KEY_ESCAPE;
  return pc.KEY_SPACE;
}

function resolveEntityArg(entOrName) {
  if (!entOrName) return null;
  if (typeof entOrName === 'string') {
    const low = entOrName.toLowerCase();
    return sceneEntities.find(e => e.name.toLowerCase() === low) || null;
  }
  return entOrName;
}

function toVec3Arr(posOrEnt) {
  if (!posOrEnt) return [0, 0, 0];
  if (Array.isArray(posOrEnt)) return [Number(posOrEnt[0]) || 0, Number(posOrEnt[1]) || 0, Number(posOrEnt[2]) || 0];
  if (typeof posOrEnt.getPosition === 'function') {
    const p = posOrEnt.getPosition();
    return [p.x, p.y, p.z];
  }
  if (typeof posOrEnt === 'string') {
    const e = resolveEntityArg(posOrEnt);
    if (e) { const p = e.getPosition(); return [p.x, p.y, p.z]; }
  }
  return [Number(posOrEnt.x) || 0, Number(posOrEnt.y) || 0, Number(posOrEnt.z) || 0];
}

function renderCustomHud() {
  const wrap = document.getElementById('hud-custom');
  if (!wrap) return;
  wrap.innerHTML = '';
  for (const [k, v] of woxHudMap.entries()) {
    const pill = document.createElement('div');
    pill.className = 'vp-pill';
    pill.innerHTML = `${k}: <b style="color:var(--pc-accent);">${v}</b>`;
    wrap.appendChild(pill);
  }
  for (const [k, bar] of woxHudBars.entries()) {
    const pct = Math.max(0, Math.min(100, ((bar.val || 0) / Math.max(0.001, bar.max || 100)) * 100));
    const el = document.createElement('div');
    el.className = 'hud-bar-wrap';
    el.innerHTML = `<span>${k}</span><div class="hud-bar-track"><div class="hud-bar-fill" style="width:${pct.toFixed(1)}%;background:${bar.color || '#c8ff3d'};"></div></div><b style="color:#fff;">${Math.round(bar.val)}</b>`;
    wrap.appendChild(el);
  }
}

const SCENE_PRESETS = {
  cyberpunk: { skyColor: '#09071a', ambientColor: '#2c1e4a', exposure: 1.4, fogColor: '#1a0b33', fogDensity: 0.018 },
  sunset: { skyColor: '#2d1626', ambientColor: '#663c35', exposure: 1.35, fogColor: '#4c2329', fogDensity: 0.012 },
  day: { skyColor: '#4f8ac9', ambientColor: '#6d7b8c', exposure: 1.25, fogColor: '#8eb6db', fogDensity: 0.006 },
  night: { skyColor: '#050812', ambientColor: '#162038', exposure: 1.05, fogColor: '#080e1f', fogDensity: 0.02 },
  horror: { skyColor: '#060807', ambientColor: '#161b18', exposure: 0.85, fogColor: '#0b100d', fogDensity: 0.045 },
  space: { skyColor: '#02030a', ambientColor: '#1a2236', exposure: 1.3, fogColor: '#02030a', fogDensity: 0 },
  matrix: { skyColor: '#020d05', ambientColor: '#0d3618', exposure: 1.35, fogColor: '#031a09', fogDensity: 0.022 },
};

const wox = {
  version: '3.0',
  app,
  pc,
  scene: {
    get: () => ({ ...sceneSettings, timeScale: woxTimeScale }),
    set: (opts) => { applySceneSettings(opts); if (!selectedEntity) renderInspector(); },
    setSky: (hex) => { applySceneSettings({ skyColor: hex }); if (!selectedEntity) renderInspector(); },
    setAmbient: (hex) => { applySceneSettings({ ambientColor: hex }); if (!selectedEntity) renderInspector(); },
    setExposure: (val) => { applySceneSettings({ exposure: Number(val) }); if (!selectedEntity) renderInspector(); },
    setFog: (hex, density = 0.015) => { applySceneSettings({ fogColor: hex, fogDensity: Number(density) }); if (!selectedEntity) renderInspector(); },
    setGravity: (g) => { applySceneSettings({ gravity: Number(g) }); if (!selectedEntity) renderInspector(); },
    setCamera: (mode, offset, fov) => {
      const next = {};
      if (mode) next.cameraMode = mode;
      if (Array.isArray(offset) && offset.length === 3) next.cameraOffset = offset;
      if (typeof fov === 'number') next.cameraFov = fov;
      applySceneSettings(next);
      if (!selectedEntity) renderInspector();
    },
    setTimeScale: (s) => { woxTimeScale = Math.max(0, Math.min(5, Number(s) ?? 1)); },
    getTimeScale: () => woxTimeScale,
    setGridVisible: (v) => { gridEntity.enabled = Boolean(v); },
    applyPreset: (name) => {
      const p = SCENE_PRESETS[String(name || '').toLowerCase()];
      if (p) { applySceneSettings(p); if (!selectedEntity) renderInspector(); }
    },
  },
  camera: {
    get: () => cameraEntity,
    setPos: (x, y, z) => cameraEntity.setPosition(Number(x) || 0, Number(y) || 0, Number(z) || 0),
    lookAt: (x, y, z) => cameraEntity.lookAt(Number(x) || 0, Number(y) || 0, Number(z) || 0),
    focus: (entOrName) => {
      const e = resolveEntityArg(entOrName);
      if (e) focusCameraOn(e.getPosition());
    },
    setFov: (fov) => applySceneSettings({ cameraFov: Number(fov) || 50 }),
    shake: (intensity = 0.35, duration = 0.25) => {
      camShakeAmp = Math.max(camShakeAmp, Number(intensity) || 0.35);
      camShakeTime = Math.max(camShakeTime, Number(duration) || 0.25);
    },
    flash: (hex = '#ffffff', duration = 0.18) => {
      const el = document.getElementById('wox-flash');
      if (!el) return;
      el.style.background = hex;
      el.style.opacity = '0.45';
      clearTimeout(woxFlashTimer);
      woxFlashTimer = setTimeout(() => { el.style.opacity = '0'; }, Math.max(50, (Number(duration) || 0.18) * 1000));
    },
  },
  lights: {
    addDirectional: (opts = {}) => {
      const ent = addPrimitive('light', { name: opts.name || 'DirLight', _runtime: isPlaying });
      if (opts.color && ent.light) ent.light.color = new pc.Color().fromString(opts.color);
      if (typeof opts.intensity === 'number' && ent.light) ent.light.intensity = opts.intensity;
      if (Array.isArray(opts.rot)) ent.setEulerAngles(...opts.rot);
      return ent;
    },
    addPoint: (pos = [0, 3, 0], color = '#c8ff3d', intensity = 2.5, range = 14, name = 'PointLight') => {
      const ent = new pc.Entity(name);
      ent.addComponent('light', { type: 'point', color: new pc.Color().fromString(color), intensity, range, castShadows: false });
      ent.setPosition(pos[0] || 0, pos[1] || 3, pos[2] || 0);
      return registerEntity(ent, { kind: 'light', color, solid: false, _runtime: isPlaying });
    },
    addSpot: (pos = [0, 6, 0], rot = [90, 0, 0], color = '#ffffff', intensity = 3, range = 20, name = 'SpotLight') => {
      const ent = new pc.Entity(name);
      ent.addComponent('light', { type: 'spot', color: new pc.Color().fromString(color), intensity, range, innerConeAngle: 25, outerConeAngle: 45, castShadows: false });
      ent.setPosition(pos[0] || 0, pos[1] || 6, pos[2] || 0);
      ent.setEulerAngles(rot[0] || 90, rot[1] || 0, rot[2] || 0);
      return registerEntity(ent, { kind: 'light', color, solid: false, _runtime: isPlaying });
    },
    setColor: (entOrName, hex) => {
      const e = resolveEntityArg(entOrName);
      if (e?.light) e.light.color = new pc.Color().fromString(hex);
    },
    setIntensity: (entOrName, val) => {
      const e = resolveEntityArg(entOrName);
      if (e?.light) e.light.intensity = Number(val) || 0;
    },
  },
  entities: {
    list: () => [...sceneEntities],
    count: (tag) => tag ? wox.entities.findByTag(tag).length : sceneEntities.length,
    find: (name) => resolveEntityArg(name),
    findByTag: (tag) => sceneEntities.filter(e => (e.__wox?.tag || '').toLowerCase() === String(tag || '').toLowerCase()),
    selected: () => selectedEntity,
    select: (entOrName) => selectEntity(resolveEntityArg(entOrName)),
    spawn: (kind = 'box', opts = {}) => {
      const ent = addPrimitive(kind, { ...opts, _runtime: isPlaying });
      if (Array.isArray(opts.pos) && opts.pos.length === 3) ent.setLocalPosition(opts.pos[0], opts.pos[1], opts.pos[2]);
      if (Array.isArray(opts.rot) && opts.rot.length === 3) ent.setLocalEulerAngles(opts.rot[0], opts.rot[1], opts.rot[2]);
      if (Array.isArray(opts.scale) && opts.scale.length === 3) ent.setLocalScale(opts.scale[0], opts.scale[1], opts.scale[2]);
      if (opts.cfg && typeof opts.cfg === 'object') Object.assign(ensureBehaviorConfig(ent), opts.cfg);
      return ent;
    },
    spawnAsset: (assetName, pos = [0, 1.2, 0]) => {
      const found = customAssets.find(a => a.name.toLowerCase() === String(assetName || '').toLowerCase());
      if (!found) return null;
      const ent = spawnCompoundAsset(found, pos);
      ent.__wox._runtime = isPlaying;
      return ent;
    },
    spawnGlb: (urlOrName, name, pos = [0, 0.5, 0]) => {
      const resolved = resolveGlbAsset(urlOrName);
      return loadGlbEntity(resolved.url, name || resolved.name || 'Model3D', pos);
    },
    clone: (entOrName, pos) => {
      const src = resolveEntityArg(entOrName);
      if (!src) return null;
      const p = pos || [src.getLocalPosition().x + 1.5, src.getLocalPosition().y, src.getLocalPosition().z];
      return wox.entities.spawn(src.__wox.kind === 'asset' ? 'box' : src.__wox.kind, {
        ...src.__wox,
        name: `${src.name}_Copy`,
        pos: p,
        rot: [src.getLocalEulerAngles().x, src.getLocalEulerAngles().y, src.getLocalEulerAngles().z],
        scale: [src.getLocalScale().x, src.getLocalScale().y, src.getLocalScale().z],
      });
    },
    destroy: (entOrName) => {
      const ent = resolveEntityArg(entOrName);
      if (!ent) return false;
      const idx = sceneEntities.indexOf(ent);
      if (idx >= 0) sceneEntities.splice(idx, 1);
      if (selectedEntity === ent) selectEntity(null);
      try { ent.destroy(); } catch {}
      if (!isPlaying) refreshHierarchy();
      return true;
    },
    clear: () => {
      for (const old of [...sceneEntities]) { try { old.destroy(); } catch {} }
      sceneEntities.length = 0;
      selectEntity(null);
      refreshHierarchy();
    },
    attachGlb: (entOrName, urlOrName) => {
      const ent = resolveEntityArg(entOrName);
      return ent ? attachGlbToEntity(ent, urlOrName) : Promise.resolve(null);
    },
    setVisible: (entOrName, vis = true) => {
      const e = resolveEntityArg(entOrName);
      if (e) e.enabled = Boolean(vis);
    },
    setTag: (entOrName, tag = '') => {
      const e = resolveEntityArg(entOrName);
      if (e?.__wox) e.__wox.tag = String(tag);
    },
    setParent: (childArg, parentArg) => {
      const c = resolveEntityArg(childArg);
      const p = parentArg ? resolveEntityArg(parentArg) : app.root;
      if (c && p && c !== p) c.reparent(p);
    },
    getPos: (entOrName) => { const e = resolveEntityArg(entOrName); if (!e) return [0, 0, 0]; const p = e.getLocalPosition(); return [p.x, p.y, p.z]; },
    getRot: (entOrName) => { const e = resolveEntityArg(entOrName); if (!e) return [0, 0, 0]; const r = e.getLocalEulerAngles(); return [r.x, r.y, r.z]; },
    getScale: (entOrName) => { const e = resolveEntityArg(entOrName); if (!e) return [1, 1, 1]; const s = e.getLocalScale(); return [s.x, s.y, s.z]; },
    move: (entOrName, dx = 0, dy = 0, dz = 0) => {
      const e = resolveEntityArg(entOrName);
      if (!e) return;
      const p = e.getLocalPosition();
      e.setLocalPosition(p.x + dx, p.y + dy, p.z + dz);
    },
    rotate: (entOrName, rx = 0, ry = 0, rz = 0) => {
      const e = resolveEntityArg(entOrName);
      if (e) e.rotate(rx, ry, rz);
    },
    lookAt: (entOrName, targetOrPos) => {
      const e = resolveEntityArg(entOrName);
      if (!e) return;
      const t = toVec3Arr(targetOrPos);
      e.lookAt(t[0], t[1], t[2]);
    },
    moveToward: (entOrName, targetOrPos, speed = 4, dt = 0.016) => {
      const e = resolveEntityArg(entOrName);
      if (!e) return 0;
      const p = e.getLocalPosition();
      const t = toVec3Arr(targetOrPos);
      const dx = t[0] - p.x, dy = t[1] - p.y, dz = t[2] - p.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 0.001) {
        const s = Math.min(d, speed * dt);
        e.setLocalPosition(p.x + (dx / d) * s, p.y + (dy / d) * s, p.z + (dz / d) * s);
      }
      return d;
    },
    setMaterial: (entOrName, opts = {}) => wox.materials.set(entOrName, opts),
    setTransform: (entOrName, { pos, rot, scale } = {}) => {
      const ent = resolveEntityArg(entOrName);
      if (!ent) return;
      if (Array.isArray(pos) && pos.length === 3) ent.setLocalPosition(pos[0], pos[1], pos[2]);
      if (Array.isArray(rot) && rot.length === 3) ent.setLocalEulerAngles(rot[0], rot[1], rot[2]);
      if (Array.isArray(scale) && scale.length === 3) ent.setLocalScale(scale[0], scale[1], scale[2]);
    },
    setBehavior: (entOrName, behavior, speed) => {
      const ent = resolveEntityArg(entOrName);
      if (!ent || !ent.__wox) return;
      if (behavior) ent.__wox.behavior = behavior;
      if (typeof speed === 'number') ent.__wox.speed = speed;
      if (!isPlaying) refreshHierarchy();
    },
    getConfig: (entOrName) => {
      const e = resolveEntityArg(entOrName);
      return e ? ensureBehaviorConfig(e) : null;
    },
    setConfig: (entOrName, partial = {}) => {
      const e = resolveEntityArg(entOrName);
      if (!e) return;
      Object.assign(ensureBehaviorConfig(e), partial);
      if (selectedEntity === e && !isPlaying) renderInspector();
    },
    setSolid: (entOrName, solid = true) => {
      const ent = resolveEntityArg(entOrName);
      if (ent && ent.__wox) ent.__wox.solid = Boolean(solid);
    },
    setScript: (entOrName, jsCode) => {
      const ent = resolveEntityArg(entOrName);
      if (ent && ent.__wox) {
        ent.__wox.script = String(jsCode || '');
        if (selectedEntity === ent) renderInspector();
      }
    },
  },
  materials: {
    get: (entOrName) => {
      const e = resolveEntityArg(entOrName);
      return e ? ensurePbrData(e) : null;
    },
    set: (entOrName, opts = {}) => {
      const ent = resolveEntityArg(entOrName);
      if (!ent || !ent.__wox) return;
      const pbr = ensurePbrData(ent);
      if (opts.color) pbr.diffuseColor = opts.color;
      if (opts.diffuseColor) pbr.diffuseColor = opts.diffuseColor;
      if (opts.emissive) pbr.emissiveColor = opts.emissive;
      if (opts.emissiveColor) pbr.emissiveColor = opts.emissiveColor;
      if (typeof opts.emissiveIntensity === 'number') pbr.emissiveIntensity = opts.emissiveIntensity;
      if (typeof opts.metalness === 'number') pbr.metalness = opts.metalness;
      if (typeof opts.gloss === 'number') pbr.glossiness = opts.gloss <= 1 ? opts.gloss * 100 : opts.gloss;
      if (typeof opts.glossiness === 'number') pbr.glossiness = opts.glossiness;
      if (typeof opts.glossInvert === 'boolean') pbr.glossInvert = opts.glossInvert;
      if (typeof opts.opacity === 'number') { pbr.opacity = opts.opacity; if (opts.opacity < 1 && pbr.blendType === 'none') pbr.blendType = 'normal'; }
      if (opts.blendType) pbr.blendType = opts.blendType;
      if (typeof opts.clearCoat === 'number') pbr.clearCoat = opts.clearCoat;
      if (Array.isArray(opts.tiling)) pbr.tiling = opts.tiling;
      if (Array.isArray(opts.offset)) pbr.offset = opts.offset;
      if (typeof opts.rotation === 'number') pbr.rotation = opts.rotation;
      applyPbrToEntity(ent);
    },
    pulseEmissive: (entOrName, hex = '#c8ff3d', speed = 4, t = playTime) => {
      const intensity = 0.4 + (Math.sin(t * speed) * 0.5 + 0.5) * 2.0;
      wox.materials.set(entOrName, { emissiveColor: hex, emissiveIntensity: intensity });
    },
    loadTexture: (entOrName, slot = 'diffuseMap', url = '') => {
      const ent = resolveEntityArg(entOrName);
      if (!ent || !url) return;
      const pbr = ensurePbrData(ent);
      pbr[slot] = url;
      loadPbrTexture(url, (tex) => {
        if (!pbr._tex) pbr._tex = {};
        pbr._tex[slot] = tex;
        applyPbrToEntity(ent);
      });
    },
  },
  player: {
    get: () => sceneEntities.find(e => e.enabled && (e.__wox?.behavior === 'player' || e.__wox?.behavior === 'player-fps' || e.__wox?.behavior === 'player-25d')) || null,
    getHp: () => { const p = wox.player.get(); return p ? (p.__wox._hp ?? ensureBehaviorConfig(p).maxHp ?? 100) : 0; },
    setHp: (hp) => {
      const p = wox.player.get();
      if (!p) return;
      const cfg = ensureBehaviorConfig(p);
      p.__wox._hp = Math.max(0, Math.min(cfg.maxHp ?? 100, Number(hp) || 0));
      wox.ui.setHud('HP', `${p.__wox._hp}/${cfg.maxHp ?? 100}`);
      if (p.__wox._hp <= 0) wox.ui.gameOver('GAME OVER', `Score finale: ${score}`);
    },
    damage: (amt = 10, source = '') => {
      const p = wox.player.get();
      if (!p) return;
      wox.player.setHp(wox.player.getHp() - (Number(amt) || 0));
      wox.camera.shake(0.3, 0.2);
      wox.camera.flash('#ff2222', 0.14);
      playWoxAudio('hit');
      if (source && wox.player.getHp() <= 0) wox.ui.gameOver('GAME OVER', `Sconfitto da ${source} · Score: ${score}`);
    },
    heal: (amt = 20) => { wox.player.setHp(wox.player.getHp() + (Number(amt) || 0)); playWoxAudio('powerup'); },
    teleport: (x, y, z) => { const p = wox.player.get(); if (p) { p.setLocalPosition(x, y, z); p.__wox.vy = 0; } },
    jump: (force = 9.5) => { const p = wox.player.get(); if (p) wox.physics.jump(p, force); },
    attack: () => { const p = wox.player.get(); if (p) firePlayerAttack(p); },
    isGrounded: () => Boolean(wox.player.get()?.__wox?._grounded),
    setZoom: (z) => { const p = wox.player.get(); if (p) ensureBehaviorConfig(p).camZoom = Number(z) || 8.5; },
  },
  input: {
    isPressed: (key) => app.keyboard.isPressed(resolveKeyCode(key)),
    wasPressed: (key) => app.keyboard.wasPressed(resolveKeyCode(key)),
    axis: () => {
      const kb = app.keyboard;
      let x = 0, z = 0;
      if (kb.isPressed(pc.KEY_W) || kb.isPressed(pc.KEY_UP)) z -= 1;
      if (kb.isPressed(pc.KEY_S) || kb.isPressed(pc.KEY_DOWN)) z += 1;
      if (kb.isPressed(pc.KEY_A) || kb.isPressed(pc.KEY_LEFT)) x -= 1;
      if (kb.isPressed(pc.KEY_D) || kb.isPressed(pc.KEY_RIGHT)) x += 1;
      return { x, z };
    },
  },
  physics: {
    getHalfExtents: (entOrName) => {
      const ent = resolveEntityArg(entOrName);
      return ent ? getEntityHalfExtents(ent) : { x: 0.5, y: 0.5, z: 0.5 };
    },
    distance: (a, b) => {
      const pa = toVec3Arr(a), pb = toVec3Arr(b);
      return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
    },
    isOverlapping: (a, b, margin = 0.08) => {
      const ea = resolveEntityArg(a);
      const eb = resolveEntityArg(b);
      if (!ea || !eb || !ea.enabled || !eb.enabled) return false;
      if (frameContacts.get(ea)?.has(eb)) return true;
      const pa = ea.getPosition();
      const pb = eb.getPosition();
      const ha = getEntityHalfExtents(ea);
      const hb = getEntityHalfExtents(eb);
      const m = Number(margin) || 0;
      return Math.abs(pa.x - pb.x) <= (ha.x + hb.x + m) &&
             Math.abs(pa.y - pb.y) <= (ha.y + hb.y + m) &&
             Math.abs(pa.z - pb.z) <= (ha.z + hb.z + m);
    },
    isTouching: (a, b) => wox.physics.isOverlapping(a, b, 0.12),
    getContacts: (entOrName) => {
      const e = resolveEntityArg(entOrName);
      return e && frameContacts.has(e) ? [...frameContacts.get(e)] : [];
    },
    findInRadius: (centerOrEnt, radius = 5, tag = null) => {
      const c = toVec3Arr(centerOrEnt);
      const r = Number(radius) || 5;
      const lowTag = tag ? String(tag).toLowerCase() : null;
      return sceneEntities.filter((e) => {
        if (!e.enabled || e.__wox?.kind === 'light' || e.__wox?.kind === 'plane') return false;
        if (lowTag && (e.__wox?.tag || '').toLowerCase() !== lowTag) return false;
        const p = e.getPosition();
        return Math.hypot(p.x - c[0], p.y - c[1], p.z - c[2]) <= r;
      });
    },
    raycast: (origin, dir, maxDist = 50, excludeEnt = null) => {
      const o = toVec3Arr(origin);
      const d = toVec3Arr(dir);
      const dLen = Math.hypot(d[0], d[1], d[2]) || 1;
      const dx = d[0] / dLen, dy = d[1] / dLen, dz = d[2] / dLen;
      const ex = resolveEntityArg(excludeEnt);
      let best = null;
      for (const e of sceneEntities) {
        if (!e.enabled || e === ex || e.__wox?.kind === 'light') continue;
        const p = e.getPosition();
        const h = getEntityHalfExtents(e);
        let tmin = 0, tmax = maxDist;
        const axes = [[o[0], dx, p.x - h.x, p.x + h.x], [o[1], dy, p.y - h.y, p.y + h.y], [o[2], dz, p.z - h.z, p.z + h.z]];
        let hit = true;
        for (const [org, dirC, minB, maxB] of axes) {
          if (Math.abs(dirC) < 1e-6) {
            if (org < minB || org > maxB) { hit = false; break; }
          } else {
            let t1 = (minB - org) / dirC, t2 = (maxB - org) / dirC;
            if (t1 > t2) [t1, t2] = [t2, t1];
            tmin = Math.max(tmin, t1);
            tmax = Math.min(tmax, t2);
            if (tmin > tmax) { hit = false; break; }
          }
        }
        if (hit && tmin >= 0 && tmin <= maxDist && (!best || tmin < best.distance)) {
          best = { entity: e, distance: tmin, point: [o[0] + dx * tmin, o[1] + dy * tmin, o[2] + dz * tmin] };
        }
      }
      return best;
    },
    knockback: (entOrName, fromPosOrEnt, force = 4, upForce = 5) => {
      const e = resolveEntityArg(entOrName);
      if (!e) return;
      const ep = e.getLocalPosition();
      const fp = toVec3Arr(fromPosOrEnt);
      const dx = ep.x - fp[0], dz = ep.z - fp[2];
      const d = Math.hypot(dx, dz) || 1;
      e.setLocalPosition(ep.x + (dx / d) * force, ep.y, ep.z + (dz / d) * force);
      if (e.__wox && upForce) { e.__wox.vy = upForce; e.__wox._grounded = false; }
    },
    jump: (entOrName, force = 9.5) => {
      const ent = resolveEntityArg(entOrName);
      if (!ent || !ent.__wox) return;
      ent.__wox.vy = Number(force) || 9.5;
      ent.__wox._grounded = false;
      playWoxAudio('jump');
    },
    setSolid: (entOrName, solid = true) => wox.entities.setSolid(entOrName, solid),
  },
  time: {
    now: () => playTime,
    after: (sec, fn) => { woxTimers.push({ rem: Math.max(0.01, Number(sec) || 0.1), interval: 0, fn }); },
    every: (sec, fn) => { const s = Math.max(0.05, Number(sec) || 1); woxTimers.push({ rem: s, interval: s, fn }); },
    cooldown: (key, sec = 0.5) => {
      const last = woxCooldowns.get(key) ?? -999;
      if (playTime - last >= sec) { woxCooldowns.set(key, playTime); return true; }
      return false;
    },
    clear: () => { woxTimers.length = 0; woxCooldowns.clear(); },
  },
  tween: {
    to: (entOrName, target = {}, duration = 0.6, easing = 'easeOut', onDone = null) => {
      const ent = resolveEntityArg(entOrName);
      if (!ent) return;
      const sp = ent.getLocalPosition(), sr = ent.getLocalEulerAngles(), ss = ent.getLocalScale();
      woxTweens.push({
        ent,
        elapsed: 0,
        duration: Math.max(0.02, Number(duration) || 0.6),
        easing,
        onDone,
        fromPos: [sp.x, sp.y, sp.z], toPos: target.pos || null,
        fromRot: [sr.x, sr.y, sr.z], toRot: target.rot || null,
        fromScale: [ss.x, ss.y, ss.z], toScale: target.scale || null,
      });
    },
  },
  spawner: {
    grid: (kind = 'box', cols = 4, rows = 4, spacing = 2, opts = {}) => {
      const out = [];
      const cx = ((cols - 1) * spacing) / 2, cz = ((rows - 1) * spacing) / 2;
      const basePos = opts.origin || [0, 0.5, 0];
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          out.push(wox.entities.spawn(kind, { ...opts, name: `${opts.name || 'Grid'}_${c}_${r}`, pos: [basePos[0] + c * spacing - cx, basePos[1], basePos[2] + r * spacing - cz] }));
        }
      }
      return out;
    },
    ring: (kind = 'coin', count = 8, radius = 5, center = [0, 1, 0], opts = {}) => {
      const out = [];
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        out.push(wox.entities.spawn(kind, { ...opts, name: `${opts.name || 'Ring'}_${i + 1}`, pos: [center[0] + Math.cos(a) * radius, center[1], center[2] + Math.sin(a) * radius] }));
      }
      return out;
    },
    line: (kind = 'box', from = [0, 0.5, 0], to = [10, 0.5, 0], count = 5, opts = {}) => {
      const out = [];
      for (let i = 0; i < count; i++) {
        const t = count > 1 ? i / (count - 1) : 0;
        out.push(wox.entities.spawn(kind, { ...opts, name: `${opts.name || 'Line'}_${i + 1}`, pos: [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t] }));
      }
      return out;
    },
    stairs: (steps = 10, startPos = [0, 0.5, 0], stepSize = [2.2, 0.5, 1.4], opts = {}) => {
      const out = [];
      for (let i = 0; i < steps; i++) {
        out.push(wox.entities.spawn('box', { ...opts, name: `${opts.name || 'Step'}_${i + 1}`, pos: [startPos[0], startPos[1] + i * stepSize[1], startPos[2] - i * stepSize[2]], scale: stepSize, solid: true }));
      }
      return out;
    },
    projectile: (fromPos, dirVec, opts = {}) => {
      const fp = toVec3Arr(fromPos);
      const dv = toVec3Arr(dirVec);
      const dl = Math.hypot(dv[0], dv[1], dv[2]) || 1;
      const col = opts.color || '#c8ff3d';
      const sz = opts.size || 0.22;
      const proj = new pc.Entity(opts.name || 'WoxProj');
      proj.addComponent('render', { type: opts.kind || 'sphere', material: makePbrMaterial(col, 0.1, 0.9, col), castShadows: false, receiveShadows: false });
      proj.setLocalScale(sz, sz, sz);
      proj.setLocalPosition(fp[0], fp[1], fp[2]);
      app.root.addChild(proj);
      const spd = opts.speed || 22;
      activeProjectiles.push({ ent: proj, owner: resolveEntityArg(opts.owner) || null, vx: (dv[0] / dl) * spd, vy: (dv[1] / dl) * spd, vz: (dv[2] / dl) * spd, damage: opts.damage ?? 25, color: col, life: opts.life ?? 2.5 });
      return proj;
    },
  },
  ui: {
    getScore: () => score,
    setScore: (n) => {
      score = Number(n) || 0;
      const el = document.getElementById('score-val');
      if (el) el.textContent = String(score);
    },
    addScore: (n) => wox.ui.setScore(score + (Number(n) || 0)),
    setHud: (label, value) => {
      woxHudMap.set(String(label), value);
      renderCustomHud();
    },
    setBar: (label, val, max = 100, color = '#c8ff3d') => {
      woxHudBars.set(String(label), { val: Number(val) || 0, max: Number(max) || 100, color });
      renderCustomHud();
    },
    clearHud: () => {
      woxHudMap.clear();
      woxHudBars.clear();
      renderCustomHud();
    },
    setCrosshair: (visible = true) => {
      const ch = document.getElementById('wox-crosshair');
      if (ch) ch.style.display = visible ? 'block' : 'none';
    },
    toast: (msg, ms = 2200) => {
      const el = document.getElementById('wox-toast');
      if (!el) return;
      el.textContent = String(msg);
      el.style.display = 'block';
      clearTimeout(woxToastTimer);
      woxToastTimer = setTimeout(() => { el.style.display = 'none'; }, ms);
    },
    showBanner: (text) => {
      const el = document.getElementById('play-banner');
      if (el) { el.textContent = String(text); el.style.display = 'block'; }
    },
    gameOver: (title = 'GAME OVER', subtitle = '') => {
      const wrap = document.getElementById('wox-gameover');
      const tEl = document.getElementById('wox-go-title');
      const sEl = document.getElementById('wox-go-sub');
      if (tEl) { tEl.textContent = String(title); tEl.style.color = '#ff5252'; }
      if (sEl) sEl.textContent = String(subtitle || `Score finale: ${score}`);
      if (wrap) wrap.style.display = 'flex';
      playWoxAudio('gameover');
    },
    win: (title = 'VITTORIA!', subtitle = '') => {
      const wrap = document.getElementById('wox-gameover');
      const tEl = document.getElementById('wox-go-title');
      const sEl = document.getElementById('wox-go-sub');
      if (tEl) { tEl.textContent = String(title); tEl.style.color = '#c8ff3d'; }
      if (sEl) sEl.textContent = String(subtitle || `Hai vinto! Score: ${score}`);
      if (wrap) wrap.style.display = 'flex';
      playWoxAudio('win');
    },
    hideOverlay: () => {
      const wrap = document.getElementById('wox-gameover');
      if (wrap) wrap.style.display = 'none';
    },
  },
  audio: {
    play: playWoxAudio,
    setMuted: (m) => { audioMuted = Boolean(m); },
    playSequence: (notes = [523, 659, 784, 1046], bpm = 180) => {
      const stepMs = (60 / Math.max(40, bpm)) * 1000;
      notes.forEach((n, i) => {
        if (n) setTimeout(() => playWoxAudio(Number(n), stepMs / 1200, 'triangle'), i * stepMs);
      });
    },
  },
  fx: {
    burst: spawnFxBurst,
    ring: (pos, hexColor = '#c8ff3d', maxRadius = 4, duration = 0.45) => {
      const p = toVec3Arr(pos);
      const ent = new pc.Entity('FxRing');
      ent.addComponent('render', { type: 'torus', material: makePbrMaterial(hexColor, 0.1, 0.9, hexColor), castShadows: false, receiveShadows: false });
      ent.setLocalPosition(p[0], p[1], p[2]);
      ent.setLocalScale(0.3, 0.3, 0.3);
      app.root.addChild(ent);
      activeFxShapes.push({ ent, kind: 'ring', elapsed: 0, duration: Math.max(0.08, duration), maxRadius });
    },
    beam: (fromPos, toPos, hexColor = '#c8ff3d', duration = 0.14) => {
      const a = toVec3Arr(fromPos), b = toVec3Arr(toPos);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const len = Math.max(0.1, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
      const ent = new pc.Entity('FxBeam');
      ent.addComponent('render', { type: 'box', material: makePbrMaterial(hexColor, 0.1, 0.9, hexColor), castShadows: false, receiveShadows: false });
      ent.setLocalPosition(mid[0], mid[1], mid[2]);
      ent.lookAt(b[0], b[1], b[2]);
      ent.setLocalScale(0.1, 0.1, len);
      app.root.addChild(ent);
      activeFxShapes.push({ ent, kind: 'beam', elapsed: 0, duration: Math.max(0.05, duration) });
    },
  },
  math: {
    clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
    lerp: (a, b, t) => a + (b - a) * t,
    rand: (min = 0, max = 1) => min + Math.random() * (max - min),
    randInt: (min = 0, max = 10) => Math.floor(min + Math.random() * (max - min + 1)),
    pick: (arr) => Array.isArray(arr) && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null,
    vec3: (x = 0, y = 0, z = 0) => new pc.Vec3(x, y, z),
    dist2D: (a, b) => { const pa = toVec3Arr(a), pb = toVec3Arr(b); return Math.hypot(pa[0] - pb[0], pa[2] - pb[2]); },
  },
  storage: {
    set: (key, val) => { try { localStorage.setItem(`wox_game_${key}`, JSON.stringify(val)); } catch {} },
    get: (key, fallback = null) => { try { const v = localStorage.getItem(`wox_game_${key}`); return v !== null ? JSON.parse(v) : fallback; } catch { return fallback; } },
  },
  events: {
    on: (ev, fn) => {
      if (!woxEventBus.has(ev)) woxEventBus.set(ev, []);
      woxEventBus.get(ev).push(fn);
    },
    once: (ev, fn) => {
      const wrap = (d) => { wox.events.off(ev, wrap); fn(d); };
      wox.events.on(ev, wrap);
    },
    off: (ev, fn) => {
      const list = woxEventBus.get(ev);
      if (list) woxEventBus.set(ev, list.filter(f => f !== fn));
    },
    emit: (ev, data) => {
      for (const fn of (woxEventBus.get(ev) || [])) {
        try { fn(data); } catch {}
      }
    },
    clear: () => woxEventBus.clear(),
  },
};
window.WOX = wox;

// Copy / Paste / Duplicate Selected Instance (Ctrl+C, Ctrl+V, Ctrl+D, & Inspector button)
let entityClipboard = null;
let pasteCount = 0;

function snapshotEntityForClipboard(ent) {
  if (!ent || !ent.__wox) return null;
  const p = ent.getLocalPosition();
  const r = ent.getLocalEulerAngles();
  const s = ent.getLocalScale();
  const w = ent.__wox;
  const pbrClone = w.pbr ? { ...w.pbr, offset: [...(w.pbr.offset || [0, 0])], tiling: [...(w.pbr.tiling || [1, 1])], _tex: { ...(w.pbr._tex || {}) } } : null;
  const cfgClone = w.cfg ? { ...w.cfg } : null;
  const assetMatch = w.kind === 'asset' ? customAssets.find(a => ent.name.startsWith(a.name)) : null;
  return {
    name: ent.name,
    pos: [p.x, p.y, p.z],
    rot: [r.x, r.y, r.z],
    scale: [s.x, s.y, s.z],
    wox: {
      kind: w.kind,
      color: w.color,
      emissive: w.emissive,
      metalness: w.metalness,
      gloss: w.gloss,
      behavior: w.behavior,
      speed: w.speed,
      followTarget: w.followTarget,
      solid: w.solid,
      tag: w.tag,
      script: w.script,
      glbUrl: w.glbUrl,
      pbr: pbrClone,
      cfg: cfgClone,
    },
    assetDef: assetMatch ? JSON.parse(JSON.stringify(assetMatch)) : null,
  };
}

async function pasteClipboardEntity(snap = entityClipboard) {
  if (!snap || isPlaying) return null;
  pasteCount++;
  const offset = 1.4 * pasteCount;
  const targetPos = [snap.pos[0] + offset, snap.pos[1], snap.pos[2]];
  const baseName = snap.name.replace(/_Copy\d*$/, '');
  const copyNum = sceneEntities.filter(e => e.name.startsWith(`${baseName}_Copy`)).length + 1;
  const nextName = `${baseName}_Copy${copyNum > 1 ? copyNum : ''}`;

  let ent = null;
  if (snap.wox.kind === 'glb' && snap.wox.glbUrl) {
    ent = await loadGlbEntity(snap.wox.glbUrl, nextName, targetPos);
  } else if (snap.wox.kind === 'asset' && snap.assetDef) {
    ent = spawnCompoundAsset(snap.assetDef, targetPos);
    ent.name = nextName;
  } else {
    ent = addPrimitive(snap.wox.kind || 'box', {
      ...snap.wox,
      name: nextName,
      pos: targetPos,
    });
    if (snap.wox.glbUrl) {
      await attachGlbToEntity(ent, snap.wox.glbUrl);
    }
  }

  ent.setLocalPosition(...targetPos);
  ent.setLocalEulerAngles(...snap.rot);
  ent.setLocalScale(...snap.scale);
  ent.__wox.behavior = snap.wox.behavior;
  ent.__wox.speed = snap.wox.speed;
  ent.__wox.followTarget = snap.wox.followTarget;
  ent.__wox.solid = snap.wox.solid;
  ent.__wox.tag = snap.wox.tag;
  ent.__wox.script = snap.wox.script;
  if (snap.wox.cfg) ent.__wox.cfg = { ...snap.wox.cfg };
  if (snap.wox.pbr) {
    ent.__wox.pbr = {
      ...snap.wox.pbr,
      name: `${nextName}_Mat`,
      offset: [...(snap.wox.pbr.offset || [0, 0])],
      tiling: [...(snap.wox.pbr.tiling || [1, 1])],
      _tex: { ...(snap.wox.pbr._tex || {}) },
    };
    if (!ent.__glbChild && snap.wox.kind !== 'glb') applyPbrToEntity(ent);
  }
  refreshHierarchy();
  selectEntity(ent);
  wox.ui.toast(`📋 Incollato "${ent.name}"`, 1400);
  return ent;
}

const btnDuplicate = document.getElementById('btn-duplicate');
if (btnDuplicate) {
  btnDuplicate.onclick = () => {
    if (!selectedEntity || isPlaying) return;
    entityClipboard = snapshotEntityForClipboard(selectedEntity);
    pasteCount = 0;
    pasteClipboardEntity(entityClipboard);
  };
}

// Keyboard shortcuts + Play Mode Runtime
let playTime = 0;
window.addEventListener('keydown', (e) => {
  if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  if (!isPlaying) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'c' || e.key === 'C')) {
      if (selectedEntity) {
        e.preventDefault();
        entityClipboard = snapshotEntityForClipboard(selectedEntity);
        pasteCount = 0;
        wox.ui.toast(`📋 Copiato "${selectedEntity.name}" (premi Ctrl+V per incollare)`, 1600);
      }
      return;
    }
    if (mod && (e.key === 'v' || e.key === 'V')) {
      if (entityClipboard) {
        e.preventDefault();
        pasteClipboardEntity(entityClipboard);
      }
      return;
    }
    if (mod && (e.key === 'd' || e.key === 'D')) {
      if (selectedEntity) {
        e.preventDefault();
        entityClipboard = snapshotEntityForClipboard(selectedEntity);
        pasteCount = 0;
        pasteClipboardEntity(entityClipboard);
      }
      return;
    }
    if (e.key === 'w' || e.key === 'W') document.querySelector('[data-gizmo="translate"]').click();
    if (e.key === 'e' || e.key === 'E') document.querySelector('[data-gizmo="rotate"]').click();
    if (e.key === 'r' || e.key === 'R') document.querySelector('[data-gizmo="scale"]').click();
    if (e.key === 'Delete') document.getElementById('btn-delete').click();
    if (e.key === 'f' || e.key === 'F') {
      focusCameraOn(selectedEntity ? selectedEntity.getPosition() : new pc.Vec3(0, 0, 0));
    }
  }
});

// PLAY / STOP Game Engine Loop
let customPlayFn = null;
let customPlayState = {};
let customPlayErrorShown = false;
const entityScriptMap = new Map();

function compileCustomScript(code) {
  const src = String(code || '').trim();
  if (!src) {
    customPlayFn = null;
    return { ok: true };
  }
  try {
    customPlayFn = new Function('wox', 'dt', 't', 'pc', 'app', 'entities', 'keys', 'find', 'addScore', 'state', src);
    customPlayErrorShown = false;
    return { ok: true };
  } catch (err) {
    customPlayFn = null;
    return { ok: false, error: err.message || String(err) };
  }
}

function compileEntityScripts() {
  entityScriptMap.clear();
  for (const ent of sceneEntities) {
    const src = String(ent.__wox?.script || '').trim();
    if (!src) continue;
    try {
      const fn = new Function('self', 'wox', 'dt', 't', 'state', src);
      entityScriptMap.set(ent, { fn, state: {} });
    } catch (err) {
      const st = document.getElementById('ai-status');
      if (st) st.textContent = `⚠ Errore script su "${ent.name}": ${err.message || err}`;
    }
  }
}

// Active Play Mode projectiles & FPS Pointer Lock / Mouse Zoom handlers
const activeProjectiles = [];
let playClickPending = false;

function clearProjectiles() {
  while (activeProjectiles.length) {
    try { activeProjectiles.pop().ent.destroy(); } catch {}
  }
}

function firePlayerAttack(playerEnt) {
  const w = playerEnt.__wox;
  const cfg = ensureBehaviorConfig(playerEnt);
  if (cfg.attackType === 'melee') {
    const pp = playerEnt.getPosition();
    playWoxAudio('hit');
    spawnFxBurst(pp, '#c8ff3d', 14);
    for (const target of sceneEntities) {
      if (!target.enabled || target === playerEnt) continue;
      const tw = target.__wox;
      if (!tw || tw.kind === 'plane' || tw.kind === 'light' || tw.behavior === 'coin') continue;
      const isEnemy = tw.behavior === 'follow-player' || tw.behavior === 'follow-object' || tw.behavior === 'patrol' || (tw.tag || '').toLowerCase() === 'enemy';
      if (!isEnemy) continue;
      if (target.getPosition().distance(pp) <= 3.2) {
        const tcfg = ensureBehaviorConfig(target);
        tw._enemyHp = (tw._enemyHp ?? tcfg.enemyHp ?? 50) - (cfg.attackDamage || 25);
        spawnFxBurst(target.getPosition(), '#ff6600', 10);
        if (tw._enemyHp <= 0) {
          target.enabled = false;
          wox.ui.addScore(25);
          playWoxAudio('explosion');
          spawnFxBurst(target.getPosition(), '#ff3b30', 18);
        }
      }
    }
    return;
  }

  const isFire = cfg.attackType === 'fireball';
  const pp = playerEnt.getPosition();
  let dx = 0, dy = 0, dz = -1;
  if (w.behavior === 'player-fps') {
    const yawRad = ((w._yaw ?? 0) * Math.PI) / 180;
    const pitchRad = ((w._pitch ?? 0) * Math.PI) / 180;
    dx = -Math.sin(yawRad) * Math.cos(pitchRad);
    dy = Math.sin(pitchRad);
    dz = -Math.cos(yawRad) * Math.cos(pitchRad);
  } else if (typeof w._dirX === 'number' && typeof w._dirZ === 'number' && (w._dirX !== 0 || w._dirZ !== 0)) {
    dx = w._dirX;
    dz = w._dirZ;
  } else {
    dx = 0;
    dz = -1;
  }

  const proj = new pc.Entity('WoxProjectile');
  const col = isFire ? '#ff5500' : '#c8ff3d';
  const mat = makePbrMaterial(col, 0.1, 0.9, col);
  proj.addComponent('render', { type: isFire ? 'sphere' : 'box', material: mat, castShadows: false, receiveShadows: false });
  proj.setLocalScale(isFire ? 0.35 : 0.16, isFire ? 0.35 : 0.16, isFire ? 0.35 : 0.7);
  const spawnX = pp.x + dx * 0.9;
  const spawnY = pp.y + (w.behavior === 'player-fps' ? (cfg.eyeHeight ?? 0.75) - 0.15 : 0.35);
  const spawnZ = pp.z + dz * 0.9;
  proj.setLocalPosition(spawnX, spawnY, spawnZ);
  proj.lookAt(spawnX + dx * 5, spawnY + dy * 5, spawnZ + dz * 5);
  app.root.addChild(proj);

  const speed = isFire ? 18 : 28;
  activeProjectiles.push({
    ent: proj,
    owner: playerEnt,
    vx: dx * speed,
    vy: dy * speed,
    vz: dz * speed,
    damage: cfg.attackDamage || 25,
    color: col,
    life: 2.2,
  });
  playWoxAudio(isFire ? 'explosion' : 'laser');
}

canvas.addEventListener('mousedown', (e) => {
  if (!isPlaying || e.button !== 0) return;
  const pEnt = sceneEntities.find(en => en.enabled && (en.__wox?.behavior === 'player' || en.__wox?.behavior === 'player-fps' || en.__wox?.behavior === 'player-25d'));
  if (!pEnt) return;
  const cfg = ensureBehaviorConfig(pEnt);
  if (pEnt.__wox.behavior === 'player-fps' && cfg.pointerLock && document.pointerLockElement !== canvas) {
    try { canvas.requestPointerLock(); } catch {}
  }
  if (cfg.attackKey === 'CLICK') {
    playClickPending = true;
  }
});

document.addEventListener('mousemove', (e) => {
  if (!isPlaying || document.pointerLockElement !== canvas) return;
  const pEnt = sceneEntities.find(en => en.enabled && en.__wox?.behavior === 'player-fps');
  if (!pEnt) return;
  const w = pEnt.__wox;
  const cfg = ensureBehaviorConfig(pEnt);
  const sens = Number(cfg.mouseSens ?? 0.18);
  w._yaw = (w._yaw ?? pEnt.getLocalEulerAngles().y ?? 0) - e.movementX * sens;
  w._pitch = Math.max(-75, Math.min(75, (w._pitch ?? 0) - e.movementY * sens));
});

canvas.addEventListener('wheel', (e) => {
  if (!isPlaying) return;
  const pEnt = sceneEntities.find(en => en.enabled && (en.__wox?.behavior === 'player' || en.__wox?.behavior === 'player-25d'));
  if (!pEnt) return;
  const cfg = ensureBehaviorConfig(pEnt);
  cfg.camZoom = Math.max(2, Math.min(35, (cfg.camZoom ?? 8.5) + (e.deltaY > 0 ? 0.8 : -0.8)));
}, { passive: true });

const playBtn = document.getElementById('btn-play');
playBtn.onclick = () => {
  isPlaying = !isPlaying;
  playBtn.classList.toggle('running', isPlaying);
  playBtn.textContent = isPlaying ? '■ STOP' : '▶ PLAY GAME';
  const bannerEl = document.getElementById('play-banner');
  if (bannerEl) {
    bannerEl.textContent = "🎮 MODALITÀ GIOCO ATTIVA — WASD/Frecce: Muovi · SPAZIO: Salto/Doppio Salto · Tasto Colpo: Attacca · FPS: Click per catturare Mouse · ESC/STOP: Editor";
    bannerEl.style.display = isPlaying ? 'block' : 'none';
  }
  document.getElementById('hud-score').style.display = isPlaying ? 'inline-block' : 'none';
  const goEl = document.getElementById('wox-gameover');
  if (goEl) goEl.style.display = 'none';
  gridEntity.enabled = !isPlaying;

  if (isPlaying) {
    score = 0;
    playTime = 0;
    playClickPending = false;
    customPlayState = {};
    customPlayErrorShown = false;
    woxHudMap.clear();
    renderCustomHud();
    woxEventBus.clear();
    clearFxParticles();
    clearProjectiles();
    clearRuntimeSdkState();
    const codeEl = document.getElementById('ai-code');
    if (codeEl) compileCustomScript(codeEl.value);
    compileEntityScripts();
    document.getElementById('score-val').textContent = '0';
    savedSnapshot = sceneEntities.map(e => {
      const cfg = ensureBehaviorConfig(e);
      e.__wox._hp = cfg.maxHp ?? 100;
      e.__wox._enemyHp = cfg.enemyHp ?? 50;
      e.__wox._jumpsLeft = cfg.doubleJump ? 2 : (cfg.canJump ? 1 : 0);
      e.__wox._attackCooldown = 0;
      e.__wox._hitCooldown = 0;
      e.__wox._yaw = e.getLocalEulerAngles().y || 0;
      e.__wox._pitch = 0;
      e.__wox._dirX = e.__wox.behavior === 'player-25d' ? 1 : 0;
      e.__wox._dirZ = e.__wox.behavior === 'player-25d' ? 0 : -1;
      e.__wox._startPos = e.getLocalPosition().clone();
      if (e.__wox.behavior === 'player' || e.__wox.behavior === 'player-fps' || e.__wox.behavior === 'player-25d') {
        wox.ui.setHud('HP', `${e.__wox._hp}/${cfg.maxHp ?? 100}`);
      }
      return {
        ent: e,
        pos: e.getLocalPosition().clone(),
        rot: e.getLocalEulerAngles().clone(),
        scale: e.getLocalScale().clone(),
        enabled: e.enabled
      };
    });
    if (camControls) camControls.enabled = false;
    updateGizmoAttachment();
    canvas.focus();
  } else {
    if (document.pointerLockElement === canvas) {
      try { document.exitPointerLock(); } catch {}
    }
    // Clean up any runtime-spawned entities, projectiles, particles, HUD & events
    for (let i = sceneEntities.length - 1; i >= 0; i--) {
      if (sceneEntities[i].__wox?._runtime) {
        try { sceneEntities[i].destroy(); } catch {}
        sceneEntities.splice(i, 1);
      }
    }
    clearProjectiles();
    clearFxParticles();
    clearRuntimeSdkState();
    woxHudMap.clear();
    renderCustomHud();
    woxEventBus.clear();
    entityScriptMap.clear();

    if (savedSnapshot) {
      for (const s of savedSnapshot) {
        if (!s.ent || s.ent._destroyed) continue;
        s.ent.enabled = s.enabled;
        s.ent.setLocalPosition(s.pos);
        s.ent.setLocalEulerAngles(s.rot);
        s.ent.setLocalScale(s.scale);
        s.ent.__wox.vy = 0;
      }
    }
    if (camControls) camControls.enabled = true;
    refreshHierarchy();
    updateGizmoAttachment();
    syncInspectorTransform();
  }
};

const btnGoRestart = document.getElementById('btn-go-restart');
if (btnGoRestart) {
  btnGoRestart.onclick = () => {
    if (isPlaying) playBtn.click(); // STOP
    playBtn.click(); // PLAY again
  };
}

function getEntityHalfExtents(ent) {
  const s = ent.getLocalScale();
  const kind = ent.__wox?.kind || 'box';
  if (kind === 'capsule') return { x: Math.abs(s.x) * 0.5, y: Math.abs(s.y) * 1.0, z: Math.abs(s.z) * 0.5 };
  return { x: Math.max(0.25, Math.abs(s.x) * 0.5), y: Math.max(0.25, Math.abs(s.y) * 0.5), z: Math.max(0.25, Math.abs(s.z) * 0.5) };
}

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
  const rawDt = dt;
  dt = rawDt * woxTimeScale;
  playTime += dt;
  frameContacts.clear();
  const kb = app.keyboard;
  let playerEnt = null;

  // Step scheduled timers (wox.time.after / wox.time.every)
  for (let i = woxTimers.length - 1; i >= 0; i--) {
    const tm = woxTimers[i];
    tm.rem -= dt;
    if (tm.rem <= 0) {
      try { tm.fn(); } catch {}
      if (tm.interval > 0) tm.rem += tm.interval;
      else woxTimers.splice(i, 1);
    }
  }

  // Step smooth 3D tweens (wox.tween.to)
  for (let i = woxTweens.length - 1; i >= 0; i--) {
    const tw = woxTweens[i];
    if (!tw.ent || tw.ent._destroyed) { woxTweens.splice(i, 1); continue; }
    tw.elapsed += dt;
    let u = Math.min(1, tw.elapsed / tw.duration);
    const e = tw.easing === 'linear' ? u : tw.easing === 'easeIn' ? u * u : tw.easing === 'easeInOut' ? (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2) : (1 - Math.pow(1 - u, 3));
    if (tw.toPos) tw.ent.setLocalPosition(tw.fromPos[0] + (tw.toPos[0] - tw.fromPos[0]) * e, tw.fromPos[1] + (tw.toPos[1] - tw.fromPos[1]) * e, tw.fromPos[2] + (tw.toPos[2] - tw.fromPos[2]) * e);
    if (tw.toRot) tw.ent.setLocalEulerAngles(tw.fromRot[0] + (tw.toRot[0] - tw.fromRot[0]) * e, tw.fromRot[1] + (tw.toRot[1] - tw.fromRot[1]) * e, tw.fromRot[2] + (tw.toRot[2] - tw.fromRot[2]) * e);
    if (tw.toScale) tw.ent.setLocalScale(tw.fromScale[0] + (tw.toScale[0] - tw.fromScale[0]) * e, tw.fromScale[1] + (tw.toScale[1] - tw.fromScale[1]) * e, tw.fromScale[2] + (tw.toScale[2] - tw.fromScale[2]) * e);
    if (u >= 1) {
      woxTweens.splice(i, 1);
      if (typeof tw.onDone === 'function') { try { tw.onDone(tw.ent); } catch {} }
    }
  }

  // Step 3D FX rings & beams (wox.fx.ring / wox.fx.beam)
  for (let i = activeFxShapes.length - 1; i >= 0; i--) {
    const fx = activeFxShapes[i];
    fx.elapsed += rawDt;
    if (fx.elapsed >= fx.duration) {
      try { fx.ent.destroy(); } catch {}
      activeFxShapes.splice(i, 1);
      continue;
    }
    if (fx.kind === 'ring') {
      const u = fx.elapsed / fx.duration;
      const sc = 0.3 + u * fx.maxRadius;
      fx.ent.setLocalScale(sc, 0.25 * (1 - u * 0.7), sc);
    }
  }

  // 1. Update non-player behaviors first and record their frame delta (for moving platforms)
  for (const ent of sceneEntities) {
    if (!ent.enabled) continue;
    const w = ent.__wox;
    const cfg = ensureBehaviorConfig(ent);
    w._dx = 0; w._dy = 0; w._dz = 0;
    if (w.behavior === 'spin' || w.behavior === 'coin') {
      const amt = (w.speed || 3) * 45 * dt;
      const ax = w.behavior === 'spin' ? (cfg.spinAxis || 'y') : 'y';
      ent.rotate(ax === 'x' ? amt : 0, ax === 'y' ? amt : 0, ax === 'z' ? amt : 0);
    } else if (w.behavior === 'hover') {
      const sp = w._startPos || ent.getLocalPosition();
      const targetY = sp.y + Math.sin(playTime * (w.speed || 3)) * (cfg.hoverAmp ?? 0.45);
      const cur = ent.getLocalPosition();
      w._dy = targetY - cur.y;
      ent.setLocalPosition(cur.x, targetY, cur.z);
    } else if (w.behavior === 'patrol') {
      const sp = w._startPos || ent.getLocalPosition();
      const range = cfg.patrolRange ?? 3.5;
      const offset = Math.sin(playTime * ((w.speed || 3) * 0.45)) * range;
      const cur = ent.getLocalPosition();
      let nx = cur.x, ny = cur.y, nz = cur.z;
      if (cfg.patrolAxis === 'z') nz = sp.z + offset;
      else if (cfg.patrolAxis === 'y') ny = sp.y + offset;
      else nx = sp.x + offset;
      w._dx = nx - cur.x; w._dy = ny - cur.y; w._dz = nz - cur.z;
      ent.setLocalPosition(nx, ny, nz);
    }
  }

  // 2. Update Player(s) (Third Person, FPS, 2.5D) with Jump/Double Jump, Attack, HP & 3D AABB collisions
  for (const ent of sceneEntities) {
    if (!ent.enabled) continue;
    const w = ent.__wox;
    if (w.behavior !== 'player' && w.behavior !== 'player-fps' && w.behavior !== 'player-25d') continue;
    playerEnt = ent;
    const cfg = ensureBehaviorConfig(ent);
    const spd = w.speed || 5;
    const p = ent.getLocalPosition().clone();
    const prevY = p.y;
    let mx = 0, mz = 0;

    if (w.behavior === 'player-fps') {
      if (typeof w._yaw !== 'number') w._yaw = ent.getLocalEulerAngles().y || 0;
      const turnSpd = 115;
      if (kb.isPressed(pc.KEY_Q) || kb.isPressed(pc.KEY_LEFT)) w._yaw += turnSpd * dt;
      if (kb.isPressed(pc.KEY_E) || kb.isPressed(pc.KEY_RIGHT)) w._yaw -= turnSpd * dt;
      ent.setLocalEulerAngles(0, w._yaw, 0);

      let fwdIn = 0, strafeIn = 0;
      if (kb.isPressed(pc.KEY_W) || kb.isPressed(pc.KEY_UP)) fwdIn += 1;
      if (kb.isPressed(pc.KEY_S) || kb.isPressed(pc.KEY_DOWN)) fwdIn -= 1;
      if (kb.isPressed(pc.KEY_D)) strafeIn += 1;
      if (kb.isPressed(pc.KEY_A)) strafeIn -= 1;
      const rad = (w._yaw * Math.PI) / 180;
      const fx = -Math.sin(rad), fz = -Math.cos(rad);
      const rx = Math.cos(rad), rz = -Math.sin(rad);
      mx = fx * fwdIn + rx * strafeIn;
      mz = fz * fwdIn + rz * strafeIn;
      const len = Math.hypot(mx, mz) || 1;
      if (mx || mz) {
        p.x += (mx / len) * spd * dt;
        p.z += (mz / len) * spd * dt;
      }
    } else if (w.behavior === 'player-25d') {
      if (kb.isPressed(pc.KEY_A) || kb.isPressed(pc.KEY_LEFT)) mx -= 1;
      if (kb.isPressed(pc.KEY_D) || kb.isPressed(pc.KEY_RIGHT)) mx += 1;
      p.x += mx * spd * dt;
      if (mx > 0) {
        ent.setLocalEulerAngles(0, 90, 0);
        w._dirX = 1; w._dirZ = 0;
      } else if (mx < 0) {
        ent.setLocalEulerAngles(0, -90, 0);
        w._dirX = -1; w._dirZ = 0;
      }
    } else {
      if (kb.isPressed(pc.KEY_W) || kb.isPressed(pc.KEY_UP)) mz -= 1;
      if (kb.isPressed(pc.KEY_S) || kb.isPressed(pc.KEY_DOWN)) mz += 1;
      if (kb.isPressed(pc.KEY_A) || kb.isPressed(pc.KEY_LEFT)) mx -= 1;
      if (kb.isPressed(pc.KEY_D) || kb.isPressed(pc.KEY_RIGHT)) mx += 1;
      const len = Math.hypot(mx, mz) || 1;
      if (mx || mz) {
        const nx = mx / len;
        const nz = mz / len;
        p.x += nx * spd * dt;
        p.z += nz * spd * dt;
        w._dirX = nx;
        w._dirZ = nz;
        const angle = Math.atan2(nx, nz) * (180 / Math.PI);
        ent.setLocalEulerAngles(0, angle, 0);
      }
    }

    if (typeof ent.vy === 'number' && ent.vy !== 0) {
      w.vy = ent.vy;
      ent.vy = 0;
    }

    // Jump & Double Jump
    const wantJump = kb.wasPressed(pc.KEY_SPACE) || (w.behavior === 'player-25d' && (kb.wasPressed(pc.KEY_W) || kb.wasPressed(pc.KEY_UP)));
    if (wantJump && cfg.canJump !== false) {
      const maxJumps = cfg.doubleJump ? 2 : 1;
      if (w._grounded) {
        w.vy = cfg.jumpForce ?? 7.2;
        w._grounded = false;
        w._jumpsLeft = maxJumps - 1;
        playWoxAudio('jump');
      } else if ((w._jumpsLeft || 0) > 0) {
        w.vy = (cfg.jumpForce ?? 7.2) * 0.92;
        w._jumpsLeft--;
        playWoxAudio('jump');
        spawnFxBurst(p, '#c8ff3d', 6);
      }
    }

    // Player Attack (F, E, SHIFT, or CLICK)
    w._attackCooldown = Math.max(0, (w._attackCooldown || 0) - dt);
    w._hitCooldown = Math.max(0, (w._hitCooldown || 0) - dt);
    if (cfg.attackKey && cfg.attackKey !== 'NONE' && w._attackCooldown <= 0) {
      let wantAttack = false;
      if (cfg.attackKey === 'CLICK') {
        wantAttack = playClickPending;
        playClickPending = false;
      } else {
        wantAttack = kb.wasPressed(resolveKeyCode(cfg.attackKey));
      }
      if (wantAttack) {
        w._attackCooldown = 0.28;
        firePlayerAttack(ent);
      }
    }

    w.vy = (w.vy || 0) - (sceneSettings.gravity ?? 16) * dt;
    p.y += w.vy * dt;

    const pHalf = getEntityHalfExtents(ent);
    w._grounded = false;

    // Ground floor collision
    if (p.y - pHalf.y <= 0.0 && w.vy <= 0) {
      p.y = pHalf.y;
      w.vy = 0;
      w._grounded = true;
      w._jumpsLeft = cfg.doubleJump ? 2 : (cfg.canJump ? 1 : 0);
    }

    // Solid object AABB collisions (platforms, walls, boxes, moving platforms)
    for (const other of sceneEntities) {
      if (other === ent || !other.enabled) continue;
      const ow = other.__wox;
      if (!ow || ow.solid === false || ow.kind === 'plane' || ow.kind === 'light' || ow.behavior === 'coin') continue;

      const op = other.getLocalPosition();
      const oHalf = getEntityHalfExtents(other);
      const overlapX = (pHalf.x + oHalf.x) - Math.abs(p.x - op.x);
      const overlapY = (pHalf.y + oHalf.y) - Math.abs(p.y - op.y);
      const overlapZ = (pHalf.z + oHalf.z) - Math.abs(p.z - op.z);

      if (overlapX > 0 && overlapY > 0 && overlapZ > 0) {
        recordFrameContact(ent, other);
        wox.events.emit('collision', { a: ent, b: other });
        const otherTop = op.y + oHalf.y;
        const wasAbove = (prevY - pHalf.y) >= (otherTop - 0.35);
        if (wasAbove && w.vy <= 0) {
          p.y = otherTop + pHalf.y;
          p.x += ow._dx || 0;
          p.z += ow._dz || 0;
          w.vy = 0;
          w._grounded = true;
          w._jumpsLeft = cfg.doubleJump ? 2 : (cfg.canJump ? 1 : 0);
        } else if (overlapX < overlapZ) {
          p.x += p.x < op.x ? -overlapX : overlapX;
        } else {
          p.z += p.z < op.z ? -overlapZ : overlapZ;
        }
      }
    }

    ent.setLocalPosition(p);
  }

  // 3. Follow Player & Follow Object behaviors (with Activation Mode, Detect Range, Stop Dist & Contact Damage)
  for (const ent of sceneEntities) {
    if (!ent.enabled) continue;
    const w = ent.__wox;
    if (w.behavior !== 'follow-player' && w.behavior !== 'follow-object') continue;
    const cfg = ensureBehaviorConfig(ent);
    const target = w.behavior === 'follow-player' ? playerEnt : resolveEntityArg(w.followTarget);
    if (!target || target === ent || !target.enabled) continue;

    const ep = ent.getLocalPosition().clone();
    const tp = target.getPosition();
    const dx = tp.x - ep.x;
    const dz = tp.z - ep.z;
    const dist = Math.hypot(dx, dz);

    // Check activation trigger
    let active = true;
    const mode = cfg.activateMode || 'range';
    const detectRange = cfg.detectRange ?? 10;
    if (mode === 'range') {
      active = dist <= detectRange;
    } else if (mode === 'sight') {
      if (dist > detectRange) {
        active = false;
      } else {
        const rad = (ent.getLocalEulerAngles().y * Math.PI) / 180;
        const fx = Math.sin(rad), fz = Math.cos(rad);
        const dot = (dx * fx + dz * fz) / (dist || 1);
        active = dot >= 0.25 || dist <= 2.5;
      }
    }

    const stopDist = cfg.stopDist ?? 1.65;
    if (active && dist > stopDist) {
      const step = Math.min(dist - stopDist, (w.speed || 3.5) * dt);
      ep.x += (dx / dist) * step;
      ep.z += (dz / dist) * step;
      ent.setLocalPosition(ep);
      const angle = Math.atan2(dx, dz) * (180 / Math.PI);
      ent.setLocalEulerAngles(0, angle, 0);
    }

    // Contact Damage to Player
    if (target === playerEnt && (cfg.contactDamage || 0) > 0 && dist <= stopDist + 0.35) {
      const pw = playerEnt.__wox;
      const pcfg = ensureBehaviorConfig(playerEnt);
      if ((pw._hitCooldown || 0) <= 0) {
        pw._hitCooldown = 0.85;
        pw._hp = Math.max(0, (pw._hp ?? pcfg.maxHp ?? 100) - cfg.contactDamage);
        wox.ui.setHud('HP', `${pw._hp}/${pcfg.maxHp ?? 100}`);
        playWoxAudio('hit');
        spawnFxBurst(playerEnt.getPosition(), '#ff3b30', 8);
        if (pw._hp <= 0) {
          wox.ui.gameOver('GAME OVER', `Sconfitto da ${ent.name} · Score: ${score}`);
        }
      }
    }
  }

  // Update active projectiles
  for (let i = activeProjectiles.length - 1; i >= 0; i--) {
    const pr = activeProjectiles[i];
    pr.life -= dt;
    if (pr.life <= 0) {
      try { pr.ent.destroy(); } catch {}
      activeProjectiles.splice(i, 1);
      continue;
    }
    const cur = pr.ent.getLocalPosition();
    pr.ent.setLocalPosition(cur.x + pr.vx * dt, cur.y + pr.vy * dt, cur.z + pr.vz * dt);
    const pPos = pr.ent.getPosition();

    let hit = false;
    for (const target of sceneEntities) {
      if (!target.enabled || target === pr.owner) continue;
      const tw = target.__wox;
      if (!tw || tw.kind === 'plane' || tw.kind === 'light' || tw.behavior === 'coin') continue;
      if (target.getPosition().distance(pPos) <= 1.25) {
        hit = true;
        spawnFxBurst(pPos, pr.color, 10);
        const isEnemy = tw.behavior === 'follow-player' || tw.behavior === 'follow-object' || tw.behavior === 'patrol' || (tw.tag || '').toLowerCase() === 'enemy';
        if (isEnemy) {
          const tcfg = ensureBehaviorConfig(target);
          tw._enemyHp = (tw._enemyHp ?? tcfg.enemyHp ?? 50) - pr.damage;
          playWoxAudio('hit');
          if (tw._enemyHp <= 0) {
            target.enabled = false;
            wox.ui.addScore(25);
            playWoxAudio('explosion');
            spawnFxBurst(target.getPosition(), '#ff3b30', 18);
          }
        }
        break;
      }
    }
    if (hit) {
      try { pr.ent.destroy(); } catch {}
      activeProjectiles.splice(i, 1);
    }
  }

  if (playerEnt) {
    const pp = playerEnt.getPosition();
    const pb = playerEnt.__wox?.behavior;
    const pcfg = ensureBehaviorConfig(playerEnt);
    const activeCamMode = pb === 'player-fps' ? 'first-person' : pb === 'player-25d' ? 'side-scroll' : sceneSettings.cameraMode;
    const off = sceneSettings.cameraOffset || [0, 5.5, 8.5];
    if (activeCamMode === 'top-down') {
      cameraEntity.setPosition(pp.x, pp.y + 16, pp.z + 2.5);
      cameraEntity.lookAt(pp.x, pp.y, pp.z);
    } else if (activeCamMode === 'first-person') {
      const yawRad = ((playerEnt.__wox?._yaw ?? playerEnt.getLocalEulerAngles().y) * Math.PI) / 180;
      const pitchRad = ((playerEnt.__wox?._pitch ?? 0) * Math.PI) / 180;
      const fx = -Math.sin(yawRad) * Math.cos(pitchRad);
      const fy = Math.sin(pitchRad);
      const fz = -Math.cos(yawRad) * Math.cos(pitchRad);
      const eyeY = pp.y + (pcfg.eyeHeight ?? 0.75);
      cameraEntity.setPosition(pp.x, eyeY, pp.z);
      cameraEntity.lookAt(pp.x + fx * 10, eyeY + fy * 10, pp.z + fz * 10);
    } else if (activeCamMode === 'side-scroll') {
      cameraEntity.setPosition(pp.x, pp.y + (pcfg.camHeight ?? 3.2), pp.z + (pcfg.camZoom ?? 13));
      cameraEntity.lookAt(pp.x, pp.y + 1.0, pp.z);
    } else if (activeCamMode !== 'fixed') {
      const zoom = pcfg.camZoom ?? off[2] ?? 8.5;
      const camH = pcfg.camHeight ?? off[1] ?? 5.5;
      cameraEntity.setPosition(pp.x + (off[0] || 0), pp.y + camH, pp.z + zoom);
      cameraEntity.lookAt(pp.x, pp.y + 0.8, pp.z);
    }
    if (camShakeTime > 0) {
      camShakeTime = Math.max(0, camShakeTime - rawDt);
      const cp = cameraEntity.getPosition();
      cameraEntity.setPosition(cp.x + (Math.random() - 0.5) * camShakeAmp, cp.y + (Math.random() - 0.5) * camShakeAmp, cp.z + (Math.random() - 0.5) * camShakeAmp);
      if (camShakeTime <= 0) camShakeAmp = 0;
    }
    for (const ent of sceneEntities) {
      if (ent.enabled && ent.__wox.behavior === 'coin') {
        if (ent.getPosition().distance(pp) < 1.25) {
          ent.enabled = false;
          const ccfg = ensureBehaviorConfig(ent);
          wox.ui.addScore(ccfg.coinValue ?? 10);
          playWoxAudio('coin');
          spawnFxBurst(ent.getPosition(), '#ffd43b', 8);
        }
      }
    }
  }

  // Update 3D FX particles
  for (let i = activeParticles.length - 1; i >= 0; i--) {
    const pt = activeParticles[i];
    pt.life -= dt;
    if (pt.life <= 0) {
      try { pt.ent.destroy(); } catch {}
      activeParticles.splice(i, 1);
      continue;
    }
    pt.vy -= (sceneSettings.gravity ?? 16) * 0.65 * dt;
    const p = pt.ent.getLocalPosition();
    pt.ent.setLocalPosition(p.x + pt.vx * dt, p.y + pt.vy * dt, p.z + pt.vz * dt);
    const sc = Math.max(0.02, (pt.life / pt.maxLife) * 0.22);
    pt.ent.setLocalScale(sc, sc, sc);
  }

  // Run per-entity scripts
  for (const [ent, rec] of entityScriptMap.entries()) {
    if (!ent || !ent.enabled || ent._destroyed) continue;
    try {
      rec.fn(ent, wox, dt, playTime, rec.state);
    } catch (err) {
      if (!customPlayErrorShown) {
        customPlayErrorShown = true;
        const st = document.getElementById('ai-status');
        if (st) st.textContent = `⚠ Errore script "${ent.name}": ${err.message || err}`;
      }
    }
  }

  // Run global Play Mode script
  if (customPlayFn) {
    try {
      const find = (nm) => resolveEntityArg(nm);
      const addScore = (n) => wox.ui.addScore(n);
      customPlayFn(wox, dt, playTime, pc, app, sceneEntities, kb, find, addScore, customPlayState);
    } catch (err) {
      if (!customPlayErrorShown) {
        customPlayErrorShown = true;
        const st = document.getElementById('ai-status');
        if (st) st.textContent = `⚠ Errore runtime script: ${err.message || err}`;
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

document.getElementById('btn-save').onclick = async () => {
  const defaultName = `WOX Game ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
  const gameName = window.prompt('Nome del gioco da salvare in Libreria (tag: wox-engine):', defaultName);
  if (gameName === null) return;
  const cleanName = gameName.trim() || defaultName;

  const data = sceneEntities.map(e => ({
    name: e.name,
    pos: [e.getLocalPosition().x, e.getLocalPosition().y, e.getLocalPosition().z],
    rot: [e.getLocalEulerAngles().x, e.getLocalEulerAngles().y, e.getLocalEulerAngles().z],
    scale: [e.getLocalScale().x, e.getLocalScale().y, e.getLocalScale().z],
    wox: e.__wox
  }));
  const scriptCode = document.getElementById('ai-code')?.value || '';
  const payload = { engine: 'WOX Engine', name: cleanName, version: pc.version, sceneSettings: { ...sceneSettings }, entities: data, script: scriptCode };
  const jsonStr = JSON.stringify(payload, null, 2);

  // Capture 3D viewport thumbnail for the Wox Library
  let thumbnail = null;
  try {
    app.render();
    thumbnail = canvas.toDataURL('image/png');
  } catch {}

  const st = document.getElementById('ai-status');
  if (st) st.textContent = `💾 Salvataggio "${cleanName}" in Libreria...`;
  try {
    const res = await fetch('/api/playcanvas/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: cleanName, scene: payload, thumbnail }),
    });
    const saved = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(saved?.error || `HTTP ${res.status}`);
    if (st) st.textContent = `✅ Gioco "${cleanName}" salvato in Libreria (tag: wox-engine)!`;
  } catch (err) {
    if (st) st.textContent = `⚠ Errore salvataggio Libreria: ${err.message || err}`;
  }

  // Also download local JSON backup
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${cleanName.toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'wox-engine-scene'}.woxgame.json`;
  a.click();
};

const sceneInput = document.getElementById('file-scene');
document.getElementById('btn-load').onclick = () => sceneInput.click();
sceneInput.onchange = async () => {
  const f = sceneInput.files[0];
  if (!f) return;
  const json = JSON.parse(await f.text());
  if (json.sceneSettings) applySceneSettings(json.sceneSettings);
  while (sceneEntities.length) sceneEntities.pop().destroy();
  for (const item of (json.entities || [])) {
    let ent;
    if (item.wox?.kind === 'glb' && item.wox.glbUrl) {
      ent = await loadGlbEntity(item.wox.glbUrl, item.name, item.pos);
    } else {
      ent = addPrimitive(item.wox?.kind || 'box', { ...item.wox, name: item.name, pos: item.pos });
      if (item.wox?.glbUrl) await attachGlbToEntity(ent, item.wox.glbUrl);
    }
    if (Array.isArray(item.pos)) ent.setLocalPosition(...item.pos);
    if (Array.isArray(item.rot)) ent.setLocalEulerAngles(...item.rot);
    if (Array.isArray(item.scale)) ent.setLocalScale(...item.scale);
  }
  const codeEl = document.getElementById('ai-code');
  if (codeEl && typeof json.script === 'string') {
    codeEl.value = json.script;
    compileCustomScript(json.script);
  }
  refreshHierarchy();
  selectEntity(sceneEntities[0] || null);
  sceneInput.value = '';
};

// Custom AI-generated compound assets (saved in localStorage & shown in Assets strip)
let customAssets = [];
try {
  const savedAssets = JSON.parse(localStorage.getItem('wox_engine_custom_assets') || '[]');
  if (Array.isArray(savedAssets)) customAssets = savedAssets;
} catch {}

let hiddenAssetKeys = new Set();
try {
  const savedHidden = JSON.parse(localStorage.getItem('wox_engine_hidden_assets') || '[]');
  if (Array.isArray(savedHidden)) hiddenAssetKeys = new Set(savedHidden);
} catch {}

function hideAssetKey(key) {
  hiddenAssetKeys.add(key);
  try { localStorage.setItem('wox_engine_hidden_assets', JSON.stringify([...hiddenAssetKeys])); } catch {}
}

function deleteCustomAsset(name) {
  customAssets = customAssets.filter(a => a.name.toLowerCase() !== String(name || '').toLowerCase());
  try { localStorage.setItem('wox_engine_custom_assets', JSON.stringify(customAssets)); } catch {}
}

function addAssetDeleteBtn(card, title, onDelete) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'asset-del';
  btn.title = `Cancella asset "${title}"`;
  btn.textContent = '✕';
  btn.onclick = (e) => {
    e.stopPropagation();
    onDelete();
    const st = document.getElementById('ai-status');
    if (st) st.textContent = `🗑 Asset "${title}" rimosso.`;
    loadWoxAssets();
  };
  card.appendChild(btn);
}

function saveCustomAsset(assetDef) {
  const idx = customAssets.findIndex(a => a.name.toLowerCase() === assetDef.name.toLowerCase());
  if (idx >= 0) customAssets[idx] = assetDef;
  else customAssets.unshift(assetDef);
  try { localStorage.setItem('wox_engine_custom_assets', JSON.stringify(customAssets.slice(0, 40))); } catch {}
}

function spawnCompoundAsset(assetDef, worldPos = [0, 1.2, 0]) {
  const count = sceneEntities.filter(e => e.name.startsWith(assetDef.name)).length;
  const rootName = count > 0 ? `${assetDef.name}_${count + 1}` : assetDef.name;
  const parent = new pc.Entity(rootName);

  const parts = Array.isArray(assetDef.parts) ? assetDef.parts : [];
  let cx = 0, cy = 0, cz = 0;
  let validCount = 0;
  for (const p of parts) {
    if (Array.isArray(p.pos) && p.pos.length === 3) {
      cx += Number(p.pos[0]) || 0;
      cy += Number(p.pos[1]) || 0;
      cz += Number(p.pos[2]) || 0;
      validCount++;
    }
  }
  if (validCount > 0) { cx /= validCount; cy /= validCount; cz /= validCount; }

  for (let i = 0; i < parts.length; i++) {
    const item = parts[i];
    if (item.kind === 'light') continue;
    const child = new pc.Entity(item.name || `Part_${i + 1}`);
    const renderType = item.kind === 'coin' ? 'cylinder' : (item.kind || 'box');
    const color = item.color || '#c8ff3d';
    const mat = makePbrMaterial(
      color,
      item.metalness ?? 0.25,
      item.gloss ?? 0.7,
      item.kind === 'coin' ? '#3a2a00' : '#000000'
    );
    child.addComponent('render', {
      type: renderType,
      material: mat,
      castShadows: true,
      receiveShadows: true
    });
    const px = (Array.isArray(item.pos) ? Number(item.pos[0]) || 0 : 0) - cx;
    const py = (Array.isArray(item.pos) ? Number(item.pos[1]) || 0 : 0) - cy;
    const pz = (Array.isArray(item.pos) ? Number(item.pos[2]) || 0 : 0) - cz;
    child.setLocalPosition(px, py, pz);
    if (Array.isArray(item.rot) && item.rot.length === 3) {
      child.setLocalEulerAngles(item.rot[0], item.rot[1], item.rot[2]);
    }
    if (Array.isArray(item.scale) && item.scale.length === 3) {
      child.setLocalScale(item.scale[0], item.scale[1], item.scale[2]);
    }
    parent.addChild(child);
  }

  parent.setLocalPosition(worldPos[0], worldPos[1], worldPos[2]);
  return registerEntity(parent, {
    kind: 'asset',
    color: parts[0]?.color || '#c8ff3d',
    metalness: parts[0]?.metalness ?? 0.25,
    gloss: parts[0]?.gloss ?? 0.7,
    behavior: parts[0]?.behavior || 'none',
    speed: parts[0]?.speed ?? 4.5,
  });
}

// Track available .GLB assets so Bonsai 2 can assign them to entities (e.g. Player)
let availableGlbAssets = [];

async function attachGlbToEntity(targetEnt, glbUrlOrName) {
  if (!targetEnt || !glbUrlOrName) return null;
  const resolved = resolveGlbAsset(glbUrlOrName);
  const url = resolved.url;
  const safeName = String(resolved.name || 'Model3D').replace(/\.(glb|gltf)$/i, '');
  const st = document.getElementById('ai-status');
  if (st) st.textContent = `📦 Caricamento modello "${safeName}" su ${targetEnt.name}...`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} per ${safeName} (${url})`);
  const blob = await res.blob();
  if (!blob.size) throw new Error(`File .GLB vuoto per ${safeName}`);
  const blobUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const asset = new pc.Asset(`${safeName}_${Date.now()}`, 'container', {
      url: blobUrl,
      filename: `${safeName}.glb`,
    });
    app.assets.add(asset);
    asset.once('load', (loaded) => {
      try { URL.revokeObjectURL(blobUrl); } catch {}
      // Remove previous attached GLB child if any
      if (targetEnt.__glbChild) {
        try { targetEnt.__glbChild.destroy(); } catch {}
        targetEnt.__glbChild = null;
      }
      // Hide primitive capsule/box mesh on the parent while keeping its Player behavior & transform
      if (targetEnt.render) targetEnt.render.enabled = false;
      const modelEnt = loaded.resource.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
      modelEnt.name = `${safeName}_Mesh`;
      const aabb = new pc.BoundingBox();
      let hasMesh = false;
      modelEnt.findComponents('render').forEach((r) => {
        r.meshInstances.forEach((mi) => {
          if (!hasMesh) { aabb.copy(mi.aabb); hasMesh = true; }
          else aabb.add(mi.aabb);
        });
      });
      if (hasMesh) {
        const maxDim = Math.max(aabb.halfExtents.x, aabb.halfExtents.y, aabb.halfExtents.z, 0.001) * 2;
        if (maxDim > 3.5 || maxDim < 0.3) {
          const s = 2.0 / maxDim;
          modelEnt.setLocalScale(s, s, s);
        }
      }
      modelEnt.setLocalPosition(0, 0, 0);
      targetEnt.addChild(modelEnt);
      targetEnt.__glbChild = modelEnt;
      targetEnt.__wox.glbUrl = url;
      resolve(targetEnt);
    });
    asset.once('error', (err) => {
      try { URL.revokeObjectURL(blobUrl); } catch {}
      reject(err);
    });
    app.assets.load(asset);
  });
}

// Load Wox 3D Library (.glb models from /api/history & /api/games/dataset)
async function loadWoxAssets() {
  const strip = document.getElementById('asset-strip');
  strip.innerHTML = '';
  availableGlbAssets = [];

  // Custom AI-generated assets first
  for (const a of customAssets) {
    const card = document.createElement('div');
    card.className = 'asset-card';
    card.style.borderColor = 'rgba(200,255,61,0.45)';
    card.innerHTML = `<div class="ic">${a.icon || '🧩'}</div><div class="nm" title="${a.name}">${a.name}</div><div class="sub" style="color:var(--pc-accent);">Asset AI (${(a.parts || []).length} parti)</div>`;
    card.onclick = () => selectEntity(spawnCompoundAsset(a, [0, 1.2, 0]));
    addAssetDeleteBtn(card, a.name, () => deleteCustomAsset(a.name));
    strip.appendChild(card);
  }
  const presets = [
    { name: 'Player Capsule', sub: 'WASD + Jump', ic: '🏃', action: () => selectEntity(addPrimitive('capsule')) },
    { name: 'Gold Coin', sub: '+10 Score', ic: '🪙', action: () => selectEntity(addPrimitive('coin')) },
    { name: 'Patrol Block', sub: 'Ostacolo mobile', ic: '🧱', action: () => selectEntity(addPrimitive('box', { color: '#ef4444', behavior: 'patrol' })) },
    { name: 'Floating Orb', sub: 'Hover VFX', ic: '🔮', action: () => selectEntity(addPrimitive('sphere', { color: '#a855f7', behavior: 'hover' })) }
  ];
  for (const p of presets) {
    const pKey = `preset:${p.name}`;
    if (hiddenAssetKeys.has(pKey)) continue;
    const card = document.createElement('div');
    card.className = 'asset-card';
    card.innerHTML = `<div class="ic">${p.ic}</div><div class="nm">${p.name}</div><div class="sub">${p.sub}</div>`;
    card.onclick = p.action;
    addAssetDeleteBtn(card, p.name, () => hideAssetKey(pKey));
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
            const nm = o.name || e.app || 'Modello 3D';
            availableGlbAssets.push({ name: nm, url: o.url });
            const hKey = `glb:${o.url}`;
            if (hiddenAssetKeys.has(hKey)) continue;
            const card = document.createElement('div');
            card.className = 'asset-card';
            card.innerHTML = `<div class="ic">📦</div><div class="nm" title="${nm}">${nm}</div><div class="sub">Wox 3D .GLB</div>`;
            card.onclick = () => loadGlbEntity(o.url, nm, [0, 0.5, 0]);
            addAssetDeleteBtn(card, nm, () => hideAssetKey(hKey));
            strip.appendChild(card);
          }
        }
      }
    }
  } catch { /* offline */ }

  // Show only Open 3D Dataset models that are already downloaded & ready to load
  try {
    const dsRes = await fetch('/api/games/dataset');
    if (dsRes.ok) {
      const ds = await dsRes.json();
      const ready = (ds.assets || []).filter((item) => item && item.downloaded);
      for (const item of ready.slice(0, 30)) {
        const nm = item.name || item.id;
        const dsUrl = `/api/games/dataset/${encodeURIComponent(item.id)}/file`;
        availableGlbAssets.push({ name: nm, url: dsUrl });
        const dKey = `ds:${item.id}`;
        if (hiddenAssetKeys.has(dKey)) continue;
        const card = document.createElement('div');
        card.className = 'asset-card';
        card.innerHTML = `<div class="ic">🟢</div><div class="nm" title="${nm}">${nm}</div><div class="sub">${item.source || 'Open 3D'}</div>`;
        card.onclick = () => {
          const st = document.getElementById('ai-status');
          if (st) st.textContent = `📦 Inserimento "${nm}" in WOX Engine...`;
          loadGlbEntity(dsUrl, nm, [0, 0.5, 0]);
        };
        addAssetDeleteBtn(card, nm, () => hideAssetKey(dKey));
        strip.appendChild(card);
      }
    }
  } catch { /* ignore */ }
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

// ============================================================
// AI GAME GENERATOR (Bonsai 2) -> PlayCanvas 3D Editor Bridge
// ============================================================
const dockTabs = document.querySelectorAll('.dock-tab');
const aiDockBody = document.getElementById('ai-dock-body');
const assetStrip = document.getElementById('asset-strip');
const btnRefreshAssets = document.getElementById('btn-refresh-assets');

dockTabs.forEach((tab) => {
  tab.onclick = () => {
    dockTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const isAi = tab.dataset.dock === 'ai';
    aiDockBody.style.display = isAi ? 'grid' : 'none';
    assetStrip.style.display = isAi ? 'none' : 'flex';
    btnRefreshAssets.style.display = isAi ? 'none' : 'inline-flex';
  };
});

const bonsaiPill = document.getElementById('bonsai-pill');
const btnStartBonsai = document.getElementById('btn-start-bonsai');
const aiPromptEl = document.getElementById('ai-prompt');
const aiCodeEl = document.getElementById('ai-code');
const aiStatusEl = document.getElementById('ai-status');
const aiClearEl = document.getElementById('ai-clear-scene');
const btnAiGenerate = document.getElementById('btn-ai-generate');
const btnAiApplyCode = document.getElementById('btn-ai-apply-code');

async function checkBonsaiStatus() {
  try {
    const res = await fetch('/api/games/status');
    if (!res.ok) throw new Error('offline');
    const data = await res.json();
    const ok = Boolean(data?.bonsai?.online || data?.bonsaiOnline);
    bonsaiPill.textContent = ok ? '🟢 Bonsai 2 attivo' : '🔴 Bonsai 2 spento';
    bonsaiPill.style.color = ok ? '#c8ff3d' : '#ff8533';
    btnStartBonsai.style.display = ok ? 'none' : 'inline-flex';
  } catch {
    bonsaiPill.textContent = '⚪ Bonsai 2: stato non disponibile';
  }
}

btnStartBonsai.onclick = async () => {
  btnStartBonsai.disabled = true;
  btnStartBonsai.textContent = '⏳ Avvio...';
  aiStatusEl.textContent = 'Avvio server Bonsai 2 in corso...';
  try {
    const res = await fetch('/api/games/bonsai/start', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    aiStatusEl.textContent = data.ok ? '✅ Bonsai 2 avviato e pronto!' : `⚠ ${data.message || 'Errore avvio Bonsai 2'}`;
  } catch (err) {
    aiStatusEl.textContent = `❌ Errore avvio Bonsai 2: ${err.message || err}`;
  } finally {
    btnStartBonsai.disabled = false;
    btnStartBonsai.textContent = '⚡ Avvia Bonsai 2';
    checkBonsaiStatus();
  }
};

document.querySelectorAll('.ai-chip').forEach((chip) => {
  chip.onclick = () => {
    aiPromptEl.value = chip.dataset.preset || '';
    aiPromptEl.focus();
  };
});

const btnApiHelp = document.getElementById('btn-api-help');
const apiHelpBox = document.getElementById('api-help-box');
if (btnApiHelp && apiHelpBox) {
  btnApiHelp.onclick = () => apiHelpBox.classList.toggle('open');
}

btnAiApplyCode.onclick = () => {
  const res = compileCustomScript(aiCodeEl.value);
  if (!res.ok) {
    aiStatusEl.textContent = `❌ Errore sintassi JS: ${res.error}`;
    return;
  }
  aiStatusEl.textContent = '✅ Codice WOX Engine compilato! Avvio Play Mode...';
  if (!isPlaying) playBtn.click();
};

btnAiGenerate.onclick = async () => {
  const prompt = aiPromptEl.value.trim();
  if (!prompt) {
    aiStatusEl.textContent = '⚠ Scrivi un prompt per Bonsai 2 prima di generare.';
    aiPromptEl.focus();
    return;
  }
  if (isPlaying) playBtn.click();

  btnAiGenerate.disabled = true;
  btnAiGenerate.textContent = '⏳ Bonsai 2 sta programmando...';
  aiStatusEl.textContent = '🤖 Bonsai 2 sta programmando WOX Engine...';

  if (availableGlbAssets.length === 0) {
    try { await loadWoxAssets(); } catch {}
  }

  const prevScript = aiCodeEl.value || '';
  const sceneState = sceneEntities.map((e) => ({
    name: e.name,
    kind: e.__wox.kind,
    pos: [Number(e.getLocalPosition().x.toFixed(2)), Number(e.getLocalPosition().y.toFixed(2)), Number(e.getLocalPosition().z.toFixed(2))],
    rot: [Number(e.getLocalEulerAngles().x.toFixed(1)), Number(e.getLocalEulerAngles().y.toFixed(1)), Number(e.getLocalEulerAngles().z.toFixed(1))],
    scale: [Number(e.getLocalScale().x.toFixed(2)), Number(e.getLocalScale().y.toFixed(2)), Number(e.getLocalScale().z.toFixed(2))],
    color: e.__wox.color,
    emissive: e.__wox.emissive,
    behavior: e.__wox.behavior,
    speed: e.__wox.speed,
    solid: e.__wox.solid,
    tag: e.__wox.tag || undefined,
    glbUrl: e.__wox.glbUrl || undefined,
    hasScript: Boolean(e.__wox.script && e.__wox.script.trim()),
  }));

  try {
    aiCodeEl.value = '// Connessione a Bonsai 2 in corso...\n';
    const res = await fetch('/api/playcanvas/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        sceneState,
        sceneSettings: { ...sceneSettings },
        selectedEntity: selectedEntity ? selectedEntity.name : undefined,
        currentScript: prevScript,
        clearScene: aiClearEl.checked,
        assetSource: document.getElementById('ai-asset-source')?.value || 'library',
        availableAssets: availableGlbAssets,
        customAssets: customAssets.map(a => ({ name: a.name, icon: a.icon })),
        stream: true,
      }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData?.error || `HTTP ${res.status}`);
    }

    let plan = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/event-stream') && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep = buf.indexOf('\n\n');
        while (sep !== -1) {
          const block = buf.slice(0, sep).trim();
          buf = buf.slice(sep + 2);
          if (block.startsWith('data:')) {
            const payload = block.slice(5).trim();
            if (payload) {
              try {
                const evt = JSON.parse(payload);
                if (evt.type === 'chunk') {
                  if (evt.content) {
                    aiCodeEl.value = evt.content;
                    aiStatusEl.textContent = `⚡ Bonsai 2 sta scrivendo codice WOX Engine... (${evt.chunks} token)`;
                  } else if (evt.reasoning) {
                    aiCodeEl.value = `// 🧠 Ragionamento Bonsai 2...\n${evt.reasoning}`;
                    aiStatusEl.textContent = `🧠 Bonsai 2 sta progettando... (${evt.chunks} token)`;
                  }
                  aiCodeEl.scrollTop = aiCodeEl.scrollHeight;
                } else if (evt.type === 'done') {
                  plan = evt.plan;
                } else if (evt.type === 'error') {
                  throw new Error(evt.error || 'Errore Bonsai 2');
                }
              } catch (e) {
                if (e && e.message && !String(e.message).includes('JSON')) throw e;
              }
            }
          }
          sep = buf.indexOf('\n\n');
        }
      }
    } else {
      plan = await res.json();
    }
    if (!plan) throw new Error('Nessuna risposta ricevuta da Bonsai 2.');

    if (plan.clearScene) {
      wox.entities.clear();
    }

    // Apply scene / environment / physics / camera settings if returned
    if (plan.sceneSettings && typeof plan.sceneSettings === 'object') {
      applySceneSettings(plan.sceneSettings);
    }

    // Remove entities requested by AI
    if (Array.isArray(plan.removeEntities)) {
      for (const rmName of plan.removeEntities) {
        wox.entities.destroy(rmName);
      }
    }

    let firstCreated = null;
    if (plan.asAsset && plan.asAsset.name && Array.isArray(plan.entities) && plan.entities.length > 0) {
      const assetDef = {
        name: plan.asAsset.name,
        icon: plan.asAsset.icon || '🧩',
        parts: plan.entities,
      };
      saveCustomAsset(assetDef);
      firstCreated = spawnCompoundAsset(assetDef, [0, 1.4, 0]);
      loadWoxAssets();
    } else {
      for (const item of (plan.entities || [])) {
        // If not clearing scene and an entity with the same name already exists, update it in place (no duplicates!)
        const existing = !plan.clearScene
          ? sceneEntities.find((e) => e.name.toLowerCase() === String(item.name || '').toLowerCase())
          : null;

        let ent = existing;
        let newlyLoadedGlb = false;
        if (!ent) {
          if (item.kind === 'glb' && item.glbUrl) {
            ent = await loadGlbEntity(item.glbUrl, item.name || 'Model3D', item.pos || [0, 0.5, 0]);
            newlyLoadedGlb = true;
            if (item.behavior) ent.__wox.behavior = item.behavior;
            if (typeof item.speed === 'number') ent.__wox.speed = item.speed;
            if (typeof item.solid === 'boolean') ent.__wox.solid = item.solid;
            if (typeof item.tag === 'string') ent.__wox.tag = item.tag;
            if (typeof item.script === 'string') ent.__wox.script = item.script;
          } else {
            ent = addPrimitive(item.kind || 'box', {
              name: item.name,
              pos: item.pos,
              color: item.color,
              emissive: item.emissive,
              metalness: item.metalness,
              gloss: item.gloss,
              behavior: item.behavior,
              followTarget: item.followTarget,
              speed: item.speed,
              solid: item.solid,
              tag: item.tag,
              script: item.script,
            });
          }
        } else {
          if (item.behavior) ent.__wox.behavior = item.behavior;
          if (typeof item.followTarget === 'string') ent.__wox.followTarget = item.followTarget;
          if (typeof item.speed === 'number') ent.__wox.speed = item.speed;
          if (typeof item.solid === 'boolean') ent.__wox.solid = item.solid;
          if (typeof item.tag === 'string') ent.__wox.tag = item.tag;
          if (typeof item.script === 'string') ent.__wox.script = item.script;
          if (item.color) ent.__wox.color = item.color;
          if (item.emissive) ent.__wox.emissive = item.emissive;
          if (typeof item.metalness === 'number') ent.__wox.metalness = item.metalness;
          if (typeof item.gloss === 'number') ent.__wox.gloss = item.gloss;
        }

        if (Array.isArray(item.pos) && item.pos.length === 3) {
          ent.setLocalPosition(item.pos[0], item.pos[1], item.pos[2]);
        }
        if (Array.isArray(item.rot) && item.rot.length === 3) {
          ent.setLocalEulerAngles(item.rot[0], item.rot[1], item.rot[2]);
        }
        if (Array.isArray(item.scale) && item.scale.length === 3) {
          ent.setLocalScale(item.scale[0], item.scale[1], item.scale[2]);
        }
        if (item.glbUrl && !newlyLoadedGlb) {
          await attachGlbToEntity(ent, item.glbUrl);
        } else if (ent.render && !newlyLoadedGlb && !ent.__glbChild) {
          ent.render.material = makePbrMaterial(
            ent.__wox.color,
            ent.__wox.metalness,
            ent.__wox.gloss,
            ent.__wox.emissive || (item.kind === 'coin' ? '#3a2a00' : '#000000')
          );
        }
        if (!firstCreated) firstCreated = ent;
      }
    }

    // Execute one-shot procedural editorScript immediately in the Editor (supports await!)
    if (typeof plan.editorScript === 'string' && plan.editorScript.trim()) {
      try {
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        const edFn = new AsyncFunction('wox', 'pc', 'app', plan.editorScript);
        await edFn(wox, pc, app);
      } catch (edErr) {
        aiStatusEl.textContent = `⚠ Errore editorScript: ${edErr.message || edErr}`;
      }
    }

    if (typeof plan.script === 'string' && plan.script.trim()) {
      aiCodeEl.value = plan.script.trim();
      const c = compileCustomScript(aiCodeEl.value);
      if (!c.ok) {
        aiStatusEl.textContent = `⚠ Scena aggiornata, ma errore script: ${c.error}`;
      } else {
        aiStatusEl.textContent = `✅ ${plan.summary} (${sceneEntities.length} entità + codice WOX Engine pronti!)`;
      }
    } else if (prevScript.trim() && !plan.clearScene && !prevScript.trim().startsWith('// ✅')) {
      // Preserve existing Play Mode script when AI only changed scene/entities/editorScript
      aiCodeEl.value = prevScript;
      compileCustomScript(prevScript);
      aiStatusEl.textContent = `✅ ${plan.summary} (${sceneEntities.length} entità in scena)`;
    } else {
      aiCodeEl.value = `// ✅ ${plan.summary}\n// Oggetti in scena: ${sceneEntities.length}. Usa l'API wox.* o chiedi a Bonsai 2 di aggiungere logica Play Mode.`;
      compileCustomScript('');
      aiStatusEl.textContent = `✅ ${plan.summary} (${sceneEntities.length} entità in WOX Engine)`;
    }

    refreshHierarchy();
    if (firstCreated) selectEntity(firstCreated);
    else renderInspector();
    checkBonsaiStatus();
  } catch (err) {
    aiStatusEl.textContent = `❌ ${err.message || err}`;
  } finally {
    btnAiGenerate.disabled = false;
    btnAiGenerate.textContent = '✨ Genera in WOX Engine';
  }
};

checkBonsaiStatus();


// ============================================================
// Draggable Panel Resizers (widen/heighten every panel)
// ============================================================
function wireResizer(id, { axis, cssVar, min, max, invert = false }) {
  const handle = document.getElementById(id);
  if (!handle) return;
  handle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.classList.add('dragging');
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    const rootStyle = getComputedStyle(document.documentElement);
    const startSize = parseFloat(rootStyle.getPropertyValue(cssVar)) || min;
    const startPos = axis === 'x' ? e.clientX : e.clientY;

    const onMove = (ev) => {
      const curPos = axis === 'x' ? ev.clientX : ev.clientY;
      const delta = (curPos - startPos) * (invert ? -1 : 1);
      const next = Math.max(min, Math.min(max, startSize + delta));
      document.documentElement.style.setProperty(cssVar, `${Math.round(next)}px`);
    };

    const onUp = () => {
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

wireResizer('resizer-ai', { axis: 'x', cssVar: '--col-ai', min: 220, max: 560 });
wireResizer('resizer-hier', { axis: 'x', cssVar: '--col-hier', min: 150, max: 420 });
wireResizer('resizer-insp', { axis: 'x', cssVar: '--col-insp', min: 200, max: 480, invert: true });
wireResizer('resizer-assets', { axis: 'y', cssVar: '--row-assets', min: 90, max: 380, invert: true });

// Show / Hide AI Generator (Bonsai 2) column
const appGridEl = document.getElementById('app');
const btnHideAiCol = document.getElementById('btn-toggle-ai-col');
const btnShowAiCol = document.getElementById('btn-show-ai-col');

function setAiColumnVisible(visible) {
  if (!appGridEl) return;
  appGridEl.classList.toggle('ai-hidden', !visible);
  if (btnShowAiCol) btnShowAiCol.style.display = visible ? 'none' : 'inline-flex';
}
if (btnHideAiCol) btnHideAiCol.onclick = () => setAiColumnVisible(false);
if (btnShowAiCol) btnShowAiCol.onclick = () => setAiColumnVisible(true);
