// 나무: 인스턴스 침엽수(층층 원뿔 + 눈), 겨울 자작나무(흰 줄기 + 잔가지), 죽은 나무. 줄기 상자가 부서지면 쓰러진다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { World } from '../types';
import { rng, hash2 } from '../math';
import { barkTex, twigTex } from './textures';
import { addSway, type SharedUniforms } from './world-shaders';

type Part = 'foliage' | 'trunk' | 'branch' | 'crown';
interface PartRef { part: Part; i: number; offY: number; sx: number; sy: number; sz: number }
interface Rec {
  x: number; y: number; z: number; yaw: number;
  parts: PartRef[];
  state: 0 | 1 | 2; t: number; axis: THREE.Vector3;
}

function pineGeometry(snowAmt: number, seed: number): THREE.BufferGeometry {
  const tiers = [
    { y0: 0.13, y1: 0.52, r: 1.0 },
    { y0: 0.32, y1: 0.69, r: 0.8 },
    { y0: 0.5, y1: 0.85, r: 0.58 },
    { y0: 0.66, y1: 1.0, r: 0.36 },
  ];
  const green = new THREE.Color().setHex(0x1a2b20), green2 = new THREE.Color().setHex(0x26392b);
  const under = new THREE.Color().setHex(0x152017), snow = new THREE.Color().setHex(0xe6edf3);
  const parts: THREE.BufferGeometry[] = [];
  const M = 11;
  const r = rng(seed);
  for (let t = 0; t < tiers.length; t++) {
    const T = tiers[t];
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const c = new THREE.Color();
    const push = (x: number, y: number, z: number, cc: THREE.Color) => { pos.push(x, y, z); col.push(cc.r, cc.g, cc.b); return pos.length / 3 - 1; };
    // 위 원뿔: 꼭대기, 중간 고리, 가장자리 고리(들쭉날쭉, 처짐)
    const apex = push(0, T.y1, 0, c.copy(green2).lerp(snow, Math.min(1, snowAmt * 0.75)));
    const mid: number[] = [], rim: number[] = [];
    for (let k = 0; k < M; k++) {
      const a = (k / M) * Math.PI * 2 + t * 0.7;
      const rr = T.r * (k % 2 ? 0.78 : 1) * (0.9 + r() * 0.2);
      const my = T.y1 + (T.y0 - T.y1) * 0.5;
      mid.push(push(Math.cos(a) * rr * 0.52, my + 0.01, Math.sin(a) * rr * 0.52, c.copy(green).lerp(snow, snowAmt * (0.3 + r() * 0.35))));
      const droop = k % 2 ? 0.01 : -0.035;
      rim.push(push(Math.cos(a) * rr, T.y0 + droop, Math.sin(a) * rr, c.copy(green).lerp(snow, snowAmt * (0.04 + r() * 0.14))));
    }
    for (let k = 0; k < M; k++) {
      const k2 = (k + 1) % M;
      idx.push(apex, mid[k2], mid[k]);
      idx.push(mid[k], mid[k2], rim[k]);
      idx.push(mid[k2], rim[k2], rim[k]);
    }
    // 아랫면
    const bc = push(0, T.y0 + 0.07, 0, under);
    const rimU: number[] = [];
    for (let k = 0; k < M; k++) {
      const p = rim[k];
      rimU.push(push(pos[p * 3], pos[p * 3 + 1], pos[p * 3 + 2], under));
    }
    for (let k = 0; k < M; k++) idx.push(bc, rimU[k], rimU[(k + 1) % M]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // 잎 덩어리는 부드럽게: 법선을 위로 기울인다
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < n.count; i++) {
      if (i >= bc) continue;
      const v = new THREE.Vector3(n.getX(i), n.getY(i) + 0.45, n.getZ(i)).normalize();
      n.setXYZ(i, v.x, v.y, v.z);
    }
    parts.push(g);
  }
  const g = mergeGeometries(parts) as THREE.BufferGeometry;
  parts.forEach((p) => p.dispose());
  return g;
}

/** 가지: 줄기에서 비스듬히 뻗는 가는 원기둥들 (가로 1 = 수관 반지름, 세로 1 = 나무 높이) */
function branchGeometry(seed: number, n: number): THREE.BufferGeometry {
  const r = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const addLimb = (s: THREE.Vector3, e: THREE.Vector3, r0: number, r1: number) => {
    const d = new THREE.Vector3().subVectors(e, s);
    const L = d.length();
    const c = new THREE.CylinderGeometry(r1, r0, L, 4, 1, true);
    c.deleteAttribute('uv');
    c.translate(0, L / 2, 0);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d.normalize()));
    c.translate(s.x, s.y, s.z);
    parts.push(c);
  };
  for (let k = 0; k < n; k++) {
    const y = 0.32 + 0.55 * (k / n) + r() * 0.04;
    const a = k * 2.399 + r() * 0.5;
    const L = (0.75 - 0.35 * (k / n)) * (0.8 + r() * 0.4);
    const s = new THREE.Vector3(0, y, 0);
    const e = new THREE.Vector3(Math.cos(a) * L, y + L * (0.18 + r() * 0.12), Math.sin(a) * L);
    addLimb(s, e, 0.035, 0.01);
    // 잔가지 하나
    const m = s.clone().lerp(e, 0.55);
    const a2 = a + (r() - 0.5) * 1.6;
    const e2 = new THREE.Vector3(m.x + Math.cos(a2) * L * 0.4, m.y + L * 0.22, m.z + Math.sin(a2) * L * 0.4);
    addLimb(m, e2, 0.014, 0.005);
  }
  const g = mergeGeometries(parts) as THREE.BufferGeometry;
  parts.forEach((p) => p.dispose());
  return g;
}

const TRUNK_COL = { pine: 0x5a4434, birch: 0xe9e5dd, dead: 0x6c655d };
const BRANCH_COL = { birch: 0x5e4c44, dead: 0x6a635b };

export class TreeLayer {
  readonly group = new THREE.Group();
  private meshes = new Map<Part, THREE.InstancedMesh>();
  private recs: Rec[] = [];
  private byBox = new Map<number, number>();
  private falling: Rec[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private m4 = new THREE.Matrix4();
  private m4b = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private qf = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private dirty = new Set<Part>();

  constructor(w: World, sh: SharedUniforms) {
    const snowAmt = w.def.theme === 'snow' ? 1 : w.def.theme === 'industrial' ? 0.7 : 0.3;
    const counts: Record<Part, number> = { foliage: 0, trunk: 0, branch: 0, crown: 0 };
    const alive = (id: number) => {
      if (id < 0) return true;
      const b = w.boxes[id];
      return !b || b.id !== id ? !w.boxes.some((x) => x.id === id && !x.alive) : b.alive;
    };
    const live = w.trees.filter((t) => alive(t.box));
    for (const t of live) {
      counts.trunk++;
      if (t.kind === 'pine') counts.foliage++;
      else { counts.branch++; if (t.kind === 'birch') counts.crown++; }
    }
    if (!live.length) return;

    // 재질과 기하
    const foliageGeo = pineGeometry(snowAmt, w.def.seed + 5);
    const trunkGeo = new THREE.CylinderGeometry(0.55, 1, 1, 7, 1, true).translate(0, 0.5, 0);
    const branchGeo = branchGeometry(w.def.seed + 9, 9);
    const crownGeo = new THREE.IcosahedronGeometry(1, 1);
    const foliageMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    addSway(foliageMat, sh, 0.035, 'pine');
    const trunkMat = new THREE.MeshStandardMaterial({ map: barkTex(), roughness: 0.95, metalness: 0 });
    const branchMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    addSway(branchMat, sh, 0.02, 'branch');
    const crownMat = new THREE.MeshStandardMaterial({ map: twigTex(), alphaTest: 0.4, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, color: 0x6a5856 });
    addSway(crownMat, sh, 0.03, 'crown');
    const defs: [Part, THREE.BufferGeometry, THREE.Material, boolean][] = [
      ['foliage', foliageGeo, foliageMat, true],
      ['trunk', trunkGeo, trunkMat, true],
      ['branch', branchGeo, branchMat, true],
      ['crown', crownGeo, crownMat, false],
    ];
    for (const [part, g, m, cast] of defs) {
      this.geos.push(g); this.mats.push(m);
      if (!counts[part]) continue;
      const im = new THREE.InstancedMesh(g, m, counts[part]);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(counts[part] * 3).fill(1), 3);
      im.count = 0;
      im.castShadow = cast;
      im.receiveShadow = true;
      im.frustumCulled = false;
      im.name = 'trees:' + part;
      this.meshes.set(part, im);
      this.group.add(im);
    }

    const c = new THREE.Color();
    for (const t of live) {
      const h1 = hash2(Math.round(t.x * 10), Math.round(t.z * 10), 41), h2 = hash2(Math.round(t.z * 10), Math.round(t.x * 10), 43);
      const rec: Rec = { x: t.x, y: t.y - 0.15, z: t.z, yaw: h1 * Math.PI * 2, parts: [], state: 0, t: 0, axis: new THREE.Vector3() };
      const add = (part: Part, offY: number, sx: number, sy: number, sz: number, col: THREE.Color) => {
        const im = this.meshes.get(part);
        if (!im) return;
        const i = im.count++;
        im.setColorAt(i, col);
        rec.parts.push({ part, i, offY, sx, sy, sz });
      };
      const h = Math.max(1.5, t.h), r = Math.max(0.4, t.r);
      if (t.kind === 'pine') {
        add('foliage', 0, r, h, r, c.setRGB(0.9 + h2 * 0.18, 0.92 + h1 * 0.14, 0.9 + h2 * 0.12));
        add('trunk', 0, Math.max(0.1, r * 0.09), h * 0.75, Math.max(0.1, r * 0.09), c.setHex(TRUNK_COL.pine));
      } else if (t.kind === 'birch') {
        const tr = 0.08 + r * 0.035;
        add('trunk', 0, tr, h * 0.94, tr, c.setHex(TRUNK_COL.birch).multiplyScalar(0.92 + h2 * 0.08));
        add('branch', 0, r * 0.85, h, r * 0.85, c.setHex(BRANCH_COL.birch));
        add('crown', h * 0.64, r, h * 0.42, r, c.setRGB(0.85 + h2 * 0.3, 0.85 + h2 * 0.2, 0.85 + h1 * 0.2));
      } else {
        const tr = 0.09 + r * 0.04;
        add('trunk', 0, tr, h * 0.86, tr, c.setHex(TRUNK_COL.dead).multiplyScalar(0.85 + h2 * 0.25));
        add('branch', 0, r * 0.6, h * 0.92, r * 0.6, c.setHex(BRANCH_COL.dead).multiplyScalar(0.85 + h1 * 0.25));
      }
      const idx = this.recs.length;
      this.recs.push(rec);
      if (t.box >= 0) this.byBox.set(t.box, idx);
      this.place(rec, 0, 0);
    }
    for (const im of this.meshes.values()) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  /** 넘어짐 각 ang, 가라앉음 sink 로 나무 하나의 행렬을 다시 쓴다 */
  private place(rec: Rec, ang: number, sink: number): void {
    this.q.setFromAxisAngle(this.v.set(0, 1, 0), rec.yaw);
    if (ang) this.qf.setFromAxisAngle(rec.axis, ang); else this.qf.identity();
    for (const p of rec.parts) {
      const im = this.meshes.get(p.part);
      if (!im) continue;
      // M = T(바닥) · R(넘어짐) · T(0, offY, 0) · R(yaw) · S
      this.m4.compose(this.v.set(0, p.offY, 0), this.q, this.s.set(p.sx, p.sy, p.sz));
      this.m4b.compose(this.v.set(rec.x, rec.y - sink, rec.z), this.qf, this.s.set(1, 1, 1));
      this.m4b.multiply(this.m4);
      im.setMatrixAt(p.i, this.m4b);
      this.dirty.add(p.part);
    }
  }

  private hideRec(rec: Rec): void {
    this.m4.makeScale(0, 0, 0);
    for (const p of rec.parts) {
      const im = this.meshes.get(p.part);
      if (!im) continue;
      im.setMatrixAt(p.i, this.m4);
      this.dirty.add(p.part);
    }
  }

  /** 줄기 상자가 부서졌다 → 쓰러뜨린다 */
  breakBox(id: number): void {
    const k = this.byBox.get(id);
    if (k === undefined) return;
    const rec = this.recs[k];
    if (rec.state !== 0) return;
    rec.state = 1; rec.t = 0;
    const a = hash2(id, 77, 3) * Math.PI * 2;
    rec.axis.set(Math.cos(a), 0, Math.sin(a));
    this.falling.push(rec);
  }

  update(dt: number): void {
    if (this.falling.length) {
      for (let i = this.falling.length - 1; i >= 0; i--) {
        const rec = this.falling[i];
        rec.t += dt;
        const FALL = 1.7, LIE = 10, SINK = 3;
        if (rec.t < FALL) {
          const u = rec.t / FALL;
          this.place(rec, u * u * (Math.PI / 2 - 0.1), 0);
        } else if (rec.t < FALL + LIE) {
          if (rec.state === 1) { rec.state = 2; this.place(rec, Math.PI / 2 - 0.1, 0); }
        } else if (rec.t < FALL + LIE + SINK) {
          this.place(rec, Math.PI / 2 - 0.1, (rec.t - FALL - LIE) * 0.6);
        } else {
          this.hideRec(rec);
          this.falling.splice(i, 1);
        }
      }
    }
    if (this.dirty.size) {
      for (const p of this.dirty) { const im = this.meshes.get(p); if (im) im.instanceMatrix.needsUpdate = true; }
      this.dirty.clear();
    }
  }

  materials(): THREE.Material[] { return this.mats; }

  dispose(): void {
    for (const im of this.meshes.values()) im.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.meshes.clear();
    this.group.clear();
  }
}
