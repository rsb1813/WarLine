// 터치 조작 레이어: 떠 있는 이동 스틱, 오른쪽 시선 끌기, 사격(누른 채 끌면 시선도), 버튼들.
// Input 이 만들고 poll 때 상태를 읽는다. 화면 좌표는 px, 시선 변화도 px 로 넘기고 감도는 Input 이 곱한다.

export type InputMode = 'infantry' | 'vehicle' | 'heli' | 'hidden';
export type TouchEdge = 'jump' | 'crouch' | 'prone' | 'reload' | 'swap' | 'spot' | 'counter' | 'interact';

export interface TouchSink {
  look(dx: number, dy: number): void;
  edge(k: TouchEdge): void;
  gadget(i: 0 | 1 | 2): void;
  seat(i: number): void;
  toggleAds(): void;
  /** 달리기 시작 (정조준 토글 해제용) */
  sprintStart(): void;
  /** 터치 입력이 있었다 (합성 마우스 이벤트 무시용) */
  touched(): void;
}

type BtnId =
  | 'fire' | 'fire2' | 'ads' | 'reload' | 'jump' | 'crouch' | 'throw' | 'g1' | 'g2' | 'swap' | 'spot' | 'interact'
  | 'seat' | 'exit' | 'counter' | 'up' | 'down';

interface BtnDef { id: BtnId; label: string; icon: string; modes: string; extra?: string }

const svg = (d: string): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

const IC = {
  fire: svg('<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>'),
  ads: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4v4M12 16v4M4 12h4M16 12h4"/>'),
  reload: svg('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>'),
  jump: svg('<path d="M6 14l6-6 6 6"/><path d="M6 19l6-6 6 6" opacity=".5"/>'),
  crouch: svg('<path d="M6 6l6 6 6-6"/><path d="M5 18h14"/>'),
  swap: svg('<path d="M4 8h13l-3-3M20 16H7l3 3"/>'),
  spot: svg('<path d="M12 3l8 9-8 9-8-9z"/><circle cx="12" cy="12" r="2"/>'),
  throw: svg('<circle cx="11" cy="14" r="6"/><path d="M13 8l2-3h3"/>'),
  gadget: svg('<rect x="5" y="7" width="14" height="11" rx="2"/><path d="M9 7V5h6v2"/>'),
  seat: svg('<path d="M7 4v9h9l2 6"/><path d="M7 13l-1 6"/>'),
  exit: svg('<path d="M10 4H5v16h5"/><path d="M14 8l4 4-4 4M18 12H9"/>'),
  counter: svg('<path d="M12 21c-4 0-6-3-6-6 0-4 3-5 3-9 2 1 3 3 3 5 1-1 2-2 2-4 2 2 4 5 4 8 0 3-2 6-6 6z"/>'),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  none: '',
};

const DEFS: BtnDef[] = [
  { id: 'fire', label: '사격', icon: IC.fire, modes: 'ivh' },
  { id: 'fire2', label: '사격', icon: IC.fire, modes: 'i' },
  { id: 'ads', label: '정조준', icon: IC.ads, modes: 'ivh' },
  { id: 'reload', label: '재장전', icon: IC.reload, modes: 'i' },
  { id: 'jump', label: '점프', icon: IC.jump, modes: 'i' },
  { id: 'crouch', label: '앉기', icon: IC.crouch, modes: 'i' },
  { id: 'throw', label: '투척', icon: IC.throw, modes: 'i' },
  { id: 'g1', label: '장비1', icon: IC.gadget, modes: 'i' },
  { id: 'g2', label: '장비2', icon: IC.gadget, modes: 'i' },
  { id: 'swap', label: '무기 교체', icon: IC.swap, modes: 'i' },
  { id: 'spot', label: '표시', icon: IC.spot, modes: 'ivh' },
  { id: 'interact', label: '상호작용', icon: IC.none, modes: 'i' },
  { id: 'seat', label: '좌석', icon: IC.seat, modes: 'vh' },
  { id: 'exit', label: '하차', icon: IC.exit, modes: 'vh' },
  { id: 'counter', label: '연막', icon: IC.counter, modes: 'vh' },
  { id: 'up', label: '상승', icon: IC.up, modes: 'h' },
  { id: 'down', label: '하강', icon: IC.down, modes: 'h' },
];

interface Btn { def: BtnDef; el: HTMLElement; lab: HTMLElement; text: string; held: number }

interface Track {
  kind: 'move' | 'look' | 'btn';
  btn: Btn | null;
  x: number; y: number;
  /** 스틱 중심 */
  ox: number; oy: number;
  timer: number;
  done: boolean;
}

const MODE_LETTER: Record<InputMode, string> = { infantry: 'i', vehicle: 'v', heli: 'h', hidden: '-' };
const DEAD = 0.12;
const LONG_PRESS_MS = 400;

export class TouchControls {
  readonly root: HTMLDivElement;
  /** 이동 -1..1 (z 앞 +) */
  mx = 0; mz = 0;
  sprint = false;
  private mode: InputMode = 'infantry';
  private sink: TouchSink;
  private tracks = new Map<number, Track>();
  private btns = new Map<BtnId, Btn>();
  private moveZone: HTMLElement;
  private lookZone: HTMLElement;
  private stick: HTMLElement;
  private knob: HTMLElement;
  private sprintTag: HTMLElement;
  private sprintLock = false;
  private tagText = '달리기';
  private stickR = 60;
  private rectL = 0; private rectT = 0; private rectW = 1; private rectH = 1;
  private interactText: string | null = null;
  private adsOn = false;
  private off: (() => void)[] = [];

  constructor(host: HTMLElement, sink: TouchSink) {
    this.sink = sink;
    const root = document.createElement('div');
    root.className = 'tc-root tc-m-infantry';
    this.root = root;
    this.lookZone = div('tc-zone tc-look');
    this.moveZone = div('tc-zone tc-move');
    this.stick = div('tc-stick tc-rest');
    this.knob = div('tc-knob');
    this.sprintTag = div('tc-sprint');
    this.sprintTag.textContent = '달리기';
    this.stick.append(this.knob, this.sprintTag);
    root.append(this.lookZone, this.moveZone, this.stick);
    for (const d of DEFS) {
      const el = div(`tc-btn tc-b-${d.id}`);
      el.dataset.tc = d.id;
      if (d.icon) el.insertAdjacentHTML('beforeend', d.icon);
      const lab = document.createElement('span');
      lab.className = 'tc-l';
      lab.textContent = d.label;
      el.append(lab);
      root.append(el);
      this.btns.set(d.id, { def: d, el, lab, text: d.label, held: 0 });
    }
    host.append(root);
    this.applyMode();

    const on = <K extends keyof WindowEventMap>(t: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    on(root, 'touchstart', this.onStart, { passive: false });
    on(window, 'touchmove', this.onMove, { passive: false });
    on(window, 'touchend', this.onEnd, { passive: false });
    on(window, 'touchcancel', this.onEnd, { passive: false });
    on(root, 'contextmenu', (e) => e.preventDefault());
  }

  get fire(): boolean { return this.held('fire') + this.held('fire2') > 0; }
  get interact(): boolean { return this.held('interact') + this.held('exit') > 0; }
  get lift(): number { return (this.held('up') > 0 ? 1 : 0) - (this.held('down') > 0 ? 1 : 0); }

  setMode(m: InputMode): void {
    if (m === this.mode) return;
    this.releaseAll();
    this.mode = m;
    this.applyMode();
  }

  setContext(interact: string | null, gadgets: [string, string, string]): void {
    this.interactText = interact;
    const it = this.btns.get('interact')!;
    if (interact) this.setLabel(it, interact);
    this.setLabel(this.btns.get('g1')!, gadgets[0] || '장비1', !gadgets[0]);
    this.setLabel(this.btns.get('g2')!, gadgets[1] || '장비2', !gadgets[1]);
    this.setLabel(this.btns.get('throw')!, gadgets[2] || '투척', !gadgets[2]);
    this.applyVisibility();
  }

  /** poll 때마다: 정조준 토글 표시 */
  sync(adsOn: boolean): void {
    if (adsOn === this.adsOn) return;
    this.adsOn = adsOn;
    this.btns.get('ads')!.el.classList.toggle('act', adsOn);
  }

  /** 모든 손가락 놓기 (창 흐려짐, 모드 바뀜) */
  releaseAll(): void {
    for (const tr of this.tracks.values()) {
      if (tr.kind === 'btn' && tr.btn) { clearTimeout(tr.timer); tr.btn.held = 0; tr.btn.el.classList.remove('on'); }
    }
    for (const b of this.btns.values()) { b.held = 0; b.el.classList.remove('on'); }
    this.tracks.clear();
    this.sprintLock = false;
    this.resetStick();
  }

  dispose(): void {
    this.releaseAll();
    for (const f of this.off) f();
    this.off.length = 0;
    this.root.remove();
  }

  // ───────────────────────── 내부 ─────────────────────────

  private held(id: BtnId): number { return this.btns.get(id)!.held; }

  private setLabel(b: Btn, text: string, dim = false): void {
    b.el.classList.toggle('tc-empty', dim);
    if (b.text === text) return;
    b.text = text;
    b.lab.textContent = text;
    b.el.classList.toggle('tc-long', text.length > 4);
  }

  private applyMode(): void {
    const m = this.mode;
    this.root.classList.remove('tc-m-infantry', 'tc-m-vehicle', 'tc-m-heli', 'tc-m-hidden');
    this.root.classList.add(`tc-m-${m}`);
    this.root.hidden = m === 'hidden';
    const air = m === 'heli';
    this.setLabel(this.btns.get('counter')!, air ? '플레어' : '연막');
    this.setLabel(this.btns.get('ads')!, m === 'infantry' ? '정조준' : '확대');
    this.applyVisibility();
  }

  private applyVisibility(): void {
    const L = MODE_LETTER[this.mode];
    for (const b of this.btns.values()) {
      let show = b.def.modes.includes(L);
      if (b.def.id === 'interact') show = show && !!this.interactText;
      if (b.el.hidden === !show) continue;
      b.el.hidden = !show;
      if (!show && b.held > 0) {
        // 숨겨진 버튼을 누르고 있던 손가락은 놓은 것으로
        for (const [id, tr] of this.tracks) if (tr.btn === b) { this.releaseBtn(tr); this.tracks.delete(id); }
      }
    }
  }

  private cacheRect(): void {
    const r = this.root.getBoundingClientRect();
    this.rectL = r.left; this.rectT = r.top; this.rectW = Math.max(1, r.width); this.rectH = Math.max(1, r.height);
  }

  private onStart = (ev: TouchEvent): void => {
    if (this.mode === 'hidden') return;
    this.sink.touched();
    this.cacheRect();
    let handled = false;
    const list = ev.changedTouches;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (this.tracks.has(t.identifier)) continue;
      const target = t.target instanceof Element ? t.target : null;
      if (!target || !this.root.contains(target)) continue;
      const x = t.clientX - this.rectL, y = t.clientY - this.rectT;
      const bEl = target.closest('[data-tc]') as HTMLElement | null;
      if (bEl) {
        const b = this.btns.get(bEl.dataset.tc as BtnId);
        if (b && !b.el.hidden) { this.pressBtn(t.identifier, b, x, y); handled = true; }
        continue;
      }
      if (target.closest('.tc-move') && !this.hasMoveTrack()) { this.startMove(t.identifier, x, y); handled = true; continue; }
      if (target.closest('.tc-look') || target.closest('.tc-move')) {
        this.tracks.set(t.identifier, { kind: 'look', btn: null, x, y, ox: x, oy: y, timer: 0, done: false });
        handled = true;
      }
    }
    if (handled && ev.cancelable) ev.preventDefault();
  };

  private onMove = (ev: TouchEvent): void => {
    let mine = false;
    const list = ev.changedTouches;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const tr = this.tracks.get(t.identifier);
      if (!tr) continue;
      mine = true;
      const x = t.clientX - this.rectL, y = t.clientY - this.rectT;
      if (tr.kind === 'move') this.updateStick(tr, x, y);
      else if (tr.kind === 'look' || (tr.btn && (tr.btn.def.id === 'fire' || tr.btn.def.id === 'fire2'))) {
        const dx = x - tr.x, dy = y - tr.y;
        if (dx !== 0 || dy !== 0) this.sink.look(dx, dy);
      }
      tr.x = x; tr.y = y;
    }
    if (mine) { this.sink.touched(); if (ev.cancelable) ev.preventDefault(); }
  };

  private onEnd = (ev: TouchEvent): void => {
    let mine = false;
    const list = ev.changedTouches;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const tr = this.tracks.get(t.identifier);
      if (!tr) continue;
      mine = true;
      this.tracks.delete(t.identifier);
      if (tr.kind === 'move') this.endMove();
      else if (tr.kind === 'btn') this.releaseBtn(tr);
    }
    if (mine) { this.sink.touched(); if (ev.cancelable) ev.preventDefault(); }
  };

  private hasMoveTrack(): boolean {
    for (const tr of this.tracks.values()) if (tr.kind === 'move') return true;
    return false;
  }

  // ── 버튼 ──
  private pressBtn(id: number, b: Btn, x: number, y: number): void {
    const tr: Track = { kind: 'btn', btn: b, x, y, ox: x, oy: y, timer: 0, done: false };
    this.tracks.set(id, tr);
    b.held++;
    b.el.classList.add('on');
    const s = this.sink;
    switch (b.def.id) {
      case 'fire': case 'fire2': this.cancelSprintLock(); break;
      case 'ads': this.cancelSprintLock(); s.toggleAds(); break;
      case 'reload': s.edge('reload'); break;
      case 'jump': s.edge('jump'); break;
      case 'crouch':
        tr.timer = window.setTimeout(() => { tr.done = true; this.cancelSprintLock(); s.edge('prone'); b.el.classList.add('tc-pulse'); }, LONG_PRESS_MS);
        break;
      case 'throw': s.gadget(2); break;
      case 'g1': s.gadget(0); break;
      case 'g2': s.gadget(1); break;
      case 'swap': s.edge('swap'); break;
      case 'spot': s.edge('spot'); break;
      case 'interact': case 'exit': s.edge('interact'); break;
      case 'seat': s.seat(-2); break;
      case 'counter': s.edge('counter'); break;
      case 'up': case 'down': break;
    }
  }

  private releaseBtn(tr: Track): void {
    const b = tr.btn;
    if (!b) return;
    b.held = Math.max(0, b.held - 1);
    if (b.held === 0) b.el.classList.remove('on', 'tc-pulse');
    if (b.def.id === 'crouch') {
      clearTimeout(tr.timer);
      if (!tr.done) { this.cancelSprintLock(); this.sink.edge('crouch'); }
    }
  }

  // ── 이동 스틱 ──
  private startMove(id: number, x: number, y: number): void {
    const R = this.measureR();
    const pad = R + 6;
    const ox = clampN(x, pad, this.rectW - pad), oy = clampN(y, pad, this.rectH - pad);
    this.tracks.set(id, { kind: 'move', btn: null, x, y, ox, oy, timer: 0, done: false });
    this.sprintLock = false;
    const st = this.stick.style;
    this.stick.classList.remove('tc-rest');
    this.stick.classList.add('tc-act');
    st.left = `${ox - R}px`; st.top = `${oy - R}px`; st.bottom = 'auto';
    this.updateStick(this.tracks.get(id)!, x, y);
  }

  private updateStick(tr: Track, x: number, y: number): void {
    const R = this.stickR;
    const dx = x - tr.ox, dy = y - tr.oy;
    const d = Math.hypot(dx, dy);
    const k = d > R ? R / d : 1;
    const kx = dx * k, ky = dy * k;
    this.knob.style.transform = `translate(${kx.toFixed(1)}px, ${ky.toFixed(1)}px)`;
    const mag = Math.min(1, d / R);
    if (mag < DEAD) { this.mx = 0; this.mz = 0; }
    else {
      const s = (mag - DEAD) / (1 - DEAD) / mag;
      this.mx = (kx / R) * s;
      this.mz = (-ky / R) * s;
    }
    // 끝까지 위로 밀면 달리기, 더 멀리 끌면 달리기 고정
    let sprint = false;
    if (this.mode === 'infantry') {
      const up = -dy / R;
      sprint = up >= 0.95 && Math.abs(dx) < -dy * 0.75;
      if (sprint && up >= 1.75) this.sprintLock = true;
    }
    this.setSprint(sprint || this.sprintLock);
  }

  private endMove(): void {
    if (this.sprintLock && this.mode === 'infantry') {
      // 손을 떼도 앞으로 계속 달린다 (스틱을 다시 만지거나 쏘거나 정조준하면 풀림)
      this.mx = 0; this.mz = 1;
      this.restStick();
      this.setSprint(true);
      return;
    }
    this.resetStick();
  }

  private cancelSprintLock(): void {
    if (!this.sprintLock) return;
    this.sprintLock = false;
    if (!this.hasMoveTrack()) { this.mx = 0; this.mz = 0; this.setSprint(false); }
  }

  private setSprint(on: boolean): void {
    if (on && !this.sprint) this.sink.sprintStart();
    const tag = this.sprintLock ? '달리기 고정' : '달리기';
    if (on !== this.sprint) this.sprintTag.classList.toggle('on', on);
    if (tag !== this.tagText) { this.tagText = tag; this.sprintTag.textContent = tag; }
    this.sprint = on;
  }

  private restStick(): void {
    const st = this.stick.style;
    st.left = ''; st.top = ''; st.bottom = '';
    this.stick.classList.remove('tc-act');
    this.stick.classList.add('tc-rest');
    this.knob.style.transform = '';
  }

  private resetStick(): void {
    this.mx = 0; this.mz = 0;
    this.restStick();
    this.setSprint(false);
  }

  private measureR(): number {
    const w = this.stick.offsetWidth;
    this.stickR = w > 20 ? w / 2 : 60;
    return this.stickR;
  }
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

function clampN(v: number, a: number, b: number): number {
  if (b < a) return (a + b) / 2;
  return v < a ? a : v > b ? b : v;
}
