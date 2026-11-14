// 입력: 키보드와 마우스, 터치 두 스틱과 버튼
import type { Ctl } from '../game/types';

export interface Stick { id: number; ox: number; oy: number; x: number; y: number }
type Edge = 'reloadE' | 'primaryE' | 'useAE' | 'useBE' | 'grenadeE' | 'interactE' | 'seatE' | 'spotE' | 'counterE';

export class Input {
  keys = new Set<string>();
  mouse = { x: 0, y: 0, l: false, r: false, seen: false };
  touch = false;
  left: Stick | null = null;
  right: Stick | null = null;
  crouch = false;
  adsToggle = false;
  /** 터치 버튼이 누르고 있는 상태 */
  hold = { interact: false, fire2: false };
  pending = new Set<Edge>();
  /** 한 번 누르는 화면 전환 키 */
  onKey: (k: string, down: boolean) => void = () => {};
  private off: (() => void)[] = [];

  constructor(el: HTMLElement) {
    // 손가락이 주 입력인 기기라면 처음부터 터치 조작을 띄운다
    this.touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const on = <K extends keyof WindowEventMap>(t: EventTarget, k: K, fn: (e: WindowEventMap[K]) => void, opt?: AddEventListenerOptions) => {
      t.addEventListener(k, fn as EventListener, opt);
      this.off.push(() => t.removeEventListener(k, fn as EventListener, opt));
    };
    const map: Record<string, Edge> = { r: 'reloadE', 1: 'primaryE', 2: 'useAE', 3: 'useBE', g: 'grenadeE', e: 'interactE', f: 'seatE', q: 'spotE', ' ': 'counterE' };
    on(window, 'keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
      const k = e.key.toLowerCase();
      if (e.repeat && k !== 'w' && k !== 'a' && k !== 's' && k !== 'd') { e.preventDefault(); return; }
      this.keys.add(k);
      if (map[k]) this.pending.add(map[k]);
      if (k === 'c' || k === 'control') this.crouch = !this.crouch;
      if ([' ', 'tab'].includes(k)) e.preventDefault();
      this.onKey(k, true);
    });
    on(window, 'keyup', (e) => { const k = e.key.toLowerCase(); this.keys.delete(k); this.onKey(k, false); });
    on(window, 'blur', () => { this.keys.clear(); this.mouse.l = false; this.mouse.r = false; });
    const pos = (cx: number, cy: number): [number, number] => { const r = el.getBoundingClientRect(); return [cx - r.left, cy - r.top]; };
    on(el, 'mousemove', (e) => { [this.mouse.x, this.mouse.y] = pos(e.clientX, e.clientY); this.mouse.seen = true; });
    on(el, 'mousedown', (e) => {
      [this.mouse.x, this.mouse.y] = pos(e.clientX, e.clientY);
      this.mouse.seen = true;
      if (e.button === 0) this.mouse.l = true; else if (e.button === 2) this.mouse.r = true;
    });
    on(window, 'mouseup', (e) => { if (e.button === 0) this.mouse.l = false; else if (e.button === 2) this.mouse.r = false; });
    on(el, 'contextmenu', (e) => e.preventDefault());
    on(el, 'touchstart', (e) => {
      this.touch = true;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      for (const t of Array.from(e.changedTouches)) {
        const [x, y] = pos(t.clientX, t.clientY);
        const s: Stick = { id: t.identifier, ox: x, oy: y, x, y };
        if (x < r.width * 0.45) { if (!this.left) this.left = s; } else if (!this.right) this.right = s;
      }
    }, { passive: false });
    on(el, 'touchmove', (e) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        const [x, y] = pos(t.clientX, t.clientY);
        for (const s of [this.left, this.right]) if (s && s.id === t.identifier) { s.x = x; s.y = y; }
      }
    }, { passive: false });
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (this.left?.id === t.identifier) this.left = null;
        if (this.right?.id === t.identifier) this.right = null;
      }
    };
    on(el, 'touchend', end);
    on(el, 'touchcancel', end);
  }

  destroy() { for (const f of this.off) f(); }

  press(e: Edge) { this.pending.add(e); }

  stick(s: Stick | null, R = 56): [number, number] {
    if (!s) return [0, 0];
    let dx = (s.x - s.ox) / R, dy = (s.y - s.oy) / R;
    const l = Math.hypot(dx, dy);
    if (l > 1) {
      // 손가락이 많이 밀려나면 중심을 따라 끌고 온다
      s.ox = s.x - (dx / l) * R; s.oy = s.y - (dy / l) * R;
      dx /= l; dy /= l;
    }
    return [dx, dy];
  }

  /**
   * 조작을 채운다. px, py는 플레이어의 월드 좌표, toWorld는 화면 → 월드, assist는 터치 조준 보정.
   * autofire가 켜져 있으면 오른쪽 스틱을 밀기만 해도 쏜다.
   */
  read(c: Ctl, px: number, py: number, toWorld: (x: number, y: number) => [number, number], assist: (a: number) => number, autofire: boolean) {
    const k = this.keys;
    if (this.touch) {
      const [mx, my] = this.stick(this.left);
      c.mx = mx; c.my = my;
      c.sprint = Math.hypot(mx, my) > 0.95 && !this.right;
      const [ax, ay] = this.stick(this.right);
      const al = Math.hypot(ax, ay);
      if (al > 0.18) c.aim = assist(Math.atan2(ay, ax));
      else if (Math.hypot(mx, my) > 0.3 && !this.right) c.aim = assist(Math.atan2(my, mx));
      c.fire = autofire ? al > 0.5 : al > 0.85;
      const reach = 140 + 260 * Math.min(1, al);
      c.tx = px + Math.cos(c.aim) * reach;
      c.ty = py + Math.sin(c.aim) * reach;
      c.ads = this.adsToggle;
      c.fire2 = this.hold.fire2;
    } else {
      c.mx = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
      c.my = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
      const l = Math.hypot(c.mx, c.my);
      if (l > 1) { c.mx /= l; c.my /= l; }
      c.sprint = k.has('shift');
      const [wx, wy] = toWorld(this.mouse.x, this.mouse.y);
      c.aim = Math.atan2(wy - py, wx - px);
      c.tx = wx; c.ty = wy;
      c.fire = this.mouse.l;
      c.ads = this.mouse.r;
      c.fire2 = this.mouse.r;
    }
    c.crouch = this.crouch;
    c.interact = k.has('e') || this.hold.interact;
    for (const e of this.pending) c[e] = true;
    this.pending.clear();
  }
}
