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
  dmg:    { name: '화력 강화',   desc: '포탄 데미지 +8',            icon: '💥' },
  reload: { name: '속사 장전',   desc: '재장전 18% 단축',           icon: '⚡' },
  maxhp:  { name: '중장갑',      desc: '최대 체력 +40 · 즉시 회복',  icon: '🛡️' },
  speed:  { name: '기동 강화',   desc: '이동 속도 +18%',            icon: '🏎️' },
  life:   { name: '예비 부대',   desc: '공용 목숨 +1',              icon: '❤️' },
  regen:  { name: '자가 수리',   desc: '초당 체력 회복 +3',         icon: '🔧' },
  multi:  { name: '확산 포탄',   desc: '발사 시 좌우로 추가 포탄',   icon: '🔱' },
  pierce: { name: '관통탄',      desc: '포탄이 적 1명 더 관통',      icon: '🎯' },
  vamp:   { name: '흡혈 장갑',   desc: '준 피해의 15% 체력 흡수',    icon: '🧛' },
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
  upg: { dmgBonus: 0, reloadMul: 1, maxHpBonus: 0, speedMul: 1, regen: 0, multishot: 0, pierce: 0, vamp: 0 },
};

// 카메라 조종 상태 (화살표 키) — yaw 회전 + 줌 + 흔들림
const camCtl = { yaw: 0, dist: 26, height: 28, shake: 0 };

// 도파민 장치: 콤보 / 히트스톱 / 데미지넘버
const juice = { combo: 0, comboTimer: 0, hitStop: 0 };
let damageNumbers = [];   // 화면에 뜨는 데미지 숫자
let coins = [];           // 처치 시 떨어지는 코인(자석으로 빨려옴)

const AI = { active: false, moveDir: 1, retarget: 0, shot: 0 };
export const NET = { isHost: false, connected: false, solo: false, guestInput: null, sendFn: null };

// 콜백 (UI 연결용)
export const hooks = { onBanner: null, onHud: null, onModeEnd: null, onShop: null, onShopClose: null,
  onCombo: null, onDamageNumbers: null, onCardPick: null, onFlash: null };

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
  if (NET.connected && !NET.isHost) {
    NET.sendFn && NET.sendFn({ t:'shoot', ownerId: game.myId, dir, x:me.x, z:me.z });
  } else {
    fireSpread(game.myId, me.x, me.z, dir, currentBulletDmg());
  }
  camCtl.shake = Math.max(camCtl.shake, 0.12);
}

// 멀티샷 반영 발사
function fireSpread(owner, mx, mz, dir, dmg) {
  const extra = (game.mode==='coop' ? (game.upg.multishot||0) : 0);
  const spread = 0.14;
  const angles = [0];
  for (let i=1;i<=extra;i++){ angles.push(i*spread); angles.push(-i*spread); }
  for (const a of angles) {
    const d = dir + a;
    const bx = mx + Math.sin(d)*4.6, bz = mz + Math.cos(d)*4.6;
    spawnBullet(owner, bx, bz, d, dmg);
  }
}

// ===== 게임 흐름 =====
export function startMatch(mode, mapKey = 'bunker') {
  game.mode = mode;
  buildMap(mapKey);
  document.getElementById('hud').classList.add('show');
  const ch = document.getElementById('crosshair'); if (ch) ch.style.display = 'block';
  // 카메라 조종 상태 초기화 + 즉시 스냅(수렴 지연 방지)
  camCtl.yaw = 0; camCtl.dist = 26; camCtl.height = camCtl.dist * 1.08 + 2; camCtl.shake = 0;
  if (camera) {
    camera.position.set(0, camCtl.height, camCtl.dist);
  }
  // 업그레이드 초기화
  game.upg = { dmgBonus: 0, reloadMul: 1, maxHpBonus: 0, speedMul: 1, regen: 0, multishot: 0, pierce: 0, vamp: 0 };
  // 도파민 상태 초기화
  juice.combo = 0; juice.comboTimer = 0; juice.hitStop = 0;
  coins.forEach(c=>scene.remove(c.mesh)); coins = [];
  damageNumbers = [];
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

  const w = game.wave;
  const isBoss = (w % 5 === 0);

  if (isBoss) {
    spawnEnemy('boss');
    // 보스 호위병
    for (let i=0;i<2;i++) spawnEnemy('rusher');
    hooks.onBanner && hooks.onBanner('⚠️ 보스 웨이브 '+w+' ⚠️', '#ff2266', 1800);
  } else {
    const total = 3 + Math.floor(w * 1.4);
    for (let i=0;i<total;i++){
      const r = Math.random();
      let key = 'grunt';
      if (w>=2 && r<0.28) key='rusher';
      else if (w>=3 && r<0.42) key='bomber';
      else if (w>=4 && r<0.55) key='tank';
      // 시간차 스폰 (한 번에 안 쏟아지게)
      setTimeout(()=>{ if(game.phase==='play') spawnEnemy(key); }, i*220);
    }
    hooks.onBanner && hooks.onBanner('웨이브 '+w+' 시작!', '#ffd166', 1400);
  }
  if (w % 2 === 0) spawnPowerup();
}

// 적 타입별 스펙 (도파민: 다양한 위협 + 잡는 손맛)
const ENEMY_TYPES = {
  grunt:  { hpMul:1.0, spd:0.55, size:1.0, color:0x8a2233, dmg:12, reward:50,  score:1 },
  rusher: { hpMul:0.55,spd:1.15, size:0.8, color:0xff6a2c, dmg:8,  reward:40,  score:1 },
  tank:   { hpMul:2.6, spd:0.32, size:1.5, color:0x5a3a8a, dmg:20, reward:120, score:2 },
  bomber: { hpMul:0.7, spd:0.9,  size:0.95,color:0xffcc33, dmg:0,  reward:80,  score:1, suicide:true },
  boss:   { hpMul:14,  spd:0.4,  size:2.6, color:0xff2266, dmg:26, reward:800, score:10, boss:true },
};

function spawnEnemy(typeKey) {
  const key = typeKey || 'grunt';
  const T = ENEMY_TYPES[key];
  const edge = Math.floor(Math.random()*4);
  let x, z;
  const m = ARENA-6;
  if (edge===0){x=-m;z=(Math.random()-0.5)*ARENA;}
  else if(edge===1){x=m;z=(Math.random()-0.5)*ARENA;}
  else if(edge===2){x=(Math.random()-0.5)*ARENA;z=-m;}
  else{x=(Math.random()-0.5)*ARENA;z=m;}
  const model = createEnemyModel();
  model.scale.setScalar(T.size);
  // 타입 색상 적용
  model.traverse(o=>{ if(o.isMesh && o.material && o.material.color && o.material.emissive===undefined){} });
  scene.add(model);
  const hp = Math.round((30 + game.wave*7) * T.hpMul);
  enemies.push({ id:'e'+Date.now()+Math.random().toString(36).slice(2), mesh:model, hp, maxHp:hp,
    x, z, angle:0, turret:0, alive:true, shot: Math.random()*1.5, moveDir:1, retarget:0,
    etype:key, spd:T.spd, dmg:T.dmg, reward:T.reward, scoreVal:T.score, suicide:!!T.suicide, boss:!!T.boss });
}

let pendingCards = [];
function coopWaveComplete() {
  if (game.phase !== 'play') return;   // 중복 호출 방지
  game.phase = 'wavebreak';
  const bonus = game.wave * 100;
  game.coopScore += bonus;
  hooks.onBanner && hooks.onBanner('웨이브 '+game.wave+' 클리어! +'+bonus, '#74f0a7', 1400);
  hooks.onFlash && hooks.onFlash('#74f0a7', 0.25);

  // 짧게 쉬고 → 카드 3장 제시 (로그라이크식 즉시 강화)
  setTimeout(()=>{
    if (game.phase !== 'wavebreak') return;
    game.phase = 'cardpick';
    pendingCards = pickThreeCards();
    if (NET.connected && NET.isHost)
      NET.sendFn && NET.sendFn({ t:'cards', cards:pendingCards, score:game.coopScore, lives:game.coopLives, wave:game.wave });
    hooks.onCardPick && hooks.onCardPick({ cards: pendingCards, wave: game.wave });
  }, 1200);
}

// 카드 3장 랜덤 추출 (중복 없이)
function pickThreeCards() {
  const keys = Object.keys(UPGRADES);
  const pool = [...keys];
  const out = [];
  for (let i=0;i<3 && pool.length;i++){
    const idx = Math.floor(Math.random()*pool.length);
    out.push(pool.splice(idx,1)[0]);
  }
  return out;
}

// 카드 선택 확정 → 강화 적용 후 다음 웨이브 (호스트/솔로 권한)
export function chooseCard(key) {
  if (game.phase !== 'cardpick') return;
  applyUpgrade(key);
  hooks.onFlash && hooks.onFlash('#ffd166', 0.3);
  camCtl.shake = Math.max(camCtl.shake, 0.4);
  game.wave++;
  if (NET.connected && NET.isHost)
    NET.sendFn && NET.sendFn({ t:'wave', wave:game.wave, score:game.coopScore, lives:game.coopLives, upg:game.upg });
  hooks.onShopClose && hooks.onShopClose();
  startCoopWave();
}

function applyUpgrade(key) {
  const me = tanks[game.myId] || tanks.p1;
  if (key === 'dmg')    game.upg.dmgBonus += 8;
  else if (key === 'reload') game.upg.reloadMul *= 0.82;
  else if (key === 'maxhp')  { game.upg.maxHpBonus += 40; Object.values(tanks).forEach(t=>{ if(!t.id.startsWith('e')) t.hp = MAX_HP + game.upg.maxHpBonus; }); }
  else if (key === 'speed')  game.upg.speedMul *= 1.18;
  else if (key === 'life')   game.coopLives += 1;
  else if (key === 'regen')  game.upg.regen += 3;
  else if (key === 'multi')  game.upg.multishot = (game.upg.multishot||0) + 1;
  else if (key === 'pierce') game.upg.pierce = (game.upg.pierce||0) + 1;
  else if (key === 'vamp')   game.upg.vamp = (game.upg.vamp||0) + 0.15;
}

// 게스트가 카드 선택 요청 → 호스트가 처리
export function requestChooseCard(key){ if(NET.sendFn) NET.sendFn({ t:'pickReq', key }); }
export function hostHandlePick(key){ chooseCard(key); }

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

  // 자폭병: 무조건 돌진 → 근접 시 폭발
  if (enemy.suicide) {
    const spd = TANK_SPEED * (enemy.spd||0.9);
    const nx = enemy.x + Math.sin(targetAngle)*spd*dt, nz = enemy.z + Math.cos(targetAngle)*spd*dt;
    if (!collides(nx, enemy.z)) enemy.x = nx;
    if (!collides(enemy.x, nz)) enemy.z = nz;
    enemy.angle += (targetAngle-enemy.angle)*Math.min(1,6*dt); enemy._moved=spd*dt;
    if (dist < 4.5) {
      // 폭발: 근처 플레이어에 큰 피해
      explode(enemy.x, enemy.z, 0xffcc33, 30);
      camCtl.shake = Math.max(camCtl.shake, 0.6);
      for (const p of Object.values(tanks)) {
        if (p.id.startsWith('e')||!p.alive) continue;
        if (Math.hypot(p.x-enemy.x, p.z-enemy.z) < 7 && p.shield<=0) {
          p.hp -= 35; spawnDamageNumber(p.x, p.z, 35, true);
          if (p.hp<=0){ p.hp=0; p.alive=false; explode(p.x,p.z,0xff8800,24); onTankDeath(p, enemy.id); }
        }
      }
      enemy.alive=false; enemy.mesh.visible=false; scene.remove(enemy.mesh);
      const idx=enemies.indexOf(enemy); if(idx>=0)enemies.splice(idx,1);
      if(game.phase==='play' && enemies.length===0) coopWaveComplete();
    }
    return;
  }

  let moveA = dist>28 ? targetAngle : targetAngle + Math.PI/2*enemy.moveDir;
  const spd = TANK_SPEED*(enemy.spd||0.55);
  const nx = enemy.x + Math.sin(moveA)*spd*dt, nz = enemy.z + Math.cos(moveA)*spd*dt;
  if (!collides(nx, enemy.z)) enemy.x = nx;
  if (!collides(enemy.x, nz)) enemy.z = nz;
  enemy.angle += (moveA-enemy.angle)*Math.min(1,4*dt);
  enemy._moved = spd*dt;

  enemy.shot -= dt;
  const fireRange = enemy.boss?60:48;
  if (Math.abs(diff)<0.3 && dist<fireRange && enemy.shot<=0) {
    enemy.shot = (enemy.boss?0.5:1.4) + Math.random()*0.6;
    const bx = enemy.x+Math.sin(enemy.turret)*4.6, bz = enemy.z+Math.cos(enemy.turret)*4.6;
    if (enemy.boss) {
      // 보스: 3연발 확산
      for(const a of [-0.2,0,0.2]) spawnBullet(enemy.id, bx, bz, enemy.turret+a, 14);
    } else {
      spawnBullet(enemy.id, bx, bz, enemy.turret, enemy.dmg||12);
    }
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
    if (b.pierceLeft === undefined) b.pierceLeft = (game.mode==='coop' && !b.owner.startsWith('e')) ? (game.upg.pierce||0) : 0;
    if (!b.hitSet) b.hitSet = new Set();
    const stepDist=BULLET_SPEED*dt, sub=Math.max(1,Math.ceil(stepDist/1.0));
    const sx=Math.sin(b.dir)*stepDist/sub, sz=Math.cos(b.dir)*stepDist/sub;
    for(let s=0;s<sub&&!dead;s++){
      b.x+=sx; b.z+=sz;
      if(bulletHitsWall(b.x,b.z)){ explode(b.x,b.z,0xaabbff,8); dead=true; break; }
      const targets = b.owner.startsWith('e') ? Object.values(tanks) : [...Object.values(tanks), ...enemies];
      for(const t of targets){
        if(!t.alive||t.id===b.owner)continue;
        if(b.hitSet.has(t.id))continue;
        // 협동에서만 플레이어끼리 오사 방지. 대전에서는 서로 맞아야 함.
        if(game.mode==='coop' && !b.owner.startsWith('e') && !t.id.startsWith('e') && b.owner!==t.id) continue;
        const hitR = HIT_RADIUS * (t.boss?1.8:(t.mesh&&t.mesh.scale?t.mesh.scale.x:1));
        if(Math.hypot(t.x-b.x,t.z-b.z)<hitR){
          b.hitSet.add(t.id);
          if(t.shield>0){ explode(b.x,b.z,0x3a9bff,8); }
          else {
            t.hp-=b.dmg;
            explode(b.x,b.z,0xffaa44,10);
            spawnDamageNumber(t.x, t.z, Math.round(b.dmg), t.boss);
            // 흡혈 (협동, 플레이어 발사)
            if(game.mode==='coop' && !b.owner.startsWith('e') && (game.upg.vamp||0)>0){
              const heal = tanks[b.owner];
              if(heal){ const cap=MAX_HP+game.upg.maxHpBonus; heal.hp=Math.min(cap, heal.hp + b.dmg*game.upg.vamp); }
            }
          }
          if(t.hp<=0){ t.hp=0; t.alive=false; explode(t.x,t.z,0xff8800, t.boss?60:24);
            camCtl.shake=Math.max(camCtl.shake, t.boss?1.4:0.35);
            juice.hitStop=Math.max(juice.hitStop, t.boss?0.12:0.04);
            onTankDeath(t,b.owner);
          }
          // 관통 처리
          if(b.pierceLeft>0){ b.pierceLeft--; }
          else { dead=true; }
          break;
        }
      }
    }
    if(!dead&&b.life<=0){ explode(b.x,b.z,0xaabbff,6); dead=true; }
    b.mesh.position.set(b.x,2,b.z);
    if(dead){ scene.remove(b.mesh); bullets.splice(i,1); }
  }
}

// ===== 데미지 넘버 =====
function spawnDamageNumber(x, z, amount, big){
  damageNumbers.push({ x, z, y:3, amount, life:0.9, big:!!big });
}

// ===== 콤보 =====
function addCombo(){
  juice.combo++;
  juice.comboTimer = 2.2;   // 2.2초 안에 다음 킬 없으면 리셋
  if (juice.combo >= 3) {
    hooks.onCombo && hooks.onCombo({ combo: juice.combo });
    if (juice.combo % 5 === 0) { camCtl.shake = Math.max(camCtl.shake, 0.5); hooks.onFlash && hooks.onFlash('#ff66aa', 0.2); }
  }
}
function comboMultiplier(){ return 1 + Math.min(juice.combo, 20) * 0.1; }   // 최대 3배

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
      addCombo();
      const mult = comboMultiplier();
      const gained = Math.round((deadTank.reward||50) * mult);
      game.coopScore += gained;
      spawnCoins(deadTank.x, deadTank.z, deadTank.boss?12:4);
      if (deadTank.boss) { hooks.onFlash && hooks.onFlash('#ffd166', 0.4); hooks.onBanner && hooks.onBanner('보스 격파! 💰 +'+gained, '#ffd166', 1600); }
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
  updateCoins(dt);
  updateDamageNumbers(dt);
  // 콤보 타이머
  if(juice.comboTimer>0){ juice.comboTimer-=dt; if(juice.comboTimer<=0){ juice.combo=0; hooks.onCombo && hooks.onCombo({ combo:0 }); } }
}

// ===== 코인 (처치 드롭 → 플레이어에게 자석처럼 빨려옴) =====
function spawnCoins(x, z, n){
  for(let i=0;i<n;i++){
    const m=new THREE.Mesh(new THREE.CylinderGeometry(0.35,0.35,0.12,10),
      new THREE.MeshStandardMaterial({color:0xffd166,emissive:0xffaa00,emissiveIntensity:1.4,metalness:0.6,roughness:0.3}));
    m.rotation.x=Math.PI/2; m.position.set(x+(Math.random()-0.5)*3, 2, z+(Math.random()-0.5)*3);
    scene.add(m);
    coins.push({ mesh:m, x:m.position.x, z:m.position.z, life:6, spin:Math.random()*6 });
  }
}
function updateCoins(dt){
  // 가장 가까운 플레이어 탱크로 이동
  const players = Object.values(tanks).filter(t=>!t.id.startsWith('e') && t.alive);
  for(let i=coins.length-1;i>=0;i--){
    const c=coins[i]; c.life-=dt; c.spin+=dt*8;
    let near=null, best=Infinity;
    for(const p of players){ const d=Math.hypot(p.x-c.x,p.z-c.z); if(d<best){best=d;near=p;} }
    if(near){
      const pull = best<14 ? 26 : 6;   // 가까우면 확 빨려옴
      const ang=Math.atan2(near.x-c.x, near.z-c.z);
      c.x+=Math.sin(ang)*pull*dt; c.z+=Math.cos(ang)*pull*dt;
      if(best<2.2){ game.coopScore+=5; scene.remove(c.mesh); coins.splice(i,1); continue; }
    }
    c.mesh.position.set(c.x, 2+Math.sin(c.spin)*0.2, c.z); c.mesh.rotation.z=c.spin;
    if(c.life<=0){ scene.remove(c.mesh); coins.splice(i,1); }
  }
}

// ===== 데미지 넘버 (화면 투영) =====
function updateDamageNumbers(dt){
  for(let i=damageNumbers.length-1;i>=0;i--){
    const d=damageNumbers[i]; d.life-=dt; d.y+=dt*3;
    if(d.life<=0) damageNumbers.splice(i,1);
  }
  // 화면 좌표로 투영해서 UI에 전달
  if(hooks.onDamageNumbers && camera){
    const out=[];
    for(const d of damageNumbers){
      const v=new THREE.Vector3(d.x, d.y, d.z).project(camera);
      if(v.z>1) continue;
      out.push({ sx:(v.x*0.5+0.5)*innerWidth, sy:(-v.y*0.5+0.5)*innerHeight,
        amount:d.amount, alpha:Math.max(0,d.life/0.9), big:d.big });
    }
    hooks.onDamageNumbers(out);
  }
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
  // 화면 흔들림 (도파민)
  if(camCtl.shake>0){
    const s=camCtl.shake;
    camera.position.x += (Math.random()-0.5)*s*2.4;
    camera.position.y += (Math.random()-0.5)*s*2.4;
    camera.position.z += (Math.random()-0.5)*s*2.4;
    camCtl.shake = Math.max(0, camCtl.shake - 3.5*0.016);
  }
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
  else { snap.enemies=enemies.map(e=>({x:e.x,z:e.z,a:e.angle,tu:e.turret,hp:e.hp,mhp:e.maxHp,al:e.alive,id:e.id,sz:(e.mesh&&e.mesh.scale?e.mesh.scale.x:1)}));
         snap.wave=game.wave; snap.coopScore=game.coopScore; snap.coopLives=game.coopLives; snap.combo=juice.combo;
         snap.coins=coins.map(c=>({x:c.x,z:c.z}));
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
    game.wave=msg.wave; game.coopScore=msg.coopScore; game.coopLives=msg.coopLives; game.mode='coop';
    if(msg.combo!==undefined) juice.combo=msg.combo; }
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
    if(!guestEnemies[e.id]){ const m=createEnemyModel(); m.scale.setScalar(e.sz||1); scene.add(m); guestEnemies[e.id]={mesh:m}; }
    const g=guestEnemies[e.id]; g.mesh.position.set(e.x,0,e.z); g.mesh.rotation.y=e.a;
    if(e.sz) g.mesh.scale.setScalar(e.sz);
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
  // 게스트: 카드 창 닫고 다음 웨이브 진행 상태로
  if(game.phase==='cardpick' || game.phase==='wavebreak'){ game.phase='play'; hooks.onShopClose && hooks.onShopClose(); }
}

// 게스트: 호스트가 카드 선택 창을 열었다는 신호
export function handleCardsEvent(msg){
  game.coopScore=msg.score; game.coopLives=msg.lives; game.wave=msg.wave;
  game.phase='cardpick';
  hooks.onCardPick && hooks.onCardPick({ cards: msg.cards, wave: game.wave });
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
    combo: juice.combo,
    fromSnapshot: !!snapshot
  });
}

// ===== 메인 루프 =====
function animate(){
  requestAnimationFrame(animate);
  let dt=Math.min(0.05, clock.getDelta());
  refreshAimFromMouse();
  // 히트스톱: 순간 정지로 타격감 (이펙트/카메라는 계속 갱신)
  if(juice.hitStop>0){ juice.hitStop-=dt; dt=0; }
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
  coins.forEach(c=>scene.remove(c.mesh)); coins=[];
  damageNumbers=[];
  juice.combo=0; juice.comboTimer=0; juice.hitStop=0;
}

export function setSoloAI(v){ AI.active=v; }
export function shootFromNet(msg){ fireSpread(msg.ownerId || 'p2', msg.x, msg.z, msg.dir, currentBulletDmg()); }

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
  getCamCtl:()=>({ yaw: camCtl.yaw, dist: camCtl.dist, height: camCtl.height, shake: camCtl.shake }),
  getJuice:()=>({ combo: juice.combo, comboTimer: juice.comboTimer, hitStop: juice.hitStop }),
  getPendingCards:()=>pendingCards.slice(),
  getCoins:()=>coins.length,
  getUpg:()=>({ ...game.upg }),
};
