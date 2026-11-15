// 점수판: 두 팀 표, 초당 두 번 갱신, 줄 재사용
import type { ClassId, Game, Soldier } from '../types';
import { CLASSES, FACTIONS, SQUAD_NAMES } from '../defs';
import { CLASS_ICON, ICON, el, iconEl, mmss, setCls, setShow, setText } from './hud-util';

interface Row { root: HTMLElement; rank: HTMLElement; ico: HTMLElement; name: HTMLElement; sq: HTMLElement; cells: HTMLElement[]; cls: ClassId | '' }
interface TeamTbl { root: HTMLElement; side: HTMLElement; tickets: HTMLElement; flags: HTMLElement; body: HTMLElement; rows: Row[] }

export class Scoreboard {
  readonly root: HTMLElement;
  private teams: TeamTbl[] = [];
  private title: HTMLElement;
  private clock: HTMLElement;
  private acc = 1;
  open = false;
  onClose: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = el('div', 'h-board', parent);
    const frame = el('div', 'sb-frame', this.root);
    const head = el('div', 'sb-head', frame);
    this.title = el('div', 'sb-title', head, '점수판');
    this.clock = el('div', 'sb-clock', head, '');
    const close = el('button', 'sb-close', head);
    close.type = 'button';
    close.setAttribute('aria-label', '닫기');
    iconEl(ICON.close, 'ico', close);
    close.addEventListener('click', (e) => { e.stopPropagation(); this.onClose(); });
    const cols = el('div', 'sb-cols', frame);
    for (let t = 0; t < 2; t++) {
      const root = el('div', `sb-team t${t}`, cols);
      const th = el('div', 'sb-thead', root);
      const side = el('span', 'sb-side', th, '');
      const flags = el('span', 'sb-flags', th, '');
      const tickets = el('span', 'sb-tk', th, '');
      const hdr = el('div', 'sb-row sb-hdr', root);
      el('span', 'c-rank', hdr, '#');
      el('span', 'c-ico', hdr, '');
      el('span', 'c-name', hdr, '이름');
      for (const [c, lab] of [['c-sc', '점수'], ['c-k', '처치'], ['c-d', '사망'], ['c-a', '도움'], ['c-r', '소생']]) el('span', c, hdr, lab);
      const body = el('div', 'sb-body', root);
      this.teams.push({ root, side, tickets, flags, body, rows: [] });
    }
    this.root.style.display = 'none';
  }

  show(on: boolean): void {
    if (on === this.open) return;
    this.open = on;
    this.root.style.display = on ? '' : 'none';
    if (on) this.acc = 1;
  }

  private row(t: TeamTbl, i: number): Row {
    let r = t.rows[i];
    if (r) return r;
    const root = el('div', 'sb-row', t.body);
    const rank = el('span', 'c-rank', root, '');
    const ico = el('span', 'c-ico', root);
    const nameWrap = el('span', 'c-name', root);
    const name = el('span', 'nm', nameWrap, '');
    const sq = el('span', 'sq', nameWrap, '');
    const cells: HTMLElement[] = [];
    for (const c of ['c-sc', 'c-k', 'c-d', 'c-a', 'c-r']) cells.push(el('span', c, root, ''));
    r = { root, rank, ico, name, sq, cells, cls: '' };
    t.rows.push(r);
    return r;
  }

  update(g: Game, dt: number): void {
    if (!this.open) return;
    this.acc += dt;
    if (this.acc < 0.5) return;
    this.acc = 0;
    const p = g.soldiers[g.player];
    setText(this.title, `${g.opts.map?.name ?? ''} · 정복전`);
    setText(this.clock, mmss(g.limit - g.time));
    for (let t = 0; t < 2; t++) {
      const tbl = this.teams[t];
      const fac = FACTIONS[g.sides[t]];
      setText(tbl.side, fac ? fac.name : t === 0 ? '아군' : '적군');
      setText(tbl.tickets, String(Math.max(0, Math.ceil(g.tickets[t]))));
      let owned = 0;
      for (const f of g.flags) if (f.owner === t) owned++;
      setText(tbl.flags, `거점 ${owned}/${g.flags.length}`);
      setCls(tbl.root, 'mine', t === p.team);
      const list: Soldier[] = g.soldiers.filter((s) => s.team === t);
      list.sort((a, b) => b.score - a.score || b.kills - a.kills || a.id - b.id);
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const r = this.row(tbl, i);
        setShow(r.root, true);
        setText(r.rank, String(i + 1));
        if (r.cls !== s.cls) { r.cls = s.cls; r.ico.innerHTML = CLASS_ICON[s.cls] ?? ''; r.ico.title = CLASSES[s.cls]?.name ?? ''; }
        setText(r.name, s.name);
        const mySquad = s.team === p.team && s.squad === p.squad;
        setText(r.sq, mySquad ? (SQUAD_NAMES[s.squad] ?? '') : '');
        setText(r.cells[0], String(s.score));
        setText(r.cells[1], String(s.kills));
        setText(r.cells[2], String(s.deaths));
        setText(r.cells[3], String(s.assists));
        setText(r.cells[4], String(s.revives));
        setCls(r.root, 'me', s.id === g.player);
        setCls(r.root, 'squad', mySquad && s.id !== g.player);
        setCls(r.root, 'dead', s.state === 'dead');
        setCls(r.root, 'down', s.state === 'down');
      }
      for (let i = list.length; i < tbl.rows.length; i++) setShow(tbl.rows[i].root, false);
    }
  }
}
