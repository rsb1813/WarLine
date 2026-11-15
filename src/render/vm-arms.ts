// render-viewmodel: gloved hands with articulated fingers + IK sleeves.
// Hand local frame (right hand): -Z = fingers, -Y = palm normal, thumb on -X. The left hand is mirrored (scale.x = -1).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** curls per finger [proximal, middle, distal] ×4 (index..pinky), thumb [yaw, pitch, c1, c2], finger spread */
export interface PoseDef { f: [number, number, number][]; t: [number, number, number, number]; spread: number }

const P = (a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number], t: [number, number, number, number], spread = 0): PoseDef => ({ f: [a, b, c, d], t, spread });

export const POSES: Record<string, PoseDef> = {
  grip: P([-0.3, -1.0, -0.5], [-1.4, -1.45, -0.85], [-1.42, -1.45, -0.85], [-1.45, -1.4, -0.8], [0.62, -0.55, -0.45, -0.5], 0.02),
  wrap: P([-1.0, -1.0, -0.55], [-1.05, -1.0, -0.6], [-1.08, -1.0, -0.6], [-1.12, -1.0, -0.55], [0.42, -0.18, -0.18, -0.15], 0.04),
  vgrip: P([-1.35, -1.45, -0.9], [-1.4, -1.5, -0.9], [-1.42, -1.5, -0.9], [-1.45, -1.45, -0.85], [0.6, -0.6, -0.55, -0.5], 0.0),
  hook: P([-0.9, -1.35, -0.8], [-0.95, -1.35, -0.8], [-1.0, -1.3, -0.75], [-1.05, -1.25, -0.7], [0.3, -0.2, -0.3, -0.3], 0.02),
  pinch: P([-0.65, -0.9, -0.55], [-0.8, -1.0, -0.6], [-1.3, -1.4, -0.85], [-1.35, -1.35, -0.8], [0.85, -0.7, -0.5, -0.4], 0.03),
  cup: P([-0.5, -0.5, -0.3], [-0.5, -0.5, -0.3], [-0.55, -0.5, -0.3], [-0.6, -0.5, -0.3], [0.4, -0.3, -0.2, -0.2], 0.06),
  flat: P([-0.35, -0.35, -0.2], [-0.35, -0.35, -0.2], [-0.4, -0.35, -0.2], [-0.45, -0.35, -0.2], [0.5, -0.3, -0.1, -0.1], 0.05),
  fist: P([-1.45, -1.55, -1.0], [-1.5, -1.55, -1.0], [-1.5, -1.55, -1.0], [-1.5, -1.5, -0.95], [0.7, -0.8, -0.7, -0.5], 0.0),
  grenade: P([-0.95, -0.8, -0.5], [-0.9, -0.75, -0.5], [-0.95, -0.8, -0.5], [-1.0, -0.85, -0.5], [0.75, -0.5, -0.5, -0.3], 0.12),
  relax: P([-0.55, -0.7, -0.4], [-0.6, -0.75, -0.4], [-0.65, -0.75, -0.4], [-0.7, -0.75, -0.4], [0.5, -0.3, -0.3, -0.2], 0.06),
};

/** flatten a pose to a param vector (12 finger + 4 thumb + 1 spread) */
export function poseVec(name: string, out: number[] = []): number[] {
  const p = POSES[name] ?? POSES.relax;
  let i = 0;
  for (const f of p.f) { out[i++] = f[0]; out[i++] = f[1]; out[i++] = f[2]; }
  out[i++] = p.t[0]; out[i++] = p.t[1]; out[i++] = p.t[2]; out[i++] = p.t[3];
  out[i++] = p.spread;
  return out;
}
export const POSE_LEN = 17;

const FX = [-0.0292, -0.0097, 0.0097, 0.0292];
const FLEN: [number, number, number][] = [[0.044, 0.027, 0.022], [0.048, 0.03, 0.023], [0.045, 0.028, 0.022], [0.036, 0.022, 0.019]];

export class Hand {
  readonly root = new THREE.Group();
  readonly cur: number[] = poseVec('relax');
  private joints: THREE.Group[] = [];      // 12 finger joints (index-major)
  private fingerRoots: THREE.Group[] = [];
  private thumbBase = new THREE.Group();
  private thumbJ: THREE.Group[] = [];
  private geos: THREE.BufferGeometry[] = [];
  /** attachment point for held items (grenade during throw) */
  readonly holdPoint = new THREE.Object3D();

  constructor(readonly left: boolean, glove: THREE.Material, armor: THREE.Material, cuff: THREE.Material) {
    const rb = (w: number, h: number, d: number, r: number) => { const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)); this.geos.push(g); return g; };
    const mesh = (parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); parent.add(o); return o; };
    if (left) this.root.scale.x = -1;
    // palm + back panel + knuckle armour
    mesh(this.root, rb(0.084, 0.03, 0.09, 0.012), glove, 0, 0, 0.002);
    mesh(this.root, rb(0.062, 0.007, 0.048, 0.003), armor, 0.002, 0.0155, 0.014);
    mesh(this.root, rb(0.074, 0.012, 0.024, 0.005), armor, 0, 0.0145, -0.033);
    mesh(this.root, rb(0.03, 0.02, 0.05, 0.009), glove, -0.032, -0.006, 0.018);   // thenar pad
    // cuff
    const cg = new THREE.CylinderGeometry(0.036, 0.034, 0.06, 16); cg.rotateX(Math.PI / 2); this.geos.push(cg);
    const c = mesh(this.root, cg, cuff, 0, 0.001, 0.07); c.scale.set(1.18, 0.82, 1);
    mesh(this.root, rb(0.088, 0.034, 0.02, 0.008), armor, 0, 0.001, 0.058);         // velcro strap
    // fingers
    for (let f = 0; f < 4; f++) {
      const fr = new THREE.Group(); fr.position.set(FX[f], -0.0015, -0.043 + (f === 1 ? -0.002 : f === 3 ? 0.006 : 0));
      this.root.add(fr); this.fingerRoots.push(fr);
      let parent: THREE.Object3D = fr;
      for (let s = 0; s < 3; s++) {
        const L = FLEN[f][s];
        const j = new THREE.Group();
        parent.add(j);
        if (s > 0) j.position.z = -FLEN[f][s - 1];
        const w = 0.0198 - s * 0.0012, h = 0.019 - s * 0.0011;
        mesh(j, rb(w, h, L + 0.005, s === 2 ? 0.0078 : 0.0055), glove, 0, 0, -L / 2);
        if (s === 0) mesh(j, rb(w * 0.8, 0.004, L * 0.55, 0.0018), armor, 0, h / 2 - 0.0005, -L * 0.45);
        this.joints.push(j);
        parent = j;
      }
    }
    // thumb
    this.thumbBase.position.set(-0.036, -0.008, 0.016);
    this.root.add(this.thumbBase);
    mesh(this.thumbBase, rb(0.024, 0.022, 0.046, 0.009), glove, 0, 0, -0.02);
    const t1 = new THREE.Group(); t1.position.z = -0.042; this.thumbBase.add(t1);
    mesh(t1, rb(0.021, 0.019, 0.034, 0.008), glove, 0, 0, -0.016);
    const t2 = new THREE.Group(); t2.position.z = -0.032; t1.add(t2);
    mesh(t2, rb(0.0195, 0.018, 0.027, 0.0085), glove, 0, 0, -0.012);
    this.thumbJ = [t1, t2];
    this.holdPoint.position.set(0, -0.042, -0.012);
    this.root.add(this.holdPoint);
    this.root.traverse(o => { o.frustumCulled = false; });
    this.apply();
  }

  /** move finger params toward a target vector */
  pose(target: number[], rate: number, dt: number): void {
    const k = 1 - Math.exp(-rate * dt);
    for (let i = 0; i < POSE_LEN; i++) this.cur[i] += (target[i] - this.cur[i]) * k;
    this.apply();
  }

  private apply(): void {
    const c = this.cur;
    for (let f = 0; f < 4; f++) {
      for (let s = 0; s < 3; s++) this.joints[f * 3 + s].rotation.x = c[f * 3 + s];
      this.fingerRoots[f].rotation.y = (f - 1.5) * -c[16];
    }
    this.thumbBase.rotation.set(c[13], c[12], 0.7, 'YXZ');
    this.thumbJ[0].rotation.x = c[14];
    this.thumbJ[1].rotation.x = c[15];
  }

  /** wrist point in hand-local coordinates */
  static readonly WRIST = new THREE.Vector3(0, 0.002, 0.085);

  dispose(): void { for (const g of this.geos) g.dispose(); }
}

/** two-bone sleeve: upper arm + forearm between shoulder and wrist */
export class Arm {
  readonly group = new THREE.Group();
  private upper: THREE.Mesh; private fore: THREE.Mesh; private elbow: THREE.Mesh; private ring: THREE.Mesh;
  private geos: THREE.BufferGeometry[] = [];
  private _d = new THREE.Vector3(); private _p = new THREE.Vector3(); private _e = new THREE.Vector3(); private _s = new THREE.Vector3();
  private static Y = new THREE.Vector3(0, 1, 0);

  constructor(public mat: THREE.Material, readonly lenU = 0.3, readonly lenF = 0.28) {
    const ug = new THREE.CylinderGeometry(0.05, 0.056, 1, 16, 1, true); ug.translate(0, 0.5, 0);
    const fg = new THREE.CylinderGeometry(0.039, 0.05, 1, 16, 1, true); fg.translate(0, 0.5, 0);
    const eg = new THREE.SphereGeometry(0.05, 14, 10);
    const rg = new THREE.TorusGeometry(0.039, 0.007, 6, 16); rg.rotateX(Math.PI / 2);
    this.geos.push(ug, fg, eg, rg);
    this.upper = new THREE.Mesh(ug, mat); this.fore = new THREE.Mesh(fg, mat); this.elbow = new THREE.Mesh(eg, mat); this.ring = new THREE.Mesh(rg, mat);
    this.group.add(this.upper, this.fore, this.elbow, this.ring);
    this.group.traverse(o => { o.frustumCulled = false; });
  }

  setMaterial(m: THREE.Material): void {
    this.mat = m;
    for (const o of [this.upper, this.fore, this.elbow, this.ring]) o.material = m;
  }

  /** solve and place. shoulder may slide toward the wrist when out of reach */
  update(shoulder: THREE.Vector3, wrist: THREE.Vector3, pole: THREE.Vector3, foreDir?: THREE.Vector3): void {
    const a = this.lenU, b = this.lenF;
    const S = this._s.copy(shoulder);
    const d = this._d.subVectors(wrist, S);
    let L = d.length();
    const dir = d.normalize();
    const maxL = a + b - 0.002, minL = Math.abs(a - b) + 0.02;
    if (L > maxL) { S.copy(wrist).addScaledVector(dir, -maxL); L = maxL; }
    if (L < minL) L = minL;
    const cosA = THREE.MathUtils.clamp((a * a + L * L - b * b) / (2 * a * L), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const perp = this._p.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (perp.lengthSq() < 1e-6) perp.set(0, -1, 0);
    perp.normalize();
    const E = this._e.copy(S).addScaledVector(dir, a * cosA).addScaledVector(perp, a * sinA);
    // optional: bias elbow so the forearm leaves the wrist along foreDir
    if (foreDir) { E.addScaledVector(foreDir, 0.03); }
    this.place(this.upper, S, E);
    this.place(this.fore, E, wrist);
    this.elbow.position.copy(E);
    this.ring.position.copy(wrist).addScaledVector(this._d.subVectors(E, wrist).normalize(), 0.012);
    this.ring.quaternion.setFromUnitVectors(Arm.Y, this._d);
  }

  private _v = new THREE.Vector3();
  private place(m: THREE.Mesh, A: THREE.Vector3, B: THREE.Vector3): void {
    const v = this._v.subVectors(B, A);
    const len = Math.max(0.001, v.length());
    m.position.copy(A);
    m.quaternion.setFromUnitVectors(Arm.Y, v.multiplyScalar(1 / len));
    m.scale.set(1, len, 1);
  }

  dispose(): void { for (const g of this.geos) g.dispose(); }
}

const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _bm = new THREE.Matrix4();
/** quaternion of a hand frame from finger direction and palm normal (same rule as handAnchor) */
export function handQuat(f: [number, number, number], n: [number, number, number], out = new THREE.Quaternion()): THREE.Quaternion {
  _bz.set(f[0], f[1], f[2]).normalize().negate();
  _by.set(n[0], n[1], n[2]).normalize().negate();
  _by.addScaledVector(_bz, -_by.dot(_bz)).normalize();
  _bx.crossVectors(_by, _bz);
  _bm.makeBasis(_bx, _by, _bz);
  return out.setFromRotationMatrix(_bm);
}
