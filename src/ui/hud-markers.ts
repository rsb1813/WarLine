// 3D 위치 표시: 거점, 표시된 적, 아군 이름, 분대원, 쓰러진 아군, 차량. 카메라로 투영해 DOM 을 옮긴다(풀 재사용).
import * as THREE from 'three';
import type { Game, Soldier, Vec3 } from '../types';
import { VEHICLES } from '../defs';
import { heightAt, lineOfSight } from '../world';
import { eyePos } from '../sim/body';
import { ICON, el, flagLetter, iconEl, ownerClass, setCls, setOneOf, setOp, setShow, setText, setTf } from './hud-util';

interface Mk { root: HTMLElement; ico: HTMLElement; name: HTMLElement; dist: HTMLElement }

class Pool {
  private items: Mk[] = [];
  private n = 0;
  constructor(private parent: HTMLElement, private cls: string, private icoHtml = '') {}
  begin(): void { this.n = 0; }
  take(): Mk {
    let m = this.items[this.n];
    if (!m) {
      const root = el('div', `mk ${this.cls}`, this.parent);
      const inner = el('div', 'mk-in', root);
      const ico = this.icoHtml ? iconEl(this.icoHtml, 'mk-ico', inner) : el('i', 'mk-ico', inner);
      const name = el('span', 'mk-name', inner);
      const dist = el('span', 'mk-dist', inner);
      m = { root, ico, name, dist };
      this.items.push(m);
    }
    this.n++;
    setShow(m.root, true);
    return m;
  }
  end(): void { for (let i = this.n; i < this.items.length; i++) setShow(this.items[i].root, false); }
  hideAll(): void { this.n = 0; this.end(); }
}

export interface MarkerCtx { w: number; h: number; scope: boolean; touch: boolean; activity: number[] }

const _v = new THREE.Vector3();

export class Markers {
  readonly root: HTMLElement;
  private flags: Pool; private enemies: Pool; private friends: Pool; private squad: Pool; private downs: Pool; private vehs: Pool;
  private los = new Map<number, { t: number; v: boolean }>();
  private clock = 0;
  // 투영 결과
  private sx = 0; private sy = 0; private front = false; private cxs = 0; private cys = 0; private czs = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'h-markers', parent);
    this.flags = new Pool(this.root, 'mk-flag');
    this.vehs = new Pool(this.root, 'mk-veh');
    this.friends = new Pool(this.root, 'mk-friend');
    this.downs = new Pool(this.root, 'mk-down', ICON.revive);
    this.squad = new Pool(this.root, 'mk-squad');
    this.enemies = new Pool(this.root, 'mk-enemy');
  }

  hide(): void { for (const p of [this.flags, this.enemies, this.friends, this.squad, this.downs, this.vehs]) p.hideAll(); }

  private project(cam: THREE.PerspectiveCamera, x: number, y: number, z: number, w: number, h: number): void {
    _v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    this.cxs = _v.x; this.cys = _v.y; this.czs = _v.z;
    this.front = _v.z < -0.2;
    if (this.front) {
      _v.applyMatrix4(cam.projectionMatrix);
      this.sx = (_v.x + 1) * 0.5 * w;
      this.sy = (1 - _v.y) * 0.5 * h;
    }
  }

  /** 화면 밖·뒤면 가장자리로 밀어 넣는다. 반환: 가장자리에 붙었나 */
  private clampEdge(w: number, h: number, top: number, bottom: number, side: number): boolean {
    const x0 = side, x1 = w - side, y0 = top, y1 = h - bottom;
    if (this.front && this.sx >= x0 && this.sx <= x1 && this.sy >= y0 && this.sy <= y1) return false;
    const cx = w / 2, cy = (y0 + y1) / 2;
    let dx: number, dy: number;
    if (this.front) { dx = this.sx - cx; dy = this.sy - cy; }
    else { dx = this.cxs; dy = Math.max(Math.abs(this.cys), Math.abs(this.czs) * 0.5) ; if (Math.abs(dx) < 1e-3) dx = 1e-3; }
    const tx = dx > 0 ? (x1 - cx) / dx : dx < 0 ? (x0 - cx) / dx : Infinity;
    const ty = dy > 0 ? (y1 - cy) / dy : dy < 0 ? (y0 - cy) / dy : Infinity;
    const t = Math.min(tx, ty);
    this.sx = cx + dx * t; this.sy = cy + dy * t;
    return true;
  }

  private visible(g: Game, from: Vec3, s: Soldier): boolean {
    const c = this.los.get(s.id);
    if (c && this.clock - c.t < 0.35) return c.v;
    const to = { x: s.pos.x, y: s.pos.y + Math.max(0.5, s.eyeH), z: s.pos.z };
    let v = true;
    try { v = lineOfSight(g.world, from, to); } catch { v = true; }
    this.los.set(s.id, { t: this.clock + Math.random() * 0.1, v });
    return v;
  }

  update(g: Game, dt: number, cam: THREE.PerspectiveCamera, c: MarkerCtx): void {
    this.clock += dt;
    const { w, h } = c;
    const p = g.soldiers[g.player];
    const pv = p.vehicle >= 0 ? g.vehicles[p.vehicle] : null;
    const eye = eyePos(p);
    const top = c.touch ? 120 : 104, bottom = c.touch ? 40 : 110, side = 22;
    const cx = w / 2, cy = h / 2;

    // 거점
    this.flags.begin();
    for (let i = 0; i < g.flags.length; i++) {
      const f = g.flags[i];
      let gy = f.pos.y;
      try { gy = Math.max(f.pos.y, heightAt(g.world, f.pos.x, f.pos.z)); } catch { /* 지형 없음 */ }
      this.project(cam, f.pos.x, gy + 4, f.pos.z, w, h);
      const edge = this.clampEdge(w, h, top, bottom, side);
      const m = this.flags.take();
      const d = Math.hypot(f.pos.x - eye.x, f.pos.z - eye.z);
      setText(m.ico, flagLetter(g, i));
      setOneOf(m.root, 'own', ownerClass(f.owner));
      setCls(m.root, 'pulse', (c.activity[i] ?? 0) > 0);
      setCls(m.root, 'edge', edge);
      const inside = d < f.r;
      setCls(m.root, 'inside', inside);
      const near = !edge && Math.hypot(this.sx - cx, this.sy - cy) < Math.min(110, w * 0.12);
      setText(m.name, near ? f.name : '');
      setText(m.dist, inside ? '' : `${Math.round(d)}m`);
      setOp(m.root, c.scope && !near ? 0.45 : inside ? 0.55 : 1);
      setTf(m.root, `translate3d(${this.sx.toFixed(1)}px,${this.sy.toFixed(1)}px,0)`);
    }
    this.flags.end();

    // 병사
    this.enemies.begin(); this.friends.begin(); this.squad.begin(); this.downs.begin();
    for (const s of g.soldiers) {
      if (s.id === g.player || s.state === 'dead') continue;
      const enemy = s.team !== p.team;
      const dx = s.pos.x - eye.x, dz = s.pos.z - eye.z;
      const d = Math.hypot(dx, dz, s.pos.y - eye.y);
      if (enemy) {
        if (s.spotT <= 0 || s.state !== 'alive' || d > 450) continue;
        const top2 = s.vehicle >= 0 ? s.pos.y + 3 : s.pos.y + Math.max(0.6, s.eyeH) + 0.55;
        this.project(cam, s.pos.x, top2, s.pos.z, w, h);
        if (!this.front || this.sx < 0 || this.sx > w || this.sy < 0 || this.sy > h) continue;
        const m = this.enemies.take();
        setOp(m.root, Math.min(1, 0.5 + s.spotT));
        setTf(m.root, `translate3d(${this.sx.toFixed(1)}px,${this.sy.toFixed(1)}px,0)`);
        continue;
      }
      if (s.vehicle >= 0 && pv && s.vehicle === pv.id) continue;
      const sq = s.squad === p.squad;
      if (s.state === 'down') {
        if (d > 60) continue;
        this.project(cam, s.pos.x, s.pos.y + 0.9, s.pos.z, w, h);
        const edge = sq ? this.clampEdge(w, h, top, bottom, side) : false;
        if (!edge && (!this.front || this.sx < 0 || this.sx > w || this.sy < 0 || this.sy > h)) continue;
        const m = this.downs.take();
        setCls(m.root, 'sq', sq);
        setCls(m.root, 'edge', edge);
        setCls(m.root, 'medic', p.cls === 'support');
        setText(m.name, sq || d < 20 ? s.name : '');
        setText(m.dist, `${Math.round(d)}m`);
        setTf(m.root, `translate3d(${this.sx.toFixed(1)}px,${this.sy.toFixed(1)}px,0)`);
        continue;
      }
      if (s.vehicle >= 0) continue; // 차량 표시가 대신
      const headY = s.pos.y + Math.max(0.6, s.eyeH) + 0.45;
      if (sq) {
        this.project(cam, s.pos.x, headY, s.pos.z, w, h);
        const edge = this.clampEdge(w, h, top, bottom, side);
        const m = this.squad.take();
        setCls(m.root, 'edge', edge);
        setText(m.name, edge || d > 120 ? '' : s.name);
        setText(m.dist, d > 30 && !edge ? `${Math.round(d)}m` : '');
        setOp(m.root, edge ? 0.8 : 1);
        setTf(m.root, `translate3d(${this.sx.toFixed(1)}px,${this.sy.toFixed(1)}px,0)`);
      } else {
        if (d > 40) continue;
        this.project(cam, s.pos.x, headY, s.pos.z, w, h);
        if (!this.front || this.sx < 0 || this.sx > w || this.sy < 0 || this.sy > h) continue;
        if (!this.visible(g, eye, s)) continue;
        const m = this.friends.take();
        setText(m.name, s.name);
        setOp(m.root, d < 25 ? 1 : 1 - (d - 25) / 15);
        setTf(m.root, `translate3d(${this.sx.toFixed(1)}px,${this.sy.toFixed(1)}px,0)`);
      }
    }
    this.enemies.end(); this.friends.end(); this.squad.end(); this.downs.end();

    // 차량
    this.vehs.begin();
    for (const v of g.vehicles) {
      if (!v.alive || v === pv) continue;
      const friendly = v.team === p.team;
      if (!friendly && v.spotT <= 0) continue;
      const d = Math.hypot(v.pos.x - eye.x, v.pos.z - eye.z);
      if (d > (friendly ? 220 : 500)) continue;
      const def = VEHICLES[v.type];
      this.project(cam, v.pos.x, v.pos.y + (def ? def.size.y : 2.5) + 1.2, v.pos.z, w, h);
      if (!this.front || this.sx < 0 || this.sx > w || this.sy < 0 || this.sy > h) continue;
      const m = this.vehs.take();
      setCls(m.root, 'foe', !friendly);
      let free = 0, used = 0;
      for (const sid of v.seats) { if (sid < 0) free++; else used++; }
      setText(m.ico, def ? def.short : v.type);
      setText(m.name, friendly && used > 0 && d < 80 ? `${used}/${v.seats.length}` : '');
      setText(m.dist, d > 40 ? `${Math.round(d)}m` : '');
      setCls(m.root, 'empty', friendly && used === 0 && free > 0);
      setTf(m.root, `translate3d(${this.sx.toFixed(1)}px,${this.sy.toFixed(1)}px,0)`);
    }
    this.vehs.end();

    // 오래된 시야 기록 정리
    if (this.los.size > 160) this.los.clear();
  }
}
