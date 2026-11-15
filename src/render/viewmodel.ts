// render-viewmodel: first-person weapon/arms view rendered in its own scene on top of the world.
import * as THREE from 'three';
import type { Game, GadgetState, Soldier, SlotId, WeaponState } from '../types';
import { SLOT_IDS } from '../types';
import { FACTIONS } from '../defs';
import { buildGunModel, buildGadgetModel } from './gunmodel';
import { disposeModel } from './vm-geo';
import { handAnchor } from './vm-gunparts';
import { Arm, Hand, handQuat, poseOf, POSE_LEN } from './vm-arms';
import { Casings, MuzzleFlash, Sparks } from './vm-fx';
import * as M from './vm-mats';

type V3 = [number, number, number];
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const sstep = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const seg = (p: number, a: number, b: number) => sstep((p - a) / (b - a));
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

class Spring {
  x = 0; v = 0;
  constructor(public k: number, public c: number) {}
  step(target: number, dt: number): number {
    const n = dt > 0.02 ? 2 : 1, h = dt / n;
    for (let i = 0; i < n; i++) { const a = -this.k * (this.x - target) - this.c * this.v; this.v += a * h; this.x += this.v * h; }
    return this.x;
  }
  reset(): void { this.x = 0; this.v = 0; }
}

interface HoldDef { hip: V3; hipR: V3; spr: V3; sprR: V3; rel: V3; relR: V3; ads: boolean; pivot: V3 }
const HOLDS: Record<string, HoldDef> = {
  rifle: { hip: [0.135, -0.142, -0.35], hipR: [0.015, 0.05, -0.04], spr: [-0.035, -0.012, 0.02], sprR: [-0.22, 0.55, 0.45], rel: [-0.045, 0.03, 0.025], relR: [0.16, 0.32, -0.45], ads: true, pivot: [0, 0.06, 0.12] },
  pistol: { hip: [0.072, -0.09, -0.35], hipR: [0.02, 0.07, -0.02], spr: [-0.03, -0.07, 0.06], sprR: [-0.8, 0.3, 0.2], rel: [-0.035, 0.035, 0.05], relR: [0.3, 0.3, -0.35], ads: true, pivot: [0, 0, 0.05] },
  shoulder: { hip: [0.13, -0.158, -0.13], hipR: [0, 0.025, 0], spr: [-0.01, -0.035, 0.02], sprR: [-0.18, 0.2, 0.1], rel: [0, -0.2, 0.05], relR: [-0.4, 0, 0], ads: true, pivot: [0, 0.08, 0.1] },
  tool: { hip: [0.1, -0.15, -0.27], hipR: [0.05, 0.08, -0.04], spr: [-0.03, -0.05, 0.03], sprR: [-0.4, 0.4, 0.3], rel: [0, 0, 0], relR: [0, 0, 0], ads: false, pivot: [0, 0.05, 0.08] },
  item: { hip: [0.03, -0.21, -0.4], hipR: [0.32, -0.08, 0.02], spr: [-0.02, -0.06, 0.03], sprR: [-0.3, 0.2, 0.1], rel: [0, 0, 0], relR: [0, 0, 0], ads: false, pivot: [0, 0, 0] },
  item1: { hip: [0.1, -0.15, -0.34], hipR: [0.15, -0.1, -0.15], spr: [-0.02, -0.06, 0.03], sprR: [-0.3, 0.2, 0.1], rel: [0, 0, 0], relR: [0, 0, 0], ads: false, pivot: [0, 0, 0] },
  pen: { hip: [0.06, -0.1, -0.3], hipR: [0.12, 0.35, 0.25], spr: [-0.02, -0.05, 0.03], sprR: [-0.3, 0.2, 0.1], rel: [0, 0, 0], relR: [0, 0, 0], ads: false, pivot: [0, 0, 0] },
  paddles: { hip: [0, -0.115, -0.34], hipR: [0.22, 0, 0], spr: [0, -0.06, 0.04], sprR: [-0.3, 0, 0], rel: [0, 0, 0], relR: [0, 0, 0], ads: false, pivot: [0, 0, 0] },
  throw: { hip: [0.1, -0.13, -0.3], hipR: [0.2, 0.1, 0.2], spr: [-0.02, -0.05, 0.03], sprR: [-0.3, 0.2, 0.1], rel: [0, 0, 0], relR: [0, 0, 0], ads: false, pivot: [0, 0, 0] },
};

interface Held {
  key: string; model: THREE.Group; ud: Record<string, any>; gadget: boolean; hold: string;
  sightPos: THREE.Vector3; eye: number; loadHi: THREE.Object3D | null; loadLo: THREE.Object3D | null;
}
interface Rest { p: THREE.Vector3; q: THREE.Quaternion }

const SUN_WORLD = new THREE.Vector3(0.42, 0.78, 0.46).normalize();
const THROWN = new Set(['frag', 'smoke', 'flash', 'incendiary', 'impact', 'breach']);
const USE_ANIM = new Set(['stim', 'medbag', 'ammobag', 'cover', 'atmine', 'claymore', 'sensor', 'beacon', 'drone', 'defib']);

// scratch
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _sc = new THREE.Vector3();
const QI = new THREE.Quaternion();

function attSig(w: WeaponState): string {
  let s = w.id;
  for (const slot of SLOT_IDS as SlotId[]) s += '|' + (w.att?.[slot] ?? '');
  return s;
}

/** world transform of an anchor (scene space = camera space) */
function anchorXf(o: THREE.Object3D, p: THREE.Vector3, q: THREE.Quaternion): void {
  o.updateWorldMatrix(true, false);
  o.matrixWorld.decompose(p, q, _sc);
}

export class ViewModel {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.01, 10);

  private rig = new THREE.Group();
  private pivot = new THREE.Group();
  private hemi = new THREE.HemisphereLight(0xd2dce8, 0x4a4844, 1.05);
  private sun = new THREE.DirectionalLight(0xfff1e0, 2.3);
  private fill = new THREE.DirectionalLight(0xbcd0ff, 0.45);
  private hands: [Hand, Hand];   // [right, left]
  private arms: [Arm, Arm];
  private flash = new MuzzleFlash();
  private casings = new Casings();
  private sparks = new Sparks();
  private gloveMat = M.fabric(0x4a4438);
  private armorMat = M.rubber(0x1d1d1b);
  private sleeveMat: THREE.Material = M.camo([0x6b705a, 0x4b5040, 0x2f3329]);

  private cache = new Map<string, THREE.Group>();
  private held: Held | null = null;
  private heldKey = '';
  private rest = new WeakMap<THREE.Object3D, Rest>();
  private seen = new WeakSet<object>();
  private side = '';
  private scopeState = { active: false, zoom: 1, reticle: 'iron' };
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envTried = false;
  private shellMesh: THREE.Group;

  // motion state
  private t = 0;
  private phase = 0; private bobAmp = 0;
  private sprintK = 0; private crouchK = 0; private proneK = 0; private slideK = 0; private adsE = 0;
  private kz = new Spring(380, 21); private ky = new Spring(380, 21); private kx = new Spring(380, 21);
  private kp = new Spring(320, 19); private kyaw = new Spring(320, 19); private kroll = new Spring(320, 19);
  private sx = new Spring(150, 15); private sy = new Spring(150, 15);
  private syaw = new Spring(150, 15); private spitch = new Spring(150, 15); private sroll = new Spring(150, 15);
  private landY = new Spring(140, 13); private landP = new Spring(140, 13);
  private lastGround = true; private lastVy = 0;
  private lastMag = -1; private lastFireT = 0; private lastThrowT = 0; private lastSwapT = 0; private swapMax = 0;
  private raiseT = 0;
  private evShot = false; private evGadget = ''; private evReload: boolean | null = null; private evThrow: string | null = null;
  private rl = { active: false, empty: false, shells: 1, seated: false, charged: false, wasP: 0 };
  private rlBlend = 0;
  private cyc: { t: number; dur: number; kind: 'bolt' | 'pump'; ejected: boolean } | null = null;
  private slideT = 1;
  private thr: { t: number; dur: number; id: string; model: THREE.Group | null; released: boolean; right: boolean } | null = null;
  private fly: { obj: THREE.Group; vel: THREE.Vector3; spin: THREE.Vector3; t: number } | null = null;
  private useAnim: { t: number; kind: string } | null = null;
  private launcherLow = 0;
  private lastUses = -1;
  private heldUses = -1;
  private lastCd = [0, 0, 0];
  private pressT = 1;
  private throwModels = new Map<string, THREE.Group>();
  private hp = { pR: new THREE.Vector3(), qR: new THREE.Quaternion(), pL: new THREE.Vector3(), qL: new THREE.Quaternion(), tp: new THREE.Vector3(), tq: new THREE.Quaternion(), tgtL: new Array(POSE_LEN).fill(0) as number[], lp: new THREE.Vector3(), lq: new THREE.Quaternion() };
  private tmpPose: number[] = new Array(POSE_LEN).fill(0);
  private pv = new THREE.Vector3(); private pa = new THREE.Vector3(); private pb = new THREE.Vector3();
  private poleR = new THREE.Vector3(0.75, -0.65, 0.15); private poleL = new THREE.Vector3(-0.35, -0.93, 0.1);
  private wl = new THREE.Vector3();

  constructor() {
    this.scene.name = 'viewmodel';
    this.camera.position.set(0, 0, 0);
    this.scene.add(this.rig);
    this.rig.add(this.pivot);
    this.sun.position.set(2, 4, 2);
    this.fill.position.set(-0.4, 0.3, 1);
    this.scene.add(this.hemi, this.sun, this.fill);
    this.hands = [new Hand(false, this.gloveMat, this.armorMat, this.armorMat), new Hand(true, this.gloveMat, this.armorMat, this.armorMat)];
    this.arms = [new Arm(this.sleeveMat), new Arm(this.sleeveMat)];
    for (const h of this.hands) this.rig.add(h.root);
    for (const a of this.arms) this.rig.add(a.group);
    this.rig.add(this.flash.group, this.flash.light, this.casings.group, this.sparks.points);
    // a loose shotgun shell carried by the left hand while loading a tube magazine
    this.shellMesh = new THREE.Group();
    const sb = new THREE.Mesh(new THREE.CylinderGeometry(0.0102, 0.0102, 0.052, 12), M.polymer(0x9a1d18, 0.5));
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.0108, 0.0108, 0.012, 12), M.brass());
    sb.rotation.x = Math.PI / 2; sh.rotation.x = Math.PI / 2; sh.position.z = 0.03;
    this.shellMesh.add(sb, sh);
    this.shellMesh.visible = false;
    this.hands[1].holdPoint.add(this.shellMesh);
    this.rig.visible = false;
  }

  // ───────────────────────── public API ─────────────────────────

  scope(): { active: boolean; zoom: number; reticle: string } { return this.scopeState; }

  resize(width: number, height: number): void {
    this.camera.aspect = Math.max(0.1, width / Math.max(1, height));
    this.camera.updateProjectionMatrix();
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.rig.visible) return;
    if (!this.envTried) this.buildEnv(renderer);
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = ac;
  }

  dispose(): void {
    for (const m of this.cache.values()) disposeModel(m);
    this.cache.clear();
    for (const m of this.throwModels.values()) disposeModel(m);
    this.throwModels.clear();
    for (const h of this.hands) h.dispose();
    for (const a of this.arms) a.dispose();
    this.flash.dispose(); this.casings.dispose(); this.sparks.dispose();
    this.shellMesh.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
    if (this.envRT) { this.envRT.dispose(); this.envRT = null; }
    this.scene.environment = null;
    this.scene.clear();
    this.held = null;
  }

  update(g: Game, s: Soldier, dt: number, look: { dx: number; dy: number }): void {
    dt = clamp(dt || 0, 0, 0.05);
    this.t += dt;
    const alive = s.state === 'alive' && s.vehicle < 0;
    this.faction(g, s);
    this.scanEvents(g, s);
    // gadget usage detection from state (the battle loop usually consumes events before we run)
    let thrownId = this.evThrow;
    for (let i = 0; i < 3; i++) {
      const x = s.gadgets[i];
      if (!x) continue;
      if (x.cd > this.lastCd[i] + 0.1 && THROWN.has(x.kind) && !thrownId) thrownId = x.id;
      this.lastCd[i] = x.cd;
    }
    this.evThrow = thrownId;
    // a held gadget that was just used (placed / injected / launched): keep it on screen for its use animation
    if (this.held?.gadget && !this.useAnim) {
      const hid = this.held.ud.gadgetId as string, kind = this.held.ud.kind as string;
      const x = s.gadgets.find(q => q && q.id === hid);
      const used = (this.evGadget && this.evGadget === hid) || (!!x && this.heldUses >= 0 && x.uses < this.heldUses);
      if (used && USE_ANIM.has(kind)) this.useAnim = { t: 0, kind };
    }

    // ── held item & model swap
    const w = s.weapons[s.cur] as WeaponState | undefined;
    const gs = s.held === 'gadget' ? (s.gadgets[s.heldGadget] as GadgetState | undefined) : undefined;
    const key = gs ? 'g:' + gs.id : w ? 'w:' + attSig(w) : '';
    if (key !== this.heldKey) {
      const holdOld = this.useAnim && this.useAnim.t < 0.42 && this.held?.gadget;
      if (!holdOld) this.setHeld(key, w, gs, s);
    }
    const held = this.held;
    const ud = held?.ud ?? {};
    const isGun = !!held && !held.gadget;
    if (held?.gadget) { const x = s.gadgets.find(q => q && q.id === ud.gadgetId); this.heldUses = x ? x.uses : -1; }
    else this.heldUses = -1;

    // ── scope state
    const zoom = isGun && w ? (w.st?.zoom ?? ud.zoom ?? 1) : (ud.zoom ?? 1);
    const reticle = isGun && w ? (w.st?.reticle ?? ud.reticle ?? 'iron') : (ud.reticle ?? 'iron');
    this.scopeState = { active: alive && isGun && s.ads > 0.92 && zoom >= 3, zoom, reticle };
    this.rig.visible = alive && !!held && !this.scopeState.active;

    if (!alive || !held) { this.resetMotion(); this.flash.hide(); this.casings.clear(); this.evShot = false; this.evGadget = ''; return; }

    // ── shot detection
    let shot = false;
    if (isGun && w) {
      if (this.evShot) shot = true;
      if (this.lastMag >= 0 && w.mag < this.lastMag && w.reloadT <= 0) shot = true;
      if (s.anim.fireT > this.lastFireT + 0.02 && s.anim.fireT >= 0.09) shot = true;
      this.lastMag = w.mag;
    } else this.lastMag = -1;
    let gadgetFire = !!this.evGadget && !!gs && this.evGadget === gs.id;
    if (gs && (gs.kind === 'rocket' || gs.kind === 'aa' || gs.kind === 'ugl') && s.anim.fireT > this.lastFireT + 0.05) gadgetFire = true;
    if (gs && this.lastUses >= 0 && gs.uses < this.lastUses) gadgetFire = true;
    this.lastUses = gs ? gs.uses : -1;
    this.lastFireT = s.anim.fireT;
    this.evShot = false; this.evGadget = '';

    // ── throws (quick throw keeps the weapon in the right hand)
    if (s.anim.throwT > this.lastThrowT + 0.05 && !this.thr) this.startThrow(this.evThrow ?? s.gadgets[2]?.id ?? 'frag', s);
    else if (this.evThrow && !this.thr) this.startThrow(this.evThrow, s);
    this.evThrow = null;
    this.lastThrowT = s.anim.throwT;

    // ── stance / movement factors
    const hs = Math.hypot(s.vel.x, s.vel.z);
    const reloading = isGun && !!w && w.reloadT > 0 && w.reloadTotal > 0;
    this.sprintK += ((s.sprinting && hs > 1.5 ? 1 : 0) - this.sprintK) * damp(9, dt);
    this.crouchK += ((s.stance === 'crouch' ? 1 : 0) - this.crouchK) * damp(8, dt);
    this.proneK += ((s.stance === 'prone' ? 1 : 0) - this.proneK) * damp(6, dt);
    this.slideK += ((s.sliding > 0 ? 1 : 0) - this.slideK) * damp(10, dt);
    const ampT = s.onGround ? clamp(hs / 4.2, 0, 1.7) : 0;
    this.bobAmp += (ampT - this.bobAmp) * damp(7, dt);
    this.phase += dt * (hs / 2.6) * Math.PI * 2 * (1 + 0.12 * this.sprintK) * (s.onGround ? 1 : 0.25);
    if (!this.lastGround && s.onGround && this.lastVy < -2.5) this.land(Math.min(1.2, -this.lastVy / 10));
    this.lastGround = s.onGround; this.lastVy = s.vel.y;

    // ── draw / swap
    if (s.swapT > this.lastSwapT + 0.01) this.swapMax = s.swapT;
    this.lastSwapT = s.swapT;
    this.raiseT = Math.max(0, this.raiseT - dt / 0.32);
    const drawF = Math.max(s.swapT > 0 && this.swapMax > 0 ? s.swapT / this.swapMax : 0, this.raiseT);
    const lowF = sstep(drawF);

    // ── reload state
    let rp = 0;
    if (reloading && w) {
      if (!this.rl.active) {
        const st = w.st;
        const emptyGuess = w.mag <= 0 || (st ? Math.abs(w.reloadTotal - st.reloadEmpty) < Math.abs(w.reloadTotal - st.reload) : false);
        this.rl = { active: true, empty: this.evReload ?? emptyGuess, shells: clamp((st?.mag ?? 8) - w.mag, 1, 8), seated: false, charged: false, wasP: 0 };
      }
      rp = clamp(1 - w.reloadT / w.reloadTotal, 0, 1);
    } else this.rl.active = false;
    this.evReload = null;
    const rlEnv = reloading ? seg(rp, 0, 0.1) * (1 - seg(rp, 0.88, 1)) : 0;
    this.rlBlend += (rlEnv - this.rlBlend) * damp(reloading ? 30 : 10, dt);

    // ── cycling (bolt / pump)
    const cycleKind = ud.cycle as ('bolt' | 'pump' | null);
    if (shot && cycleKind && w && w.mag > 0) {
      const rpm = w.st?.rpm ?? 60;
      this.cyc = { t: -0.09, dur: clamp(60 / rpm * 0.82, 0.38, 1.05), kind: cycleKind, ejected: false };
    }
    let cp = -1;
    if (this.cyc) {
      this.cyc.t += dt;
      cp = this.cyc.t / this.cyc.dur;
      if (cp >= 1 || reloading) { this.cyc = null; cp = -1; }
    }
    const cycEnv = cp >= 0 ? Math.sin(Math.PI * clamp(cp, 0, 1)) : 0;

    // ── throw / use anims
    let throwK = 0;
    if (this.thr) {
      this.thr.t += dt;
      const tp = this.thr.t / this.thr.dur;
      throwK = Math.sin(Math.PI * clamp(tp, 0, 1));
      if (tp >= 1) this.endThrow();
    }
    if (gadgetFire && gs && USE_ANIM.has(gs.kind) && !this.useAnim) this.useAnim = { t: 0, kind: gs.kind };
    if (this.useAnim) { this.useAnim.t += dt; if (this.useAnim.t > 0.5) { this.useAnim = null; } }
    const useP = this.useAnim ? clamp(this.useAnim.t / 0.42, 0, 1) : 0;
    const useK = this.useAnim ? Math.sin(Math.PI * useP) : 0;
    if (gs && gs.kind === 'defib' && (s.ctl.fire || gadgetFire) && this.pressT >= 1) this.pressT = 0;
    this.pressT = Math.min(1, this.pressT + dt / 0.35);
    const pressK = this.pressT < 1 ? Math.sin(Math.PI * this.pressT) : 0;
    if (gs && gs.kind === 'rocket') this.launcherLow += (((gs.cd > 0.25 && gs.uses > 0) ? 1 : 0) - this.launcherLow) * damp(7, dt);
    else this.launcherLow = 0;

    // ── recoil impulses
    if (shot && w) this.kick(w, ud, s);
    if (gadgetFire && gs) this.gadgetKick(gs.kind);

    // ── look sway
    const inv = 1 / Math.max(dt, 1 / 240);
    const rx = clamp((look?.dx ?? 0) * inv, -14, 14), ry = clamp((look?.dy ?? 0) * inv, -14, 14);
    const hold = HOLDS[held.hold] ?? HOLDS.rifle;
    const adsT = hold.ads ? sstep(s.ads) : 0;
    const adsE = adsT * (1 - this.rlBlend * 0.85) * (1 - this.sprintK) * (1 - throwK) * (1 - cycEnv * 0.55) * (1 - lowF);
    this.adsE = adsE;
    const swayStat = isGun && w ? (w.st?.sway ?? 1) : 1;
    const sm = swayStat * (1 - 0.68 * adsE);
    this.syaw.step(clamp(rx * 0.0085, -0.07, 0.07) * sm, dt);
    this.spitch.step(clamp(-ry * 0.0085, -0.06, 0.06) * sm, dt);
    this.sroll.step(clamp(rx * 0.006, -0.06, 0.06) * sm, dt);
    this.sx.step(-clamp(rx * 0.0016, -0.014, 0.014) * sm, dt);
    this.sy.step(-clamp(ry * 0.0016, -0.012, 0.012) * sm, dt);
    for (const sp of [this.kz, this.ky, this.kx, this.kp, this.kyaw, this.kroll, this.landY, this.landP]) sp.step(0, dt);

    // ── compose pose
    const hipP = _v.fromArray(ud.itemPos && (held.hold === 'item' || held.hold === 'item1') ? ud.itemPos : hold.hip);
    const hipQ = _q.setFromEuler(_e.set(hold.hipR[0], hold.hipR[1], hold.hipR[2], 'YXZ'));
    const adsP = _v2.set(0, 0, -held.eye).sub(held.sightPos);
    const baseP = hipP.lerp(adsP, adsE);
    const baseQ = hipQ.slerp(QI, adsE);
    const oP = _v3.set(0, 0, 0);
    let ox = 0, oy = 0, oz = 0;    // pitch, yaw, roll offsets
    const nonAds = 1 - adsE;
    // stance
    oP.x += (-0.006 * this.crouchK - 0.012 * this.proneK) * nonAds;
    oP.y += (-0.008 * this.crouchK - 0.018 * this.proneK) * nonAds;
    oP.z += (0.008 * this.crouchK + 0.012 * this.proneK) * nonAds;
    oz += (0.035 * this.crouchK + 0.07 * this.proneK) * nonAds;
    // sprint
    const spK = this.sprintK * (1 - this.rlBlend * 0.7);
    oP.x += hold.spr[0] * spK; oP.y += hold.spr[1] * spK; oP.z += hold.spr[2] * spK;
    ox += hold.sprR[0] * spK; oy += hold.sprR[1] * spK; oz += hold.sprR[2] * spK;
    // slide
    oz += this.slideK * 0.22; oP.y -= this.slideK * 0.02;
    // walk bob (figure 8)
    const A = this.bobAmp * (1 - 0.82 * adsE) * (1 + this.sprintK * 0.8);
    const ph = this.phase;
    oP.x += Math.sin(ph) * 0.0085 * A;
    oP.y += Math.sin(2 * ph) * 0.0058 * A - 0.002 * A;
    oz += Math.sin(ph) * 0.02 * A;
    oy += Math.cos(ph) * 0.01 * A + Math.sin(ph) * 0.03 * this.sprintK * A;
    ox += Math.sin(2 * ph) * 0.008 * A;
    // breathing + ADS hold sway
    const br = 1 - 0.65 * adsE;
    oP.y += Math.sin(this.t * 1.6) * 0.0012 * br;
    ox += Math.sin(this.t * 1.6 - 0.7) * 0.004 * br + Math.sin(this.t * 0.83) * 0.0016 * swayStat * adsE;
    oy += Math.sin(this.t * 0.61 + 1.3) * 0.002 * swayStat * adsE;
    // look sway
    oP.x += this.sx.x; oP.y += this.sy.x; oy += this.syaw.x; ox += this.spitch.x; oz += this.sroll.x;
    // strafe lean & air
    const lat = s.vel.x * Math.cos(s.yaw) - s.vel.z * Math.sin(s.yaw);
    oz -= clamp(lat * 0.01, -0.05, 0.05) * (1 - 0.6 * adsE);
    if (!s.onGround) oP.y += clamp(-s.vel.y * 0.0025, -0.02, 0.02) * (1 - 0.7 * adsE);
    // landing & recoil springs
    oP.y += this.landY.x; ox += this.landP.x;
    oP.x += this.kx.x; oP.y += this.ky.x; oP.z += this.kz.x;
    ox += this.kp.x; oy += this.kyaw.x; oz += this.kroll.x;
    // reload pose
    const rb = this.rlBlend;
    oP.x += hold.rel[0] * rb; oP.y += hold.rel[1] * rb; oP.z += hold.rel[2] * rb;
    ox += hold.relR[0] * rb; oy += hold.relR[1] * rb; oz += hold.relR[2] * rb;
    if (reloading && ud.reloadStyle === 'tube') { oz -= 0.35 * rb; oy += 0.05 * rb; }
    // bolt / pump cycle pose
    if (cp >= 0 && this.cyc) {
      if (this.cyc.kind === 'bolt') { oz -= 0.2 * cycEnv; oy += 0.06 * cycEnv; ox += 0.05 * cycEnv; oP.x -= 0.01 * cycEnv; oP.y += 0.012 * cycEnv; }
      else { ox += 0.04 * cycEnv; oP.z += 0.008 * cycEnv; oz -= 0.06 * cycEnv; }
    }
    // draw / lowered
    oP.x += 0.04 * lowF; oP.y -= 0.24 * lowF; oP.z += 0.06 * lowF;
    ox -= 0.95 * lowF; oy += 0.25 * lowF; oz += 0.35 * lowF;
    // quick throw: weapon dips right
    oP.x += 0.035 * throwK; oP.y -= 0.1 * throwK; oP.z += 0.03 * throwK;
    ox -= 0.4 * throwK; oy -= 0.2 * throwK; oz -= 0.25 * throwK;
    // gadget-specific
    if (this.launcherLow > 0.001) { oP.y -= 0.22 * this.launcherLow; ox -= 0.5 * this.launcherLow; }
    if (useK > 0 && this.useAnim) {
      const k = this.useAnim.kind;
      if (k === 'stim') { oP.x -= 0.1 * useK; oP.y -= 0.13 * useK; oP.z += 0.02 * useK; ox -= 0.7 * useK; oy += 0.6 * useK; }
      else if (k === 'drone') { oP.y += 0.12 * useP; oP.z -= 0.35 * useP; ox += 0.2 * useP; }
      else if (k !== 'defib') { oP.y -= 0.12 * useK; oP.z -= 0.12 * useK; ox -= 0.5 * useK; }
    }
    if (pressK > 0) { oP.z -= 0.13 * pressK; oP.y += 0.02 * pressK; }

    const offQ = _q2.setFromEuler(_e.set(ox, oy, oz, 'YXZ'));
    const q = _q3.copy(baseQ).multiply(offQ);
    const piv = this.pv.fromArray(hold.pivot).lerp(held.sightPos, adsE);
    const bp = baseP.add(oP);
    const a1 = this.pa.copy(piv).applyQuaternion(baseQ);
    const a2 = this.pb.copy(piv).applyQuaternion(q);
    this.pivot.position.copy(bp).add(a1).sub(a2);
    this.pivot.quaternion.copy(q);
    this.pivot.updateMatrixWorld(true);

    // ── moving parts + hands
    this.animateParts(s, w, gs, ud, reloading, rp, cp, dt, shot, useK);
    this.updateHands(s, gs, ud, reloading, rp, cp, dt);

    // ── fx
    const muzzle = ud.muzzle as THREE.Object3D | undefined;
    if (muzzle) this.flash.place(muzzle);
    if (shot && w) this.muzzleFlash(w, ud);
    if (gadgetFire && gs && (gs.kind === 'rocket' || gs.kind === 'aa' || gs.kind === 'ugl')) this.flash.fire(gs.kind === 'ugl' ? 0.09 : 0.22, gs.kind === 'ugl' ? 0.1 : 0.3, gs.kind === 'ugl' ? 1.5 : 4, 0xffa050);
    if (gs && gs.kind === 'repair') this.torch(s, gs, ud, dt);
    this.flash.update(dt);
    this.casings.update(dt);
    this.sparks.update(dt);
    if (this.fly) this.updateFly(dt);
    this.lights(s);
  }

  // ───────────────────────── internals ─────────────────────────

  private faction(g: Game, s: Soldier): void {
    const side = g.sides?.[s.team] ?? 'us';
    if (side === this.side) return;
    this.side = side;
    const f = FACTIONS[side];
    const cols: [number, number, number] = f?.camo ?? [0x6b705a, 0x4b5040, 0x2f3329];
    this.sleeveMat = M.camo(cols);
    for (const a of this.arms) a.setMaterial(this.sleeveMat);
    const glove = side === 'us' ? 0x6f6450 : 0x2c2e2a;
    this.gloveMat = M.fabric(glove);
    for (const h of this.hands) h.setGlove(this.gloveMat);
  }

  private scanEvents(g: Game, s: Soldier): void {
    const evs = g.events;
    if (!evs) return;
    for (const e of evs) {
      if (this.seen.has(e)) continue;
      this.seen.add(e);
      switch (e.k) {
        case 'shot': if (e.s === s.id) this.evShot = true; break;
        case 'throw': if (e.s === s.id) this.evThrow = e.gadget; break;
        case 'gadget': if (e.s === s.id) this.evGadget = e.gadget; break;
        case 'reload': if (e.s === s.id) this.evReload = e.empty; break;
        case 'land': if (e.s === s.id) this.land(e.hard ? 1 : 0.45); break;
        case 'jump': if (e.s === s.id) { this.landY.v += 0.12; this.landP.v += 0.25; } break;
        default: break;
      }
    }
  }

  private getModel(key: string, w: WeaponState | undefined, gs: GadgetState | undefined): THREE.Group | null {
    let m = this.cache.get(key);
    if (m) { this.cache.delete(key); this.cache.set(key, m); return m; }
    try {
      if (gs) m = buildGadgetModel(gs.id);
      else if (w) m = buildGunModel(w.id, w.att ?? {});
    } catch (err) {
      console.warn('viewmodel: model build failed', key, err);
      m = undefined;
    }
    if (!m) return null;
    m.traverse(o => { o.castShadow = false; o.receiveShadow = false; });
    this.cache.set(key, m);
    while (this.cache.size > 10) {
      const [k0, m0] = this.cache.entries().next().value as [string, THREE.Group];
      if (m0 === this.held?.model) break;
      this.cache.delete(k0);
      m0.parent?.remove(m0);
      disposeModel(m0);
    }
    return m;
  }

  private setHeld(key: string, w: WeaponState | undefined, gs: GadgetState | undefined, s: Soldier): void {
    this.heldKey = key;
    if (this.held) this.pivot.remove(this.held.model);
    this.held = null;
    if (!key) return;
    const model = this.getModel(key, w, gs);
    if (!model) return;
    const ud = model.userData;
    this.pivot.add(model);
    // remember rest transforms of moving parts
    for (const n of ['mag', 'charge', 'slide', 'bolt', 'pump', 'cover', 'warhead', 'paddleL', 'paddleR']) {
      const o = ud[n] as THREE.Object3D | undefined;
      if (o && o !== model && !this.rest.has(o)) this.rest.set(o, { p: o.position.clone(), q: o.quaternion.clone() });
    }
    let loadHi: THREE.Object3D | null = null, loadLo: THREE.Object3D | null = null;
    if (ud.reloadStyle === 'tube' && ud.mag) {
      const port = ud.mag as THREE.Object3D;
      loadHi = port.getObjectByName('loadHi') ?? handAnchor(port, { pos: [-0.006, -0.03, 0.03], f: [0.1, 0.35, -0.93], n: [0.05, 0.95, 0.3], pose: 'pinch' }, 'loadHi');
      loadLo = port.getObjectByName('loadLo') ?? handAnchor(port, { pos: [-0.03, -0.11, 0.07], f: [0.1, 0.35, -0.93], n: [0.05, 0.95, 0.3], pose: 'pinch' }, 'loadLo');
    }
    const hold = (ud.hold as string) ?? 'rifle';
    this.held = {
      key, model, ud, gadget: !!gs, hold: HOLDS[hold] ? hold : 'rifle',
      sightPos: (ud.sightPos as THREE.Vector3) ?? new THREE.Vector3(0, 0.13, 0.05), eye: (ud.eyeDist as number) ?? 0.1, loadHi, loadLo,
    };
    // reset per-item animation state
    this.cyc = null; this.rl.active = false; this.slideT = 1; this.lastMag = w && !gs ? w.mag : -1; this.lastUses = gs ? gs.uses : -1;
    this.useAnim = null;
    if (s.swapT < 0.05) this.raiseT = 1;
  }

  private resetMotion(): void {
    for (const sp of [this.kz, this.ky, this.kx, this.kp, this.kyaw, this.kroll, this.sx, this.sy, this.syaw, this.spitch, this.sroll, this.landY, this.landP]) sp.reset();
    this.cyc = null; this.thr = null; this.useAnim = null; this.rl.active = false; this.rlBlend = 0;
    if (this.fly) { this.fly.obj.visible = false; this.fly = null; }
    this.raiseT = 1;
  }

  private land(k: number): void {
    this.landY.v -= 0.32 * k;
    this.landP.v -= 1.1 * k;
  }

  private kick(w: WeaponState, ud: Record<string, any>, s: Soldier): void {
    const st = w.st;
    const rv = st?.recoilV ?? 0.5, rh = st?.recoilH ?? 0.3;
    const cat = st?.cat ?? 'ar';
    const big = cat === 'sniper' || cat === 'shotgun' ? 1.35 : cat === 'pistol' ? 0.9 : 1;
    const adsP = 1 - 0.62 * this.adsE, adsR = 1 - 0.55 * this.adsE;
    const stance = s.stance === 'prone' ? 0.6 : s.stance === 'crouch' ? 0.85 : 1;
    const pistol = ud.hold === 'pistol';
    this.kz.v += Math.min(1.7, (0.55 + rv * 0.5) * big) * adsP * stance * (pistol ? 0.7 : 1);
    this.ky.v += (0.1 + rv * 0.08) * adsP * stance;
    this.kp.v += Math.min(4.5, (1.3 + rv * 1.5) * big * (pistol ? 1.4 : 1)) * adsR * stance;
    this.kyaw.v += (Math.random() - 0.5) * (0.2 + rh * 1.4) * adsR;
    this.kroll.v += (Math.random() - 0.5) * (0.8 + rh * 1.2) * adsR;
    this.kx.v += (Math.random() - 0.5) * 0.12 * adsP;
    if (ud.slide) this.slideT = 0;
    // casings fly from the port right away for self-loading guns
    if (!ud.cycle && ud.eject) this.eject(ud);
  }

  private gadgetKick(kind: string): void {
    if (kind === 'rocket' || kind === 'aa') { this.kz.v += 1.6; this.kp.v += 2.6; this.kroll.v += (Math.random() - 0.5) * 1.2; }
    else if (kind === 'ugl') { this.kz.v += 1.1; this.kp.v += 3.2; }
  }

  private eject(ud: Record<string, any>): void {
    const ej = ud.eject as THREE.Object3D;
    anchorXf(ej, _v, _q);
    const q = this.pivot.quaternion;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const vel = right.multiplyScalar(1.4 + Math.random() * 0.7).addScaledVector(up, 1.1 + Math.random() * 0.6).addScaledVector(back, 0.3 + Math.random() * 0.3);
    this.casings.spawn(_v, vel, (ud.casing as string) ?? 'rifle');
  }

  private muzzleFlash(w: WeaponState, ud: Record<string, any>): void {
    const sup = !!(w.st?.suppressed ?? ud.suppressed);
    const cat = w.st?.cat ?? 'ar';
    if (sup) { this.flash.fire(0.025, 0, 0.25, 0xff9a50); return; }
    const muzId = w.att?.muzzle ?? '';
    const hider = muzId.includes('flash') ? 0.55 : 1;
    const brake = muzId.includes('brake') || muzId.includes('comp') ? 1.25 : 1;
    const size = cat === 'shotgun' ? 0.17 : cat === 'sniper' ? 0.15 : cat === 'pistol' ? 0.085 : cat === 'smg' ? 0.09 : cat === 'lmg' ? 0.13 : 0.115;
    const len = cat === 'shotgun' ? 0.26 : cat === 'sniper' ? 0.3 : cat === 'pistol' ? 0.12 : cat === 'smg' ? 0.15 : 0.22;
    this.flash.fire(size * hider * brake, len * hider, 2.6 * hider, 0xffb060);
  }

  private torch(s: Soldier, gs: GadgetState, ud: Record<string, any>, dt: number): void {
    const firing = s.ctl.fire && s.anim.fireT > 0 && s.swapT <= 0;
    const tip = ud.tip as THREE.Mesh | undefined;
    const heat = clamp(gs.active / Math.max(0.1, gs.params.heat ?? 6), 0, 1);
    if (tip) {
      const mat = tip.material as THREE.MeshBasicMaterial;
      if (firing) mat.color.setRGB(0.7 + Math.random() * 0.3, 0.85 + Math.random() * 0.15, 1.6);
      else mat.color.setRGB(0.16 + heat * 1.4, 0.2 + heat * 0.4, 0.3 - heat * 0.2);
    }
    if (firing && ud.muzzle) {
      anchorXf(ud.muzzle as THREE.Object3D, _v, _q);
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(_q);
      this.sparks.emit(_v, dir, Math.ceil(60 * dt) + 1, 1.6, new THREE.Color(1.6, 1.2, 0.6));
      this.flash.glow(1.2 + Math.random() * 1.4, 0x9fc8ff);
      this.kx.v += (Math.random() - 0.5) * 0.05; this.ky.v += (Math.random() - 0.5) * 0.05;
    }
  }

  private startThrow(id: string, s: Soldier): void {
    const right = !!this.held?.gadget && this.held.hold === 'throw';
    let model: THREE.Group | null = null;
    if (!right) {
      const gid = id || 'frag';
      model = this.throwModels.get(gid) ?? null;
      if (!model) {
        try { model = buildGadgetModel(THROWN.has(gid) ? gid : 'frag'); this.throwModels.set(gid, model); } catch { model = null; }
      }
      if (model) {
        model.parent?.remove(model);
        model.position.set(0, 0, 0); model.quaternion.identity(); model.scale.set(1, 1, 1); model.visible = true;
        this.hands[1].holdPoint.add(model);
      }
    }
    void s;
    this.thr = { t: 0, dur: 0.6, id, model, released: false, right };
  }

  private endThrow(): void {
    if (this.thr?.model && !this.thr.released) this.thr.model.parent?.remove(this.thr.model);
    this.thr = null;
  }

  private releaseThrow(): void {
    const th = this.thr;
    if (!th || th.released) return;
    th.released = true;
    const obj = th.right ? null : th.model;
    if (th.right && this.held) { this.held.model.visible = false; }
    if (!obj) return;
    this.rig.attach(obj);
    this.fly = { obj, vel: new THREE.Vector3(0.25, 1.9, -7.5), spin: new THREE.Vector3(9, 4, 2), t: 0 };
  }

  private updateFly(dt: number): void {
    const f = this.fly!;
    f.t += dt;
    f.vel.y -= 9.8 * dt;
    f.obj.position.addScaledVector(f.vel, dt);
    f.obj.rotation.x += f.spin.x * dt; f.obj.rotation.y += f.spin.y * dt; f.obj.rotation.z += f.spin.z * dt;
    if (f.t > 0.45) { f.obj.parent?.remove(f.obj); f.obj.visible = true; this.fly = null; }
  }

  /** moving parts: mag, charging handle, slide, bolt, pump, feed cover, warhead, rotors, leds */
  private animateParts(s: Soldier, w: WeaponState | undefined, gs: GadgetState | undefined, ud: Record<string, any>, reloading: boolean, rp: number, cp: number, dt: number, shot: boolean, useK: number): void {
    const restore = (o: THREE.Object3D | null | undefined): Rest | null => {
      if (!o) return null;
      const r = this.rest.get(o);
      if (r) { o.position.copy(r.p); o.quaternion.copy(r.q); }
      return r ?? null;
    };
    const mag = ud.mag as THREE.Object3D | undefined;
    const isMag = !!mag && mag !== this.held?.model && !!this.rest.get(mag);
    if (isMag) restore(mag);
    const charge = ud.charge as THREE.Object3D | null; restore(charge);
    const slide = ud.slide as THREE.Object3D | null; restore(slide);
    const bolt = ud.bolt as THREE.Object3D | null; restore(bolt);
    const pump = ud.pump as THREE.Object3D | null; restore(pump);
    const cover = ud.cover as THREE.Object3D | null; restore(cover);
    if (this.held) this.held.model.visible = !(this.thr?.right && this.thr.released);
    const E = this.rl.empty;
    const style = (ud.reloadStyle as string) ?? 'mag';

    if (reloading && isMag && mag) {
      let out = 0;
      if (style === 'tube') out = 0;
      else if (!E || style === 'top' || style === 'belt') out = seg(rp, 0.28, 0.44) * (1 - seg(rp, 0.55, 0.72));
      else { const d = clamp((rp - 0.1) / 0.18, 0, 1); out = rp < 0.5 ? d * d : 1 - seg(rp, 0.5, 0.68); }
      if (out > 0) {
        if (style === 'top') { mag.position.x -= 0.12 * out; mag.position.y += 0.1 * out; mag.position.z += 0.05 * out; mag.rotateZ(0.8 * out); }
        else if (style === 'belt') { mag.position.x -= 0.06 * out; mag.position.y -= 0.26 * out; mag.position.z += 0.02 * out; mag.rotateZ(0.3 * out); }
        else if (style === 'pistol') { mag.translateY(-0.24 * out); mag.position.z += 0.03 * out; }
        else { mag.position.x -= 0.015 * out; mag.position.y -= 0.3 * out; mag.position.z += 0.07 * out; mag.rotateX(0.6 * out); mag.rotateZ(0.2 * out); }
      }
      mag.visible = out < 0.97;
      // seating jolt
      const seatP = style === 'pistol' ? 0.66 : E && style === 'mag' ? 0.68 : 0.72;
      if (!this.rl.seated && rp >= seatP && style !== 'tube') { this.rl.seated = true; this.ky.v += 0.18; this.kp.v += 0.5; }
    } else if (mag) mag.visible = true;
    if (cover && reloading) {
      const open = seg(rp, 0.1, 0.22) * (1 - seg(rp, 0.74, 0.84));
      cover.rotateX(-1.15 * open);
    }
    // charging handle / slide release on empty reloads
    let pull = 0;
    if (reloading && E) {
      if (style === 'pistol') pull = rp < 0.8 ? 1 : 1 - seg(rp, 0.8, 0.84);
      else pull = rp < 0.84 ? seg(rp, 0.76, 0.81) : 1 - seg(rp, 0.84, 0.86);
      if (pull > 0 && rp > 0.84 && !this.rl.charged) { this.rl.charged = true; this.kz.v += 0.25; this.kp.v += 0.4; }
    }
    if (charge && style !== 'pistol' && !ud.boltRelease) charge.position.z += 0.062 * pull;
    else if (pull > 0 && ud.boltRelease && rp > 0.8 && !this.rl.charged) { this.rl.charged = true; this.kz.v += 0.2; this.ky.v += 0.1; }
    // pistol slide: recoil reciprocation, lock back on empty
    if (slide) {
      this.slideT = Math.min(1, this.slideT + dt / 0.07);
      const recoil = this.slideT < 1 ? Math.sin(Math.PI * this.slideT) : 0;
      const locked = w && w.mag <= 0 && !reloading ? 1 : reloading && E ? (rp < 0.8 ? 1 : 1 - seg(rp, 0.8, 0.84)) : 0;
      slide.position.z += 0.024 * Math.max(recoil, locked);
    }
    // bolt cycle (after shot, or at the end of an empty bolt-gun reload)
    let bc = cp;
    if (reloading && E && bolt && !charge) bc = clamp((rp - 0.72) / 0.26, 0, 1);
    if (bolt && bc >= 0 && (cp >= 0 || (reloading && E && rp > 0.72))) {
      const lift = seg(bc, 0.14, 0.28) * (1 - seg(bc, 0.68, 0.8));
      const back = seg(bc, 0.28, 0.48) * (1 - seg(bc, 0.5, 0.68));
      bolt.rotateZ(1.05 * lift);
      bolt.position.z += 0.085 * back;
      if (this.cyc && !this.cyc.ejected && bc > 0.44) { this.cyc.ejected = true; if (ud.eject) this.eject(ud); }
    }
    if (pump) {
      let pb = 0;
      if (cp >= 0 && this.cyc?.kind === 'pump') pb = seg(cp, 0.0, 0.42) * (1 - seg(cp, 0.5, 0.9));
      if (reloading && E) pb = Math.max(pb, seg(rp, 0.86, 0.9) * (1 - seg(rp, 0.92, 0.98)));
      pump.position.z += 0.075 * pb;
      if (this.cyc && !this.cyc.ejected && cp > 0.35) { this.cyc.ejected = true; if (ud.eject) this.eject(ud); }
    }
    // gadget bits
    const wh = ud.warhead as THREE.Object3D | undefined;
    if (wh && gs) wh.visible = gs.uses > 0 && this.launcherLow < 0.5;
    if (gs && gs.kind === 'aa' && ud.lockLight) {
      const mat = (ud.lockLight as THREE.Mesh).material as THREE.MeshBasicMaterial;
      if (gs.active >= 1) mat.color.setRGB(0.2, 1.6, 0.3);
      else if (gs.active > 0) mat.color.setRGB(1.6, 0.8 * (Math.sin(this.t * 30) > 0 ? 1 : 0.2), 0.1);
      else mat.color.setRGB(0.5, 0.06, 0.04);
    }
    const rotors = ud.rotors as THREE.Object3D[] | undefined;
    if (rotors) for (let i = 0; i < rotors.length; i++) rotors[i].rotation.y += dt * (i % 2 ? -1 : 1) * (35 + useK * 40);
    const led = ud.led as THREE.Object3D | undefined;
    if (led) led.visible = (this.t * 1.6) % 1 < 0.35;
    void shot; void s;
  }

  /** place hands from anchors (+ reload / cycle / throw overlays) and solve the arms */
  private updateHands(s: Soldier, gs: GadgetState | undefined, ud: Record<string, any>, reloading: boolean, rp: number, cp: number, dt: number): void {
    const [hr, hl] = this.hands;
    const { pR, qR, pL, qL, tp, tq, tgtL } = this.hp;
    const tgtR = this.tmpPose;
    const blendPose = (dst: number[], name: string, k: number) => { const v = poseOf(name); for (let i = 0; i < POSE_LEN; i++) dst[i] += (v[i] - dst[i]) * k; };
    const off = (left: boolean, p: THREE.Vector3, q: THREE.Quaternion) => {
      if (left) { p.set(-0.17, -0.42, -0.18); handQuat([0.3, 0.3, -0.9], [0.3, 0.9, 0.2], q); }
      else { p.set(0.19, -0.44, -0.12); handQuat([-0.3, 0.3, -0.9], [-0.3, 0.9, 0.2], q); }
    };
    const toward = (p: THREE.Vector3, q: THREE.Quaternion, o: THREE.Object3D | null | undefined, k: number) => {
      if (!o || k <= 0) return;
      anchorXf(o, tp, tq);
      p.lerp(tp, k); q.slerp(tq, k);
    };
    // right hand
    const ra = ud.rightHand as THREE.Object3D | null | undefined;
    if (ra) { anchorXf(ra, pR, qR); poseVecInto(tgtR, (ra.userData.pose as string) ?? 'grip'); }
    else { off(false, pR, qR); poseVecInto(tgtR, 'relax'); }
    // left hand
    const la = ud.leftHand as THREE.Object3D | null | undefined;
    if (la) { anchorXf(la, pL, qL); poseVecInto(tgtL, (la.userData.pose as string) ?? 'wrap'); }
    else { off(true, pL, qL); poseVecInto(tgtL, 'relax'); }

    // reload overlays (left hand)
    if (reloading) {
      const E = this.rl.empty, style = (ud.reloadStyle as string) ?? 'mag';
      let wOff = 0, wMag = 0, wCh = 0;
      if (style === 'tube') {
        const n = this.rl.shells;
        const a = 0.14, b = 0.84;
        wOff = seg(rp, 0.03, 0.12) * (1 - seg(rp, a - 0.02, a));
        if (rp >= a - 0.02 && rp <= b + 0.04 && this.held?.loadHi && this.held.loadLo) {
          const u = clamp((rp - a) / (b - a), 0, 0.9999) * n;
          const f = u - Math.floor(u);
          const push = f < 0.55 ? sstep(f / 0.55) : 1 - sstep((f - 0.55) / 0.45);
          const env = seg(rp, a - 0.02, a + 0.02) * (1 - seg(rp, b, b + 0.04));
          anchorXf(this.held.loadLo, tp, tq);
          const lp = this.hp.lp.copy(tp), lq = this.hp.lq.copy(tq);
          anchorXf(this.held.loadHi, tp, tq);
          lp.lerp(tp, push); lq.slerp(tq, push);
          pL.lerp(lp, env); qL.slerp(lq, env);
          blendPose(tgtL, 'pinch', env);
          this.shellMesh.visible = env > 0.5 && push < 0.92;
        } else this.shellMesh.visible = false;
        if (E && ud.pump) { /* pump rack: left anchor is in the pump group so the hand follows */ }
      } else {
        this.shellMesh.visible = false;
        if (!E || style === 'top' || style === 'belt') {
          wMag = seg(rp, 0.12, 0.28) * (1 - seg(rp, 0.72, 0.86));
          if (E) wCh = seg(rp, 0.72, 0.78) * (1 - seg(rp, 0.88, 0.95));
        } else {
          wOff = seg(rp, 0.08, 0.26) * (1 - seg(rp, 0.36, 0.48));
          wMag = seg(rp, 0.36, 0.48) * (1 - seg(rp, 0.68, 0.76));
          wCh = seg(rp, 0.68, 0.76) * (1 - seg(rp, 0.88, 0.95));
        }
        if (wOff > 0) { off(true, tp, tq); pL.lerp(tp, wOff); qL.slerp(tq, wOff); blendPose(tgtL, 'relax', wOff); }
        if (wMag > 0 && ud.magHand) { toward(pL, qL, ud.magHand, wMag); blendPose(tgtL, 'wrap', wMag); }
        const ch = ud.chargeHand as THREE.Object3D | null;
        if (style === 'pistol') wCh = 0;
        if (wCh > 0 && ch) { toward(pL, qL, ch, wCh); blendPose(tgtL, (ch.userData.pose as string) ?? 'hook', wCh); }
      }
    } else this.shellMesh.visible = false;

    // bolt cycle: right hand works the bolt
    const bh = ud.boltHand as THREE.Object3D | null;
    if (bh) {
      let bc = cp;
      if (reloading && this.rl.empty && !ud.charge) bc = clamp((rp - 0.72) / 0.26, 0, 1);
      if (bc >= 0 && (cp >= 0 || (reloading && this.rl.empty && rp > 0.72))) {
        const k = seg(bc, 0.0, 0.14) * (1 - seg(bc, 0.8, 0.98));
        toward(pR, qR, bh, k);
        blendPose(tgtR, 'pinch', k);
      }
    }

    // quick throw (left hand) or held-throwable throw (right hand)
    if (this.thr) {
      const t = clamp(this.thr.t / this.thr.dur, 0, 1);
      const right = this.thr.right;
      if (t > 0.34 && !this.thr.released) this.releaseThrow();
      const K = THROW_KEYS;
      let i = 0; while (i < K.length - 2 && t > K[i + 1].t) i++;
      const a = K[i], b = K[i + 1];
      const u = sstep((t - a.t) / (b.t - a.t));
      const mx = right ? -1 : 1;
      tp.set(a.p[0] * mx, a.p[1], a.p[2]).lerp(_v.set(b.p[0] * mx, b.p[1], b.p[2]), u);
      handQuat([a.f[0] * mx, a.f[1], a.f[2]], [a.n[0] * mx, a.n[1], a.n[2]], tq);
      handQuat([b.f[0] * mx, b.f[1], b.f[2]], [b.n[0] * mx, b.n[1], b.n[2]], _q);
      tq.slerp(_q, u);
      const env = seg(t, 0.0, 0.12) * (1 - seg(t, 0.78, 1.0));
      if (right) { pR.lerp(tp, env); qR.slerp(tq, env); blendPose(tgtR, t < 0.36 ? 'grenade' : 'flat', env); }
      else { pL.lerp(tp, env); qL.slerp(tq, env); blendPose(tgtL, t < 0.36 ? 'grenade' : 'flat', env); }
    }

    hr.root.position.copy(pR); hr.root.quaternion.copy(qR);
    hl.root.position.copy(pL); hl.root.quaternion.copy(qL);
    hr.pose(tgtR, 22, dt);
    hl.pose(tgtL, 22, dt);
    hr.root.updateMatrixWorld(true); hl.root.updateMatrixWorld(true);

    // arms
    const pistol = this.held?.hold === 'pistol';
    const bob = Math.sin(this.phase) * 0.006 * this.bobAmp;
    const shR = _v.set(pistol ? 0.13 - 0.03 * this.adsE : 0.17 - 0.03 * this.adsE, -0.26 + bob, 0.1);
    const shL = _v2.set(-0.11 + 0.02 * this.adsE, -0.37 - bob, -0.08);
    const wristR = hr.root.localToWorld(_v3.copy(Hand.WRIST));
    this.arms[0].update(shR, wristR, this.poleR);
    const wristL = hl.root.localToWorld(this.wl.copy(Hand.WRIST));
    this.arms[1].update(shL, wristL, this.poleL);
    void s; void gs;
  }

  private lights(s: Soldier): void {
    const qc = _q.setFromEuler(_e.set(s.pitch, s.yaw, 0, 'YXZ'));
    const inv = _q2.copy(qc).invert();
    this.sun.position.copy(SUN_WORLD).applyQuaternion(inv).multiplyScalar(4);
    this.hemi.position.set(0, 1, 0).applyQuaternion(inv);
    this.scene.environmentRotation.set(-s.pitch, -s.yaw, 0, 'YXZ');
  }

  /** faint sky/ground gradient environment for metal reflections (built on first render) */
  private buildEnv(renderer: THREE.WebGLRenderer): void {
    this.envTried = true;
    try {
      const pm = new THREE.PMREMGenerator(renderer);
      const es = new THREE.Scene();
      const geo = new THREE.SphereGeometry(5, 32, 16);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const cols = new Float32Array(pos.count * 3);
      const sky = new THREE.Color(0x8ea6bf), hor = new THREE.Color(0xe4e9ec), gnd = new THREE.Color(0x585752);
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) / 5;
        if (y >= 0) c.copy(hor).lerp(sky, Math.pow(y, 0.6)); else c.copy(hor).lerp(gnd, Math.min(1, -y * 3));
        cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
      es.add(new THREE.Mesh(geo, mat));
      const sunGeo = new THREE.SphereGeometry(0.35, 12, 8);
      const sunMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8.4, 7.6) });
      const sunM = new THREE.Mesh(sunGeo, sunMat);
      sunM.position.copy(SUN_WORLD).multiplyScalar(4.4);
      es.add(sunM);
      this.envRT = pm.fromScene(es, 0.03);
      this.scene.environment = this.envRT.texture;
      (this.scene as THREE.Scene & { environmentIntensity: number }).environmentIntensity = 0.6;
      geo.dispose(); mat.dispose(); sunGeo.dispose(); sunMat.dispose(); pm.dispose();
    } catch (err) {
      console.warn('viewmodel: environment map unavailable', err);
    }
  }
}

function poseVecInto(dst: number[], name: string): void { const v = poseOf(name); for (let i = 0; i < POSE_LEN; i++) dst[i] = v[i]; }

/** quick-throw keyframes for the left hand in camera space (mirrored on x for the right hand) */
const THROW_KEYS: { t: number; p: V3; f: V3; n: V3 }[] = [
  { t: 0.0, p: [-0.12, -0.3, -0.3], f: [0.2, 0.6, -0.75], n: [0.4, 0.7, 0.55] },
  { t: 0.22, p: [-0.16, -0.04, -0.15], f: [0.1, 0.9, 0.3], n: [0.2, 0.1, -1] },
  { t: 0.4, p: [-0.06, 0.02, -0.46], f: [0.0, 0.5, -0.85], n: [0.0, -0.85, -0.5] },
  { t: 0.7, p: [0.02, -0.3, -0.38], f: [0.0, -0.3, -0.95], n: [0.0, -0.95, 0.3] },
  { t: 1.0, p: [-0.12, -0.36, -0.3], f: [0.2, 0.6, -0.75], n: [0.4, 0.7, 0.55] },
];
