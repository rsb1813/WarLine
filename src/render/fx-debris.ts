// render-fx: 파편 덩어리 (작은 상자 InstancedMesh). 중력·튕김·회전, 지형과 바닥(floorAt)에서 멈춤.
// 일부는 날아가는 동안 연기·불 꼬리를 남긴다 (onTrail 콜백).
import * as THREE from 'three';
import type { World } from '../types';
import { floorAt } from '../world';
import type { Col } from './fx-particles';

export type TrailFn = (x: number, y: number, z: number, kind: number, speed: number) => void;

export class Debris {
  readonly cap: number;
  readonly mesh: THREE.InstancedMesh;
  n = 0;
  private readonly geo: THREE.BoxGeometry;
  private readonly mat: THREE.MeshLambertMaterial;
  private readonly px: Float32Array; private readonly py: Float32Array; private readonly pz: Float32Array;
  private readonly vx: Float32Array; private readonly vy: Float32Array; private readonly vz: Float32Array;
  private readonly rx: Float32Array; private readonly ry: Float32Array; private readonly rz: Float32Array;
  private readonly wx: Float32Array; private readonly wy: Float32Array; private readonly wz: Float32Array;
  private readonly sx: Float32Array; private readonly sy: Float32Array; private readonly sz: Float32Array;
  private readonly age: Float32Array; private readonly life: Float32Array;
  private readonly fy: Float32Array; private readonly ft: Float32Array; private readonly rest: Float32Array;
  private readonly cr: Float32Array; private readonly cg: Float32Array; private readonly cb: Float32Array;
  private readonly trail: Float32Array; private readonly tacc: Float32Array;
  private readonly all: Float32Array[];
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p3 = new THREE.Vector3();
  private readonly s3 = new THREE.Vector3();
  private readonly col = new THREE.Color();

  constructor(cap: number) {
    this.cap = cap;
    const N = cap + 1;
    const f = (): Float32Array => new Float32Array(N);
    this.px = f(); this.py = f(); this.pz = f(); this.vx = f(); this.vy = f(); this.vz = f();
    this.rx = f(); this.ry = f(); this.rz = f(); this.wx = f(); this.wy = f(); this.wz = f();
    this.sx = f(); this.sy = f(); this.sz = f(); this.age = f(); this.life = f();
    this.fy = f(); this.ft = f(); this.rest = f(); this.cr = f(); this.cg = f(); this.cb = f();
    this.trail = f(); this.tacc = f();
    this.all = [this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.rx, this.ry, this.rz, this.wx, this.wy, this.wz,
      this.sx, this.sy, this.sz, this.age, this.life, this.fy, this.ft, this.rest, this.cr, this.cg, this.cb, this.trail, this.tacc];
    this.geo = new THREE.BoxGeometry(1, 1, 1);
    this.mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
  }

  /** trail: 0 없음, 1 연기, 2 불+연기 */
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, c: Col, life: number, trail = 0, flat = false): void {
    const i = this.n < this.cap ? this.n++ : Math.floor(Math.random() * this.cap);
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.rx[i] = Math.random() * 6.28; this.ry[i] = Math.random() * 6.28; this.rz[i] = Math.random() * 6.28;
    const w = 4 + Math.random() * 10;
    this.wx[i] = (Math.random() - 0.5) * w; this.wy[i] = (Math.random() - 0.5) * w; this.wz[i] = (Math.random() - 0.5) * w;
    this.sx[i] = size * (0.6 + Math.random() * 0.6);
    this.sy[i] = size * (flat ? 0.12 + Math.random() * 0.1 : 0.45 + Math.random() * 0.5);
    this.sz[i] = size * (0.5 + Math.random() * 0.7);
    this.age[i] = 0; this.life[i] = life;
    this.fy[i] = -1e9; this.ft[i] = 0; this.rest[i] = 0;
    const k = 0.85 + Math.random() * 0.3;
    this.cr[i] = c.r * k; this.cg[i] = c.g * k; this.cb[i] = c.b * k;
    this.trail[i] = trail; this.tacc[i] = 0;
  }

  update(dt: number, w: World | null, onTrail: TrailFn): void {
    const { px, py, pz, vx, vy, vz, rx, ry, rz, wx, wy, wz, age, life, fy, ft, rest, trail, tacc } = this;
    let i = 0;
    while (i < this.n) {
      age[i] += dt;
      if (age[i] >= life[i]) {
        const last = --this.n;
        if (i !== last) for (const a of this.all) a[i] = a[last];
        continue;
      }
      if (!rest[i]) {
        const d = Math.exp(-0.25 * dt);
        vx[i] *= d; vz[i] *= d; vy[i] -= 9.8 * dt;
        px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
        rx[i] += wx[i] * dt; ry[i] += wy[i] * dt; rz[i] += wz[i] * dt;
        ft[i] -= dt;
        if (ft[i] <= 0 && w) {
          fy[i] = floorAt(w, px[i], py[i] - 0.2, pz[i], 0.05);
          ft[i] = 0.12 + Math.random() * 0.08;
        }
        const half = this.sy[i] * 0.4;
        if (py[i] - half < fy[i]) {
          py[i] = fy[i] + half;
          if (vy[i] < -1.5) {
            vy[i] = -vy[i] * 0.32; vx[i] *= 0.55; vz[i] *= 0.55;
            wx[i] *= 0.6; wy[i] *= 0.6; wz[i] *= 0.6;
          } else {
            vx[i] = vy[i] = vz[i] = 0; rest[i] = 1; trail[i] = 0;
            // 눕히기: 납작한 쪽이 아래로
            rx[i] = Math.round(rx[i] / 1.5708) * 1.5708; rz[i] = Math.round(rz[i] / 1.5708) * 1.5708;
          }
        }
        if (trail[i] > 0) {
          tacc[i] += dt;
          if (tacc[i] > 0.045) {
            tacc[i] = 0;
            onTrail(px[i], py[i], pz[i], trail[i], Math.hypot(vx[i], vy[i], vz[i]));
          }
        }
      }
      i++;
    }
    const m = this.mesh;
    for (let k = 0; k < this.n; k++) {
      const left = life[k] - age[k];
      const sc = left < 1 ? Math.max(0.001, left) : 1;
      this.e.set(rx[k], ry[k], rz[k]);
      this.q.setFromEuler(this.e);
      this.p3.set(px[k], py[k], pz[k]);
      this.s3.set(this.sx[k] * sc, this.sy[k] * sc, this.sz[k] * sc);
      this.m4.compose(this.p3, this.q, this.s3);
      m.setMatrixAt(k, this.m4);
      this.col.setRGB(this.cr[k], this.cg[k], this.cb[k]);
      m.setColorAt(k, this.col);
    }
    m.count = this.n;
    m.visible = this.n > 0;
    if (this.n > 0) {
      m.instanceMatrix.clearUpdateRanges();
      m.instanceMatrix.addUpdateRange(0, this.n * 16);
      m.instanceMatrix.needsUpdate = true;
      const ic = m.instanceColor!;
      ic.clearUpdateRanges();
      ic.addUpdateRange(0, this.n * 3);
      ic.needsUpdate = true;
    }
  }

  clear(): void { this.n = 0; this.mesh.count = 0; this.mesh.visible = false; }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}
