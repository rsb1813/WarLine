// 전투 화면: 진행, 카메라, 조작, HUD, 배치, 점수판, 지도, 일시 정지, 결과
import {
  CLASSES, CLASS_ORDER, FACTIONS, FLAG_R, GADGETS, MAPS, RESPAWN_DELAY, SEAT_NAME, SEAT_WEAPON, SIZES, VEHICLES, VWEAPONS, WEAPONS,
  type ClassId,
} from '../game/defs';
import { angDiff, createBattle, deployPlayer, giveUp, spawnOptions, spreadOf, squadName, step } from '../game/battle';
import { nearVehicle } from '../game/vehicles';
import type { Battle, GEvent, Spawn } from '../game/types';
import { rankOf, saveProfile, type Profile } from '../game/profile';
import { Renderer } from '../render/renderer';
import { Sound } from './audio';
import { Input } from './input';
import { kitSummary, renderKit } from './kit';

export interface GameResult {
  win: boolean;
  why: string;
  xp: number;
  rankBefore: number;
  rankAfter: number;
}

const mmss = (t: number) => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, '0')}`;
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const CLS_ICON: Record<ClassId, string> = {
  assault: '<svg viewBox="0 0 24 24"><path d="M4 18 L12 5 L20 18 Z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/></svg>',
  engineer: '<svg viewBox="0 0 24 24"><path d="M5 19 L15 9 M13 5 a5 5 0 0 0 6 6 l-3 -3 z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  medic: '<svg viewBox="0 0 24 24"><path d="M12 5 V19 M5 12 H19" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>',
  recon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 2 V7 M12 17 V22 M2 12 H7 M17 12 H22" stroke="currentColor" stroke-width="2.2"/></svg>',
};
export const clsIcon = (c: ClassId) => CLS_ICON[c];

const HINTS_DESK = [
  'WASD 이동 · 마우스 조준 · 좌클릭 사격 · 우클릭 정조준',
  '깃발 원 안에 아군만 있으면 점령됩니다. 거점이 많을수록 적 티켓이 줄어듭니다',
  'R 재장전 · Shift 달리기 · C 앉기(낮은 엄폐물 뒤에서 탄을 막아 줍니다)',
  '2, 3 장비 · G 수류탄 · Q 적 표시',
  'E 아군 차량 탑승 · 쓰러진 분대원 곁에서 E를 누르고 있으면 일으킵니다',
  '벽은 로켓, 유탄, 전차 포로 부서집니다. 건물은 벽이 절반 넘게 부서지면 무너집니다',
];
const HINTS_TOUCH = [
  '왼쪽을 끌면 이동, 오른쪽을 끌면 조준과 사격',
  '깃발 원 안에 아군만 있으면 점령됩니다',
  '정조준 버튼을 켜면 더 멀리 정확하게 쏩니다',
  '차량 곁에서 탑승 버튼, 쓰러진 분대원 곁에서 소생 버튼을 누르고 있으세요',
];

export class GameScreen {
  b: Battle;
  r: Renderer;
  input: Input;
  snd = new Sound();
  el: HTMLElement;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private paused = false;
  private dead = false;
  private hudT = 0;
  private miniT = 0;
  private hitT = 0;
  private hitKill = false;
  private hurt: { a: number; t: number }[] = [];
  private scores: { text: string; pts: number; t: number }[] = [];
  private feed: { html: string; t: number }[] = [];
  private center: { text: string; tone: string; t: number } | null = null;
  private spawnPick = 'hq';
  private spawnRef = -1;
  private spawns: Spawn[] = [];
  private deployCls: ClassId;
  private deployOpen = false;
  private deployMapT = 0;
  private overT = 0;
  private hintI = 0;
  private hintT = 6;
  private showBoard = false;
  private boardT = 0;
  private showMap = false;
  private q = <T extends HTMLElement>(s: string) => this.el.querySelector(s) as T;
  private onVis = () => { this.last = performance.now(); if (document.hidden && !this.b.over && !this.paused) this.pause(); };

  constructor(root: HTMLElement, private p: Profile, private cb: { end(r: GameResult): void; quit(): void; again(): void }) {
    const map = MAPS.find((m) => m.id === p.map) ?? MAPS[0];
    this.b = createBattle({ map, size: p.size, diff: p.diff, side: p.side, kits: p.kits, playerCls: p.cls, squadCls: p.squad, flip: Math.random() < 0.5 });
    this.deployCls = p.cls;
    const b = this.b;
    const e = b.sides[1];
    root.innerHTML = `<div class="game">
      <canvas class="view"></canvas>
      <div class="vig"></div><div class="supp"></div>
      <div class="hud">
        <div class="top">
          <div class="tk"><b style="color:${FACTIONS[b.sides[0]].color}" data-h="t0"></b><span class="tkbar"><i data-h="b0" style="background:${FACTIONS[b.sides[0]].color}"></i></span>
          <span class="flags" data-h="flags"></span>
          <span class="tkbar rev"><i data-h="b1" style="background:${FACTIONS[e].color}"></i></span><b style="color:${FACTIONS[e].color}" data-h="t1"></b></div>
          <span class="clock" data-h="clock"></span>
        </div>
        <div class="mini"><canvas width="220" height="220"></canvas></div>
        <div class="squad" data-h="squad"></div>
        <div class="feed" data-h="feed"></div>
        <div class="center" data-h="center"></div>
        <div class="cap" data-h="cap" hidden><span data-h="capn"></span><span class="capbar"><i data-h="capb"></i></span><small data-h="caps"></small></div>
        <div class="pops" data-h="pops"></div>
        <div class="obj" data-h="obj"></div>
        <div class="bl"><div class="hp"><i data-h="hp"></i><b data-h="hpn"></b></div><small data-h="cls"></small></div>
        <div class="br"><div class="wpn"><small data-h="wn"></small><b data-h="ammo"></b></div><div class="slots" data-h="slots"></div></div>
        <div class="prompt" data-h="prompt" hidden></div>
        <div class="hint" data-h="hint" hidden></div>
        <div class="tops"><button data-a="board" aria-label="점수판">점수</button><button data-a="map" aria-label="지도">지도</button><button data-a="pause" aria-label="일시 정지">II</button></div>
      </div>
      <div class="pad" hidden>
        <button data-b="ads">정조준</button><button data-b="reload">재장전</button><button data-b="grenade">수류탄</button>
        <button data-b="gA">장비1</button><button data-b="gB">장비2</button><button data-b="crouch">앉기</button><button data-b="spot">표시</button>
        <button data-b="use" class="use" hidden>탑승</button><button data-b="seat" class="vonly" hidden>좌석</button><button data-b="counter" class="vonly" hidden>연막</button>
      </div>
      <div class="down" hidden><b>쓰러졌습니다</b><span data-h="downt"></span><button data-a="giveup">재배치로</button></div>
      <div class="deploy" hidden></div>
      <div class="board" hidden></div>
      <div class="bigmap" hidden><canvas></canvas><button data-a="map">닫기</button></div>
      <div class="pause" hidden></div>
      <div class="end" hidden></div>
    </div>`;
    this.el = root.firstElementChild as HTMLElement;
    this.r = new Renderer(this.q<HTMLCanvasElement>('canvas.view'), b, p.quality);
    this.r.colors = [FACTIONS[b.sides[0]].color, FACTIONS[b.sides[1]].color];
    this.input = new Input(this.q('canvas.view'));
    this.input.onKey = (k, down) => this.key(k, down);
    this.snd.vol = p.volume;
    const hq = b.world.hq[0];
    this.r.cam.x = hq.x; this.r.cam.y = hq.y; this.r.cam.z = this.r.baseZoom();
    this.el.addEventListener('click', (ev) => {
      this.snd.unlock();
      const t = (ev.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
      if (t) this.action(t.dataset.a!, t);
    });
    this.bindPad();
    document.addEventListener('visibilitychange', this.onVis);
    if (import.meta.env.DEV) (window as unknown as { __game: unknown }).__game = this;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVis);
    this.input.destroy();
    this.r.destroy();
    this.snd.close();
  }

  private bindPad() {
    const pad = this.q('.pad');
    for (const btn of Array.from(pad.querySelectorAll<HTMLElement>('[data-b]'))) {
      const k = btn.dataset.b!;
      const down = (e: Event) => {
        e.preventDefault(); e.stopPropagation();
        this.snd.unlock();
        const I = this.input;
        switch (k) {
          case 'ads': I.adsToggle = !I.adsToggle; btn.classList.toggle('on', I.adsToggle); break;
          case 'reload': I.press('reloadE'); break;
          case 'grenade': I.press('grenadeE'); break;
          case 'gA': I.press('useAE'); break;
          case 'gB': I.press('useBE'); break;
          case 'crouch': I.crouch = !I.crouch; btn.classList.toggle('on', I.crouch); break;
          case 'spot': I.press('spotE'); break;
          case 'use': I.press('interactE'); I.hold.interact = true; break;
          case 'seat': I.press('seatE'); break;
          case 'counter': I.press('counterE'); break;
        }
      };
      const up = (e: Event) => { e.preventDefault(); if (k === 'use') this.input.hold.interact = false; };
      btn.addEventListener('touchstart', down, { passive: false });
      btn.addEventListener('touchend', up);
      btn.addEventListener('touchcancel', up);
      btn.addEventListener('mousedown', down);
      btn.addEventListener('mouseup', up);
    }
  }

  private key(k: string, down: boolean) {
    if (k === 'tab') { this.showBoard = down; this.q('.board').hidden = !down; if (down) this.renderBoard(); }
    if (!down) return;
    if (k === 'escape') { if (this.showMap) this.toggleMap(); else if (this.paused) this.resume(); else this.pause(); }
    else if (k === 'm') this.toggleMap();
    else if ((k === 'enter' || k === ' ') && this.b.player.state === 1) giveUp(this.b);
    else if (k === 'enter' && this.deployOpen) this.action('deploy');
  }

  // ───────── 진행 ─────────

  private frame = (now: number) => {
    if (this.dead) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const b = this.b;
    if (!this.paused) {
      this.control();
      this.acc += dt;
      let n = 0;
      while (this.acc >= 1 / 60 && n++ < 3) { step(b, 1 / 60); this.acc -= 1 / 60; }
      if (n >= 3) this.acc = 0;
      this.events();
      if (b.over) { this.overT += dt; if (this.overT > 2.5 && this.q('.end').hidden) this.showEnd(); }
    }
    this.camera(dt);
    this.r.draw(this.paused ? 0 : dt);
    this.overlay(dt);
    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = 0.1; this.hud(); }
  };

  /** 터치 조준을 보이는 적 쪽으로 당긴다 */
  private assist = (a: number): number => {
    const b = this.b, pl = b.player;
    const pv = pl.veh >= 0 ? b.vehicles[pl.veh] : null;
    const px = pv ? pv.x : pl.x, py = pv ? pv.y : pl.y;
    const range = pv ? 900 : pl.ws.range * 0.9;
    let best = a, bd = 0.1 + this.p.assist * 0.32;
    const tryAt = (x: number, y: number) => {
      const dx = x - px, dy = y - py;
      if (dx * dx + dy * dy > range * range) return;
      const t = Math.atan2(dy, dx);
      const d = Math.abs(angDiff(t, a));
      if (d < bd) { bd = d; best = t; }
    };
    for (const s of b.soldiers) if (s.team === 1 && s.state === 0 && s.seen && s.veh < 0) tryAt(s.x + s.vx * 0.12, s.y + s.vy * 0.12);
    for (const v of b.vehicles) if (v.team === 1 && v.alive && v.seen) tryAt(v.x, v.y);
    return best;
  };

  private control() {
    const b = this.b, pl = b.player;
    if (pl.state !== 0 || this.deployOpen) {
      pl.ctl.fire = false; pl.ctl.mx = 0; pl.ctl.my = 0; pl.ctl.interact = false;
      this.input.pending.clear();
      return;
    }
    const v = pl.veh >= 0 ? b.vehicles[pl.veh] : null;
    this.input.read(pl.ctl, v ? v.x : pl.x, v ? v.y : pl.y, (x, y) => this.r.toWorld(x, y), this.assist, this.p.autofire);
  }

  private camera(dt: number) {
    const b = this.b, pl = b.player, cam = this.r.cam, I = this.input;
    let tx = cam.x, ty = cam.y;
    let zoom = this.r.baseZoom();
    if (pl.state !== 2) {
      const v = pl.veh >= 0 ? b.vehicles[pl.veh] : null;
      tx = v ? v.x : pl.x; ty = v ? v.y : pl.y;
      if (v) zoom *= VEHICLES[v.type].air ? 0.62 : 0.78;
      if (pl.state === 0) {
        const ads = pl.ads && !v;
        if (I.touch) {
          const look = ads ? pl.ws.look : v ? 220 : 110;
          const [ax, ay] = I.stick(I.right);
          const m = Math.max(Math.hypot(ax, ay), ads ? 0.8 : 0);
          tx += Math.cos(pl.ctl.aim) * look * m; ty += Math.sin(pl.ctl.aim) * look * m;
        } else if (I.mouse.seen) {
          const k = ads ? 0.3 + pl.ws.look / 650 : v ? 0.45 : 0.3;
          tx += ((I.mouse.x - this.r.cw / 2) / cam.z) * k;
          ty += ((I.mouse.y - this.r.ch / 2) / cam.z) * k;
        }
        if (ads && pl.ws.scope) zoom *= 0.85;
      }
    } else if (b.needDeploy) {
      const sp = this.spawns.find((s) => this.match(s)) ?? b.world.hq[0];
      tx = sp.x; ty = sp.y;
    }
    const k = 1 - Math.pow(0.0008, dt);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    cam.z += (zoom - cam.z) * (1 - Math.pow(0.03, dt));
    this.snd.lx = cam.x; this.snd.ly = cam.y;
  }

  private match(s: Spawn) { return s.kind === this.spawnPick && (s.kind === 'hq' || s.ref === this.spawnRef || (s.kind === 'vehicle' && s.veh === this.spawnRef)); }

  // ───────── 사건 ─────────

  private events() {
    const b = this.b;
    for (const e of b.events) {
      this.r.handle(e);
      this.sound(e);
      switch (e.k) {
        case 'hit': this.hitT = e.kill ? 0.45 : 0.15; this.hitKill = e.kill; break;
        case 'hurt': this.hurt.push({ a: e.a, t: 1 }); if (this.hurt.length > 6) this.hurt.shift(); break;
        case 'score': {
          const last = this.scores[this.scores.length - 1];
          if (last && last.text === e.text && last.t > 1.2) { last.pts += e.pts; last.t = 2; } else this.scores.push({ text: e.text, pts: e.pts, t: 2 });
          if (this.scores.length > 4) this.scores.shift();
          break;
        }
        case 'feed': {
          const kc = this.r.colors[e.kt], vc = this.r.colors[e.vt];
          const html = e.killer ? `<span style="color:${kc}">${esc(e.killer)}</span><i>${esc(e.w || '파괴')}</i><span style="color:${vc}">${esc(e.victim)}</span>` : `<span style="color:${vc}">${esc(e.victim)}</span><i>쓰러짐</i>`;
          this.feed.push({ html: `<p class="${e.me ? 'me' : ''}">${html}</p>`, t: 6 });
          if (this.feed.length > 6) this.feed.shift();
          break;
        }
        case 'cap': this.center = { text: e.team === 0 ? `거점 ${e.tag} 점령` : `거점 ${e.tag} 상실`, tone: e.team === 0 ? 'good' : 'bad', t: 2.6 }; break;
        case 'msg': this.center = { text: e.text, tone: e.tone, t: 2.2 }; break;
      }
    }
    b.events.length = 0;
  }

  private sound(e: GEvent) {
    const S = this.snd;
    switch (e.k) {
      case 'shot': {
        const mine = e.team === 0 && Math.hypot(e.x - this.b.player.x, e.y - this.b.player.y) < 30;
        const w = Object.values(WEAPONS).find((x) => x.kind === e.w);
        if (w) S.shot(e.x, e.y, w.snd, e.supp, mine);
        else if (e.w === 'tankMain') S.big(e.x, e.y, 'tank');
        else if (e.w === 'ifvCannon' || e.w === 'heliGun') S.big(e.x, e.y, 'cannon');
        else if (e.w === 'heliRockets' || e.w === 'rpg' || e.w === 'aa' || e.w === 'ugl' || e.w === 'smokegl') S.big(e.x, e.y, 'rocket');
        else S.shot(e.x, e.y, [0.75, 0.1, 0.8], false, mine);
        break;
      }
      case 'boom': S.boom(e.x, e.y, e.big); break;
      case 'break': if (Math.random() < 0.5) S.crumble(e.x, e.y); break;
      case 'collapse': { const bl = this.b.world.buildings[e.b]; S.crumble((bl.x + bl.w / 2) * 32, (bl.y + bl.h / 2) * 32); break; }
      case 'glass': S.glass(e.x, e.y); break;
      case 'whiz': S.whiz(); break;
      case 'hit': S.hit(e.kill); break;
      case 'hurt': S.hurt(); break;
      case 'cap': S.cap(e.team === 0); break;
      case 'heal': if (Math.hypot(e.x - this.b.player.x, e.y - this.b.player.y) < 60) S.heal(); break;
    }
  }

  // ───────── 화면 위에 그리기 ─────────

  private overlay(dt: number) {
    const r = this.r, ctx = r.ctx, b = this.b, pl = b.player;
    ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
    this.hitT = Math.max(0, this.hitT - dt);
    for (const h of this.hurt) h.t -= dt * 0.8;
    this.hurt = this.hurt.filter((h) => h.t > 0);
    const supp = pl.state === 0 ? pl.suppress : 0;
    this.q('.supp').style.opacity = String(Math.min(0.85, supp));
    const low = pl.state === 0 && pl.veh < 0 && pl.hp < pl.maxHp * 0.35;
    this.q('.vig').style.opacity = String(Math.min(1, (this.hurt.length ? Math.max(...this.hurt.map((h) => h.t)) * 0.7 : 0) + (low ? 0.5 + 0.2 * Math.sin(performance.now() / 200) : 0)));
    // 화면 가장자리 거점 표시
    const edge = 26;
    ctx.font = '800 15px "Saira Condensed", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const goal = this.squadGoal();
    for (const f of b.flags) {
      const [sx, sy] = r.toScreen(f.x, f.y - 34);
      const on = sx > edge && sx < r.cw - edge && sy > 60 && sy < r.ch - edge;
      const col = f.owner >= 0 ? r.colors[f.owner] : '#e8d9a8';
      if (on) {
        if (f === goal) { ctx.fillStyle = 'rgba(8,13,18,0.75)'; ctx.fillRect(sx - 30, sy - 40, 60, 16); ctx.fillStyle = '#ffe9b5'; ctx.font = '600 11px "IBM Plex Sans KR"'; ctx.fillText(f.owner === 0 ? '분대 목표 · 방어' : '분대 목표 · 공격', sx, sy - 32); ctx.font = '800 15px "Saira Condensed", sans-serif'; }
        continue;
      }
      const cx = r.cw / 2, cy = r.ch / 2;
      const a = Math.atan2(sy - cy, sx - cx);
      const t = Math.min((cx - edge) / Math.abs(Math.cos(a) || 1e-6), (cy - edge - 30) / Math.abs(Math.sin(a) || 1e-6));
      const ex = cx + Math.cos(a) * t, ey = cy + 15 + Math.sin(a) * t;
      ctx.fillStyle = 'rgba(8,13,18,0.8)';
      ctx.beginPath(); ctx.arc(ex, ey, f === goal ? 14 : 11, 0, 7); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = f === goal ? 3 : 2; ctx.stroke();
      ctx.fillStyle = col; ctx.fillText(f.tag, ex, ey + 1);
    }
    if (pl.state !== 0) return;
    // 피해 방향
    const [px, py] = r.toScreen(pl.veh >= 0 ? b.vehicles[pl.veh].x : pl.x, pl.veh >= 0 ? b.vehicles[pl.veh].y : pl.y);
    for (const h of this.hurt) {
      ctx.strokeStyle = `rgba(255,70,50,${Math.min(1, h.t)})`;
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(px, py, 64, h.a - 0.35, h.a + 0.35); ctx.stroke();
    }
    // 조준점
    let cx: number, cy: number;
    const pv = pl.veh >= 0 ? b.vehicles[pl.veh] : null;
    if (this.input.touch || !this.input.mouse.seen) {
      const reach = pv ? 260 : pl.ads ? Math.min(pl.ws.look + 60, 500) : 180;
      [cx, cy] = r.toScreen((pv ? pv.x : pl.x) + Math.cos(pl.ctl.aim) * reach, (pv ? pv.y : pl.y) + Math.sin(pl.ctl.aim) * reach);
    } else { cx = this.input.mouse.x; cy = this.input.mouse.y; }
    const dist = Math.hypot(cx - px, cy - py) / r.cam.z;
    let gap = 6;
    if (!pv) gap = Math.max(4, Math.tan(pl.held === 0 ? spreadOf(pl) : 0.03) * dist * r.cam.z);
    const reloading = !pv && pl.reloadT > 0;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 4;
    const ticks = () => { ctx.beginPath(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(cx + dx * gap, cy + dy * gap); ctx.lineTo(cx + dx * (gap + 9), cy + dy * (gap + 9)); } ctx.stroke(); };
    ticks();
    ctx.strokeStyle = reloading ? '#f5b74e' : pv ? '#ffd27a' : '#ffffff'; ctx.lineWidth = 2;
    ticks();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(cx - 1, cy - 1, 2, 2);
    if (reloading) { ctx.beginPath(); ctx.arc(cx, cy, gap + 14, -Math.PI / 2, -Math.PI / 2 + (1 - pl.reloadT / pl.ws.reload) * Math.PI * 2); ctx.stroke(); }
    if (pv) {
      const wid = SEAT_WEAPON[pv.type][pl.seat];
      if (wid && pv.reloadT[pl.seat] > 0) { ctx.strokeStyle = '#f5b74e'; ctx.beginPath(); ctx.arc(cx, cy, 20, -Math.PI / 2, -Math.PI / 2 + (1 - pv.reloadT[pl.seat] / VWEAPONS[wid].reload) * Math.PI * 2); ctx.stroke(); }
    }
    if (this.hitT > 0) {
      ctx.strokeStyle = this.hitKill ? '#ff5a4a' : '#ffffff';
      ctx.lineWidth = this.hitKill ? 3.5 : 2.5;
      const r0 = 8, r1 = this.hitKill ? 20 : 15;
      ctx.beginPath();
      for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { ctx.moveTo(cx + dx * r0, cy + dy * r0); ctx.lineTo(cx + dx * r1, cy + dy * r1); }
      ctx.stroke();
    }
    // 터치 스틱
    for (const s of [this.input.left, this.input.right]) {
      if (!s) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.ox, s.oy, 56, 0, 7); ctx.stroke();
      const [dx, dy] = this.input.stick(s);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.beginPath(); ctx.arc(s.ox + dx * 56, s.oy + dy * 56, 24, 0, 7); ctx.fill();
    }
  }

  private squadGoal() {
    const b = this.b;
    const m = b.soldiers.find((s) => s.team === 0 && s.squad === b.player.squad && s.bot);
    return m ? b.flags[m.ai.goal] : null;
  }

  // ───────── HUD ─────────

  private hud() {
    const b = this.b, pl = b.player, q = this.q;
    const dt = 0.1;
    q('[data-h=t0]').textContent = String(b.tickets[0]);
    q('[data-h=t1]').textContent = String(b.tickets[1]);
    q('[data-h=b0]').style.width = `${(b.tickets[0] / b.startTickets[0]) * 100}%`;
    q('[data-h=b1]').style.width = `${(b.tickets[1] / b.startTickets[1]) * 100}%`;
    q('[data-h=flags]').innerHTML = b.flags.map((f) => {
      const c = f.owner >= 0 ? this.r.colors[f.owner] : '';
      const hot = f.n[0] > 0 && f.n[1] > 0;
      return `<i class="${hot ? 'hot' : ''}" style="${c ? `background:${c};border-color:${c};color:#0a1016` : ''}">${f.tag}</i>`;
    }).join('');
    q('[data-h=clock]').textContent = mmss(b.limit - b.time);
    // 분대
    q('[data-h=squad]').innerHTML = `<h5>${squadName(b, pl)} 분대</h5>` + b.soldiers.filter((s) => s.team === 0 && s.squad === pl.squad).map((s) => {
      const st = s.state === 2 ? '전사' : s.state === 1 ? '쓰러짐' : s.veh >= 0 ? VEHICLES[b.vehicles[s.veh].type].short : '';
      return `<p class="${s === pl ? 'me' : ''} st${s.state}"><span class="ci">${CLS_ICON[s.cls]}</span><b>${esc(s.name)}</b><span class="mh"><i style="width:${s.state === 0 ? (s.hp / s.maxHp) * 100 : 0}%"></i></span><small>${st}</small></p>`;
    }).join('');
    // 소식
    for (const f of this.feed) f.t -= dt;
    this.feed = this.feed.filter((f) => f.t > 0);
    q('[data-h=feed]').innerHTML = this.feed.map((f) => f.html).join('');
    for (const s of this.scores) s.t -= dt;
    this.scores = this.scores.filter((s) => s.t > 0);
    q('[data-h=pops]').innerHTML = this.scores.map((s) => `<p style="opacity:${Math.min(1, s.t * 2)}"><b>+${s.pts}</b> ${esc(s.text)}</p>`).join('');
    const c = q('[data-h=center]');
    if (this.center) { this.center.t -= dt; c.textContent = this.center.text; c.className = `center ${this.center.tone}`; if (this.center.t <= 0) this.center = null; }
    else c.className = 'center gone';
    // 체력과 무기
    const pv = pl.veh >= 0 ? b.vehicles[pl.veh] : null;
    const hp = pv ? pv.hp / pv.maxHp : pl.hp / pl.maxHp;
    q('[data-h=hp]').style.width = `${Math.max(0, hp) * 100}%`;
    q('[data-h=hp]').className = hp < 0.35 ? 'low' : '';
    q('[data-h=hpn]').textContent = pv ? `${VEHICLES[pv.type].name} ${Math.ceil(pv.hp)}` : String(Math.ceil(pl.hp));
    q('[data-h=cls]').textContent = pv ? SEAT_NAME[pv.type][pl.seat] : CLASSES[pl.cls].name;
    if (pv) {
      const wid = SEAT_WEAPON[pv.type][pl.seat];
      q('[data-h=wn]').textContent = wid ? VWEAPONS[wid].name : '무기 없음';
      q('[data-h=ammo]').textContent = wid ? (pv.reloadT[pl.seat] > 0 ? '장전 중' : `${pv.mag[pl.seat]}`) : '—';
      const cm = pv.type === 'heli' ? '섬광탄' : pv.type === 'jeep' ? '' : '연막';
      q('[data-h=slots]').innerHTML = `${cm ? `<span class="${pv.cmCd > 0 ? 'cd' : ''}"><kbd>Space</kbd>${cm}${pv.cmCd > 0 ? ` ${Math.ceil(pv.cmCd)}` : ''}</span>` : ''}<span><kbd>F</kbd>좌석</span><span><kbd>E</kbd>하차</span>${pv.type === 'tank' && pl.seat === 0 ? '<span><kbd>우클릭</kbd>기관총</span>' : ''}`;
    } else {
      const g = (id: string, st: { ammo: number; cd: number }, key: string, held: boolean) => {
        const d = GADGETS[id as keyof typeof GADGETS];
        const v = d.use === 'passive' ? '상시' : d.ammo ? `×${st.ammo}` : st.cd > 0 ? `${Math.ceil(st.cd)}초` : '준비';
        return `<span class="${held ? 'on' : ''} ${st.cd > 0 || (d.ammo && !st.ammo) ? 'cd' : ''}"><kbd>${key}</kbd>${d.name} <em>${v}</em></span>`;
      };
      const w = pl.held === 0 ? pl.ws : null;
      q('[data-h=wn]').textContent = w ? `${w.name} ${w.kind}` : GADGETS[pl.held === 1 ? pl.kit.ga : pl.kit.gb].name;
      q('[data-h=ammo]').innerHTML = w ? (pl.reloadT > 0 ? '재장전' : `${pl.mag}<small>/${pl.reserve}</small>`) : `${(pl.held === 1 ? pl.ga : pl.gb).ammo || ''}`;
      q('[data-h=slots]').innerHTML = g(pl.kit.ga, pl.ga, '2', pl.held === 1) + g(pl.kit.gb, pl.gb, '3', pl.held === 2) + `<span class="${pl.frags ? '' : 'cd'}"><kbd>G</kbd>수류탄 <em>×${pl.frags}</em></span>`;
    }
    // 점령 막대
    const cap = q('[data-h=cap]');
    const at = pl.state === 0 ? b.flags.find((f) => Math.hypot(f.x - (pv ? pv.x : pl.x), f.y - (pv ? pv.y : pl.y)) < FLAG_R) : undefined;
    cap.hidden = !at;
    if (at) {
      q('[data-h=capn]').textContent = `거점 ${at.tag} · ${at.name}`;
      const bi = q('[data-h=capb]');
      bi.style.width = `${Math.abs(at.prog) * 100}%`;
      bi.style.background = this.r.colors[at.prog <= 0 ? 0 : 1];
      q('[data-h=caps]').textContent = at.n[0] && at.n[1] ? `교전 중 · 아군 ${at.n[0]} : 적 ${at.n[1]}` : at.owner === 0 && at.prog <= -0.999 ? '확보한 거점' : at.n[0] ? '점령 중' : '';
    }
    // 목표 안내
    const goal = this.squadGoal();
    q('[data-h=obj]').textContent = goal && !at ? `분대 목표: 거점 ${goal.tag} ${goal.name} ${goal.owner === 0 ? '방어' : '공격'}` : '';
    // 상호작용 안내
    const prompt = q('[data-h=prompt]');
    let ptext = '';
    if (pl.state === 0 && !pv) {
      const nv = nearVehicle(b, pl);
      const downed = b.soldiers.find((o) => o.state === 1 && o.team === 0 && (pl.cls === 'medic' || o.squad === pl.squad) && Math.hypot(o.x - pl.x, o.y - pl.y) < 44);
      if (downed) ptext = `${this.input.touch ? '소생 버튼' : 'E'}를 누르고 있으면 ${downed.name}을(를) 일으킵니다`;
      else if (nv) ptext = `${this.input.touch ? '탑승 버튼' : 'E'} · ${VEHICLES[nv.type].name} 탑승`;
      const use = q('[data-b=use]');
      use.hidden = !downed && !nv;
      use.textContent = downed ? '소생' : '탑승';
    } else if (pv) {
      q('[data-b=use]').hidden = false;
      q('[data-b=use]').textContent = '하차';
    }
    prompt.hidden = !ptext || this.input.touch;
    prompt.textContent = ptext;
    const pad = q('.pad');
    pad.hidden = !this.input.touch || pl.state !== 0;
    pad.classList.toggle('inveh', !!pv);
    for (const x of Array.from(pad.querySelectorAll<HTMLElement>('.vonly'))) x.hidden = !pv;
    if (pv) q('[data-b=counter]').textContent = pv.type === 'heli' ? '섬광탄' : '연막';
    // 힌트
    const hint = q('[data-h=hint]');
    if (this.p.hints && b.time < 150 && pl.state === 0) {
      this.hintT -= dt;
      const list = this.input.touch ? HINTS_TOUCH : HINTS_DESK;
      if (this.hintT <= 0) { this.hintT = 9; this.hintI++; }
      const i = this.hintI - 1;
      hint.hidden = i < 0 || i >= list.length;
      if (!hint.hidden) hint.textContent = list[i];
    } else hint.hidden = true;
    // 쓰러짐
    const down = q('.down');
    down.hidden = pl.state !== 1;
    if (pl.state === 1) q('[data-h=downt]').textContent = `의무병을 기다리는 중 · ${Math.ceil(pl.downT)}초`;
    // 배치
    if (b.needDeploy && !b.over) { if (!this.deployOpen) this.openDeploy(); else this.updateDeploy(); }
    // 지도
    this.miniT -= dt;
    if (this.miniT <= 0) { this.miniT = 0.2; this.drawMini(); }
    if (this.showMap) this.drawBig();
    if (this.showBoard) { this.boardT -= dt; if (this.boardT <= 0) this.renderBoard(); }
    // 엔진 소리
    this.snd.setEngine(pv ? pv.type : null, pv ? Math.abs(pv.spd) : 0);
    this.snd.setWind(0.03 + (this.b.world.theme === 'snow' ? 0.04 : 0));
  }

  // ───────── 지도 ─────────

  private mapLayer(ctx: CanvasRenderingContext2D, w: number, h: number, x0: number, y0: number, scale: number, big: boolean) {
    const b = this.b, r = this.r;
    const W = b.world;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b1218'; ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(r.terrain.low, -x0 / 32 * scale * 32, -y0 / 32 * scale * 32, W.cw * 32 * scale, W.ch * 32 * scale);
    ctx.fillStyle = 'rgba(8,13,18,0.25)'; ctx.fillRect(0, 0, w, h);
    const X = (x: number) => (x - x0) * scale, Y = (y: number) => (y - y0) * scale;
    ctx.fillStyle = 'rgba(40,44,48,0.85)';
    for (const bl of W.buildings) if (!bl.collapsed) ctx.fillRect(X(bl.x * 32), Y(bl.y * 32), bl.w * 32 * scale, bl.h * 32 * scale);
    for (const f of b.flags) {
      ctx.fillStyle = f.owner >= 0 ? r.colors[f.owner] : '#e8d9a8';
      ctx.globalAlpha = 0.18; ctx.beginPath(); ctx.arc(X(f.x), Y(f.y), FLAG_R * scale, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    }
    const dot = (x: number, y: number, rad: number, col: string) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(x), Y(y), rad, 0, 7); ctx.fill(); };
    const pl = b.player;
    for (const s of b.soldiers) {
      if (s.state !== 0 || s.veh >= 0 || s === pl) continue;
      if (s.team === 1 && !(s.spotT > 0 || s.mapT > 0 || s.seen)) continue;
      dot(s.x, s.y, big ? 3 : 2.2, s.team === 0 ? (s.squad === pl.squad ? '#7dffb0' : r.colors[0]) : r.colors[1]);
    }
    for (const v of b.vehicles) {
      if (!v.alive || (v.team === 1 && !(v.seen || v.mapT > 0))) continue;
      ctx.fillStyle = r.colors[v.team];
      const k = big ? 6 : 4.5;
      ctx.save(); ctx.translate(X(v.x), Y(v.y)); ctx.rotate(v.ang);
      if (VEHICLES[v.type].air) { ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(-k, -k); ctx.lineTo(-k * 0.4, 0); ctx.lineTo(-k, k); ctx.closePath(); ctx.fill(); }
      else ctx.fillRect(-k, -k * 0.7, k * 2, k * 1.4);
      ctx.strokeStyle = '#0a1016'; ctx.lineWidth = 1; ctx.strokeRect(-k, -k * 0.7, k * 2, k * 1.4);
      ctx.restore();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of b.flags) {
      const k = big ? 13 : 9;
      ctx.fillStyle = f.owner >= 0 ? r.colors[f.owner] : '#2a343d';
      ctx.fillRect(X(f.x) - k, Y(f.y) - k, k * 2, k * 2);
      ctx.strokeStyle = f.owner >= 0 ? '#0a1016' : '#e8d9a8'; ctx.lineWidth = 1.5;
      ctx.strokeRect(X(f.x) - k, Y(f.y) - k, k * 2, k * 2);
      ctx.fillStyle = f.owner >= 0 ? '#0a1016' : '#e8d9a8';
      ctx.font = `800 ${big ? 17 : 12}px "Saira Condensed", sans-serif`;
      ctx.fillText(f.tag, X(f.x), Y(f.y) + 1);
    }
    W.hq.forEach((hq, t) => { ctx.strokeStyle = r.colors[t]; ctx.lineWidth = 2; const k = big ? 8 : 5; ctx.strokeRect(X(hq.x) - k, Y(hq.y) - k, k * 2, k * 2); });
    if (pl.state !== 2) {
      const pv = pl.veh >= 0 ? b.vehicles[pl.veh] : null;
      ctx.save(); ctx.translate(X(pv ? pv.x : pl.x), Y(pv ? pv.y : pl.y)); ctx.rotate(pl.ctl.aim);
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#0a1016'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-5, -5.5); ctx.lineTo(-2, 0); ctx.lineTo(-5, 5.5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  private drawMini() {
    const c = this.q<HTMLCanvasElement>('.mini canvas');
    const ctx = c.getContext('2d')!;
    const pl = this.b.player;
    const span = 2200;
    const scale = c.width / span;
    const cx = pl.state !== 2 ? (pl.veh >= 0 ? this.b.vehicles[pl.veh].x : pl.x) : this.r.cam.x;
    const cy = pl.state !== 2 ? (pl.veh >= 0 ? this.b.vehicles[pl.veh].y : pl.y) : this.r.cam.y;
    this.mapLayer(ctx, c.width, c.height, cx - span / 2, cy - span / 2, scale, false);
  }

  private drawBig() {
    const c = this.q<HTMLCanvasElement>('.bigmap canvas');
    const W = this.b.world;
    const box = this.q('.bigmap').getBoundingClientRect();
    const s = Math.min((box.width - 32) / W.w, (box.height - 90) / W.h);
    const cw = Math.round(W.w * s), ch = Math.round(W.h * s);
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    this.mapLayer(c.getContext('2d')!, cw, ch, 0, 0, s, true);
  }

  private toggleMap() {
    this.showMap = !this.showMap;
    this.q('.bigmap').hidden = !this.showMap;
  }

  // ───────── 배치 ─────────

  private openDeploy() {
    this.deployOpen = true;
    this.input.adsToggle = false;
    const d = this.q('.deploy');
    d.hidden = false;
    const b = this.b;
    d.innerHTML = `<div class="dep">
      <header><div><small>${esc(b.map.name)} · ${SIZES[b.size].name}</small><h2>${b.time < 1 ? '배치' : '재배치'}</h2></div>
        <div class="dep-tk"><b style="color:${this.r.colors[0]}">${b.tickets[0]}</b> : <b style="color:${this.r.colors[1]}">${b.tickets[1]}</b></div></header>
      <div class="dep-body">
        <div class="dep-map"><canvas></canvas><div class="dep-spawns"></div></div>
        <div class="dep-side">
          <div class="dep-cls">${CLASS_ORDER.map((c) => `<button data-a="cls" data-c="${c}" class="${c === this.deployCls ? 'on' : ''}"><span class="ci">${CLS_ICON[c]}</span>${CLASSES[c].short}</button>`).join('')}</div>
          <div class="dep-kit"></div>
          <button data-a="editkit" class="ghost">장비 바꾸기</button>
          <div class="dep-squad"></div>
          <button data-a="deploy" class="primary big dep-go"></button>
        </div>
      </div>
      <div class="kit-edit" hidden><div class="kit-box"><header><h3></h3><button data-a="closekit">완료</button></header><div class="kit-body"></div></div></div>
    </div>`;
    this.deployMapT = 0;
    this.updateDeploy(true);
  }

  private updateDeploy(full = false) {
    const b = this.b, pl = b.player;
    const d = this.q('.deploy');
    this.spawns = spawnOptions(b, pl);
    if (!this.spawns.some((s) => this.match(s))) {
      // 고른 곳이 사라지면 가장 앞선 아군 거점으로
      const e = b.world.hq[1];
      const flags = this.spawns.filter((s) => s.kind === 'flag').sort((a, c) => Math.hypot(a.x - e.x, a.y - e.y) - Math.hypot(c.x - e.x, c.y - e.y));
      const pick = flags[0] ?? this.spawns[0];
      this.spawnPick = pick.kind; this.spawnRef = pick.kind === 'vehicle' ? pick.veh : pick.ref;
    }
    const wait = pl.state === 2 && b.time > 1 ? Math.max(0, RESPAWN_DELAY - pl.deadT) : 0;
    const go = d.querySelector('.dep-go') as HTMLButtonElement;
    go.disabled = wait > 0;
    const sel = this.spawns.find((s) => this.match(s));
    go.textContent = wait > 0 ? `${Math.ceil(wait)}초 뒤 배치` : `배치 · ${sel ? sel.label : ''}`;
    (d.querySelector('.dep-kit') as HTMLElement).innerHTML = `<p>${kitSummary(this.p, this.deployCls)}</p><small>${CLASSES[this.deployCls].trait}</small>`;
    (d.querySelector('.dep-squad') as HTMLElement).innerHTML = b.soldiers.filter((s) => s.team === 0 && s.squad === pl.squad && s !== pl).map((s) =>
      `<p class="st${s.state}"><span class="ci">${CLS_ICON[s.cls]}</span>${esc(s.name)} <small>${s.state === 2 ? '전사' : s.state === 1 ? '쓰러짐' : s.veh >= 0 ? VEHICLES[b.vehicles[s.veh].type].short + ' 탑승' : '전투 중'}</small></p>`).join('');
    this.deployMapT -= 0.1;
    if (full || this.deployMapT <= 0) {
      this.deployMapT = 0.5;
      const c = d.querySelector('.dep-map canvas') as HTMLCanvasElement;
      const box = (d.querySelector('.dep-map') as HTMLElement).getBoundingClientRect();
      const W = b.world;
      const s = Math.min(box.width / W.w, (box.height || 300) / W.h);
      const cw = Math.max(50, Math.round(W.w * s)), ch = Math.max(30, Math.round(W.h * s));
      if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
      this.mapLayer(c.getContext('2d')!, cw, ch, 0, 0, s, true);
      (d.querySelector('.dep-spawns') as HTMLElement).innerHTML = this.spawns.map((sp, i) =>
        `<button class="sp ${sp.kind}${this.match(sp) ? ' on' : ''}" data-a="spawn" data-i="${i}" style="left:${(sp.x * s).toFixed(1)}px;top:${(sp.y * s).toFixed(1)}px">${esc(sp.kind === 'squad' ? sp.label.slice(0, 4) : sp.label)}</button>`).join('');
      const sp = d.querySelector('.dep-spawns') as HTMLElement;
      sp.style.width = `${cw}px`; sp.style.height = `${ch}px`;
    }
  }

  private closeDeploy() {
    this.deployOpen = false;
    const d = this.q('.deploy');
    d.hidden = true;
    d.innerHTML = '';
  }

  // ───────── 버튼 ─────────

  private action(a: string, el?: HTMLElement) {
    const t = el ?? this.el;
    const b = this.b;
    switch (a) {
      case 'pause': this.pause(); break;
      case 'resume': this.resume(); break;
      case 'map': this.toggleMap(); break;
      case 'board': this.showBoard = !this.showBoard; this.q('.board').hidden = !this.showBoard; if (this.showBoard) this.renderBoard(); break;
      case 'giveup': giveUp(b); break;
      case 'cls': this.deployCls = t.dataset.c as ClassId; this.p.cls = this.deployCls; saveProfile(this.p);
        this.q('.deploy').querySelectorAll('.dep-cls button').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.c === this.deployCls));
        this.updateDeploy(); break;
      case 'spawn': { const sp = this.spawns[Number(t.dataset.i)]; if (sp) { this.spawnPick = sp.kind; this.spawnRef = sp.kind === 'vehicle' ? sp.veh : sp.ref; this.updateDeploy(true); } break; }
      case 'editkit': {
        const box = this.q('.kit-edit');
        box.hidden = false;
        (box.querySelector('h3') as HTMLElement).textContent = `${CLASSES[this.deployCls].name} 장비`;
        renderKit(box.querySelector('.kit-body') as HTMLElement, this.p, this.deployCls, () => { saveProfile(this.p); this.updateDeploy(); });
        break;
      }
      case 'closekit': this.q('.kit-edit').hidden = true; break;
      case 'deploy': {
        if (!b.needDeploy) return;
        const sp = this.spawns.find((s) => this.match(s)) ?? this.spawns[0];
        const wait = b.player.state === 2 && b.time > 1 ? RESPAWN_DELAY - b.player.deadT : 0;
        if (wait > 0) return;
        deployPlayer(b, sp, this.deployCls, this.p.kits[this.deployCls]);
        this.closeDeploy();
        this.input.crouch = false;
        const v = b.player.veh >= 0 ? b.vehicles[b.player.veh] : null;
        this.r.cam.x = v ? v.x : b.player.x; this.r.cam.y = v ? v.y : b.player.y;
        break;
      }
      case 'quit': this.cb.quit(); break;
      case 'again': this.cb.again(); break;
      case 'done': this.finish(); break;
      case 'vol': this.p.volume = Number((t as HTMLInputElement).value); this.snd.setVolume(this.p.volume); saveProfile(this.p); break;
    }
  }

  private pause() {
    if (this.b.over) return;
    this.paused = true;
    const el = this.q('.pause');
    el.hidden = false;
    el.innerHTML = `<div class="pbox"><h2>일시 정지</h2>
      <button data-a="resume" class="primary big">전투로 돌아가기</button>
      <button data-a="board">점수판</button>
      <label class="vol" for="vol">소리 <input id="vol" type="range" min="0" max="1" step="0.05" value="${this.p.volume}" data-a="vol"></label>
      <div class="keys">${this.input.touch ? '왼쪽 끌기 이동 · 오른쪽 끌기 조준과 사격 · 버튼으로 장비와 탑승' : 'WASD 이동 · 좌클릭 사격 · 우클릭 정조준 · R 재장전 · Shift 달리기 · C 앉기<br>1 주무기 · 2, 3 장비 · G 수류탄 · Q 적 표시 · E 탑승·하차·소생 · F 좌석 · Space 연막·섬광탄<br>Tab 점수판 · M 지도 · Esc 일시 정지'}</div>
      <button data-a="quit" class="ghost">전투 나가기</button></div>`;
    (el.querySelector('#vol') as HTMLInputElement).addEventListener('input', (e) => this.action('vol', e.target as HTMLElement));
  }

  private resume() {
    this.paused = false;
    this.q('.pause').hidden = true;
    this.last = performance.now();
  }

  private renderBoard() {
    const b = this.b;
    const col = (team: 0 | 1) => {
      const list = b.soldiers.filter((s) => s.team === team).sort((x, y) => y.score - x.score);
      return `<div class="bcol"><h4 style="color:${this.r.colors[team]}">${FACTIONS[b.sides[team]].army} <span>${b.tickets[team]}</span></h4>
        <table><thead><tr><th></th><th>이름</th><th>점수</th><th>사살</th><th>전사</th><th>지원</th><th>소생</th></tr></thead><tbody>${list.slice(0, 64).map((s, i) =>
          `<tr class="${s === b.player ? 'me' : team === 0 && s.squad === b.player.squad ? 'sq' : ''}"><td>${i + 1}</td><td><span class="ci">${CLS_ICON[s.cls]}</span>${esc(s.name)}</td><td>${s.score}</td><td>${s.kills}</td><td>${s.deaths}</td><td>${s.assists}</td><td>${s.revives}</td></tr>`).join('')}</tbody></table></div>`;
    };
    // 껍데기는 한 번만 만들고 표만 1초마다 바꾼다 (누르는 중인 버튼과 스크롤이 날아가지 않게)
    this.boardT = 1;
    const box = this.q('.board');
    if (!box.firstElementChild) box.innerHTML = `<div class="bbox"><header><h3>점수판</h3><button data-a="board">닫기</button></header><div class="bcols"></div></div>`;
    box.querySelector('.bcols')!.innerHTML = col(0) + col(1);
  }

  // ───────── 끝 ─────────

  private result: GameResult | null = null;

  private showEnd() {
    const b = this.b, pl = b.player, p = this.p;
    const win = !!b.over?.win;
    const before = rankOf(p.xp).rank;
    const xp = pl.score + (win ? 600 : 200);
    p.xp += xp;
    p.stats.games++; if (win) p.stats.wins++;
    p.stats.kills += pl.kills; p.stats.deaths += pl.deaths; p.stats.revives += pl.revives; p.stats.caps += pl.caps; p.stats.vkills += pl.vkills;
    saveProfile(p);
    const after = rankOf(p.xp);
    this.result = { win, why: b.over!.why, xp, rankBefore: before, rankAfter: after.rank };
    const ribbons: string[] = [];
    if (win) ribbons.push('승리');
    if (pl.kills >= 10) ribbons.push('사살 10');
    if (pl.revives >= 3) ribbons.push('의무 활동');
    if (pl.caps >= 2) ribbons.push('거점 점령');
    if (pl.vkills >= 1) ribbons.push('차량 격파');
    if (pl.assists >= 5) ribbons.push('사살 지원');
    const team = b.soldiers.filter((s) => s.team === 0).sort((x, y) => y.score - x.score);
    const place = team.indexOf(pl) + 1;
    const top = (t: 0 | 1) => b.soldiers.filter((s) => s.team === t).sort((x, y) => y.score - x.score).slice(0, 3).map((s) => `<li>${CLS_ICON[s.cls]}<b>${esc(s.name)}</b><span>${s.score}</span></li>`).join('');
    const el = this.q('.end');
    el.hidden = false;
    el.innerHTML = `<div class="ebox ${win ? 'win' : 'lose'}">
      <small>${esc(b.map.name)} · ${SIZES[b.size].name}</small>
      <h2>${win ? '승리' : '패배'}</h2><p class="why">${esc(b.over!.why)}</p>
      <div class="etk"><b style="color:${this.r.colors[0]}">${b.tickets[0]}</b><span>티켓</span><b style="color:${this.r.colors[1]}">${b.tickets[1]}</b></div>
      <dl class="estat">
        <div><dt>점수</dt><dd>${pl.score}</dd></div><div><dt>팀 순위</dt><dd>${place}/${team.length}</dd></div>
        <div><dt>사살</dt><dd>${pl.kills}</dd></div><div><dt>전사</dt><dd>${pl.deaths}</dd></div>
        <div><dt>소생</dt><dd>${pl.revives}</dd></div><div><dt>점령</dt><dd>${pl.caps}</dd></div>
      </dl>
      ${ribbons.length ? `<div class="ribbons">${ribbons.map((r) => `<span>${r}</span>`).join('')}</div>` : ''}
      <div class="rank"><span>계급 ${after.rank}${after.rank > before ? ' · 진급!' : ''}</span><i><b style="width:${(after.cur / after.next) * 100}%"></b></i><small>+${xp} 경험치</small></div>
      <div class="tops"><ol>${top(0)}</ol><ol class="en">${top(1)}</ol></div>
      <div class="ebtn"><button data-a="again" class="primary big">다시 싸우기</button><button data-a="done">메뉴로</button></div>
    </div>`;
  }

  private finish() { if (this.result) this.cb.end(this.result); else this.cb.quit(); }
}

export { FACTIONS };
