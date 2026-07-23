// tankmodel.js — 상세 탱크 3D 모델 생성
import * as THREE from 'three';
import { Assets } from './assets.js';

export function createTankModel(colorHex) {
  const g = new THREE.Group();
  const body = Assets.tankBodyMaterial(colorHex);
  const dark = Assets.metalDark();

  // ----- 하부 차체 (경사 장갑) -----
  const hullShape = new THREE.BoxGeometry(3.6, 1.0, 4.8);
  const hull = new THREE.Mesh(hullShape, body);
  hull.position.y = 1.1; hull.castShadow = true; hull.receiveShadow = true;
  g.add(hull);

  // 전면 경사 장갑
  const glacis = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.9, 1.4), body);
  glacis.position.set(0, 0.95, 2.4); glacis.rotation.x = -0.5;
  glacis.castShadow = true; g.add(glacis);

  // ----- 궤도 + 바퀴 (양옆) -----
  const wheels = [];
  [-1.95, 1.95].forEach(side => {
    const track = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.1, 5.2), dark);
    track.position.set(side, 0.62, 0); track.castShadow = true; track.receiveShadow = true;
    g.add(track);
    // 바퀴(로드휠) 5개
    for (let i = 0; i < 5; i++) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.5, 16), dark);
      w.rotation.z = Math.PI / 2;
      w.position.set(side, 0.55, -2.0 + i * 1.0);
      w.castShadow = true; g.add(w); wheels.push(w);
    }
  });

  // ----- 포탑 (회전) -----
  const turret = new THREE.Group();
  const turretBase = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.6, 1.0, 20), body);
  turretBase.castShadow = true; turret.add(turretBase);
  // 포탑 상부 경사
  const turretTop = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.35, 0.5, 20), body);
  turretTop.position.y = 0.7; turretTop.castShadow = true; turret.add(turretTop);
  // 큐폴라(해치)
  const cupola = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 0.4, 12), dark);
  cupola.position.set(-0.5, 1.0, -0.3); cupola.castShadow = true; turret.add(cupola);

  // ----- 주포 (포신) -----
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 4.2, 16), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.1, 2.3);
  barrel.castShadow = true; turret.add(barrel);
  // 포구 제동기(머즐 브레이크)
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.6, 12), dark);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, 0.1, 4.3);
  muzzle.castShadow = true; turret.add(muzzle);
  // 포방패(맨틀렛)
  const mantlet = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 0.6), body);
  mantlet.position.set(0, 0.1, 1.3); mantlet.castShadow = true; turret.add(mantlet);

  turret.position.y = 1.9;
  g.add(turret);

  // 안테나
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.5, 6), dark);
  antenna.position.set(1.0, 3.2, -1.5); turret.add(antenna);

  g.userData.turret = turret;
  g.userData.wheels = wheels;
  g.userData.muzzleTip = new THREE.Vector3(0, 2.0, 4.6);
  return g;
}

// 적 봇용 (협동 모드) — 붉은 위협적 디자인
export function createEnemyModel() {
  const m = createTankModel(0x8a2233);
  // 발광 눈 (센서)
  const eye = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xff3355, emissive: 0xff2244, emissiveIntensity: 2 })
  );
  eye.position.set(0, 2.0, 1.2);
  m.add(eye);
  return m;
}
