// render-viewmodel: first-person muzzle flash, ejected casings and torch sparks (all in viewmodel camera space).
import * as THREE from 'three';
import * as M from './vm-mats';

export class MuzzleFlash {
  readonly group = new THREE.Group();
  private inner = new THREE.Group();
  /** kept always visible (intensity 0 when idle) so the light count never changes → no shader recompiles */
  readonly light = new THREE.PointLight(0xffb060, 0, 3.5, 2);
  private front: THREE.Mesh; private sideA: THREE.Mesh; private sideB: THREE.Mesh;
  private matF: THREE.MeshBasicMaterial; private matS: THREE.MeshBasicMaterial;
  private t = 1; private dur = 0.05; private sideOn = true;
  private peak = 0; private lightT = 1; private glowI = 0;
  private geos: THREE.BufferGeometry[] = [];

  constructor() {
    const fg = new THREE.PlaneGeometry(1, 1);
    const sg = new THREE.PlaneGeometry(1, 1); sg.rotateY(Math.PI / 2); sg.translate(0, 0, -0.5);
    const sg2 = sg.clone(); sg2.rotateZ(Math.PI / 2);
    this.geos.push(fg, sg, sg2);
    const st = M.starTex(), ft = M.flameTex();
    this.matF = new THREE.MeshBasicMaterial({ map: st, color: 0xffd2a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.matS = new THREE.MeshBasicMaterial({ map: ft, color: 0xffc080, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.front = new THREE.Mesh(fg, this.matF);
    this.sideA = new THREE.Mesh(sg, this.matS);
    this.sideB = new THREE.Mesh(sg2, this.matS);
    for (const m of [this.front, this.sideA, this.sideB]) { m.renderOrder = 20; m.frustumCulled = false; this.inner.add(m); }
    this.group.add(this.inner);
    this.group.visible = false;
  }

  /** flash planes: size = front diameter, len = side flame length; light = point light peak */
  fire(size: number, len: number, light: number, color = 0xffb060): void {
    this.t = 0;
    this.dur = 0.035 + Math.random() * 0.02;
    const s = size * (0.75 + Math.random() * 0.5);
    this.front.scale.set(s, s, 1);
    this.front.rotation.z = Math.random() * Math.PI * 2;
    const l = len * (0.7 + Math.random() * 0.6), w = size * (0.45 + Math.random() * 0.3);
    this.sideA.scale.set(1, w, l); this.sideB.scale.set(w, 1, l);
    this.sideOn = len > 0.001;
    this.inner.rotation.z = Math.random() * Math.PI;
    this.peak = light; this.lightT = 0;
    this.light.color.setHex(color);
  }

  /** continuous glow (repair torch): keeps the light lit without flash planes */
  glow(intensity: number, color: number): void {
    this.light.color.setHex(color);
    this.glowI = intensity;
  }

  /** follow a muzzle anchor (camera space == world space of the viewmodel scene) */
  place(muzzle: THREE.Object3D): void {
    muzzle.updateWorldMatrix(true, false);
    const q = _q;
    muzzle.matrixWorld.decompose(_p, q, _s);
    this.group.position.copy(_p);
    this.group.quaternion.copy(q);
    this.light.position.copy(_p).add(_o.set(0, 0, 0.06).applyQuaternion(q));
  }

  update(dt: number): void {
    this.t += dt; this.lightT += dt;
    const planes = this.t < this.dur;
    this.group.visible = planes;
    if (planes) {
      const k = 1 - this.t / this.dur;
      this.matF.opacity = k;
      this.matS.opacity = k * 0.9;
      this.sideA.visible = this.sideB.visible = this.sideOn;
    }
    const li = Math.max(this.peak * Math.exp(-this.lightT * 55), this.glowI);
    this.light.intensity = li < 0.01 ? 0 : li;
    this.glowI = 0;
  }

  hide(): void { this.group.visible = false; this.light.intensity = 0; this.peak = 0; this.glowI = 0; }

  dispose(): void { for (const g of this.geos) g.dispose(); this.matF.dispose(); this.matS.dispose(); }
}
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _o = new THREE.Vector3();
const _s = new THREE.Vector3();

interface Casing { g: THREE.Group; body: THREE.Mesh; head: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; life: number }

export class Casings {
  readonly group = new THREE.Group();
  private pool: Casing[] = [];
  private next = 0;
  private geoBody: THREE.BufferGeometry; private geoHead: THREE.BufferGeometry;
  private hull = M.polymer(0x9a1d18, 0.5);

  constructor(n = 18) {
    this.geoBody = new THREE.CylinderGeometry(1, 1, 1, 10); this.geoBody.rotateZ(Math.PI / 2);
    this.geoHead = new THREE.CylinderGeometry(1.06, 1.06, 0.18, 10); this.geoHead.rotateZ(Math.PI / 2); this.geoHead.translate(0.5, 0, 0);
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(this.geoBody, M.brass());
      const head = new THREE.Mesh(this.geoHead, M.brass());
      g.add(body, head); g.visible = false;
      g.traverse(o => { o.frustumCulled = false; });
      this.group.add(g);
      this.pool.push({ g, body, head, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 });
    }
  }

  spawn(pos: THREE.Vector3, vel: THREE.Vector3, kind: string): void {
    const c = this.pool[this.next]; this.next = (this.next + 1) % this.pool.length;
    const shell = kind === 'shell';
    const r = shell ? 0.0102 : kind === 'big' ? 0.0062 : kind === 'pistol' ? 0.0048 : 0.0047;
    const len = shell ? 0.066 : kind === 'big' ? 0.062 : kind === 'pistol' ? 0.019 : 0.045;
    c.g.scale.set(len, r, r);
    c.body.material = shell ? this.hull : M.brass();
    c.g.position.copy(pos);
    c.g.rotation.set(Math.random() * 0.4, Math.random() * Math.PI, Math.random() * 0.4);
    c.vel.copy(vel);
    c.spin.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 30);
    c.life = 0.75;
    c.g.visible = true;
  }

  update(dt: number): void {
    for (const c of this.pool) {
      if (!c.g.visible) continue;
      c.life -= dt;
      if (c.life <= 0) { c.g.visible = false; continue; }
      c.vel.y -= 9.8 * dt;
      c.vel.multiplyScalar(1 - dt * 0.6);
      c.g.position.addScaledVector(c.vel, dt);
      c.g.rotation.x += c.spin.x * dt; c.g.rotation.y += c.spin.y * dt; c.g.rotation.z += c.spin.z * dt;
    }
  }

  clear(): void { for (const c of this.pool) c.g.visible = false; }
  dispose(): void { this.geoBody.dispose(); this.geoHead.dispose(); }
}

/** small additive spark particles (repair torch, defib discharge) */
export class Sparks {
  readonly points: THREE.Points;
  private pos: Float32Array; private vel: Float32Array; private life: Float32Array; private col: Float32Array;
  private n: number; private next = 0;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.PointsMaterial;

  constructor(n = 48) {
    this.n = n;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.col = new Float32Array(n * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mat = new THREE.PointsMaterial({ size: 0.006, map: M.glowTex(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, sizeAttenuation: true });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 21;
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -100;
  }

  emit(at: THREE.Vector3, dir: THREE.Vector3, count: number, speed: number, color: THREE.Color): void {
    for (let k = 0; k < count; k++) {
      const i = this.next; this.next = (this.next + 1) % this.n;
      this.pos[i * 3] = at.x; this.pos[i * 3 + 1] = at.y; this.pos[i * 3 + 2] = at.z;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.vel[i * 3] = dir.x * s + (Math.random() - 0.5) * speed;
      this.vel[i * 3 + 1] = dir.y * s + (Math.random() - 0.2) * speed;
      this.vel[i * 3 + 2] = dir.z * s + (Math.random() - 0.5) * speed;
      this.life[i] = 0.15 + Math.random() * 0.25;
      this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    }
  }

  update(dt: number): void {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -100; continue; }
      any = true;
      this.vel[i * 3 + 1] -= 6 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = Math.min(1, this.life[i] * 5);
      this.col[i * 3 + 1] *= 0.985; this.col[i * 3 + 2] *= 0.95;
      this.col[i * 3] = Math.max(this.col[i * 3] * (0.99 + f * 0.01), 0);
    }
    this.points.visible = any;
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}
