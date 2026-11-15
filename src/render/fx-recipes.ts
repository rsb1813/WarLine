// render-fx: 효과 조리법. 이벤트 하나를 파티클·파편·데칼·빛 묶음으로 바꾼다.
// 모든 개수는 품질(q)과 카메라 거리·방향(lod)으로 줄어든다. 풀은 가득 차면 새 파티클을 버린다(빈 칸).
import * as THREE from 'three';
import type { Box, Building, GroundType, Vec3, World } from '../types';
import { clamp, forwardXZ, rightXZ } from '../math';
import { groundTypeAt, heightAt, inWater, raycast } from '../world';
import { F } from './fx-textures';
import type { Col, ParticlePool } from './fx-particles';
import type { Decals } from './fx-decals';
import type { Debris } from './fx-debris';
import type { LightPool } from './fx-lights';

// ───────────────────────── 공용 상태 ─────────────────────────

export class FxCtx {
  time = 0;
  world: World | null = null;
  readonly cam = new THREE.Vector3();
  readonly camDir = new THREE.Vector3(0, 0, -1);
  /** 해질녘·흐림: 총구 빛 켜기 */
  dim = false;
  snowy = false;
  private queue: { t: number; fn: () => void }[] = [];

  constructor(
    readonly add: ParticlePool,
    readonly alp: ParticlePool,
    readonly decals: Decals,
    readonly debris: Debris,
    readonly lights: LightPool,
    /** 품질 배율 0.4 / 0.7 / 1 */
    readonly q: number,
  ) {}

  later(delay: number, fn: () => void): void { this.queue.push({ t: this.time + delay, fn }); }

  runQueue(): void {
    if (this.queue.length === 0) return;
    const now = this.time;
    const due: (() => void)[] = [];
    this.queue = this.queue.filter((e) => { if (e.t <= now) { due.push(e.fn); return false; } return true; });
    for (const fn of due) fn();
  }

  clearQueue(): void { this.queue.length = 0; }

  distTo(p: Vec3): number { return Math.hypot(p.x - this.cam.x, p.y - this.cam.y, p.z - this.cam.z); }
}

// ───────────────────────── 도우미 ─────────────────────────

const R = Math.random;
export const rr = (a: number, b: number): number => a + (b - a) * R();
export const col = (r: number, g: number, b: number): Col => ({ r, g, b });
export const hex = (h: number): Col => { const c = new THREE.Color(h); return { r: c.r, g: c.g, b: c.b }; };
const mul = (c: Col, k: number): Col => ({ r: c.r * k, g: c.g * k, b: c.b * k });
const mix = (a: Col, b: Col, t: number): Col => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });

/** 소수 부분은 확률로 */
export const cnt = (v: number): number => { if (v <= 0) return 0; const f = Math.floor(v); return f + (R() < v - f ? 1 : 0); };
const smokeF = (): number => F.SMOKE + ((R() * 4) | 0);
const dustF = (): number => F.DUST + ((R() * 2) | 0);

const U = { x: 0, y: 0, z: 0 };
function rndSphere(): typeof U {
  let x = 0, y = 0, z = 0, l = 0;
  do { x = R() * 2 - 1; y = R() * 2 - 1; z = R() * 2 - 1; l = x * x + y * y + z * z; } while (l > 1 || l < 1e-4);
  l = Math.sqrt(l); U.x = x / l; U.y = y / l; U.z = z / l;
  return U;
}
function rndUp(bias = 0.15): typeof U {
  rndSphere();
  U.y = Math.abs(U.y) + bias;
  const l = Math.hypot(U.x, U.y, U.z); U.x /= l; U.y /= l; U.z /= l;
  return U;
}
function rndCone(n: Vec3, spread: number): typeof U {
  rndSphere();
  const x = n.x + U.x * spread, y = n.y + U.y * spread, z = n.z + U.z * spread;
  const l = Math.hypot(x, y, z) || 1;
  U.x = x / l; U.y = y / l; U.z = z / l;
  return U;
}

/** 거리·화면 방향에 따른 개수 배율 (0 = 만들지 않음). lasting = 오래 남는 효과(돌아보면 보임) */
export function lodOf(fx: FxCtx, p: Vec3, lasting: boolean): number {
  const dx = p.x - fx.cam.x, dy = p.y - fx.cam.y, dz = p.z - fx.cam.z;
  const d = Math.hypot(dx, dy, dz);
  let k = d < 40 ? 1 : d < 100 ? 0.75 : d < 220 ? 0.5 : d < 450 ? 0.3 : lasting && d < 900 ? 0.18 : 0;
  if (k > 0 && d > 12) {
    const f = (dx * fx.camDir.x + dy * fx.camDir.y + dz * fx.camDir.z) / d;
    if (f < 0.2) k *= lasting ? 0.6 : f < -0.25 ? 0 : 0.35;
  }
  return k;
}

/** 파티클 하나 + 자주 쓰는 세부 값 */
function P(pool: ParticlePool, x: number, y: number, z: number, vx: number, vy: number, vz: number,
  life: number, s0: number, s1: number, frame: number, c0: Col, c1: Col, a: number,
  drag = 0, grav = 0, wnd = 0, fin = 0.08, fout = 0.5): number {
  const i = pool.emit(x, y, z, vx, vy, vz, life, s0, s1, frame, c0, c1, a);
  pool.drag[i] = drag; pool.grav[i] = grav; pool.wnd[i] = wnd; pool.fin[i] = fin; pool.fout[i] = fout;
  return i;
}

// ───────────────────────── 색 ─────────────────────────

const C = {
  flash0: col(7, 5.4, 3.4), flash1: col(3, 1.4, 0.4),
  cone0: col(6, 4.2, 2.2), cone1: col(2.5, 1.1, 0.3),
  mglow0: col(1.6, 1.0, 0.45), mglow1: col(0.6, 0.25, 0.05),
  spark0: col(9, 6.5, 3.2), spark1: col(3, 0.8, 0.12),
  fire0: col(3.4, 2.6, 1.8), fire1: col(1.15, 0.45, 0.14),
  flame0: col(2.5, 1.55, 0.8), flame1: col(0.95, 0.32, 0.08),
  ember0: col(3.2, 1.2, 0.25), ember1: col(1.0, 0.12, 0.0),
  glowE0: col(2.6, 1.5, 0.6), glowE1: col(1.1, 0.3, 0.05),
  ring0: col(1.7, 1.4, 1.1), ring1: col(0.6, 0.4, 0.25),
  glint0: col(3, 3.2, 3.6), glint1: col(1, 1.05, 1.2),
  smokeLit: col(0.42, 0.27, 0.15),
  wisp: col(0.82, 0.82, 0.8), wisp1: col(0.7, 0.7, 0.7),
  black: col(0.05, 0.047, 0.044), black1: col(0.11, 0.105, 0.1),
  white: col(1, 1, 1),
  blood: hex(0x5a0806), blood1: hex(0x3a0605),
  water: hex(0xe6eff5),
  snow: hex(0xf3f6fb),
  metal: hex(0x2c2c2e),
};

const DUSTC: Record<string, Col> = {
  concrete: hex(0x9e9a92), rock: hex(0x8c8882), brick: hex(0xa47460), sand: hex(0xc2aa82), wood: hex(0x8c6c4a),
  metal: hex(0x7a7672), glass: hex(0xdce6ec), foliage: hex(0x667548), snow: hex(0xf3f6fb), dirt: hex(0x6e5a44), water: hex(0xe6eff5),
};
const CHIPC: Record<string, Col> = {
  concrete: hex(0x77736d), rock: hex(0x605d58), brick: hex(0x8e4c36), sand: hex(0xa28a62), wood: hex(0x75502e),
  metal: hex(0x3b3b3e), glass: hex(0xd2ecf6), foliage: hex(0x3f5c28), snow: hex(0xffffff), dirt: hex(0x3f3125),
};
/** GroundType → 먼지, 덩어리 색 */
const GROUND_DUST: Col[] = [hex(0xe2e6eb), hex(0x7d6f58), hex(0x5f4d3b), hex(0x57534f), hex(0x8f8b84), hex(0x9c8f76)];
const GROUND_CHIP: Col[] = [hex(0x6a5d4c), hex(0x4e4232), hex(0x3a2e22), hex(0x2f2d2b), hex(0x6a6660), hex(0x6f6450)];
const LEAVES: Col[] = [hex(0x3b5a26), hex(0x4f6b2e), hex(0x2f4a22)];

export function teamTracer(side: string): Col { return side === 'ru' ? col(1.4, 6.5, 1.6) : col(7.5, 2.4, 0.7); }

// ───────────────────────── 불티 ─────────────────────────

export function sparks(fx: FxCtx, x: number, y: number, z: number, n: Vec3 | null, count: number, speed: number,
  life: number, gy: number, width = 0.03): void {
  for (let k = 0; k < count; k++) {
    const d = n ? rndCone(n, 0.9) : rndUp(0.2);
    const s = speed * rr(0.45, 1.3);
    const i = P(fx.add, x, y, z, d.x * s, d.y * s, d.z * s, life * rr(0.55, 1.3), width, width, F.STREAK, C.spark0, C.spark1, 1, 1.0, 9.8, 0, 0, 0.55);
    fx.add.streak(i, 0.06, 0.03);
    fx.add.gy[i] = gy; fx.add.bnc[i] = 0.4;
  }
}

// ───────────────────────── 총구·예광탄 ─────────────────────────

/** 3인칭 총구 섬광 + 연기 한 줄기. sc: 크기 배율 */
export function muzzle(fx: FxCtx, p: Vec3, d: Vec3, sc: number, suppressed: boolean, smoke = 1): void {
  const near = fx.distTo(p) < 1.4;
  if (!near) {
    if (!suppressed) {
      let i = P(fx.add, p.x, p.y, p.z, 0, 0, 0, rr(0.04, 0.065), 0.5 * sc, 0.75 * sc, F.STAR, C.flash0, C.flash1, 1, 0, 0, 0, 0, 0.25);
      const L = 0.6 * sc * rr(0.8, 1.25);
      i = P(fx.add, p.x + d.x * L, p.y + d.y * L, p.z + d.z * L, d.x * 0.01, d.y * 0.01, d.z * 0.01, rr(0.035, 0.055),
        0.34 * sc, 0.36 * sc, F.CONE, C.cone0, C.cone1, 1, 0, 0, 0, 0, 0.3);
      fx.add.streak(i, L, 0);
      P(fx.add, p.x, p.y, p.z, 0, 0, 0, 0.07, 1.1 * sc, 1.3 * sc, F.GLOW, C.mglow0, C.mglow1, 0.6, 0, 0, 0, 0, 0.2);
    } else {
      P(fx.add, p.x, p.y, p.z, 0, 0, 0, 0.05, 0.25 * sc, 0.3 * sc, F.GLOW, C.mglow0, C.mglow1, 0.35, 0, 0, 0, 0, 0.2);
    }
  }
  if (smoke > 0 && (fx.q > 0.5 || R() < 0.5)) {
    const i = P(fx.alp, p.x + d.x * 0.3, p.y + d.y * 0.3, p.z + d.z * 0.3,
      d.x * 1.3 + rr(-0.2, 0.2), d.y * 1.3 + 0.3, d.z * 1.3 + rr(-0.2, 0.2),
      rr(0.8, 1.4), 0.12 * sc, rr(0.6, 0.95) * sc, smokeF(), C.wisp, C.wisp1, (suppressed ? 0.14 : 0.22) * smoke, 3, -0.35, 1, 0.05, 0.3);
    fx.alp.tint(i, rr(0.9, 1.05));
  }
}

/** 예광탄: 늘인 줄이 탄속으로 날아가 처음 닿는 곳에서 멈춘다 */
export function tracer(fx: FxCtx, from: Vec3, d: Vec3, speed: number, c: Col, maxT: number, width = 0.07): void {
  const L = clamp(speed * 0.0065, 2.5, 7);
  let hitT = maxT;
  if (fx.world) {
    const h = raycast(fx.world, from, d, maxT, false);
    if (h) hitT = h.t;
  }
  if (hitT < L + 1) return;
  const life = Math.min(0.75, (hitT - L) / speed);
  const i = P(fx.add, from.x + d.x * L, from.y + d.y * L, from.z + d.z * L, d.x * speed, d.y * speed, d.z * speed,
    life, width, width, F.STREAK, c, c, 1, 0, 0, 0, 0, 0.92);
  fx.add.streak(i, L, 0);
}

// ───────────────────────── 탄착 ─────────────────────────

const UPV: Vec3 = { x: 0, y: 1, z: 0 };

export function impact(fx: FxCtx, p: Vec3, nIn: Vec3, mat: string, big: boolean): void {
  const nl = Math.hypot(nIn.x, nIn.y, nIn.z);
  const n: Vec3 = nl > 0.5 ? { x: nIn.x / nl, y: nIn.y / nl, z: nIn.z / nl } : UPV;
  const d = fx.distTo(p);
  const k = big ? 2.2 : 1;

  // 데칼
  if (d < 140) {
    const life = 120;
    switch (mat) {
      case 'water': case 'foliage': break;
      case 'glass': fx.decals.add(p, n, rr(0.22, 0.32) * (big ? 2 : 1), F.CRACK, C.white, 0.9, life, fx.time); break;
      case 'snow': fx.decals.add(p, n, 0.15 * (big ? 2.4 : 1), F.DENT, col(0.78, 0.84, 0.95), 0.8, 60, fx.time); break;
      case 'dirt': fx.decals.add(p, n, 0.16 * (big ? 2.4 : 1), F.DENT, col(0.62, 0.53, 0.45), 0.85, 60, fx.time); break;
      case 'metal': fx.decals.add(p, n, rr(0.07, 0.09) * (big ? 2.2 : 1), F.HOLE, col(0.85, 0.85, 0.9), 0.92, life, fx.time); break;
      case 'wood': fx.decals.add(p, n, rr(0.09, 0.12) * (big ? 2.2 : 1), F.HOLE, col(0.78, 0.62, 0.48), 0.95, life, fx.time); break;
      default: fx.decals.add(p, n, rr(0.09, 0.125) * (big ? 2.4 : 1), F.HOLE, C.white, 0.95, life, fx.time);
    }
    if (big && mat !== 'water' && mat !== 'glass' && mat !== 'foliage') fx.decals.add(p, n, rr(0.6, 0.9), F.SCORCH, C.white, 0.55, 150, fx.time);
  }

  const lod = lodOf(fx, p, false);
  if (lod <= 0) return;
  const qq = fx.q * lod;
  const x = p.x + n.x * 0.04, y = p.y + n.y * 0.04, z = p.z + n.z * 0.04;
  const terr = fx.world ? heightAt(fx.world, p.x, p.z) : p.y - 2;
  const gy = n.y > 0.6 ? p.y + 0.01 : Math.max(terr, p.y - 3);

  const dust = (c: Col, nP: number, a: number, size: number, life: number, grav: number): void => {
    for (let j = 0; j < nP; j++) {
      const s = rr(1.2, 2.8) * k;
      const r = rndSphere();
      const i = P(fx.alp, x, y, z, n.x * s + r.x * 0.5, n.y * s + r.y * 0.5 + 0.2, n.z * s + r.z * 0.5,
        rr(life * 0.7, life * 1.3) * (big ? 1.5 : 1), 0.12 * k * size, rr(0.75, 1.15) * k * size, dustF(), c, c, a * rr(0.85, 1.1),
        3.2, grav, 0.7, 0.04, 0.3);
      fx.alp.tint(i, rr(0.9, 1.08));
    }
  };
  const bits = (frame: number, c: Col, nP: number, size: number, speed: number, spread: number, grav: number, life: number, a = 1): void => {
    for (let j = 0; j < nP; j++) {
      const r = rndCone(n, spread);
      const s = speed * rr(0.5, 1.2) * (big ? 1.3 : 1);
      const i = P(fx.alp, x, y, z, r.x * s, r.y * s + 0.8, r.z * s, rr(life * 0.7, life * 1.2), size * rr(0.6, 1.3) * k, 0, frame + (frame === F.CHIP && R() < 0.5 ? F.CHIP2 - F.CHIP : 0),
        c, c, a, 0.4, grav, 0, 0, 0.75);
      fx.alp.s1[i] = fx.alp.s0[i];
      fx.alp.rv[i] = rr(-16, 16);
      fx.alp.gy[i] = gy; fx.alp.bnc[i] = 0.25;
      fx.alp.tint(i, rr(0.8, 1.15));
    }
  };

  switch (mat) {
    case 'metal': {
      sparks(fx, x, y, z, n, Math.max(2, cnt((5 + 4 * R()) * k * qq)), 11, 0.4, gy);
      P(fx.add, x, y, z, 0, 0, 0, 0.045, 0.22 * k, 0.3 * k, F.STAR, C.flash0, C.flash1, 1, 0, 0, 0, 0, 0.2);
      dust(DUSTC.metal, cnt(0.8 * qq), 0.3, 0.6, 1.0, 0);
      break;
    }
    case 'wood': {
      bits(F.SPLINTER, CHIPC.wood, cnt(5 * k * qq), 0.1, 6, 1.0, 9.8, 0.9);
      dust(DUSTC.wood, Math.max(1, cnt(1.2 * k * qq)), 0.4, 0.8, 1.2, 0.05);
      break;
    }
    case 'glass': {
      for (let j = 0; j < cnt(7 * k * qq); j++) {
        const side = R() < 0.5 ? 1 : -1;
        const r = rndCone({ x: n.x * side, y: n.y * side, z: n.z * side }, 1.1);
        const s = rr(2, 6);
        const i = P(fx.alp, x, y, z, r.x * s, r.y * s + 0.5, r.z * s, rr(0.6, 1.1), rr(0.03, 0.07) * k, 0, F.SHARD, CHIPC.glass, CHIPC.glass, 0.85, 0.3, 9.8, 0, 0, 0.75);
        fx.alp.s1[i] = fx.alp.s0[i]; fx.alp.rv[i] = rr(-22, 22); fx.alp.gy[i] = gy; fx.alp.tint(i, 1.2);
      }
      for (let j = 0; j < cnt(4 * k * qq); j++) {
        const r = rndCone(n, 1.3);
        const s = rr(1.5, 5);
        const i = P(fx.add, x, y, z, r.x * s, r.y * s + 0.5, r.z * s, rr(0.3, 0.7), rr(0.04, 0.07), rr(0.02, 0.05), F.GLOW, C.glint0, C.glint1, 1, 0.3, 9.8, 0, 0, 0.3);
        fx.add.gy[i] = gy;
      }
      dust(DUSTC.glass, cnt(0.7 * qq), 0.18, 0.6, 1.0, 0.1);
      break;
    }
    case 'snow': {
      for (let j = 0; j < Math.max(1, cnt(3 * k * qq)); j++) {
        const s = rr(1.5, 3) * k;
        const r = rndSphere();
        P(fx.alp, x, y, z, n.x * s + r.x * 0.6, n.y * s + rr(0.5, 1.5), n.z * s + r.z * 0.6,
          rr(1.4, 2.4) * (big ? 1.4 : 1), 0.2 * k, rr(1.0, 1.6) * k, dustF(), C.snow, C.snow, rr(0.55, 0.7), 3, 0.35, 0.8, 0.04, 0.35);
      }
      bits(F.CHIP, C.snow, cnt(4 * k * qq), 0.075, 4.5, 0.6, 9.8, 0.9, 0.95);
      break;
    }
    case 'dirt': {
      bits(F.CHIP, CHIPC.dirt, cnt(6 * k * qq), 0.065, 5, 0.5, 9.8, 0.9);
      dust(DUSTC.dirt, Math.max(1, cnt(2 * k * qq)), 0.5, 1, 1.4, 0.15);
      break;
    }
    case 'water': {
      const wy = p.y;
      for (let j = 0; j < cnt(8 * k * qq); j++) {
        const s = rr(2.5, 5.5) * k;
        const i = P(fx.alp, x, wy + 0.05, z, rr(-0.8, 0.8), s, rr(-0.8, 0.8), rr(0.7, 1.1), rr(0.06, 0.13) * k, 0, F.DROP, C.water, C.water, 0.85, 0.2, 9.8, 0, 0, 0.7);
        fx.alp.s1[i] = fx.alp.s0[i] * 0.7; fx.alp.gy[i] = wy - 0.1;
      }
      for (let j = 0; j < cnt(3 * k * qq); j++) {
        const s = rr(4, 7) * k;
        const i = P(fx.alp, x, wy, z, rr(-0.5, 0.5), s, rr(-0.5, 0.5), rr(0.55, 0.85), 0.05 * k, 0.05 * k, F.STREAK, C.water, C.water, 0.55, 0.2, 9.8, 0, 0, 0.6);
        fx.alp.streak(i, 0.2, 0.06); fx.alp.gy[i] = wy - 0.1;
      }
      const i = P(fx.alp, x, wy + 0.03, z, 0, 0, 0, 0.9, 0.1, rr(1.0, 1.4) * k, F.RING, C.water, C.water, 0.45, 0, 0, 0, 0, 0.3);
      fx.alp.mode[i] = 2;
      P(fx.alp, x, wy + 0.2, z, 0, 0.6, 0, rr(1, 1.6), 0.2 * k, 0.9 * k, dustF(), C.water, C.water, 0.3, 2, 0, 0.8, 0.05, 0.3);
      break;
    }
    case 'foliage': {
      for (let j = 0; j < Math.max(1, cnt(5 * k * qq)); j++) {
        const r = rndCone(n, 1.2);
        const s = rr(1.5, 3.5);
        const c = LEAVES[(R() * LEAVES.length) | 0];
        const i = P(fx.alp, x, y, z, r.x * s, r.y * s + 0.5, r.z * s, rr(1.0, 1.8), rr(0.05, 0.1) * k, 0, F.LEAF, c, c, 1, 2.5, 2.2, 0.5, 0, 0.7);
        fx.alp.s1[i] = fx.alp.s0[i]; fx.alp.rv[i] = rr(-8, 8); fx.alp.gy[i] = gy;
      }
      if (fx.snowy) dust(C.snow, cnt(1 * qq), 0.4, 0.8, 1.6, 0.5);
      break;
    }
    default: {
      const dc = DUSTC[mat] ?? DUSTC.concrete, cc = CHIPC[mat] ?? CHIPC.concrete;
      dust(dc, Math.max(1, cnt(2 * k * qq)), 0.5, 1, 1.5, 0.05);
      bits(F.CHIP, cc, cnt(4 * k * qq), 0.06, 6, 0.8, 9.8, 0.85);
      if ((mat === 'rock' || mat === 'concrete') && R() < 0.3) sparks(fx, x, y, z, n, 1 + ((R() * 2) | 0), 8, 0.25, gy, 0.02);
    }
  }
}

// ───────────────────────── 피격 ─────────────────────────

export function blood(fx: FxCtx, p: Vec3, head: boolean): void {
  const lod = lodOf(fx, p, false);
  if (lod <= 0) return;
  const k = head ? 1.3 : 1;
  for (let j = 0; j < Math.max(1, cnt(2 * fx.q * lod)); j++) {
    const r = rndSphere();
    P(fx.alp, p.x, p.y, p.z, r.x * 0.8, r.y * 0.5 + 0.2, r.z * 0.8, rr(0.3, 0.5), 0.12 * k, rr(0.45, 0.65) * k, smokeF(), C.blood, C.blood1, 0.38, 4, 1.5, 0, 0.05, 0.3);
  }
  for (let j = 0; j < cnt(3 * fx.q * lod); j++) {
    const r = rndSphere();
    const s = rr(1, 3);
    const i = P(fx.alp, p.x, p.y, p.z, r.x * s, r.y * s + 1, r.z * s, rr(0.35, 0.6), 0.035, 0, F.DROP, C.blood1, C.blood1, 0.9, 0.5, 9.8, 0, 0, 0.6);
    fx.alp.s1[i] = fx.alp.s0[i];
  }
}

export function vehicleSparks(fx: FxCtx, p: Vec3, big: boolean): void {
  const lod = lodOf(fx, p, false);
  if (lod <= 0) return;
  const qq = fx.q * lod;
  const gy = fx.world ? heightAt(fx.world, p.x, p.z) : p.y - 2;
  sparks(fx, p.x, p.y, p.z, null, Math.max(3, cnt((big ? 16 : 8) * qq)), big ? 13 : 9, 0.55, gy);
  P(fx.add, p.x, p.y, p.z, 0, 0, 0, 0.05, big ? 0.8 : 0.4, big ? 1.1 : 0.55, F.STAR, C.flash0, C.flash1, 1, 0, 0, 0, 0, 0.2);
  P(fx.alp, p.x, p.y, p.z, rr(-0.3, 0.3), 0.6, rr(-0.3, 0.3), rr(1, 1.8), 0.2, big ? 1.4 : 0.8, smokeF(), C.black1, C.wisp1, 0.35, 2, -0.3, 1, 0.05, 0.3);
}

// ───────────────────────── 폭발 ─────────────────────────

export type ExpKind = 'grenade' | 'rocket' | 'shell' | 'vehicle' | 'mine' | 'c4' | 'ugl';
interface ExpDef { s: number; fire: number; smoke: number; dust: number; deb: number; col: number; dark: number }
const EXP: Record<ExpKind, ExpDef> = {
  grenade: { s: 0.5, fire: 0.6, smoke: 0.8, dust: 1.0, deb: 0.8, col: 0.4, dark: 0.35 },
  ugl: { s: 0.55, fire: 0.7, smoke: 0.7, dust: 0.9, deb: 0.7, col: 0.3, dark: 0.4 },
  rocket: { s: 0.75, fire: 1.0, smoke: 1.0, dust: 1.0, deb: 1.0, col: 0.5, dark: 0.7 },
  shell: { s: 0.8, fire: 0.9, smoke: 1.0, dust: 1.4, deb: 1.3, col: 1.0, dark: 0.6 },
  mine: { s: 0.8, fire: 0.7, smoke: 0.9, dust: 1.5, deb: 1.4, col: 1.5, dark: 0.5 },
  c4: { s: 0.85, fire: 1.2, smoke: 1.1, dust: 1.2, deb: 1.2, col: 0.6, dark: 0.8 },
  vehicle: { s: 1.0, fire: 1.6, smoke: 1.6, dust: 1.0, deb: 1.0, col: 0.3, dark: 1.0 },
};

const DOWN: Vec3 = { x: 0, y: -1, z: 0 };

export function explosion(fx: FxCtx, p: Vec3, r: number, kind: ExpKind): void {
  const def = EXP[kind] ?? EXP.rocket;
  const vr = kind === 'vehicle' ? clamp(Math.max(r, 5) * def.s, 3, 10) : clamp(r * def.s, 1.2, 10);
  const w = fx.world;
  const x = p.x, y = p.y, z = p.z;

  // 아래 면 찾기 (지형·바닥·지붕)
  const hit = w ? raycast(w, { x, y: y + 0.3, z }, DOWN, vr * 1.2 + 0.3, false) : null;
  const water = !!w && inWater(w, x, z) && y - w.water < vr * 0.8 && (!hit || hit.box === -2 || hit.point.y < w.water);
  const surf = water ? w!.water : hit ? hit.point.y : null;
  let gt: GroundType = 2;
  let dustC: Col, chipC: Col;
  if (hit && hit.box >= 0) {
    dustC = DUSTC[hit.mat] ?? DUSTC.concrete; chipC = CHIPC[hit.mat] ?? CHIPC.concrete;
  } else {
    gt = w ? groundTypeAt(w, x, z) : 2;
    dustC = GROUND_DUST[gt] ?? GROUND_DUST[2]; chipC = GROUND_CHIP[gt] ?? GROUND_CHIP[2];
  }
  const snowGround = !water && !!hit && (hit.mat === 'snow' || (hit.box < 0 && gt === 0));

  // 빛 (거리 상관없이: 먼 섬광도 보인다)
  fx.lights.flash(x, y + 0.6 + vr * 0.25, z, 0xffb070, 70 * vr * vr, vr * 9, kind === 'vehicle' ? 0.6 : 0.34, 2);

  const lod = lodOf(fx, p, true);
  if (lod <= 0) return;
  const qq = fx.q * lod;
  const fireK = water ? 0.4 : def.fire;

  // 섬광
  P(fx.add, x, y + 0.3, z, 0, 0, 0, 0.09, vr * 3.0, vr * 3.6, F.STAR, C.flash0, C.flash1, 1, 0, 0, 0, 0, 0.15);
  P(fx.add, x, y + 0.3, z, 0, 0, 0, 0.3, vr * 3.5, vr * 4.8, F.GLOW, C.glowE0, C.glowE1, 0.7, 0, 0, 0, 0, 0.2);
  if (fx.q > 0.6) { const i = P(fx.add, x, y + 0.3, z, 0, 0, 0, 0.14, vr * 7, vr * 8, F.FLARE, col(1.4, 1.5, 1.9), col(0.5, 0.5, 0.7), 0.5, 0, 0, 0, 0, 0.1); fx.add.rot[i] = 0; }

  // 불덩이
  const nF = Math.max(3, cnt((5 + vr * 1.4) * fireK * qq));
  for (let j = 0; j < nF; j++) {
    const u = rndUp(0.1);
    const o = vr * 0.25 * R();
    const s = vr * rr(2.2, 4.2);
    const i = P(fx.add, x + u.x * o, y + u.y * o + 0.2, z + u.z * o, u.x * s, u.y * s + vr * 0.6, u.z * s,
      rr(0.45, 0.8) * (kind === 'vehicle' ? 1.35 : 1), vr * rr(0.45, 0.7), vr * rr(1.1, 1.6), F.FIRE, C.fire0, C.fire1, 1, 3.5, -2.5, 0.3, 0, 0.35);
    fx.add.nf[i] = F.FIRE_N;
  }

  // 연기 기둥
  const nS = cnt((6 + vr * 2.4) * def.smoke * qq) + 2;
  const g = 0.22 + (0.045 - 0.22) * def.dark;
  const smokeEnd = col(g, g * 0.96, g * 0.92);
  const lit = mix(C.smokeLit, smokeEnd, 0.3);
  const lifeK = 0.8 + vr * 0.06;
  for (let j = 0; j < nS; j++) {
    const u = rndUp(0.2);
    const o = vr * 0.5 * R();
    const spread = j < nS * 0.3 ? 1.6 : 0.8;
    const i = P(fx.alp, x + u.x * o, y + u.y * o * 0.6 + 0.3, z + u.z * o,
      u.x * vr * spread * rr(0.5, 1.1), vr * rr(0.4, 2.2), u.z * vr * spread * rr(0.5, 1.1),
      rr(6, 11) * lifeK, vr * rr(0.5, 0.8), vr * rr(2.0, 3.2), smokeF(), lit, smokeEnd, rr(0.55, 0.75), 0.9, -0.55, 1, 0.06, 0.4);
    fx.alp.rv[i] = rr(-0.3, 0.3);
  }

  // 불씨
  if (vr > 2.2) {
    for (let j = 0; j < cnt(6 * qq * fireK); j++) {
      const i = P(fx.add, x + rr(-1, 1) * vr * 0.3, y + vr * 0.3, z + rr(-1, 1) * vr * 0.3, rr(-2, 2), rr(1, 4), rr(-2, 2),
        rr(2, 4), rr(0.06, 0.12), 0.03, F.GLOW, C.ember0, C.ember1, 1, 1.2, -0.3, 1, 0.02, 0.6);
      fx.add.rv[i] = 0;
    }
  }

  // 불티
  sparks(fx, x, y + 0.2, z, null, cnt((8 + vr * 4) * qq), vr * 6, 0.8, surf ?? -1e9, 0.045);

  if (water && w) {
    const wy = w.water;
    for (let j = 0; j < cnt((14 + vr * 4) * qq); j++) {
      const s = vr * rr(3, 8);
      const rx = rr(-1, 1) * vr * 0.5, rz = rr(-1, 1) * vr * 0.5;
      const i = P(fx.alp, x + rx * 0.4, wy + 0.1, z + rz * 0.4, rx, s, rz, rr(1.2, 2.0), rr(0.15, 0.35) * vr / 3, 0, F.DROP, C.water, C.water, 0.85, 0.3, 9.8, 0, 0, 0.7);
      fx.alp.s1[i] = fx.alp.s0[i] * 1.5; fx.alp.gy[i] = wy - 0.2;
    }
    for (let j = 0; j < cnt((5 + vr) * qq); j++) {
      const s = vr * rr(5, 9);
      const i = P(fx.alp, x + rr(-1, 1) * vr * 0.3, wy, z + rr(-1, 1) * vr * 0.3, rr(-1, 1), s, rr(-1, 1), rr(1.0, 1.6), vr * 0.12, vr * 0.16, F.STREAK, C.water, C.water, 0.6, 0.3, 9.8, 0, 0, 0.6);
      fx.alp.streak(i, 0.5, 0.12); fx.alp.gy[i] = wy - 0.2;
    }
    for (let j = 0; j < cnt((5 + vr * 1.5) * qq); j++) {
      const u = rndUp(0.3);
      P(fx.alp, x, wy + 0.5, z, u.x * vr * 1.5, vr * rr(1, 3), u.z * vr * 1.5, rr(2.5, 4), vr * 0.4, vr * 1.6, dustF(), C.water, C.water, 0.5, 1.5, 0.8, 0.8, 0.04, 0.35);
    }
    for (let j = 0; j < 2; j++) {
      const i = P(fx.alp, x, wy + 0.04, z, 0, 0, 0, 1.0 + j * 0.6, vr * 0.3, vr * (2.5 + j * 1.5), F.RING, C.water, C.water, 0.5, 0, 0, 0, 0, 0.3);
      fx.alp.mode[i] = 2;
    }
    return;
  }

  if (surf !== null && y - surf < vr * 0.9) {
    const sy = surf;
    // 땅을 따라 퍼지는 먼지 고리
    const nD = cnt((8 + vr * 2.2) * def.dust * qq);
    for (let j = 0; j < nD; j++) {
      const a = (j / Math.max(1, nD)) * 6.2832 + R() * 0.5;
      const cx = Math.cos(a), cz = Math.sin(a), s = vr * rr(2.8, 4.8);
      const i = P(fx.alp, x + cx * vr * 0.25, sy + rr(0.25, 0.7), z + cz * vr * 0.25, cx * s, rr(0.3, 1.2), cz * s,
        rr(2.5, 5), vr * 0.35, vr * rr(1.1, 1.7), dustF(), dustC, dustC, rr(0.45, 0.6), 2.2, 0.12, 0.6, 0.03, 0.35);
      fx.alp.tint(i, rr(0.85, 1.1));
      fx.alp.slide(i, sy + 0.2);
    }
    // 흙기둥 (포탄·지뢰)
    if (def.col > 0) {
      const dark = mul(dustC, 0.75);
      for (let j = 0; j < cnt(def.col * (4 + vr * 1.2) * qq); j++) {
        const u = rndUp(1.2);
        const i = P(fx.alp, x, sy + 0.3, z, u.x * vr * 0.6, vr * rr(3, 7), u.z * vr * 0.6, rr(1.4, 2.4), vr * 0.25, vr * rr(0.8, 1.2),
          dustF(), dark, dustC, 0.8, 1.4, 5, 0.3, 0.03, 0.4);
        fx.alp.slide(i, sy + 0.3);
      }
      for (let j = 0; j < cnt(def.col * (6 + vr * 2) * qq); j++) {
        const u = rndUp(0.8);
        const s = vr * rr(2.5, 6.5);
        const i = P(fx.alp, x, sy + 0.3, z, u.x * s * 0.5, u.y * s, u.z * s * 0.5, rr(1.6, 2.4), rr(0.12, 0.3) * vr / 3, 0, F.CHIP, chipC, chipC, 1, 0.3, 9.8, 0, 0, 0.8);
        fx.alp.s1[i] = fx.alp.s0[i]; fx.alp.rv[i] = rr(-10, 10); fx.alp.gy[i] = sy; fx.alp.bnc[i] = 0.2;
      }
    }
    // 눈 가루
    if (snowGround) {
      for (let j = 0; j < cnt((6 + vr * 2) * qq); j++) {
        const u = rndUp(0.4);
        const o = vr * 0.6 * R();
        const i = P(fx.alp, x + u.x * o, sy + 0.4, z + u.z * o, u.x * vr * rr(1, 3), vr * rr(0.8, 2.5), u.z * vr * rr(1, 3),
          rr(3, 5.5), vr * 0.4, vr * rr(1.2, 1.8), dustF(), C.snow, C.snow, 0.6, 1.6, 0.6, 0.8, 0.04, 0.4);
        fx.alp.slide(i, sy + 0.3);
      }
    }
    // 충격파 고리
    let i = P(fx.add, x, sy + 0.15, z, 0, 0, 0, 0.32, vr * 0.6, vr * 5, F.RING, C.ring0, C.ring1, 0.55, 0, 0, 0, 0, 0.15);
    fx.add.mode[i] = 2;
    i = P(fx.alp, x, sy + 0.1, z, 0, 0, 0, 0.75, vr * 0.5, vr * 4.2, F.RING, dustC, dustC, 0.35, 0, 0, 0, 0, 0.2);
    fx.alp.mode[i] = 2;
    // 파편
    const nB = cnt((4 + vr * 2.2) * def.deb * qq);
    for (let j = 0; j < nB; j++) {
      const u = rndUp(0.4);
      const c = kind === 'vehicle' ? (R() < 0.6 ? C.metal : chipC) : snowGround && R() < 0.4 ? C.snow : chipC;
      const trail = kind === 'vehicle' ? (R() < 0.35 ? 2 : R() < 0.5 ? 1 : 0) : (kind === 'rocket' || kind === 'shell' || kind === 'c4') && R() < 0.15 ? 1 : 0;
      fx.debris.spawn(x + u.x * 0.3, Math.max(sy + 0.15, y + u.y * 0.3), z + u.z * 0.3,
        u.x * vr * rr(1, 3.5), vr * rr(1.5, 4.5), u.z * vr * rr(1, 3.5), rr(0.08, 0.28) * (0.6 + vr * 0.12), c, rr(4, 8), trail);
    }
    // 그을음 (바닥)
    if (hit && fx.distTo(p) < 220) {
      fx.decals.add(hit.point, hit.normal, vr * rr(1.5, 1.9), F.SCORCH, C.white, 0.92, 240, fx.time);
    }
  } else {
    // 공중 폭발: 화면을 향한 충격파 고리
    P(fx.add, x, y, z, 0, 0, 0, 0.25, vr * 0.5, vr * 4.5, F.RING, C.ring0, C.ring1, 0.35, 0, 0, 0, 0, 0.15);
    if (kind === 'vehicle') {
      for (let j = 0; j < cnt(10 * qq); j++) {
        const u = rndSphere();
        fx.debris.spawn(x, y, z, u.x * vr * 3, u.y * vr * 3 + 3, u.z * vr * 3, rr(0.15, 0.4), C.metal, rr(5, 8), R() < 0.4 ? 2 : 1);
      }
    }
  }

  // 그을음 (가까운 벽)
  if (w && fx.distTo(p) < 160) {
    const a0 = R() * 6.28;
    let best: { t: number; point: Vec3; normal: Vec3 } | null = null;
    for (let k = 0; k < 4; k++) {
      const a = a0 + k * 1.5708;
      const h = raycast(w, p, { x: Math.cos(a), y: 0, z: Math.sin(a) }, vr * 0.75, false);
      if (h && h.box >= 0 && (!best || h.t < best.t)) best = h;
    }
    if (best) fx.decals.add(best.point, best.normal, vr * rr(1.1, 1.4), F.SCORCH, C.white, 0.85, 240, fx.time);
  }

  // 차량 폭발: 뒤이은 작은 폭발
  if (kind === 'vehicle') {
    const n = 2 + ((R() * 3) | 0);
    for (let j = 0; j < n; j++) {
      const ox = rr(-1, 1) * vr * 0.45, oy = rr(0, 1) * vr * 0.4, oz = rr(-1, 1) * vr * 0.45;
      fx.later(rr(0.2, 1.6), () => pop(fx, { x: x + ox, y: y + oy, z: z + oz }, vr * rr(0.3, 0.45)));
    }
  }
}

/** 작은 터짐 (2차 폭발, 탄약 유폭) */
export function pop(fx: FxCtx, p: Vec3, vr: number): void {
  fx.lights.flash(p.x, p.y + 0.5, p.z, 0xffa060, 60 * vr * vr + 40, vr * 8 + 4, 0.22, 1);
  const lod = lodOf(fx, p, true);
  if (lod <= 0) return;
  const qq = fx.q * lod;
  P(fx.add, p.x, p.y, p.z, 0, 0, 0, 0.08, vr * 2.5, vr * 3, F.STAR, C.flash0, C.flash1, 1, 0, 0, 0, 0, 0.15);
  for (let j = 0; j < Math.max(2, cnt(4 * qq)); j++) {
    const u = rndUp(0.2);
    const s = vr * rr(2, 4);
    const i = P(fx.add, p.x, p.y, p.z, u.x * s, u.y * s + vr, u.z * s, rr(0.4, 0.7), vr * 0.5, vr * rr(1.1, 1.5), F.FIRE, C.fire0, C.fire1, 1, 3.5, -2, 0.3, 0, 0.35);
    fx.add.nf[i] = F.FIRE_N;
  }
  const gy = fx.world ? heightAt(fx.world, p.x, p.z) : p.y - 2;
  sparks(fx, p.x, p.y, p.z, null, cnt(10 * qq), vr * 7, 0.8, gy, 0.04);
  for (let j = 0; j < cnt(4 * qq) + 1; j++) {
    const u = rndUp(0.5);
    P(fx.alp, p.x, p.y + 0.3, p.z, u.x * vr, vr * rr(1, 2), u.z * vr, rr(4, 7), vr * 0.6, vr * rr(2, 3), smokeF(), C.smokeLit, C.black, 0.6, 1, -0.5, 1, 0.06, 0.4);
  }
}

// ───────────────────────── 차량 ─────────────────────────

/** 차량 파괴 순간: 포탑 쪽 불기둥, 검은 연기, 불붙은 파편 */
export function vehicleBurst(fx: FxCtx, p: Vec3, size: Vec3): void {
  const top: Vec3 = { x: p.x, y: p.y + size.y * 0.6, z: p.z };
  const sc = clamp(size.x * 0.5, 1, 2.5);
  pop(fx, top, sc * 1.4);
  const lod = lodOf(fx, p, true);
  if (lod <= 0) return;
  const qq = fx.q * lod;
  for (let j = 0; j < cnt(6 * qq) + 2; j++) {
    const i = P(fx.add, top.x + rr(-0.5, 0.5) * sc, top.y, top.z + rr(-0.5, 0.5) * sc, rr(-1, 1), rr(6, 12), rr(-1, 1),
      rr(0.6, 1.0), sc * 0.8, sc * rr(1.6, 2.2), F.FIRE, C.fire0, C.fire1, 1, 2.5, -1, 0.3, 0, 0.4);
    fx.add.nf[i] = F.FIRE_N;
  }
  for (let j = 0; j < cnt(10 * qq) + 2; j++) {
    const u = rndUp(0.6);
    P(fx.alp, top.x + u.x * sc, top.y + 0.5, top.z + u.z * sc, u.x * 2, rr(3, 7), u.z * 2, rr(7, 11), sc * 1.0, sc * rr(3.5, 5),
      smokeF(), C.smokeLit, C.black, rr(0.6, 0.8), 0.8, -0.5, 1.2, 0.05, 0.45);
  }
  for (let j = 0; j < cnt(10 * qq) + 2; j++) {
    const u = rndUp(0.5);
    fx.debris.spawn(top.x, top.y, top.z, u.x * rr(3, 9), rr(5, 12), u.z * rr(3, 9), rr(0.15, 0.45), C.metal, rr(5, 9), R() < 0.5 ? 2 : 1);
  }
  fx.debris.spawn(top.x, top.y + 0.3, top.z, rr(-2, 2), rr(10, 16), rr(-2, 2), sc * 0.6, C.metal, 10, 2);
}

/** 헬기 플레어 */
export function flares(fx: FxCtx, p: Vec3, yaw: number): void {
  const rt = rightXZ(yaw), fw = forwardXZ(yaw);
  const n = 8;
  const vel: Vec3[] = [];
  for (let k = 0; k < n; k++) {
    const side = k % 2 ? 1 : -1;
    const v = { x: rt.x * side * rr(6, 12) + fw.x * rr(-4, 2), y: rr(-2, 3), z: rt.z * side * rr(6, 12) + fw.z * rr(-4, 2) };
    vel.push(v);
    const delay = k * 0.08;
    fx.later(delay, () => {
      P(fx.add, p.x, p.y, p.z, v.x, v.y, v.z, 3.2, 1.4, 1.0, F.GLOW, col(9, 7, 4.5), col(5, 2.5, 0.8), 1, 0, 3, 0, 0, 0.75);
      const i = P(fx.add, p.x, p.y, p.z, v.x, v.y, v.z, 3.2, 2.4, 1.6, F.STAR, col(4, 3.2, 2), col(2, 1, 0.3), 0.6, 0, 3, 0, 0, 0.7);
      fx.add.rv[i] = rr(-3, 3);
    });
  }
  for (let t = 0.12; t < 3; t += 0.15) {
    fx.later(t, () => {
      for (let k = 0; k < n; k++) {
        const tt = t - k * 0.08;
        if (tt <= 0) continue;
        const v = vel[k];
        P(fx.alp, p.x + v.x * tt, p.y + v.y * tt - 1.5 * tt * tt, p.z + v.z * tt, 0, 0.3, 0, rr(2.5, 3.5), 0.4, rr(1.6, 2.4), smokeF(), C.wisp, C.wisp1, 0.4, 0.5, -0.1, 1, 0.03, 0.3);
      }
    });
  }
}

/**
 * 지상 차량 연막탄 발사: 포탑 둘레 발사 섬광과 앞쪽 부채꼴로 날아가는 연기 줄기.
 * 연막 벽 자체는 sim 이 g.smokes 에 넣고 drawSmokes 가 그린다. yaw = 포탑 방향
 */
export function smokeLaunch(fx: FxCtx, p: Vec3, yaw: number, size: Vec3): void {
  const fw = forwardXZ(yaw);
  const top = p.y + size.y * 0.85;
  const gy = fx.world ? heightAt(fx.world, p.x, p.z) : p.y;
  for (let k = 0; k < 6; k++) {
    const a = (k - 2.5) * 0.36;
    const ca = Math.cos(a), sa = Math.sin(a);
    const dx = fw.x * ca - fw.z * sa, dz = fw.x * sa + fw.z * ca;
    const x0 = p.x + dx * 1.2, z0 = p.z + dz * 1.2;
    P(fx.add, x0, top, z0, 0, 0, 0, 0.06, 0.6, 0.8, F.STAR, C.flash0, C.flash1, 1, 0, 0, 0, 0, 0.2);
    for (let m = 0; m < 2; m++) {
      const s = rr(6, 9);
      const i = P(fx.alp, x0, top, z0, dx * s, rr(3, 4.5), dz * s, rr(2.5, 4), 0.4, rr(2.5, 3.5), smokeF(),
        col(0.86, 0.86, 0.85), col(0.8, 0.8, 0.8), 0.6, 0.8, 5, 0.6, 0.03, 0.5);
      fx.alp.slide(i, gy + 1.2);
    }
  }
}

// ───────────────────────── 파괴 ─────────────────────────

export function boxBreak(fx: FxCtx, pos: Vec3, mat: string, box: Box | undefined): void {
  const lod = lodOf(fx, pos, true);
  if (lod <= 0) return;
  const qq = fx.q * lod;
  const mn = box ? box.min : { x: pos.x - 0.5, y: pos.y - 0.5, z: pos.z - 0.5 };
  const mx = box ? box.max : { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 };
  const sx = mx.x - mn.x, sy = mx.y - mn.y, sz = mx.z - mn.z;
  const vs = clamp(Math.cbrt(Math.max(0.01, sx * sy * sz)), 0.4, 4);
  const cx = (mn.x + mx.x) / 2, cz = (mn.z + mx.z) / 2;
  const rp = (o: Vec3): Vec3 => { o.x = mn.x + R() * sx; o.y = mn.y + R() * sy; o.z = mn.z + R() * sz; return o; };
  const tmp: Vec3 = { x: 0, y: 0, z: 0 };
  const glass = mat === 'glass';
  const tree = box?.kind === 'tree' || mat === 'foliage';
  const boxC = box ? hex(box.color) : CHIPC[mat] ?? CHIPC.concrete;
  const chipC = mix(CHIPC[mat] ?? CHIPC.concrete, boxC, 0.5);
  const dustC = DUSTC[mat] ?? DUSTC.concrete;
  const floorY = mn.y - 0.05;

  // 먼지
  const nD = glass ? cnt(1.5 * qq) : cnt((2 + vs * 2.5) * qq) + 1;
  for (let j = 0; j < nD; j++) {
    rp(tmp);
    const dx = tmp.x - cx, dz = tmp.z - cz, l = Math.hypot(dx, dz) || 1, s = rr(0.5, 2);
    const i = P(fx.alp, tmp.x, tmp.y, tmp.z, dx / l * s, rr(0, 1), dz / l * s, rr(2, 4), vs * 0.4, vs * rr(1.1, 1.6), dustF(),
      dustC, dustC, glass ? 0.2 : rr(0.4, 0.6), 1.8, 0.15, 0.6, 0.04, 0.4);
    fx.alp.tint(i, rr(0.88, 1.08));
  }
  // 파편 상자
  const nB = cnt((glass ? 2 + vs * 2 : 3 + vs * 3.5) * qq);
  const dSize = clamp(vs * 0.7, 0.5, 1.5);
  for (let j = 0; j < nB; j++) {
    rp(tmp);
    const dx = tmp.x - cx, dz = tmp.z - cz, l = Math.hypot(dx, dz) || 1, s = rr(1, 4);
    fx.debris.spawn(tmp.x, tmp.y, tmp.z, dx / l * s, rr(0.5, 3), dz / l * s, rr(0.1, 0.3) * dSize,
      glass ? CHIPC.glass : R() < 0.5 ? boxC : chipC, rr(5, 9), 0, glass || mat === 'wood');
  }
  // 작은 조각
  const frame = glass ? F.SHARD : mat === 'wood' ? F.SPLINTER : tree ? F.LEAF : F.CHIP;
  const nC = cnt((glass ? 10 + vs * 6 : 4 + vs * 4) * qq);
  for (let j = 0; j < nC; j++) {
    rp(tmp);
    const u = rndUp(0.5);
    const s = rr(2, 6);
    const c = tree ? LEAVES[(R() * LEAVES.length) | 0] : glass ? CHIPC.glass : chipC;
    const i = P(fx.alp, tmp.x, tmp.y, tmp.z, u.x * s, u.y * s, u.z * s, rr(0.8, 1.6) * (tree ? 2 : 1), rr(0.05, 0.12), 0, frame, c, c,
      glass ? 0.85 : 1, tree ? 2.2 : 0.3, tree ? 2.5 : 9.8, tree ? 0.5 : 0, 0, 0.75);
    fx.alp.s1[i] = fx.alp.s0[i]; fx.alp.rv[i] = rr(-18, 18); fx.alp.gy[i] = floorY; fx.alp.bnc[i] = 0.2;
    if (glass) fx.alp.tint(i, 1.2);
  }
  if (glass) {
    for (let j = 0; j < cnt(8 * qq); j++) {
      rp(tmp);
      const u = rndUp(0.4);
      const s = rr(1.5, 5);
      const i = P(fx.add, tmp.x, tmp.y, tmp.z, u.x * s, u.y * s, u.z * s, rr(0.4, 0.9), rr(0.04, 0.08), 0.02, F.GLOW, C.glint0, C.glint1, 1, 0.3, 9.8, 0, 0, 0.3);
      fx.add.gy[i] = floorY;
    }
  }
  if (tree) {
    if (mat !== 'wood') {
      for (let j = 0; j < cnt(4 * qq); j++) {
        rp(tmp);
        const u = rndUp(0.5);
        const i = P(fx.alp, tmp.x, tmp.y, tmp.z, u.x * 4, u.y * 4, u.z * 4, 0.9, 0.1, 0.1, F.SPLINTER, CHIPC.wood, CHIPC.wood, 1, 0.3, 9.8, 0, 0, 0.7);
        fx.alp.rv[i] = rr(-15, 15); fx.alp.gy[i] = floorY;
      }
    }
    if (fx.snowy) {
      for (let j = 0; j < cnt(6 * qq) + 1; j++) {
        const i = P(fx.alp, cx + rr(-1, 1) * sx * 0.5, mx.y - R() * sy * 0.4, cz + rr(-1, 1) * sz * 0.5, rr(-0.5, 0.5), rr(-0.5, 0.3), rr(-0.5, 0.5),
          rr(2, 3), 0.6, rr(1.6, 2.4), dustF(), C.snow, C.snow, 0.5, 1.2, 0.8, 0.6, 0.05, 0.4);
        fx.alp.slide(i, floorY + 0.4);
      }
    }
  }
}

export function collapse(fx: FxCtx, pos: Vec3, b: Building | undefined): void {
  const W = b ? b.w : 12, D = b ? b.d : 12, H = b ? b.floors * b.floorH : 8, y0 = b ? b.y : pos.y;
  const cx = b ? b.x : pos.x, cz = b ? b.z : pos.z; // Building.x/z = 바닥 사각형 중심
  const lod = Math.max(0.35, lodOf(fx, pos, true));
  if (fx.distTo(pos) > 1100) return;
  const qq = fx.q * lod;
  const dustC = mix(hex(0x9a948a), b ? hex(b.color) : hex(0x9a948a), 0.3);
  const wallC = b ? hex(b.color) : hex(0x8a8680);
  const roofC = b ? hex(b.roofColor) : hex(0x5a5550);
  const sz = clamp(Math.sqrt(W * D) / 12, 0.7, 1.6);
  fx.lights.flash(cx, y0 + 2, cz, 0xffd0a0, 80, 30, 0.2, 1);
  for (let wv = 0; wv < 3; wv++) {
    fx.later(wv * 0.45, () => {
      const n = cnt(20 * qq) + 4;
      for (let j = 0; j < n; j++) {
        const x = cx + (R() - 0.5) * W, z = cz + (R() - 0.5) * D, y = y0 + R() * H * (0.6 - wv * 0.15);
        const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz) || 1;
        const i = P(fx.alp, x, y, z, dx / l * rr(1.5, 5), rr(0.3, 2.0), dz / l * rr(1.5, 5), rr(8, 15), rr(2.5, 4.5) * sz, rr(8, 13) * sz,
          R() < 0.5 ? dustF() : smokeF(), dustC, dustC, rr(0.55, 0.75), 0.55, 0.04, 0.5, 0.1, 0.5);
        fx.alp.tint(i, rr(0.85, 1.1)); fx.alp.rv[i] = rr(-0.15, 0.15); fx.alp.slide(i, y0 + 1);
      }
      const n2 = cnt(10 * qq) + 2;
      for (let j = 0; j < n2; j++) {
        const a = R() * 6.2832, ca = Math.cos(a), sa = Math.sin(a);
        const s = rr(5, 10);
        const i = P(fx.alp, cx + ca * W * 0.45, y0 + 0.8, cz + sa * D * 0.45, ca * s, 0.2, sa * s, rr(6, 10), 2 * sz, rr(6, 9) * sz,
          dustF(), dustC, dustC, 0.6, 0.9, 0, 0.5, 0.05, 0.5);
        fx.alp.tint(i, rr(0.85, 1.05)); fx.alp.slide(i, y0 + 0.6);
      }
      const nb = cnt(25 * qq) + 3;
      for (let j = 0; j < nb; j++) {
        const x = cx + (R() - 0.5) * W * 0.9, z = cz + (R() - 0.5) * D * 0.9;
        const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz) || 1, s = rr(0, 3);
        fx.debris.spawn(x, y0 + rr(0.3, 1) * H, z, dx / l * s, rr(-1, 2), dz / l * s, rr(0.2, 0.6),
          R() < 0.7 ? wallC : R() < 0.5 ? roofC : CHIPC.concrete, rr(5, 9), 0, R() < 0.3);
      }
      for (let j = 0; j < cnt(15 * qq); j++) {
        const i = P(fx.alp, cx + (R() - 0.5) * W, y0 + rr(0.4, 1) * H, cz + (R() - 0.5) * D, rr(-1, 1), rr(-2, 1), rr(-1, 1),
          rr(1.2, 2), rr(0.15, 0.3), 0, F.CHIP, wallC, wallC, 1, 0.2, 9.8, 0, 0, 0.8);
        fx.alp.s1[i] = fx.alp.s0[i]; fx.alp.rv[i] = rr(-8, 8); fx.alp.gy[i] = y0;
      }
    });
  }
}

/** 작은 먼지 (쓰러짐, 착지, 달리기 발걸음) */
export function smallDust(fx: FxCtx, p: Vec3, c: Col, n: number, size: number, a: number): void {
  for (let j = 0; j < n; j++) {
    const ang = R() * 6.2832, s = rr(0.5, 1.5);
    P(fx.alp, p.x + Math.cos(ang) * 0.2, p.y + 0.15, p.z + Math.sin(ang) * 0.2, Math.cos(ang) * s, rr(0.2, 0.6), Math.sin(ang) * s,
      rr(0.8, 1.4), size * 0.3, size * rr(0.9, 1.3), dustF(), c, c, a, 3, 0.1, 0.6, 0.05, 0.35);
  }
}

export function groundDustColor(fx: FxCtx, p: Vec3, mat?: string): Col {
  if (mat && DUSTC[mat]) return DUSTC[mat];
  if (!fx.world) return DUSTC.dirt;
  return GROUND_DUST[groundTypeAt(fx.world, p.x, p.z)] ?? DUSTC.dirt;
}

export const COLORS = C;

// ───────────────────────── 차량 사격 ─────────────────────────

/** 전차포: 큰 총구 폭풍, 앞으로 밀려 나가는 연기, 포구 제동기 옆 분출, 땅 먼지 고리 */
export function cannonBlast(fx: FxCtx, p: Vec3, d: Vec3, groundY: number | null, dustC: Col): void {
  muzzle(fx, p, d, 3.2, false, 0);
  fx.lights.flash(p.x + d.x, p.y + d.y, p.z + d.z, 0xffc080, 500, 22, 0.13, 1);
  const lod = lodOf(fx, p, true);
  if (lod <= 0) return;
  const qq = fx.q * lod;
  for (let j = 0; j < cnt(10 * qq) + 3; j++) {
    const o = rr(0.5, 3), s = rr(5, 14), r = rndSphere();
    P(fx.alp, p.x + d.x * o, p.y + d.y * o, p.z + d.z * o, d.x * s + r.x * 1.5, d.y * s + r.y * 1.5 + 0.3, d.z * s + r.z * 1.5,
      rr(2.5, 4.5), 0.6, rr(2.5, 4), smokeF(), C.wisp, C.wisp1, rr(0.35, 0.5), 1.8, -0.15, 1, 0.04, 0.35);
  }
  const sx = -d.z, sz = d.x, sl = Math.hypot(sx, sz) || 1;
  for (let side = -1; side <= 1; side += 2) {
    for (let m = 0; m < 2; m++) {
      const s = rr(4, 8);
      P(fx.alp, p.x, p.y, p.z, sx / sl * side * s + d.x * 2, rr(0, 1), sz / sl * side * s + d.z * 2, rr(1.5, 2.5), 0.4, rr(1.8, 2.6),
        smokeF(), C.wisp, C.wisp1, 0.4, 2.2, -0.1, 1, 0.03, 0.3);
    }
  }
  if (groundY !== null && p.y - groundY < 4) {
    for (let j = 0; j < cnt(10 * qq) + 2; j++) {
      const a = R() * 6.2832, ca = Math.cos(a), sa = Math.sin(a), s = rr(4, 9);
      const i = P(fx.alp, p.x + ca * 1.5, groundY + 0.3, p.z + sa * 1.5, ca * s + d.x * 3, rr(0.2, 0.8), sa * s + d.z * 3, rr(2, 3.5), 1, rr(3, 5),
        dustF(), dustC, dustC, 0.45, 2, 0.1, 0.6, 0.03, 0.35);
      fx.alp.slide(i, groundY + 0.2);
    }
  }
}

/** 로켓·미사일 발사 후폭풍 (뒤쪽 연기, 섬광) */
export function launchBlast(fx: FxCtx, p: Vec3, d: Vec3): void {
  const lod = lodOf(fx, p, true);
  P(fx.add, p.x, p.y, p.z, 0, 0, 0, 0.07, 1.2, 1.6, F.STAR, C.flash0, C.flash1, 1, 0, 0, 0, 0, 0.2);
  fx.lights.flash(p.x, p.y, p.z, 0xffb070, 120, 12, 0.12, 0);
  if (lod <= 0) return;
  for (let j = 0; j < cnt(6 * fx.q * lod) + 2; j++) {
    const s = rr(3, 9), r = rndSphere();
    P(fx.alp, p.x - d.x * 0.6, p.y - d.y * 0.6, p.z - d.z * 0.6, -d.x * s + r.x, -d.y * s + r.y + 0.3, -d.z * s + r.z,
      rr(2, 3.5), 0.4, rr(1.6, 2.6), smokeF(), C.wisp, C.wisp1, 0.45, 2, -0.15, 1, 0.03, 0.35);
  }
}

// ───────────────────────── 지속 효과 ─────────────────────────

/** 연막탄 터질 때 처음 뿜는 연기 */
export function smokeBurst(fx: FxCtx, p: Vec3, r: number): void {
  for (let j = 0; j < cnt(6 * fx.q) + 2; j++) {
    const a = R() * 6.2832, s = rr(2.5, 5);
    P(fx.alp, p.x, p.y + 0.3, p.z, Math.cos(a) * s, rr(0.8, 2.2), Math.sin(a) * s, rr(3, 4.5), 0.6, r * rr(0.6, 0.85), smokeF(),
      col(0.85, 0.85, 0.86), col(0.8, 0.8, 0.8), 0.6, 1.8, 0.05, 0.6, 0.05, 0.4);
  }
}

/** 연막 가장자리에서 바람에 흩어지는 가닥 */
export function smokeWisp(fx: FxCtx, p: Vec3, R0: number, wx: number, wz: number, fade: number): void {
  const a = R() * 6.2832;
  const x = p.x + Math.cos(a) * R0 * 0.55, z = p.z + Math.sin(a) * R0 * 0.55;
  P(fx.alp, x, p.y + R0 * rr(0.2, 0.7), z, Math.cos(a) * 0.4 + wx * 0.4, rr(0, 0.3), Math.sin(a) * 0.4 + wz * 0.4, rr(4, 6),
    R0 * 0.45, R0 * rr(0.8, 1.0), smokeF(), col(0.82, 0.82, 0.83), col(0.78, 0.78, 0.78), 0.35 * fade, 0.3, 0, 1, 0.15, 0.4);
}

export function vehicleFlame(fx: FxCtx, x: number, y: number, z: number, sc: number, k: number): void {
  const i = P(fx.add, x, y, z, rr(-0.3, 0.3), rr(1.2, 2.6) * sc, rr(-0.3, 0.3), rr(0.5, 0.95), sc * rr(0.6, 0.9), sc * rr(1.3, 1.9),
    F.FIRE + ((R() * 3) | 0), C.flame0, C.flame1, 0.9 * k, 1.2, -1.5, 0.5, 0.08, 0.4);
  fx.add.nf[i] = F.FIRE_N - 3;
}

export function blackSmoke(fx: FxCtx, x: number, y: number, z: number, sc: number, a: number): void {
  const i = P(fx.alp, x + rr(-0.3, 0.3), y, z + rr(-0.3, 0.3), rr(-0.4, 0.4), rr(1.8, 3.2), rr(-0.4, 0.4), rr(6, 10), sc * 0.9, sc * rr(3.5, 5.5),
    smokeF(), C.black, C.black1, a * rr(0.75, 1), 0.45, -0.4, 1.3, 0.05, 0.45);
  fx.alp.rv[i] = rr(-0.25, 0.25);
}

export function groundFlame(fx: FxCtx, x: number, y: number, z: number, s: number, k: number): void {
  const i = P(fx.add, x, y + 0.15 * s, z, rr(-0.2, 0.2), rr(0.8, 2) * s, rr(-0.2, 0.2), rr(0.45, 0.85), s * rr(0.4, 0.7), s * rr(0.9, 1.5),
    F.FIRE + ((R() * 3) | 0), C.flame0, C.flame1, 0.85 * k, 1.2, -2, 0.5, 0.1, 0.4);
  fx.add.nf[i] = F.FIRE_N - 3;
}

export function fireSmoke(fx: FxCtx, x: number, y: number, z: number, s: number): void {
  P(fx.alp, x, y + 0.8, z, rr(-0.3, 0.3), rr(1, 2), rr(-0.3, 0.3), rr(4, 7), s * 0.8, s * rr(2.5, 4), smokeF(), C.black1, col(0.22, 0.21, 0.2),
    0.45, 0.5, -0.35, 1.2, 0.08, 0.45);
}

export function ember(fx: FxCtx, x: number, y: number, z: number): void {
  P(fx.add, x, y, z, rr(-1, 1), rr(1.5, 4), rr(-1, 1), rr(1.5, 3), rr(0.05, 0.1), 0.03, F.GLOW, C.ember0, C.ember1, 1, 1.2, -0.3, 1, 0.02, 0.6);
}

/** 로켓·미사일·유탄 연기 꼬리 한 덩이 */
export function rocketPuff(fx: FxCtx, x: number, y: number, z: number, kind: string): void {
  if (kind === 'ugl') {
    P(fx.alp, x, y, z, rr(-0.2, 0.2), rr(0, 0.2), rr(-0.2, 0.2), rr(0.8, 1.3), 0.12, rr(0.5, 0.8), smokeF(), C.wisp, C.wisp1, 0.22, 1.5, -0.1, 0.8, 0.03, 0.3);
    return;
  }
  const m = kind === 'missile';
  const i = P(fx.alp, x, y, z, rr(-0.4, 0.4), rr(-0.1, 0.4), rr(-0.4, 0.4), m ? rr(2.8, 4) : rr(1.8, 2.8), 0.25, m ? rr(1.6, 2.4) : rr(1.3, 2.1),
    smokeF(), col(0.88, 0.87, 0.85), col(0.72, 0.72, 0.72), 0.42, 1.2, -0.12, 0.9, 0.03, 0.3);
  fx.alp.rv[i] = rr(-0.4, 0.4);
}

/** 발사 순간 (투사체를 처음 봤을 때) */
export function launchPuff(fx: FxCtx, p: Vec3, vel: Vec3): void {
  const l = Math.hypot(vel.x, vel.y, vel.z) || 1;
  launchBlast(fx, p, { x: vel.x / l, y: vel.y / l, z: vel.z / l });
}

/** 날아가는 파편 꼬리: 1 연기, 2 불 + 연기 */
export function debrisTrail(fx: FxCtx, x: number, y: number, z: number, kind: number): void {
  P(fx.alp, x, y, z, 0, 0.3, 0, rr(1.2, 2.2), 0.15, rr(0.7, 1.2), smokeF(), C.black1, col(0.25, 0.24, 0.23), 0.4, 1, -0.2, 0.8, 0.05, 0.35);
  if (kind === 2) {
    const i = P(fx.add, x, y, z, 0, 0.5, 0, rr(0.2, 0.35), 0.3, 0.5, F.FIRE + ((R() * 4) | 0), C.flame0, C.flame1, 0.9, 0, -1, 0, 0, 0.3);
    fx.add.nf[i] = 6;
  }
}
