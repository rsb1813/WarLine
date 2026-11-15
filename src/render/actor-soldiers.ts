// 병사 그리기: 부위별 InstancedMesh, 절차 자세(서기·걷기·달리기·앉기·엎드림·쓰러짐·죽음), 먼 거리 LOD.
// 자세는 모델 공간(발 원점, 앞 -Z)에서 관절 목표값(골반, 몸통·머리 회전, 손·발 목표, 팔꿈치·무릎 방향, 총)으로 만들고,
// 서 있는 자세와 누운 자세를 섞은 뒤 2관절 IK 로 팔다리를 푼다.
import * as THREE from 'three';
import type { Game, Soldier, Side, Vehicle, LifeState, GadgetKind, WeaponCat } from '../types';
import { FACTIONS, VEHICLES } from '../defs';
import { seatWorldPos } from '../sim/vehicles';
import { hash2 } from '../math';
import { camoTexture, inView, type ActorCtx } from './actor-geo';
import { IPart } from './actor-inst';
import * as SG from './actor-soldier-geo';

const PI = Math.PI;
const SEG = SG.SEG;
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const ss = (x: number): number => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const damp = (r: number, dt: number): number => 1 - Math.exp(-r * dt);

// ───────── 자세 배열 배치 ─────────
const PP = 0, PQ = 3, TQ = 7, HQ = 11, HL = 15, HR = 18, EL = 21, ER = 24, FL = 27, FR = 30,
  UL = 33, UR = 36, WL = 39, WR = 42, KL = 45, KR = 48, GP = 51, GQ = 54, PN = 58;
const QUATS = [PQ, TQ, HQ, GQ];

const enum Hold { Rifle, Pistol, Launcher, Device, Mounted, None }
const enum Ly { Prone, Down, Dead0, Dead1, Dead2, DeadDown }

interface SAnim {
  seen: number;
  yaw: number; pitch: number;
  sprint: number; alert: number; move: number; mx: number; mz: number;
  lie: number; lastShot: number; vary: number;
  lastState: LifeState; wasDown: boolean; deadVar: number; deadYaw: number; deadSign: number;
  ly: Float32Array; lyValid: boolean; lyType: number; lyMix: number;
}

interface Inp {
  c: number; eyeH: number; sf: number; mv: number; mx: number; mz: number; phase: number;
  sprint: number; ads: number; alert: number; pitch: number; kick: number; reload: number; throwW: number;
  hit: number; t: number; hold: Hold; shape: SG.GunShape; zs: number; slide: number; air: number;
  limp: number; sign: number; twist: number;
}

const I: Inp = {
  c: 0, eyeH: 1.62, sf: 0, mv: 0, mx: 0, mz: -1, phase: 0, sprint: 0, ads: 0, alert: 0, pitch: 0, kick: 0,
  reload: -1, throwW: -1, hit: 0, t: 0, hold: Hold.Rifle, shape: 'rifle', zs: 1, slide: 0, air: 0, limp: 0, sign: 1, twist: 0,
};

// ───────── 수학 임시값 ─────────
const _e = new THREE.Euler();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _qT = new THREE.Quaternion(), _qP = new THREE.Quaternion(), _qH = new THREE.Quaternion();
const _qAim = new THREE.Quaternion(), _qG = new THREE.Quaternion(), _qG2 = new THREE.Quaternion(), _qB = new THREE.Quaternion();
const _qR = new THREE.Quaternion(), _qYaw = new THREE.Quaternion();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _pel = new THREE.Vector3(), _N = new THREE.Vector3(), _E = new THREE.Vector3(), _SR = new THREE.Vector3(), _SL = new THREE.Vector3();
const _gp = new THREE.Vector3(), _gpR = new THREE.Vector3(), _hL = new THREE.Vector3(), _hR = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _pp = new THREE.Vector3();
const _mid = new THREE.Vector3(), _end = new THREE.Vector3(), _pole = new THREE.Vector3();
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
const _m = new THREE.Matrix4(), _s3 = new THREE.Vector3(1, 1, 1);
const AX = new THREE.Vector3(0, 1, 0);

function qe(q: THREE.Quaternion, x: number, y: number, z: number): THREE.Quaternion {
  _e.set(x, y, z, 'YXZ');
  return q.setFromEuler(_e);
}
/** q 로 (x,y,z) 를 돌린 값 */
function rot(q: THREE.Quaternion, x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(x, y, z).applyQuaternion(q);
}
function sv(P: Float32Array, i: number, v: THREE.Vector3): void { P[i] = v.x; P[i + 1] = v.y; P[i + 2] = v.z; }
function svx(P: Float32Array, i: number, x: number, y: number, z: number): void { P[i] = x; P[i + 1] = y; P[i + 2] = z; }
function sq(P: Float32Array, i: number, q: THREE.Quaternion): void { P[i] = q.x; P[i + 1] = q.y; P[i + 2] = q.z; P[i + 3] = q.w; }
function gv(P: Float32Array, i: number, v: THREE.Vector3): THREE.Vector3 { return v.set(P[i], P[i + 1], P[i + 2]); }
function gq(P: Float32Array, i: number, q: THREE.Quaternion): THREE.Quaternion { return q.set(P[i], P[i + 1], P[i + 2], P[i + 3]).normalize(); }

function blendPose(A: Float32Array, B: Float32Array, t: number, out: Float32Array): void {
  for (let i = 0; i < PN; i++) out[i] = A[i] + (B[i] - A[i]) * t;
  for (const o of QUATS) {
    const d = A[o] * B[o] + A[o + 1] * B[o + 1] + A[o + 2] * B[o + 2] + A[o + 3] * B[o + 3];
    if (d < 0) for (let k = 0; k < 4; k++) out[o + k] = A[o + k] + (-B[o + k] - A[o + k]) * t;
  }
}

/** 2관절 IK: root 에서 target 으로, 굽는 쪽 pole. mid(팔꿈치·무릎), end(손목·발목) */
function ik(root: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3, l1: number, l2: number, mid: THREE.Vector3, end: THREE.Vector3): void {
  _d.subVectors(target, root);
  let dist = _d.length();
  if (dist < 1e-5) { _d.set(0, -1, 0); dist = 1e-5; } else _d.multiplyScalar(1 / dist);
  dist = clamp(dist, Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.002);
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _pp.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_pp.lengthSq() < 1e-8) { _pp.set(0, 0, -1).addScaledVector(_d, _d.z); if (_pp.lengthSq() < 1e-8) _pp.set(1, 0, 0); }
  _pp.normalize();
  mid.copy(root).addScaledVector(_d, a).addScaledVector(_pp, h);
  end.copy(root).addScaledVector(_d, dist);
}

// ───────── 자세 계산 ─────────

/** 손과 총 (서기·엎드림 공용). _N, _E, _SR, _SL, _pel, _qT, _qAim 이 준비돼 있어야 한다 */
function armsAndGun(P: Float32Array, prone: boolean): void {
  const sp = prone ? 0 : I.sprint, mv = I.mv;
  let ads = I.ads, alert = I.alert;
  if (prone) { ads = Math.max(ads, 0.75); alert = 1; }
  const G = SG.GUN_GRIP[I.shape];
  const swing = Math.sin(I.phase) * mv;
  let poleRx = 0.5, poleRy = -0.85, poleRz = 0.3, poleLx = -0.6, poleLy = -0.8, poleLz = 0.0;

  if (I.hold === Hold.Rifle || I.hold === Hold.Pistol || I.hold === Hold.Launcher) {
    const pist = I.hold === Hold.Pistol, lau = I.hold === Hold.Launcher;
    if (lau) alert = Math.max(alert, 0.45);
    // 편한 자세(총구 아래)
    if (pist) { _gp.set(0.1, -0.38, -0.22).add(_N); qe(_qG, -1.0, 0, 0); }
    else if (lau) { _gp.set(0.14, -0.3, -0.22).add(_N); qe(_qG, -0.6, 0.5, 0); }
    else { qe(_q1, I.pitch * 0.3, I.twist, 0); rot(_q1, 0.12, -0.3, -0.27, _gp).add(_N); qe(_qG, -0.5 + I.pitch * 0.3, 0.3 + I.twist, 0); }
    _gpR.copy(_gp); _qR.copy(_qG);
    // 허리 사격 / 경계
    if (pist) rot(_qAim, 0.06, -0.16, -0.4, _v4).add(_N);
    else if (lau) rot(_qAim, -0.02, -0.06, -0.15, _v4).add(_SR);
    else rot(_qAim, 0.16, -0.2, -0.3, _v4).add(_N);
    _qG2.copy(_qAim);
    if (!pist && !lau) _qG2.multiply(qe(_q1, -0.06, 0.04, 0));
    _gp.lerp(_v4, alert); _qG.slerp(_qG2, alert);
    // 정조준 (조준선이 눈 앞으로)
    if (pist) rot(_qAim, 0.0, -G.sight, -0.42, _v4).add(_E);
    else if (lau) rot(_qAim, -0.02, -0.06, -0.15, _v4).add(_SR);
    else rot(_qAim, 0.035, -G.sight, -0.05, _v4).add(_E);
    _gp.lerp(_v4, ads); _qG.slerp(_qAim, ads);
    // 달리기: 가슴 앞으로 비스듬히 낮게
    if (sp > 0.001) {
      const bounce = Math.abs(Math.cos(I.phase)) * 0.025 * mv;
      if (pist) { _v4.set(0.2, -0.42 + bounce, -0.08).add(_N); qe(_q2, -1.25, 0, 0); }
      else { rot(qe(_q2, 0, I.twist, 0), 0.1, -0.3 + bounce, -0.2, _v4).add(_N); qe(_q2, -0.3, 0.95 + I.twist, 0.25); }
      _gp.lerp(_v4, sp); _qG.slerp(_q2, sp);
    }
    // 걷기 흔들림
    const wb = mv * (1 - ads * 0.75);
    _gp.x += Math.sin(I.phase) * 0.012 * wb;
    _gp.y -= Math.abs(Math.cos(I.phase)) * 0.016 * wb;
    // 반동
    if (I.kick > 0) {
      rot(_qAim, 0, 0.006 * I.kick, (lau ? 0.08 : 0.045) * I.kick, _v4);
      _gp.add(_v4);
      _qG.multiply(qe(_q1, (lau ? 0.14 : 0.08) * I.kick, 0, 0));
    }
    // 재장전: 총을 굴려 탄창 쪽을 보인다
    let rw = 0;
    if (I.reload >= 0 && !lau) {
      rw = ss(I.reload / 0.12) * (1 - ss((I.reload - 0.88) / 0.12));
      qe(_q1, I.pitch * 0.3, 0, 0);
      rot(_q1, 0.1, pist ? -0.2 : -0.24, pist ? -0.3 : -0.28, _v4).add(_N);
      qe(_q2, I.pitch * 0.3 + 0.25, 0, 0.55);
      _gp.lerp(_v4, rw); _qG.slerp(_q2, rw);
    }
    // 던지기: 총은 왼손으로 내린다
    let tWin = 0;
    if (I.throwW >= 0 && !lau) {
      tWin = ss(I.throwW / 0.1) * (1 - ss((I.throwW - 0.85) / 0.15));
      _gp.lerp(_gpR, tWin); _qG.slerp(_qR, tWin);
    }
    sv(P, GP, _gp); sq(P, GQ, _qG);
    // 손
    rot(_qG, 0, -0.01, 0.0, _hR).add(_gp);
    if (pist) rot(_qG, -0.028, -0.035, 0.025, _hL).add(_gp);
    else rot(_qG, -0.005, G.ly, G.lz * I.zs, _hL).add(_gp);
    // 팔꿈치 방향
    if (pist) { poleRx = 0.5; poleRy = -0.8; poleRz = 0.3; poleLx = -0.5; poleLy = -0.8; poleLz = 0.3; }
    else if (lau) { poleRx = 0.4; poleRy = -1; poleRz = 0.1; poleLx = -0.5; poleLy = -1; poleLz = 0.1; }
    else {
      poleRx = lerp(0.5, 0.95, ads); poleRy = lerp(-0.85, -0.35, ads); poleRz = lerp(0.3, 0.1, ads);
      poleLx = -0.6; poleLy = -0.8; poleLz = 0;
    }
    if (prone) { poleRx = 0.7; poleRy = -1; poleRz = 0.1; poleLx = -0.7; poleLy = -1; poleLz = 0.1; }
    // 재장전 왼손: 탄창 → 가슴 주머니 → 탄창 → 손잡이
    if (rw > 0) {
      const r = I.reload;
      rot(_qG, 0, pist ? -0.09 : -0.08, pist ? 0.02 : -0.1, _a).add(_gp);
      rot(_qT, -0.1, 0.24, -0.22, _b).add(_pel);
      _c.copy(_hL);
      if (r < 0.15) _hL.copy(_c).lerp(_a, ss(r / 0.15));
      else if (r < 0.32) _hL.copy(_a).lerp(_b, ss((r - 0.15) / 0.17));
      else if (r < 0.48) _hL.copy(_b);
      else if (r < 0.66) _hL.copy(_b).lerp(_a, ss((r - 0.48) / 0.18));
      else if (r < 0.8) { _hL.copy(_a); _hL.y += Math.sin(((r - 0.66) / 0.14) * PI) * 0.025; }
      else _hL.copy(_a).lerp(_c, ss((r - 0.8) / 0.2));
      poleLx = -0.7; poleLy = -0.7; poleLz = 0.2;
    }
    // 던지기 오른손: 머리 뒤로 젖혔다가 앞으로 뿌린다
    if (tWin > 0) {
      const w = I.throwW;
      rot(_qT, 0.08, 0.22, 0.24, _a).add(_SR);
      rot(_qAim, -0.04, 0.14, -0.5, _b).add(_SR);
      _c.copy(_hR);
      if (w < 0.45) _hR.copy(_c).lerp(_a, ss(w / 0.45));
      else if (w < 0.62) _hR.copy(_a).lerp(_b, ss((w - 0.45) / 0.17));
      else _hR.copy(_b).lerp(_c, ss((w - 0.62) / 0.38));
      poleRx = 0.8; poleRy = -0.3; poleRz = 0.5;
    }
  } else if (I.hold === Hold.Device) {
    _gp.set(0.15, -0.32 + Math.abs(Math.cos(I.phase)) * 0.015 * mv, -0.26).add(_N);
    qe(_qG, -0.25, 0, 0);
    sv(P, GP, _gp); sq(P, GQ, _qG);
    rot(_qG, 0, -0.01, 0.04, _hR).add(_gp);
    _hL.set(-0.06, -0.53, swing * 0.22 * clamp(I.sf, 0, 1.2)).add(_SL);
    poleLx = -0.2; poleLy = 0; poleLz = 1;
    if (I.throwW >= 0) {
      const w = I.throwW;
      rot(_qT, 0.08, 0.22, 0.24, _a).add(_SR);
      rot(_qAim, -0.04, 0.14, -0.5, _b).add(_SR);
      _c.copy(_hR);
      if (w < 0.45) _hR.copy(_c).lerp(_a, ss(w / 0.45));
      else if (w < 0.62) _hR.copy(_a).lerp(_b, ss((w - 0.45) / 0.17));
      else _hR.copy(_b).lerp(_c, ss((w - 0.62) / 0.38));
    }
  } else if (I.hold === Hold.Mounted) {
    rot(_qAim, 0.12, -0.02, -0.27, _hR).add(_N);
    rot(_qAim, -0.12, -0.02, -0.27, _hL).add(_N);
    _gp.copy(_hR); sv(P, GP, _gp); sq(P, GQ, _qAim);
    poleRx = 0.8; poleRy = -0.6; poleRz = 0.1; poleLx = -0.8; poleLy = -0.6; poleLz = 0.1;
  } else {
    const a = 0.22 * clamp(I.sf, 0, 1.3);
    _hR.set(0.06, -0.53, -swing * a).add(_SR);
    _hL.set(-0.06, -0.53, swing * a).add(_SL);
    _gp.copy(_hR); sv(P, GP, _gp); sq(P, GQ, _qT);
    poleRx = 0.2; poleRy = 0; poleRz = 1; poleLx = -0.2; poleLy = 0; poleLz = 1;
  }
  sv(P, HL, _hL); sv(P, HR, _hR);
  svx(P, EL, poleLx, poleLy, poleLz); svx(P, ER, poleRx, poleRy, poleRz);
}

function poseUpright(P: Float32Array): void {
  const c = I.c, mv = I.mv, sp = I.sprint;
  let tw = 0;
  if (I.throwW >= 0 && I.hold !== Hold.Launcher) {
    const w = I.throwW;
    tw = w < 0.45 ? -0.35 * ss(w / 0.45) : w < 0.62 ? lerp(-0.35, 0.3, ss((w - 0.45) / 0.17)) : lerp(0.3, 0, ss((w - 0.62) / 0.38));
  }
  const rifleLike = I.hold === Hold.Rifle || I.hold === Hold.Launcher;
  const aimAmt = Math.max(I.ads, I.alert * 0.6) * (1 - sp);
  let lean = lerp(0.05, 0.38, c) + sp * 0.2 * mv + 0.05 * mv * (1 - sp);
  lean = lerp(lean, -0.2, I.slide);
  const breath = Math.sin(I.t * 1.7) * 0.014 * (1 - mv);
  const theta = -lean + I.pitch * 0.42 * (1 - sp * 0.8) + breath + I.kick * 0.03 + I.hit * 0.18;
  const twist = Math.sin(I.phase) * 0.12 * mv * (1 - aimAmt * 0.6);
  const blade = rifleLike ? -0.22 * aimAmt : 0;
  I.twist = twist;
  qe(_qT, theta, twist + blade + tw, I.hit * 0.08 * Math.sin(I.t * 23));
  qe(_qP, -c * 0.2, -twist * 0.7 + blade * 0.5 + tw * 0.3, 0);
  const hp = clamp(I.pitch * 0.9, -1.1, 1.1) + I.hit * 0.2;
  const hRoll = I.hold === Hold.Rifle ? -0.1 * I.ads : 0;
  qe(_qH, hp, -tw * 0.5 - blade * 0.3, hRoll);
  rot(_qT, 0, SEG.neck, 0, _v1);
  rot(_qH, 0, SEG.headUp, 0, _v2);
  const bob = -(0.5 + 0.5 * Math.cos(2 * I.phase)) * (0.022 + 0.03 * sp) * mv;
  const py = clamp(I.eyeH + 0.06 - _v1.y - _v2.y + bob, 0.26, 0.975);
  const pz = -_v1.z * 0.35 + c * 0.04;
  _pel.set(0, py, pz);
  sv(P, PP, _pel); sq(P, PQ, _qP); sq(P, TQ, _qT); sq(P, HQ, _qH);

  // 다리
  const kneel = ss((c - 0.45) / 0.55) * (1 - mv) * (1 - I.slide);
  const A = lerp(lerp(0.26, 0.42, sp), 0.18, c) * Math.min(1.2, I.sf);
  for (let k = 0; k < 2; k++) {
    const sd = k === 0 ? -1 : 1;
    const ph = I.phase + (sd > 0 ? PI : 0);
    const sw = Math.sin(ph), cw = Math.cos(ph);
    let fx = sd * 0.13, fy = SEG.ankle, fz = sd < 0 ? -0.05 : 0.05;
    if (sd > 0) { fx = lerp(fx, 0.14, kneel); fy = lerp(fy, 0.17, kneel); fz = lerp(fz, pz + 0.4, kneel); }
    else { fx = lerp(fx, -0.15, kneel); fz = lerp(fz, -0.3, kneel); }
    const wx = sd * 0.12 + I.mx * sw * A;
    const wy = SEG.ankle + Math.max(0, cw) * lerp(0.08, 0.17, sp) * (1 - c * 0.4) * Math.min(1, I.sf + 0.3);
    const wz = I.mz * sw * A + pz * 0.5;
    fx = lerp(fx, wx, mv); fy = lerp(fy, wy, mv); fz = lerp(fz, wz, mv);
    fy += 0.14 * I.air; fz -= 0.06 * I.air * sd;
    let kx = sd * 0.25, ky = -0.05, kz = -1;
    if (sd > 0) ky = lerp(ky, -0.8, kneel);
    if (I.slide > 0) {
      const sx = sd * 0.13, sy = sd > 0 ? 0.13 : 0.1, sz = sd > 0 ? -0.62 : 0.2;
      fx = lerp(fx, sx, I.slide); fy = lerp(fy, sy, I.slide); fz = lerp(fz, sz, I.slide);
      if (sd < 0) { kx = lerp(kx, -0.8, I.slide); ky = lerp(ky, -0.4, I.slide); }
    }
    svx(P, k === 0 ? FL : FR, fx, fy, fz);
    svx(P, k === 0 ? KL : KR, kx, ky, kz);
    let fp = sw * 0.3 * mv * clamp(-I.mz * 1.2, -1, 1);
    if (sd > 0) fp = lerp(fp, -1.0, kneel);
    fp += I.air * 0.3 + I.slide * (sd > 0 ? 0.5 : -0.6);
    qe(_q1, fp, -sd * 0.12, 0);
    rot(_q1, 0, 1, 0, _v3); sv(P, k === 0 ? UL : UR, _v3);
    rot(_q1, 0, 0, -1, _v3); sv(P, k === 0 ? WL : WR, _v3);
  }

  // 팔·총
  qe(_qAim, I.pitch, 0, 0);
  _N.copy(_pel).add(_v1);
  rot(_qH, 0, 0.19, -0.075, _E).add(_N);
  rot(_qT, SEG.shoulderX, SEG.shoulderY, 0, _SR).add(_pel);
  rot(_qT, -SEG.shoulderX, SEG.shoulderY, 0, _SL).add(_pel);
  armsAndGun(P, false);
}

function poseProne(P: Float32Array): void {
  I.twist = 0;
  const crawl = I.mv;
  const p = clamp(I.pitch, -0.4, 0.6);
  qe(_qB, -1.47 + p * 0.2, 0, Math.sin(I.phase) * 0.06 * crawl);
  _pel.set(0, 0.15, 0.0 + Math.sin(I.phase * 2) * 0.03 * crawl);
  _qT.copy(_qB).multiply(qe(_q1, 0.05 + p * 0.1, 0, 0));
  qe(_qH, -0.55 + p * 0.7, 0, 0);
  sv(P, PP, _pel); sq(P, PQ, _qB); sq(P, TQ, _qT); sq(P, HQ, _qH);
  for (let k = 0; k < 2; k++) {
    const sd = k === 0 ? -1 : 1;
    const kk = Math.max(0, Math.sin(I.phase + (sd > 0 ? PI : 0))) * crawl;
    svx(P, k === 0 ? FL : FR, sd * (0.2 + 0.14 * kk), 0.17 + 0.02 * kk, _pel.z + 0.84 - 0.4 * kk);
    svx(P, k === 0 ? KL : KR, sd * 0.5, -1, -0.15);
    svx(P, k === 0 ? UL : UR, 0, 0.2, -1);
    svx(P, k === 0 ? WL : WR, sd * 0.25, -1, -0.2);
  }
  qe(_qAim, I.pitch, 0, 0);
  rot(_qT, 0, SEG.neck, 0, _v1);
  _N.copy(_pel).add(_v1);
  rot(_qH, 0, 0.19, -0.075, _E).add(_N);
  rot(_qT, SEG.shoulderX, SEG.shoulderY, 0, _SR).add(_pel);
  rot(_qT, -SEG.shoulderX, SEG.shoulderY, 0, _SL).add(_pel);
  if (I.hold === Hold.None || I.hold === Hold.Device || I.hold === Hold.Mounted) {
    // 빈손: 팔꿈치를 짚고 앞으로
    rot(_qT, 0.22, 0.62, -0.12, _hR).add(_pel);
    rot(_qT, -0.22, 0.62, -0.12, _hL).add(_pel);
    _hR.z -= Math.max(0, Math.sin(I.phase)) * 0.15 * crawl;
    _hL.z -= Math.max(0, -Math.sin(I.phase)) * 0.15 * crawl;
    _gp.copy(_hR).add(_v4.set(0, 0.02, -0.05));
    sv(P, GP, _gp); sq(P, GQ, qe(_q1, 0, 0, 0));
    sv(P, HL, _hL); sv(P, HR, _hR);
    svx(P, EL, -0.7, -1, 0.1); svx(P, ER, 0.7, -1, 0.1);
  } else armsAndGun(P, true);
}

/** 땅에 떨어진 총 */
function droppedGun(P: Float32Array, x: number, z: number, yaw: number): void {
  svx(P, GP, x, 0.035, z);
  sq(P, GQ, qe(_q1, 0, yaw, PI / 2));
}

function poseDown(P: Float32Array, limp: number): void {
  const t = I.t;
  const br = Math.sin(t * 2.6) * 0.04 * (1 - limp);
  qe(_qB, -PI / 2, 0, 0).multiply(qe(_q1, 0, 0.5 * PI, 0));
  _pel.set(0, 0.21, 0.15);
  _qT.copy(_qB).multiply(qe(_q1, -0.1 - br, 0, 0));
  _qH.copy(_qB).multiply(qe(_q1, lerp(-0.35, -0.1, limp), lerp(0.35 * Math.sin(t * 0.5), 0.9, limp), 0));
  sv(P, PP, _pel); sq(P, PQ, _qB); sq(P, TQ, _qT); sq(P, HQ, _qH);
  rot(_qT, SEG.shoulderX, SEG.shoulderY, 0, _SR).add(_pel);
  rot(_qT, -SEG.shoulderX, SEG.shoulderY, 0, _SL).add(_pel);
  // 오른손 배 위, 왼손 천천히 허우적
  rot(_qT, 0.02, 0.24, -0.17, _hR).add(_pel);
  const am = Math.sin(t * 1.3) * (1 - limp);
  rot(_qT, -0.05, 0.1 + 0.06 * am, -0.35 - 0.08 * am, _hL).add(_SL);
  if (limp > 0) {
    rot(_qT, 0.42, -0.02, 0.06, _a).add(_SR); _hR.lerp(_a, limp);
    rot(_qT, -0.45, 0.12, 0.06, _a).add(_SL); _hL.lerp(_a, limp);
  }
  sv(P, HL, _hL); sv(P, HR, _hR);
  rot(_qT, -0.8, -0.2, 0.4, _v1); sv(P, EL, _v1);
  rot(_qT, 0.8, -0.2, 0.4, _v1); sv(P, ER, _v1);
  rot(_qB, 0.1, -0.85, 0.02, _v1).add(_pel); sv(P, FR, _v1);
  rot(_qB, 0.02, lerp(-0.6, -0.72, limp), lerp(-0.22, -0.1, limp), _v1).add(_pel); sv(P, FL, _v1);
  rot(_qB, 0.3, 0, -1, _v1); sv(P, KL, _v1);
  rot(_qB, 0.1, 0, -1, _v1); sv(P, KR, _v1);
  rot(_qB, 0, 1, 0, _v1); sv(P, UL, _v1); sv(P, UR, _v1);
  rot(_qB, -0.3, 0, -1, _v1); sv(P, WL, _v1);
  rot(_qB, 0.3, 0, -1, _v1); sv(P, WR, _v1);
  droppedGun(P, -0.55, -0.1, 1.2);
}

function poseDead(P: Float32Array, v: number): void {
  const sg = I.sign;
  if (v === 0) {
    // 뒤로 넘어져 누움
    // 뒤로 넘어져 옆으로 누움 (배낭이 땅에 박히지 않게 옆으로)
    qe(_qB, PI / 2 - 0.08, 0, 0).multiply(qe(_q1, 0, sg * PI / 2, 0));
    _pel.set(0, 0.21, 0.5);
    _qT.copy(_qB).multiply(qe(_q1, -0.12, 0, 0));
    _qH.copy(_qT).multiply(qe(_q1, -0.25, 0, 0.15 * sg));
    sv(P, PP, _pel); sq(P, PQ, _qB); sq(P, TQ, _qT); sq(P, HQ, _qH);
    rot(_qT, SEG.shoulderX, SEG.shoulderY, 0, _SR).add(_pel);
    rot(_qT, -SEG.shoulderX, SEG.shoulderY, 0, _SL).add(_pel);
    const up = sg > 0 ? _SR : _SL, dn = sg > 0 ? _SL : _SR;
    rot(_qT, 0.1 * sg, -0.12, -0.34, sg > 0 ? _hR : _hL).add(up);
    rot(_qT, -0.06 * sg, 0.45, -0.12, sg > 0 ? _hL : _hR).add(dn);
    rot(_qT, -0.3, -0.6, 0.6, _v1); sv(P, EL, _v1);
    rot(_qT, 0.3, -0.6, 0.6, _v1); sv(P, ER, _v1);
    rot(_qB, -0.1 * sg, -0.85, 0, _v1).add(_pel); sv(P, sg > 0 ? FL : FR, _v1);
    rot(_qB, 0.06 * sg, -0.6, -0.25, _v1).add(_pel); sv(P, sg > 0 ? FR : FL, _v1);
    rot(_qB, 0, 0, -1, _v1); sv(P, KL, _v1); sv(P, KR, _v1);
    rot(_qB, 0, 1, 0, _v1); sv(P, UL, _v1); sv(P, UR, _v1);
    rot(_qB, 0, 0, -1, _v1); sv(P, WL, _v1); sv(P, WR, _v1);
    droppedGun(P, -0.6 * sg, 0.2, 0.8 * sg);
  } else if (v === 1) {
    // 앞으로 엎어짐
    qe(_qB, -PI / 2 + 0.04, 0, sg * 0.1);
    _pel.set(0, 0.17, -0.45);
    _qT.copy(_qB).multiply(qe(_q1, -0.03, 0, 0));
    _qH.copy(_qB).multiply(qe(_q1, 0.2, 1.2 * sg, 0));
    sv(P, PP, _pel); sq(P, PQ, _qB); sq(P, TQ, _qT); sq(P, HQ, _qH);
    rot(_qT, SEG.shoulderX, SEG.shoulderY, 0, _SR).add(_pel);
    rot(_qT, -SEG.shoulderX, SEG.shoulderY, 0, _SL).add(_pel);
    rot(_qT, -0.32, 0.22, -0.08, _hL).add(_SL);
    rot(_qT, 0.3, 0.08, -0.08, _hR).add(_pel);
    rot(_qT, -0.8, 0, 0.6, _v1); sv(P, EL, _v1);
    rot(_qT, 0.8, 0, 0.6, _v1); sv(P, ER, _v1);
    rot(_qB, 0.18, -0.85, -0.04, _v1).add(_pel); sv(P, FR, _v1);
    rot(_qB, -0.22, -0.84, -0.04, _v1).add(_pel); sv(P, FL, _v1);
    rot(_qB, 0, 0, -1, _v1); sv(P, KL, _v1); sv(P, KR, _v1);
    rot(_qB, 0, 1, 0, _v1); sv(P, UL, _v1); sv(P, UR, _v1);
    rot(_qB, -0.3, 0, -1, _v1); sv(P, WL, _v1);
    rot(_qB, 0.3, 0, -1, _v1); sv(P, WR, _v1);
    droppedGun(P, 0.6 * sg, -0.9, 0.5 * sg);
  } else {
    // 옆으로 쓰러져 웅크림
    qe(_qB, -0.25, 0, PI / 2 * sg);
    _pel.set(-0.5 * sg, 0.19, 0.05);
    _qT.copy(_qB).multiply(qe(_q1, -0.35, 0, 0));
    _qH.copy(_qT).multiply(qe(_q1, -0.3, 0, 0));
    sv(P, PP, _pel); sq(P, PQ, _qB); sq(P, TQ, _qT); sq(P, HQ, _qH);
    rot(_qT, SEG.shoulderX, SEG.shoulderY, 0, _SR).add(_pel);
    rot(_qT, -SEG.shoulderX, SEG.shoulderY, 0, _SL).add(_pel);
    rot(_qT, 0.02, -0.12, -0.36, _hR).add(_SR);
    rot(_qT, -0.02, -0.02, -0.4, _hL).add(_SL);
    rot(_qT, 0, -0.5, 0.6, _v1); sv(P, EL, _v1); sv(P, ER, _v1);
    rot(_qB, 0.1, -0.6, 0.12, _v1).add(_pel); sv(P, FR, _v1);
    rot(_qB, -0.1, -0.64, 0.06, _v1).add(_pel); sv(P, FL, _v1);
    rot(_qB, 0, 0.3, -1, _v1); sv(P, KL, _v1); sv(P, KR, _v1);
    rot(_qB, 0, 1, 0, _v1); sv(P, UL, _v1); sv(P, UR, _v1);
    rot(_qB, 0, 0, -1, _v1); sv(P, WL, _v1); sv(P, WR, _v1);
    droppedGun(P, -0.2 * sg, -0.75, 1.4 * sg);
  }
}

// ───────── 무기 모양 고르기 ─────────
const CAT_SHAPE: Record<WeaponCat, [SG.GunShape, number]> = {
  ar: ['rifle', 1], carbine: ['rifle', 0.88], dmr: ['rifle', 1.12], smg: ['smg', 1], shotgun: ['smg', 1.25],
  lmg: ['lmg', 1], sniper: ['sniper', 1], pistol: ['pistol', 1],
};
const DEVICE_COL: Partial<Record<GadgetKind, number>> = {
  medbag: 0xe6e6e0, ammobag: 0x7c8354, atmine: 0x4f5638, claymore: 0x6b7048, breach: 0xb59c6a, beacon: 0x404448,
  sensor: 0x6a6e70, cover: 0x5d6266, drone: 0x2e3134, defib: 0xd9b43a, stim: 0xf0f0f0, repair: 0xd08a2a,
  frag: 0x56603e, smoke: 0x7f8a80, flash: 0x2a2a2a, incendiary: 0xa83a24, impact: 0x5a5f3c,
};

const LAUNCHER: [SG.GunShape, number] = ['launcher', 1];
const DEVICE: [SG.GunShape, number] = ['device', 1];
const RIFLE: [SG.GunShape, number] = ['rifle', 1];
function gunOf(w: { st: { cat: WeaponCat } } | undefined): [SG.GunShape, number] {
  return (w && CAT_SHAPE[w.st.cat]) || RIFLE;
}

const SHAPE_IDX: Record<SG.GunShape, number> = { rifle: 0, smg: 1, lmg: 2, sniper: 3, pistol: 4, launcher: 5, device: 6 };
const CLS_PACK: Record<string, number> = { assault: 0, engineer: 1, support: 2, recon: 3 };

interface SideCols { uni: THREE.Color; gear: THREE.Color; helm: THREE.Color; band: THREE.Color }

export class SoldierLayer {
  private torso: IPart; private vest: IPart; private packs: IPart[]; private head: IPart;
  private helmUs: IPart; private helmRu: IPart;
  private uArm: IPart; private lArm: IPart; private hand: IPart; private thigh: IPart; private shin: IPart; private boot: IPart;
  private band: IPart; private guns: IPart[]; private lod: IPart;
  private all: IPart[];
  private mats: THREE.Material[];
  private tex: THREE.Texture | null;
  private anims: SAnim[] = [];
  private pA = new Float32Array(PN);
  private pB = new Float32Array(PN);
  private pO = new Float32Array(PN);
  private sideCols = new Map<Side, SideCols>();
  private devCols = new Map<number, THREE.Color>();
  private white = new THREE.Color(1, 1, 1);

  constructor(scene: THREE.Scene, quality: 'low' | 'medium' | 'high') {
    this.tex = camoTexture([0xffffff, 0xd2d2d2, 0xaeaeae], 913, 128, false);
    const camo = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, map: this.tex });
    const plain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    const gunM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.45 });
    const helmM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05, map: this.tex });
    this.mats = [camo, plain, gunM, helmM];
    const n = 160;
    this.torso = new IPart(scene, SG.torsoGeo(), camo, n);
    this.vest = new IPart(scene, SG.vestGeo(), camo, n);
    this.packs = [0, 1, 2, 3].map((k) => new IPart(scene, SG.packGeo(k), camo, n));
    this.head = new IPart(scene, SG.headGeo(), plain, n);
    this.helmUs = new IPart(scene, SG.helmetGeo('us'), helmM, n);
    this.helmRu = new IPart(scene, SG.helmetGeo('ru'), helmM, n);
    this.uArm = new IPart(scene, SG.upperArmGeo(), camo, n * 2);
    this.lArm = new IPart(scene, SG.lowerArmGeo(), camo, n * 2);
    this.hand = new IPart(scene, SG.handGeo(), plain, n * 2);
    this.thigh = new IPart(scene, SG.thighGeo(), camo, n * 2);
    this.shin = new IPart(scene, SG.shinGeo(), camo, n * 2);
    this.boot = new IPart(scene, SG.bootGeo(), plain, n * 2);
    this.band = new IPart(scene, SG.bandGeo(), plain, n * 2);
    this.guns = SG.GUN_SHAPES.map((s) => new IPart(scene, SG.gunGeo(s), gunM, n * 2));
    this.lod = new IPart(scene, SG.lodGeo(), camo, n);
    this.all = [this.torso, this.vest, ...this.packs, this.head, this.helmUs, this.helmRu, this.uArm, this.lArm, this.hand,
      this.thigh, this.shin, this.boot, this.band, ...this.guns, this.lod];
    this.setQuality(quality);
  }

  setQuality(q: 'low' | 'medium' | 'high'): void {
    const cast = q === 'high';
    for (const p of this.all) p.setShadow(cast && p !== this.band, q === 'high');
  }

  private cols(side: Side): SideCols {
    let c = this.sideCols.get(side);
    if (!c) {
      const f = FACTIONS[side];
      const camo = f ? f.camo : [0xdddddd, 0x999999, 0x555555];
      c = {
        uni: new THREE.Color(camo[0]), gear: new THREE.Color(camo[1]), helm: new THREE.Color(camo[2]),
        band: new THREE.Color(f ? f.color : 0xffffff),
      };
      this.sideCols.set(side, c);
    }
    return c;
  }

  private devCol(kind: GadgetKind): THREE.Color {
    const hex = DEVICE_COL[kind] ?? 0x808080;
    let c = this.devCols.get(hex);
    if (!c) { c = new THREE.Color(hex); this.devCols.set(hex, c); }
    return c;
  }

  private anim(s: Soldier, frame: number): SAnim {
    let a = this.anims[s.id];
    if (!a) {
      a = {
        seen: -10, yaw: s.yaw, pitch: s.pitch, sprint: 0, alert: 0, move: 0, mx: 0, mz: -1, lie: 0, lastShot: -99,
        vary: 0.93 + hash2(s.id, 3, 11) * 0.1, lastState: s.state, wasDown: s.state === 'down', deadVar: 0, deadYaw: s.yaw, deadSign: 1,
        ly: new Float32Array(PN), lyValid: false, lyType: -1, lyMix: 1,
      };
      if (s.state !== 'alive') { a.lie = 1; this.pickDead(s, a); }
      this.anims[s.id] = a;
    }
    if (a.seen < frame - 1) {
      // 오래 안 보였으면 부드러운 값들을 바로 맞춘다
      a.yaw = s.state === 'dead' ? a.deadYaw : s.yaw;
      a.pitch = s.pitch; a.sprint = s.sprinting ? 1 : 0;
      a.lie = s.state === 'alive' ? 0 : 1;
      a.lyValid = false;
    }
    a.seen = frame;
    return a;
  }

  private pickDead(s: Soldier, a: SAnim): void {
    a.deadVar = Math.floor(hash2(s.id, s.deaths, 7) * 3) % 3;
    a.deadSign = hash2(s.id, s.deaths, 13) > 0.5 ? 1 : -1;
    a.deadYaw = s.yaw + (hash2(s.id, s.deaths, 9) - 0.5) * 0.8;
  }

  update(g: Game, ctx: ActorCtx, viewer: number): void {
    const N = g.soldiers.length;
    for (const p of this.all) {
      const per = p === this.uArm || p === this.lArm || p === this.hand || p === this.thigh || p === this.shin || p === this.boot || p === this.band || this.guns.includes(p) ? 2 : 1;
      p.ensure(N * per);
      p.begin();
    }
    if (this.anims.length > N) this.anims.length = N;
    const q = ctx.quality;
    const lodD = q === 'low' ? 75 : 120;
    const maxD = q === 'low' ? 230 : q === 'medium' ? 330 : 450;
    for (let i = 0; i < N; i++) this.soldier(g, g.soldiers[i], ctx, viewer, lodD, maxD);
    for (const p of this.all) p.end();
  }

  private soldier(g: Game, s: Soldier, ctx: ActorCtx, viewer: number, lodD: number, maxD: number): void {
    // 상태 변화는 보이지 않아도 기록
    let a = this.anims[s.id];
    if (a && s.state !== a.lastState) {
      if (s.state === 'dead') this.pickDead(s, a);
      if (s.state === 'down') a.wasDown = true;
      if (s.state === 'alive') { a.wasDown = false; if (a.lastState === 'dead') { a.lie = 0; a.lyValid = false; } }
      a.lastState = s.state;
    }
    if (s.state === 'dead' && s.deadT > 10) return;

    let mounted = false;
    let veh: Vehicle | null = null;
    let turretSeat = false;
    if (s.vehicle >= 0) {
      veh = g.vehicles[s.vehicle] ?? null;
      if (!veh || !veh.alive || s.state !== 'alive') return;
      const def = VEHICLES[veh.type];
      const seat = def ? def.seats[s.seat] : undefined;
      if (!seat || !seat.exposed) return;
      mounted = true;
      turretSeat = seat.turret;
    }
    if (s.id === viewer && s.state === 'alive' && !mounted) return;

    let rx = s.pos.x, ry = s.pos.y, rz = s.pos.z;
    if (mounted && veh) {
      const sp = seatWorldPos(veh, s.seat);
      rx = sp.x; ry = sp.y - BODY_EYE; rz = sp.z;
    }
    const cam = ctx.cam;
    if (s.id === viewer) {
      const hy = ry + (mounted ? BODY_EYE + 0.06 : Math.max(0.3, s.eyeH));
      const dx = rx - cam.x, dy = hy - cam.y, dz = rz - cam.z;
      if (dx * dx + dy * dy + dz * dz < 1.0) return;
    }
    const dx = rx - cam.x, dy = ry - cam.y, dz = rz - cam.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > maxD * maxD) return;
    if (!inView(ctx, rx, ry + 0.8, rz, 1.5)) return;

    a = this.anim(s, ctx.frame);
    const dt = ctx.dt;

    // ── 부드러운 값 ──
    let tYaw = s.state === 'dead' ? a.deadYaw : s.yaw;
    let tPitch = s.pitch;
    if (mounted && veh && turretSeat) { tYaw = veh.yaw + veh.tYaw; tPitch = veh.tPitch; }
    let dy2 = tYaw - a.yaw;
    dy2 = Math.atan2(Math.sin(dy2), Math.cos(dy2));
    a.yaw += Math.abs(dy2) > 2 ? dy2 : dy2 * damp(18, dt);
    a.pitch += (tPitch - a.pitch) * damp(14, dt);
    a.sprint += ((s.sprinting && s.state === 'alive' ? 1 : 0) - a.sprint) * damp(8, dt);
    const firing = s.anim.fireT > 0 || (s.ctl.fire && s.held === 'weapon');
    if (firing) a.lastShot = ctx.t;
    const alertT = s.state === 'alive' && (ctx.t - a.lastShot < 3 || s.ads > 0.05 || s.ctl.ads || mounted) ? 1 : 0;
    a.alert += (alertT - a.alert) * damp(alertT > a.alert ? 10 : 1.4, dt);
    const hs = mounted ? 0 : Math.hypot(s.vel.x, s.vel.z);
    const cy = Math.cos(a.yaw), sy = Math.sin(a.yaw);
    if (hs > 0.3) {
      // 모델 공간 이동 방향 (오른쪽 +x, 앞 -z)
      const vR = s.vel.x * cy - s.vel.z * sy;
      const vf = -s.vel.x * sy - s.vel.z * cy;
      const k = damp(10, dt);
      a.mx += (vR / hs - a.mx) * k;
      a.mz += (-vf / hs - a.mz) * k;
      const l = Math.hypot(a.mx, a.mz) || 1;
      a.mx /= l; a.mz /= l;
    }
    a.move += ((hs > 0.35 && s.state === 'alive' ? 1 : 0) - a.move) * damp(7, dt);
    if (s.state !== 'alive') a.lie = Math.min(1, a.lie + dt * (1.2 + 3.5 * a.lie));
    else a.lie = Math.max(0, a.lie - dt * 1.6);

    const side: Side = g.sides[s.team] ?? (s.team === 0 ? 'us' : 'ru');
    const sc = this.cols(side);
    const vr = a.vary;

    const eyeH = clamp(s.eyeH, 0.42, 1.62);
    const proneL = s.state === 'alive' && !mounted ? ss((1.12 - eyeH) / (1.12 - 0.42)) : 0;
    const L = Math.max(proneL, ss(a.lie));
    let sink = 0;
    if (s.state === 'dead' && s.deadT > 8) sink = (s.deadT - 8) * 0.2;

    // ── 먼 거리: 한 덩어리 ──
    if (d2 > lodD * lodD) {
      _qYaw.setFromAxisAngle(AX, a.yaw);
      let lt = Ly.Prone;
      if (s.state === 'down') lt = Ly.Down;
      else if (s.state === 'dead') lt = a.wasDown ? Ly.DeadDown : Ly.Dead0 + a.deadVar;
      if (L > 0.5) {
        if (lt === Ly.Dead0) { qe(_q1, PI / 2, 0, 0); _v1.set(0, 0.15, -0.37); }
        else if (lt === Ly.Dead2) { qe(_q1, 0, 0, PI / 2 * a.deadSign); _v1.set(0.4 * a.deadSign, 0.18, 0); }
        else { qe(_q1, -PI / 2, 0, 0); _v1.set(0, 0.15, 0.8); }
        _s3.set(1, 1, 1);
      } else {
        _q1.identity();
        _v1.set(0, -Math.abs(Math.sin(s.anim.walk)) * 0.04 * a.move, 0);
        _s3.set(1, clamp((eyeH + 0.18) / 1.8, 0.55, 1), 1);
      }
      _v1.applyQuaternion(_qYaw).add(_v2.set(rx, ry - sink, rz));
      _q2.copy(_qYaw).multiply(_q1);
      _m.compose(_v1, _q2, _s3);
      this.lod.matrix(_m, sc.uni.r * vr, sc.uni.g * vr, sc.uni.b * vr);
      _s3.set(1, 1, 1);
      return;
    }

    // ── 입력 ──
    const w = s.weapons[s.cur];
    const prim = s.weapons[0];
    let hold: Hold = Hold.Rifle;
    let gun = gunOf(prim);
    let devKind: GadgetKind | null = null;
    if (mounted) hold = Hold.Mounted;
    else if (s.held === 'gadget') {
      const gs = s.gadgets[s.heldGadget];
      const kind = gs ? gs.kind : 'frag';
      if (kind === 'rocket' || kind === 'aa') { hold = Hold.Launcher; gun = LAUNCHER; }
      else if (kind === 'ugl') hold = Hold.Rifle;
      else { hold = Hold.Device; gun = DEVICE; devKind = kind; }
    } else {
      gun = gunOf(w);
      hold = !w ? Hold.None : gun[0] === 'pistol' ? Hold.Pistol : Hold.Rifle;
    }
    let shape: SG.GunShape = gun[0];
    const zs = gun[1];
    I.c = ss((1.62 - eyeH) / (1.62 - 1.12));
    I.eyeH = eyeH;
    I.sf = hs / 4.2;
    I.mv = a.move;
    I.mx = a.mx; I.mz = a.mz;
    I.phase = s.anim.walk;
    I.sprint = a.sprint;
    I.ads = s.state === 'alive' ? clamp(s.ads, 0, 1) : 0;
    I.alert = a.alert;
    I.pitch = a.pitch;
    I.kick = clamp(s.anim.fireT / 0.1, 0, 1) * (s.state === 'alive' ? 1 : 0);
    I.reload = s.held === 'weapon' && w && w.reloadT > 0 && w.reloadTotal > 0 ? clamp(1 - w.reloadT / w.reloadTotal, 0, 1) : -1;
    I.throwW = s.anim.throwT > 0 ? clamp(1 - s.anim.throwT / 0.6, 0, 1) : -1;
    I.hit = s.anim.hitT > 0 ? Math.sin(clamp(s.anim.hitT / 0.3, 0, 1) * PI) : 0;
    I.t = ctx.t + s.id * 1.37;
    I.hold = hold; I.shape = shape; I.zs = zs;
    I.slide = s.sliding > 0 ? 1 : 0;
    I.air = !s.onGround && s.state === 'alive' && !mounted ? 1 : 0;
    I.limp = 0;
    I.sign = a.deadSign;

    // ── 자세 ──
    let P: Float32Array = this.pA;
    if (L < 1) poseUpright(this.pA);
    if (L > 0) {
      let lt = Ly.Prone;
      if (s.state === 'down') lt = Ly.Down;
      else if (s.state === 'dead') lt = a.wasDown ? Ly.DeadDown : Ly.Dead0 + a.deadVar;
      const T = this.pB;
      if (lt === Ly.Prone) poseProne(T);
      else if (lt === Ly.Down) poseDown(T, 0);
      else if (lt === Ly.DeadDown) { I.t = s.id * 1.37; poseDown(T, 1); }
      else poseDead(T, lt - Ly.Dead0);
      if (!a.lyValid) { a.ly.set(T); a.lyValid = true; a.lyType = lt; a.lyMix = 1; }
      else {
        if (lt !== a.lyType) { a.lyType = lt; a.lyMix = 0; }
        if (a.lyMix < 1) { a.lyMix = Math.min(1, a.lyMix + dt * 1.8); blendPose(a.ly, T, damp(7, dt), a.ly); }
        else a.ly.set(T);
      }
      if (L >= 1) P = a.ly;
      else { blendPose(this.pA, a.ly, L, this.pO); P = this.pO; }
    } else a.lyValid = false;

    // dead 로 넘어갈 때 다리·총 모양
    const lying = L > 0.5 && s.state !== 'alive';
    let gzs = zs;
    if (lying) { const pg = gunOf(prim); shape = pg[0]; gzs = pg[1]; }
    const showGun = hold !== Hold.Mounted && (hold !== Hold.None || lying) && (lying ? !!prim : true);

    // ── 그리기 ──
    this.write(P, L, rx, ry - sink, rz, a.yaw, side, sc, vr, s, {
      legs: !mounted, gun: showGun, shape, zs: gzs, devKind,
      sling: !lying && !mounted && !!prim && (hold === Hold.Pistol || hold === Hold.Launcher || hold === Hold.Device),
      prim,
    });
  }

  private write(
    P: Float32Array, L: number, rx: number, ry: number, rz: number, yaw: number, side: Side, sc: SideCols, vr: number, s: Soldier,
    f: { legs: boolean; gun: boolean; shape: SG.GunShape; zs: number; devKind: GadgetKind | null; sling: boolean; prim: Soldier['weapons'][0] | undefined },
  ): void {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    _qYaw.setFromAxisAngle(AX, yaw);
    const ur = sc.uni.r * vr, ug = sc.uni.g * vr, ub = sc.uni.b * vr;
    const gr = sc.gear.r * vr, gg = sc.gear.g * vr, gb = sc.gear.b * vr;
    const W = this.white;
    // 모델 → 월드
    const toW = (v: THREE.Vector3): THREE.Vector3 => {
      const x = v.x;
      v.x = cy * x + sy * v.z + rx; v.y += ry; v.z = -sy * x + cy * v.z + rz;
      return v;
    };
    const rY = (v: THREE.Vector3): THREE.Vector3 => {
      const x = v.x;
      v.x = cy * x + sy * v.z; v.z = -sy * x + cy * v.z;
      return v;
    };
    /** A → B 로 뻗는 마디 (모델 공간 점), 앞 방향 hint */
    const seg = (part: IPart, A: THREE.Vector3, B: THREE.Vector3, hint: THREE.Vector3, r: number, g: number, b: number): void => {
      _by.subVectors(A, B);
      const l = _by.length();
      if (l < 1e-6) _by.set(0, 1, 0); else _by.multiplyScalar(1 / l);
      _bz.copy(hint).addScaledVector(_by, -hint.dot(_by));
      if (_bz.lengthSq() < 1e-8) _bz.set(0, 0, -1).addScaledVector(_by, _by.z);
      _bz.normalize().negate();
      _bx.crossVectors(_by, _bz);
      rY(_bx); rY(_by); rY(_bz);
      _v4.copy(A); toW(_v4);
      part.basis(_bx.x, _bx.y, _bx.z, _by.x, _by.y, _by.z, _bz.x, _bz.y, _bz.z, _v4.x, _v4.y, _v4.z, r, g, b);
    };

    // 몸통
    gv(P, PP, _pel);
    gq(P, TQ, _qT);
    gq(P, PQ, _qP);
    gq(P, HQ, _qH);
    _v1.copy(_pel); toW(_v1);
    _q1.copy(_qYaw).multiply(_qT);
    _m.compose(_v1, _q1, _s3);
    this.torso.matrix(_m, ur, ug, ub);
    this.vest.matrix(_m, gr, gg, gb);
    const pack = this.packs[CLS_PACK[s.cls] ?? 0];
    pack.matrix(_m, gr, gg, gb);
    // 등에 멘 주무기
    if (f.sling && f.prim) {
      const cs = CAT_SHAPE[f.prim.st.cat] ?? CAT_SHAPE.ar;
      rot(_qT, 0.21, 0.2, 0.13, _v2).add(_pel); toW(_v2);
      _q2.copy(_q1).multiply(qe(_qG, -PI / 2 + 0.25, 0.3, 0));
      _m.compose(_v2, _q2, _v3.set(1, 1, cs[1]));
      this.guns[SHAPE_IDX[cs[0]]].matrix(_m, 1, 1, 1);
    }
    // 머리
    rot(_qT, 0, SEG.neck, 0, _N).add(_pel);
    _v1.copy(_N); toW(_v1);
    _q2.copy(_qYaw).multiply(_qH);
    _m.compose(_v1, _q2, _s3);
    this.head.matrix(_m, W.r, W.g, W.b);
    (side === 'ru' ? this.helmRu : this.helmUs).matrix(_m, sc.helm.r, sc.helm.g, sc.helm.b);
    // 헬멧 적외선 패치
    rot(_q2, 0, side === 'ru' ? 0.305 : 0.305, 0.07, _v2).add(_v1);
    _m.compose(_v2, _q2, _v3.set(0.3, 0.25, 0.3));
    this.band.matrix(_m, sc.band.r, sc.band.g, sc.band.b);

    // 팔
    for (let k = 0; k < 2; k++) {
      const sd = k === 0 ? -1 : 1;
      rot(_qT, sd * SEG.shoulderX, SEG.shoulderY, 0, _a).add(_pel);
      gv(P, k === 0 ? HL : HR, _b);
      gv(P, k === 0 ? EL : ER, _pole);
      // 목표는 손바닥: 팔꿈치→손바닥 = 아래팔 + 손 절반
      ik(_a, _b, _pole, SEG.upperArm + 0.01, SEG.lowerArm + 0.045, _mid, _end);
      _c.copy(_pole).negate();
      seg(this.uArm, _a, _mid, _c, ur, ug, ub);
      if (k === 0) {
        // 완장: 위팔 1/3 지점
        _v2.copy(_a).lerp(_mid, 0.33);
        seg(this.band, _v2, _mid, _c, sc.band.r, sc.band.g, sc.band.b);
      }
      _v3.subVectors(_end, _mid).normalize();
      _end.copy(_mid).addScaledVector(_v3, SEG.lowerArm);
      seg(this.lArm, _mid, _end, _c, ur, ug, ub);
      _v2.copy(_end).addScaledVector(_v3, 0.1);
      seg(this.hand, _end, _v2, _c, W.r, W.g, W.b);
    }

    // 다리
    if (f.legs) {
      for (let k = 0; k < 2; k++) {
        const sd = k === 0 ? -1 : 1;
        rot(_qP, sd * SEG.hipX, SEG.hipY, 0, _a).add(_pel);
        gv(P, k === 0 ? FL : FR, _b);
        gv(P, k === 0 ? KL : KR, _pole);
        ik(_a, _b, _pole, SEG.thigh, SEG.shin, _mid, _end);
        seg(this.thigh, _a, _mid, _pole, ur * 0.97, ug * 0.97, ub * 0.97);
        seg(this.shin, _mid, _end, _pole, ur * 0.97, ug * 0.97, ub * 0.97);
        // 장화: 위 = 발 방향과 정강이 방향 섞기
        gv(P, k === 0 ? UL : UR, _v2).normalize();
        _v3.subVectors(_mid, _end).normalize();
        const kL = L * 0.7;
        _v2.multiplyScalar(1 - kL).addScaledVector(_v3, kL);
        gv(P, k === 0 ? WL : WR, _c);
        _v3.copy(_end).sub(_v2);
        seg(this.boot, _end, _v3, _c, W.r, W.g, W.b);
      }
    }

    // 총
    if (f.gun) {
      gv(P, GP, _v1); toW(_v1);
      gq(P, GQ, _qG);
      _q2.copy(_qYaw).multiply(_qG);
      const zs = f.shape === 'launcher' || f.shape === 'device' ? 1 : f.zs;
      _m.compose(_v1, _q2, _v3.set(1, 1, zs));
      let col = W;
      if (f.shape === 'device' && f.devKind) col = this.devCol(f.devKind);
      this.guns[SHAPE_IDX[f.shape]].matrix(_m, col.r, col.g, col.b);
    }
  }

  dispose(): void {
    for (const p of this.all) { p.dispose(); p.geo.dispose(); }
    for (const m of this.mats) m.dispose();
    if (this.tex) this.tex.dispose();
    this.anims.length = 0;
  }
}

/** 서 있을 때 눈높이 (탑승 좌석 위치 = 눈) */
const BODY_EYE = 1.62;
