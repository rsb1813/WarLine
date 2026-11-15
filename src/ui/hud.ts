// 전투 HUD: 나침반·정복전 막대·미니맵·분대·사살 기록·무기·체력·조준선·피격 표시·3D 표시·점령·상호작용·쓰러짐·차량·조준경·화면 효과·점수판·큰 지도
import './hud.css';
import * as THREE from 'three';
import type { Game, GameEvent, Soldier, Vehicle } from '../types';
import { VEHICLES } from '../defs';
import { DEG, clamp, damp, wrapAngle, yawTo } from '../math';
import { MiniMap, drawTactical, flagActivity } from './hud-map';
import { Compass, Conquest } from './hud-top';
import { Markers } from './hud-markers';
import { HealthPanel, SquadList, VehiclePanel, WeaponPanel } from './hud-panels';
import { Banner, KillFeed, Popups } from './hud-feed';
import { Scoreboard } from './hud-board';
import { ScopeView } from './hud-scope';
import {
  CLASS_ICON, ICON, clamp01, el, flagIndex, flagLetter, iconEl, isTouch, ownerClass, setAttr, setBar, setCls, setOneOf, setOp,
  setShow, setStyle, setText, setTf, svgEl, weaponLabel,
} from './hud-util';

type HudButton = 'scoreboard' | 'map' | 'pause';
interface Arc { g: SVGElement; age: number; yaw: number; on: boolean }

const _dir = new THREE.Vector3();
const ARC_LIFE = 1.8;

export class Hud {
  onButton: (b: HudButton) => void = () => {};
  onGiveUp: () => void = () => {};
  /** 지금 할 수 있는 상호작용 글 (예: '소생 (이름)'), 없으면 null. 터치 버튼 글자로 쓸 수 있다 */
  interact: string | null = null;

  private g: Game;
  private root: HTMLElement;
  private touch = false;
  private mq: MediaQueryList | null = null;
  private clock = 0;

  // 구성 요소
  private compass: Compass;
  private conquest: Conquest;
  private mini: MiniMap;
  private miniWrap: HTMLElement;
  private squad: SquadList;
  private feed: KillFeed;
  private pops: Popups;
  private banner: Banner;
  private markers: Markers;
  private hp: HealthPanel;
  private wp: WeaponPanel;
  private veh: VehiclePanel;
  private board: Scoreboard;
  private scope: ScopeView;

  // 가운데
  private center: HTMLElement;
  private xh: HTMLElement;
  private xhGap = 12;
  private hitEl: HTMLElement;
  private hitT = 0; private hitMax = 0.3;
  private dmgSvg: SVGElement;
  private arcs: Arc[] = [];

  // 패널
  private cap: { root: HTMLElement; letter: HTMLElement; name: HTMLElement; status: HTMLElement; fill: HTMLElement; pct: HTMLElement; nf: HTMLElement; ne: HTMLElement };
  private prompt: { root: HTMLElement; key: HTMLElement; text: HTMLElement; bar: HTMLElement; fill: HTMLElement };
  private lock: HTMLElement;
  private down: { root: HTMLElement; fill: HTMLElement; time: HTMLElement; sub: HTMLElement; medic: HTMLElement; btn: HTMLElement; hint: HTMLElement };
  private downMax = 0;
  private giveHold = 0;
  private spaceHeld = false;
  private killcard: { root: HTMLElement; ico: HTMLElement; name: HTMLElement; info: HTMLElement };
  private killer: { id: number; weapon: string; head: boolean; dist: number } | null = null;
  private over: { root: HTMLElement; title: HTMLElement; sub: HTMLElement };

  // 효과
  private fxLow: HTMLElement; private fxDesat: HTMLElement; private fxDmg: HTMLElement; private fxFlash: HTMLElement; private fxDown: HTMLElement;
  private dmgFlash = 0;

  // 큰 지도
  private bigmap: { root: HTMLElement; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null; title: HTMLElement; size: number };
  private mapOpen = false;
  private mapAcc = 1;
  private ro: ResizeObserver | null = null;

  // 거점 알림용
  private lastOwned: number[] = [];
  private losingT: number[] = [];

  private onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'Space') return;
    if (e.type === 'keydown') this.spaceHeld = true; else this.spaceHeld = false;
  };
  private onMq = (): void => this.setTouch(isTouch());

  constructor(root: HTMLElement, g: Game) {
    this.g = g;
    this.root = el('div', 'wl-hud', root);
    const R = this.root;

    // 화면 효과 (맨 아래)
    const fx = el('div', 'h-fx', R);
    this.fxDesat = el('div', 'fx-desat', fx);
    this.fxLow = el('div', 'fx-low', fx);
    this.fxDown = el('div', 'fx-down', fx);
    this.fxDmg = el('div', 'fx-dmg', fx);
    this.markers = new Markers(R);
    this.scope = new ScopeView(R);
    this.fxFlash = el('div', 'fx-flash', R);

    // 가운데
    this.center = el('div', 'h-center', R);
    this.xh = el('div', 'h-xh', this.center);
    for (const c of ['t', 'b', 'l', 'r']) el('i', `xl ${c}`, this.xh);
    el('i', 'xd', this.xh);
    el('i', 'xring', this.xh);
    this.hitEl = el('div', 'h-hit', this.center);
    for (const c of ['a', 'b', 'c', 'd']) el('i', c, this.hitEl);
    this.dmgSvg = svgEl('svg', { class: 'h-dmg', viewBox: '-100 -100 200 200' }, this.center);
    for (let i = 0; i < 6; i++) {
      const g0 = svgEl('g', {}, this.dmgSvg);
      const R0 = 80, a = 22 * DEG;
      const x = (R0 * Math.sin(a)).toFixed(2), y = (-R0 * Math.cos(a)).toFixed(2);
      svgEl('path', { d: `M -${x} ${y} A ${R0} ${R0} 0 0 1 ${x} ${y}`, class: 'arc-o' }, g0);
      svgEl('path', { d: `M -${x} ${y} A ${R0} ${R0} 0 0 1 ${x} ${y}`, class: 'arc-i' }, g0);
      svgEl('path', { d: `M -7 ${-R0 - 9} L 0 ${-R0 - 17} L 7 ${-R0 - 9} Z`, class: 'arc-t' }, g0);
      g0.style.display = 'none';
      this.arcs.push({ g: g0, age: 0, yaw: 0, on: false });
    }
    this.pops = new Popups(this.center);

    // 위 가운데
    const top = el('div', 'h-top', R);
    this.compass = new Compass(top);
    this.conquest = new Conquest(top, g);

    // 왼쪽 위
    const tl = el('div', 'h-tl', R);
    this.miniWrap = el('div', 'h-mini', tl);
    this.mini = new MiniMap(this.miniWrap);
    for (const c of ['a', 'b', 'c', 'd']) el('i', `mm-corner ${c}`, this.miniWrap);
    this.squad = new SquadList(tl);

    // 오른쪽 위
    const tr = el('div', 'h-tr', R);
    const btns = el('div', 'h-btns', tr);
    const mkBtn = (b: HudButton, icon: string, label: string, key: string): void => {
      const bt = el('button', 'h-btn', btns);
      bt.type = 'button';
      bt.setAttribute('aria-label', label);
      bt.title = label;
      iconEl(icon, 'ico', bt);
      el('span', 'k', bt, key);
      this.guard(bt);
      bt.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.onButton(b); });
    };
    mkBtn('scoreboard', ICON.board, '점수판', 'Tab');
    mkBtn('map', ICON.map, '지도', 'M');
    mkBtn('pause', ICON.pause, '일시정지', 'Esc');
    this.feed = new KillFeed(tr);

    this.banner = new Banner(R);

    // 점령 패널
    {
      const root = el('div', 'h-cap', R);
      const head = el('div', 'cap-head', root);
      const letter = el('span', 'cap-letter', head, 'A');
      const nm = el('div', 'cap-nm', head);
      const name = el('span', 'cap-name', nm, '');
      const status = el('span', 'cap-status', nm, '');
      const cnt = el('div', 'cap-cnt', head);
      const nfw = el('span', 'cap-nf', cnt);
      iconEl(ICON.person, 'ci', nfw);
      const nf = el('b', '', nfw, '0');
      const new_ = el('span', 'cap-ne', cnt);
      iconEl(ICON.person, 'ci', new_);
      const ne = el('b', '', new_, '0');
      const barRow = el('div', 'cap-barrow', root);
      const bar = el('div', 'cap-bar', barRow);
      const fill = el('i', '', bar);
      const pct = el('span', 'cap-pct', barRow, '0%');
      this.cap = { root, letter, name, status, fill, pct, nf, ne };
      setShow(root, false);
    }
    // 상호작용 안내
    {
      const root = el('div', 'h-prompt', R);
      const key = el('span', 'pr-key', root, 'E');
      const text = el('span', 'pr-text', root, '');
      const bar = el('div', 'pr-bar', root);
      const fill = el('i', '', bar);
      this.prompt = { root, key, text, bar, fill };
      setShow(root, false);
    }
    this.lock = el('div', 'h-lock', R, '미사일 경고');
    setShow(this.lock, false);

    // 체력·무기·차량 (터치에서는 한 덩어리)
    const status = el('div', 'h-status', R);
    this.hp = new HealthPanel(status);
    this.wp = new WeaponPanel(status);
    this.veh = new VehiclePanel(status);
    setShow(this.veh.root, false);

    // 쓰러짐
    {
      const root = el('div', 'h-down', R);
      el('div', 'dn-title', root, '쓰러짐');
      const barWrap = el('div', 'dn-barwrap', root);
      const bar = el('div', 'dn-bar', barWrap);
      const fill = el('i', '', bar);
      const time = el('span', 'dn-time', barWrap, '');
      const sub = el('div', 'dn-sub', root, '의무병을 기다리는 중');
      const medic = el('div', 'dn-medic', root, '');
      const btn = el('button', 'dn-give', root, '포기하고 재배치');
      btn.type = 'button';
      this.guard(btn);
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.onGiveUp(); });
      const hint = el('div', 'dn-hint', root, '스페이스를 길게 눌러 포기');
      this.down = { root, fill, time, sub, medic, btn, hint };
      setShow(root, false);
    }
    // 전사 카드
    {
      const root = el('div', 'h-killcard', R);
      el('div', 'kc-title', root, '전사');
      const row = el('div', 'kc-row', root);
      const ico = el('span', 'kc-ico', row);
      const name = el('span', 'kc-name', row, '');
      const info = el('div', 'kc-info', root, '');
      this.killcard = { root, ico, name, info };
      setShow(root, false);
    }
    // 판 끝
    {
      const root = el('div', 'h-over', R);
      const title = el('div', 'ov-title', root, '');
      const sub = el('div', 'ov-sub', root, '');
      this.over = { root, title, sub };
      setShow(root, false);
    }
    // 큰 지도
    {
      const root = el('div', 'h-bigmap', R);
      this.guard(root);
      const frame = el('div', 'bm-frame', root);
      const head = el('div', 'bm-head', frame);
      const title = el('div', 'bm-title', head, '전장 지도');
      const legend = el('div', 'bm-legend', head);
      for (const [c, t] of [['friend', '아군'], ['squad', '분대'], ['enemy', '표시된 적']]) {
        const it = el('span', `lg ${c}`, legend);
        el('i', '', it);
        el('span', '', it, t);
      }
      const close = el('button', 'bm-close', head);
      close.type = 'button';
      close.setAttribute('aria-label', '닫기');
      iconEl(ICON.close, 'ico', close);
      close.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.onButton('map'); });
      const wrap = el('div', 'bm-wrap', frame);
      const canvas = el('canvas', 'bm-canvas', wrap);
      this.bigmap = { root, canvas, ctx: canvas.getContext('2d'), title, size: 400 };
      if (typeof ResizeObserver !== 'undefined') {
        this.ro = new ResizeObserver((ents) => {
          for (const e of ents) {
            const s = Math.floor(Math.min(e.contentRect.width, e.contentRect.height));
            if (s > 0) { this.bigmap.size = s; this.mapAcc = 1; }
          }
        });
        this.ro.observe(wrap);
      }
      setShow(root, false);
    }
    // 점수판
    this.board = new Scoreboard(R);
    this.guard(this.board.root);
    this.board.onClose = () => this.onButton('scoreboard');

    this.setTouch(isTouch());
    try {
      this.mq = matchMedia('(pointer: coarse)');
      this.mq.addEventListener('change', this.onMq);
    } catch { this.mq = null; }
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    this.setGame(g);
  }

  /** 버튼 등을 누를 때 게임(시선·포인터 잠금)으로 이벤트가 새지 않게 */
  private guard(e: HTMLElement): void {
    const stop = (ev: Event): void => { ev.stopPropagation(); };
    for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'wheel']) e.addEventListener(t, stop, { passive: true });
  }

  private setTouch(on: boolean): void {
    this.touch = on;
    setCls(this.root, 'touch', on);
    this.feed.max = on ? 4 : 5;
  }

  private setGame(g: Game): void {
    this.g = g;
    this.conquest.setGame(g);
    this.lastOwned = g.flags.map((f) => f.owner);
    this.losingT = g.flags.map(() => -99);
    setText(this.bigmap.title, `${g.opts.map?.name ?? '전장'} 지도`);
    this.feed.clear();
    setShow(this.over.root, false);
  }

  // ───────────────────────── 공개 API ─────────────────────────

  showScoreboard(on: boolean): void {
    if (on === this.board.open) return;
    this.board.show(on);
    if (on) this.board.update(this.g, 1);
  }

  toggleMap(): void {
    this.mapOpen = !this.mapOpen;
    setShow(this.bigmap.root, this.mapOpen);
    this.mapAcc = 1;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    try { this.mq?.removeEventListener('change', this.onMq); } catch { /* 무시 */ }
    this.ro?.disconnect();
    this.compass.dispose();
    this.mini.dispose();
    this.root.remove();
  }

  // ───────────────────────── 이벤트 ─────────────────────────

  event(e: GameEvent, g: Game): void {
    if (g !== this.g) this.setGame(g);
    const pid = g.player;
    switch (e.k) {
      case 'kill': {
        this.feed.kill(g, e.s, e.by, e.weapon, e.head, false);
        if (e.s === pid) {
          const k = e.by >= 0 && e.by !== pid ? g.soldiers[e.by] : undefined;
          const me = g.soldiers[pid];
          this.killer = { id: k ? k.id : -1, weapon: e.weapon, head: e.head, dist: k ? Math.round(Math.hypot(k.pos.x - me.pos.x, k.pos.z - me.pos.z)) : 0 };
        }
        break;
      }
      case 'down':
        this.feed.kill(g, e.s, e.by, e.weapon, e.head, true);
        break;
      case 'revive':
        this.feed.forget(e.s);
        if (e.s === pid) this.banner.show('소생되었습니다', g.soldiers[e.by] ? `${g.soldiers[e.by].name} 님이 일으켜 주었습니다` : '', 'good', 2.2);
        break;
      case 'spawn':
        this.feed.forget(e.s);
        if (e.s === pid) {
          this.downMax = 0; this.killer = null; this.dmgFlash = 0;
          for (const a of this.arcs) { a.on = false; a.g.style.display = 'none'; }
        }
        break;
      case 'hit': {
        if (e.by === pid && e.target !== pid) this.hitMarker(e.head, e.kill, false);
        if (e.target === pid && e.by !== pid) {
          const me = g.soldiers[pid];
          const by = e.by >= 0 ? g.soldiers[e.by] : undefined;
          const yaw = by ? yawTo(me.pos, by.pos) : me.lastHurtYaw;
          this.damageArc(yaw);
          this.dmgFlash = Math.min(1, this.dmgFlash + 0.25 + e.dmg / 60);
          this.hp.hurt();
        }
        break;
      }
      case 'vhit':
        if (e.by === pid) {
          const me = g.soldiers[pid];
          if (me.vehicle !== e.v) this.hitMarker(false, e.kill, true);
        } else {
          const me = g.soldiers[pid];
          if (me.vehicle === e.v) {
            const by = e.by >= 0 ? g.soldiers[e.by] : undefined;
            const v = g.vehicles[e.v];
            if (by && v) this.damageArc(yawTo(v.pos, by.pos));
            this.dmgFlash = Math.min(1, this.dmgFlash + 0.2);
          }
        }
        break;
      case 'vdestroyed':
        this.feed.vehicle(g, e.v, e.by);
        break;
      case 'score':
        if (e.s === pid) this.pops.add(e.text, e.pts, e.pts >= 100);
        break;
      case 'flag': this.flagEvent(e, g); break;
      case 'msg': this.banner.show(e.text, '', e.tone, 3); break;
      case 'over': {
        const win = e.winner === g.soldiers[pid].team;
        setText(this.over.title, win ? '승리' : '패배');
        setText(this.over.sub, g.over?.reason ?? (win ? '적의 증원 병력이 바닥났습니다' : '아군 증원 병력이 바닥났습니다'));
        setOneOf(this.over.root, 'res', win ? 'win' : 'lose');
        setShow(this.over.root, true);
        break;
      }
      default: break;
    }
  }

  private flagEvent(e: Extract<GameEvent, { k: 'flag' }>, g: Game): void {
    const i = flagIndex(g, e.flag);
    if (i < 0) return;
    const L = flagLetter(g, i);
    const name = g.flags[i].name;
    const mine = g.soldiers[g.player].team;
    if (e.what === 'captured') {
      if (e.team === mine) this.banner.show(`거점 ${L} 점령`, name, 'good');
      else this.banner.show(`적이 거점 ${L}를 점령했습니다`, name, 'bad');
      if (e.team === 0 || e.team === 1) this.lastOwned[i] = e.team;
    } else if (e.what === 'neutralized') {
      const prev = this.lastOwned[i] ?? -1;
      const lostByUs = prev === mine || (prev === -1 && e.team !== mine);
      if (lostByUs) this.banner.show(`거점 ${L}를 잃었습니다`, name, 'bad');
      else this.banner.show(`거점 ${L} 무력화`, name, 'good');
    } else if (e.what === 'losing') {
      if (g.flags[i].owner === mine && this.clock - (this.losingT[i] ?? -99) > 15) {
        this.losingT[i] = this.clock;
        this.banner.show(`거점 ${L}가 공격받고 있습니다`, name, 'bad', 2.4);
      }
    }
  }

  private hitMarker(head: boolean, kill: boolean, veh: boolean): void {
    this.hitMax = kill ? 0.5 : head ? 0.34 : 0.26;
    this.hitT = this.hitMax;
    setCls(this.hitEl, 'kill', kill);
    setCls(this.hitEl, 'head', head);
    setCls(this.hitEl, 'veh', veh && !kill);
  }

  private damageArc(yaw: number): void {
    let best: Arc | null = null;
    for (const a of this.arcs) if (a.on && Math.abs(wrapAngle(a.yaw - yaw)) < 18 * DEG) { best = a; break; }
    if (!best) for (const a of this.arcs) if (!a.on) { best = a; break; }
    if (!best) { best = this.arcs[0]; for (const a of this.arcs) if (a.age > best.age) best = a; }
    best.on = true; best.age = 0; best.yaw = yaw;
    best.g.style.display = '';
  }

  // ───────────────────────── 매 프레임 ─────────────────────────

  update(g: Game, dt: number, cam: THREE.PerspectiveCamera, view: { w: number; h: number }, scope: { active: boolean; zoom: number; reticle: string }): void {
    if (g !== this.g) this.setGame(g);
    this.clock += dt;
    const p = g.soldiers[g.player];
    if (!p) return;
    const deployed = !g.playerNeedsDeploy;
    const alive = deployed && p.state === 'alive';
    const downed = deployed && p.state === 'down';
    const dead = p.state === 'dead';
    const veh: Vehicle | null = p.vehicle >= 0 ? g.vehicles[p.vehicle] ?? null : null;
    const scopeOn = scope.active && alive && !veh;

    // 카메라 방향 → 방위
    cam.updateMatrixWorld();
    cam.getWorldDirection(_dir);
    const hl = Math.hypot(_dir.x, _dir.z);
    const camYaw = hl > 0.05 ? Math.atan2(-_dir.x, -_dir.z) : p.yaw;
    const bearing = -camYaw;
    const aspect = view.h > 0 ? view.w / view.h : 1.6;
    const hfovHalf = Math.atan(Math.tan((cam.fov * DEG) / 2) * aspect);
    const here = veh ? veh.pos : p.pos;

    // 거점 안에 있나
    let inside = -1;
    if (alive || downed) {
      let best = Infinity;
      for (let i = 0; i < g.flags.length; i++) {
        const f = g.flags[i];
        const d = Math.hypot(f.pos.x - here.x, f.pos.z - here.z);
        if (d < f.r && d < best) { best = d; inside = i; }
      }
    }
    for (let i = 0; i < g.flags.length; i++) if (g.flags[i].owner !== -1) this.lastOwned[i] = g.flags[i].owner;

    // 위
    this.compass.update(g, ((bearing / DEG) % 360 + 360) % 360, here);
    this.conquest.update(g, dt, inside);
    flagActivity.length = this.conquest.activity.length;
    for (let i = 0; i < this.conquest.activity.length; i++) flagActivity[i] = this.conquest.activity[i];

    // 미니맵·분대
    const vdef = veh ? VEHICLES[veh.type] : undefined;
    this.mini.range = vdef ? (vdef.air ? 300 : 170) : 110;
    this.mini.update(g, bearing, hfovHalf, dt, this.clock);
    this.squad.update(g);

    // 기록·알림
    this.feed.update(dt);
    this.pops.update(dt);
    this.banner.update(dt);

    // 체력·무기·차량
    setShow(this.hp.root, alive || downed);
    if (alive || downed) this.hp.update(p, dt);
    setShow(this.wp.root, alive && !veh);
    if (alive && !veh) this.wp.update(p, this.touch);
    setShow(this.veh.root, !!veh && alive);
    if (veh && alive) this.veh.update(g, veh, p, this.touch);
    setCls(this.root, 'in-veh', !!veh);

    // 조준선
    this.updateCrosshair(p, veh, alive, scopeOn, cam, view, dt);

    // 맞힘 표시
    if (this.hitT > 0) {
      this.hitT = Math.max(0, this.hitT - dt);
      const k = this.hitT / this.hitMax;
      setShow(this.hitEl, true);
      setOp(this.hitEl, Math.min(1, k * 1.6));
      setTf(this.hitEl, `translate(-50%,-50%) scale(${(0.85 + 0.5 * k).toFixed(3)})`);
    } else setShow(this.hitEl, false);

    // 피격 방향
    for (const a of this.arcs) {
      if (!a.on) continue;
      a.age += dt;
      if (a.age > ARC_LIFE || !(alive || downed)) { a.on = false; a.g.style.display = 'none'; continue; }
      const rel = wrapAngle(a.yaw - camYaw);
      setAttr(a.g, 'transform', `rotate(${(-rel / DEG).toFixed(1)})`);
      const t = a.age / ARC_LIFE;
      setAttr(a.g, 'opacity', (t < 0.1 ? 1 : 1 - (t - 0.1) / 0.9).toFixed(2));
    }

    // 3D 표시
    if (deployed && !dead) {
      this.markers.root.style.display = '';
      this.markers.update(g, dt, cam, { w: view.w, h: view.h, scope: scopeOn, touch: this.touch, activity: this.conquest.activity });
    } else this.markers.root.style.display = 'none';

    this.updateCapture(g, inside, alive || downed);
    this.updatePrompt(g, p, veh, alive);
    this.updateDown(g, p, downed, dt);
    this.updateKillcard(g, dead && deployed);

    // 미사일 경고
    const lw = veh && alive ? veh.lockWarn : 0;
    setShow(this.lock, lw > 0.05);
    setText(this.lock, lw > 0.3 ? '미사일 경고' : '조준 고정 감지');
    setCls(this.lock, 'hot', lw > 0.3);

    // 조준경
    this.scope.update(scopeOn, scope.reticle, scope.zoom, view.w, view.h);
    setCls(this.root, 'scoped', scopeOn);

    // 화면 효과
    this.updateFx(p, alive, downed, dt);

    // 점수판·큰 지도
    this.board.update(g, dt);
    if (this.mapOpen) {
      this.mapAcc += dt;
      if (this.mapAcc >= 0.1) { this.mapAcc = 0; this.drawBigMap(g); }
    }
  }

  private updateCrosshair(p: Soldier, veh: Vehicle | null, alive: boolean, scopeOn: boolean, cam: THREE.PerspectiveCamera, view: { w: number; h: number }, dt: number): void {
    let mode: 'gun' | 'veh' | 'gad' | 'none' = 'none';
    let gap = 10;
    if (alive && !scopeOn) {
      if (veh) {
        const def = VEHICLES[veh.type];
        const seat = def ? def.seats[p.seat] : undefined;
        if (seat && seat.weapon) mode = 'veh';
      } else if (p.held === 'gadget') {
        mode = 'gad';
      } else if (p.ads <= 0.5) {
        const w = p.weapons[p.cur];
        if (w) {
          mode = 'gun';
          const st = w.st;
          const speed = Math.hypot(p.vel.x, p.vel.z);
          let deg = st.hipSpread + w.bloom + st.moveSpread * Math.min(1.6, speed / 5);
          if (!p.onGround) deg += st.moveSpread * 0.5;
          deg = deg * (1 - p.ads) + (st.adsSpread + w.bloom) * p.ads;
          const half = (cam.fov * DEG) / 2;
          gap = (Math.tan(deg * DEG) / Math.tan(half)) * (view.h / 2);
          gap = clamp(gap, 2.5, view.h * 0.3);
        }
      }
    }
    setShow(this.xh, mode !== 'none');
    if (mode === 'none') return;
    setOneOf(this.xh, 'mode', `m-${mode}`);
    if (mode === 'gun') {
      this.xhGap += (gap - this.xhGap) * damp(22, dt);
      setStyle(this.xh, '--gap', `${this.xhGap.toFixed(1)}px`);
      setOp(this.xh, p.sprinting || p.swapT > 0 ? 0.25 : 1 - p.ads * 1.4);
      const w = p.weapons[p.cur];
      setCls(this.xh, 'shotgun', !!w && w.st.pellets > 1);
    } else setOp(this.xh, 1);
  }

  private updateCapture(g: Game, i: number, active: boolean): void {
    const c = this.cap;
    if (i < 0 || !active) { setShow(c.root, false); return; }
    const f = g.flags[i];
    const mine = g.soldiers[g.player].team;
    const other = mine === 0 ? 1 : 0;
    const nf = f.n[mine] ?? 0, ne = f.n[other] ?? 0;
    setShow(c.root, true);
    setText(c.letter, flagLetter(g, i));
    setText(c.name, f.name);
    setOneOf(c.root, 'own', ownerClass(f.owner));
    // prog 는 0팀 기준: 내 팀 쪽으로 돌린다
    const myProg = mine === 0 ? f.prog : -f.prog;
    let status: string, tone: string;
    if (f.contested || (nf > 0 && ne > 0)) { status = '교전 중'; tone = 'warn'; }
    else if (nf > 0) {
      if (f.owner === mine && myProg >= 0.999) { status = '확보됨'; tone = 'ok'; }
      else if (myProg < 0 || f.owner === other) { status = '무력화 중'; tone = 'go'; }
      else { status = '점령 중'; tone = 'go'; }
    } else if (ne > 0) { status = '적이 점령 중'; tone = 'bad'; }
    else { status = f.owner === mine ? '확보됨' : f.owner === other ? '적 거점' : '중립'; tone = f.owner === mine ? 'ok' : 'idle'; }
    setText(c.status, status);
    setOneOf(c.status, 'tone', `tone-${tone}`);
    const a = Math.min(1, Math.abs(f.prog));
    setBar(c.fill, a);
    setOneOf(c.fill, 'pf', f.prog >= 0 ? 'pf-0' : 'pf-1');
    setText(c.pct, `${Math.round(a * 100)}%`);
    setText(c.nf, String(nf));
    setText(c.ne, String(ne));
  }

  private updatePrompt(g: Game, p: Soldier, veh: Vehicle | null, alive: boolean): void {
    const pr = this.prompt;
    let text: string | null = null;
    let prog = -1;
    if (alive && !veh) {
      if (p.reviving >= 0) {
        const t = g.soldiers[p.reviving];
        text = `소생 중 · ${t ? t.name : ''}`;
        prog = p.reviveProg;
      } else {
        let bestD = 1.8, best: Soldier | null = null;
        for (const s of g.soldiers) {
          if (s.team !== p.team || s.state !== 'down' || s.id === p.id) continue;
          const d = Math.hypot(s.pos.x - p.pos.x, s.pos.z - p.pos.z, s.pos.y - p.pos.y);
          if (d < bestD) { bestD = d; best = s; }
        }
        if (best) text = `소생 (${best.name})`;
        else {
          let bv: Vehicle | null = null, bvd = Infinity;
          for (const v of g.vehicles) {
            if (!v.alive) continue;
            const def = VEHICLES[v.type];
            const reach = def ? Math.max(def.size.x, def.size.z) * 0.5 + 1.8 : 4;
            const d = Math.hypot(v.pos.x - p.pos.x, v.pos.z - p.pos.z);
            if (d > reach || d > 7 || d >= bvd) continue;
            let free = false, empty = true;
            for (const sid of v.seats) { if (sid < 0) free = true; else empty = false; }
            if (!free || (v.team !== p.team && !empty)) continue;
            bv = v; bvd = d;
          }
          if (bv) {
            const def = VEHICLES[bv.type];
            text = `탑승 (${def ? def.name : bv.type})`;
          }
        }
      }
    } else if (alive && veh) text = '하차';
    this.interact = text;
    const showIt = !!text && (!this.touch || prog >= 0);
    setShow(pr.root, showIt);
    if (!showIt || !text) return;
    setText(pr.text, text);
    setShow(pr.key, !this.touch);
    setShow(pr.bar, prog >= 0);
    if (prog >= 0) setBar(pr.fill, prog);
    setCls(pr.root, 'small', !!veh);
  }

  private updateDown(g: Game, p: Soldier, downed: boolean, dt: number): void {
    const d = this.down;
    setShow(d.root, downed);
    setCls(this.root, 'is-down', downed);
    if (!downed) { this.downMax = 0; this.giveHold = 0; return; }
    if (p.downT > this.downMax) this.downMax = p.downT;
    const f = this.downMax > 0 ? p.downT / this.downMax : 0;
    setBar(d.fill, f);
    setText(d.time, `${Math.max(0, Math.ceil(p.downT))}초`);
    let reviver: Soldier | null = null;
    for (const s of g.soldiers) if (s.reviving === p.id && s.team === p.team && s.state === 'alive') { reviver = s; break; }
    if (reviver) {
      setText(d.sub, `${reviver.name} 님이 소생시키는 중`);
      setText(d.medic, `${Math.round(clamp01(reviver.reviveProg) * 100)}%`);
      setCls(d.root, 'reviving', true);
    } else {
      setCls(d.root, 'reviving', false);
      setText(d.sub, '의무병을 기다리는 중');
      let md = Infinity, mname = '';
      for (const s of g.soldiers) {
        if (s.team !== p.team || s.id === p.id || s.state !== 'alive' || s.cls !== 'support') continue;
        const dd = Math.hypot(s.pos.x - p.pos.x, s.pos.z - p.pos.z);
        if (dd < md) { md = dd; mname = s.name; }
      }
      setText(d.medic, md < 120 ? `가장 가까운 의무병 ${mname} · ${Math.round(md)}m` : '근처에 의무병이 없습니다');
    }
    setShow(d.hint, !this.touch);
    if (this.spaceHeld && !this.touch) {
      this.giveHold += dt;
      if (this.giveHold >= 1) { this.giveHold = 0; this.spaceHeld = false; this.onGiveUp(); }
    } else this.giveHold = Math.max(0, this.giveHold - dt * 2);
    setStyle(d.btn, '--hold', `${Math.round(this.giveHold * 100)}%`);
  }

  private updateKillcard(g: Game, on: boolean): void {
    const k = this.killcard;
    setShow(k.root, on);
    if (!on) return;
    const kr = this.killer;
    const ks = kr && kr.id >= 0 ? g.soldiers[kr.id] : undefined;
    if (ks) {
      if (k.ico.dataset.cls !== ks.cls) { k.ico.dataset.cls = ks.cls; k.ico.innerHTML = CLASS_ICON[ks.cls] ?? ''; }
      setText(k.name, ks.name);
      const parts = [weaponLabel(kr ? kr.weapon : '')];
      if (kr && kr.dist > 0) parts.push(`${kr.dist}m`);
      if (kr && kr.head) parts.push('헤드샷');
      if (ks.state === 'alive') parts.push(`남은 체력 ${Math.ceil(ks.hp)}`);
      setText(k.info, parts.join(' · '));
      setShow(k.ico, true);
    } else {
      setShow(k.ico, false);
      setText(k.name, kr ? weaponLabel(kr.weapon) : '');
      setText(k.info, '재배치를 기다리는 중');
    }
  }

  private updateFx(p: Soldier, alive: boolean, downed: boolean, dt: number): void {
    const f = p.maxHp > 0 ? Math.max(0, p.hp) / p.maxHp : 1;
    let low = alive ? clamp01((0.5 - f) / 0.5) : 0;
    if (low > 0 && f < 0.25) low = Math.min(1, low * (0.85 + 0.15 * Math.sin(this.clock * 6)));
    setOp(this.fxLow, low);
    setShow(this.fxLow, low > 0.01);
    const desat = downed ? 1 : low * 0.9;
    setOp(this.fxDesat, desat);
    setShow(this.fxDesat, desat > 0.01);
    setShow(this.fxDown, downed);
    this.dmgFlash = Math.max(0, this.dmgFlash - dt * 2.6);
    setOp(this.fxDmg, this.dmgFlash);
    setShow(this.fxDmg, this.dmgFlash > 0.01);
    const blind = alive || downed ? clamp01(p.blindT / 1.2) : 0;
    setOp(this.fxFlash, blind);
    setShow(this.fxFlash, blind > 0.01);
  }

  private drawBigMap(g: Game): void {
    const bm = this.bigmap;
    const ctx = bm.ctx;
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = bm.size;
    const W = Math.round(S * dpr);
    if (bm.canvas.width !== W) { bm.canvas.width = W; bm.canvas.height = W; bm.canvas.style.width = `${S}px`; bm.canvas.style.height = `${S}px`; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    drawTactical(ctx, g, 0, 0, S, { names: true, showPlayer: true, time: this.clock });
  }
}
