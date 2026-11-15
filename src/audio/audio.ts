// 소리: 전부 Web Audio 합성. 한 발짜리 소리는 처음 쓸 때(또는 한가할 때 미리) 버퍼로 그려 캐시하고,
// 재생은 BufferSource → Gain → (Panner) 세 노드만 쓴다. 동시 목소리 상한 24, 우선순위 = 들리는 크기.
// 그래프: 버스(sfx·amb·ui) → mix → duck(저역 통과, 가까운 폭발 때 먹먹하게) → master(음량) → 압축기 → 부드러운 제한 → 출력
//         목소리 일부 → 잔향(합성 임펄스 컨볼버) → mix.  이명은 duck 뒤로 바로 master.
import type { Game, GameEvent, GunSound, Soldier, Vec3, Vehicle, VehicleType } from '../types';
import { dirFrom } from '../math';
import { GADGETS, VEHICLES, VWEAPONS, WEAPONS } from '../defs';
import type { Buf } from './dsp';
import * as S from './sounds';

const MAX_VOICES = 24;
const MAX_OWN_SHOTS = 4;
const SOUND_SPEED = 343;
const MAX_ENGINES = 5;
const MAX_HISS = 3;

type BusId = 'sfx' | 'ui' | 'amb';
interface PlayOpts { pos?: Vec3 | null; gain: number; rate?: number; delay?: number; pri?: number; send?: number; bus?: BusId }
interface Voice { src: AudioBufferSourceNode; out: GainNode; t0: number; end: number; pri: number }
interface Engine { type: VehicleType; a: AudioBufferSourceNode; b: AudioBufferSourceNode; ga: GainNode; gb: GainNode; lp: BiquadFilterNode; pan: PannerNode; spool: number; seen: number }
interface Hiss { src: AudioBufferSourceNode; g: GainNode; pan: PannerNode; seen: number }
interface Wind { a: AudioBufferSourceNode; b: AudioBufferSourceNode; lp: BiquadFilterNode; bp: BiquadFilterNode; ga: GainNode; gb: GainNode }

const DEFAULT_SOUND: GunSound = { kind: 'rifle', pitch: 1, punch: 1 };
const LOUD: Record<S.GunKind, number> = { rifle: 1, carbine: 0.95, smg: 0.8, lmg: 1.05, dmr: 1.1, sniper: 1.25, shotgun: 1.15, pistol: 0.72 };
const GUN_VARS: Record<S.GunDist, number> = { own: 2, near: 2, mid: 1, far: 1 };
const GUN_SR: Record<S.GunDist, number> = { own: 48000, near: 24000, mid: 16000, far: 16000 };
const SPACING: Record<S.GunKind, number> = { rifle: 0.085, carbine: 0.075, lmg: 0.07, smg: 0.06, dmr: 0.4, sniper: 1.6, shotgun: 0.9, pistol: 0.3 };

const d3 = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const att = (d: number, ref: number): number => ref / Math.max(ref, d);
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
const jit = (k: number): number => 1 + (Math.random() - 0.5) * k;

function strSeed(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 9973;
}

function impactSurf(m: string): S.ImpactSurf {
  switch (m) {
    case 'concrete': case 'brick': case 'rock': case 'asphalt': return 'hard';
    case 'metal': case 'vehicle': return 'metal';
    case 'wood': return 'wood';
    case 'glass': return 'glass';
    case 'water': return 'water';
    case 'flesh': case 'body': return 'flesh';
    default: return 'soft';
  }
}
function stepSurf(m: string): S.StepSurf {
  switch (m) {
    case 'snow': return 'snow';
    case 'metal': return 'metal';
    case 'wood': return 'wood';
    case 'water': return 'water';
    case 'concrete': case 'brick': case 'rock': case 'glass': case 'asphalt': return 'hard';
    default: return 'dirt';
  }
}
function breakSurf(m: string): S.BreakSurf {
  if (m === 'glass') return 'glass';
  if (m === 'wood' || m === 'foliage') return 'wood';
  if (m === 'metal') return 'metal';
  return 'hard';
}

function setPos(p: PannerNode, v: Vec3): void {
  if (p.positionX) { p.positionX.value = v.x; p.positionY.value = v.y; p.positionZ.value = v.z; }
  else p.setPosition(v.x, v.y, v.z);
}

export class AudioSys {
  private ctx: AudioContext | null = null;
  private mix: GainNode | null = null;
  private duck: BiquadFilterNode | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private ambBus: GainNode | null = null;
  private uiBus: GainNode | null = null;
  private revIn: GainNode | null = null;
  private vol = 0.8;
  private disposed = false;
  private cache = new Map<string, AudioBuffer>();
  private lowRateOk = true;
  private voices: Voice[] = [];
  private ownShots: Voice[] = [];
  private reloadVoices: Voice[] = [];
  private L: Vec3 = { x: 0, y: 0, z: 0 };
  private engines = new Map<number, Engine>();
  private hiss = new Map<number, Hiss>();
  private wind: Wind | null = null;
  private frameNo = 0;
  private gust = 0.5; private gustTarget = 0.5; private gustT = 0;
  /** 교전 강도 (사격·폭발이 올리고 서서히 식음) */
  private action = 0;
  private ambT = 3;
  private warnT = 0;
  private lastShotT: number[] = [];
  private throttle = new Map<string, number>();
  private hitLevel = 0; private hitT = -1;
  private tin: { osc: OscillatorNode; g: GainNode; end: number } | null = null;
  private lastUpdate = 0;
  private loopsLive = false;
  private watchdog = 0;
  private resumeOnShow = false;
  private prewarmQ: (() => void)[] = [];
  private prewarmTimer = 0;
  private ownA = ''; private ownB = ''; private ownSupA = false; private ownSupB = false;
  private engD: number[] = [];
  private engV: Vehicle[] = [];
  private gestureOff: (() => void) | null = null;
  private visOff: (() => void) | null = null;

  constructor() {
    // 첫 손짓에서 스스로도 잠금 해제 (통합 쪽 unlock 과 겹쳐도 괜찮다)
    if (typeof window !== 'undefined') {
      const h = () => { this.unlock(); if (this.ctx && this.ctx.state === 'running') this.removeGesture(); };
      const opts: AddEventListenerOptions = { capture: true, passive: true };
      window.addEventListener('pointerdown', h, opts);
      window.addEventListener('touchend', h, opts);
      window.addEventListener('keydown', h, opts);
      this.gestureOff = () => {
        window.removeEventListener('pointerdown', h, opts);
        window.removeEventListener('touchend', h, opts);
        window.removeEventListener('keydown', h, opts);
      };
      const vis = () => {
        const c = this.ctx;
        if (!c) return;
        if (document.hidden) { if (c.state === 'running') { this.resumeOnShow = true; c.suspend().catch(() => undefined); } }
        else if (this.resumeOnShow) { this.resumeOnShow = false; c.resume().catch(() => undefined); }
      };
      document.addEventListener('visibilitychange', vis);
      this.visOff = () => document.removeEventListener('visibilitychange', vis);
    }
  }

  unlock(): void {
    if (this.disposed) return;
    if (!this.ctx) this.create();
    const c = this.ctx;
    if (c && c.state !== 'running' && c.state !== 'closed' && !document.hidden) c.resume().catch(() => undefined);
  }

  setVolume(v: number): void {
    let x = Number.isFinite(v) ? v : 0.8;
    if (x > 1.5) x /= 100; // 0..100 으로 줘도 받는다
    this.vol = clamp(x, 0, 1.5);
    const m = this.master, c = this.ctx;
    if (m && c) m.gain.setTargetAtTime(this.vol, c.currentTime, 0.03);
  }

  listener(pos: Vec3, yaw: number, pitch: number): void {
    this.L.x = pos.x; this.L.y = pos.y; this.L.z = pos.z;
    const c = this.ctx;
    if (!c) return;
    const l = c.listener, f = dirFrom(yaw, pitch);
    if (l.positionX) {
      l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
      l.forwardX.value = f.x; l.forwardY.value = f.y; l.forwardZ.value = f.z;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(f.x, f.y, f.z, 0, 1, 0);
    }
  }

  ui(kind: 'click' | 'hover' | 'equip' | 'deploy'): void {
    if (kind !== 'hover') this.unlock();
    const gain = kind === 'hover' ? 0.18 : kind === 'click' ? 0.35 : 0.5;
    const c = this.ctx;
    if (!c) return;
    if (c.state === 'running') this.cue(kind, gain, 0, 20);
    else if (kind !== 'hover' && c.state === 'suspended' && !document.hidden) c.resume().then(() => this.cue(kind, gain, 0, 20)).catch(() => undefined);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.removeGesture();
    this.visOff?.(); this.visOff = null;
    clearInterval(this.watchdog);
    clearTimeout(this.prewarmTimer);
    this.prewarmQ.length = 0;
    this.engines.clear(); this.hiss.clear(); this.wind = null;
    this.voices.length = 0; this.ownShots.length = 0; this.reloadVoices.length = 0;
    this.cache.clear();
    const c = this.ctx;
    this.ctx = null;
    if (c && c.state !== 'closed') c.close().catch(() => undefined);
  }

  // ───────────────────────── 사건 ─────────────────────────

  event(e: GameEvent, g: Game, viewer: number): void {
    // 강도는 소리가 꺼져 있어도 센다
    if (e.k === 'shot') this.action += 0.02;
    else if (e.k === 'vshot') this.action += 0.05;
    else if (e.k === 'explosion') this.action += 0.35;
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const now = c.currentTime;
    const me: Soldier | undefined = viewer >= 0 ? g.soldiers[viewer] : undefined;
    const myTeam = me ? me.team : 0;
    const myVeh = me && me.vehicle >= 0 ? me.vehicle : -1;
    switch (e.k) {
      case 'shot': this.onShot(e, g, viewer, now); break;
      case 'vshot': this.onVShot(e, myVeh === e.v, now); break;
      case 'impact': {
        const d = d3(e.pos, this.L);
        if (d > 35 || !this.allow('imp', 0.025)) break;
        const surf = impactSurf(e.mat);
        this.sfx(`imp_${surf}`, 3, 32000, (sr, v) => S.impact(sr, surf, v), {
          pos: e.pos, gain: 0.42 * att(d, 3) * (e.big ? 1.6 : 1), rate: (e.big ? 0.8 : 1) * jit(0.12), pri: 0.3 * att(d, 3), send: 0.08,
        });
        if ((surf === 'hard' || surf === 'metal') && d < 25 && Math.random() < 0.1 && this.allow('rico', 0.15)) {
          this.sfx('rico', 2, 32000, (sr, v) => S.ricochet(sr, v), { pos: e.pos, gain: 0.28 * att(d, 4), rate: jit(0.2), pri: 0.2, send: 0.12 });
        }
        break;
      }
      case 'hit': {
        if (e.by === viewer && e.target !== viewer) {
          const lvl = e.kill ? 3 : e.head ? 2 : 1;
          if (now - this.hitT < 0.035 && lvl <= this.hitLevel) break;
          this.hitT = now; this.hitLevel = lvl;
          if (lvl === 3) this.cue('kill', 0.6, 0, 9);
          else if (lvl === 2) this.cue('head', 0.42, 0, 8);
          else this.cue('tick', 0.36, 0, 7);
        }
        if (e.target === viewer) {
          if (this.allow('hurt', 0.08)) this.sfx('hurt', 2, 32000, (sr, v) => S.hurt(sr, v), { gain: 0.5 * clamp(e.dmg / 35, 0.45, 1.2), pri: 8 });
          if (this.allow('breath', 1.6) && Math.random() < 0.7) {
            this.sfx('breath', 2, 22050, (sr, v) => S.breath(sr, v), { gain: 0.28, delay: 0.14, pri: 6 });
          }
          if (e.dmg >= 30) this.duckTo(0.35, 0.5);
        } else if (e.by !== viewer) {
          const d = d3(e.pos, this.L);
          if (d < 18 && this.allow('flesh', 0.05)) this.sfx('imp_flesh', 3, 32000, (sr, v) => S.impact(sr, 'flesh', v), { pos: e.pos, gain: 0.35 * att(d, 2.5), rate: jit(0.15), pri: 0.2 });
        }
        break;
      }
      case 'vhit': {
        if (e.by === viewer) {
          if (e.kill) this.cue('kill', 0.6, 0, 9);
          else if (this.allow('armorTick', 0.06)) this.cue('armor', 0.4, 0, 7);
        }
        if (myVeh === e.v) {
          this.sfx('break_metal', 2, 32000, (sr, v) => S.breakSound(sr, 'metal', v), { gain: clamp(e.dmg / 120, 0.35, 0.9), rate: 0.75 * jit(0.1), pri: 7 });
        } else {
          const d = d3(e.pos, this.L);
          if (d < 60 && this.allow('vhitN', 0.04)) this.sfx('imp_metal', 3, 32000, (sr, v) => S.impact(sr, 'metal', v), { pos: e.pos, gain: 0.5 * att(d, 4), rate: 0.7 * jit(0.1), pri: 0.3 * att(d, 4), send: 0.1 });
        }
        break;
      }
      case 'explosion': this.onExplosion(e); break;
      case 'down':
        if (e.s === viewer) this.duckTo(0.85, 1.6);
        break;
      case 'revive':
        if (e.s === viewer || e.by === viewer) this.cue('revive', 0.4, 0, 6);
        break;
      case 'boxBroken': {
        const d = d3(e.pos, this.L);
        if (d > 70 || !this.allow('brk', 0.05)) break;
        const surf = breakSurf(e.mat);
        this.sfx(`break_${surf}`, 2, 32000, (sr, v) => S.breakSound(sr, surf, v), { pos: e.pos, gain: 0.6 * att(d, 6), rate: jit(0.15), pri: 0.5 * att(d, 6), send: 0.2 });
        break;
      }
      case 'collapse': {
        const d = d3(e.pos, this.L);
        this.sfx('collapse', 2, 22050, (sr, v) => S.collapse(sr, v), {
          pos: e.pos, gain: 1.1 * att(d, 25), delay: d > 40 ? Math.min(1.5, d / SOUND_SPEED) : 0, rate: jit(0.1), pri: 2 * att(d, 25), send: 0.4,
        });
        if (d < 30) this.duckTo(0.4, 0.8);
        break;
      }
      case 'flag': {
        if (e.what === 'captured') this.cue(e.team === myTeam ? 'flagGood' : 'flagBad', 0.45, 0, 6);
        else if (e.what === 'neutralized') this.cue(e.team === myTeam ? 'neutralGood' : 'neutralBad', 0.4, 0, 5);
        else if (e.what === 'losing' && e.team === myTeam && this.allow('losing', 4)) this.cue('losing', 0.35, 0, 5);
        break;
      }
      case 'score':
        if (e.s === viewer && this.allow('score', 0.08)) this.cue('score', 0.16, 0.05, 3);
        break;
      case 'over': this.cue(e.winner === myTeam ? 'win' : 'lose', 0.6, 0, 20); break;
      case 'venter': case 'vexit': {
        if (e.s === viewer) this.act('hatch', { gain: 0.45, pri: 5 });
        else {
          const v = g.vehicles[e.v];
          const d = v ? d3(v.pos, this.L) : 1e9;
          if (d < 25) this.act('hatch', { pos: v.pos, gain: 0.4 * att(d, 3), pri: 0.2 });
        }
        break;
      }
      case 'reload': if (e.s === viewer && me) this.reloadSeq(me, e.empty); break;
      case 'dry':
        if (e.s === viewer && this.allow('dry', 0.12)) this.handle('dry', 0, 0.4, 5);
        break;
      case 'swap':
        if (e.s === viewer) {
          this.stopReload();
          this.sfx('cloth', 3, 22050, (sr, v) => S.cloth(sr, v), { gain: 0.22, pri: 4 });
          this.handle('slide', 0.18, 0.25, 4);
        }
        break;
      case 'throw': {
        const s = g.soldiers[e.s];
        if (!s) break;
        const pin = GADGETS[e.gadget]?.slot === 'throwable';
        if (e.s === viewer) {
          if (pin) this.act('pin', { gain: 0.3, pri: 5 });
          this.act('throw', { gain: 0.42, delay: pin ? 0.12 : 0, pri: 5 });
        } else {
          const d = d3(s.pos, this.L);
          if (d < 22) this.act('throw', { pos: s.pos, gain: 0.35 * att(d, 3), pri: 0.15 });
        }
        break;
      }
      case 'gadget': this.onGadget(e, viewer); break;
      case 'spot': if (e.by === viewer && this.allow('spot', 0.2)) this.cue('spot', 0.3, 0, 5); break;
      case 'step': {
        const surf = stepSurf(e.mat);
        const name = `step_${surf}`, mk = (sr: number, v: number) => S.footstep(sr, surf, v);
        if (e.s === viewer) { this.sfx(name, 3, 32000, mk, { gain: e.sprint ? 0.2 : 0.14, rate: jit(0.1), pri: 1 }); break; }
        const d = d3(e.pos, this.L);
        if (d > 30) break;
        const gn = (e.sprint ? 0.55 : 0.38) * att(d, 2.5);
        this.sfx(name, 3, 32000, mk, { pos: e.pos, gain: gn, rate: jit(0.12), pri: gn * 0.8 });
        break;
      }
      case 'jump':
        if (e.s === viewer) this.sfx('cloth', 3, 22050, (sr, v) => S.cloth(sr, v), { gain: 0.18, pri: 2 });
        break;
      case 'land': {
        const s = g.soldiers[e.s];
        const k = e.hard ? 'landH' : 'land';
        const mk = (sr: number, v: number) => S.land(sr, v, e.hard);
        if (e.s === viewer) this.sfx(k, 2, 22050, mk, { gain: e.hard ? 0.5 : 0.3, pri: 3 });
        else if (s) { const d = d3(s.pos, this.L); if (d < 16) this.sfx(k, 2, 22050, mk, { pos: s.pos, gain: 0.35 * att(d, 2.5), pri: 0.15 }); }
        break;
      }
      case 'heal': case 'resupply':
        if (e.s === viewer && this.allow('heal', 1.2)) this.cue('heal', 0.18, 0, 3);
        break;
      case 'lock':
        if (e.by === viewer) {
          if (e.done) { if (this.allow('lockDone', 0.4)) this.cue('lockDone', 0.35, 0, 6); }
          else if (this.allow('lockBeep', 0.12)) this.cue('lockBeep', 0.3, 0, 5);
        }
        break;
      case 'counter': {
        const v = g.vehicles[e.v];
        if (!v) break;
        const kind: S.ActKind = VEHICLES[v.type]?.counter === 'flare' ? 'flares' : 'smokeLaunch';
        if (myVeh === e.v) this.act(kind, { gain: 0.55, pri: 6 });
        else { const d = d3(v.pos, this.L); if (d < 150) this.act(kind, { pos: v.pos, gain: 0.6 * att(d, 8), delay: d / SOUND_SPEED, pri: 0.4 * att(d, 8), send: 0.2 }); }
        break;
      }
      default: break;
    }
  }

  // ───────────────────────── 매 프레임 ─────────────────────────

  update(g: Game, dt: number, viewer: number): void {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    this.lastUpdate = performance.now();
    this.loopsLive = true;
    this.frameNo++;
    const now = c.currentTime;
    this.sweep(now);
    this.action *= Math.exp(-dt / 8);
    const me: Soldier | undefined = viewer >= 0 ? g.soldiers[viewer] : undefined;
    this.updateEngines(g, me, dt, now);
    this.updateHiss(g, now);
    this.updateAmbient(g, me, dt, now);
    // 조준 고정 경고
    const veh = me && me.vehicle >= 0 ? g.vehicles[me.vehicle] : undefined;
    if (veh && veh.alive && veh.lockWarn > 0.3) {
      this.warnT -= dt;
      if (this.warnT <= 0) {
        const k = clamp((veh.lockWarn - 0.3) / 0.7, 0, 1);
        this.cue(k > 0.92 ? 'warnHi' : 'warnBeep', 0.32, 0, 9);
        this.warnT = 0.42 + (0.075 - 0.42) * k;
      }
    } else this.warnT = 0;
    // 내 총 소리는 미리 그려 두고, 더는 안 쓰는 내 총 소리는 버린다
    if (me) {
      const wa = me.weapons[0], wb = me.weapons[1];
      const ia = wa?.id ?? '', ib = wb?.id ?? '', sa = !!wa?.st?.suppressed, sb = !!wb?.st?.suppressed;
      if (ia !== this.ownA || ib !== this.ownB || sa !== this.ownSupA || sb !== this.ownSupB) {
        this.ownA = ia; this.ownB = ib; this.ownSupA = sa; this.ownSupB = sb;
        this.refreshOwn([[ia, sa], [ib, sb]]);
      }
    }
  }

  private refreshOwn(list: [string, boolean][]): void {
    const keep = new Set<string>();
    for (const [id, supp] of list) {
      const snd = WEAPONS[id]?.sound || DEFAULT_SOUND;
      for (let v = 0; v < GUN_VARS.own; v++) {
        keep.add(this.gunKey(snd.kind, snd.punch, 'own', supp, v));
        this.prewarmQ.unshift(() => { this.gunBuf(snd.kind, snd.punch, 'own', supp, v); });
      }
    }
    for (const k of this.cache.keys()) if (k.startsWith('g|') && k.includes('|own|') && !keep.has(k)) this.cache.delete(k);
    this.kickPrewarm();
  }

  // ───────────────────────── 내부: 준비 ─────────────────────────

  private create(): void {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const AC = w.AudioContext || w.webkitAudioContext;
    if (!AC) return;
    let c: AudioContext;
    try { c = new AC({ latencyHint: 'interactive' }); } catch { try { c = new AC(); } catch { return; } }
    this.ctx = c;
    const mix = c.createGain();
    const duck = c.createBiquadFilter();
    duck.type = 'lowpass'; duck.frequency.value = 20000; duck.Q.value = 0.5;
    const master = c.createGain();
    master.gain.value = this.vol;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.22;
    const pre = c.createGain();
    pre.gain.value = 0.5;
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(1025);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(2 * (i / 512 - 1));
    shaper.curve = curve;
    shaper.oversample = 'none';
    mix.connect(duck); duck.connect(master); master.connect(comp); comp.connect(pre); pre.connect(shaper); shaper.connect(c.destination);
    const mk = (gain: number) => { const b = c.createGain(); b.gain.value = gain; b.connect(mix); return b; };
    this.sfxBus = mk(1); this.ambBus = mk(1); this.uiBus = mk(0.85);
    // 잔향
    try {
      const conv = c.createConvolver();
      const ir = this.buf('ir', c.sampleRate, (sr) => S.impulse(sr, 1.4), true);
      conv.buffer = ir;
      const ret = c.createGain();
      ret.gain.value = 0.55;
      const send = c.createGain();
      send.connect(conv); conv.connect(ret); ret.connect(mix);
      this.revIn = send;
    } catch { this.revIn = null; }
    this.mix = mix; this.duck = duck; this.master = master;
    // iOS: 무음 한 번 재생해 깨우기
    try { const sb = c.createBuffer(1, 1, c.sampleRate); const s = c.createBufferSource(); s.buffer = sb; s.connect(c.destination); s.start(0); } catch { /* 없음 */ }
    this.watchdog = window.setInterval(() => this.idleCheck(), 400);
    this.queuePrewarm();
  }

  private removeGesture(): void { this.gestureOff?.(); this.gestureOff = null; }

  /** 버퍼 캐시. fixedRate = 컨텍스트 표본율 그대로 (컨볼버용) */
  private buf(key: string, sr: number, fn: (sr: number) => Buf[], fixedRate = false): AudioBuffer {
    const hit = this.cache.get(key);
    if (hit) return hit;
    const c = this.ctx!;
    let rate = fixedRate || !this.lowRateOk ? c.sampleRate : Math.min(sr, c.sampleRate);
    let data = fn(rate);
    let b: AudioBuffer;
    try { b = c.createBuffer(data.length, data[0].length, rate); }
    catch {
      this.lowRateOk = false;
      rate = c.sampleRate;
      data = fn(rate);
      b = c.createBuffer(data.length, data[0].length, rate);
    }
    for (let i = 0; i < data.length; i++) b.getChannelData(i).set(data[i]);
    this.cache.set(key, b);
    return b;
  }

  /** 총성 버퍼 열쇠: 거리 단계·소음기·변형, 펀치는 1/3 단위로 묶는다 (먼 소리와 남의 소음기 사격은 종류만) */
  private gunParts(kind: S.GunKind, punch: number, dist: S.GunDist, supp: boolean, v: number): { pq: number; dd: S.GunDist; vv: number } {
    const dd: S.GunDist = supp && dist === 'far' ? 'mid' : dist;
    const pq = dd === 'far' || (supp && dd !== 'own') ? 1 : Math.round(clamp(punch, 0.4, 2) * 3) / 3;
    return { pq, dd, vv: Math.min(v, GUN_VARS[dd] - 1) };
  }

  private gunKey(kind: S.GunKind, punch: number, dist: S.GunDist, supp: boolean, v: number): string {
    const { pq, dd, vv } = this.gunParts(kind, punch, dist, supp, v);
    return `g|${kind}|${pq.toFixed(2)}|${dd}|${supp ? 1 : 0}|${vv}`;
  }

  private gunBuf(kind: S.GunKind, punch: number, dist: S.GunDist, supp: boolean, v: number): AudioBuffer {
    const spec = S.GUN[kind] ?? S.GUN.rifle;
    const { pq, dd, vv } = this.gunParts(kind, punch, dist, supp, v);
    const key = `g|${kind}|${pq.toFixed(2)}|${dd}|${supp ? 1 : 0}|${vv}`;
    const seed = strSeed(kind);
    return this.buf(key, GUN_SR[dd], (sr) => (supp ? S.gunSuppressed(sr, spec, pq, dd as 'own' | 'near' | 'mid', vv, seed) : S.gunShot(sr, spec, pq, dd, vv, seed)));
  }

  private specBuf(name: string, spec: S.GunSpec, dist: S.GunDist, v: number): AudioBuffer {
    const vv = Math.min(v, GUN_VARS[dist] - 1);
    return this.buf(`v|${name}|${dist}|${vv}`, GUN_SR[dist], (sr) => S.gunShot(sr, spec, 1, dist, vv, strSeed(name)));
  }

  /** 미리 그리기: 한가할 때 조금씩 */
  private queuePrewarm(): void {
    const seen = new Set<string>();
    for (const w of Object.values(WEAPONS)) {
      const s = w.sound || DEFAULT_SOUND;
      const k = `${s.kind}|${Math.round(s.punch * 3)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      this.prewarmQ.push(() => this.gunBuf(s.kind, s.punch, 'near', false, 0));
      this.prewarmQ.push(() => this.gunBuf(s.kind, s.punch, 'mid', false, 0));
    }
    for (const k of Object.keys(S.GUN) as S.GunKind[]) this.prewarmQ.push(() => this.gunBuf(k, 1, 'far', false, 0));
    const q = this.prewarmQ;
    q.push(() => this.cueBuf('tick', 0), () => this.cueBuf('head', 0), () => this.cueBuf('kill', 0));
    q.push(() => this.buf('expN#0', 24000, (sr) => S.explosionNear(sr, 0)), () => this.buf('expF#0', 16000, (sr) => S.explosionFar(sr, 0, false)));
    for (const s of ['snow', 'hard', 'dirt', 'metal', 'wood', 'water'] as S.StepSurf[]) q.push(() => this.buf(`step_${s}#0`, 32000, (sr) => S.footstep(sr, s, 0)));
    for (const s of ['hard', 'soft', 'metal', 'wood', 'glass'] as S.ImpactSurf[]) q.push(() => this.buf(`imp_${s}#0`, 32000, (sr) => S.impact(sr, s, 0)));
    for (const k of ['wind', 'diesel', 'clatter', 'whine', 'tires', 'rotor', 'hiss'] as S.LoopKind[]) q.push(() => this.loopBuf(k));
    q.push(() => this.buf('snap#0', 32000, (sr) => S.bulletSnap(sr, 0, false)));
    this.kickPrewarm();
  }

  private kickPrewarm(): void {
    if (this.prewarmTimer || !this.prewarmQ.length || this.disposed) return;
    const run = () => {
      this.prewarmTimer = 0;
      if (!this.ctx || this.disposed) return;
      const t0 = performance.now();
      while (this.prewarmQ.length && performance.now() - t0 < 6) {
        const f = this.prewarmQ.shift()!;
        try { f(); } catch { /* 한 소리 실패는 무시 */ }
      }
      if (this.prewarmQ.length) this.prewarmTimer = window.setTimeout(run, 40);
    };
    this.prewarmTimer = window.setTimeout(run, 60);
  }

  // ───────────────────────── 내부: 재생 ─────────────────────────

  private mkPanner(p: Vec3): PannerNode {
    const pn = this.ctx!.createPanner();
    pn.panningModel = 'equalpower';
    pn.distanceModel = 'linear';
    pn.rolloffFactor = 0;
    pn.refDistance = 1;
    pn.maxDistance = 100000;
    setPos(pn, p);
    return pn;
  }

  private bus(b: BusId | undefined): GainNode {
    return (b === 'ui' ? this.uiBus : b === 'amb' ? this.ambBus : this.sfxBus)!;
  }

  private sweep(now: number): void {
    const vs = this.voices;
    for (let i = vs.length - 1; i >= 0; i--) if (vs[i].end < now) { vs[i] = vs[vs.length - 1]; vs.pop(); }
    if (this.ownShots.length && this.ownShots[0].end < now) this.ownShots = this.ownShots.filter((v) => v.end >= now);
    if (this.reloadVoices.length && this.reloadVoices[this.reloadVoices.length - 1].end < now) this.reloadVoices.length = 0;
  }

  private kill(v: Voice, now: number, fade = 0.015): void {
    try {
      v.out.gain.cancelScheduledValues(now);
      v.out.gain.setTargetAtTime(0, now, fade);
      v.src.stop(now + fade * 6);
    } catch { /* 이미 멈춤 */ }
    v.end = now;
  }

  private play(buf: AudioBuffer, o: PlayOpts): Voice | null {
    const c = this.ctx;
    if (!c || c.state !== 'running' || o.gain < 0.004) return null;
    const now = c.currentTime;
    const pri = o.pri ?? o.gain;
    const vs = this.voices;
    if (vs.length >= MAX_VOICES) {
      this.sweep(now);
      if (vs.length >= MAX_VOICES) {
        // 가장 덜 중요한 (작고 거의 끝난) 목소리를 밀어낸다
        let mi = -1, mp = Infinity;
        for (let i = 0; i < vs.length; i++) {
          const v = vs[i];
          const left = clamp((v.end - now) / Math.max(0.05, v.end - v.t0), 0.15, 1);
          const p = v.pri * left;
          if (p < mp) { mp = p; mi = i; }
        }
        if (mi < 0 || mp >= pri) return null;
        this.kill(vs[mi], now);
        vs[mi] = vs[vs.length - 1]; vs.pop();
      }
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    const rate = o.rate ?? 1;
    if (rate !== 1) src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = o.gain;
    src.connect(g);
    let pan: PannerNode | null = null;
    if (o.pos) { pan = this.mkPanner(o.pos); g.connect(pan); pan.connect(this.bus(o.bus)); }
    else g.connect(this.bus(o.bus));
    let send: GainNode | null = null;
    if (o.send && this.revIn) { send = c.createGain(); send.gain.value = o.send; g.connect(send); send.connect(this.revIn); }
    const t0 = now + Math.max(0, o.delay ?? 0);
    src.onended = () => { g.disconnect(); pan?.disconnect(); send?.disconnect(); };
    src.start(t0);
    const v: Voice = { src, out: g, t0, end: t0 + buf.duration / rate + 0.05, pri };
    vs.push(v);
    return v;
  }

  /** 이름 붙은 효과음 (변형 n개 중 무작위) */
  private sfx(name: string, vars: number, sr: number, fn: (sr: number, v: number) => Buf[], o: PlayOpts): Voice | null {
    if (!this.ctx) return null;
    const v = Math.floor(Math.random() * vars);
    return this.play(this.buf(`${name}#${v}`, sr, (r) => fn(r, v)), o);
  }

  private cueBuf(kind: S.CueKind, v: number): AudioBuffer {
    return this.buf(`cue_${kind}#${v}`, kind === 'win' || kind === 'lose' ? 32000 : 44100, (sr) => S.cue(sr, kind, v));
  }

  private cue(kind: S.CueKind, gain: number, delay: number, pri: number): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    this.play(this.cueBuf(kind, 0), { gain, delay, pri, bus: 'ui' });
  }

  private act(kind: S.ActKind, o: PlayOpts): void {
    this.sfx(`act_${kind}`, 2, 32000, (sr, v) => S.action(sr, kind, v), o);
  }

  private handle(kind: S.HandleKind, delay: number, gain: number, pri: number): Voice | null {
    return this.sfx(`h_${kind}`, 2, 44100, (sr, v) => S.handling(sr, kind, v), { gain, delay, pri, rate: jit(0.05) });
  }

  private allow(key: string, gap: number): boolean {
    const now = this.ctx ? this.ctx.currentTime : 0;
    const t = this.throttle.get(key);
    if (t !== undefined && now - t < gap) return false;
    this.throttle.set(key, now);
    return true;
  }

  private loopBuf(k: S.LoopKind): AudioBuffer {
    const sr = k === 'wind' || k === 'diesel' || k === 'tires' ? 16000 : 22050;
    return this.buf(`loop_${k}`, sr, (r) => S.loop(r, k));
  }

  private loopSrc(k: S.LoopKind): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.loopBuf(k);
    s.loop = true;
    return s;
  }

  // ───────────────────────── 내부: 사건별 ─────────────────────────

  private onShot(e: Extract<GameEvent, { k: 'shot' }>, g: Game, viewer: number, now: number): void {
    const w = WEAPONS[e.weapon];
    const snd = w?.sound ?? DEFAULT_SOUND;
    const loud = LOUD[snd.kind] ?? 1;
    if (e.s === viewer) {
      this.stopReload();
      const v = Math.floor(Math.random() * GUN_VARS.own);
      const vo = this.play(this.gunBuf(snd.kind, snd.punch, 'own', e.suppressed, v), {
        gain: (e.suppressed ? 0.6 : 0.85) * loud, rate: snd.pitch * jit(0.05), pri: 10, send: e.suppressed ? 0.05 : 0.14,
      });
      if (vo) {
        this.ownShots.push(vo);
        if (this.ownShots.length > MAX_OWN_SHOTS) {
          const old = this.ownShots.shift()!;
          if (old.end > now) { old.out.gain.setTargetAtTime(0, now + 0.03, 0.05); }
        }
      }
      // 노리쇠·펌프 동작
      if (w && w.modes.length === 1 && (w.modes[0] === 'bolt' || w.modes[0] === 'pump')) {
        const rv = this.handle(w.modes[0] === 'bolt' ? 'boltAction' : 'pump', w.modes[0] === 'bolt' ? 0.42 : 0.3, 0.32, 6);
        if (rv) this.reloadVoices.push(rv);
      }
      return;
    }
    const d = d3(e.pos, this.L);
    this.snapCheck(e, w?.velocity ?? 800, snd.kind, g, viewer);
    if (e.suppressed && d > 90) return;
    if (d > 240) return; // 먼 교전은 배경음이 맡는다
    // 같은 사수의 연사는 멀수록 성기게
    const minI = d < 30 ? 0 : d < 80 ? 0.045 : d < 150 ? 0.09 : 0.16;
    const last = this.lastShotT[e.s] ?? -1;
    if (minI > 0 && now - last < minI) return;
    this.lastShotT[e.s] = now;
    const dist: S.GunDist = d < 40 ? 'near' : d < 140 ? 'mid' : 'far';
    const v = Math.floor(Math.random() * GUN_VARS[dist]);
    const gain = (e.suppressed ? 0.35 : 0.8) * loud * att(d, e.suppressed ? 5 : 10);
    this.play(this.gunBuf(snd.kind, snd.punch, dist, e.suppressed, v), {
      pos: e.pos, gain, rate: snd.pitch * jit(0.06), delay: d > 25 ? Math.min(1.2, d / SOUND_SPEED) : 0,
      pri: gain, send: 0.08 + 0.25 * clamp(d / 150, 0, 1),
    });
  }

  /** 탄이 머리 옆을 지나가면 '딱' (탄 도착 시각에) */
  private snapCheck(e: Extract<GameEvent, { k: 'shot' }>, vel: number, kind: S.GunKind, g: Game, viewer: number): void {
    if (viewer < 0) return;
    const me = g.soldiers[viewer];
    if (!me || me.state !== 'alive') return;
    const px = this.L.x - e.pos.x, py = this.L.y - e.pos.y, pz = this.L.z - e.pos.z;
    const dl = Math.hypot(e.dir.x, e.dir.y, e.dir.z) || 1;
    const t = (px * e.dir.x + py * e.dir.y + pz * e.dir.z) / dl;
    if (t < 8 || t > 500) return;
    const miss2 = px * px + py * py + pz * pz - t * t;
    if (miss2 > 16) return;
    if (!this.allow('snap', 0.06)) return;
    const miss = Math.sqrt(Math.max(0, miss2));
    const whiz = kind === 'pistol' || kind === 'smg' || vel < 420;
    const k = t / dl;
    const pos = { x: e.pos.x + e.dir.x * k, y: e.pos.y + e.dir.y * k, z: e.pos.z + e.dir.z * k };
    this.sfx(whiz ? 'whiz' : 'snap', 3, 32000, (sr, v) => S.bulletSnap(sr, v, whiz), {
      pos, gain: (whiz ? 0.4 : 0.6) * (1 - miss / 4.5), delay: Math.min(1.5, t / Math.max(200, vel)), rate: jit(0.15), pri: 5,
    });
  }

  private onVShot(e: Extract<GameEvent, { k: 'vshot' }>, own: boolean, now: number): void {
    const vw = VWEAPONS[e.weapon];
    const kind = vw?.kind ?? 'mg';
    const d = own ? 0 : d3(e.pos, this.L);
    const delay = !own && d > 25 ? Math.min(1.5, d / SOUND_SPEED) : 0;
    const pos = own ? null : e.pos;
    const sendFar = 0.1 + 0.3 * clamp(d / 200, 0, 1);
    switch (kind) {
      case 'cannon': {
        const near = own || d < 70;
        const buf = near ? this.buf(`cannonN#${e.v & 1}`, 24000, (sr) => S.cannonNear(sr, e.v & 1)) : this.buf('cannonF#0', 16000, (sr) => S.explosionFar(sr, 0, true));
        const gain = own ? 0.95 : 1.25 * att(d, 15);
        this.play(buf, { pos, gain, delay, rate: jit(0.06), pri: own ? 10 : gain * 2, send: own ? 0.25 : sendFar + 0.1 });
        if (own) { this.duckTo(0.25, 0.4); const rv = this.handle('bolt', 1.1, 0.35, 5); if (rv) this.reloadVoices.push(rv); }
        break;
      }
      case 'autocannon': case 'mg': {
        const name = kind === 'autocannon' ? 'ac' : 'hmg';
        const spec = kind === 'autocannon' ? S.AUTOCANNON : S.HMG;
        if (!own) {
          if (d > 260) return;
          const key = 1000 + e.v * 4 + (e.seat & 3);
          const minI = d < 40 ? 0 : d < 120 ? 0.06 : 0.12;
          const last = this.lastShotT[key] ?? -1;
          if (minI > 0 && now - last < minI) return;
          this.lastShotT[key] = now;
        }
        const dist: S.GunDist = own ? 'own' : d < 40 ? 'near' : d < 140 ? 'mid' : 'far';
        const v = Math.floor(Math.random() * GUN_VARS[dist]);
        const base = kind === 'autocannon' ? 0.85 : 0.75;
        const gain = own ? base * 0.9 : base * 1.1 * att(d, 12);
        const vo = this.play(this.specBuf(name, spec, dist, v), { pos, gain, delay, rate: jit(0.05), pri: own ? 9 : gain, send: own ? 0.14 : sendFar });
        if (vo && own) {
          this.ownShots.push(vo);
          if (this.ownShots.length > MAX_OWN_SHOTS) { const old = this.ownShots.shift()!; if (old.end > now) old.out.gain.setTargetAtTime(0, now + 0.03, 0.05); }
        }
        break;
      }
      case 'rockets': case 'atgm': {
        const long = kind === 'atgm';
        if (!own && d > 300) return;
        const gain = own ? 0.7 : 0.9 * att(d, 10);
        this.sfx(long ? 'atgm' : 'rkt', 2, 32000, (sr, v) => S.rocketLaunch(sr, v, long), { pos, gain, delay, rate: jit(0.08), pri: own ? 8 : gain, send: 0.2 });
        break;
      }
    }
  }

  private onExplosion(e: Extract<GameEvent, { k: 'explosion' }>): void {
    const d = d3(e.pos, this.L);
    const big = e.kind === 'shell' || e.kind === 'vehicle' || e.kind === 'rocket' || e.kind === 'c4' || e.kind === 'mine';
    const size = clamp((e.r || 4) / 5, 0.5, 1.8) * (big ? 1.15 : 1);
    const rate = clamp(1.18 - 0.22 * size, 0.75, 1.1) * jit(0.08);
    const delay = d > 40 ? Math.min(1.5, d / SOUND_SPEED) : 0;
    const near = d < 110;
    const v = Math.floor(Math.random() * 2);
    const buf = near ? this.buf(`expN#${v}`, 24000, (sr) => S.explosionNear(sr, v)) : this.buf(`expF#${v}`, 16000, (sr) => S.explosionFar(sr, v, false));
    const gain = 1.15 * Math.min(1.4, size) * att(d, 12);
    this.play(buf, { pos: e.pos, gain, rate, delay, pri: 3 + gain, send: 0.25 + 0.3 * clamp(d / 200, 0, 1) });
    // 가까우면: 먹먹해지고 귀가 울린다
    const close = Math.max(10, (e.r || 4) * 2.6);
    if (d < close) {
      const k = 1 - d / close;
      this.duckTo(0.5 + 0.5 * k, 1.5);
      this.tinnitus(k);
    } else if (d < close * 2.5) {
      this.duckTo(0.3 * (1 - (d - close) / (close * 1.5)), 0.8);
    }
  }

  private onGadget(e: Extract<GameEvent, { k: 'gadget' }>, viewer: number): void {
    const gd = GADGETS[e.gadget];
    if (!gd) return;
    const own = e.s === viewer;
    const d = own ? 0 : d3(e.pos, this.L);
    const pos = own ? null : e.pos;
    const k = gd.kind;
    if (k === 'rocket' || k === 'aa') {
      if (!own && d > 250) return;
      const long = k === 'aa';
      const gain = own ? 0.8 : 0.9 * att(d, 8);
      this.sfx(long ? 'atgm' : 'rkt', 2, 32000, (sr, v) => S.rocketLaunch(sr, v, long), {
        pos, gain, delay: own ? 0 : Math.min(1.2, d / SOUND_SPEED), rate: jit(0.08), pri: own ? 9 : gain, send: 0.2,
      });
      return;
    }
    if (!own && d > 40) return;
    const near = (base: number): PlayOpts => ({ pos, gain: own ? base : base * att(d, 3), pri: own ? 5 : 0.2, rate: jit(0.08) });
    if (!this.allow(`gd${e.s}`, 0.2)) return;
    switch (k) {
      case 'ugl': this.act('ugl', near(0.6)); break;
      case 'stim': this.act('stim', near(0.35)); break;
      case 'defib': this.act('defib', near(0.5)); break;
      case 'repair': this.act('torch', near(0.3)); break;
      case 'drone': this.act('drone', near(0.3)); break;
      case 'smoke': this.act('smokePop', near(0.5)); break;
      case 'medbag': case 'ammobag': case 'atmine': case 'claymore': case 'beacon': case 'sensor': case 'cover': case 'breach':
        this.act('place', near(0.4)); break;
      default: this.act('place', near(0.3)); break;
    }
  }

  private reloadSeq(me: Soldier, empty: boolean): void {
    this.stopReload();
    const ws = me.weapons[me.cur];
    const w = ws ? WEAPONS[ws.id] : undefined;
    const T = clamp(ws?.reloadTotal || (w ? (empty ? w.reloadEmpty : w.reload) : 2.2), 0.6, 6);
    const cat = w?.cat ?? 'ar';
    const push = (v: Voice | null) => { if (v) this.reloadVoices.push(v); };
    const cl = this.sfx('cloth', 3, 22050, (sr, v) => S.cloth(sr, v), { gain: 0.16, delay: 0.05, pri: 4 });
    push(cl);
    if (cat === 'shotgun') {
      const need = ws ? clamp(ws.st.mag - ws.mag, 1, 8) : 4;
      const n = Math.min(need, 6);
      const step = (T * 0.75) / n;
      for (let i = 0; i < n; i++) push(this.handle('shell', 0.2 + i * step, 0.38, 5));
      if (empty) push(this.handle('pump', T - 0.3, 0.42, 5));
      return;
    }
    push(this.handle('magOut', T * (cat === 'pistol' ? 0.1 : 0.14), 0.42, 5));
    push(this.handle('magIn', T * 0.55, 0.5, 5));
    if (empty) push(this.handle(cat === 'pistol' ? 'slide' : cat === 'sniper' && w?.modes[0] === 'bolt' ? 'boltAction' : 'bolt', T * 0.8, 0.48, 5));
  }

  private stopReload(): void {
    const c = this.ctx;
    if (!c || !this.reloadVoices.length) return;
    const now = c.currentTime;
    for (const v of this.reloadVoices) if (v.end > now) this.kill(v, now, 0.01);
    this.reloadVoices.length = 0;
  }

  /** 세상 소리를 잠깐 먹먹하게 (k 0..1, 회복 s) */
  private duckTo(k: number, recover: number): void {
    const c = this.ctx, f = this.duck, m = this.mix;
    if (!c || !f || !m || k <= 0.02) return;
    const now = c.currentTime;
    const low = 2500 + (280 - 2500) * clamp(k, 0, 1);
    const cur = f.frequency.value;
    if (cur < low) return; // 이미 더 먹먹함
    f.frequency.cancelScheduledValues(now);
    f.frequency.setValueAtTime(Math.max(low, Math.min(20000, cur)), now);
    f.frequency.exponentialRampToValueAtTime(low, now + 0.03);
    f.frequency.setTargetAtTime(20000, now + 0.25, recover / 3);
    m.gain.cancelScheduledValues(now);
    m.gain.setValueAtTime(m.gain.value, now);
    m.gain.linearRampToValueAtTime(1 - 0.45 * k, now + 0.03);
    m.gain.setTargetAtTime(1, now + 0.25, recover / 3);
  }

  /** 귀 울림 (k 0..1) */
  private tinnitus(k: number): void {
    const c = this.ctx, m = this.master;
    if (!c || !m) return;
    const now = c.currentTime;
    const level = 0.035 + 0.06 * k;
    const len = 1.6 + 1.6 * k;
    let t = this.tin;
    if (!t || t.end < now) {
      const osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 3700 + Math.random() * 700;
      const g = c.createGain();
      g.gain.value = 0;
      osc.connect(g); g.connect(m);
      osc.start(now);
      t = { osc, g, end: 0 };
      osc.onended = () => { g.disconnect(); };
      this.tin = t;
    }
    t.g.gain.cancelScheduledValues(now);
    t.g.gain.setValueAtTime(t.g.gain.value, now);
    t.g.gain.linearRampToValueAtTime(level, now + 0.05);
    t.g.gain.setTargetAtTime(0, now + 0.35, len / 4);
    t.end = now + 0.35 + len * 1.4;
    try { t.osc.stop(t.end); } catch { /* 무시 */ }
  }

  // ───────────────────────── 내부: 반복음 ─────────────────────────

  private updateEngines(g: Game, me: Soldier | undefined, dt: number, now: number): void {
    const L = this.L, cand = this.engV, ds = this.engD;
    cand.length = 0; ds.length = 0;
    for (const v of g.vehicles) {
      if (!v.alive) continue;
      let occ = false;
      for (const s of v.seats) if (s >= 0) { occ = true; break; }
      const moving = Math.abs(v.speed) > 0.4 || Math.abs(v.vel.y) > 0.5;
      if (!occ && !moving) continue;
      const d = d3(v.pos, L);
      if (d > 220) continue;
      // 가까운 순으로 끼워 넣기 (작은 목록)
      let i = ds.length;
      while (i > 0 && ds[i - 1] > d) i--;
      if (i >= MAX_ENGINES) continue;
      ds.splice(i, 0, d); cand.splice(i, 0, v);
      if (ds.length > MAX_ENGINES) { ds.pop(); cand.pop(); }
    }
    const fr = this.frameNo;
    for (let i = 0; i < cand.length; i++) {
      const v = cand[i], d = ds[i];
      let en = this.engines.get(v.id);
      if (!en || en.type !== v.type) { if (en) this.stopEngine(en, now); en = this.mkEngine(v, now); this.engines.set(v.id, en); }
      en.seen = fr;
      const def = VEHICLES[v.type];
      const sp = clamp(Math.abs(v.speed) / Math.max(1, def?.speed ?? 15), 0, 1.2);
      const inside = !!me && me.vehicle === v.id;
      const a = inside ? 1 : att(d, 9);
      let lp = inside ? 2400 : clamp(12000 / (1 + d / 18), 450, 12000);
      let rA = 1, gA = 0, rB = 1, gB = 0;
      let occ = false;
      for (const s of v.seats) if (s >= 0) { occ = true; break; }
      if (v.type === 'heli') {
        en.spool += ((occ ? 1 : 0) - en.spool) * Math.min(1, dt * 0.45);
        rA = 0.55 + 0.45 * en.spool + 0.06 * sp;
        gA = 0.75 * a * en.spool;
        rB = 1.2 + 0.4 * sp;
        gB = 0.3 * a * en.spool * (0.4 + sp);
      } else if (v.type === 'ltv') {
        rA = 0.6 + 1.0 * sp; gA = 0.34 * a * (0.55 + 0.45 * sp);
        rB = 0.8 + 0.6 * sp; gB = 0.35 * a * clamp(sp * 2, 0, 1);
        if (inside) lp = 1800;
      } else {
        rA = 0.7 + 0.55 * sp; gA = (v.type === 'mbt' ? 0.58 : 0.5) * a * (0.65 + 0.35 * sp);
        rB = 0.35 + 1.2 * sp; gB = 0.5 * a * clamp(sp * 3, 0, 1);
        if (inside) lp = 1400;
      }
      const T = 0.12;
      en.a.playbackRate.setTargetAtTime(rA, now, T);
      en.b.playbackRate.setTargetAtTime(rB, now, T);
      en.ga.gain.setTargetAtTime(gA, now, T);
      en.gb.gain.setTargetAtTime(gB, now, T);
      en.lp.frequency.setTargetAtTime(lp, now, 0.2);
      setPos(en.pan, inside ? L : v.pos);
    }
    for (const [id, en] of this.engines) if (en.seen !== fr) { this.stopEngine(en, now); this.engines.delete(id); }
  }

  private mkEngine(v: Vehicle, now: number): Engine {
    const c = this.ctx!;
    const tracked = v.type === 'mbt' || v.type === 'ifv';
    const a = this.loopSrc(v.type === 'heli' ? 'rotor' : tracked ? 'diesel' : 'whine');
    const b = this.loopSrc(v.type === 'heli' ? 'wind' : tracked ? 'clatter' : 'tires');
    const ga = c.createGain(), gb = c.createGain();
    ga.gain.value = 0; gb.gain.value = 0;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 6000; lp.Q.value = 0.6;
    const pan = this.mkPanner(v.pos);
    a.connect(ga); b.connect(gb); ga.connect(lp); gb.connect(lp); lp.connect(pan); pan.connect(this.sfxBus!);
    a.start(now, Math.random() * (a.buffer?.duration ?? 1));
    b.start(now, Math.random() * (b.buffer?.duration ?? 1));
    return { type: v.type, a, b, ga, gb, lp, pan, spool: v.type === 'heli' ? 0.6 : 1, seen: 0 };
  }

  private stopEngine(en: Engine, now: number): void {
    try {
      en.ga.gain.cancelScheduledValues(now); en.gb.gain.cancelScheduledValues(now);
      en.ga.gain.setTargetAtTime(0, now, 0.15); en.gb.gain.setTargetAtTime(0, now, 0.15);
      en.a.stop(now + 0.8); en.b.stop(now + 0.8);
      en.a.onended = () => { en.lp.disconnect(); en.pan.disconnect(); en.ga.disconnect(); en.gb.disconnect(); };
    } catch { /* 이미 멈춤 */ }
  }

  private updateHiss(g: Game, now: number): void {
    const fr = this.frameNo;
    let n = 0;
    for (const p of g.projectiles) {
      if (!p.alive || (p.kind !== 'rocket' && p.kind !== 'missile')) continue;
      const d = d3(p.pos, this.L);
      if (d > 110) continue;
      let h = this.hiss.get(p.id);
      if (!h) {
        if (this.hiss.size >= MAX_HISS) continue;
        const c = this.ctx!;
        const src = this.loopSrc('hiss');
        src.playbackRate.value = p.kind === 'missile' ? 1.15 : 1;
        const gn = c.createGain();
        gn.gain.value = 0;
        const pan = this.mkPanner(p.pos);
        src.connect(gn); gn.connect(pan); pan.connect(this.sfxBus!);
        src.start(now, Math.random());
        h = { src, g: gn, pan, seen: fr };
        this.hiss.set(p.id, h);
      }
      h.seen = fr;
      h.g.gain.setTargetAtTime(0.5 * att(d, 7), now, 0.05);
      setPos(h.pan, p.pos);
      if (++n > 12) break;
    }
    for (const [id, h] of this.hiss) {
      if (h.seen === fr) continue;
      this.hiss.delete(id);
      try { h.g.gain.setTargetAtTime(0, now, 0.04); h.src.stop(now + 0.3); h.src.onended = () => { h.g.disconnect(); h.pan.disconnect(); }; } catch { /* 무시 */ }
    }
  }

  private updateAmbient(g: Game, me: Soldier | undefined, dt: number, now: number): void {
    const c = this.ctx!;
    if (!this.wind) {
      const a = this.loopSrc('wind'), b = this.loopSrc('wind');
      b.playbackRate.value = 1.9;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 0.5;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 850; bp.Q.value = 6;
      const ga = c.createGain(), gb = c.createGain();
      ga.gain.value = 0; gb.gain.value = 0;
      a.connect(lp); lp.connect(ga); ga.connect(this.ambBus!);
      b.connect(bp); bp.connect(gb); gb.connect(this.ambBus!);
      a.start(now, Math.random() * 3); b.start(now, Math.random() * 3);
      this.wind = { a, b, lp, bp, ga, gb };
    }
    // 돌풍
    this.gustT -= dt;
    if (this.gustT <= 0) { this.gustTarget = 0.25 + Math.random() * 0.95; this.gustT = 2 + Math.random() * 5; }
    this.gust += (this.gustTarget - this.gust) * (1 - Math.exp(-0.6 * dt));
    const theme = g.world?.def?.theme;
    let base = theme === 'snow' ? 0.16 : theme === 'tundra' ? 0.13 : 0.09;
    const veh = me && me.vehicle >= 0 ? g.vehicles[me.vehicle] : undefined;
    if (veh && veh.type === 'heli') base *= 1.5;
    else if (veh) base *= 0.5;
    const gu = this.gust;
    const w = this.wind;
    w.ga.gain.setTargetAtTime(base * (0.55 + 0.6 * gu), now, 0.3);
    w.lp.frequency.setTargetAtTime(380 + 900 * gu, now, 0.4);
    w.gb.gain.setTargetAtTime(base * 0.5 * Math.max(0, gu - 0.55), now, 0.5);
    w.bp.frequency.setTargetAtTime(700 + 500 * gu, now, 0.6);
    // 먼 교전 배경음
    this.ambT -= dt;
    if (this.ambT <= 0) {
      const act = clamp(0.12 + this.action / 5, 0, 1);
      this.distant(act);
      this.ambT = (10 + (0.8 - 10) * act) * (0.5 + Math.random());
    }
  }

  /** 멀리서 들리는 연사나 폭발 하나 */
  private distant(act: number): void {
    const a = Math.random() * Math.PI * 2, D = 280 + Math.random() * 320;
    const pos = { x: this.L.x + Math.cos(a) * D, y: this.L.y + 20, z: this.L.z + Math.sin(a) * D };
    if (Math.random() < 0.1 + act * 0.1) {
      const v = Math.floor(Math.random() * 2);
      this.play(this.buf(`expF#${v}`, 16000, (sr) => S.explosionFar(sr, v, false)), { pos, gain: 0.12 + Math.random() * 0.14, rate: jit(0.2), pri: 0.02, send: 0.3, bus: 'amb' });
      return;
    }
    const r = Math.random();
    const kind: S.GunKind = r < 0.35 ? 'rifle' : r < 0.55 ? 'carbine' : r < 0.75 ? 'lmg' : r < 0.85 ? 'smg' : r < 0.95 ? 'dmr' : 'sniper';
    const single = kind === 'dmr' || kind === 'sniper';
    const count = single ? 1 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * (kind === 'lmg' ? 14 : 7));
    const sp = SPACING[kind];
    const gain = (0.05 + 0.08 * Math.random()) * (0.7 + act * 0.5);
    const buf = this.gunBuf(kind, 1, 'far', false, 0);
    let t = 0;
    for (let i = 0; i < count; i++) {
      this.play(buf, { pos, gain: gain * jit(0.3), delay: t, rate: jit(0.08), pri: 0.01, send: 0.3, bus: 'amb' });
      t += sp * jit(0.2);
    }
  }

  /** update 가 한동안 안 불리면 (일시 정지·메뉴) 반복음을 끈다 */
  private idleCheck(): void {
    const c = this.ctx;
    if (!c || c.state !== 'running' || !this.loopsLive) return;
    if (performance.now() - this.lastUpdate < 700) return;
    this.loopsLive = false;
    const now = c.currentTime;
    for (const en of this.engines.values()) this.stopEngine(en, now);
    this.engines.clear();
    for (const h of this.hiss.values()) { try { h.g.gain.setTargetAtTime(0, now, 0.05); h.src.stop(now + 0.3); } catch { /* 무시 */ } }
    this.hiss.clear();
    if (this.wind) { this.wind.ga.gain.setTargetAtTime(0, now, 0.25); this.wind.gb.gain.setTargetAtTime(0, now, 0.25); }
    this.warnT = 0;
  }
}
