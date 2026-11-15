// 배치 화면: 전장 지도에서 출현 지점 고르기, 병과 탭, 로드아웃 요약, 배치·편집·나가기
import './hud.css';
import type { ClassId, Game, GadgetPick, Profile, SpawnOption, WeaponPick } from '../types';
import { SLOT_IDS } from '../types';
import { ATTACHMENTS, CAT_NAMES, CLASSES, CLASS_IDS, FACTIONS, GADGETS, WEAPONS } from '../defs';
import { spawnOptions } from '../sim/game';
import { saveProfile } from '../profile';
import { drawTactical } from './hud-map';
import { CLASS_ICON, el, iconEl, mmss, setCls, setShow, setText } from './hud-util';

const KIND_NAME: Record<SpawnOption['kind'], string> = { hq: '본부', flag: '거점', squad: '분대원', beacon: '비컨', vehicle: '차량' };
const keyOf = (o: SpawnOption): string => `${o.kind}:${o.ref}`;

export class DeployScreen {
  onDeploy: (opt: SpawnOption, cls: ClassId) => void = () => {};
  onEdit: (cls: ClassId) => void = () => {};
  onQuit: () => void = () => {};

  private g: Game;
  private profile: Profile;
  private root: HTMLElement;
  private opened = false;
  private cls: ClassId;
  private opts: SpawnOption[] = [];
  private optSig = '';
  private sel = -1;
  private selKey = '';
  private userPicked = false;
  private hover = -1;
  private optAcc = 1;
  private mapAcc = 1;
  private clock = 0;
  private mapSize = 300;
  private ro: ResizeObserver | null = null;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private optList: HTMLElement;
  private optBtns: HTMLButtonElement[] = [];
  private tabs: Partial<Record<ClassId, HTMLButtonElement>> = {};
  private clsRole: HTMLElement;
  private clsTrait: HTMLElement;
  private loList: HTMLElement;
  private deployBtn: HTMLButtonElement;
  private head: { map: HTMLElement; t0: HTMLElement; t1: HTMLElement; s0: HTMLElement; s1: HTMLElement; clock: HTMLElement; death: HTMLElement; selName: HTMLElement };

  private onKey = (e: KeyboardEvent): void => {
    if (!this.opened || e.repeat) return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return;
    // 다른 화면(로드아웃 편집 등)이 위에 덮여 있으면 무시
    const top = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    if (top && !this.root.contains(top)) return;
    if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); this.tryDeploy(); return; }
    const m = /^Digit([1-4])$/.exec(e.code);
    if (m) { const c = CLASS_IDS[Number(m[1]) - 1]; if (c) this.pickClass(c); }
  };

  constructor(root: HTMLElement, g: Game, profile: Profile) {
    this.g = g;
    this.profile = profile;
    this.cls = CLASS_IDS.includes(profile.cls) ? profile.cls : CLASS_IDS[0];
    this.root = el('div', 'wl-deploy', root);
    const stop = (ev: Event): void => ev.stopPropagation();
    for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend', 'wheel', 'contextmenu']) this.root.addEventListener(t, stop);

    // 머리
    const hd = el('header', 'dp-head', this.root);
    const brand = el('div', 'dp-brand', hd);
    el('span', 'dp-logo', brand, 'WARLINE');
    el('h2', 'dp-title', brand, '배치');
    const match = el('div', 'dp-match', hd);
    const map = el('span', 'dp-mapname', match, '');
    const tk = el('div', 'dp-tk', match);
    const s0 = el('span', 'dp-fac f', tk, '');
    const t0 = el('b', 'dp-tnum f', tk, '0');
    el('span', 'dp-vs', tk, ':');
    const t1 = el('b', 'dp-tnum e', tk, '0');
    const s1 = el('span', 'dp-fac e', tk, '');
    const clock = el('span', 'dp-clock', match, '');
    const death = el('div', 'dp-death', hd, '');
    this.head = { map, t0, t1, s0, s1, clock, death, selName: el('span', '', null) };

    const body = el('div', 'dp-body', this.root);
    // 지도
    const msec = el('section', 'dp-mapsec', body);
    const wrap = el('div', 'dp-mapwrap', msec);
    this.canvas = el('canvas', 'dp-map', wrap);
    this.ctx = this.canvas.getContext('2d');
    const hint = el('div', 'dp-maphint', msec);
    el('span', '', hint, '지도에서 출현 지점을 고르세요 · ');
    this.head.selName = el('b', '', hint, '');
    this.canvas.addEventListener('pointerdown', (e) => {
      const i = this.pickAt(e.clientX, e.clientY);
      if (i >= 0) { this.select(i, true); }
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const i = this.pickAt(e.clientX, e.clientY);
      if (i !== this.hover) { this.hover = i; this.canvas.style.cursor = i >= 0 ? 'pointer' : 'default'; this.mapAcc = 1; }
    });
    this.canvas.addEventListener('pointerleave', () => { this.hover = -1; this.mapAcc = 1; });
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver((ents) => {
        for (const e of ents) {
          const s = Math.floor(Math.min(e.contentRect.width, e.contentRect.height));
          if (s > 10 && s !== this.mapSize) { this.mapSize = s; this.mapAcc = 1; }
        }
      });
      this.ro.observe(wrap);
    }

    // 옆 칸
    const side = el('aside', 'dp-side', body);
    const so = el('div', 'dp-sec', side);
    el('h3', 'dp-h', so, '출현 지점');
    this.optList = el('div', 'dp-opts', so);

    const sc = el('div', 'dp-sec', side);
    el('h3', 'dp-h', sc, '병과');
    const tabs = el('div', 'dp-tabs', sc);
    CLASS_IDS.forEach((c, i) => {
      const b = el('button', 'dp-tab', tabs);
      b.type = 'button';
      iconEl(CLASS_ICON[c] ?? '', 'ico', b);
      el('span', 'nm', b, CLASSES[c]?.name ?? c);
      el('span', 'k', b, String(i + 1));
      b.addEventListener('click', () => this.pickClass(c));
      this.tabs[c] = b;
    });
    const info = el('div', 'dp-clsinfo', sc);
    this.clsRole = el('div', 'role', info, '');
    this.clsTrait = el('div', 'trait', info, '');

    const sl = el('div', 'dp-sec dp-lo', side);
    const lh = el('div', 'dp-lohead', sl);
    el('h3', 'dp-h', lh, '로드아웃');
    const edit = el('button', 'dp-edit', lh, '로드아웃 편집');
    edit.type = 'button';
    edit.addEventListener('click', () => this.onEdit(this.cls));
    this.loList = el('div', 'lo-list', sl);

    const foot = el('div', 'dp-foot', side);
    const quit = el('button', 'dp-quit', foot, '나가기');
    quit.type = 'button';
    quit.addEventListener('click', () => this.onQuit());
    this.deployBtn = el('button', 'primary dp-go', foot, '배치');
    this.deployBtn.type = 'button';
    this.deployBtn.addEventListener('click', () => this.tryDeploy());

    this.root.style.display = 'none';
    window.addEventListener('keydown', this.onKey);
    this.refresh();
  }

  // ───────────────────────── 공개 ─────────────────────────

  open(): void {
    this.opened = true;
    this.root.style.display = '';
    if (CLASS_IDS.includes(this.profile.cls)) this.cls = this.profile.cls;
    this.optSig = '';
    this.loadOptions();
    // 지난번 고른 곳이 아직 쓸 수 있으면 유지, 아니면 기본값
    const keep = this.userPicked ? this.opts.findIndex((o) => keyOf(o) === this.selKey) : -1;
    if (keep >= 0) this.select(keep, false); else { this.userPicked = false; this.select(this.pickDefault(), false); }
    this.refresh();
    this.optAcc = 0; this.mapAcc = 1;
    this.update(this.g, 0);
  }

  close(): void {
    this.opened = false;
    this.root.style.display = 'none';
  }

  isOpen(): boolean { return this.opened; }

  update(g: Game, dt: number): void {
    if (!this.opened) return;
    if (g !== this.g) { this.g = g; this.optSig = ''; this.sel = -1; }
    this.clock += dt;
    this.optAcc += dt;
    if (this.optAcc >= 0.25) {
      this.optAcc = 0;
      this.loadOptions();
      const i = this.opts.findIndex((o) => keyOf(o) === this.selKey);
      if (i < 0) this.userPicked = false;
      if (!this.userPicked) {
        const d = this.pickDefault();
        if (d !== this.sel) this.select(d, false);
      } else if (i !== this.sel) this.select(i, false);
    }
    this.updateHead();
    this.updateButton();
    this.mapAcc += dt;
    if (this.mapAcc >= 0.2) { this.mapAcc = 0; this.drawMap(); }
  }

  refresh(): void {
    for (const c of CLASS_IDS) { const b = this.tabs[c]; if (b) setCls(b, 'on', c === this.cls); }
    const def = CLASSES[this.cls];
    setText(this.clsRole, def ? `${def.name} · ${def.role}` : '');
    setText(this.clsTrait, def ? def.trait : '');
    this.renderLoadout();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.ro?.disconnect();
    this.root.remove();
  }

  // ───────────────────────── 내부 ─────────────────────────

  private pickClass(c: ClassId): void {
    if (this.cls === c) return;
    this.cls = c;
    this.profile.cls = c;
    try { saveProfile(this.profile); } catch { /* 저장 실패 무시 */ }
    this.refresh();
  }

  private loadOptions(): void {
    let list: SpawnOption[] = [];
    try { list = spawnOptions(this.g, this.g.player); } catch { list = []; }
    const waiting = this.waiting();
    const sig = list.map((o) => `${keyOf(o)}:${o.ok ? 1 : 0}:${o.label}`).join('|') + (waiting ? '|w' : '');
    this.opts = list;
    if (sig === this.optSig) {
      // 위치만 바뀌었을 수 있음 (분대원·차량 이동)
      return;
    }
    this.optSig = sig;
    this.optList.textContent = '';
    this.optBtns = [];
    list.forEach((o, i) => {
      const b = el('button', `dp-opt k-${o.kind}`, this.optList);
      b.type = 'button';
      el('span', 'tag', b, KIND_NAME[o.kind] ?? o.kind);
      el('span', 'lb', b, o.label);
      if (!o.ok && !waiting) el('span', 'st', b, '사용 불가');
      setCls(b, 'na', !o.ok && !waiting);
      b.addEventListener('click', () => this.select(i, true));
      this.optBtns.push(b);
    });
    if (!list.length) el('div', 'dp-empty', this.optList, '출현할 수 있는 곳이 없습니다');
    this.sel = this.opts.findIndex((o) => keyOf(o) === this.selKey);
    this.syncSel();
  }

  /** 재배치 대기 중이면 sim 이 모든 지점을 ok=false 로 준다: 그동안은 종류만 보고 고른다 */
  private waiting(): boolean {
    const p = this.g.soldiers[this.g.player];
    return !!p && p.respawnT > 0 && !this.g.over;
  }

  private pickDefault(): number {
    const o = this.opts;
    if (!o.length) return -1;
    const w = this.waiting();
    const can = (x: SpawnOption): boolean => x.ok || w;
    // 지금 고른 것이 같은 종류로 여전히 쓸 만하면 유지 (분대원 사이를 오가지 않게)
    const cur = o[this.sel];
    const rank = (x: SpawnOption): number => (x.kind === 'squad' ? 0 : x.kind === 'beacon' ? 1 : x.kind === 'flag' ? 2 : x.kind === 'hq' ? 3 : 4);
    let i = o.findIndex((x) => x.kind === 'squad' && can(x));
    if (i < 0) i = o.findIndex((x) => x.kind === 'beacon' && can(x));
    if (i >= 0) return cur && can(cur) && rank(cur) === rank(o[i]) ? this.sel : i;
    // 적 본부에 가장 가까운 내 거점 = 전방 거점
    const p = this.g.soldiers[this.g.player];
    const ehq = this.g.world.hq[p.team === 0 ? 1 : 0];
    let best = -1, bd = Infinity;
    o.forEach((x, k) => {
      if (x.kind !== 'flag' || !can(x)) return;
      const d = Math.hypot(x.pos.x - ehq.x, x.pos.z - ehq.z);
      if (d < bd) { bd = d; best = k; }
    });
    if (best >= 0) return best;
    i = o.findIndex((x) => x.kind === 'hq' && can(x));
    if (i >= 0) return i;
    i = o.findIndex((x) => can(x));
    return i >= 0 ? i : 0;
  }

  private select(i: number, user: boolean): void {
    this.sel = i;
    const o = this.opts[i];
    if (o) this.selKey = keyOf(o);
    if (user) this.userPicked = true;
    this.syncSel();
    this.mapAcc = 1;
    this.updateButton();
  }

  private syncSel(): void {
    this.optBtns.forEach((b, k) => setCls(b, 'on', k === this.sel));
    const o = this.opts[this.sel];
    setText(this.head.selName, o ? `${KIND_NAME[o.kind]} ${o.label}` : '없음');
  }

  private pickAt(cx: number, cy: number): number {
    const r = this.canvas.getBoundingClientRect();
    const x = cx - r.left, y = cy - r.top;
    const S = r.width;
    const k = S / this.g.world.size;
    let best = -1, bd = 30;
    this.opts.forEach((o, i) => {
      const d = Math.hypot(o.pos.x * k - x, o.pos.z * k - y);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  private tryDeploy(): void {
    const o = this.opts[this.sel];
    const p = this.g.soldiers[this.g.player];
    if (!o || !o.ok || p.respawnT > 0 || this.g.over) return;
    this.profile.cls = this.cls;
    this.onDeploy(o, this.cls);
  }

  private updateHead(): void {
    const g = this.g;
    const h = this.head;
    setText(h.map, `${g.opts.map?.name ?? ''} · 정복전`);
    const f0 = FACTIONS[g.sides[0]], f1 = FACTIONS[g.sides[1]];
    setText(h.s0, f0 ? f0.short : '아군');
    setText(h.s1, f1 ? f1.short : '적군');
    setText(h.t0, String(Math.max(0, Math.ceil(g.tickets[0]))));
    setText(h.t1, String(Math.max(0, Math.ceil(g.tickets[1]))));
    setText(h.clock, mmss(g.limit - g.time));
    const p = g.soldiers[g.player];
    const k = p.state === 'dead' && p.deaths > 0 && p.lastHurtBy >= 0 && p.lastHurtBy !== p.id ? g.soldiers[p.lastHurtBy] : undefined;
    setShow(h.death, !!k);
    if (k) setText(h.death, `전사 — ${k.name}${CLASSES[k.cls] ? ` (${CLASSES[k.cls].name})` : ''} 에게 당했습니다`);
  }

  private updateButton(): void {
    const p = this.g.soldiers[this.g.player];
    const o = this.opts[this.sel];
    let text = '배치', ok = true;
    if (this.g.over) { text = '전투 종료'; ok = false; }
    else if (p.respawnT > 0) { text = `재배치 ${Math.ceil(p.respawnT)}초`; ok = false; }
    else if (!o) { text = '출현 지점 없음'; ok = false; }
    else if (!o.ok) { text = '배치 불가'; ok = false; }
    setText(this.deployBtn, text);
    if (this.deployBtn.disabled !== !ok) this.deployBtn.disabled = !ok;
    setCls(this.deployBtn, 'wait', p.respawnT > 0);
  }

  private drawMap(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = this.mapSize;
    const W = Math.round(S * dpr);
    if (this.canvas.width !== W) {
      this.canvas.width = W; this.canvas.height = W;
      this.canvas.style.width = `${S}px`; this.canvas.style.height = `${S}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    drawTactical(ctx, this.g, 0, 0, S, { names: true, showPlayer: false, time: this.clock, options: this.opts, selected: this.sel, hover: this.hover });
  }

  private weaponRow(slot: string, pick: WeaponPick): void {
    const def = WEAPONS[pick.id];
    const row = el('div', 'lo-row', this.loList);
    el('span', 'lo-slot', row, slot);
    const main = el('div', 'lo-main', row);
    const top = el('div', 'lo-top', main);
    el('span', 'lo-name', top, def ? def.name : pick.id);
    if (def) el('span', 'lo-cat', top, CAT_NAMES[def.cat] ?? def.cat);
    const atts: string[] = [];
    if (def) {
      for (const s of SLOT_IDS) {
        const a = pick.att[s];
        const list = def.slots[s];
        if (!a || !list || a === list[0]) continue;
        const ad = ATTACHMENTS[a];
        if (ad) atts.push(ad.name);
      }
    }
    el('div', 'lo-sub', main, atts.length ? atts.join(' · ') : '기본 구성');
  }

  private gadgetRow(slot: string, pick: GadgetPick): void {
    const def = GADGETS[pick.id];
    const row = el('div', 'lo-row g', this.loList);
    el('span', 'lo-slot', row, slot);
    el('span', 'lo-gico', row, def ? def.icon : '?');
    const main = el('div', 'lo-main', row);
    el('div', 'lo-name', main, def ? def.name : pick.id);
    const v = def ? def.variants.find((x) => x.id === pick.variant) ?? def.variants[0] : undefined;
    el('div', 'lo-sub', main, v ? v.name : '');
  }

  private renderLoadout(): void {
    this.loList.textContent = '';
    const lo = this.profile.loadouts[this.cls];
    if (!lo) { el('div', 'dp-empty', this.loList, '로드아웃 없음'); return; }
    this.weaponRow('주무기', lo.primary);
    this.weaponRow('보조', lo.secondary);
    this.gadgetRow('장비 1', lo.gadget1);
    this.gadgetRow('장비 2', lo.gadget2);
    this.gadgetRow('투척', lo.throwable);
  }
}
