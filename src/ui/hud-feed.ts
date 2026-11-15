// 사살 기록, 점수 팝업, 가운데 위 알림 띠
import type { Game } from '../types';
import { VEHICLES } from '../defs';
import { ICON, el, iconEl, relation, setOp, setText, setTf, weaponLabel } from './hud-util';

interface FeedRow { root: HTMLElement; victim: HTMLElement; age: number; s: number; by: number; down: boolean }

const FEED_LIFE = 6;

export class KillFeed {
  readonly root: HTMLElement;
  private rows: FeedRow[] = [];
  /** 쓰러뜨림으로 이미 올라간 병사 → 그 줄 */
  private downRow = new Map<number, { by: number; row: FeedRow | null }>();
  max = 5;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'h-feed', parent);
  }

  private nameEl(g: Game, id: number, parent: HTMLElement, fallback: string): HTMLElement {
    const s = id >= 0 ? g.soldiers[id] : undefined;
    const rel = s ? relation(g, s) : 'enemy';
    const e = el('span', `kf-n ${rel}`, parent, s ? s.name : fallback);
    return e;
  }

  private push(row: FeedRow): void {
    this.rows.push(row);
    this.root.appendChild(row.root);
    while (this.rows.length > this.max) this.drop(0);
  }

  private drop(i: number): void {
    const r = this.rows[i];
    r.root.remove();
    this.rows.splice(i, 1);
    for (const v of this.downRow.values()) if (v.row === r) v.row = null;
  }

  kill(g: Game, s: number, by: number, weapon: string, head: boolean, down: boolean): void {
    if (!down) {
      const prev = this.downRow.get(s);
      if (prev) {
        this.downRow.delete(s);
        if (prev.by === by || by < 0 || by === s) {
          // 쓰러진 뒤 출혈 등으로 죽음: 기존 줄을 사살로 바꾸고 새 줄은 만들지 않는다
          if (prev.row) { prev.row.down = false; prev.row.root.classList.remove('down'); prev.row.age = Math.min(prev.row.age, FEED_LIFE - 2); }
          return;
        }
      }
    }
    const root = el('div', 'kf-row');
    if (down) root.classList.add('down');
    if (s === g.player || by === g.player) root.classList.add('me');
    const self = by < 0 || by === s;
    if (!self) this.nameEl(g, by, root, '');
    const w = el('span', 'kf-w', root, weaponLabel(weapon));
    if (head) { iconEl(ICON.head, 'kf-head', w); }
    if (down) el('span', 'kf-dn', root, '▼');
    const victim = this.nameEl(g, s, root, '');
    const row: FeedRow = { root, victim, age: 0, s, by, down };
    this.push(row);
    if (down) this.downRow.set(s, { by, row });
  }

  vehicle(g: Game, v: number, by: number): void {
    const veh = g.vehicles[v];
    if (!veh) return;
    const root = el('div', 'kf-row veh');
    if (by === g.player) root.classList.add('me');
    if (by >= 0) this.nameEl(g, by, root, '');
    el('span', 'kf-w', root, '파괴');
    const def = VEHICLES[veh.type];
    const p = g.soldiers[g.player];
    const victim = el('span', `kf-n ${veh.team === p.team ? 'friend' : 'enemy'}`, root, def ? def.name : veh.type);
    this.push({ root, victim, age: 0, s: -1, by, down: false });
  }

  forget(s: number): void { this.downRow.delete(s); }

  update(dt: number): void {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const r = this.rows[i];
      r.age += dt;
      if (r.age > FEED_LIFE) { this.drop(i); continue; }
      const t = r.age;
      setOp(r.root, t < 0.15 ? t / 0.15 : t > FEED_LIFE - 0.6 ? (FEED_LIFE - t) / 0.6 : 1);
    }
  }

  clear(): void { while (this.rows.length) this.drop(0); this.downRow.clear(); }
}

interface Pop { root: HTMLElement; age: number }

export class Popups {
  readonly root: HTMLElement;
  private list: Pop[] = [];
  private totalEl: HTMLElement;
  private total = 0;
  private idle = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'h-pops', parent);
    this.totalEl = el('div', 'pp-total', this.root, '');
  }

  add(text: string, pts: number, big: boolean): void {
    const root = el('div', big ? 'pp big' : 'pp');
    el('span', 'pp-t', root, text);
    if (pts) el('span', 'pp-p', root, `${pts > 0 ? '+' : ''}${pts}`);
    this.root.insertBefore(root, this.totalEl.nextSibling);
    this.list.unshift({ root, age: 0 });
    while (this.list.length > 5) { const o = this.list.pop(); o?.root.remove(); }
    this.total += pts;
    this.idle = 0;
    setText(this.totalEl, this.total > 0 ? `+${this.total}` : '');
    this.totalEl.classList.remove('bump');
    void this.totalEl.offsetWidth;
    this.totalEl.classList.add('bump');
  }

  update(dt: number): void {
    this.idle += dt;
    if (this.idle > 3.2 && this.total !== 0) { this.total = 0; setText(this.totalEl, ''); }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      const life = 2.6;
      if (p.age > life) { p.root.remove(); this.list.splice(i, 1); continue; }
      const a = p.age < 0.12 ? p.age / 0.12 : p.age > life - 0.5 ? (life - p.age) / 0.5 : 1;
      setOp(p.root, a);
      setTf(p.root, `translate3d(${(p.age < 0.12 ? (1 - p.age / 0.12) * 14 : 0).toFixed(1)}px,0,0)`);
    }
  }
}

interface Msg { title: string; sub: string; tone: 'good' | 'bad' | 'info'; life: number }

export class Banner {
  readonly root: HTMLElement;
  private title: HTMLElement;
  private sub: HTMLElement;
  private queue: Msg[] = [];
  private cur: Msg | null = null;
  private age = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'h-banner', parent);
    this.title = el('div', 'bn-title', this.root, '');
    this.sub = el('div', 'bn-sub', this.root, '');
    this.root.style.display = 'none';
  }

  show(title: string, sub: string, tone: 'good' | 'bad' | 'info', life = 2.8): void {
    // 같은 글이 이미 줄 서 있으면 건너뜀
    if (this.cur && this.cur.title === title) return;
    if (this.queue.some((m) => m.title === title)) return;
    this.queue.push({ title, sub, tone, life });
    if (this.queue.length > 4) this.queue.shift();
  }

  update(dt: number): void {
    if (this.cur) {
      this.age += dt;
      // 줄이 길면 빨리 넘긴다
      const life = this.queue.length > 0 ? Math.min(this.cur.life, 1.8) : this.cur.life;
      if (this.age > life) { this.cur = null; this.root.style.display = 'none'; }
      else {
        const a = this.age < 0.2 ? this.age / 0.2 : this.age > life - 0.4 ? (life - this.age) / 0.4 : 1;
        setOp(this.root, a);
      }
    }
    if (!this.cur && this.queue.length) {
      this.cur = this.queue.shift() ?? null;
      if (!this.cur) return;
      this.age = 0;
      this.title.textContent = this.cur.title;
      this.sub.textContent = this.cur.sub;
      this.sub.style.display = this.cur.sub ? '' : 'none';
      this.root.className = `h-banner ${this.cur.tone}`;
      this.root.style.display = '';
      setOp(this.root, 0);
      // 등장 애니메이션 다시 시작
      void this.root.offsetWidth;
      this.root.classList.add('in');
    }
  }
}
