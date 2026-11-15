// 차량 모델 (전차·보병전투차·경전술차량·공격 헬기). 진영·종류별 본보기를 한 번 만들고 복제해서 쓴다.
// 원점 = 차체 바닥 중심, 앞 -Z. group.rotation = (pitch, yaw, roll, 'YXZ'). 포탑 Ry(tYaw), 포 Rx(tPitch).
import * as THREE from 'three';
import type { Game, Vehicle, VehicleType, Side, Quality } from '../types';
import { FACTIONS, VEHICLES } from '../defs';
import { GeoBuilder, camoTexture, inView, type ActorCtx } from './actor-geo';

// 정점 색 (hull 은 위장 무늬에 곱해짐)
const HW = 0xffffff, HP = 0x8c8c8c, HL = 0xd4d4d4;
const RUB = 0x1c1d1e, STEEL = 0x3a3c3e, GM = 0x4a4d50, LM = 0x70757a, OLV = 0x5e6448, CAN = 0x7d7a66, LENS = 0xd8d4c0, RED = 0x8a1a14, BLK = 0x121314;

interface WheelSpec { x: number; y: number; z: number; r: number; w: number; steer: boolean }
interface TrackSpec { zf: number; zr: number; cy: number; r: number; x: number[]; n: number; sp: number; per: number }
interface Meta {
  wheels: WheelSpec[];
  track: TrackSpec | null;
  radius: number; h: number;
  turretPop: boolean;
}
interface Template { group: THREE.Group; meta: Meta }

interface VModel {
  key: string; type: VehicleType; side: Side;
  group: THREE.Group; meta: Meta;
  turret: THREE.Object3D | null; gun: THREE.Object3D | null; turretBase: THREE.Vector3;
  cupMg: THREE.Object3D | null;
  wheels: THREE.InstancedMesh | null; tracks: THREE.InstancedMesh | null;
  rotor: THREE.Object3D | null; disc: THREE.Mesh | null; discMat: THREE.MeshBasicMaterial | null; tail: THREE.Object3D | null;
  meshes: THREE.Mesh[];
  normal: THREE.Material[]; charred: THREE.Material[];
  dead: boolean; dist: number; steer: number; spool: number; inited: boolean;
}

interface Mats { hull: THREE.MeshStandardMaterial; mech: THREE.MeshStandardMaterial; glass: THREE.MeshStandardMaterial }

class VB {
  hull = new GeoBuilder();
  mech = new GeoBuilder();
  glass = new GeoBuilder();
}

const _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();
const XA = new THREE.Vector3(1, 0, 0);

function sizeOf(t: VehicleType): { x: number; y: number; z: number } {
  const d = VEHICLES[t];
  if (d && d.size) return d.size;
  return t === 'mbt' ? { x: 3.7, y: 2.4, z: 7.8 } : t === 'ifv' ? { x: 3.3, y: 2.7, z: 6.9 } : t === 'ltv' ? { x: 2.4, y: 2.0, z: 5.0 } : { x: 2.8, y: 3.4, z: 13.5 };
}

// ───────── 바퀴·궤도 기하 (단위 크기, 모든 차량 공용) ─────────
let tireGeo: THREE.BufferGeometry | null = null;
let roadGeo: THREE.BufferGeometry | null = null;
function tire(): THREE.BufferGeometry {
  if (tireGeo) return tireGeo;
  const b = new GeoBuilder();
  b.cylX(1, 1, 0, 0, 0, RUB, 18);
  b.cylX(0.62, 1.04, 0, 0, 0, GM, 12);                    // 휠
  b.cylX(0.22, 1.1, 0, 0, 0, LM, 8);                      // 허브
  for (let i = 0; i < 16; i++) {                           // 트레드
    const a = (i / 16) * Math.PI * 2;
    b.add(new THREE.BoxGeometry(0.9, 0.12, 0.22), new THREE.Matrix4().makeRotationX(a).multiply(new THREE.Matrix4().makeTranslation(0, 0.98, 0)), 0x151617);
  }
  for (let i = 0; i < 6; i++) {                            // 볼트
    const a = (i / 6) * Math.PI * 2;
    b.cylX(0.06, 1.12, 0, Math.cos(a) * 0.4, Math.sin(a) * 0.4, STEEL, 5);
  }
  tireGeo = b.build();
  return tireGeo;
}
function road(): THREE.BufferGeometry {
  if (roadGeo) return roadGeo;
  const b = new GeoBuilder();
  b.cylX(1, 1, 0, 0, 0, RUB, 18);
  b.cylX(0.88, 1.06, 0, 0, 0, GM, 16);
  b.cylX(0.3, 1.14, 0, 0, 0, LM, 8);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.cylX(0.11, 1.1, 0, Math.cos(a) * 0.6, Math.sin(a) * 0.6, STEEL, 6);
  }
  roadGeo = b.build();
  return roadGeo;
}

// ───────── 종류별 모델 ─────────

function buildMBT(W: number, H: number, L: number, mark: number, root: THREE.Group, mats: Mats): Meta {
  const vb = new VB();
  const tw = W * 0.2, tx = W / 2 - tw / 2;
  const Hd = H * 0.58;
  // 아래 차체 (궤도 사이), 위 차체 (궤도 위까지 넓게, 경사 전면)
  vb.hull.box(W - 2 * tw - 0.02, 0.62, L * 0.88, 0, 0.62, 0.05, HL);
  vb.hull.box(W - 2 * tw - 0.02, 0.62, 0.08, 0, 0.66, -L * 0.43, HL, -0.95, 0, 0);
  vb.hull.sideExtrude([[L / 2, 0.92], [L / 2, Hd - 0.06], [L / 2 - 0.15, Hd], [-L * 0.27, Hd], [-L / 2, 1.04], [-L / 2, 0.92]], W - 0.04, 0, HW, 0.03);
  // 옆 치마판
  for (const sd of [-1, 1]) {
    vb.hull.box(0.07, 0.5, L * 0.84, sd * (W / 2 + 0.005), 0.76, -L * 0.02, HW);
    vb.hull.box(0.075, 0.05, L * 0.84, sd * (W / 2 + 0.008), 0.52, -L * 0.02, HP);
    for (let i = 1; i < 6; i++) vb.hull.box(0.078, 0.48, 0.025, sd * (W / 2 + 0.01), 0.76, -L * 0.44 + (L * 0.84 * i) / 6, HP);
    vb.mech.box(0.1, 0.12, 0.6, sd * (W / 2 - 0.2), Hd + 0.06, L * 0.1, OLV);          // 공구함
    vb.mech.cylZ(0.025, L * 0.5, sd * (W / 2 - 0.06), 1.0, -L * 0.05, STEEL, 5);          // 견인 줄
  }
  // 덮개 판 선, 조종수 해치·잠망경
  vb.hull.box(W - 0.3, 0.014, 0.03, 0, Hd + 0.005, L * 0.18, HP);
  vb.hull.box(0.03, 0.014, L * 0.3, -0.9, Hd + 0.005, L * 0.33, HP);
  vb.hull.box(0.03, 0.014, L * 0.3, 0.9, Hd + 0.005, L * 0.33, HP);
  vb.hull.cyl(0.32, 0.33, 0.06, 0, Hd + 0.03, -L * 0.33, HL, 0, 0, 0, 12);
  for (const x of [-0.18, 0, 0.18]) vb.glass.box(0.12, 0.05, 0.05, x, Hd + 0.07, -L * 0.37);
  // 엔진 덮개 그릴, 배기구, 등
  for (let i = 0; i < 5; i++) vb.mech.box(W * 0.5, 0.02, 0.07, 0, Hd + 0.012, L * 0.3 + i * 0.14, 0x252729);
  for (const sd of [-1, 1]) {
    vb.mech.box(0.6, 0.16, 0.04, sd * 0.8, 1.12, L / 2 + 0.02, 0x2b2b2b);
    vb.mech.box(0.12, 0.06, 0.03, sd * (W / 2 - 0.3), 1.3, L / 2 + 0.01, RED);
    vb.mech.box(0.16, 0.1, 0.06, sd * (W / 2 - 0.35), 1.1, -L / 2 - 0.02, LENS);
    vb.mech.box(0.09, 0.12, 0.12, sd * 0.6, 0.86, -L / 2 - 0.04, STEEL);
  }
  // 궤도 위 귀환 롤러
  for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) vb.mech.cylX(0.09, tw * 0.5, sd * tx, 0.83, -L * 0.2 + i * L * 0.2, GM, 8);
  finish(vb, root, mats);

  // 포탑
  const tur = new THREE.Group(); tur.name = 'turret';
  tur.position.set(0, Hd, 0.15);
  root.add(tur);
  const tb = new VB();
  const Wt = W * 0.66, Lt = L * 0.44, Ht = Math.max(0.5, H - Hd - 0.38);
  tb.hull.topExtrude([[-Wt / 2, -Lt * 0.42], [Wt / 2, -Lt * 0.42], [Wt / 2, Lt * 0.22], [Wt * 0.3, Lt * 0.55], [-Wt * 0.3, Lt * 0.55], [-Wt / 2, Lt * 0.22]], Ht, 0, HW, 0.05);
  tb.mech.cyl(1.0, 1.05, 0.08, 0, 0.0, 0, STEEL, 0, 0, 0, 16);
  // 뒤 바구니 + 짐
  for (const sd of [-1, 1]) tb.mech.box(0.04, 0.3, 0.75, sd * Wt * 0.45, Ht * 0.55, Lt * 0.62, STEEL);
  tb.mech.box(Wt * 0.9, 0.04, 0.04, 0, Ht * 0.85, Lt * 0.99, STEEL);
  tb.mech.box(Wt * 0.9, 0.04, 0.75, 0, Ht * 0.25, Lt * 0.62, STEEL);
  tb.mech.box(Wt * 0.5, 0.28, 0.45, -Wt * 0.15, Ht * 0.45, Lt * 0.62, CAN);
  tb.mech.box(Wt * 0.3, 0.2, 0.4, Wt * 0.25, Ht * 0.4, Lt * 0.64, OLV);
  // 포수 조준경, 연막탄 발사기, 안테나, 판 선, 진영 표시
  tb.hull.box(0.36, 0.3, 0.46, -Wt * 0.28, Ht + 0.15, -Lt * 0.2, HL);
  tb.glass.box(0.26, 0.18, 0.02, -Wt * 0.28, Ht + 0.17, -Lt * 0.2 - 0.235);
  for (const sd of [-1, 1]) {
    for (let i = 0; i < 4; i++) tb.mech.add(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 7), mkM(sd * (Wt * 0.42 + i * 0.03), Ht * 0.6 + i * 0.05, -Lt * 0.2, -1.1, sd * 0.4, 0), GM);
    tb.mech.cyl(0.012, 0.012, 1.7, sd * Wt * 0.4, Ht + 0.85, Lt * 0.4, STEEL, 0, 0, 0, 4);
    tb.hull.box(0.02, Ht * 0.7, 0.025, sd * (Wt / 2 + 0.052), Ht * 0.5, Lt * 0.05, HP);
    tb.mech.box(0.02, 0.22, 0.42, sd * (Wt / 2 + 0.058), Ht * 0.55, -Lt * 0.18, mark);
  }
  tb.hull.box(Wt * 0.8, 0.012, 0.025, 0, Ht + 0.003, Lt * 0.1, HP);
  finish(tb, tur, mats);
  // 포
  const gun = new THREE.Group(); gun.name = 'gun';
  gun.position.set(0, Ht * 0.45, -Lt * 0.45);
  tur.add(gun);
  const gb = new VB();
  const Lb = L * 0.66;
  gb.hull.box(0.78, 0.5, 0.5, 0, 0, -0.1, HL);
  gb.mech.cylZ(0.072, Lb, 0, 0, -(0.35 + Lb / 2), GM, 10);
  gb.hull.cylZ(0.09, Lb * 0.24, 0, 0, -(0.35 + Lb * 0.14), HW, 10);
  gb.hull.cylZ(0.088, Lb * 0.2, 0, 0, -(0.35 + Lb * 0.75), HW, 10);
  gb.hull.cylZ(0.115, 0.42, 0, 0, -(0.35 + Lb * 0.47), HL, 10);
  // 포구 제퇴기
  gb.mech.box(0.24, 0.18, 0.34, 0, 0, -(0.35 + Lb + 0.12), STEEL);
  for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) gb.mech.box(0.02, 0.11, 0.05, sd * 0.122, 0, -(0.35 + Lb + 0.02 + i * 0.1), BLK);
  gb.mech.cylZ(0.05, 0.02, 0, 0, -(0.35 + Lb + 0.3), BLK, 8);
  gb.mech.box(0.1, 0.1, 0.35, 0.3, -0.1, -0.35, STEEL);       // 동축 기관총
  gb.mech.cylZ(0.015, 0.3, 0.3, -0.1, -0.65, BLK, 5);
  finish(gb, gun, mats);
  // 전차장 해치 (차체 고정: 좌석 위치와 맞춘다)
  const seat = VEHICLES.mbt?.seats[1]?.offset ?? { x: 0.7, y: 2.75, z: 0.7 };
  const cup = new THREE.Group(); cup.name = 'cupola';
  cup.position.set(seat.x, Hd + Ht, seat.z);
  root.add(cup);
  const cb = new VB();
  cb.hull.cyl(0.38, 0.41, 0.18, 0, 0.09, 0, HL, 0, 0, 0, 14);
  cb.mech.cyl(0.3, 0.3, 0.19, 0, 0.1, 0, BLK, 0, 0, 0, 12);
  cb.hull.cyl(0.33, 0.33, 0.05, 0, 0.34, 0.36, HL, -1.25, 0, 0, 12);   // 열린 뚜껑
  for (let i = 0; i < 5; i++) { const a = -0.9 + i * 0.45; cb.glass.box(0.09, 0.05, 0.03, Math.sin(a) * 0.39, 0.13, -Math.cos(a) * 0.39, 0xffffff, 0, -a, 0); }
  finish(cb, cup, mats);
  const mg = new THREE.Group(); mg.name = 'cupmg';
  mg.position.set(0, 0.3, 0);
  cup.add(mg);
  const mb = new VB();
  mb.mech.box(0.04, 0.3, 0.04, 0, -0.12, -0.36, STEEL);
  mb.mech.box(0.09, 0.11, 0.42, 0, 0.06, -0.42, GM);
  mb.mech.cylZ(0.016, 0.55, 0, 0.07, -0.9, BLK, 6);
  mb.mech.box(0.1, 0.12, 0.14, -0.1, 0.02, -0.4, OLV);
  finish(mb, mg, mats);

  // 바퀴
  const wheels: WheelSpec[] = [];
  for (const sd of [-1, 1]) {
    for (let i = 0; i < 6; i++) wheels.push({ x: sd * tx, y: 0.36, z: -L * 0.34 + (L * 0.68 * i) / 5, r: 0.34, w: tw * 0.78, steer: false });
    wheels.push({ x: sd * tx, y: 0.5, z: -L * 0.43, r: 0.28, w: tw * 0.7, steer: false });
    wheels.push({ x: sd * tx, y: 0.5, z: L * 0.43, r: 0.31, w: tw * 0.7, steer: false });
  }
  addWheels(root, wheels, road(), mats);
  // 궤도
  const zf = -L * 0.43, zr = L * 0.43, r = 0.43, cy = 0.46;
  const per = 2 * (zr - zf) + 2 * Math.PI * r;
  const n = Math.floor(per / 0.18);
  const track: TrackSpec = { zf, zr, cy, r, x: [-tx, tx], n, sp: per / n, per };
  const sb = new GeoBuilder();
  sb.box(tw, 0.06, per / n - 0.015, 0, 0, 0, RUB);
  sb.box(tw * 1.02, 0.03, 0.045, 0, -0.04, 0, 0x2a2b2c);
  sb.box(0.08, 0.07, 0.08, 0, 0.06, 0, STEEL);
  const tm = new THREE.InstancedMesh(sb.build(), mats.mech, n * 2);
  tm.name = 'tracks';
  tm.frustumCulled = false;
  root.add(tm);
  return { wheels, track, radius: Math.hypot(L * 0.5 + Lb * 0.6, W / 2, H / 2) + 0.5, h: H, turretPop: true };
}

function buildIFV(W: number, H: number, L: number, mark: number, root: THREE.Group, mats: Mats): Meta {
  const vb = new VB();
  const Ht = H * 0.72;
  vb.hull.sideExtrude([[L * 0.48, 0.5], [L / 2, 0.8], [L / 2, 1.25], [-L / 2, 1.25], [-L / 2, 0.95], [-L * 0.42, 0.5]], W * 0.58, 0, HL, 0.02);
  vb.hull.sideExtrude([[L / 2, 1.2], [L / 2, Ht - 0.05], [L / 2 - 0.1, Ht], [-L * 0.18, Ht], [-L / 2, 1.48], [-L / 2, 1.2]], W * 0.96, 0, HW, 0.04);
  for (const sd of [-1, 1]) {
    const x = sd * W * 0.48;
    // 판 선, 관측창, 짐 상자
    for (const z of [-L * 0.25, L * 0.02, L * 0.24]) vb.hull.box(0.02, Ht - 1.3, 0.025, x + sd * 0.01, (Ht + 1.25) / 2, z, HP);
    vb.hull.box(0.02, 0.025, L * 0.9, x + sd * 0.012, 1.24, 0, HP);
    for (let i = 0; i < 3; i++) vb.glass.box(0.03, 0.08, 0.14, x + sd * 0.01, Ht - 0.22, L * 0.05 + i * 0.6);
    vb.mech.box(0.16, 0.3, 0.9, x + sd * 0.07, Ht - 0.45, L * 0.32, OLV);
    vb.mech.box(0.02, 0.3, 0.5, x + sd * 0.02, Ht - 0.4, -L * 0.1, mark);
    vb.mech.box(0.14, 0.09, 0.05, sd * (W * 0.38), 1.36, -L / 2 - 0.02, LENS);
    vb.mech.box(0.1, 0.06, 0.03, sd * (W * 0.38), 1.5, L / 2 + 0.01, RED);
  }
  // 뒷문
  vb.hull.box(1.2, 1.0, 0.04, 0, 0.95 + 0.2, L / 2 + 0.03, HL);
  vb.hull.box(1.24, 0.03, 0.045, 0, 1.69, L / 2 + 0.035, HP);
  vb.hull.box(1.24, 0.03, 0.045, 0, 0.66, L / 2 + 0.035, HP);
  vb.hull.box(0.03, 1.04, 0.045, -0.62, 1.17, L / 2 + 0.035, HP);
  vb.hull.box(0.03, 1.04, 0.045, 0.62, 1.17, L / 2 + 0.035, HP);
  vb.glass.box(0.18, 0.12, 0.02, 0.25, 1.45, L / 2 + 0.055);
  vb.mech.box(0.3, 0.05, 0.06, -0.2, 1.2, L / 2 + 0.07, STEEL);
  // 지붕 해치, 앞 배기 그릴, 견인 고리
  vb.hull.cyl(0.32, 0.32, 0.05, -0.55, Ht + 0.025, L * 0.3, HL, 0, 0, 0, 12);
  vb.hull.cyl(0.32, 0.32, 0.05, 0.55, Ht + 0.025, L * 0.3, HL, 0, 0, 0, 12);
  vb.hull.box(0.6, 0.4, 0.04, 0.5, Ht - 0.18, -L * 0.3, HL);
  for (let i = 0; i < 4; i++) vb.mech.box(0.55, 0.025, 0.05, 0.5, Ht - 0.32 + i * 0.09, -L * 0.3 - 0.02, 0x252729);
  for (const sd of [-1, 1]) vb.mech.box(0.08, 0.12, 0.12, sd * 0.55, 0.8, -L / 2 - 0.03, STEEL);
  vb.mech.cyl(0.012, 0.012, 1.8, -W * 0.4, Ht + 0.9, L * 0.4, STEEL, 0, 0, 0, 4);
  finish(vb, root, mats);

  const tur = new THREE.Group(); tur.name = 'turret';
  tur.position.set(0, Ht, -0.2);
  root.add(tur);
  const tb = new VB();
  const Wt = W * 0.48, Lt = L * 0.3, Th = Math.max(0.45, H - Ht - 0.15);
  tb.hull.topExtrude([[-Wt / 2, -Lt * 0.45], [Wt / 2, -Lt * 0.45], [Wt / 2, Lt * 0.2], [Wt * 0.25, Lt * 0.5], [-Wt * 0.25, Lt * 0.5], [-Wt / 2, Lt * 0.2]], Th, 0, HW, 0.04);
  tb.mech.cyl(0.75, 0.78, 0.06, 0, 0, 0, STEEL, 0, 0, 0, 14);
  tb.mech.box(0.3, 0.3, 1.1, -Wt / 2 - 0.2, Th * 0.6, 0, OLV);              // 대전차 미사일 발사관
  tb.mech.box(0.24, 0.24, 0.02, -Wt / 2 - 0.2, Th * 0.6, -0.56, BLK);
  tb.hull.box(0.28, 0.26, 0.36, Wt * 0.22, Th + 0.13, -Lt * 0.1, HL);       // 조준경
  tb.glass.box(0.2, 0.14, 0.02, Wt * 0.22, Th + 0.15, -Lt * 0.1 - 0.19);
  for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) tb.mech.add(new THREE.CylinderGeometry(0.04, 0.04, 0.18, 7), mkM(sd * (Wt * 0.4), Th * 0.5 + i * 0.07, -Lt * 0.28, -1.15, sd * 0.4, 0), GM);
  tb.hull.box(0.02, Th * 0.6, 0.02, Wt / 2 + 0.042, Th * 0.5, Lt * 0.05, HP);
  finish(tb, tur, mats);
  const gun = new THREE.Group(); gun.name = 'gun';
  gun.position.set(0, Th * 0.5, -Lt * 0.45);
  tur.add(gun);
  const gb = new VB();
  gb.hull.box(0.42, 0.32, 0.3, 0, 0, -0.05, HL);
  gb.mech.cylZ(0.042, 2.2, 0, 0, -1.3, GM, 8);
  gb.mech.cylZ(0.058, 0.22, 0, 0, -2.45, STEEL, 8);
  gb.mech.cylZ(0.055, 0.35, 0, 0, -0.35, STEEL, 8);
  gb.mech.cylZ(0.014, 0.5, 0.15, -0.06, -0.45, BLK, 5);
  finish(gb, gun, mats);

  const wheels: WheelSpec[] = [];
  const zs = [-L * 0.35, -L * 0.14, L * 0.12, L * 0.34];
  for (const sd of [-1, 1]) zs.forEach((z, i) => wheels.push({ x: sd * (W / 2 - 0.28), y: 0.55, z, r: 0.55, w: 0.42, steer: i < 2 }));
  addWheels(root, wheels, tire(), mats);
  return { wheels, track: null, radius: Math.hypot(L / 2 + 0.6, W / 2, H / 2) + 0.4, h: H, turretPop: true };
}

function buildLTV(W: number, H: number, L: number, mark: number, root: THREE.Group, mats: Mats): Meta {
  const vb = new VB();
  const roof = H - 0.18;
  vb.hull.box(W * 0.6, 0.42, L * 0.9, 0, 0.76, 0, HL);
  for (const sd of [-1, 1]) {
    vb.hull.box(W * 0.2, 0.06, L * 0.96, sd * W * 0.39, 1.0, 0, HW);            // 흙받이
    vb.hull.box(0.04, 0.24, L * 0.22, sd * W * 0.49, 0.88, -L * 0.31, HL);       // 바퀴 덮개
    vb.hull.box(0.04, 0.24, L * 0.22, sd * W * 0.49, 0.88, L * 0.31, HL);
  }
  // 보닛, 캐빈 (경사 앞유리), 짐칸
  vb.hull.sideExtrude([[-L * 0.12, 1.0], [-L * 0.12, 1.3], [-L * 0.46, 1.2], [-L / 2, 1.08], [-L / 2, 1.0]], W * 0.9, 0, HW, 0.03);
  vb.hull.sideExtrude([[L * 0.22, 1.0], [L * 0.22, roof], [-L * 0.02, roof], [-L * 0.12, 1.3], [-L * 0.12, 1.0]], W * 0.9, 0, HW, 0.03);
  vb.hull.box(W * 0.9, 0.42, L * 0.27, 0, 1.2, L * 0.365, HL);
  vb.hull.box(W * 0.8, 0.05, L * 0.25, 0, 1.43, L * 0.365, HP);
  // 앞유리 (두 장), 옆 창
  const sl = Math.atan2(L * 0.1, roof - 1.3);
  const wl = Math.hypot(L * 0.1, roof - 1.3);
  for (const sd of [-1, 1]) {
    vb.glass.add(new THREE.BoxGeometry(W * 0.38, wl * 0.86, 0.03), mkM(sd * W * 0.21, (1.3 + roof) / 2 + 0.01, -L * 0.07 - 0.03, sl, 0, 0), 0xffffff);
    for (const z of [-L * 0.05, L * 0.13]) vb.glass.box(0.03, 0.36, L * 0.13, sd * (W * 0.45 + 0.012), roof - 0.3, z);
    vb.hull.box(0.02, 0.62, 0.025, sd * (W * 0.45 + 0.015), 1.38, L * 0.04, HP);      // 문 틈
    vb.hull.box(0.02, 0.025, L * 0.32, sd * (W * 0.45 + 0.015), 1.1, L * 0.05, HP);
    vb.mech.box(0.06, 0.03, 0.12, sd * (W * 0.45 + 0.03), 1.25, -L * 0.07, STEEL);    // 손잡이
    vb.mech.box(0.02, 0.24, 0.36, sd * (W * 0.45 + 0.02), 1.6, L * 0.17, mark);
    vb.mech.box(0.04, 0.16, 0.1, sd * (W * 0.5 + 0.06), 1.55, -L * 0.12, BLK);       // 거울
    vb.mech.box(0.12, 0.03, 0.03, sd * (W * 0.5), 1.55, -L * 0.12, STEEL);
    vb.mech.box(0.16, 0.1, 0.05, sd * W * 0.33, 1.12, -L / 2 - 0.02, LENS);
    vb.mech.box(0.08, 0.1, 0.03, sd * W * 0.4, 1.25, L / 2 + 0.01, RED);
  }
  // 범퍼 철망, 예비 바퀴, 안테나
  vb.mech.box(W * 0.85, 0.08, 0.08, 0, 0.75, -L / 2 - 0.1, STEEL);
  vb.mech.box(W * 0.85, 0.06, 0.06, 0, 1.05, -L / 2 - 0.1, STEEL);
  for (const sd of [-1, 1]) vb.mech.box(0.06, 0.36, 0.06, sd * W * 0.3, 0.9, -L / 2 - 0.1, STEEL);
  vb.mech.cylZ(0.42, 0.28, 0, 1.12, L / 2 + 0.16, RUB, 16);
  vb.mech.cylZ(0.24, 0.3, 0, 1.12, L / 2 + 0.16, GM, 10);
  vb.mech.cyl(0.01, 0.01, 1.6, -W * 0.4, roof + 0.8, L * 0.2, STEEL, 0, 0, 0, 4);
  vb.hull.box(W * 0.86, 0.02, 0.03, 0, roof + 0.002, L * 0.1, HP);
  finish(vb, root, mats);

  // 지붕 기관총 고리
  const seat = VEHICLES.ltv?.seats[1]?.offset ?? { x: 0, y: 2.2, z: 0.5 };
  const tur = new THREE.Group(); tur.name = 'turret';
  tur.position.set(seat.x, roof, seat.z);
  root.add(tur);
  const tb = new VB();
  tb.hull.cyl(0.46, 0.48, 0.1, 0, 0.05, 0, HL, 0, 0, 0, 16);
  tb.mech.cyl(0.4, 0.4, 0.11, 0, 0.055, 0, BLK, 0, 0, 0, 14);
  tb.hull.box(0.72, 0.42, 0.04, 0, 0.36, -0.5, HW, 0.12, 0, 0);              // 방패
  tb.hull.box(0.3, 0.38, 0.04, -0.46, 0.34, -0.4, HW, 0.12, 0.6, 0);
  tb.hull.box(0.3, 0.38, 0.04, 0.46, 0.34, -0.4, HW, 0.12, -0.6, 0);
  tb.glass.box(0.18, 0.1, 0.02, 0.18, 0.46, -0.53, 0xffffff, 0.12, 0, 0);
  finish(tb, tur, mats);
  const gun = new THREE.Group(); gun.name = 'gun';
  gun.position.set(0, 0.4, -0.3);
  tur.add(gun);
  const gb = new VB();
  gb.mech.box(0.12, 0.14, 0.55, 0, 0, -0.1, GM);
  gb.mech.cylZ(0.022, 0.9, 0, 0.01, -0.8, BLK, 6);
  gb.mech.cylZ(0.035, 0.12, 0, 0.01, -1.22, STEEL, 7);
  gb.mech.box(0.14, 0.16, 0.2, -0.15, -0.04, -0.12, OLV);
  gb.mech.box(0.04, 0.12, 0.04, 0, -0.12, 0.2, STEEL);
  finish(gb, gun, mats);

  const wheels: WheelSpec[] = [];
  for (const sd of [-1, 1]) for (const z of [-L * 0.31, L * 0.31]) wheels.push({ x: sd * (W / 2 - 0.22), y: 0.46, z, r: 0.46, w: 0.38, steer: z < 0 });
  addWheels(root, wheels, tire(), mats);
  return { wheels, track: null, radius: Math.hypot(L / 2 + 0.4, W / 2, H / 2) + 0.3, h: H, turretPop: false };
}

function buildHeli(W: number, H: number, L: number, mark: number, root: THREE.Group, mats: Mats): Meta {
  const vb = new VB();
  const k = L / 13.5;                    // 기본 13.5 m 기준 비율
  const fw = Math.min(1.1, W * 0.38);
  const Z = (z: number): number => z * k;
  // 동체 옆모습 (조종석 계단: 앞 사수 낮게, 뒤 조종사 높게)
  vb.hull.sideExtrude([
    [Z(-5.7), 1.0], [Z(-5.3), 0.78], [Z(-3.2), 0.66], [Z(1.8), 0.72], [Z(2.7), 1.45], [Z(2.7), 2.1], [Z(1.6), 2.62],
    [Z(-0.35), 2.62], [Z(-0.5), 1.55], [Z(-2.05), 1.5], [Z(-2.1), 1.22], [Z(-3.9), 1.2], [Z(-5.2), 1.16],
  ], fw, 0, HW, 0.06);
  // 캐노피 (틀 + 짙은 유리)
  vb.glass.sideExtrude([[Z(-4.0), 1.18], [Z(-3.55), 1.8], [Z(-2.15), 1.9], [Z(-2.08), 1.2]], fw * 0.92, 0, 0xffffff, 0.04);
  vb.glass.sideExtrude([[Z(-2.15), 1.48], [Z(-1.75), 2.3], [Z(-0.5), 2.38], [Z(-0.48), 1.52]], fw * 0.92, 0, 0xffffff, 0.04);
  vb.mech.box(fw * 0.96, 0.05, 0.06, 0, 1.9, Z(-2.15), STEEL);
  vb.mech.box(fw * 0.96, 0.05, 0.06, 0, 2.38, Z(-0.55), STEEL);
  vb.mech.box(0.05, 0.05, Z(1.45), 0, 1.86, Z(-2.85), STEEL);
  vb.mech.box(0.05, 0.05, Z(1.25), 0, 2.36, Z(-1.12), STEEL);
  // 기수 센서
  vb.mech.box(0.42, 0.42, 0.45, 0, 1.0, Z(-5.8), GM);
  vb.glass.box(0.18, 0.18, 0.02, 0.08, 1.02, Z(-5.8) - 0.23);
  // 엔진
  for (const sd of [-1, 1]) {
    vb.hull.cylZ(0.34, Z(1.9), sd * (fw / 2 + 0.22), 2.15, Z(0.6), HL, 12);
    vb.mech.cylZ(0.27, 0.04, sd * (fw / 2 + 0.22), 2.15, Z(0.6) - Z(0.95), BLK, 12);
    vb.mech.add(new THREE.CylinderGeometry(0.2, 0.24, 0.5, 8), mkM(sd * (fw / 2 + 0.3), 2.25, Z(1.75), -1.1, 0, sd * 0.4), 0x2a2a2a);
  }
  // 꼬리 붐, 수직 꼬리날개, 수평 안정판
  vb.hull.cylZ(0.2, Z(3.9), 0, 2.0, Z(4.35), HW, 12, 0.44);
  vb.hull.sideExtrude([[Z(5.8), 1.9], [Z(6.55), 3.15], [Z(6.95), 3.15], [Z(6.65), 1.9]], 0.13, 0, HW, 0.02);
  vb.hull.box(2.1, 0.07, 0.62, 0, 2.02, Z(6.0), HW);
  for (const sd of [-1, 1]) vb.mech.box(0.02, 0.28, 0.6, sd * 0.27, 2.0, Z(4.0), mark);
  // 짧은 날개 + 로켓 포드 + 미사일
  for (const sd of [-1, 1]) {
    vb.hull.box(1.75, 0.1, 1.0, sd * (fw / 2 + 0.85), 1.55, Z(0.2), HW, 0, 0, -sd * 0.06);
    vb.mech.box(0.08, 0.3, 0.5, sd * (fw / 2 + 0.65), 1.36, Z(0.2), STEEL);
    vb.mech.cylZ(0.21, 1.5, sd * (fw / 2 + 0.65), 1.08, Z(0.15), OLV, 12);
    vb.mech.cylZ(0.17, 0.03, sd * (fw / 2 + 0.65), 1.08, Z(0.15) - 0.76, BLK, 12);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      vb.mech.cylZ(0.065, 1.25, sd * (fw / 2 + 1.42 + i * 0.16), 1.32 - j * 0.16, Z(0.15), 0x6a6e5a, 7);
      vb.mech.cylZ(0.065, 0.12, sd * (fw / 2 + 1.42 + i * 0.16), 1.32 - j * 0.16, Z(0.15) - 0.66, 0x3a3a3a, 7, 0.02);
    }
  }
  // 바퀴 다리
  for (const sd of [-1, 1]) {
    vb.mech.box(0.08, 0.6, 0.08, sd * 0.75, 0.55, Z(-1.4), STEEL, 0, 0, sd * 0.5);
    vb.mech.cylX(0.28, 0.16, sd * 0.95, 0.28, Z(-1.4), RUB, 14);
    vb.mech.cylX(0.14, 0.18, sd * 0.95, 0.28, Z(-1.4), GM, 8);
  }
  vb.mech.box(0.06, 0.45, 0.06, 0, 0.42, Z(5.6), STEEL);
  vb.mech.cylX(0.16, 0.1, 0, 0.17, Z(5.6), RUB, 10);
  // 판 선, 돛대
  vb.hull.box(fw + 0.02, 0.02, 0.03, 0, 1.0, Z(-1.0), HP);
  vb.hull.box(fw + 0.02, 0.02, 0.03, 0, 1.0, Z(1.0), HP);
  vb.hull.box(fw + 0.02, 1.2, 0.025, 0, 1.6, Z(1.7), HP);
  vb.mech.cyl(0.12, 0.16, 0.55, 0, 2.88, Z(0.3), GM, 0, 0, 0, 10);
  finish(vb, root, mats);

  // 주 회전날개
  const R = L * 0.43;
  const rotor = new THREE.Group(); rotor.name = 'rotor';
  rotor.position.set(0, 3.17, Z(0.3));
  root.add(rotor);
  const rb = new VB();
  rb.mech.cyl(0.24, 0.24, 0.14, 0, 0, 0, STEEL, 0, 0, 0, 10);
  rb.mech.cyl(0.08, 0.08, 0.3, 0, 0.18, 0, STEEL, 0, 0, 0, 6);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    rb.mech.add(new THREE.BoxGeometry(R - 0.2, 0.05, 0.42), mkM(Math.cos(a) * (R / 2 + 0.1), 0.02, -Math.sin(a) * (R / 2 + 0.1), 0, a, 0.02), 0x2c2e30);
    rb.mech.add(new THREE.BoxGeometry(0.35, 0.052, 0.43), mkM(Math.cos(a) * (R - 0.25), 0.02, -Math.sin(a) * (R - 0.25), 0, a, 0), 0xd0c040);
  }
  finish(rb, rotor, mats);
  const discMat = new THREE.MeshBasicMaterial({ color: 0x1a1c1e, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 40), discMat);
  disc.name = 'disc';
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(0, 3.19, Z(0.3));
  disc.renderOrder = 2;
  root.add(disc);
  // 꼬리 회전날개 (X 축)
  const tail = new THREE.Group(); tail.name = 'tail';
  tail.position.set(0.16, 2.95, Z(6.55));
  root.add(tail);
  const tb2 = new VB();
  tb2.mech.cylX(0.08, 0.12, 0, 0, 0, STEEL, 8);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    tb2.mech.add(new THREE.BoxGeometry(0.03, 0.6, 0.16), mkM(0.06, Math.cos(a) * 0.32, Math.sin(a) * 0.32, a, 0, 0), 0x2c2e30);
  }
  finish(tb2, tail, mats);
  // 턱 기관포 포탑
  const tur = new THREE.Group(); tur.name = 'turret';
  tur.position.set(0, 0.62, Z(-4.6));
  root.add(tur);
  const cb = new VB();
  cb.mech.sphere(0.24, 0, 0, 0, GM, 1, 0.9, 1, 12, 8);
  cb.mech.cyl(0.18, 0.2, 0.14, 0, 0.14, 0, STEEL, 0, 0, 0, 10);
  finish(cb, tur, mats);
  const gun = new THREE.Group(); gun.name = 'gun';
  gun.position.set(0, -0.05, -0.12);
  tur.add(gun);
  const gb = new VB();
  gb.mech.box(0.14, 0.14, 0.45, 0, 0, -0.15, GM);
  gb.mech.cylZ(0.032, 1.25, 0, 0, -0.95, BLK, 7);
  gb.mech.cylZ(0.05, 0.12, 0, 0, -1.55, STEEL, 7);
  finish(gb, gun, mats);
  return { wheels: [], track: null, radius: Math.max(R, L / 2) + 1, h: H, turretPop: false };
}

function mkM(x: number, y: number, z: number, rx: number, ry: number, rz: number): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'YXZ');
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(1, 1, 1));
}

function finish(vb: VB, parent: THREE.Object3D, mats: Mats): void {
  const add = (b: GeoBuilder, m: THREE.Material): void => {
    if (b.empty) return;
    const mesh = new THREE.Mesh(b.build(), m);
    parent.add(mesh);
  };
  add(vb.hull, mats.hull);
  add(vb.mech, mats.mech);
  add(vb.glass, mats.glass);
}

function addWheels(root: THREE.Group, wheels: WheelSpec[], geo: THREE.BufferGeometry, mats: Mats): void {
  const im = new THREE.InstancedMesh(geo, mats.mech, wheels.length);
  im.name = 'wheels';
  im.frustumCulled = false;
  im.userData.shared = true;
  root.add(im);
}

export class VehicleLayer {
  private templates = new Map<string, Template>();
  private models = new Map<number, VModel>();
  private pool = new Map<string, VModel[]>();
  private mats = new Map<Side, Mats>();
  private charHull: THREE.MeshStandardMaterial;
  private charMech: THREE.MeshStandardMaterial;
  private charGlass: THREE.MeshStandardMaterial;
  private mech: THREE.MeshStandardMaterial;
  private glass: THREE.MeshStandardMaterial;
  private textures: THREE.Texture[] = [];
  private quality: Quality;

  constructor(private scene: THREE.Scene, quality: Quality) {
    this.quality = quality;
    this.mech = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 });
    this.glass = new THREE.MeshStandardMaterial({ color: 0x1b2730, roughness: 0.06, metalness: 0.7, transparent: true, opacity: 0.78 });
    this.charHull = new THREE.MeshStandardMaterial({ color: 0x2a2623, vertexColors: true, roughness: 1, metalness: 0.05 });
    this.charMech = new THREE.MeshStandardMaterial({ color: 0x1e1c1a, vertexColors: true, roughness: 0.95, metalness: 0.1 });
    this.charGlass = new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 1, metalness: 0 });
  }

  setQuality(q: Quality): void {
    this.quality = q;
    for (const m of this.models.values()) this.applyShadow(m);
    for (const list of this.pool.values()) for (const m of list) this.applyShadow(m);
  }

  private applyShadow(m: VModel): void {
    const cast = this.quality !== 'low', recv = this.quality === 'high';
    for (const mesh of m.meshes) { mesh.castShadow = cast; mesh.receiveShadow = recv; }
    if (m.disc) { m.disc.castShadow = false; m.disc.receiveShadow = false; }
  }

  private matsFor(side: Side): Mats {
    let m = this.mats.get(side);
    if (!m) {
      const f = FACTIONS[side];
      const camo = f ? f.camo : [0xdddddd, 0x999999, 0x555555];
      const tex = camoTexture([camo[0], camo[1], camo[2]], side === 'us' ? 4242 : 7171, 256, true);
      if (tex) { tex.repeat.set(1.5, 1.5); this.textures.push(tex); }
      const hull = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.18, map: tex, color: tex ? 0xffffff : camo[0] });
      m = { hull, mech: this.mech, glass: this.glass };
      this.mats.set(side, m);
    }
    return m;
  }

  private template(type: VehicleType, side: Side): Template {
    const key = type + ':' + side;
    let t = this.templates.get(key);
    if (t) return t;
    const sz = sizeOf(type);
    const mats = this.matsFor(side);
    const mark = FACTIONS[side] ? FACTIONS[side].color : 0xffffff;
    const group = new THREE.Group();
    const meta = type === 'mbt' ? buildMBT(sz.x, sz.y, sz.z, mark, group, mats)
      : type === 'ifv' ? buildIFV(sz.x, sz.y, sz.z, mark, group, mats)
        : type === 'ltv' ? buildLTV(sz.x, sz.y, sz.z, mark, group, mats)
          : buildHeli(sz.x, sz.y, sz.z, mark, group, mats);
    t = { group, meta };
    this.templates.set(key, t);
    return t;
  }

  private instantiate(type: VehicleType, side: Side): VModel {
    const key = type + ':' + side;
    const list = this.pool.get(key);
    if (list && list.length) {
      const m = list.pop()!;
      this.scene.add(m.group);
      return m;
    }
    const t = this.template(type, side);
    const group = t.group.clone(true);
    const mats = this.matsFor(side);
    const meshes: THREE.Mesh[] = [];
    const normal: THREE.Material[] = [];
    const charred: THREE.Material[] = [];
    let discMat: THREE.MeshBasicMaterial | null = null;
    group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (o.name === 'disc') {
        discMat = (o.material as THREE.MeshBasicMaterial).clone();
        o.material = discMat;
        return;
      }
      meshes.push(o);
      const mt = o.material as THREE.Material;
      normal.push(mt);
      charred.push(mt === mats.glass ? this.charGlass : mt === mats.mech ? this.charMech : this.charHull);
    });
    const turret = group.getObjectByName('turret') ?? null;
    const m: VModel = {
      key, type, side, group, meta: t.meta,
      turret, gun: group.getObjectByName('gun') ?? null,
      turretBase: turret ? turret.position.clone() : new THREE.Vector3(),
      cupMg: group.getObjectByName('cupmg') ?? null,
      wheels: (group.getObjectByName('wheels') as THREE.InstancedMesh | undefined) ?? null,
      tracks: (group.getObjectByName('tracks') as THREE.InstancedMesh | undefined) ?? null,
      rotor: group.getObjectByName('rotor') ?? null,
      disc: (group.getObjectByName('disc') as THREE.Mesh | undefined) ?? null,
      discMat, tail: group.getObjectByName('tail') ?? null,
      meshes, normal, charred, dead: false, dist: 0, steer: 0, spool: 0, inited: false,
    };
    if (m.wheels) m.wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (m.tracks) m.tracks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.applyShadow(m);
    this.scene.add(group);
    return m;
  }

  private release(id: number, m: VModel): void {
    this.models.delete(id);
    this.scene.remove(m.group);
    this.setDead(m, false);
    m.inited = false;
    let list = this.pool.get(m.key);
    if (!list) { list = []; this.pool.set(m.key, list); }
    list.push(m);
  }

  private setDead(m: VModel, dead: boolean): void {
    if (m.dead === dead) return;
    m.dead = dead;
    for (let i = 0; i < m.meshes.length; i++) m.meshes[i].material = dead ? m.charred[i] : m.normal[i];
    if (!dead && m.turret) { m.turret.position.copy(m.turretBase); m.turret.rotation.set(0, 0, 0); }
    if (m.rotor) m.rotor.rotation.z = 0;
  }

  update(g: Game, ctx: ActorCtx): void {
    const vs = g.vehicles;
    for (const [id, m] of this.models) {
      const v = vs[id];
      const side = v ? g.sides[v.team] : m.side;
      if (!v || v.type !== m.type || side !== m.side) this.release(id, m);
    }
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      const side: Side = g.sides[v.team] ?? 'us';
      let m = this.models.get(v.id);
      if (!m) { m = this.instantiate(v.type, side); this.models.set(v.id, m); }
      this.updateOne(g, v, m, ctx);
    }
  }

  private updateOne(g: Game, v: Vehicle, m: VModel, ctx: ActorCtx): void {
    const grp = m.group;
    const meta = m.meta;
    const dt = ctx.dt;
    const dx = v.pos.x - ctx.cam.x, dy = v.pos.y - ctx.cam.y, dz = v.pos.z - ctx.cam.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // 바퀴가 굴러간 거리는 안 보여도 쌓는다 (보일 때 튀지 않게)
    m.dist += v.speed * dt;
    const maxD = ctx.quality === 'low' ? 650 : 900;
    if (d > maxD || !inView(ctx, v.pos.x, v.pos.y + meta.h * 0.5, v.pos.z, meta.radius)) { grp.visible = false; return; }
    grp.visible = true;
    const dead = !v.alive;
    this.setDead(m, dead);
    grp.position.set(v.pos.x, v.pos.y - (dead && v.type !== 'heli' ? 0.12 : 0), v.pos.z);
    grp.rotation.set(v.pitch, v.yaw, v.roll, 'YXZ');

    // 포탑·포
    if (m.turret) {
      if (dead && meta.turretPop) {
        const t = clamp01(v.wreckT / 0.9);
        const sg = (v.id & 1) ? 1 : -1;
        const h = Math.sin(t * Math.PI) * 1.6 * (1 - t * 0.4) + t * 0.08;
        m.turret.position.set(m.turretBase.x + sg * 0.45 * t, m.turretBase.y + h, m.turretBase.z + 0.3 * t);
        m.turret.rotation.set(-0.18 * t, v.tYaw + sg * 0.6 * t, sg * 0.32 * t, 'YXZ');
        if (m.gun) m.gun.rotation.x = -0.12 * t;
      } else if (!dead) {
        m.turret.rotation.set(0, v.tYaw, 0);
        if (m.gun) m.gun.rotation.x = v.tPitch;
      }
    }
    // 전차장 기관총은 그 좌석 병사 시선
    if (m.cupMg && !dead) {
      const sid = v.seats[1];
      const s = sid !== undefined && sid >= 0 ? g.soldiers[sid] : undefined;
      if (s) {
        let ry = s.yaw - v.yaw;
        ry = Math.atan2(Math.sin(ry), Math.cos(ry));
        m.cupMg.rotation.set(Math.max(-0.3, Math.min(0.8, s.pitch)), ry, 0, 'YXZ');
      }
    }
    // 바퀴
    const near = d < (ctx.quality === 'low' ? 120 : 220);
    if (m.wheels && (near || !m.inited)) {
      const drv = v.seats[0];
      const ds = drv !== undefined && drv >= 0 ? g.soldiers[drv] : undefined;
      const st = !dead && ds ? -clamp(ds.ctl.mx, -1, 1) * 0.42 : 0;
      m.steer += (st - m.steer) * (1 - Math.exp(-6 * dt));
      const ws = meta.wheels;
      for (let i = 0; i < ws.length; i++) {
        const w = ws[i];
        _e.set(-m.dist / w.r, w.steer ? m.steer : 0, 0, 'YXZ');
        _q.setFromEuler(_e);
        _m.compose(_p.set(w.x, w.y, w.z), _q, _s.set(w.w, w.r, w.r));
        m.wheels.setMatrixAt(i, _m);
      }
      m.wheels.instanceMatrix.needsUpdate = true;
    }
    // 궤도
    if (m.tracks && meta.track && (near || !m.inited)) {
      const T = meta.track;
      const ls = T.zr - T.zf, arc = Math.PI * T.r;
      let k = 0;
      for (let side = 0; side < 2; side++) {
        const x = T.x[side];
        for (let i = 0; i < T.n; i++) {
          let s = (i * T.sp + m.dist) % T.per;
          if (s < 0) s += T.per;
          let y: number, z: number, a: number;
          if (s < ls) { z = T.zf + s; y = T.cy - T.r; a = 0; }
          else if (s < ls + arc) { const t = (s - ls) / T.r; z = T.zr + Math.sin(t) * T.r; y = T.cy - Math.cos(t) * T.r; a = -t; }
          else if (s < 2 * ls + arc) { z = T.zr - (s - ls - arc); y = T.cy + T.r; a = -Math.PI; }
          else { const t = (s - 2 * ls - arc) / T.r; z = T.zf - Math.sin(t) * T.r; y = T.cy + Math.cos(t) * T.r; a = -(Math.PI + t); }
          _q.setFromAxisAngle(XA, a);
          _m.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1));
          m.tracks.setMatrixAt(k++, _m);
        }
      }
      m.tracks.instanceMatrix.needsUpdate = true;
    }
    m.inited = true;
    // 헬기 회전날개
    if (m.rotor) {
      const occupied = v.seats.some((sid) => sid >= 0);
      const want = !dead && (occupied || Math.abs(v.speed) > 0.5 || Math.abs(v.vel.y) > 0.3) ? 1 : 0;
      m.spool += (want - m.spool) * (1 - Math.exp(-(want > m.spool ? 0.6 : 0.3) * dt));
      if (m.spool < 0.002) m.spool = 0;
      m.rotor.rotation.y += m.spool * 32 * dt;
      if (dead) m.rotor.rotation.z = 0.06;
      if (m.tail) m.tail.rotation.x += m.spool * 70 * dt;
      if (m.discMat && m.disc) {
        const o = smooth01((m.spool - 0.45) / 0.5) * 0.3;
        m.discMat.opacity = o;
        m.disc.visible = o > 0.01;
      }
    }
  }

  dispose(): void {
    const geos = new Set<THREE.BufferGeometry>();
    const free = (grp: THREE.Group): void => {
      grp.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          geos.add(o.geometry);
          if (o instanceof THREE.InstancedMesh) o.dispose();
          if (o.name === 'disc') (o.material as THREE.Material).dispose();
        }
      });
      this.scene.remove(grp);
    };
    for (const m of this.models.values()) free(m.group);
    for (const list of this.pool.values()) for (const m of list) free(m.group);
    for (const t of this.templates.values()) free(t.group);
    for (const g of geos) g.dispose();
    for (const m of this.mats.values()) m.hull.dispose();
    for (const t of this.textures) t.dispose();
    this.mech.dispose(); this.glass.dispose(); this.charHull.dispose(); this.charMech.dispose(); this.charGlass.dispose();
    tireGeo = null; roadGeo = null;
    this.models.clear(); this.pool.clear(); this.templates.clear(); this.mats.clear();
  }
}

function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x; }
function clamp(x: number, a: number, b: number): number { return x < a ? a : x > b ? b : x; }
function smooth01(x: number): number { const t = clamp01(x); return t * t * (3 - 2 * t); }
