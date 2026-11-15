// 거점 깃대와 깃발: 점령 진행(prog)에 따라 깃발이 오르내리고, 진영 색으로 바뀐다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game, World } from '../types';
import { heightAt } from '../world';
import { FACTIONS } from '../defs';
import { clothTex } from './textures';
import { makeClothMaterial, type SharedUniforms } from './world-shaders';

const POLE_H = 10;
const CLOTH_W = 2.4, CLOTH_H = 1.5;

export class FlagLayer {
  readonly group = new THREE.Group();
  private ids = new Map<string, number>();
  private pos: THREE.Vector3[] = [];
  private frac: number[] = [];
  private col: THREE.Color[] = [];
  private poles: THREE.InstancedMesh | null = null;
  private cloth: THREE.InstancedMesh | null = null;
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private windYaw: number;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private white = new THREE.Color(0.92, 0.92, 0.9);
  private tc = new THREE.Color();

  constructor(w: World, sh: SharedUniforms) {
    this.windYaw = (w.def.seed % 360) * Math.PI / 180;
    const n = w.flags.length;
    if (!n) return;
    w.flags.forEach((f, i) => {
      this.ids.set(f.id, i);
      this.pos.push(new THREE.Vector3(f.x, heightAt(w, f.x, f.z), f.z));
      this.frac.push(0);
      this.col.push(this.white.clone());
    });

    const base = new THREE.BoxGeometry(1.3, 0.5, 1.3).translate(0, 0.1, 0);
    const pole = new THREE.CylinderGeometry(0.055, 0.08, POLE_H, 8, 1).translate(0, POLE_H / 2, 0);
    const ball = new THREE.SphereGeometry(0.13, 8, 6).translate(0, POLE_H + 0.08, 0);
    for (const g of [base, pole, ball]) g.deleteAttribute('uv');
    const poleGeo = mergeGeometries([base.toNonIndexed(), pole.toNonIndexed(), ball.toNonIndexed()]) as THREE.BufferGeometry;
    base.dispose(); pole.dispose(); ball.dispose();
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x9a9fa4, metalness: 0.55, roughness: 0.45 });
    this.poles = new THREE.InstancedMesh(poleGeo, poleMat, n);
    this.pos.forEach((p, i) => { this.m4.makeTranslation(p.x, p.y, p.z); this.poles!.setMatrixAt(i, this.m4); });
    this.poles.castShadow = true;
    this.poles.receiveShadow = true;
    this.poles.frustumCulled = false;
    this.poles.name = 'flagpoles';

    const clothGeo = new THREE.PlaneGeometry(CLOTH_W, CLOTH_H, 16, 8).translate(CLOTH_W / 2, 0, 0);
    const clothMat = makeClothMaterial(clothTex(), sh, CLOTH_W);
    this.cloth = new THREE.InstancedMesh(clothGeo, clothMat, n);
    this.cloth.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
    this.cloth.castShadow = false;
    this.cloth.receiveShadow = true;
    this.cloth.frustumCulled = false;
    this.cloth.name = 'flagcloth';
    this.geos.push(poleGeo, clothGeo); this.mats.push(poleMat, clothMat);
    this.group.add(this.poles, this.cloth);
    for (let i = 0; i < n; i++) this.placeCloth(i);
    this.cloth.instanceMatrix.needsUpdate = true;
  }

  private placeCloth(i: number): void {
    if (!this.cloth) return;
    const p = this.pos[i];
    const lo = 1.0 + CLOTH_H / 2, hi = POLE_H - 0.25 - CLOTH_H / 2;
    const y = p.y + lo + (hi - lo) * this.frac[i];
    this.q.setFromAxisAngle(this.v.set(0, 1, 0), this.windYaw);
    this.m4.compose(this.v.set(p.x, y, p.z), this.q, this.s);
    this.cloth.setMatrixAt(i, this.m4);
    this.cloth.setColorAt(i, this.col[i]);
  }

  update(g: Game, dt: number): void {
    if (!this.cloth) return;
    const k = 1 - Math.exp(-dt * 3);
    for (const f of g.flags) {
      const i = this.ids.get(f.id);
      if (i === undefined) continue;
      const a = Math.min(1, Math.abs(f.prog));
      this.frac[i] += (a - this.frac[i]) * k;
      if (f.prog > 0.01 || f.prog < -0.01) {
        const side = g.sides[f.prog > 0 ? 0 : 1];
        const fd = FACTIONS[side];
        this.tc.setHex(fd ? fd.color : 0xffffff);
      } else this.tc.copy(this.white);
      const target = this.white.clone().lerp(this.tc, Math.min(1, a * 1.4 + (f.owner !== -1 ? 1 : 0)));
      this.col[i].lerp(target, k);
      this.placeCloth(i);
    }
    this.cloth.instanceMatrix.needsUpdate = true;
    if (this.cloth.instanceColor) this.cloth.instanceColor.needsUpdate = true;
  }

  materials(): THREE.Material[] { return this.mats; }

  dispose(): void {
    this.poles?.dispose(); this.cloth?.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.group.clear();
  }
}
