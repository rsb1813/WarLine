// 상단 가운데: 나침반 띠, 정복전 막대(티켓·거점·시계)
import type { Game, Vec3 } from '../types';
import { FACTIONS } from '../defs';
import { el, flagLetter, mmss, ownerClass, setBar, setCls, setOneOf, setShow, setStyle, setText, setTf } from './hud-util';

const VISIBLE = 110; // 띠에 보이는 각도
const CARD: Record<number, string> = { 0: '북', 45: '북동', 90: '동', 135: '남동', 180: '남', 225: '남서', 270: '서', 315: '북서' };

export class Compass {
  readonly root: HTMLElement;
  private strip: HTMLElement;
  private readout: HTMLElement;
  private marks: HTMLElement;
  private flagMarks: HTMLElement[] = [];
  private enemyMarks: HTMLElement[] = [];
  private squadMarks: HTMLElement[] = [];
  private width = 440;
  private ppd = 4;
  private ro: ResizeObserver | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'h-compass', parent);
    const win = el('div', 'cp-win', this.root);
    this.strip = el('div', 'cp-strip', win);
    for (let d = -180; d <= 540; d += 5) {
      const n = ((d % 360) + 360) % 360;
      const major = n % 15 === 0;
      const t = el('i', major ? 'cp-tk major' : 'cp-tk', this.strip);
      t.style.left = `calc(var(--ppd) * ${d + 180})`;
      if (major) {
        const card = CARD[n];
        const lab = el('b', card ? (n % 90 === 0 ? 'cp-lb card' : 'cp-lb ic') : 'cp-lb', this.strip, card ?? String(n));
        lab.style.left = `calc(var(--ppd) * ${d + 180})`;
      }
    }
    this.marks = el('div', 'cp-marks', win);
    el('i', 'cp-notch', this.root);
    this.readout = el('div', 'cp-read', this.root, '000');
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver((ents) => {
        for (const e of ents) {
          const w = e.contentRect.width;
          if (w > 0) { this.width = w; this.ppd = w / VISIBLE; this.root.style.setProperty('--ppd', `${this.ppd.toFixed(3)}px`); }
        }
      });
      this.ro.observe(win);
    }
    this.root.style.setProperty('--ppd', `${this.ppd}px`);
  }

  dispose(): void { this.ro?.disconnect(); }

  private pool(arr: HTMLElement[], i: number, cls: string): HTMLElement {
    let e = arr[i];
    if (!e) { e = el('i', cls, this.marks); arr.push(e); }
    return e;
  }

  /** 방위(도) 를 띠의 x 로. 보이는 범위 밖이면 가장자리 */
  private place(e: HTMLElement, bearing: number, target: number, clampEdge: boolean): boolean {
    let d = target - bearing;
    d = ((d + 540) % 360) - 180;
    const half = this.width / 2;
    let x = d * this.ppd;
    const lim = half - 6;
    if (x > lim || x < -lim) {
      if (!clampEdge) { setShow(e, false); return false; }
      x = x > 0 ? lim : -lim;
      setCls(e, 'edge', true);
    } else setCls(e, 'edge', false);
    setShow(e, true);
    setTf(e, `translate3d(${(half + x).toFixed(1)}px,0,0)`);
    return true;
  }

  update(g: Game, bearing: number, from: Vec3): void {
    const b = ((bearing % 360) + 360) % 360;
    setTf(this.strip, `translate3d(${(this.width / 2 - (b + 180) * this.ppd).toFixed(1)}px,0,0)`);
    setText(this.readout, String(Math.round(b) % 360).padStart(3, '0'));
    const bear = (x: number, z: number): number => {
      const a = Math.atan2(x - from.x, -(z - from.z)) * 180 / Math.PI;
      return (a + 360) % 360;
    };
    // 거점
    for (let i = 0; i < g.flags.length; i++) {
      const f = g.flags[i];
      const e = this.pool(this.flagMarks, i, 'cp-flag');
      setText(e, flagLetter(g, i));
      setOneOf(e, 'own', ownerClass(f.owner));
      this.place(e, b, bear(f.pos.x, f.pos.z), true);
    }
    for (let i = g.flags.length; i < this.flagMarks.length; i++) setShow(this.flagMarks[i], false);
    // 표시된 적, 분대원
    const p = g.soldiers[g.player];
    let ne = 0, ns = 0;
    for (const s of g.soldiers) {
      if (s.state === 'dead' || s.id === g.player) continue;
      if (s.team !== p.team) {
        if (s.spotT <= 0 || ne >= 24) continue;
        const e = this.pool(this.enemyMarks, ne++, 'cp-enemy');
        this.place(e, b, bear(s.pos.x, s.pos.z), false);
      } else if (s.squad === p.squad) {
        if (ns >= 4) continue;
        const e = this.pool(this.squadMarks, ns++, 'cp-squad');
        this.place(e, b, bear(s.pos.x, s.pos.z), false);
      }
    }
    for (const v of g.vehicles) {
      if (!v.alive || v.team === p.team || v.spotT <= 0 || ne >= 24) continue;
      const e = this.pool(this.enemyMarks, ne++, 'cp-enemy');
      this.place(e, b, bear(v.pos.x, v.pos.z), false);
    }
    for (let i = ne; i < this.enemyMarks.length; i++) setShow(this.enemyMarks[i], false);
    for (let i = ns; i < this.squadMarks.length; i++) setShow(this.squadMarks[i], false);
  }
}

interface FlagBox { root: HTMLElement; fill: HTMLElement; letter: HTMLElement; last: number; act: number }

export class Conquest {
  readonly root: HTMLElement;
  private tk: { num: HTMLElement; bar: HTMLElement; side: HTMLElement; wrap: HTMLElement }[] = [];
  private flagsEl: HTMLElement;
  private boxes: FlagBox[] = [];
  private clock: HTMLElement;
  /** 거점별 진행 변화 정도 (0..1, 깜빡임) */
  readonly activity: number[] = [];

  constructor(parent: HTMLElement, g: Game) {
    this.root = el('div', 'h-conq', parent);
    const row = el('div', 'cq-row', this.root);
    this.tk.push(this.mkTeam(row, 0));
    const mid = el('div', 'cq-mid', row);
    this.flagsEl = el('div', 'cq-flags', mid);
    this.clock = el('div', 'cq-clock', mid, '0:00');
    this.tk.push(this.mkTeam(row, 1));
    this.setGame(g);
  }

  private mkTeam(row: HTMLElement, team: 0 | 1): { num: HTMLElement; bar: HTMLElement; side: HTMLElement; wrap: HTMLElement } {
    const wrap = el('div', `cq-team t${team}`, row);
    const head = el('div', 'cq-head', wrap);
    const side = el('span', 'cq-side', head);
    const num = el('span', 'cq-num', head, '0');
    const bar = el('div', 'cq-bar', wrap);
    const fill = el('i', '', bar);
    return { num, bar: fill, side, wrap };
  }

  setGame(g: Game): void {
    this.flagsEl.textContent = '';
    this.boxes = [];
    for (let i = 0; i < g.flags.length; i++) {
      const root = el('div', 'cq-flag', this.flagsEl);
      const fill = el('i', 'cq-ffill', root);
      const letter = el('b', '', root, flagLetter(g, i));
      this.boxes.push({ root, fill, letter, last: g.flags[i].prog, act: 0 });
    }
    for (let t = 0; t < 2; t++) {
      const f = FACTIONS[g.sides[t]];
      setText(this.tk[t].side, f ? f.short : t === 0 ? '아군' : '적군');
    }
  }

  update(g: Game, dt: number, insideFlag: number): void {
    if (this.boxes.length !== g.flags.length) this.setGame(g);
    const max = Math.max(1, g.maxTickets);
    for (let t = 0; t < 2; t++) {
      const n = Math.max(0, Math.ceil(g.tickets[t]));
      setText(this.tk[t].num, String(n));
      setBar(this.tk[t].bar, n / max);
      setCls(this.tk[t].wrap, 'low', n / max < 0.2);
    }
    for (let i = 0; i < this.boxes.length; i++) {
      const f = g.flags[i];
      const bx = this.boxes[i];
      const moving = Math.abs(f.prog - bx.last) > 1e-5 && dt > 0;
      bx.last = f.prog;
      bx.act = moving ? 1 : Math.max(0, bx.act - dt * 1.5);
      const pulsing = f.contested || bx.act > 0.05;
      this.activity[i] = pulsing ? 1 : 0;
      setOneOf(bx.root, 'own', ownerClass(f.owner));
      setOneOf(bx.fill, 'pf', f.prog >= 0 ? 'pf-0' : 'pf-1');
      setStyle(bx.fill, 'transform', `scaleY(${Math.min(1, Math.abs(f.prog)).toFixed(3)})`);
      setCls(bx.root, 'pulse', pulsing);
      setCls(bx.root, 'contested', f.contested);
      setCls(bx.root, 'here', i === insideFlag);
    }
    this.activity.length = this.boxes.length;
    setText(this.clock, mmss(g.limit - g.time));
    setCls(this.clock, 'low', g.limit - g.time < 60);
  }
}
