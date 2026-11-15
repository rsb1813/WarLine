// 입력: PC(포인터 잠금 마우스 + 키보드)와 터치(화면 위 조작 레이어)를 한 InputFrame 으로 모은다.
//
// 메모 (통합용)
// - poll() 은 같은 InputFrame 객체를 매번 다시 채워 돌려준다. 엣지·시선 변화는 poll 뒤에 비워진다.
//   poll 사이가 0.4 초 넘게 비면(일시 정지·배치 화면) 그동안 쌓인 엣지와 시선 변화는 버린다.
// - seat: -1 = 없음, 0..3 = 그 좌석 (F1~F4, 차량 모드에서 1~4), -2 = '다음 좌석' (터치 '좌석' 버튼. Input 은 좌석 수를 모른다)
// - 차량 모드의 터치 '하차' 는 interact(누르고 있음) + interactEdge 를 보낸다.
// - 엘리먼트(el) 자체나 그 바로 아래 자식(게임 캔버스·투명 레이어)을 클릭하면 포인터 잠금을 요청한다. 'hidden' 모드에선 안 한다.
//   잠금이 안 되는 환경(iframe 샌드박스 등)에선 잠금 없이 캔버스 위 마우스 이동으로 시선을 돌린다.
// - Ctrl 은 앉기로도 쓰지만 Ctrl+W 같은 브라우저 단축키는 막을 수 없다 (C 를 권장).
import type { Settings } from '../types';
import { TouchControls, type InputMode, type TouchEdge, type TouchSink } from './touch';
import './touch.css';

export interface InputFrame {
  mx: number; mz: number;                // 이동 -1..1 (z 앞 +)
  lookX: number; lookY: number;          // 이번 프레임 시선 변화(rad), 감도 반영. lookX + = 오른쪽으로 돎(yaw 감소), lookY + = 위
  fire: boolean; ads: boolean; sprint: boolean;
  jump: boolean; crouch: boolean; prone: boolean;   // 엣지 (crouch/prone 은 토글 신호)
  reload: boolean; swap: boolean; slot: -1 | 0 | 1; gadget: -1 | 0 | 1 | 2;
  interact: boolean;                     // 누르고 있음 (E / 터치 버튼)
  interactEdge: boolean;
  spot: boolean; seat: number; fireMode: boolean; counter: boolean;
  lift: number;                          // 헬기: Space +1, Ctrl/C -1
  scoreboard: boolean;                   // 누르고 있음 (Tab)
  map: boolean; pause: boolean;          // 엣지
}

const MOUSE_K = 0.0022;
const TOUCH_K = 0.0055;
const STALE_MS = 400;
const SYNTH_MOUSE_MS = 900;
const WHEEL_GAP_MS = 160;

/** 게임이 쓰는 키 (입력 칸이 아닐 때 브라우저 기본 동작을 막는다) */
const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'Space', 'KeyC', 'ControlLeft', 'ControlRight', 'KeyZ', 'KeyR',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyG', 'KeyE', 'KeyQ', 'F1', 'F2', 'F3', 'F4',
  'KeyB', 'KeyX', 'Tab', 'KeyM', 'KeyP',
]);

interface Edges {
  jump: boolean; crouch: boolean; prone: boolean; reload: boolean; swap: boolean;
  slot: -1 | 0 | 1; gadget: -1 | 0 | 1 | 2;
  interact: boolean; spot: boolean; seat: number; fireMode: boolean; counter: boolean;
  map: boolean; pause: boolean;
}

const newEdges = (): Edges => ({
  jump: false, crouch: false, prone: false, reload: false, swap: false, slot: -1, gadget: -1,
  interact: false, spot: false, seat: -1, fireMode: false, counter: false, map: false, pause: false,
});

const newFrame = (): InputFrame => ({
  mx: 0, mz: 0, lookX: 0, lookY: 0, fire: false, ads: false, sprint: false,
  jump: false, crouch: false, prone: false, reload: false, swap: false, slot: -1, gadget: -1,
  interact: false, interactEdge: false, spot: false, seat: -1, fireMode: false, counter: false,
  lift: 0, scoreboard: false, map: false, pause: false,
});

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

function isInteractive(t: Element): boolean {
  return !!t.closest('button, a, input, select, textarea, label, [role="button"], [data-nolock]');
}

export class Input {
  readonly touch: boolean;
  private el: HTMLElement;
  private settings: Settings;
  private frame = newFrame();
  private edges = newEdges();
  private keys = new Set<string>();
  /** 마우스 px, 터치 px 누적 */
  private mdx = 0; private mdy = 0;
  private tdx = 0; private tdy = 0;
  private lmb = false; private rmb = false;
  private adsToggle = false;
  private mode: InputMode = 'infantry';
  private lockFailed = false;
  private lockAt = 0;
  private lastPoll = 0;
  private lastTouch = -1e9;
  private wheelAt = 0;
  private freeX = NaN; private freeY = NaN;
  private tc: TouchControls | null = null;
  private off: (() => void)[] = [];
  private disposed = false;

  constructor(el: HTMLElement, settings: Settings) {
    this.el = el;
    this.settings = settings;
    let coarse = false;
    try { coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches; } catch { coarse = false; }
    this.touch = coarse || 'ontouchstart' in window;
    this.lastPoll = performance.now();

    type EvMap = WindowEventMap & DocumentEventMap;
    const on = <K extends keyof EvMap>(t: Window | Document | HTMLElement, type: K, fn: (e: EvMap[K]) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    on(window, 'keydown', this.onKeyDown);
    on(window, 'keyup', this.onKeyUp);
    on(window, 'blur', this.releaseAll);
    on(document, 'visibilitychange', () => { if (document.hidden) this.releaseAll(); });
    on(document, 'mousemove', this.onMouseMove);
    on(el, 'mousedown', this.onMouseDown);
    on(window, 'mouseup', this.onMouseUp);
    on(el, 'click', this.onClick);
    on(el, 'wheel', this.onWheel, { passive: true });
    on(el, 'contextmenu', (e) => e.preventDefault());
    on(el, 'mouseleave', () => { this.freeX = NaN; this.freeY = NaN; });
    on(document, 'pointerlockchange', this.onLockChange);
    on(document, 'pointerlockerror', () => { this.lockFailed = true; });

    if (this.touch) {
      const sink: TouchSink = {
        look: (dx, dy) => { this.tdx += dx; this.tdy += dy; },
        edge: (k: TouchEdge) => { this.edges[k] = true; if (k === 'swap') this.adsToggle = false; },
        gadget: (i) => { this.edges.gadget = i; this.adsToggle = false; },
        seat: (i) => { this.edges.seat = i; },
        toggleAds: () => { this.adsToggle = !this.adsToggle; },
        sprintStart: () => { this.adsToggle = false; },
        touched: () => { this.lastTouch = performance.now(); },
      };
      this.tc = new TouchControls(el, sink);
    }
  }

  get locked(): boolean { return !!this.el && document.pointerLockElement === this.el; }

  /** 포인터 잠금 요청 (사용자 손짓 안에서 불러야 한다) */
  lock(): void {
    if (this.disposed || this.locked) return;
    const el = this.el as HTMLElement & { requestPointerLock?: (o?: unknown) => unknown };
    if (typeof el.requestPointerLock !== 'function') { this.lockFailed = true; return; }
    const fail = () => { this.lockFailed = true; };
    const plain = () => {
      try {
        const p = el.requestPointerLock!() as Promise<void> | undefined;
        if (p && typeof p.catch === 'function') p.catch(fail);
      } catch { fail(); }
    };
    try {
      // 가속 없는 원시 이동 (지원하면). 거절되면 기본 잠금으로 다시
      const p = el.requestPointerLock({ unadjustedMovement: true }) as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => { if (!this.locked && !this.disposed) plain(); });
    } catch { plain(); }
  }

  /** 포인터 잠금 풀기 */
  release(): void {
    if (this.locked) document.exitPointerLock();
  }

  setMode(m: 'infantry' | 'vehicle' | 'heli' | 'hidden'): void {
    if (m === this.mode) return;
    const wasInf = this.mode === 'infantry';
    this.mode = m;
    if (m === 'hidden' || wasInf !== (m === 'infantry')) { this.adsToggle = false; this.rmb = false; }
    if (m === 'hidden') this.lmb = false;
    this.tc?.setMode(m);
  }

  setContext(c: { interact: string | null; gadgets: [string, string, string] }): void {
    this.tc?.setContext(c.interact, c.gadgets);
  }

  setSettings(s: Settings): void {
    this.settings = s;
    if (s.holdAds) this.adsToggle = false;
  }

  poll(ads: boolean, zoom: number): InputFrame {
    const now = performance.now();
    if (now - this.lastPoll > STALE_MS) this.clearTransient();
    this.lastPoll = now;
    const f = this.frame, e = this.edges, k = this.keys, s = this.settings, tc = this.tc;

    // 이동
    let mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let mz = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (tc) { mx += tc.mx; mz += tc.mz; }
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    f.mx = mx; f.mz = mz;

    // 시선
    const sens = Number.isFinite(s.sens) ? s.sens : 1;
    const adsK = ads ? (Number.isFinite(s.adsSens) ? s.adsSens : 0.85) / Math.max(1, (zoom || 1) * 0.75) : 1;
    const kk = sens * adsK;
    const inv = s.invertY ? -1 : 1;
    f.lookX = (this.mdx * MOUSE_K + this.tdx * TOUCH_K) * kk;
    f.lookY = -(this.mdy * MOUSE_K + this.tdy * TOUCH_K) * kk * inv;

    const mouseOk = this.locked || this.lockFailed;
    f.fire = (this.lmb && mouseOk) || (!!tc && tc.fire);
    f.ads = (s.holdAds && this.rmb && mouseOk) || this.adsToggle;
    f.sprint = k.has('ShiftLeft') || k.has('ShiftRight') || (!!tc && tc.sprint);

    f.jump = e.jump; f.crouch = e.crouch; f.prone = e.prone;
    f.reload = e.reload; f.swap = e.swap; f.slot = e.slot; f.gadget = e.gadget;
    f.interact = k.has('KeyE') || (!!tc && tc.interact);
    f.interactEdge = e.interact;
    f.spot = e.spot; f.seat = e.seat; f.fireMode = e.fireMode; f.counter = e.counter;
    let lift = (k.has('Space') ? 1 : 0) - (k.has('KeyC') || k.has('ControlLeft') || k.has('ControlRight') ? 1 : 0);
    if (tc) lift += tc.lift;
    f.lift = lift > 1 ? 1 : lift < -1 ? -1 : lift;
    f.scoreboard = k.has('Tab');
    f.map = e.map; f.pause = e.pause;

    tc?.sync(this.adsToggle);
    this.clearTransient();
    return f;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const f of this.off) f();
    this.off.length = 0;
    this.tc?.dispose();
    this.tc = null;
    if (this.locked) document.exitPointerLock();
    this.keys.clear();
  }

  // ───────────────────────── 내부 ─────────────────────────

  private clearTransient(): void {
    const e = this.edges;
    e.jump = false; e.crouch = false; e.prone = false; e.reload = false; e.swap = false;
    e.slot = -1; e.gadget = -1; e.interact = false; e.spot = false; e.seat = -1;
    e.fireMode = false; e.counter = false; e.map = false; e.pause = false;
    this.mdx = 0; this.mdy = 0; this.tdx = 0; this.tdy = 0;
  }

  private releaseAll = (): void => {
    this.keys.clear();
    this.lmb = false; this.rmb = false;
    this.adsToggle = false;
    this.freeX = NaN; this.freeY = NaN;
    this.tc?.releaseAll();
  };

  private synthMouse(): boolean {
    return this.touch && performance.now() - this.lastTouch < SYNTH_MOUSE_MS;
  }

  private onKeyDown = (ev: KeyboardEvent): void => {
    if (isTyping(ev.target) || ev.metaKey) return;
    const code = ev.code;
    if (GAME_KEYS.has(code) && (this.mode !== 'hidden' || this.locked)) ev.preventDefault();
    if (code === 'Escape') { if (!ev.repeat) this.edges.pause = true; return; }
    if (ev.repeat) return;
    this.keys.add(code);
    const e = this.edges, veh = this.mode === 'vehicle' || this.mode === 'heli';
    switch (code) {
      case 'Space': e.jump = true; break;
      case 'KeyC': case 'ControlLeft': case 'ControlRight': e.crouch = true; break;
      case 'KeyZ': e.prone = true; break;
      case 'KeyR': e.reload = true; break;
      case 'ShiftLeft': case 'ShiftRight': if (!this.settings.holdAds) this.adsToggle = false; break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': {
        const n = code.charCodeAt(5) - 49;
        if (veh) e.seat = n;
        else if (n < 2) { e.slot = n as 0 | 1; this.adsToggle = false; }
        else { e.gadget = (n - 2) as 0 | 1; this.adsToggle = false; }
        break;
      }
      case 'F1': case 'F2': case 'F3': case 'F4': e.seat = code.charCodeAt(1) - 49; break;
      case 'KeyG': e.gadget = 2; this.adsToggle = false; break;
      case 'KeyE': e.interact = true; break;
      case 'KeyQ': e.spot = true; break;
      case 'KeyB': e.fireMode = true; break;
      case 'KeyX': e.counter = true; break;
      case 'KeyM': e.map = true; break;
      case 'KeyP': e.pause = true; break;
    }
  };

  private onKeyUp = (ev: KeyboardEvent): void => {
    this.keys.delete(ev.code);
    if (GAME_KEYS.has(ev.code) && !isTyping(ev.target) && (this.mode !== 'hidden' || this.locked)) ev.preventDefault();
  };

  private onMouseMove = (ev: MouseEvent): void => {
    if (this.locked) {
      if (performance.now() - this.lockAt < 60) return; // 잠금 직후 튀는 값
      const dx = ev.movementX || 0, dy = ev.movementY || 0;
      if (Math.abs(dx) > 600 || Math.abs(dy) > 600) return; // 브라우저 버그로 튀는 값
      this.mdx += dx; this.mdy += dy;
      return;
    }
    // 잠금 실패 대체: 캔버스 위 마우스 위치 변화로 시선
    if (!this.lockFailed || this.mode === 'hidden' || this.synthMouse() || !(ev.target instanceof Node) || !this.el.contains(ev.target)) {
      this.freeX = NaN; this.freeY = NaN;
      return;
    }
    if (Number.isNaN(this.freeX)) { this.freeX = ev.clientX; this.freeY = ev.clientY; return; }
    const dx = ev.clientX - this.freeX, dy = ev.clientY - this.freeY;
    this.freeX = ev.clientX; this.freeY = ev.clientY;
    if (Math.abs(dx) > 300 || Math.abs(dy) > 300) return;
    this.mdx += dx; this.mdy += dy;
  };

  private onMouseDown = (ev: MouseEvent): void => {
    if (this.synthMouse() || this.mode === 'hidden') return;
    const mouseOk = this.locked || this.lockFailed;
    if (!mouseOk) return; // 첫 클릭은 잠금만 (click 에서)
    if (!this.locked && ev.target instanceof Element && isInteractive(ev.target)) return;
    if (ev.button === 0) this.lmb = true;
    else if (ev.button === 2) {
      if (this.settings.holdAds) this.rmb = true;
      else this.adsToggle = !this.adsToggle;
    } else if (ev.button === 1) { this.edges.spot = true; ev.preventDefault(); }
  };

  private onMouseUp = (ev: MouseEvent): void => {
    if (ev.button === 0) this.lmb = false;
    else if (ev.button === 2) this.rmb = false;
  };

  private onClick = (ev: MouseEvent): void => {
    if (this.locked || this.mode === 'hidden' || this.synthMouse()) return;
    const t = ev.target;
    if (!(t instanceof Element) || isInteractive(t)) return;
    if (t === this.el || t.parentElement === this.el) this.lock();
  };

  private onWheel = (ev: WheelEvent): void => {
    if (!(this.locked || this.lockFailed) || this.mode === 'hidden' || ev.deltaY === 0) return;
    const now = performance.now();
    if (now - this.wheelAt < WHEEL_GAP_MS) return;
    this.wheelAt = now;
    this.edges.swap = true;
    if (!this.settings.holdAds) this.adsToggle = false;
  };

  private onLockChange = (): void => {
    if (this.locked) {
      this.lockFailed = false;
      this.lockAt = performance.now();
      this.freeX = NaN; this.freeY = NaN;
    } else {
      // 잠금이 풀리면 누르고 있던 마우스 버튼은 놓은 것으로 (일시 정지는 통합 쪽이 처리)
      this.lmb = false; this.rmb = false;
    }
  };
}
