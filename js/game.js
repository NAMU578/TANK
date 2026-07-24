// game.js — 탱크 클래시 3D 메인 로직 (대전 + 협동, 고퀄 렌더링)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { Assets } from './assets.js';
import { createTankModel, createEnemyModel } from './tankmodel.js';

// ===== 상수 =====
const MAX_HP = 100, ARENA = 60, TANK_SPEED = 14, TURN_SPEED = 2.4;
const BULLET_SPEED = 55, BULLET_DMG = 18, RELOAD_MS = 900, HIT_RADIUS = 2.8;
const VERSUS_WIN_SCORE = 10;   // 대전: 10점 선취승

// ===== 협동 업그레이드(증강) 상점 정의 =====
// 각 웨이브 클리어 시 포인트로 구매. cost는 coopScore에서 차감.
export const UPGRADES = {
  dmg:    { name: '화력 강화',   desc: '포탄 데미지 +6',        icon: '💥', cost: 150 },
  reload: { name: '속사 장전',   desc: '재장전 속도 15% 단축',   icon: '⚡', cost: 150 },
  maxhp:  { name: '중장갑',      desc: '최대 체력 +30 · 즉시 회복', icon: '🛡️', cost: 200 },
  speed:  { name: '기동 강화',   desc: '이동 속도 +15%',         icon: '🏎️', cost: 120 },
  life:   { name: '예비 부대',   desc: '공용 목숨 +1',           icon: '❤️', cost: 250 },
  regen:  { name: '자가 수리',   desc: '초당 체력 자동 회복 +2',  icon: '🔧', cost: 180 },
};

// ===== 맵 정의 (다중 맵) =====
export const MAPS = {
  bunker: {
    name: '벙커', ground: 'ground',
    obstacles: [
      [-20,-20,8,8],[20,20,8,8],[22,-22,6,12],[-22,22,6,12],
      [0,0,10,4],[-12,15,5,5],[12,-15,5,5]
    ]
  },
  cross: {
    name: '십자로', ground: 'ground',
    obstacles: [
      [0,-25,6,20],[0,25,6,20],[-25,0,20,6],[25,0,20,6],
      [-14,-14,5,5],[14,14,5,5],[-14,14,5,5],[14,-14,5,5]
    ]
  },
  arena: {
    name: '투기장', ground: 'ground',
    obstacles: [
      [-30,0,4,30],[30,0,4,30],[0,-30,30,4],[0,30,30,4],
      [0,0,14,14],[-18,-18,4,4],[18,18,4,4],[18,-18,4,4],[-18,18,4,4]
    ]
  }
};

// ===== 전역 상태 =====
let scene, camera, renderer, composer, clock;
let tanks = {}, bullets = [], effects = [], powerups = [], enemies = [];
let obstacleMeshes = [], currentMap = null;
let localAim = 0, lastShot = 0;
const mouseNdc = new THREE.Vector2(0, 0);
const aimPoint = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
export const KEYS = {};

export const game = {
  phase: 'menu',       // menu | play | roundover | matchover | wavebreak | shopping
  mode: 'versus',      // versus | coop
  scoreMe: 0, scoreFoe: 0, round: 1,
  myId: 'p1', foeId: 'p2',
  wave: 1, coopScore: 0, coopLives: 5,   // 협동 모드용
  boostFuel: 100,
  // 협동 업그레이드 누적치 (호스트 권한으로 관리)
  upg: { dmgBonus: 0, reloadMul: 1, maxHpBonus: 0, speedMul: 1, regen: 0 },
};

// 카메라 조종 상태 (화살표 키) — yaw 회전 + 줌
const camCtl = { yaw: 0, dist: 26, height: 28 };

const AI = { active: false, moveDir: 1, retarget: 0, shot: 0 };
export const NET = { isHost: false, connected: false, solo: false, guestInput: null, sendFn: null };

// 콜백 (UI 연결용)
export const hooks = { onBanner: null, onHud: null, onModeEnd: null, onShop: null, onShopClose: null };

// ===== 초기화 =====
export function initGame(canvas) {
  scene = new THREE.Scene();
  scene.background = makeSkyTexture();
  scene.fog = new THREE.FogExp2(0x2a3a5c, 0.0042);

  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  Assets.init(renderer);
  scene.environment = Assets.envMap;

  // 조명
  const amb = new THREE.AmbientLight(0x8899cc, 0.65);
  scene.add(amb);
  const hemi = new THREE.HemisphereLight(0xaaccff, 0x5a4a38, 0.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
  sun.position.set(50, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left:-ARENA-15, right:ARENA+15, top:ARENA+15, bottom:-ARENA-15, near:1, far:250 });
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x4488ff, 0.6);
  rim.position.set(-40, 30, -50); scene.add(rim);

  // 후처리: 블룸
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.5, 0.85);
  composer.addPass(bloom);

  clock = new THREE.Clock();
  addEventListener('resize', onResize);
  bindInput(canvas);
  animate();
}

// ===== 하늘 그라디언트 텍스처 =====
function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 256;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#1a3a6b');   // 상단: 짙은 하늘색
  grad.addColorStop(0.5, '#3d6ba5');
  grad.addColorStop(0.8, '#7ba0c9');
  grad.addColorStop(1, '#c9b896');   // 지평선: 모래빛
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ===== 맵 빌드 =====
function buildMap(mapKey) {
  // 기존 정리
  obstacleMeshes.forEach(m => scene.remove(m)); obstacleMeshes = [];
  if (scene.getObjectByName('ground')) scene.remove(scene.getObjectByName('ground'));
  if (scene.getObjectByName('walls')) scene.remove(scene.getObjectByName('walls'));

  currentMap = MAPS[mapKey];
  window.__obstacles = [];

  // 바닥
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(ARENA*2, ARENA*2), Assets.materials.ground);
  ground.rotation.x = -Math.PI/2; ground.receiveShadow = true; ground.name = 'ground';
  scene.add(ground);

  // 외벽
  const wallGroup = new THREE.Group(); wallGroup.name = 'walls';
  const wallH = 5, wallT = 2;
  [[0,wallH/2,-ARENA,ARENA*2,wallH,wallT],[0,wallH/2,ARENA,ARENA*2,wallH,wallT],
   [-ARENA,wallH/2,0,wallT,wallH,ARENA*2],[ARENA,wallH/2,0,wallT,wallH,ARENA*2]]
  .forEach(([x,y,z,w,h,d]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), Assets.materials.concrete);
    m.position.set(x,y,z); m.castShadow = m.receiveShadow = true; wallGroup.add(m);
  });
  scene.add(wallGroup);

  // 엄폐물
  currentMap.obstacles.forEach(([x,z,w,d]) => {
    const h = 5;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), Assets.materials.concrete);
    m.position.set(x, h/2, z); m.castShadow = m.receiveShadow = true;
    scene.add(m); obstacleMeshes.push(m);
    window.__obstacles.push({ x, z, w, d });
  });
}

// ===== 충돌 =====
function collides(x, z, r = 2.2) {
  if (Math.abs(x) > ARENA-2 || Math.abs(z) > ARENA-2) return true;
  for (const o of (window.__obstacles||[])) {
    if (Math.abs(x-o.x) < o.w/2+r && Math.abs(z-o.z) < o.d/2+r) return true;
  }
  return false;
}
function bulletHitsWall(x, z) {
  if (Math.abs(x) > ARENA-1 || Math.abs(z) > ARENA-1) return true;
  for (const o of (window.__obstacles||[])) {
    if (Math.abs(x-o.x) < o.w/2 && Math.abs(z-o.z) < o.d/2) return true;
  }
  return false;
}

// ===== 탱크 스폰 =====
function makeTankEntity(id, model, x, z, angle) {
  scene.add(model);
  return { id, mesh: model, hp: MAX_HP, x, z, angle, turret: angle, alive: true,
           shield: 0, rapid: 0 };
}

function spawnVersusTanks() {
  clearTanks();
  const p1 = createTankModel(0x3a78ff);
  const p2 = createTankModel(0xff5a4d);
  tanks.p1 = makeTankEntity('p1', p1, -ARENA+16, 0, 0);
  tanks.p2 = makeTankEntity('p2', p2, ARENA-16, 0, Math.PI);
  applyTransforms();
}

function ensureGuestLocalTank() {
  if (NET.isHost || !NET.connected) return;
  if (!tanks.p1) {
    const enemy = createTankModel(0x3a78ff);
    tanks.p1 = makeTankEntity('p1', enemy, -ARENA + 16, 0, 0);
  }
  if (!tanks.p2) {
    const mine = createTankModel(0xff5a4d);
    tanks.p2 = makeTankEntity('p2', mine, ARENA - 16, 0, Math.PI);
  }
  applyTransforms();
}

function spawnCoopTanks() {
  clearTanks();
  const p1 = createTankModel(0x3a78ff);
  tanks.p1 = makeTankEntity('p1', p1, -10, 0, 0);
  if (NET.connected) {
    const p2 = createTankModel(0x35d07f);
    tanks.p2 = makeTankEntity('p2', p2, 10, 0, 0);
  }
  applyTransforms();
}

function clearTanks() {
  Object.values(tanks).forEach(t => scene.remove(t.mesh)); tanks = {};
  enemies.forEach(e => scene.remove(e.mesh)); enemies = [];
  bullets.forEach(b => scene.remove(b.mesh)); bullets = [];
  effects.forEach(e => scene.remove(e.mesh)); effects = [];
  powerups.forEach(p => scene.remove(p.mesh)); powerups = [];
}

function applyTransforms() {
  const all = [...Object.values(tanks), ...enemies];
  for (const t of all) {
    if (!t.mesh) continue;
    t.mesh.position.set(t.x, 0, t.z);
    t.mesh.rotation.y = t.angle;
    t.mesh.userData.turret.rotation.y = t.turret - t.angle;
    t.mesh.visible = t.alive;
    // 바퀴 회전 애니메이션
    if (t.mesh.userData.wheels && t._moved) {
      t.mesh.userData.wheels.forEach(w => w.rotation.x += t._moved * 0.3);
    }
  }
}

// ===== 포탄 =====
function spawnBullet(ownerId, x, z, dir, dmg = BULLET_DMG) {
  const isEnemy = ownerId.startsWith('e');
  const color = isEnemy ? 0xff4444 : (ownerId === 'p1' ? 0x66ccff : 0x88ff99);
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 12, 12),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.5 })
  );
  m.position.set(x, 2, z);
  const light = new THREE.PointLight(color, 3, 10);
  m.add(light);
  scene.add(m);
  // 트레일
  bullets.push({ mesh: m, owner: ownerId, x, z, dir, life: 2.2, dmg });
}

function explode(x, z, color, count = 16) {
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.2 + Math.random()*0.3, 6, 6),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5, transparent: true })
    );
    m.position.set(x, 2, z); scene.add(m);
    const a = Math.random()*Math.PI*2;
    effects.push({ mesh: m, life: 0.7,
      vx: Math.cos(a)*(6+Math.random()*10), vz: Math.sin(a)*(6+Math.random()*10),
      vy: Math.random()*10+3 });
  }
}

// ===== 파워업 =====
const POWERUP_TYPES = ['heal', 'shield', 'rapid'];
function spawnPowerup() {
  const type = POWERUP_TYPES[Math.floor(Math.random()*POWERUP_TYPES.length)];
  let x, z, tries = 0;
  do { x = (Math.random()-0.5)*ARENA*1.6; z = (Math.random()-0.5)*ARENA*1.6; tries++; }
  while (collides(x, z, 3) && tries < 30);
  const colors = { heal: 0x35d07f, shield: 0x3a9bff, rapid: 0xffd166 };
  const grp = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.0),
    new THREE.MeshStandardMaterial({ color: colors[type], emissive: colors[type], emissiveIntensity: 1.2, metalness: 0.3, roughness: 0.2 })
  );
  grp.add(box);
  const light = new THREE.PointLight(colors[type], 2, 8);
  light.position.y = 1; grp.add(light);
  grp.position.set(x, 2, z); scene.add(grp);
  powerups.push({ mesh: grp, type, x, z, spin: 0 });
}

function applyPowerup(tank, type) {
  if (type === 'heal') tank.hp = Math.min(MAX_HP, tank.hp + 40);
  else if (type === 'shield') tank.shield = 5;
  else if (type === 'rapid') tank.rapid = 6;
}

// ===== 입력 =====
function bindInput(canvas) {
  addEventListener('keydown', e => { KEYS[e.code] = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); });
  addEventListener('keyup', e => { KEYS[e.code] = false; });
  addEventListener('mousemove', e => {
    if (game.phase !== 'play') return;
    mouseNdc.x = (e.clientX / innerWidth) * 2 - 1;
    mouseNdc.y = -(e.clientY / innerHeight) * 2 + 1;
    const ch = document.getElementById('crosshair');
    if (ch) { ch.style.left = e.clientX+'px'; ch.style.top = e.clientY+'px'; }
  });
  canvas.addEventListener('mousedown', e => { if (e.button === 0 && game.phase === 'play') tryShoot(); });
}

function readLocalControls() {
  let turn = 0, mv = 0;
  if (KEYS['KeyA']) turn += 1;
  if (KEYS['KeyD']) turn -= 1;
  if (KEYS['KeyW']) mv += 1;
  if (KEYS['KeyS']) mv -= 1;
  const boost = !!(KEYS['ShiftLeft'] || KEYS['ShiftRight']);
  return { turn, mv, boost };
}

function refreshAimFromMouse() {
  const me = tanks[game.myId];
  if (!me || !camera) return;
  raycaster.setFromCamera(mouseNdc, camera);
  if (raycaster.ray.intersectPlane(groundPlane, aimPoint)) {
    localAim = Math.atan2(aimPoint.x - me.x, aimPoint.z - me.z);
  }
}

function currentReloadMs(t) {
  let r = RELOAD_MS * (game.mode==='coop' ? game.upg.reloadMul : 1);
  if (t && t.rapid > 0) r *= 0.4;
  return r;
}
function currentBulletDmg() {
  return BULLET_DMG + (game.mode==='coop' ? game.upg.dmgBonus : 0);
}

function tryShoot() {
  const me = tanks[game.myId];
  if (!me || !me.alive) return;
  const reload = currentReloadMs(me);
  const now = performance.now();
  if (now - lastShot < reload) return;
  lastShot = now;
  refreshAimFromMouse();
  const dir = me.turret;
  const bx = me.x + Math.sin(dir)*4.6, bz = me.z + Math.cos(dir)*4.6;
  if (NET.connected && !NET.isHost) {
    NET.sendFn && NET.sendFn({ t:'shoot', ownerId: game.myId, dir, x:bx, z:bz });
  } else {
    spawnBullet(game.myId, bx, bz, dir, currentBulletDmg());
  }
}

// ===== 게임 흐름 =====
export function startMatch(mode, mapKey = 'bunker') {
  game.mode = mode;
  buildMap(mapKey);
  document.getElementById('hud').classList.add('show');
  const ch = document.getElementById('crosshair'); if (ch) ch.style.display = 'block';
  // 카메라 조종 상태 초기화 + 즉시 스냅(수렴 지연 방지)
  camCtl.yaw = 0; camCtl.dist = 26; camCtl.height = camCtl.dist * 1.08 + 2;
  if (camera) {
    camera.position.set(0, camCtl.height, camCtl.dist);
  }
  // 업그레이드 초기화
  game.upg = { dmgBonus: 0, reloadMul: 1, maxHpBonus: 0, speedMul: 1, regen: 0 };
  if (mode === 'versus') {
    game.scoreMe = 0; game.scoreFoe = 0; game.round = 1;
    startRound();
  } else {
    game.wave = 1; game.coopScore = 0; game.coopLives = 5;
    startCoopWave();
  }
}

function startRound() {
  game.phase = 'play';
  spawnVersusTanks();
  ensureGuestLocalTank();
  bullets.forEach(b=>scene.remove(b.mesh)); bullets=[];
  effects.forEach(e=>scene.remove(e.mesh)); effects=[];
  powerups.forEach(p=>scene.remove(p.mesh)); powerups=[];
  // 라운드 시작 시 파워업 몇 개
  for (let i=0;i<2;i++) spawnPowerup();
  hooks.onBanner && hooks.onBanner('먼저 '+VERSUS_WIN_SCORE+'킬 승리!', '#59e0ff', 1600);
}

// 대전: 킬 발생 시 점수 누적 (10점 선취승). 라운드 재시작 없이 사망자만 리스폰.
function versusKill(winnerId) {
  if (game.phase !== 'play') return;
  if (winnerId === game.myId) game.scoreMe++; else game.scoreFoe++;
  const iScored = winnerId === game.myId;
  hooks.onBanner && hooks.onBanner(iScored?'격파! +1':'당했다…', iScored?'#74f0a7':'#ff6b8f', 900);

  if (NET.connected && NET.isHost)
    NET.sendFn && NET.sendFn({ t:'round', winner:winnerId, scoreP1:game.scoreMe, scoreP2:game.scoreFoe });

  if (game.scoreMe >= VERSUS_WIN_SCORE || game.scoreFoe >= VERSUS_WIN_SCORE) {
    game.phase = 'roundover';
    setTimeout(() => matchEnd(game.scoreMe >= VERSUS_WIN_SCORE), 1400);
  } else {
    // 죽은 탱크만 잠시 후 리스폰 (연속 교전)
    const dead = tanks[winnerId === 'p1' ? 'p2' : 'p1'];
    if (dead) respawnVersusTank(dead);
  }
}

function respawnVersusTank(t) {
  setTimeout(() => {
    if (game.phase !== 'play') return;
    const p = safeRespawnPoint();
    t.hp = MAX_HP + (game.upg.maxHpBonus||0); t.alive = true;
    t.x = p.x; t.z = p.z; t.shield = 1.5;
  }, 1200);
}

export function handleRoundEvent(msg) {
  // 게스트: 호스트가 보낸 점수 반영
  game.scoreMe = game.myId==='p1'?msg.scoreP1:msg.scoreP2;
  game.scoreFoe = game.myId==='p1'?msg.scoreP2:msg.scoreP1;
  const iScored = msg.winner === game.myId;
  hooks.onBanner && hooks.onBanner(iScored?'격파! +1':'당했다…', iScored?'#74f0a7':'#ff6b8f', 900);
  if (game.scoreMe >= VERSUS_WIN_SCORE || game.scoreFoe >= VERSUS_WIN_SCORE) {
    game.phase = 'roundover';
    setTimeout(()=>matchEnd(game.scoreMe>=VERSUS_WIN_SCORE),1400);
  }
}

function matchEnd(iWon) {
  game.phase = 'matchover';
  hooks.onBanner && hooks.onBanner(iWon?'🏆 승리! 매치 종료':'패배… 다음 기회에', iWon?'#ffd166':'#ff6b8f', 3500);
  setTimeout(()=>{ hooks.onModeEnd && hooks.onModeEnd(); }, 3600);
}

// ===== 협동 모드 (웨이브 방어) =====
function startCoopWave() {
  game.phase = 'play';
  spawnCoopTanks();
  bullets.forEach(b=>scene.remove(b.mesh)); bullets=[];
  const count = 2 + game.wave;              // 웨이브마다 적 증가
  for (let i=0;i<count;i++) spawnEnemy();
  if (game.wave % 2 === 0) spawnPowerup();
  hooks.onBanner && hooks.onBanner('웨이브 '+game.wave+' 시작!', '#ffd166', 1500);
}

function spawnEnemy() {
  const edge = Math.floor(Math.random()*4);
  let x, z;
  const m = ARENA-6;
  if (edge===0){x=-m;z=(Math.random()-0.5)*ARENA;}
  else if(edge===1){x=m;z=(Math.random()-0.5)*ARENA;}
  else if(edge===2){x=(Math.random()-0.5)*ARENA;z=-m;}
  else{x=(Math.random()-0.5)*ARENA;z=m;}
  const model = createEnemyModel();
  scene.add(model);
  const hp = 40 + game.wave*8;
  enemies.push({ id:'e'+Date.now()+Math.random(), mesh:model, hp, maxHp:hp,
    x, z, angle:0, turret:0, alive:true, shot: Math.random()*1.5, moveDir:1, retarget:0 });
}

function coopWaveComplete() {
  if (game.phase !== 'play') return;   // 중복 호출 방지
  game.phase = 'wavebreak';
  const bonus = game.wave * 100;
  game.coopScore += bonus;
  hooks.onBanner && hooks.onBanner('웨이브 '+game.wave+' 클리어! +'+bonus, '#74f0a7', 1600);
  // 호스트만 상점을 열고, 게스트에게도 상점 열기 신호 전송
  setTimeout(()=>{
    if (game.phase !== 'wavebreak') return;
    game.phase = 'shopping';
    if (NET.connected && NET.isHost) NET.sendFn && NET.sendFn({ t:'shop', score:game.coopScore, lives:game.coopLives, wave:game.wave });
    hooks.onShop && hooks.onShop({ score: game.coopScore, wave: game.wave });
  }, 1700);
}

// 업그레이드 구매 (호스트 권한). 성공 시 true.
export function buyUpgrade(key) {
  const u = UPGRADES[key];
  if (!u) return false;
  if (game.coopScore < u.cost) return false;
  game.coopScore -= u.cost;
  applyUpgrade(key);
  // 호스트는 갱신된 상태를 게스트에 통보
  if (NET.connected && NET.isHost)
    NET.sendFn && NET.sendFn({ t:'upgApplied', key, score:game.coopScore, lives:game.coopLives, upg:game.upg });
  return true;
}

function applyUpgrade(key) {
  const me = tanks[game.myId] || tanks.p1;
  if (key === 'dmg')    game.upg.dmgBonus += 6;
  else if (key === 'reload') game.upg.reloadMul *= 0.85;
  else if (key === 'maxhp')  { game.upg.maxHpBonus += 30; if (me) me.hp = MAX_HP + game.upg.maxHpBonus; }
  else if (key === 'speed')  game.upg.speedMul *= 1.15;
  else if (key === 'life')   game.coopLives += 1;
  else if (key === 'regen')  game.upg.regen += 2;
}

// 상점 종료 → 다음 웨이브. (호스트가 호출; 게스트는 신호로 따라감)
export function closeShopAndContinue() {
  if (game.phase !== 'shopping') return;
  game.wave++;
  if (NET.connected && NET.isHost) NET.sendFn && NET.sendFn({ t:'wave', wave:game.wave, score:game.coopScore, lives:game.coopLives, upg:game.upg });
  startCoopWave();
}

function coopGameOver() {
  game.phase = 'matchover';
  hooks.onBanner && hooks.onBanner('방어 실패… 최종 웨이브 '+game.wave+' · '+game.coopScore+'점', '#ff6b8f', 4000);
  setTimeout(()=>{ hooks.onModeEnd && hooks.onModeEnd(); }, 4100);
}

// ===== AI (적 봇 + 솔로 대전 상대) =====
function updateEnemyAI(enemy, dt) {
  if (!enemy.alive) return;
  // 가장 가까운 플레이어 타겟
  let target = null, best = Infinity;
  for (const t of Object.values(tanks)) {
    if (!t.alive) continue;
    const d = Math.hypot(t.x-enemy.x, t.z-enemy.z);
    if (d < best) { best = d; target = t; }
  }
  if (!target) return;
  const dx = target.x-enemy.x, dz = target.z-enemy.z;
  const targetAngle = Math.atan2(dx, dz);
  let diff = targetAngle - enemy.turret;
  while (diff>Math.PI) diff-=Math.PI*2; while (diff<-Math.PI) diff+=Math.PI*2;
  enemy.turret += Math.sign(diff)*Math.min(Math.abs(diff), 2.0*dt);

  const dist = best;
  enemy.retarget -= dt;
  if (enemy.retarget<=0){ enemy.moveDir=Math.random()<0.5?1:-1; enemy.retarget=1+Math.random()*1.5; }
  let moveA = dist>28 ? targetAngle : targetAngle + Math.PI/2*enemy.moveDir;
  const spd = TANK_SPEED*0.55;
  const nx = enemy.x + Math.sin(moveA)*spd*dt, nz = enemy.z + Math.cos(moveA)*spd*dt;
  if (!collides(nx, enemy.z)) enemy.x = nx;
  if (!collides(enemy.x, nz)) enemy.z = nz;
  enemy.angle += (moveA-enemy.angle)*Math.min(1,4*dt);
  enemy._moved = spd*dt;

  enemy.shot -= dt;
  if (Math.abs(diff)<0.3 && dist<48 && enemy.shot<=0) {
    enemy.shot = 1.4 + Math.random()*0.8;
    const bx = enemy.x+Math.sin(enemy.turret)*4.6, bz = enemy.z+Math.cos(enemy.turret)*4.6;
    spawnBullet(enemy.id, bx, bz, enemy.turret, 12);
  }
}

function updateSoloAI(dt) {
  const ai = tanks.p2, me = tanks.p1;
  if (!ai||!ai.alive||!me) return;
  const dx=me.x-ai.x, dz=me.z-ai.z;
  const ta=Math.atan2(dx,dz);
  let diff=ta-ai.turret; while(diff>Math.PI)diff-=Math.PI*2; while(diff<-Math.PI)diff+=Math.PI*2;
  ai.turret += Math.sign(diff)*Math.min(Math.abs(diff),2.5*dt);
  const dist=Math.hypot(dx,dz);
  AI.retarget-=dt;
  if(AI.retarget<=0){AI.moveDir=Math.random()<0.5?1:-1;AI.retarget=1+Math.random()*1.5;}
  let moveA=ta+Math.PI/2*AI.moveDir;
  if(dist>30)moveA=ta; else if(dist<14)moveA=ta+Math.PI;
  const nx=ai.x+Math.sin(moveA)*TANK_SPEED*0.7*dt, nz=ai.z+Math.cos(moveA)*TANK_SPEED*0.7*dt;
  if(!collides(nx,ai.z))ai.x=nx; if(!collides(ai.x,nz))ai.z=nz;
  ai.angle+=(moveA-ai.angle)*Math.min(1,4*dt); ai._moved=TANK_SPEED*0.7*dt;
  AI.shot-=dt;
  if(Math.abs(diff)<0.25&&dist<45&&AI.shot<=0){
    AI.shot=RELOAD_MS/1000+Math.random()*0.5;
    const bx=ai.x+Math.sin(ai.turret)*4.6,bz=ai.z+Math.cos(ai.turret)*4.6;
    spawnBullet('p2',bx,bz,ai.turret);
  }
}

// ===== 물리 업데이트 =====
function updateLocalPlayer(dt) {
  const me = tanks[game.myId];
  if (!me||!me.alive) return;
  const { turn, mv, boost: wantBoostKey } = readLocalControls();
  me.angle += turn*TURN_SPEED*dt;
  const wantBoost = wantBoostKey && game.boostFuel>0 && mv!==0;
  const boost = wantBoost?1.7:1;
  if (wantBoost) game.boostFuel = Math.max(0, game.boostFuel - 40*dt);
  else game.boostFuel = Math.min(100, game.boostFuel + 15*dt);
  const speedMul = game.mode==='coop' ? game.upg.speedMul : 1;
  const spd=TANK_SPEED*boost*speedMul;
  const nx=me.x+Math.sin(me.angle)*mv*spd*dt, nz=me.z+Math.cos(me.angle)*mv*spd*dt;
  if(!collides(nx,me.z))me.x=nx; if(!collides(me.x,nz))me.z=nz;
  me.turret=localAim; me._moved=mv*spd*dt;
  // 상태 타이머
  if(me.shield>0)me.shield-=dt; if(me.rapid>0)me.rapid-=dt;
  // 자가 수리 (협동 업그레이드)
  if(game.mode==='coop' && game.upg.regen>0){
    const cap = MAX_HP + game.upg.maxHpBonus;
    me.hp = Math.min(cap, me.hp + game.upg.regen*dt);
  }
  // 파워업 획득
  pickupPowerups(me);
}

function updatePredictedGuestLocal(dt) {
  const me = tanks[game.myId];
  if (!me || !me.alive) return;
  const { turn, mv, boost: wantBoostKey } = readLocalControls();
  me.angle += turn * TURN_SPEED * dt;
  const wantBoost = wantBoostKey && game.boostFuel > 0 && mv !== 0;
  const boost = wantBoost ? 1.7 : 1;
  if (wantBoost) game.boostFuel = Math.max(0, game.boostFuel - 40 * dt);
  else game.boostFuel = Math.min(100, game.boostFuel + 15 * dt);
  const spd = TANK_SPEED * boost;
  const nx = me.x + Math.sin(me.angle) * mv * spd * dt;
  const nz = me.z + Math.cos(me.angle) * mv * spd * dt;
  if (!collides(nx, me.z)) me.x = nx;
  if (!collides(me.x, nz)) me.z = nz;
  me.turret = localAim;
  me._moved = mv * spd * dt;
}

function updateGuestFromInput(dt) {
  const gi=NET.guestInput, foe=tanks.p2;
  if(!gi||!foe||!foe.alive)return;
  foe.angle+=(gi.turn||0)*TURN_SPEED*dt;
  const spd=TANK_SPEED*(gi.boost?1.7:1), mv=gi.mv||0;
  const nx=foe.x+Math.sin(foe.angle)*mv*spd*dt, nz=foe.z+Math.cos(foe.angle)*mv*spd*dt;
  if(!collides(nx,foe.z))foe.x=nx; if(!collides(foe.x,nz))foe.z=nz;
  foe.turret=gi.aim!=null?gi.aim:foe.turret; foe._moved=mv*spd*dt;
  if(foe.shield>0)foe.shield-=dt; if(foe.rapid>0)foe.rapid-=dt;
  pickupPowerups(foe);
}

function pickupPowerups(tank) {
  for (let i=powerups.length-1;i>=0;i--){
    const p=powerups[i];
    if(Math.hypot(p.x-tank.x,p.z-tank.z)<3){
      applyPowerup(tank,p.type);
      explode(p.x,p.z,p.mesh.children[0].material.color.getHex(),10);
      scene.remove(p.mesh); powerups.splice(i,1);
    }
  }
}

function updateBullets(dt) {
  for (let i=bullets.length-1;i>=0;i--){
    const b=bullets[i]; b.life-=dt; let dead=false;
    const stepDist=BULLET_SPEED*dt, sub=Math.max(1,Math.ceil(stepDist/1.0));
    const sx=Math.sin(b.dir)*stepDist/sub, sz=Math.cos(b.dir)*stepDist/sub;
    for(let s=0;s<sub&&!dead;s++){
      b.x+=sx; b.z+=sz;
      if(bulletHitsWall(b.x,b.z)){ explode(b.x,b.z,0xaabbff,8); dead=true; break; }
      const targets = b.owner.startsWith('e') ? Object.values(tanks) : [...Object.values(tanks), ...enemies];
      for(const t of targets){
        if(!t.alive||t.id===b.owner)continue;
        // 협동에서만 플레이어끼리 오사 방지. 대전에서는 서로 맞아야 함.
        if(game.mode==='coop' && !b.owner.startsWith('e') && !t.id.startsWith('e') && b.owner!==t.id) continue;
        if(Math.hypot(t.x-b.x,t.z-b.z)<HIT_RADIUS){
          if(t.shield>0){ explode(b.x,b.z,0x3a9bff,8); }
          else { t.hp-=b.dmg; explode(b.x,b.z,0xffaa44,10); }
          dead=true;
          if(t.hp<=0){ t.hp=0; t.alive=false; explode(t.x,t.z,0xff8800,24); onTankDeath(t,b.owner); }
          break;
        }
      }
    }
    if(!dead&&b.life<=0){ explode(b.x,b.z,0xaabbff,6); dead=true; }
    b.mesh.position.set(b.x,2,b.z);
    if(dead){ scene.remove(b.mesh); bullets.splice(i,1); }
  }
}

function safeRespawnPoint() {
  // 장애물에 겹치지 않는 리스폰 좌표 탐색
  for (let tries = 0; tries < 40; tries++) {
    const x = (Math.random() - 0.5) * 30;
    const z = (Math.random() - 0.5) * 30;
    if (!collides(x, z, 3)) return { x, z };
  }
  return { x: 0, z: 0 };
}

function onTankDeath(deadTank, killerId) {
  if (game.mode === 'versus') {
    const winner = deadTank.id==='p1'?'p2':'p1';
    versusKill(winner);
  } else {
    // 협동
    if (deadTank.id.startsWith('e')) {
      game.coopScore += 50;
      // 적을 즉시 배열에서 제거 + 씬에서 제거 (누적/오판정 방지)
      deadTank.mesh.visible = false;
      scene.remove(deadTank.mesh);
      const idx = enemies.indexOf(deadTank);
      if (idx >= 0) enemies.splice(idx, 1);
      // 살아있는 적이 하나도 없으면 웨이브 클리어
      if (game.phase === 'play' && enemies.length === 0) coopWaveComplete();
    } else {
      // 플레이어 사망 -> 목숨 감소 후 리스폰 or 게임오버
      game.coopLives--;
      // 살아있는 플레이어가 아직 있는지
      const anyAlive = Object.values(tanks).some(t => !t.id.startsWith('e') && t.alive);
      if (game.coopLives <= 0 && !anyAlive) { coopGameOver(); return; }
      if (game.coopLives <= 0) { coopGameOver(); return; }
      const dt = deadTank;
      setTimeout(() => {
        if (game.phase === 'matchover' || game.phase === 'menu') return;
        const p = safeRespawnPoint();
        dt.hp = MAX_HP; dt.alive = true; dt.x = p.x; dt.z = p.z;
        dt.shield = 2; // 리스폰 직후 2초 무적
      }, 1500);
    }
  }
}

function updateEffects(dt) {
  for(let i=effects.length-1;i>=0;i--){
    const e=effects[i]; e.life-=dt; e.vy-=22*dt;
    e.mesh.position.x+=e.vx*dt; e.mesh.position.y+=e.vy*dt; e.mesh.position.z+=e.vz*dt;
    e.mesh.material.opacity=Math.max(0,e.life/0.7);
    if(e.life<=0||e.mesh.position.y<0){ scene.remove(e.mesh); effects.splice(i,1); }
  }
  powerups.forEach(p=>{ p.spin+=dt*2; p.mesh.rotation.y=p.spin; p.mesh.position.y=2+Math.sin(p.spin)*0.3; });
}

function updateCameraControls(dt) {
  // 화살표: ←→ 회전, ↑↓ 줌 인/아웃
  if (KEYS['ArrowLeft'])  camCtl.yaw -= 1.6 * dt;
  if (KEYS['ArrowRight']) camCtl.yaw += 1.6 * dt;
  if (KEYS['ArrowUp'])    camCtl.dist = Math.max(12, camCtl.dist - 22 * dt);
  if (KEYS['ArrowDown'])  camCtl.dist = Math.min(48, camCtl.dist + 22 * dt);
  // 줌에 따라 높이도 비례 조정
  camCtl.height = camCtl.dist * 1.08 + 2;
}

function updateCamera() {
  const me = tanks[game.myId]; if(!me)return;
  // camCtl.yaw 각도로 탱크 주위를 회전하는 고정 오프셋 카메라
  const tx = me.x + Math.sin(camCtl.yaw) * camCtl.dist;
  const tz = me.z + Math.cos(camCtl.yaw) * camCtl.dist;
  const ty = camCtl.height;
  camera.position.x+=(tx-camera.position.x)*0.12;
  camera.position.z+=(tz-camera.position.z)*0.12;
  camera.position.y+=(ty-camera.position.y)*0.12;
  camera.lookAt(me.x, 2, me.z);
}

// ===== 네트워크 동기화 =====
function pack(t){ return {x:t.x,z:t.z,a:t.angle,tu:t.turret,hp:t.hp,al:t.alive,sh:t.shield}; }
export function buildStateSnapshot() {
  const snap = { t:'state', mode:game.mode,
    tanks:{}, bullets:bullets.map(b=>({x:b.x,z:b.z,o:b.owner})),
    round:game.round, phase:game.phase };
  for(const id in tanks) snap.tanks[id]=pack(tanks[id]);
  if(game.mode==='versus'){ snap.scoreMe=game.scoreFoe; snap.scoreFoe=game.scoreMe; }
  else { snap.enemies=enemies.map(e=>({x:e.x,z:e.z,a:e.angle,tu:e.turret,hp:e.hp,mhp:e.maxHp,al:e.alive,id:e.id}));
         snap.wave=game.wave; snap.coopScore=game.coopScore; snap.coopLives=game.coopLives;
         snap.powerups=powerups.map(p=>({x:p.x,z:p.z,type:p.type})); }
  return snap;
}

let guestBullets = [], guestEnemies = {}, guestPowerups = [];
export function applyStateSnapshot(msg) {
  for(const id in msg.tanks){
    if(!tanks[id]){ // 상대 탱크가 새로 생김 (협동에서 p2)
      const model = createTankModel(id==='p1'?0x3a78ff:0x35d07f);
      tanks[id]=makeTankEntity(id, model, 0,0,0);
    }
    const s=msg.tanks[id], t=tanks[id];
    t.x=s.x;t.z=s.z;t.angle=s.a;t.turret=s.tu;t.hp=s.hp;t.alive=s.al;t.shield=s.sh||0;
  }
  applyTransforms();
  syncGuestBullets(msg.bullets||[]);
  if(msg.mode==='coop'){ syncGuestEnemies(msg.enemies||[]); syncGuestPowerups(msg.powerups||[]);
    game.wave=msg.wave; game.coopScore=msg.coopScore; game.coopLives=msg.coopLives; game.mode='coop'; }
  else { game.scoreMe=msg.scoreMe; game.scoreFoe=msg.scoreFoe; game.round=msg.round; }
  updateHudExternal(msg);
}

function syncGuestBullets(list){
  while(guestBullets.length<list.length){ const m=new THREE.Mesh(new THREE.SphereGeometry(0.4,8,8),new THREE.MeshStandardMaterial({color:0xffffff,emissive:0x88aaff,emissiveIntensity:2}));scene.add(m);guestBullets.push(m);}
  while(guestBullets.length>list.length)scene.remove(guestBullets.pop());
  list.forEach((b,i)=>{ guestBullets[i].position.set(b.x,2,b.z); guestBullets[i].material.color.setHex(b.o.startsWith('e')?0xff4444:0x66ccff); });
}
function syncGuestEnemies(list){
  const seen={};
  list.forEach(e=>{ seen[e.id]=true;
    if(!guestEnemies[e.id]){ const m=createEnemyModel(); scene.add(m); guestEnemies[e.id]={mesh:m}; }
    const g=guestEnemies[e.id]; g.mesh.position.set(e.x,0,e.z); g.mesh.rotation.y=e.a;
    g.mesh.userData.turret.rotation.y=e.tu-e.a; g.mesh.visible=e.al;
  });
  for(const id in guestEnemies) if(!seen[id]){ scene.remove(guestEnemies[id].mesh); delete guestEnemies[id]; }
}
function syncGuestPowerups(list){
  while(guestPowerups.length<list.length){ const g=new THREE.Group(); const box=new THREE.Mesh(new THREE.OctahedronGeometry(1),new THREE.MeshStandardMaterial({emissive:0xffffff,emissiveIntensity:1}));g.add(box);scene.add(g);guestPowerups.push(g);}
  while(guestPowerups.length>list.length)scene.remove(guestPowerups.pop());
  const colors={heal:0x35d07f,shield:0x3a9bff,rapid:0xffd166};
  list.forEach((p,i)=>{ guestPowerups[i].position.set(p.x,2,p.z); guestPowerups[i].children[0].material.color.setHex(colors[p.type]); guestPowerups[i].children[0].material.emissive.setHex(colors[p.type]); });
}

export function handleWaveEvent(msg){
  game.wave=msg.wave; game.coopScore=msg.score; game.coopLives=msg.lives;
  if(msg.upg) game.upg = msg.upg;
  // 게스트: 상점 닫고 다음 웨이브 진행 상태로
  if(game.phase==='shopping'){ game.phase='play'; hooks.onShopClose && hooks.onShopClose(); }
}

// 게스트: 호스트가 상점을 열었다는 신호
export function handleShopEvent(msg){
  game.coopScore=msg.score; game.coopLives=msg.lives; game.wave=msg.wave;
  game.phase='shopping';
  hooks.onShop && hooks.onShop({ score: game.coopScore, wave: game.wave });
}

// 게스트: 호스트가 업그레이드를 적용했다는 신호 (점수/스탯 동기화만)
export function handleUpgApplied(msg){
  game.coopScore=msg.score; game.coopLives=msg.lives;
  if(msg.upg) game.upg = msg.upg;
  hooks.onShop && hooks.onShop({ score: game.coopScore, wave: game.wave, refresh:true });
}

// ===== HUD 갱신 =====
function updateHudExternal(snapshot){
  const me=tanks[game.myId], foe=tanks[game.foeId];
  hooks.onHud && hooks.onHud({
    meHp: me?me.hp:0, foeHp: foe?foe.hp:0,
    mode: game.mode, scoreMe: game.scoreMe, scoreFoe: game.scoreFoe, round: game.round,
    wave: game.wave, coopScore: game.coopScore, coopLives: game.coopLives,
    reloadRatio: Math.min(1,(performance.now()-lastShot)/(me&&me.rapid>0?RELOAD_MS*0.4:RELOAD_MS)),
    boostFuel: game.boostFuel, shield: me?me.shield:0, rapid: me?me.rapid:0,
    fromSnapshot: !!snapshot
  });
}

// ===== 메인 루프 =====
function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(0.05, clock.getDelta());
  refreshAimFromMouse();
  if(game.phase==='play'){
    const hostSide = NET.isHost||NET.solo||!NET.connected;
    if(hostSide){
      updateLocalPlayer(dt);
      if(game.mode==='versus'){
        if(NET.solo)updateSoloAI(dt);
        else if(NET.connected)updateGuestFromInput(dt);
      } else {
        // 협동: 게스트 입력 반영 + 적 AI (죽은 적은 onTankDeath에서 즉시 제거됨)
        if(NET.connected)updateGuestFromInput(dt);
        for(const e of enemies) updateEnemyAI(e,dt);
      }
      updateBullets(dt);
      applyTransforms();
      updateHudExternal(null);
      if(NET.connected) NET.sendFn && NET.sendFn(buildStateSnapshot());
    } else {
      // 게스트: 입력 전송 + 로컬 예측
      updatePredictedGuestLocal(dt);
      sendGuestInput();
      applyTransforms();
      updateHudExternal(null);
    }
  }
  updateEffects(dt);
  updateCameraControls(dt);
  updateCamera();
  composer.render();
}

function sendGuestInput(){
  const { turn, mv, boost } = readLocalControls();
  NET.sendFn && NET.sendFn({ t:'input', turn, mv, boost, aim:localAim });
}

// ===== 정리 =====
export function resetToMenu(){
  game.phase='menu';
  document.getElementById('hud').classList.remove('show');
  const ch=document.getElementById('crosshair'); if(ch)ch.style.display='none';
  AI.active=false;
  clearTanks();
  guestBullets.forEach(m=>scene.remove(m)); guestBullets=[];
  Object.values(guestEnemies).forEach(g=>scene.remove(g.mesh)); guestEnemies={};
  guestPowerups.forEach(g=>scene.remove(g)); guestPowerups=[];
}

export function setSoloAI(v){ AI.active=v; }
export function shootFromNet(msg){ spawnBullet(msg.ownerId || 'p2', msg.x, msg.z, msg.dir, currentBulletDmg()); }

function onResize(){
  camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight); composer.setSize(innerWidth,innerHeight);
}

// 테스트/디버그용 내보내기
export const __test = {
  spawnBullet, updateBullets, collides,
  tanks:()=>tanks, enemies:()=>enemies, bullets:()=>bullets,
  spawnEnemy, spawnCoopTanks, buildMap, game,
  getLocalAim:()=>localAim,
  getCameraState:()=>camera ? ({ x: camera.position.x, y: camera.position.y, z: camera.position.z }) : null,
  getCamCtl:()=>({ yaw: camCtl.yaw, dist: camCtl.dist, height: camCtl.height }),
};
