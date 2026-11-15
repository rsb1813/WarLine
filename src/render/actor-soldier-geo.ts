// 병사 부위별 기하. 모두 앞이 -Z, 위가 +Y. 정점 색은 배율(흰색 = 인스턴스 색 그대로).
// 원점 규약:
//  몸통·조끼·배낭: 골반(엉덩관절 높이) 중심, 목 밑동이 (0, 0.55, 0)
//  머리·헬멧: 목 밑동, 머리 중심이 (0, 0.17, 0)
//  위팔·아래팔·허벅지·정강이: 위쪽 관절, -Y 로 뻗음
//  손: 손목, 장화: 발목, 총: 오른손 손잡이(총구 -Z)
import * as THREE from 'three';
import { GeoBuilder } from './actor-geo';

export const SEG = {
  upperArm: 0.3, lowerArm: 0.26, thigh: 0.44, shin: 0.45,
  neck: 0.55, headUp: 0.17, ankle: 0.09,
  shoulderX: 0.19, shoulderY: 0.465, hipX: 0.095, hipY: -0.03,
};

const W = 0xffffff;

export function torsoGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.cyl(0.155, 0.15, 0.2, 0, -0.01, 0, W, 0, 0, 0, 10, 1, 0.72);           // 엉덩이
  b.cyl(0.162, 0.16, 0.05, 0, 0.1, 0, 0x6a6a6a, 0, 0, 0, 10, 1, 0.74);      // 벨트
  b.box(0.05, 0.035, 0.012, 0, 0.1, -0.118, 0x999999);                       // 버클
  b.cyl(0.165, 0.155, 0.2, 0, 0.22, 0, W, 0, 0, 0, 10, 1, 0.68);            // 배
  b.cyl(0.205, 0.172, 0.24, 0, 0.4, 0, W, 0, 0, 0, 10, 1, 0.62);            // 가슴
  b.sphere(0.205, 0, 0.5, 0, W, 1, 0.42, 0.62, 10, 6);                       // 어깨선
  b.cyl(0.07, 0.075, 0.08, 0, 0.56, 0.01, 0xeeeeee, 0, 0, 0, 8);            // 목 깃
  // 옷 주름·바느질 선
  b.box(0.3, 0.012, 0.01, 0, 0.28, -0.11, 0xcfcfcf);
  b.box(0.012, 0.14, 0.01, -0.05, 0.02, -0.108, 0xd5d5d5);
  return b.build();
}

export function vestGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const strap = 0xb8b8b8, pouch = 0xe2e2e2, flap = 0xc9c9c9, web = 0x9a9a9a;
  b.box(0.33, 0.3, 0.055, 0, 0.36, -0.148, W);                  // 앞판
  b.box(0.34, 0.32, 0.05, 0, 0.36, 0.142, W);                   // 뒤판
  b.box(0.05, 0.17, 0.25, -0.19, 0.27, 0, strap);               // 옆 허리띠
  b.box(0.05, 0.17, 0.25, 0.19, 0.27, 0, strap);
  b.box(0.07, 0.03, 0.3, -0.115, 0.505, 0, strap);              // 어깨끈
  b.box(0.07, 0.03, 0.3, 0.115, 0.505, 0, strap);
  for (let i = 0; i < 3; i++) {                                   // 탄창 주머니
    const x = (i - 1) * 0.095;
    b.box(0.082, 0.12, 0.05, x, 0.255, -0.198, pouch);
    b.box(0.086, 0.035, 0.054, x, 0.31, -0.199, flap);
  }
  b.box(0.2, 0.085, 0.035, 0, 0.42, -0.19, pouch);              // 행정 주머니
  b.box(0.3, 0.012, 0.004, 0, 0.465, -0.176, web);              // 몰리 줄
  b.box(0.3, 0.012, 0.004, 0, 0.385, -0.176, web);
  b.box(0.065, 0.13, 0.07, -0.215, 0.33, 0.045, flap);          // 무전기 주머니
  b.cyl(0.005, 0.005, 0.18, -0.225, 0.47, 0.06, 0x333333, 0, 0, 0, 4); // 짧은 안테나
  b.box(0.14, 0.085, 0.065, 0, 0.13, 0.155, flap);              // 응급 키트(허리 뒤)
  b.cyl(0.03, 0.03, 0.09, 0.17, 0.12, -0.08, pouch, 0, 0, 0, 7); // 수류탄 주머니
  b.cyl(0.03, 0.03, 0.09, -0.17, 0.12, -0.08, pouch, 0, 0, 0, 7);
  return b.build();
}

/** 병과별 배낭. 0 assault, 1 engineer, 2 support, 3 recon */
export function packGeo(kind: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const lid = 0xd0d0d0, dark = 0x3a3a3a, strap = 0xaaaaaa;
  if (kind === 0) {
    b.box(0.28, 0.3, 0.12, 0, 0.33, 0.235, W);
    b.box(0.29, 0.05, 0.13, 0, 0.49, 0.235, lid);
    b.box(0.2, 0.12, 0.03, 0, 0.27, 0.31, lid);
    b.box(0.03, 0.26, 0.03, -0.1, 0.34, 0.3, strap);
    b.box(0.03, 0.26, 0.03, 0.1, 0.34, 0.3, strap);
  } else if (kind === 1) {
    b.box(0.3, 0.34, 0.15, 0, 0.3, 0.25, W);
    b.box(0.31, 0.05, 0.16, 0, 0.48, 0.25, lid);
    // 등에 멘 발사관 (오른쪽 엉덩이 → 왼쪽 어깨 위)
    const tube = 0xa8ad98;
    // 배낭 오른쪽에 세워 묶은 발사관
    const ta = 0.1, tc = Math.cos(ta) * 0.47, ts = Math.sin(ta) * 0.47;
    b.add(new THREE.CylinderGeometry(0.058, 0.058, 0.98, 10), rotX(0.19, 0.42, 0.33, ta), tube);
    b.add(new THREE.CylinderGeometry(0.066, 0.066, 0.09, 10), rotX(0.19, 0.42 + tc, 0.33 + ts, ta), shadeOf(tube));
    b.add(new THREE.CylinderGeometry(0.066, 0.066, 0.09, 10), rotX(0.19, 0.42 - tc, 0.33 - ts, ta), shadeOf(tube));
    b.box(0.05, 0.03, 0.03, 0.19, 0.6, 0.27, dark);
    b.box(0.05, 0.03, 0.03, 0.19, 0.25, 0.3, dark);
    // 여분 로켓
    b.cyl(0.045, 0.045, 0.3, -0.17, 0.26, 0.3, 0x8f927f, 0, 0, 0, 8);
    b.cyl(0.02, 0.045, 0.08, -0.17, 0.45, 0.3, 0x5c5f52, 0, 0, 0, 8);
  } else if (kind === 2) {
    b.box(0.36, 0.48, 0.2, 0, 0.3, 0.28, W);
    b.cyl(0.07, 0.07, 0.36, 0, 0.58, 0.27, lid, 0, 0, Math.PI / 2, 10);   // 위 침낭 말이
    b.box(0.26, 0.2, 0.04, 0, 0.24, 0.395, lid);                           // 앞주머니
    // 흰 바탕 빨간 십자
    b.box(0.11, 0.11, 0.006, 0, 0.42, 0.383, 0xffffff);
    b.box(0.07, 0.022, 0.008, 0, 0.42, 0.387, 0xd02020);
    b.box(0.022, 0.07, 0.008, 0, 0.42, 0.387, 0xd02020);
    // 옆 탄약통
    b.box(0.09, 0.16, 0.2, 0.235, 0.18, 0.27, 0x6f7552);
    b.box(0.1, 0.02, 0.21, 0.235, 0.265, 0.27, 0x4e533a);
    b.box(0.03, 0.4, 0.03, -0.12, 0.3, 0.39, strap);
    b.box(0.03, 0.4, 0.03, 0.12, 0.3, 0.39, strap);
  } else {
    b.box(0.28, 0.34, 0.14, 0, 0.31, 0.24, W);
    b.box(0.29, 0.05, 0.15, 0, 0.49, 0.24, lid);
    b.box(0.13, 0.17, 0.07, -0.08, 0.34, 0.33, 0x7a7d74);                  // 무전기
    b.box(0.03, 0.03, 0.03, -0.12, 0.43, 0.34, dark);
    b.add(new THREE.CylinderGeometry(0.004, 0.007, 0.95, 4), rotX(-0.13, 0.9, 0.38, 0.18), dark); // 휩 안테나
    b.sphere(0.012, -0.13, 1.365, 0.465, dark);
  }
  return b.build();
}

function shadeOf(c: number): number { return ((c >> 1) & 0x7f7f7f) + 0x202020; }
function rotX(x: number, y: number, z: number, a: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationX(a).setPosition(x, y, z);
}

export function headGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const bala = 0xe9e9e6, skin = 0xc79a7c, dark = 0x26282a;
  b.cyl(0.052, 0.058, 0.1, 0, 0.04, 0.005, bala, 0, 0, 0, 8);
  b.sphere(0.106, 0, 0.17, 0, bala, 0.92, 1.12, 1.0, 12, 9);
  b.box(0.12, 0.052, 0.04, 0, 0.188, -0.083, skin);              // 눈가 드러난 곳
  b.box(0.026, 0.012, 0.01, -0.03, 0.193, -0.104, dark);         // 눈
  b.box(0.026, 0.012, 0.01, 0.03, 0.193, -0.104, dark);
  b.box(0.026, 0.04, 0.03, 0, 0.158, -0.1, bala);                // 코
  b.box(0.08, 0.035, 0.03, 0, 0.115, -0.085, 0xdcdcd8);          // 턱 덮개
  return b.build();
}

/** us: 하이컷 헬멧 + 야간투시경 거치대·고글. ru: 깊고 둥근 헬멧 + 천 덮개·귀 보호대 */
export function helmetGeo(side: 'us' | 'ru'): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const dark = 0x2a2c2e, mid = 0x55585a;
  if (side === 'us') {
    b.dome(0.136, Math.PI * 0.5, 0, 0.185, 0.008, W, 1.0, 0.95, 1.1);
    b.box(0.014, 0.032, 0.14, -0.132, 0.2, 0.01, mid);           // 옆 레일
    b.box(0.014, 0.032, 0.14, 0.132, 0.2, 0.01, mid);
    b.box(0.055, 0.038, 0.024, 0, 0.255, -0.142, dark);           // NVG 거치대
    b.box(0.02, 0.05, 0.03, 0, 0.29, -0.15, dark);
    b.cylZ(0.018, 0.075, -0.026, 0.315, -0.16, dark, 7);          // 올려 둔 쌍안 NVG
    b.cylZ(0.018, 0.075, 0.026, 0.315, -0.16, dark, 7);
    b.box(0.085, 0.055, 0.045, 0, 0.215, 0.145, 0xcccccc);        // 뒤 배터리 주머니
    b.box(0.15, 0.038, 0.03, 0, 0.22, -0.128, 0x3b4550);          // 이마 위 고글
    b.cyl(0.139, 0.139, 0.016, 0, 0.222, 0.008, 0x404040, 0, 0, 0, 14, 1, 1.08); // 고글 끈
  } else {
    b.dome(0.146, Math.PI * 0.6, 0, 0.18, 0.006, W, 1.02, 0.9, 1.1);
    b.cyl(0.15, 0.153, 0.03, 0, 0.143, 0.006, 0xd8d8d8, 0, 0, 0, 14, 1, 1.08); // 테두리
    b.cyl(0.141, 0.146, 0.04, 0, 0.215, 0.006, 0xc6c6c6, 0, 0, 0, 14, 1, 1.08); // 덮개 고무줄
    b.sphere(0.045, -0.126, 0.14, 0.0, dark, 0.55, 1, 1);         // 헤드셋
    b.sphere(0.045, 0.126, 0.14, 0.0, dark, 0.55, 1, 1);
    b.box(0.07, 0.04, 0.012, 0, 0.23, 0.155, 0xbdbdbd);           // 뒤 벨크로
  }
  return b.build();
}

export function upperArmGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.sphere(0.064, 0, -0.01, 0, W, 1, 1, 1, 8, 6);
  b.cyl(0.058, 0.05, 0.3, 0, -0.15, 0, W, 0, 0, 0, 8, 0.95, 1);
  b.box(0.05, 0.06, 0.012, 0, -0.12, -0.052, 0xd8d8d8);          // 팔 주머니
  return b.build();
}

export function lowerArmGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.sphere(0.05, 0, 0, 0, W, 1, 1, 1, 8, 5);
  b.cyl(0.048, 0.04, 0.25, 0, -0.125, 0, W, 0, 0, 0, 8);
  b.cyl(0.044, 0.044, 0.03, 0, -0.245, 0, 0xcfcfcf, 0, 0, 0, 8);
  return b.build();
}

export function handGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const glove = 0x3e4042;
  b.box(0.072, 0.095, 0.045, 0, -0.05, 0, glove);
  b.box(0.025, 0.05, 0.03, 0.04, -0.035, -0.02, glove, 0, 0, -0.4);
  b.box(0.066, 0.02, 0.05, 0, -0.01, 0, 0x2f3133);
  return b.build();
}

export function thighGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.sphere(0.082, 0, 0, 0, W, 1, 1, 1, 8, 6);
  b.cyl(0.084, 0.062, 0.44, 0, -0.22, 0, W, 0, 0, 0, 9, 1, 0.95);
  b.box(0.1, 0.13, 0.03, 0, -0.2, -0.072, 0xdedede);             // 허벅지 주머니
  b.box(0.104, 0.02, 0.032, 0, -0.138, -0.073, 0xc4c4c4);
  return b.build();
}

export function shinGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.sphere(0.06, 0, 0, 0, W, 1, 1, 1, 8, 5);
  b.cyl(0.058, 0.046, 0.42, 0, -0.21, 0, W, 0, 0, 0, 9);
  b.box(0.085, 0.1, 0.035, 0, -0.035, -0.054, 0x4a4c4e);         // 무릎 보호대
  b.cyl(0.05, 0.05, 0.05, 0, -0.4, 0, 0xc8c8c8, 0, 0, 0, 8);      // 바짓단
  return b.build();
}

export function bootGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.box(0.112, 0.032, 0.29, 0, -0.077, -0.068, 0x1e1f20);         // 밑창
  b.box(0.102, 0.07, 0.25, 0, -0.04, -0.06, 0x45474a);            // 발등
  b.box(0.098, 0.03, 0.06, 0, -0.03, -0.17, 0x3a3c3e, 0.35, 0, 0); // 앞코
  b.cyl(0.052, 0.056, 0.13, 0, 0.01, 0, 0x45474a, 0, 0, 0, 8);    // 발목
  b.box(0.06, 0.006, 0.1, 0, 0.0, -0.08, 0x2c2c2c);               // 끈
  return b.build();
}

/** 완장·적외선 패치: 작은 상자 (인스턴스 크기로 조절) */
export function bandGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.box(0.122, 0.04, 0.122, 0, 0, 0, W);
  return b.build();
}

/** 먼 거리용 한 덩어리 병사 (발 원점, 1.8 m) */
export function lodGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const gear = 0xb0b0b0, dark = 0x2a2a2a, helm = 0x9a9a9a;
  b.box(0.13, 0.86, 0.15, -0.1, 0.5, 0, W);                       // 다리
  b.box(0.13, 0.86, 0.15, 0.1, 0.5, -0.04, W);
  b.box(0.13, 0.08, 0.26, -0.1, 0.04, -0.06, dark);
  b.box(0.13, 0.08, 0.26, 0.1, 0.04, -0.1, dark);
  b.box(0.4, 0.55, 0.26, 0, 1.2, 0, W);                           // 몸통
  b.box(0.36, 0.32, 0.32, 0, 1.28, 0.0, gear);                    // 조끼
  b.box(0.28, 0.34, 0.14, 0, 1.28, 0.22, gear);                   // 배낭
  b.box(0.1, 0.45, 0.11, -0.25, 1.22, -0.1, W, 0.7, 0, 0);       // 팔
  b.box(0.1, 0.45, 0.11, 0.25, 1.22, -0.1, W, 0.7, 0, 0);
  b.sphere(0.11, 0, 1.66, 0, 0xe0e0e0, 0.95, 1.1, 1);              // 머리
  b.dome(0.135, Math.PI * 0.55, 0, 1.68, 0, helm, 1, 0.95, 1.08, 8, 4);
  b.box(0.05, 0.08, 0.85, 0.08, 1.2, -0.3, dark);                 // 총
  return b.build();
}

// ───────── 총 (원점 = 오른손 손잡이, 총구 -Z) ─────────
export type GunShape = 'rifle' | 'smg' | 'lmg' | 'sniper' | 'pistol' | 'launcher' | 'device';
export const GUN_SHAPES: GunShape[] = ['rifle', 'smg', 'lmg', 'sniper', 'pistol', 'launcher', 'device'];
/** 왼손이 잡는 곳 (총 기준 z, y), 조준선 높이 */
export const GUN_GRIP: Record<GunShape, { lz: number; ly: number; sight: number }> = {
  rifle: { lz: -0.33, ly: 0.025, sight: 0.13 },
  smg: { lz: -0.22, ly: 0.02, sight: 0.12 },
  lmg: { lz: -0.36, ly: 0.02, sight: 0.14 },
  sniper: { lz: -0.38, ly: 0.025, sight: 0.15 },
  pistol: { lz: 0.0, ly: -0.015, sight: 0.075 },
  launcher: { lz: -0.33, ly: 0.0, sight: 0.17 },
  device: { lz: -0.05, ly: 0.0, sight: 0.05 },
};

export function gunGeo(shape: GunShape): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const k = 0x2a2c2e, m = 0x3d4042, l = 0x55585a, p = 0x1b1c1d;
  switch (shape) {
    case 'rifle':
      b.box(0.05, 0.075, 0.34, 0, 0.06, -0.06, k);
      b.box(0.056, 0.062, 0.3, 0, 0.065, -0.38, m);
      b.box(0.012, 0.012, 0.3, 0, 0.1, -0.33, l);                 // 위 레일
      b.cylZ(0.011, 0.17, 0, 0.065, -0.61, p, 6);
      b.cylZ(0.017, 0.055, 0, 0.065, -0.715, p, 7);
      b.box(0.045, 0.085, 0.2, 0, 0.045, 0.22, k);
      b.box(0.048, 0.11, 0.025, 0, 0.035, 0.33, p);
      b.box(0.034, 0.09, 0.042, 0, -0.01, 0.015, p, 0.3, 0, 0);
      b.box(0.03, 0.14, 0.065, 0, -0.035, -0.11, k, -0.22, 0, 0);
      b.box(0.034, 0.05, 0.1, 0, 0.125, -0.07, p);                // 도트 조준경
      b.box(0.03, 0.03, 0.006, 0, 0.13, -0.12, 0x5577aa);
      break;
    case 'smg':
      b.box(0.05, 0.08, 0.26, 0, 0.055, -0.07, k);
      b.box(0.052, 0.05, 0.12, 0, 0.06, -0.25, m);
      b.cylZ(0.013, 0.12, 0, 0.065, -0.36, p, 6);
      b.cylZ(0.022, 0.12, 0, 0.065, -0.44, p, 8);                  // 소음기 같은 총구
      b.box(0.03, 0.06, 0.18, 0, 0.06, 0.15, m);
      b.box(0.04, 0.09, 0.02, 0, 0.04, 0.24, p);
      b.box(0.032, 0.085, 0.04, 0, -0.01, 0.01, p, 0.28, 0, 0);
      b.box(0.028, 0.15, 0.04, 0, -0.06, -0.1, k);
      b.box(0.03, 0.045, 0.08, 0, 0.115, -0.07, p);
      break;
    case 'lmg':
      b.box(0.068, 0.095, 0.42, 0, 0.065, -0.06, k);
      b.box(0.06, 0.06, 0.28, 0, 0.06, -0.4, m);
      b.cylZ(0.016, 0.34, 0, 0.07, -0.7, p, 7);
      b.cylZ(0.022, 0.07, 0, 0.07, -0.88, p, 7);
      b.box(0.012, 0.06, 0.012, 0, 0.12, -0.3, l);                 // 운반 손잡이 기둥
      b.box(0.014, 0.012, 0.16, 0, 0.15, -0.24, l);
      b.box(0.11, 0.11, 0.12, -0.035, -0.04, -0.12, 0x4a4e3c);     // 탄통
      b.box(0.05, 0.095, 0.22, 0, 0.04, 0.24, k);
      b.box(0.034, 0.09, 0.042, 0, -0.01, 0.015, p, 0.3, 0, 0);
      b.box(0.01, 0.01, 0.3, -0.018, 0.035, -0.55, l);             // 접은 양각대
      b.box(0.01, 0.01, 0.3, 0.018, 0.035, -0.55, l);
      b.box(0.034, 0.055, 0.12, 0, 0.14, -0.06, p);
      break;
    case 'sniper':
      b.box(0.052, 0.07, 0.4, 0, 0.055, -0.06, k);
      b.box(0.058, 0.06, 0.26, 0, 0.055, -0.38, m);
      b.cylZ(0.013, 0.56, 0, 0.065, -0.78, p, 7);
      b.cylZ(0.02, 0.07, 0, 0.065, -1.08, p, 7);
      b.box(0.05, 0.1, 0.26, 0, 0.04, 0.26, k);
      b.box(0.05, 0.03, 0.14, 0, 0.1, 0.22, m);                   // 뺨 받침
      b.box(0.034, 0.09, 0.042, 0, -0.01, 0.015, p, 0.3, 0, 0);
      b.box(0.03, 0.08, 0.06, 0, -0.025, -0.1, k);
      b.cylZ(0.022, 0.3, 0, 0.145, -0.08, p, 10);                 // 조준경
      b.cylZ(0.03, 0.06, 0, 0.145, -0.25, p, 10);
      b.cylZ(0.027, 0.05, 0, 0.145, 0.085, p, 10);
      b.box(0.02, 0.04, 0.02, 0, 0.115, -0.08, l);
      b.sphere(0.014, 0.045, 0.07, 0.04, l);                       // 노리쇠 손잡이
      break;
    case 'pistol':
      b.box(0.03, 0.036, 0.19, 0, 0.065, -0.06, k);
      b.box(0.028, 0.03, 0.15, 0, 0.035, -0.05, m);
      b.box(0.028, 0.11, 0.046, 0, 0.0, 0.01, p, 0.22, 0, 0);
      b.box(0.006, 0.012, 0.01, 0, 0.088, -0.145, l);
      break;
    case 'launcher': {
      const t = 0x6d7260, tb = 0x4f5346;
      b.cylZ(0.056, 1.1, 0, 0.11, -0.15, t, 12);
      b.cylZ(0.068, 0.12, 0, 0.11, -0.68, tb, 12);
      b.cylZ(0.066, 0.14, 0, 0.11, 0.38, tb, 12);
      b.box(0.04, 0.08, 0.06, -0.075, 0.15, -0.12, p);             // 조준기
      b.box(0.012, 0.03, 0.012, -0.075, 0.2, -0.12, l);
      b.box(0.034, 0.1, 0.042, 0, 0.01, 0.0, p, 0.25, 0, 0);       // 손잡이
      b.box(0.03, 0.1, 0.04, 0, 0.02, -0.33, p, 0.15, 0, 0);       // 앞 손잡이
      b.cylZ(0.05, 0.12, 0, 0.11, -0.8, 0x7a6a50, 8, 0.02);        // 탄두 끝
      break;
    }
    case 'device':
      b.box(0.1, 0.07, 0.15, 0, 0.0, -0.05, 0xdddddd);
      b.box(0.08, 0.02, 0.1, 0, 0.042, -0.06, 0xaaaaaa);
      b.box(0.03, 0.03, 0.03, 0.03, 0.05, -0.1, 0x333333);
      break;
  }
  return b.build();
}
