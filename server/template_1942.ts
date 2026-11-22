// Template ufficiale per il genere "Shoot'em up 3D (stile 1942)":
// - Generatore Blender 5.1 dello scenario Pacifico 3D a blocchi quadrati (diorama ad alto contrasto)
// - Motore di gioco 1942 con Aritmetica a Punto Fisso Q8.8, Coordinazione Polare, Integrazione di Eulero,
//   Cinematica Diretta a Tratti, Ondate con Bonus Ondata Perfetta e Difficoltà Arcade.

export function build1942SceneryBlenderScript(outGlbPath: string): string {
  const safePath = outGlbPath.replace(/\\/g, "/");
  return `import bpy
import random

bpy.ops.wm.read_factory_settings(use_empty=True)
random.seed(1942)

def make_mat(name, color, metallic=0.05, roughness=0.72, emission=0.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission > 0 and "Emission Strength" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = (color[0], color[1], color[2], 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission
    return mat

mat_ocean = make_mat("OceanDeep", (0.02, 0.19, 0.46), 0.12, 0.18)
mat_shallow = make_mat("OceanTurquoise", (0.04, 0.56, 0.72), 0.08, 0.22)
mat_foam = make_mat("SeaFoam", (0.86, 0.96, 1.0), 0.0, 0.5, 0.25)
mat_sand = make_mat("GoldenSand", (0.92, 0.80, 0.48), 0.0, 0.85)
mat_cliff = make_mat("CliffEarth", (0.42, 0.28, 0.16), 0.0, 0.9)
mat_grass1 = make_mat("EmeraldGrass", (0.12, 0.58, 0.18), 0.0, 0.78)
mat_grass2 = make_mat("LimeGrass", (0.22, 0.68, 0.20), 0.0, 0.78)
mat_forest = make_mat("JungleCanopy", (0.05, 0.36, 0.11), 0.0, 0.82)
mat_trunk = make_mat("WoodTrunk", (0.34, 0.20, 0.10), 0.0, 0.9)
mat_rock = make_mat("MesaRock", (0.36, 0.34, 0.32), 0.05, 0.88)
mat_runway = make_mat("RunwayAsphalt", (0.16, 0.18, 0.22), 0.15, 0.75)
mat_stripe = make_mat("StripeWhite", (0.96, 0.96, 0.96), 0.0, 0.5)
mat_light_amber = make_mat("RunwayAmber", (1.0, 0.75, 0.15), 0.1, 0.3, 2.2)
mat_light_red = make_mat("BeaconRed", (1.0, 0.15, 0.15), 0.1, 0.3, 2.5)
mat_steel = make_mat("CarrierSteel", (0.34, 0.40, 0.46), 0.55, 0.40)
mat_hangar = make_mat("HangarRoof", (0.58, 0.60, 0.54), 0.3, 0.55)
mat_bridge = make_mat("BridgeSteel", (0.52, 0.24, 0.16), 0.4, 0.5)

bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0, 0, 0))
ocean = bpy.context.active_object
ocean.scale = (50.0, 56.0, 1.0)
ocean.data.materials.append(mat_ocean)

def add_box(x, y, z, sx, sy, sz, mat):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(x, y, z))
    b = bpy.context.active_object
    b.scale = (sx, sy, sz)
    b.data.materials.append(mat)
    return b

def build_blocky_landmass(cx, cy, w, h, has_lake=False, has_airbase=False):
    add_box(cx, cy, 0.04, w + 4.4, h + 4.4, 0.08, mat_shallow)
    add_box(cx, cy, 0.09, w + 2.4, h + 2.4, 0.08, mat_foam)
    add_box(cx, cy, 0.17, w + 1.6, h + 1.6, 0.22, mat_sand)
    cell = 3.2
    cols = max(3, int(w / cell))
    rows = max(3, int(h / cell))
    start_x = cx - (cols * cell) * 0.5 + cell * 0.5
    start_y = cy - (rows * cell) * 0.5 + cell * 0.5
    for ix in range(cols):
        for iy in range(rows):
            if (ix in (0, cols - 1)) and (iy in (0, rows - 1)) and random.random() < 0.65:
                continue
            bx = start_x + ix * cell
            by = start_y + iy * cell
            if has_lake and (cols // 2 - 1 <= ix <= cols // 2) and (rows // 2 - 1 <= iy <= rows // 2):
                add_box(bx, by, 0.44, cell * 0.98, cell * 0.98, 0.16, mat_shallow)
                continue
            bh = 0.58 + (0.24 if (ix + iy) % 2 == 0 else 0.0)
            add_box(bx, by, bh * 0.35, cell * 0.96, cell * 0.96, bh * 0.7, mat_cliff)
            gmat = mat_grass1 if (ix + iy) % 2 == 0 else mat_grass2
            add_box(bx, by, bh * 0.82, cell * 0.96, cell * 0.96, bh * 0.36, gmat)
            if has_airbase and abs(bx - cx) < 3.6:
                continue
            roll = random.random()
            if roll < 0.46:
                tw = random.uniform(1.35, 2.05)
                th = random.uniform(0.75, 1.25)
                add_box(bx, by, bh + 0.3, 0.45, 0.45, 0.6, mat_trunk)
                add_box(bx, by, bh + 0.55 + th * 0.5, tw, tw, th, mat_forest)
            elif roll < 0.56:
                add_box(bx, by, bh + 0.5, 2.4, 2.4, 1.0, mat_rock)
                add_box(bx, by, bh + 1.25, 1.4, 1.4, 0.55, mat_grass2)
            elif roll < 0.61:
                add_box(bx, by, bh + 0.35, 1.6, 1.6, 0.7, mat_steel)
                add_box(bx, by, bh + 0.8, 0.35, 0.35, 0.25, mat_light_red)
    if has_airbase:
        add_box(cx, cy, 0.76, 3.0, h * 0.84, 0.14, mat_runway)
        for s in range(-4, 5):
            add_box(cx, cy + s * 1.6, 0.85, 0.28, 0.85, 0.04, mat_stripe)
            add_box(cx - 1.65, cy + s * 1.6, 0.86, 0.22, 0.22, 0.14, mat_light_amber)
            add_box(cx + 1.65, cy + s * 1.6, 0.86, 0.22, 0.22, 0.14, mat_light_amber)
        for hy in (-3.6, 2.6):
            add_box(cx + 3.2, cy + hy, 1.15, 2.3, 3.2, 1.0, mat_hangar)
        add_box(cx - 3.2, cy + 1.5, 1.4, 1.3, 1.3, 1.5, mat_steel)
        add_box(cx - 3.2, cy + 1.5, 2.35, 0.45, 0.45, 0.35, mat_light_red)

def build_carrier(cx, cy):
    add_box(cx, cy + 8.5, 0.05, 3.2, 6.5, 0.06, mat_foam)
    add_box(cx, cy, 0.35, 3.6, 12.0, 0.7, mat_steel)
    add_box(cx, cy, 0.80, 4.2, 12.8, 0.20, mat_runway)
    for s in range(-4, 5):
        add_box(cx, cy + s * 1.25, 0.92, 0.24, 0.65, 0.03, mat_stripe)
    add_box(cx + 1.6, cy - 0.8, 1.55, 0.9, 2.4, 1.3, mat_steel)
    add_box(cx + 1.6, cy - 0.8, 2.35, 0.32, 0.32, 0.28, mat_light_red)

build_blocky_landmass(-12.0, 11.0, 22.0, 24.0, has_lake=True, has_airbase=False)
build_blocky_landmass(13.0, -10.0, 21.0, 24.0, has_lake=False, has_airbase=True)
build_blocky_landmass(-15.5, -21.0, 15.0, 13.0, has_lake=False, has_airbase=False)
add_box(0.5, -1.5, 0.72, 11.0, 2.2, 0.32, mat_bridge)
add_box(0.5, -1.5, 0.92, 10.6, 1.5, 0.10, mat_runway)
build_carrier(8.0, 17.5)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=${JSON.stringify(safePath)}, export_format='GLB')
`;
}

export function build1942GameJs(files: {
  playerFile: string;
  enemyFile: string;
  bomberFile: string;
  bossFile: string;
  powerupFile: string;
}): string {
  return `import { WoxGameEngine, THREE } from "./engine.js";

const engine = new WoxGameEngine({
  skyColor: "#0a2a4a",
  fogColor: "#0a2a4a",
  fogNear: 35,
  fogFar: 95,
  groundColor: "#0d4b7a",
  groundSize: 160,
  cameraMode: "top-down-vertical",
});
engine.camera.position.set(0, 38, 8);
engine.camera.lookAt(0, 10, -2);
if (engine.grid) engine.grid.visible = false;

const BOUNDS_X = 13, BOUNDS_Z_MIN = -14, BOUNDS_Z_MAX = 11, FLIGHT_Y = 10.5, TILE_LEN = 56;

// --- ARITMETICA A PUNTO FISSO (Q8.8) ---
const FX_SHIFT = 8, FX_ONE = 1 << FX_SHIFT;
const toFx = (v) => (v * FX_ONE) | 0;
const fromFx = (fx) => fx / FX_ONE;
const fxMul = (a, b) => ((a * b) >> FX_SHIFT) | 0;
const SIN_LUT = new Int32Array(256), COS_LUT = new Int32Array(256);
for (let i = 0; i < 256; i++) {
  const rad = (i / 256) * Math.PI * 2;
  SIN_LUT[i] = toFx(Math.sin(rad));
  COS_LUT[i] = toFx(Math.cos(rad));
}
const fxSin = (a) => SIN_LUT[a & 255];
const fxCos = (a) => COS_LUT[a & 255];

let player = null;
const terrainTileProtos = [];
let fireCooldown = 0, weaponLevel = 1, loopTimer = 0, loopCooldown = 0, waveCount = 0, spawnTimer = 0;
const waveTracker = new Map();
const playerBullets = [], enemyBullets = [], enemies = [], powerups = [], scenery = [];
const bulletGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.1, 8); bulletGeo.rotateX(Math.PI / 2);
const playerBulletMat = new THREE.MeshBasicMaterial({ color: 0xe8ff5a });
const enemyBulletGeo = new THREE.SphereGeometry(0.28, 8, 8);
const enemyBulletMat = new THREE.MeshBasicMaterial({ color: 0xff4d4d });

async function init() {
  engine.setStatus("Caricamento caccia e scenario 3D Blender...");
  await Promise.all([
    engine.loadModel("player", "./assets/${files.playerFile}", { targetHeight: 2.2, fallbackColor: 0x38bdf8 }),
    engine.loadModel("enemy", "./assets/${files.enemyFile}", { targetHeight: 1.9, fallbackColor: 0xef4444 }),
    engine.loadModel("bomber", "./assets/${files.bomberFile}", { targetHeight: 3.0, fallbackColor: 0xf97316 }),
    engine.loadModel("boss", "./assets/${files.bossFile}", { targetHeight: 4.5, fallbackColor: 0xdc2626 }),
    engine.loadModel("powerup", "./assets/${files.powerupFile}", { targetHeight: 1.3, fallbackColor: 0xe8ff5a }),
    ...["./assets/terrain_tile_0.glb", "./assets/terrain_tile_1.glb", "./assets/terrain_tile_2.glb", "./assets/environment_pacific_tile.glb"].map((url, idx) =>
      engine.loader.loadAsync(url).then((gltf) => {
        gltf.scene.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = true; } });
        terrainTileProtos[idx] = gltf.scene;
      }).catch(() => null)
    ),
  ]);
  const ctrlEl = document.getElementById("hud-controls");
  if (ctrlEl) ctrlEl.textContent = "WASD / Frecce: Vola · SPAZIO: Spara · SHIFT: Loop Acrobatico (Invulnerabile)";
  resetGame();
  engine.setStatus("Pronto al decollo");
  document.getElementById("overlay-btn").onclick = () => { resetGame(); engine.showOverlay("playing"); engine.setStatus("Ondata 1"); };

  engine.start((dt) => {
    if (!player) return;
    for (const s of scenery) { s.position.z += 8.5 * dt; if (s.position.z >= TILE_LEN) s.position.z -= TILE_LEN * scenery.length; }
    const axis = engine.input.getAxis();
    player.position.x = THREE.MathUtils.clamp(player.position.x + axis.x * 17 * dt, -BOUNDS_X, BOUNDS_X);
    player.position.z = THREE.MathUtils.clamp(player.position.z + axis.z * 17 * dt, BOUNDS_Z_MIN, BOUNDS_Z_MAX);
    if (loopCooldown > 0) loopCooldown -= dt;
    if ((engine.input.consume("ShiftLeft") || engine.input.consume("ShiftRight")) && loopCooldown <= 0) { loopTimer = 0.85; loopCooldown = 3.5; engine.sfx.jump(); }
    if (loopTimer > 0) { loopTimer -= dt; const p = 1 - Math.max(0, loopTimer / 0.85); player.rotation.z = p * Math.PI * 2; player.position.y = FLIGHT_Y + Math.sin(p * Math.PI) * 2.8; }
    else { player.position.y = FLIGHT_Y; player.rotation.z += (-axis.x * 0.55 - player.rotation.z) * Math.min(1, dt * 10); }
    player.rotation.y = Math.PI;

    if (fireCooldown > 0) fireCooldown -= dt;
    if (engine.input.isDown("Space") && fireCooldown <= 0) {
      fireCooldown = weaponLevel >= 3 ? 0.1 : 0.14;
      const offs = weaponLevel === 1 ? [0] : weaponLevel === 2 ? [-0.65, 0.65] : [-0.9, 0, 0.9];
      for (const ox of offs) { const m = new THREE.Mesh(bulletGeo, playerBulletMat); m.position.set(player.position.x + ox, FLIGHT_Y, player.position.z - 1.3); engine.scene.add(m); playerBullets.push({ mesh: m, vel: new THREE.Vector3(ox * 1.4, 0, -36) }); }
      engine.sfx.shoot();
    }
    for (let i = playerBullets.length - 1; i >= 0; i--) { const b = playerBullets[i]; b.mesh.position.addScaledVector(b.vel, dt); if (b.mesh.position.z < -26) { engine.scene.remove(b.mesh); playerBullets.splice(i, 1); } }

    spawnTimer -= dt;
    if (spawnTimer <= 0 && enemies.length < 7) { waveCount++; spawnTimer = Math.max(1.4, 2.6 - waveCount * 0.04); spawnWave(waveCount); engine.setStatus(\`Ondata \${waveCount} · Arma Lv.\${weaponLevel}\`); }

    const dtFx = toFx(dt);
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i]; e.age += dt;
      const prevX = fromFx(e.xFx), prevZ = fromFx(e.zFx);
      if (e.motion === "polar") {
        e.czFx = (e.czFx + fxMul(e.vzFx, dtFx)) | 0;
        e.thetaFx = (e.thetaFx + fxMul(e.omegaFx, dtFx)) | 0;
        const angIdx = (e.thetaFx >> FX_SHIFT) & 255;
        e.xFx = (e.cxFx + fxMul(e.rFx, fxCos(angIdx))) | 0;
        e.zFx = (e.czFx + fxMul(e.rFx, fxSin(angIdx))) | 0;
      } else if (e.motion === "euler") {
        const dx = player.position.x - prevX;
        e.axFx = toFx(THREE.MathUtils.clamp(dx * 2.4, -14, 14));
        e.vxFx = THREE.MathUtils.clamp((e.vxFx + fxMul(e.axFx, dtFx)) | 0, toFx(-13), toFx(13));
        e.vzFx = THREE.MathUtils.clamp((e.vzFx + fxMul(e.azFx, dtFx)) | 0, toFx(4), toFx(17));
        e.xFx = (e.xFx + fxMul(e.vxFx, dtFx)) | 0;
        e.zFx = (e.zFx + fxMul(e.vzFx, dtFx)) | 0;
      } else {
        const seg = e.segments[e.segIdx] || e.segments[e.segments.length - 1];
        e.segTime += dt;
        if (e.segTime >= seg.dur && e.segIdx < e.segments.length - 1) { e.segTime = 0; e.segIdx++; }
        const curSeg = e.segments[e.segIdx];
        e.xFx = (e.xFx + fxMul(curSeg.vxFx, dtFx)) | 0;
        e.zFx = (e.zFx + fxMul(curSeg.vzFx, dtFx)) | 0;
      }
      const nx = fromFx(e.xFx), nz = fromFx(e.zFx);
      e.mesh.position.set(nx, FLIGHT_Y, nz);
      const vx = nx - prevX;
      e.mesh.rotation.y = Math.PI;
      e.mesh.rotation.z = THREE.MathUtils.clamp(-vx * 2.2, -0.45, 0.45);

      e.fireCd -= dt;
      if (e.fireCd <= 0 && nz > -15 && nz < 5) {
        e.fireCd = e.isBoss ? 1.0 : e.isBomber ? 1.5 : 2.1;
        if (e.isBoss) {
          for (let a = 0; a < 6; a++) { const ang = (a / 6) * Math.PI * 2 + e.age; spawnEnemyBulletDir(e.mesh.position, new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang)).multiplyScalar(12)); }
        } else if (e.isBomber) {
          for (const sp of [-0.22, 0, 0.22]) { const d = player.position.clone().sub(e.mesh.position); d.y = 0; d.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), sp).multiplyScalar(13); spawnEnemyBulletDir(e.mesh.position, d); }
        } else {
          const d = player.position.clone().sub(e.mesh.position); d.y = 0; d.normalize().multiplyScalar(13.5); spawnEnemyBulletDir(e.mesh.position, d);
        }
      }

      let dead = false;
      for (let j = playerBullets.length - 1; j >= 0; j--) {
        if (playerBullets[j].mesh.position.distanceToSquared(e.mesh.position) < e.hitRadius * e.hitRadius) {
          engine.scene.remove(playerBullets[j].mesh); playerBullets.splice(j, 1); e.hp--;
          if (e.hp <= 0) {
            engine.sfx.hit(); engine.particles.burst(e.mesh.position, 0xff5c33, e.isBoss ? 28 : 14, 9); engine.addScore(e.points);
            const wt = waveTracker.get(e.waveId);
            if (wt) { wt.killed++; if (wt.killed >= wt.total) { waveTracker.delete(e.waveId); engine.sfx.win(); engine.addScore(500); engine.particles.burst(e.mesh.position, 0xe8ff5a, 24, 10); const pm = engine.spawn("powerup", new THREE.Vector3(e.mesh.position.x, FLIGHT_Y, e.mesh.position.z)); powerups.push({ mesh: pm }); engine.setStatus(\`★ ONDATA \${e.waveId} PERFETTA! +500 BONUS\`); } }
            engine.scene.remove(e.mesh); enemies.splice(i, 1); dead = true; break;
          }
        }
      }
      if (dead) continue;
      if (loopTimer <= 0 && engine.checkSphereCollision(player, e.mesh, e.hitRadius + 0.8)) { damagePlayer(25); engine.scene.remove(e.mesh); enemies.splice(i, 1); continue; }
      if (nz > 20) { engine.scene.remove(e.mesh); enemies.splice(i, 1); }
    }

    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i]; b.mesh.position.addScaledVector(b.vel, dt);
      if (loopTimer <= 0 && b.mesh.position.distanceToSquared(player.position) < 1.8) { engine.scene.remove(b.mesh); enemyBullets.splice(i, 1); damagePlayer(15); continue; }
      if (b.mesh.position.z > 20 || b.mesh.position.z < -26 || Math.abs(b.mesh.position.x) > 22) { engine.scene.remove(b.mesh); enemyBullets.splice(i, 1); }
    }
    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i]; p.mesh.position.z += 5.5 * dt; p.mesh.rotation.y += dt * 3;
      if (engine.checkSphereCollision(player, p.mesh, 1.8)) { engine.sfx.collect(); weaponLevel = Math.min(3, weaponLevel + 1); engine.setHealth(engine.health + 25); engine.addScore(150); engine.scene.remove(p.mesh); powerups.splice(i, 1); }
      else if (p.mesh.position.z > 20) { engine.scene.remove(p.mesh); powerups.splice(i, 1); }
    }
  });
}

function spawnEnemyBulletDir(pos, vel) { const m = new THREE.Mesh(enemyBulletGeo, enemyBulletMat); m.position.copy(pos); engine.scene.add(m); enemyBullets.push({ mesh: m, vel }); }

function spawnWave(n) {
  if (n % 8 === 0) { waveTracker.set(n, { total: 1, killed: 0 }); enemies.push({ mesh: engine.spawn("boss", new THREE.Vector3(0, FLIGHT_Y, -21)), waveId: n, motion: "polar", cxFx: toFx(0), czFx: toFx(-21), vzFx: toFx(2.2), rFx: toFx(6.5), thetaFx: toFx(0), omegaFx: toFx(42), xFx: toFx(6.5), zFx: toFx(-21), hp: 22, age: 0, fireCd: 0.7, hitRadius: 2.5, points: 1500, isBoss: true, isBomber: false }); return; }
  if (n % 4 === 0) { waveTracker.set(n, { total: 2, killed: 0 }); for (const sx of [-6, 6]) enemies.push({ mesh: engine.spawn("bomber", new THREE.Vector3(sx, FLIGHT_Y, -21)), waveId: n, motion: "euler", xFx: toFx(sx), zFx: toFx(-21), vxFx: toFx(0), vzFx: toFx(5.5), axFx: toFx(0), azFx: toFx(1.6), hp: 6, age: 0, fireCd: 0.9, hitRadius: 1.8, points: 400, isBoss: false, isBomber: true }); return; }
  const pat = n % 3, count = 4;
  waveTracker.set(n, { total: count, killed: 0 });
  if (pat === 1) {
    const cx = (Math.random() - 0.5) * 10;
    for (let k = 0; k < count; k++) enemies.push({ mesh: engine.spawn("enemy", new THREE.Vector3(cx, FLIGHT_Y, -22)), waveId: n, motion: "polar", cxFx: toFx(cx), czFx: toFx(-22), vzFx: toFx(7.5), rFx: toFx(4.2), thetaFx: toFx((k * 51) & 255), omegaFx: toFx(72), xFx: toFx(cx), zFx: toFx(-22), hp: 2, age: 0, fireCd: 0.9 + k * 0.25, hitRadius: 1.35, points: 150, isBoss: false, isBomber: false });
  } else if (pat === 2) {
    for (let k = -2; k <= 2; k++) { const sx = THREE.MathUtils.clamp(k * 4.5, -BOUNDS_X, BOUNDS_X), sz = -20 - Math.abs(k) * 2.2; enemies.push({ mesh: engine.spawn("enemy", new THREE.Vector3(sx, FLIGHT_Y, sz)), waveId: n, motion: "euler", xFx: toFx(sx), zFx: toFx(sz), vxFx: toFx(-k * 1.5), vzFx: toFx(6.5), axFx: toFx(0), azFx: toFx(3.8), hp: 2, age: 0, fireCd: 0.8 + Math.abs(k) * 0.2, hitRadius: 1.35, points: 150, isBoss: false, isBomber: false }); }
  } else {
    const side = Math.random() < 0.5 ? 1 : -1;
    const segs = [{ dur: 1.1, vxFx: toFx(0), vzFx: toFx(11.5) }, { dur: 1.0, vxFx: toFx(side * 12), vzFx: toFx(4) }, { dur: 1.0, vxFx: toFx(-side * 12), vzFx: toFx(6.5) }, { dur: 3.0, vxFx: toFx(side * 3), vzFx: toFx(14.5) }];
    for (let k = 0; k < count; k++) { const sx = -side * 7 + k * 1.8 * side, sz = -20 - k * 2.4; enemies.push({ mesh: engine.spawn("enemy", new THREE.Vector3(sx, FLIGHT_Y, sz)), waveId: n, motion: "piecewise", xFx: toFx(sx), zFx: toFx(sz), segments: segs, segIdx: 0, segTime: 0, hp: 2, age: 0, fireCd: 0.7 + k * 0.2, hitRadius: 1.35, points: 150, isBoss: false, isBomber: false }); }
  }
}

function damagePlayer(dmg) { engine.sfx.hit(); engine.particles.burst(player.position, 0xff5c72, 16, 8); engine.setHealth(engine.health - dmg); if (engine.health <= 0) { engine.sfx.gameover(); engine.showOverlay("gameover", "Abbattuto!", \`Punteggio finale: \${engine.score}\`); } }
function resetGame() {
  if (player) engine.scene.remove(player);
  [playerBullets, enemyBullets, enemies, powerups, scenery].forEach((arr) => arr.splice(0).forEach((x) => engine.scene.remove(x.mesh || x)));
  waveTracker.clear(); engine.setScore(0); engine.setHealth(100); weaponLevel = 1; waveCount = 0; spawnTimer = 0.6; loopTimer = 0; loopCooldown = 0;
  player = engine.spawn("player", new THREE.Vector3(0, FLIGHT_Y, 6)); player.rotation.y = Math.PI;
  const validProtos = terrainTileProtos.slice(0, 3).filter(Boolean);
  if (validProtos.length) {
    for (let i = 0; i < validProtos.length; i++) { const t = validProtos[i].clone(true); t.position.set(0, 0.02, -i * TILE_LEN); engine.scene.add(t); scenery.push(t); }
  } else if (terrainTileProtos[3]) {
    for (let i = 0; i < 2; i++) { const t = terrainTileProtos[3].clone(true); t.position.set(0, 0.05, -i * TILE_LEN); engine.scene.add(t); scenery.push(t); }
  }
}
init();
`;
}
