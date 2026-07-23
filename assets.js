// assets.js — 텍스처 로딩 + PBR 재질 팩토리 + HDR 환경광
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const texLoader = new THREE.TextureLoader();

function loadPBR(baseName, repeat = 1) {
  const albedo = texLoader.load(`assets/textures/${baseName}_albedo.png`);
  const normal = texLoader.load(`assets/textures/${baseName}_normal.png`);
  [albedo, normal].forEach(t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
  });
  albedo.colorSpace = THREE.SRGBColorSpace;
  return { albedo, normal };
}

export const Assets = {
  ready: false,
  materials: {},
  envMap: null,

  init(renderer) {
    // HDR 대체: RoomEnvironment로 부드러운 IBL 환경광 생성 (외부 HDR 파일 불필요)
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = new RoomEnvironment();
    this.envMap = pmrem.fromScene(env, 0.04).texture;
    pmrem.dispose();

    const ground = loadPBR('ground', 16);
    const armor = loadPBR('armor', 1);
    const concrete = loadPBR('concrete', 2);

    this.materials.ground = new THREE.MeshStandardMaterial({
      map: ground.albedo, normalMap: ground.normal,
      normalScale: new THREE.Vector2(1.2, 1.2),
      roughness: 0.95, metalness: 0.0, envMap: this.envMap, envMapIntensity: 0.4
    });
    this.materials.concrete = new THREE.MeshStandardMaterial({
      map: concrete.albedo, normalMap: concrete.normal,
      normalScale: new THREE.Vector2(1.0, 1.0),
      roughness: 0.85, metalness: 0.05, envMap: this.envMap, envMapIntensity: 0.5
    });
    // 탱크 색상별 재질 (텍스처 공유, 색조만 변경)
    this.armorTex = armor;
    this.ready = true;
  },

  tankBodyMaterial(colorHex) {
    return new THREE.MeshStandardMaterial({
      map: this.armorTex.albedo,
      normalMap: this.armorTex.normal,
      normalScale: new THREE.Vector2(0.8, 0.8),
      color: colorHex,
      roughness: 0.45, metalness: 0.75,
      envMap: this.envMap, envMapIntensity: 1.0
    });
  },

  metalDark() {
    return new THREE.MeshStandardMaterial({
      color: 0x15192b, roughness: 0.6, metalness: 0.85,
      envMap: this.envMap, envMapIntensity: 0.8
    });
  }
};
