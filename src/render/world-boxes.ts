// 세계 상자 렌더: 종류 × 재질별 InstancedMesh, 창 유리·창틀, 바위 덩어리, 무너진 잔해 더미, 파괴 동기화.
import * as THREE from 'three';
import type { Box, Building, World } from '../types';
import { heightAt } from '../world';
import { rng, hash2 } from '../math';
import { makeBoxMaterial, makeGlassMaterial, type BoxMatOpts, type SharedUniforms } from './world-shaders';
import { frameTex } from './textures';

type ClassKey =
  | 'concrete' | 'brick' | 'woodwall' | 'metalwall' | 'floorwood' | 'floorconc'
  | 'roofmetal' | 'rooftar' | 'roofwood' | 'container' | 'sandbag' | 'crate' | 'metalprop'
  | 'fencewood' | 'fencemetal' | 'hedge' | 'stone' | 'rock' | 'bush' | 'rubble' | 'glass' | 'frame' | 'tank' | 'pipe';

type GeoKind = 'box' | 'blob' | 'chunk' | 'uvbox' | 'cyl';
interface ClassDef { geo: GeoKind; mat: BoxMatOpts | 'glass' | 'frame'; cast: boolean; spare: number }

const base = (o: Partial<BoxMatOpts> & Pick<BoxMatOpts, 'side' | 'top'>): BoxMatOpts => ({
  sideTile: [2, 2], topTile: [2, 2], uvMode: 0, second: 0x555555, grime: 0x3a3632, grimeAmt: 0.45,
  rough: 0.9, metal: 0, bump: 1.4, snow: 1, drift: 0.8, ...o,
});

const CONCRETE = base({ side: 'concrete', top: 'concreteTop', sideTile: [6, 6], topTile: [6, 6], second: 0x4a4a48, grime: 0x37332f, grimeAmt: 0.7, rough: 0.93, bump: 1.2 });
const STONE = base({ side: 'rock', top: 'rock', sideTile: [4, 4], topTile: [4, 4], second: 0x8a8a74, grime: 0x2c2b28, grimeAmt: 0.5, bump: 2.2, drift: 0.6 });
const FOLIAGE = base({ side: 'foliage', top: 'foliage', second: 0x223322, grime: 0x16221a, grimeAmt: 0.5, rough: 0.95, bump: 2.6, snow: 1.1, drift: 0.6 });

const CLASSES: Record<ClassKey, ClassDef> = {
  concrete: { geo: 'box', mat: CONCRETE, cast: true, spare: 16 },
  brick: { geo: 'box', mat: base({ side: 'brick', top: 'concreteTop', topTile: [6, 6], second: 0xb0a99f, grime: 0x2c2826, grimeAmt: 0.5, bump: 1.7 }), cast: true, spare: 16 },
  woodwall: { geo: 'box', mat: base({ side: 'siding', top: 'planks', second: 0x7d766c, grime: 0x3d362f, grimeAmt: 0.5, rough: 0.86, bump: 1.5 }), cast: true, spare: 16 },
  metalwall: { geo: 'box', mat: base({ side: 'corrugated', top: 'roofmetal', second: 0x5e3622, grime: 0x4a3a30, grimeAmt: 0.5, rough: 0.55, metal: 0.45, bump: 1.4 }), cast: true, spare: 16 },
  floorwood: { geo: 'box', mat: base({ side: 'siding', top: 'planks', second: 0x2a241f, grime: 0x3d362f, grimeAmt: 0.35, rough: 0.82, bump: 1.2 }), cast: true, spare: 16 },
  floorconc: { geo: 'box', mat: { ...CONCRETE, side: 'concrete', top: 'concreteTop' }, cast: true, spare: 16 },
  roofmetal: { geo: 'box', mat: base({ side: 'plate', top: 'roofmetal', second: 0x7a4526, grime: 0x34302c, grimeAmt: 0.5, rough: 0.6, metal: 0.4, bump: 1.2, snow: 1.2, drift: 0 }), cast: true, spare: 16 },
  rooftar: { geo: 'box', mat: base({ side: 'concrete', top: 'tar', sideTile: [6, 6], topTile: [4, 4], second: 0x4a4a48, grime: 0x262628, grimeAmt: 0.5, rough: 0.9, bump: 1.0, snow: 1.2, drift: 0 }), cast: true, spare: 16 },
  roofwood: { geo: 'box', mat: base({ side: 'siding', top: 'shingles', second: 0x58504a, grime: 0x2a2622, grimeAmt: 0.4, rough: 0.88, bump: 1.5, snow: 1.2, drift: 0 }), cast: true, spare: 16 },
  container: { geo: 'box', mat: base({ side: 'container', top: 'roofmetal', sideTile: [2.4, 1], uvMode: 2, second: 0x5a3220, grime: 0x3e3430, grimeAmt: 0.45, rough: 0.55, metal: 0.35, bump: 1.6, snow: 1.1, drift: 0.6 }), cast: true, spare: 8 },
  sandbag: { geo: 'box', mat: base({ side: 'sandbag', top: 'sandbag', sideTile: [1.2, 1.2], topTile: [1.2, 1.2], second: 0x4a4234, grime: 0x4a4030, grimeAmt: 0.4, rough: 0.96, bump: 2.4 }), cast: true, spare: 16 },
  crate: { geo: 'box', mat: base({ side: 'crate', top: 'crate', sideTile: [1, 1], topTile: [1, 1], uvMode: 1, second: 0x241e1a, grime: 0x3a3028, grimeAmt: 0.35, rough: 0.86, bump: 1.6, drift: 0.5 }), cast: true, spare: 16 },
  metalprop: { geo: 'box', mat: base({ side: 'plate', top: 'plate', second: 0x6e4a32, grime: 0x3a342e, grimeAmt: 0.45, rough: 0.5, metal: 0.5, bump: 1.0, drift: 0.6 }), cast: true, spare: 16 },
  fencewood: { geo: 'box', mat: base({ side: 'picket', top: 'picket', sideTile: [2, 1], uvMode: 2, second: 0x8a8070, grime: 0x3a342c, grimeAmt: 0.4, alphaCut: true, snow: 0.6, drift: 0.8 }), cast: false, spare: 8 },
  fencemetal: { geo: 'box', mat: base({ side: 'chainlink', top: 'chainlink', sideTile: [2.5, 1], topTile: [2.5, 2.5], uvMode: 2, second: 0x6e4a32, grime: 0x333333, grimeAmt: 0, rough: 0.5, metal: 0.6, alphaCut: true, snow: 0.3, drift: 0 }), cast: false, spare: 8 },
  hedge: { geo: 'box', mat: FOLIAGE, cast: true, spare: 8 },
  stone: { geo: 'box', mat: STONE, cast: true, spare: 8 },
  rock: { geo: 'blob', mat: STONE, cast: true, spare: 8 },
  bush: { geo: 'blob', mat: FOLIAGE, cast: true, spare: 8 },
  rubble: { geo: 'chunk', mat: base({ side: 'rubble', top: 'rubble', sideTile: [1.5, 1.5], topTile: [1.5, 1.5], second: 0x6e4030, grime: 0x3a3632, grimeAmt: 0.5, rough: 0.95, bump: 1.8, snow: 0.35, drift: 0 }), cast: true, spare: 512 },
  tank: { geo: 'cyl', mat: base({ side: 'plate', top: 'roofmetal', second: 0x5a4a3e, grime: 0x4a4038, grimeAmt: 0.6, rough: 0.55, metal: 0.35, bump: 0.8, snow: 1.1, drift: 0.6 }), cast: true, spare: 4 },
  pipe: { geo: 'cyl', mat: base({ side: 'plate', top: 'plate', sideTile: [3, 3], topTile: [3, 3], second: 0x5e3a26, grime: 0x3e3630, grimeAmt: 0.5, rough: 0.5, metal: 0.5, bump: 0.6, snow: 1, drift: 0 }), cast: true, spare: 4 },
  glass: { geo: 'box', mat: 'glass', cast: false, spare: 16 },
  frame: { geo: 'uvbox', mat: 'frame', cast: false, spare: 16 },
};

function classOf(b: Box): ClassKey | null {
  switch (b.kind) {
    case 'tree': return null;
    case 'window': return 'glass';
    case 'rubble': return 'rubble';
    case 'rock': return b.mat === 'foliage' ? 'bush' : 'rock';
    case 'sandbag': return 'sandbag';
    case 'container': return 'container';
    case 'fence': return b.mat === 'wood' ? 'fencewood' : b.mat === 'foliage' ? 'hedge' : 'fencemetal';
    case 'roof': return b.mat === 'metal' ? 'roofmetal' : b.mat === 'wood' ? 'roofwood' : b.mat === 'brick' ? 'brick' : b.mat === 'glass' ? 'glass' : 'rooftar';
    case 'floor': case 'stair': case 'bridge':
      return b.mat === 'wood' ? 'floorwood' : b.mat === 'metal' ? 'metalprop' : b.mat === 'brick' ? 'brick' : b.mat === 'glass' ? 'glass' : 'floorconc';
    default: break;
  }
  if (b.kind === 'prop' && b.mat === 'metal') {
    const dx = b.max.x - b.min.x, dy = b.max.y - b.min.y, dz = b.max.z - b.min.z;
    // 네모 바닥의 큰 금속 소품 = 저장 탱크, 가늘고 긴 것 = 배관
    if (dx >= 1.5 && Math.abs(dx - dz) < dx * 0.06 && dy >= 0.4) return 'tank';
    if (dy <= 1.3 && Math.max(dx, dz) >= 3 * Math.min(dx, dz) && Math.min(dx, dz) <= 1.4) return 'pipe';
  }
  switch (b.mat) {
    case 'glass': return 'glass';
    case 'concrete': return 'concrete';
    case 'brick': return 'brick';
    case 'wood': return b.kind === 'wall' ? 'woodwall' : 'crate';
    case 'metal': return b.kind === 'wall' ? 'metalwall' : 'metalprop';
    case 'sand': return 'sandbag';
    case 'rock': return b.kind === 'prop' ? 'rock' : 'stone';
    case 'foliage': return b.kind === 'prop' ? 'bush' : 'hedge';
  }
  return 'concrete';
}

// ───────────────────────── 기하 ─────────────────────────

/** 흐트러진 다면체를 [-0.5, 0.5]^3 상자에 꽉 차게 맞춘다 (평평한 면 = 각진 바위) */
function lumpGeometry(detail: number, rough: number, flatBottom: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.5, detail);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = hash2(Math.round(x * 1000) + Math.round(z * 777), Math.round(y * 1000), seed);
    const low = Math.sin(x * 5.1 + seed) * Math.cos(z * 4.3 - seed * 0.7) + Math.sin(y * 6.2 + x * 2.1 + seed * 1.3) * 0.6;
    const k = 1 - rough * 0.5 + rough * (h * 0.45 + 0.55 * (0.5 + 0.35 * low));
    x *= k; y *= k; z *= k;
    if (y < -flatBottom) y = -flatBottom + (y + flatBottom) * 0.25;
    p.setXYZ(i, x, y, z);
  }
  g.computeBoundingBox();
  const bb = g.boundingBox as THREE.Box3;
  const sz = new THREE.Vector3(), c = new THREE.Vector3();
  bb.getSize(sz); bb.getCenter(c);
  g.translate(-c.x, -c.y, -c.z);
  g.scale(1 / sz.x, 1 / sz.y, 1 / sz.z);
  g.computeVertexNormals();
  return g;
}

function makeGeometry(kind: GeoKind): THREE.BufferGeometry {
  if (kind === 'blob') return lumpGeometry(1, 0.55, 0.2, 3);
  if (kind === 'chunk') return lumpGeometry(0, 0.55, 0.15, 9);
  if (kind === 'cyl') { const c = new THREE.CylinderGeometry(0.5, 0.5, 1, 22, 1); c.deleteAttribute('uv'); return c; }
  const g = new THREE.BoxGeometry(1, 1, 1);
  if (kind === 'box') g.deleteAttribute('uv');
  return g;
}

// ───────────────────────── 인스턴스 묶음 ─────────────────────────

interface CM {
  key: ClassKey; def: ClassDef;
  template: THREE.BufferGeometry;
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  mesh: THREE.InstancedMesh;
  cap: number; n: number;
  base: THREE.InstancedBufferAttribute | null;
  glow: THREE.InstancedBufferAttribute | null;
  dirtyM: boolean; dirtyC: boolean; dirtyA: boolean;
}
interface Ref { cm: CM; i: number }
interface Spec { key: ClassKey; m: THREE.Matrix4; c: THREE.Color; base: number; glow: number }

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const GLASS_TINTS = [0x34424e, 0x2c383f, 0x3e4a52, 0x283238].map((h) => new THREE.Color().setHex(h));
const FRAME_COLS = {
  house: [0xe4e2dc, 0x4a3a2c, 0x5f7f7c, 0xd8d0c0],
  city: [0xdedcd6, 0x5a5e62, 0xc8c8c4],
  plain: [0x7a7c7e, 0x5a5c5e],
};

export class BoxLayer {
  readonly group = new THREE.Group();
  private sh: SharedUniforms;
  private w: World;
  private classes = new Map<ClassKey, CM>();
  private refs = new Map<number, Ref[]>();
  private hidden = new Set<number>();
  private bldBoxes = new Map<number, number[]>();
  private bld = new Map<number, Building>();
  private seen = 0;
  private scan = 0;
  private env: THREE.Texture | null;
  private glowFrac: number;
  private tmpQ = new THREE.Quaternion();
  private tmpE = new THREE.Euler();
  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3();

  constructor(w: World, sh: SharedUniforms, env: THREE.Texture | null, glowFrac: number) {
    this.w = w; this.sh = sh; this.env = env; this.glowFrac = glowFrac;
    for (const b of w.buildings) this.bld.set(b.id, b);
    const specs = new Map<ClassKey, { specs: Spec[]; ids: number[] }>();
    for (const b of w.boxes) {
      if (!b.alive) continue;
      const list = this.specsFor(b);
      for (const s of list) {
        let e = specs.get(s.key);
        if (!e) { e = { specs: [], ids: [] }; specs.set(s.key, e); }
        e.specs.push(s); e.ids.push(b.id);
      }
      if (b.building >= 0 && b.kind !== 'rubble') {
        let l = this.bldBoxes.get(b.building);
        if (!l) { l = []; this.bldBoxes.set(b.building, l); }
        l.push(b.id);
      }
    }
    for (const [key, e] of specs) {
      const cm = this.makeCM(key, e.specs.length + CLASSES[key].spare);
      e.specs.forEach((s, k) => this.write(cm, s, e.ids[k]));
    }
    // 무너질 때 잔해가 생길 자리
    if (!this.classes.has('rubble')) this.makeCM('rubble', CLASSES.rubble.spare);
    this.seen = w.boxes.length;
    this.flush();
  }

  // ───── 상자 하나 → 인스턴스 명세 ─────

  private groundAt(b: Box): number {
    if (b.building >= 0) { const bl = this.bld.get(b.building); if (bl) return bl.y; }
    return heightAt(this.w, (b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2);
  }

  private specsFor(b: Box): Spec[] {
    const key = classOf(b);
    if (!key) return [];
    const dx = b.max.x - b.min.x, dy = b.max.y - b.min.y, dz = b.max.z - b.min.z;
    if (!(dx > 0.001 && dy > 0.001 && dz > 0.001)) return [];
    const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2, cz = (b.min.z + b.max.z) / 2;
    const h1 = hash2(b.id, 17, 5), h2 = hash2(b.id, 29, 7);
    const ground = this.groundAt(b);
    const col = new THREE.Color().setHex(b.color);
    const out: Spec[] = [];

    if (key === 'glass') {
      const c = GLASS_TINTS[Math.floor(h1 * GLASS_TINTS.length)].clone().lerp(col, 0.15);
      const m = new THREE.Matrix4().makeScale(dx, dy, dz).setPosition(cx, cy, cz);
      out.push({ key, m, c, base: ground, glow: h2 < this.glowFrac ? 0.6 + h1 * 0.6 : 0 });
      // 창틀: 얇은 축을 조금 두껍게
      const bl = b.building >= 0 ? this.bld.get(b.building) : undefined;
      const set = !bl ? FRAME_COLS.plain : bl.style === 'house' || bl.style === 'shed' ? FRAME_COLS.house : bl.style === 'warehouse' ? FRAME_COLS.plain : FRAME_COLS.city;
      const fc = new THREE.Color().setHex(set[Math.floor(hash2(b.building, 3, 11) * set.length)]);
      const thinX = dx < dz;
      const fsx = thinX ? dx * 1.6 + 0.04 : dx, fsz = thinX ? dz : dz * 1.6 + 0.04;
      out.push({ key: 'frame', m: new THREE.Matrix4().makeScale(fsx, dy, fsz).setPosition(cx, cy, cz), c: fc, base: ground, glow: 0 });
      return out;
    }

    if (key === 'rubble') {
      const r = rng(b.id * 7919 + 13);
      const cc = col.clone().lerp(new THREE.Color(0.3, 0.28, 0.26), 0.4).multiplyScalar(0.8 + h1 * 0.25);
      // 상자를 거의 덮는 큰 덩어리
      this.tmpE.set((r() - 0.5) * 0.25, r() * Math.PI * 2, (r() - 0.5) * 0.25);
      this.tmpQ.setFromEuler(this.tmpE);
      out.push({ key, m: new THREE.Matrix4().compose(this.tmpV.set(cx, cy - dy * 0.05, cz), this.tmpQ, this.tmpS.set(dx * 0.95, dy * 1.0, dz * 0.95)), c: cc, base: ground, glow: 0 });
      const n = Math.max(2, Math.min(9, Math.round(dx * dz * 0.6) + 2));
      for (let k = 0; k < n; k++) {
        const s = Math.min(dx, dz) * (0.18 + r() * 0.32) + 0.15;
        const px = b.min.x + r() * dx, pz = b.min.z + r() * dz;
        const py = b.min.y + s * 0.25 + r() * dy * 0.5;
        this.tmpE.set(r() * 6.28, r() * 6.28, r() * 6.28);
        this.tmpQ.setFromEuler(this.tmpE);
        const elong = r() < 0.3 ? 2.2 : 1;
        this.tmpS.set(s * (0.7 + r() * 0.6) * elong, s * (0.35 + r() * 0.4), s * (0.7 + r() * 0.6));
        const c2 = cc.clone().multiplyScalar(0.8 + r() * 0.35);
        out.push({ key, m: new THREE.Matrix4().compose(this.tmpV.set(px, py, pz), this.tmpQ, this.tmpS), c: c2, base: ground, glow: 0 });
      }
      return out;
    }

    if (key === 'rock' || key === 'bush') {
      const rot = Math.floor(h1 * 4);
      const swap = rot & 1;
      const sx = (swap ? dz : dx) * 1.14, sz = (swap ? dx : dz) * 1.14;
      this.tmpQ.setFromAxisAngle(this.tmpV.set(0, 1, 0), rot * Math.PI / 2);
      const m = new THREE.Matrix4().compose(this.tmpV.set(cx, cy - dy * 0.04, cz), this.tmpQ, this.tmpS.set(h2 < 0.5 ? -sx : sx, dy * 1.1, sz));
      out.push({ key, m, c: col.multiplyScalar(0.9 + h2 * 0.2), base: ground, glow: 0 });
      return out;
    }

    if (key === 'tank') {
      const m = new THREE.Matrix4().makeScale(dx * 1.07, dy, dz * 1.07).setPosition(cx, cy, cz);
      out.push({ key, m, c: col.multiplyScalar(0.92 + h1 * 0.12), base: ground, glow: 0 });
      return out;
    }
    if (key === 'pipe') {
      const alongX = dx > dz;
      const d = Math.min(alongX ? dz : dx, dy) * 1.02;
      this.tmpQ.setFromAxisAngle(this.tmpV.set(alongX ? 0 : 1, 0, alongX ? 1 : 0), Math.PI / 2);
      const m = new THREE.Matrix4().compose(this.tmpV.set(cx, b.min.y + d / 2, cz), this.tmpQ, this.tmpS.set(d, alongX ? dx : dz, d));
      out.push({ key, m, c: col.multiplyScalar(0.92 + h1 * 0.12), base: ground, glow: 0 });
      return out;
    }
    const c = col;
    if (key === 'container') c.lerp(new THREE.Color(0.25, 0.25, 0.25), 0.12);
    c.multiplyScalar(0.9 + h1 * 0.2);
    c.offsetHSL((h2 - 0.5) * 0.015, 0, 0);
    out.push({ key, m: new THREE.Matrix4().makeScale(dx, dy, dz).setPosition(cx, cy, cz), c, base: ground, glow: 0 });
    return out;
  }

  // ───── 묶음 관리 ─────

  private makeMaterial(def: ClassDef): THREE.Material {
    if (def.mat === 'glass') return makeGlassMaterial(this.env);
    if (def.mat === 'frame') return new THREE.MeshStandardMaterial({ map: frameTex(), alphaTest: 0.5, roughness: 0.7, metalness: 0.05 });
    return makeBoxMaterial(def.mat, this.sh);
  }

  private makeCM(key: ClassKey, cap: number): CM {
    const def = CLASSES[key];
    const template = makeGeometry(def.geo);
    const mat = this.makeMaterial(def);
    const cm: CM = {
      key, def, template, geo: template, mat, mesh: null as unknown as THREE.InstancedMesh,
      cap: 0, n: 0, base: null, glow: null, dirtyM: true, dirtyC: true, dirtyA: true,
    };
    this.alloc(cm, cap);
    this.classes.set(key, cm);
    return cm;
  }

  /** 용량 cap 으로 (다시) 만든다. 기존 인스턴스는 옮겨 담는다 */
  private alloc(cm: CM, cap: number): void {
    const geo = cm.template.clone();
    const isBoxMat = typeof cm.def.mat !== 'string';
    const baseA = isBoxMat ? new THREE.InstancedBufferAttribute(new Float32Array(cap), 1) : null;
    const glowA = cm.def.mat === 'glass' ? new THREE.InstancedBufferAttribute(new Float32Array(cap), 1) : null;
    if (baseA) geo.setAttribute('aBase', baseA);
    if (glowA) geo.setAttribute('aGlow', glowA);
    const mesh = new THREE.InstancedMesh(geo, cm.mat, cap);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    const old = cm.mesh;
    if (old) {
      mesh.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, cm.n * 16));
      if (old.instanceColor) (mesh.instanceColor.array as Float32Array).set((old.instanceColor.array as Float32Array).subarray(0, cm.n * 3));
      if (baseA && cm.base) baseA.array.set((cm.base.array as Float32Array).subarray(0, cm.n));
      if (glowA && cm.glow) glowA.array.set((cm.glow.array as Float32Array).subarray(0, cm.n));
      this.group.remove(old);
      old.dispose();
      if (cm.geo !== cm.template) cm.geo.dispose();
    }
    mesh.count = cm.n;
    mesh.castShadow = cm.def.cast;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.name = 'boxes:' + cm.key;
    if (cm.def.mat === 'glass') mesh.renderOrder = 3;
    cm.mesh = mesh; cm.geo = geo; cm.cap = cap; cm.base = baseA; cm.glow = glowA;
    cm.dirtyM = cm.dirtyC = cm.dirtyA = true;
    this.group.add(mesh);
  }

  private write(cm: CM, s: Spec, boxId: number): void {
    if (cm.n >= cm.cap) this.alloc(cm, Math.max(cm.cap * 2, cm.n + 64));
    const i = cm.n++;
    cm.mesh.setMatrixAt(i, s.m);
    cm.mesh.setColorAt(i, s.c);
    if (cm.base) cm.base.setX(i, s.base);
    if (cm.glow) cm.glow.setX(i, s.glow);
    cm.mesh.count = cm.n;
    cm.dirtyM = cm.dirtyC = cm.dirtyA = true;
    let l = this.refs.get(boxId);
    if (!l) { l = []; this.refs.set(boxId, l); }
    l.push({ cm, i });
  }

  private addBox(b: Box): void {
    for (const s of this.specsFor(b)) {
      const cm = this.classes.get(s.key) ?? this.makeCM(s.key, CLASSES[s.key].spare + 8);
      this.write(cm, s, b.id);
    }
  }

  /** 상자 숨김 (인스턴스 행렬 0) */
  hide(id: number): void {
    if (this.hidden.has(id)) return;
    const l = this.refs.get(id);
    if (!l) return;
    this.hidden.add(id);
    const b = this.w.boxes[id];
    const keepFrame = b && b.kind === 'window' && b.building >= 0 && !this.collapsed(b.building);
    for (const r of l) {
      if (keepFrame && r.cm.key === 'frame') continue;
      r.cm.mesh.setMatrixAt(r.i, ZERO);
      r.cm.dirtyM = true;
    }
  }

  private collapsed(bid: number): boolean {
    const bl = this.bld.get(bid);
    return !!bl && bl.collapsed;
  }

  /** 건물이 무너지면 그 건물 상자(창틀 포함) 전부 숨김 */
  collapse(bid: number): void {
    const l = this.bldBoxes.get(bid);
    if (!l) return;
    for (const id of l) {
      this.hidden.delete(id);
      const refs = this.refs.get(id);
      if (!refs) continue;
      for (const r of refs) { r.cm.mesh.setMatrixAt(r.i, ZERO); r.cm.dirtyM = true; }
      this.hidden.add(id);
    }
  }

  /** 새로 덧붙은 상자(잔해 등)를 그리고, 놓친 파괴가 없는지 조금씩 훑는다 */
  sync(): void {
    const boxes = this.w.boxes;
    if (boxes.length > this.seen) {
      for (let i = this.seen; i < boxes.length; i++) {
        const b = boxes[i];
        if (b && b.alive && !this.refs.has(b.id)) this.addBox(b);
      }
      this.seen = boxes.length;
    }
    const n = boxes.length;
    if (n) {
      for (let k = 0; k < 250; k++) {
        this.scan = (this.scan + 1) % n;
        const b = boxes[this.scan];
        if (b && !b.alive && !this.hidden.has(b.id) && this.refs.has(b.id)) this.hide(b.id);
      }
    }
    this.flush();
  }

  private flush(): void {
    for (const cm of this.classes.values()) {
      if (cm.dirtyM) { cm.mesh.instanceMatrix.needsUpdate = true; cm.dirtyM = false; }
      if (cm.dirtyC && cm.mesh.instanceColor) { cm.mesh.instanceColor.needsUpdate = true; cm.dirtyC = false; }
      if (cm.dirtyA) {
        if (cm.base) cm.base.needsUpdate = true;
        if (cm.glow) cm.glow.needsUpdate = true;
        cm.dirtyA = false;
      }
    }
  }

  setEnv(env: THREE.Texture | null): void {
    this.env = env;
    const g = this.classes.get('glass');
    if (g) { (g.mat as THREE.MeshStandardMaterial).envMap = env; g.mat.needsUpdate = true; }
  }

  materials(): THREE.Material[] {
    return [...this.classes.values()].map((c) => c.mat);
  }

  dispose(): void {
    for (const cm of this.classes.values()) {
      cm.mesh.dispose();
      cm.geo.dispose();
      if (cm.geo !== cm.template) cm.template.dispose();
      cm.mat.dispose();
    }
    this.classes.clear();
    this.refs.clear();
    this.group.clear();
  }
}
