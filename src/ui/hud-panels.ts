// 체력, 무기·장비 칸, 차량 정보, 분대 목록
import type { ClassId, Game, GadgetState, Soldier, Stance, Vehicle } from '../types';
import { CLASSES, GADGETS, SQUAD_NAMES, VEHICLES, VWEAPONS, WEAPONS } from '../defs';
import { heightAt } from '../world';
import {
  CLASS_ICON, ICON, MODE_NAMES, STANCE_ICON, STANCE_NAMES, el, iconEl, setBar, setBarY, setCls, setShow, setText,
} from './hud-util';

// ───────────────────────── 체력 ─────────────────────────

export class HealthPanel {
  readonly root: HTMLElement;
  private num: HTMLElement;
  private fill: HTMLElement;
  private ghost: HTMLElement;
  private stance: Record<Stance, HTMLElement>;
  private stanceTxt: HTMLElement;
  private tagStim: HTMLElement;
  private tagProt: HTMLElement;
  private ghostV = 1;
  private ghostHold = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'h-hp', parent);
    const top = el('div', 'hp-top', this.root);
    const st = el('div', 'hp-stance', top);
    this.stance = {
      stand: iconEl(STANCE_ICON.stand, 'hp-st', st),
      crouch: iconEl(STANCE_ICON.crouch, 'hp-st', st),
      prone: iconEl(STANCE_ICON.prone, 'hp-st', st),
    };
    this.stanceTxt = el('span', 'hp-sttxt', top, '');
    const right = el('div', 'hp-numwrap', top);
    el('span', 'hp-lab', right, '체력');
    this.num = el('span', 'hp-num', right, '100');
    const bar = el('div', 'hp-bar', this.root);
    this.ghost = el('i', 'hp-ghost', bar);
    this.fill = el('i', 'hp-fill', bar);
    for (let i = 1; i < 4; i++) { const t = el('b', 'hp-tick', bar); t.style.left = `${i * 25}%`; }
    const tags = el('div', 'hp-tags', this.root);
    this.tagStim = el('span', 'hp-tag stim', tags);
    iconEl(ICON.bolt, 'ti', this.tagStim);
    el('span', '', this.tagStim, '아드레날린');
    this.tagProt = el('span', 'hp-tag prot', tags);
    iconEl(ICON.shield, 'ti', this.tagProt);
    el('span', '', this.tagProt, '보호');
    setShow(this.tagStim, false); setShow(this.tagProt, false);
  }

  update(p: Soldier, dt: number): void {
    const f = p.maxHp > 0 ? Math.max(0, p.hp) / p.maxHp : 0;
    setText(this.num, String(Math.max(0, Math.ceil(p.hp))));
    setBar(this.fill, f);
    // 잃은 체력이 잠시 남아 있다가 줄어드는 막대
    if (f >= this.ghostV) { this.ghostV = f; this.ghostHold = 0; }
    else if (this.ghostHold > 0) this.ghostHold -= dt;
    else this.ghostV = Math.max(f, this.ghostV - dt * 0.8);
    setBar(this.ghost, this.ghostV);
    setCls(this.root, 'low', f <= 0.3);
    setCls(this.root, 'crit', f <= 0.15);
    const stn: Stance = p.state === 'down' ? 'prone' : p.stance;
    for (const k of ['stand', 'crouch', 'prone'] as Stance[]) setCls(this.stance[k], 'on', k === stn);
    setText(this.stanceTxt, p.sliding > 0 ? '미끄러지기' : p.sprinting ? '달리기' : STANCE_NAMES[stn]);
    setShow(this.tagStim, p.stimT > 0);
    setShow(this.tagProt, p.protect > 0);
  }
  /** 피해를 받는 순간 잔상 시작 */
  hurt(): void { this.ghostHold = 0.55; }
}

// ───────────────────────── 무기·장비 ─────────────────────────

interface GSlot { root: HTMLElement; ico: HTMLElement; n: HTMLElement; cd: HTMLElement; key: HTMLElement }

export class WeaponPanel {
  readonly root: HTMLElement;
  private gadgets: GSlot[] = [];
  private name: HTMLElement;
  private mode: HTMLElement;
  private mag: HTMLElement;
  private res: HTMLElement;
  private sep: HTMLElement;
  private fill: HTMLElement;
  private note: HTMLElement;
  private alt: HTMLElement;
  private slot: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'h-wp', parent);
    const gs = el('div', 'wp-gadgets', this.root);
    const keys = ['3', '4', 'G'];
    for (let i = 0; i < 3; i++) {
      const root = el('div', 'gs', gs);
      const cd = el('i', 'gs-cd', root);
      const ico = el('span', 'gs-ico', root, '');
      const n = el('span', 'gs-n', root, '');
      const key = el('span', 'gs-key', root, keys[i]);
      this.gadgets.push({ root, ico, n, cd, key });
    }
    const main = el('div', 'wp-main', this.root);
    const head = el('div', 'wp-head', main);
    this.slot = el('span', 'wp-slot', head, '1');
    this.name = el('span', 'wp-name', head, '');
    this.mode = el('span', 'wp-mode', head, '');
    const ammo = el('div', 'wp-ammo', main);
    this.mag = el('span', 'wp-mag', ammo, '0');
    this.sep = el('span', 'wp-sep', ammo, '/');
    this.res = el('span', 'wp-res', ammo, '0');
    const bar = el('div', 'wp-bar', main);
    this.fill = el('i', '', bar);
    this.note = el('div', 'wp-note', main, '');
    this.alt = el('div', 'wp-alt', main, '');
  }

  private gadgetLine(gs: GadgetState): string {
    const def = GADGETS[gs.id];
    if (gs.uses <= 0 && gs.maxUses > 0) return '남은 장비 없음';
    if (gs.cd > 0) return `준비 중 ${gs.cd.toFixed(1)}초`;
    switch (gs.kind) {
      case 'aa': return gs.active >= 1 ? '조준 고정 완료 · 발사' : gs.active > 0 ? `조준 고정 ${Math.round(gs.active * 100)}%` : '항공기를 조준하세요';
      case 'repair': return gs.active >= 1 ? '과열' : `열 ${Math.round(Math.min(1, gs.active) * 100)}%`;
      case 'breach': return gs.active > 0 ? '다시 눌러 폭파' : '던져서 붙이기';
      case 'defib': return '쓰러진 아군에게 사용';
      case 'drone': return gs.active > 0 ? '드론 비행 중' : '조준 지점으로 띄우기';
      default: return def ? def.desc.split(/[.。]/)[0].slice(0, 26) : '';
    }
  }

  update(p: Soldier, touch: boolean): void {
    for (let i = 0; i < 3; i++) {
      const gs = p.gadgets[i];
      const s = this.gadgets[i];
      if (!gs) { setShow(s.root, false); continue; }
      setShow(s.root, true);
      const def = GADGETS[gs.id];
      setText(s.ico, def ? def.icon : '?');
      setText(s.n, gs.maxUses > 0 ? String(gs.uses) : '∞');
      const cdMax = def ? Math.max(0.01, def.cooldown) : 1;
      setBarY(s.cd, gs.cd > 0 ? gs.cd / cdMax : 0);
      setCls(s.root, 'empty', gs.maxUses > 0 && gs.uses <= 0);
      setCls(s.root, 'held', p.held === 'gadget' && p.heldGadget === i);
      setCls(s.root, 'cool', gs.cd > 0);
      setShow(s.key, !touch);
    }
    if (p.held === 'gadget') {
      const gs = p.gadgets[p.heldGadget];
      const def = gs ? GADGETS[gs.id] : undefined;
      const variant = def && gs ? def.variants.find((v) => v.id === gs.variant) : undefined;
      setText(this.slot, ['3', '4', 'G'][p.heldGadget]);
      setText(this.name, def ? def.name : '장비');
      setText(this.mode, variant && def && variant.name !== def.name ? variant.name : '');
      setText(this.mag, gs ? (gs.maxUses > 0 ? String(gs.uses) : '∞') : '0');
      setText(this.res, gs && gs.maxUses > 0 ? String(gs.maxUses) : '');
      setShow(this.sep, !!gs && gs.maxUses > 0);
      const prog = gs ? (gs.kind === 'aa' || gs.kind === 'repair' ? Math.min(1, gs.active) : gs.maxUses > 0 ? gs.uses / gs.maxUses : 1) : 0;
      setBar(this.fill, prog);
      setCls(this.root, 'reloading', false);
      setCls(this.root, 'lowammo', !!gs && gs.maxUses > 0 && gs.uses <= 0);
      setCls(this.root, 'gadget', true);
      setCls(this.root, 'empty', false);
      setCls(this.root, 'locked', !!gs && gs.kind === 'aa' && gs.active >= 1);
      setText(this.note, gs ? this.gadgetLine(gs) : '');
      const w = p.weapons[p.cur];
      setText(this.alt, w ? `${p.cur + 1} ${w.st.name}` : '');
      return;
    }
    setCls(this.root, 'gadget', false);
    setCls(this.root, 'locked', false);
    const w = p.weapons[p.cur];
    if (!w) return;
    const st = w.st;
    setText(this.slot, String(p.cur + 1));
    setText(this.name, st.name || (WEAPONS[w.id]?.name ?? w.id));
    setText(this.mode, MODE_NAMES[w.mode] ?? '');
    setCls(this.mode, 'multi', st.modes.length > 1);
    setText(this.mag, String(w.mag));
    setText(this.res, String(w.reserve));
    setShow(this.sep, true);
    const reloading = w.reloadT > 0;
    const low = w.mag <= Math.max(1, Math.floor(st.mag * 0.25));
    setCls(this.root, 'reloading', reloading);
    setCls(this.root, 'lowammo', low && !reloading);
    setCls(this.root, 'empty', w.mag === 0 && w.reserve === 0);
    if (reloading) {
      setBar(this.fill, w.reloadTotal > 0 ? 1 - w.reloadT / w.reloadTotal : 0);
      setText(this.note, '재장전 중');
    } else {
      setBar(this.fill, st.mag > 0 ? w.mag / st.mag : 0);
      if (w.mag === 0 && w.reserve === 0) setText(this.note, '탄약 없음');
      else if (w.mag === 0) setText(this.note, touch ? '재장전' : 'R 재장전');
      else if (low) setText(this.note, w.reserve <= 0 ? '탄약 부족' : touch ? '탄창 부족' : '탄창 부족 · R');
      else if (w.reserve < st.mag) setText(this.note, '예비 탄약 부족');
      else if (p.swapT > 0) setText(this.note, '무기 꺼내는 중');
      else setText(this.note, '');
    }
    const o = p.weapons[p.cur === 0 ? 1 : 0];
    setText(this.alt, o ? `${p.cur === 0 ? 2 : 1}  ${o.st.name}` : '');
  }
}

// ───────────────────────── 차량 ─────────────────────────

interface SeatRow { root: HTMLElement; key: HTMLElement; name: HTMLElement; who: HTMLElement }

export class VehiclePanel {
  readonly root: HTMLElement;
  private name: HTMLElement;
  private spd: HTMLElement;
  private alt: HTMLElement;
  private hpNum: HTMLElement;
  private hpFill: HTMLElement;
  private wName: HTMLElement;
  private wAmmo: HTMLElement;
  private wFill: HTMLElement;
  private heat: HTMLElement;
  private heatFill: HTMLElement;
  private seatsEl: HTMLElement;
  private seats: SeatRow[] = [];
  private counter: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'h-veh', parent);
    const head = el('div', 'vh-head', this.root);
    this.name = el('span', 'vh-name', head, '');
    const tele = el('span', 'vh-tele', head);
    this.spd = el('span', 'vh-spd', tele, '0');
    el('small', '', tele, 'km/h');
    this.alt = el('span', 'vh-alt', tele, '');
    const hp = el('div', 'vh-hp', this.root);
    el('span', 'vh-lab', hp, '내구도');
    const bar = el('div', 'vh-bar', hp);
    this.hpFill = el('i', '', bar);
    this.hpNum = el('span', 'vh-hpn', hp, '100');
    const wp = el('div', 'vh-wpn', this.root);
    const wh = el('div', 'vh-wh', wp);
    this.wName = el('span', 'vh-wname', wh, '');
    this.wAmmo = el('span', 'vh-wammo', wh, '');
    const wb = el('div', 'vh-wbar', wp);
    this.wFill = el('i', '', wb);
    this.heat = el('div', 'vh-heat', wp);
    el('span', '', this.heat, '과열');
    const hb = el('div', 'vh-hbar', this.heat);
    this.heatFill = el('i', '', hb);
    this.seatsEl = el('div', 'vh-seats', this.root);
    this.counter = el('div', 'vh-counter', this.root, '');
  }

  update(g: Game, v: Vehicle, p: Soldier, touch: boolean): void {
    const def = VEHICLES[v.type];
    setText(this.name, def ? def.name : v.type);
    const hspd = Math.hypot(v.vel.x, v.vel.z);
    setText(this.spd, String(Math.round(Math.max(Math.abs(v.speed), def && def.air ? hspd : 0) * 3.6)));
    if (def && def.air) {
      let ground = 0;
      try { ground = heightAt(g.world, v.pos.x, v.pos.z); } catch { ground = 0; }
      setText(this.alt, `고도 ${Math.max(0, Math.round(v.pos.y - ground))}m`);
      setShow(this.alt, true);
    } else setShow(this.alt, false);
    const f = v.maxHp > 0 ? Math.max(0, v.hp) / v.maxHp : 0;
    setText(this.hpNum, String(Math.max(0, Math.ceil(v.hp))));
    setBar(this.hpFill, f);
    setCls(this.root, 'low', f <= 0.3);
    setCls(this.root, 'burning', v.burning);
    // 좌석 무기
    const seat = def ? def.seats[p.seat] : undefined;
    const wid = seat ? seat.weapon : null;
    const vw = wid ? VWEAPONS[wid] : undefined;
    const ws = v.wpn[p.seat];
    if (vw && ws) {
      setShow(this.wName.parentElement as HTMLElement, true);
      setText(this.wName, vw.name);
      const reloading = ws.reloadT > 0;
      setText(this.wAmmo, reloading ? '재장전' : vw.mag > 1 ? `${ws.mag} / ${vw.mag}` : ws.mag > 0 ? '준비' : '');
      setBar(this.wFill, reloading ? 1 - ws.reloadT / Math.max(0.01, vw.reload) : vw.mag > 0 ? ws.mag / vw.mag : 1);
      setCls(this.wFill.parentElement as HTMLElement, 'rl', reloading);
      setShow(this.wFill.parentElement as HTMLElement, true);
      const showHeat = vw.kind === 'mg' || vw.kind === 'autocannon' || ws.heat > 0.01;
      setShow(this.heat, showHeat);
      setBar(this.heatFill, Math.min(1, ws.heat));
      setCls(this.heat, 'hot', ws.heat > 0.8);
    } else {
      setText(this.wName, seat ? seat.name : '');
      setText(this.wAmmo, seat && seat.exposed ? '개인 화기 사용' : '무장 없음');
      setShow(this.wFill.parentElement as HTMLElement, false);
      setShow(this.heat, false);
    }
    // 좌석 목록
    const n = v.seats.length;
    while (this.seats.length < n) {
      const root = el('div', 'vh-seat', this.seatsEl);
      const key = el('span', 'vs-key', root, `F${this.seats.length + 1}`);
      const name = el('span', 'vs-name', root, '');
      const who = el('span', 'vs-who', root, '');
      this.seats.push({ root, key, name, who });
    }
    for (let i = 0; i < this.seats.length; i++) {
      const r = this.seats[i];
      if (i >= n) { setShow(r.root, false); continue; }
      setShow(r.root, true);
      setText(r.key, touch ? String(i + 1) : `F${i + 1}`);
      setText(r.name, def && def.seats[i] ? def.seats[i].name : `좌석 ${i + 1}`);
      const sid = v.seats[i];
      const occ = sid >= 0 ? g.soldiers[sid] : undefined;
      setText(r.who, occ ? (occ.id === p.id ? '나' : occ.name) : '—');
      setCls(r.root, 'me', i === p.seat);
      setCls(r.root, 'taken', !!occ && occ.id !== p.id);
      setCls(r.root, 'sq', !!occ && occ.id !== p.id && occ.squad === p.squad);
    }
    // 대응책
    const cname = def && def.counter === 'flare' ? '플레어' : '연막';
    if (v.counterT > 0) setText(this.counter, `${cname} 작동 중`);
    else if (v.counterCd > 0) setText(this.counter, `${cname} ${Math.ceil(v.counterCd)}초`);
    else setText(this.counter, touch ? `${cname} 준비` : `X ${cname} 준비`);
    setCls(this.counter, 'ready', v.counterCd <= 0 && v.counterT <= 0);
  }
}

// ───────────────────────── 분대 ─────────────────────────

interface SqRow { root: HTMLElement; ico: HTMLElement; name: HTMLElement; fill: HTMLElement; st: HTMLElement; cls: ClassId | ''; id: number }

export class SquadList {
  readonly root: HTMLElement;
  private head: HTMLElement;
  private rows: SqRow[] = [];
  private members: number[] = [];

  constructor(parent: HTMLElement) {
    this.root = el('div', 'h-squad', parent);
    this.head = el('div', 'sq-head', this.root, '');
  }

  private rebuild(g: Game): void {
    const p = g.soldiers[g.player];
    this.members = g.soldiers.filter((s) => s.team === p.team && s.squad === p.squad).map((s) => s.id).slice(0, 6);
    // 나를 맨 앞에
    this.members.sort((a, b) => (a === g.player ? -1 : b === g.player ? 1 : a - b));
    for (const r of this.rows) r.root.remove();
    this.rows = [];
    for (const id of this.members) {
      const root = el('div', 'sq-row', this.root);
      const ico = el('span', 'sq-ico', root);
      const name = el('span', 'sq-name', root, '');
      const hp = el('div', 'sq-hp', root);
      const fill = el('i', '', hp);
      const st = el('span', 'sq-st', root, '');
      this.rows.push({ root, ico, name, fill, st, cls: '', id });
    }
    const sqName = SQUAD_NAMES[p.squad] ?? `${p.squad + 1}`;
    setText(this.head, `${sqName} 분대`);
  }

  update(g: Game): void {
    const p = g.soldiers[g.player];
    let n = 0;
    for (const s of g.soldiers) if (s.team === p.team && s.squad === p.squad) n++;
    if (n !== this.members.length || !this.members.includes(g.player)) this.rebuild(g);
    for (const r of this.rows) {
      const s = g.soldiers[r.id];
      if (!s) continue;
      if (r.cls !== s.cls) {
        r.cls = s.cls;
        r.ico.innerHTML = CLASS_ICON[s.cls] ?? '';
        r.ico.title = CLASSES[s.cls]?.name ?? '';
      }
      setText(r.name, s.id === g.player ? `${s.name}` : s.name);
      setCls(r.root, 'me', s.id === g.player);
      const f = s.maxHp > 0 ? Math.max(0, s.hp) / s.maxHp : 0;
      const waiting = s.id === g.player && g.playerNeedsDeploy;
      setBar(r.fill, s.state === 'alive' && !waiting ? f : 0);
      setCls(r.root, 'down', s.state === 'down');
      setCls(r.root, 'dead', s.state === 'dead' || waiting);
      setCls(r.root, 'low', s.state === 'alive' && f <= 0.3);
      const vv = s.vehicle >= 0 ? g.vehicles[s.vehicle] : undefined;
      const vdef = vv ? VEHICLES[vv.type] : undefined;
      setText(r.st, s.state === 'down' ? '쓰러짐' : s.state === 'dead' || waiting ? (s.respawnT > 0 ? `${Math.ceil(s.respawnT)}초` : '대기') : vdef ? vdef.short : '');
    }
  }
}
