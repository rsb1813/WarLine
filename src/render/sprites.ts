// 코드로 그린 그림 조각: 병사, 무기, 차량, 나무, 연기와 불꽃
import type { ClassId, VehicleType } from '../game/defs';

export const SPR = 3; // 그림 조각의 해상도 (월드 단위당 픽셀)

export function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** 월드 단위로 그리는 그림 조각. (cx, cy)가 중심 */
export interface Sprite { c: HTMLCanvasElement; w: number; h: number; cx: number; cy: number }

function make(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, cx = w / 2, cy = h / 2, scale = SPR): Sprite {
  const c = canvas(w * scale, h * scale);
  const g = c.getContext('2d')!;
  g.scale(scale, scale);
  g.translate(cx, cy);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  draw(g);
  return { c, w, h, cx, cy };
}

export function drawSprite(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, a: number, alpha = 1, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  if (a) ctx.rotate(a);
  if (alpha !== 1) ctx.globalAlpha *= alpha;
  ctx.drawImage(s.c, -s.cx * scale, -s.cy * scale, s.w * scale, s.h * scale);
  ctx.restore();
}

const rr = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
};

export interface TeamLook { uni: string; uni2: string; helm: string; accent: string; light: string; hull: string; hull2: string; hull3: string }
export const LOOKS: TeamLook[] = [
  { uni: '#3f5a74', uni2: '#2f465c', helm: '#4f6b85', accent: '#4aa8ff', light: '#bfe0ff', hull: '#56697a', hull2: '#435563', hull3: '#6f8597' },
  { uni: '#6a463d', uni2: '#51342d', helm: '#7a5448', accent: '#ff5d4a', light: '#ffc9bf', hull: '#6f6450', hull2: '#584e3e', hull3: '#8a7e66' },
];

// ───────── 병사 ─────────

function soldierBody(look: TeamLook, cls: ClassId): Sprite {
  return make(36, 36, (g) => {
    // 배낭과 병과 장비
    if (cls === 'engineer') {
      g.save(); g.rotate(-0.5);
      g.fillStyle = '#3b4236'; rr(g, -14, -2.2, 22, 4.4, 2); g.fill();
      g.fillStyle = '#566048'; rr(g, -14, -2.2, 5, 4.4, 1.5); g.fill();
      g.restore();
    }
    g.fillStyle = cls === 'medic' ? '#d9dcd6' : cls === 'recon' ? '#3d4a33' : '#5b5f45';
    rr(g, -10, -5.2, 7, 10.4, 2.5); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.8; g.stroke();
    if (cls === 'medic') { g.fillStyle = '#d23a32'; g.fillRect(-7.6, -2.6, 2.2, 5.2); g.fillRect(-8.8, -1.1, 4.6, 2.2); }
    if (cls === 'recon') { g.fillStyle = '#4c5c3c'; for (const [x, y] of [[-8, -4], [-5, 3], [-9, 2], [-4, -3]]) { g.beginPath(); g.arc(x, y, 2, 0, 7); g.fill(); } }
    // 어깨와 몸통
    g.fillStyle = look.uni;
    g.beginPath(); g.ellipse(0, 0, 5.6, 8.4, 0, 0, 7); g.fill();
    g.strokeStyle = 'rgba(10,14,18,0.55)'; g.lineWidth = 1; g.stroke();
    g.fillStyle = look.uni2;
    rr(g, -3.6, -5.6, 6.6, 11.2, 2.2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.08)'; rr(g, -3, -5, 2.4, 10, 1); g.fill();
    // 팔
    g.strokeStyle = look.uni; g.lineWidth = 3.2;
    g.beginPath(); g.moveTo(0.5, -6.6); g.lineTo(9, -1.6); g.stroke();
    g.beginPath(); g.moveTo(0.5, 6.6); g.lineTo(6.5, 1.6); g.stroke();
    g.fillStyle = '#2a2724';
    g.beginPath(); g.arc(9, -1.4, 1.7, 0, 7); g.fill();
    g.beginPath(); g.arc(6.6, 1.4, 1.7, 0, 7); g.fill();
    // 헬멧
    g.fillStyle = look.helm;
    g.beginPath(); g.arc(0.8, 0, 4.7, 0, 7); g.fill();
    g.strokeStyle = 'rgba(10,14,18,0.6)'; g.lineWidth = 0.9; g.stroke();
    g.strokeStyle = look.accent; g.lineWidth = 1.2;
    g.beginPath(); g.arc(0.8, 0, 3.4, Math.PI * 0.6, Math.PI * 1.4); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.beginPath(); g.arc(-0.4, -1.4, 2, 0, 7); g.fill();
  });
}

export type WeaponKind = 'ar' | 'carbine' | 'smg' | 'shotgun' | 'lmg' | 'dmr' | 'sniper' | 'rpg' | 'aa' | 'ugl' | 'torch';

function weaponSprite(k: WeaponKind): Sprite {
  const len = { ar: 19, carbine: 16, smg: 13, shotgun: 18, lmg: 21, dmr: 22, sniper: 27, rpg: 24, aa: 26, ugl: 19, torch: 12 }[k];
  return make(40, 14, (g) => {
    const x0 = 3;
    if (k === 'rpg' || k === 'aa') {
      g.fillStyle = k === 'aa' ? '#4a5a44' : '#4b5240';
      rr(g, x0 - 8, -2.2, len, 4.4, 2); g.fill();
      g.fillStyle = '#2b2f28'; g.fillRect(x0 + len - 11, -3, 4, 6);
      if (k === 'rpg') { g.fillStyle = '#6b6b52'; g.beginPath(); g.moveTo(x0 + len - 8, -3.2); g.lineTo(x0 + len - 1, 0); g.lineTo(x0 + len - 8, 3.2); g.fill(); }
      else { g.fillStyle = '#c9d06a'; g.fillRect(x0 + len - 9, -2.2, 1.4, 4.4); }
      return;
    }
    if (k === 'torch') {
      g.fillStyle = '#c47a2a'; rr(g, x0, -1.6, len, 3.2, 1.2); g.fill();
      g.fillStyle = '#3c3c3c'; g.fillRect(x0 + len - 2, -1, 3, 2);
      return;
    }
    g.fillStyle = '#1e2124';
    rr(g, x0, -1.5, len, 3, 1); g.fill();
    g.fillStyle = '#2e3338';
    rr(g, x0 + 2, -2, len * 0.45, 4, 1); g.fill();
    if (k === 'lmg') { g.fillStyle = '#3a4031'; rr(g, x0 + 5, 1, 6, 4.5, 1); g.fill(); }
    else if (k === 'shotgun') { g.fillStyle = '#5b3d26'; rr(g, x0 + len * 0.5, -1.6, 5, 3.2, 1); g.fill(); }
    else { g.fillStyle = '#25282b'; g.fillRect(x0 + len * 0.42, 1, 2.2, 3.4); }
    if (k === 'sniper' || k === 'dmr') { g.fillStyle = '#121416'; rr(g, x0 + 5, -3.2, 9, 2.2, 1); g.fill(); g.fillStyle = '#6ec6ff'; g.fillRect(x0 + 13.6, -3, 0.8, 1.8); }
    if (k === 'ugl') { g.fillStyle = '#3b3f2f'; rr(g, x0 + 6, 0.8, 9, 3.2, 1.4); g.fill(); }
  }, 8, 7);
}

/** 쓰러지거나 죽은 병사 */
function lyingBody(look: TeamLook): Sprite {
  return make(36, 24, (g) => {
    g.fillStyle = look.uni2;
    rr(g, -14, -3.2, 12, 2.8, 1.4); g.fill();
    rr(g, -14, 0.6, 12, 2.8, 1.4); g.fill();
    g.fillStyle = look.uni;
    g.beginPath(); g.ellipse(1, 0, 7.5, 5.6, 0, 0, 7); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 0.8; g.stroke();
    g.strokeStyle = look.uni; g.lineWidth = 2.8;
    g.beginPath(); g.moveTo(3, -5); g.lineTo(10, -9); g.stroke();
    g.beginPath(); g.moveTo(3, 5); g.lineTo(8, 9); g.stroke();
    g.fillStyle = look.helm;
    g.beginPath(); g.arc(10.5, 0.5, 4.4, 0, 7); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 0.8; g.stroke();
  });
}

// ───────── 차량 ─────────

function camo(g: CanvasRenderingContext2D, look: TeamLook, x: number, y: number, w: number, h: number, seed: number) {
  let s = seed;
  const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  g.save();
  g.clip();
  for (let k = 0; k < 9; k++) {
    g.fillStyle = k % 2 ? look.hull2 : look.hull3;
    g.globalAlpha = 0.55;
    g.beginPath();
    g.ellipse(x + r() * w, y + r() * h, 4 + r() * 8, 2 + r() * 5, r() * 3, 0, 7);
    g.fill();
  }
  g.restore();
}

export interface VehSprites { hull: Sprite; turret: Sprite | null; barrel: Sprite | null; gun2: Sprite | null; wreck: Sprite; rotor?: Sprite; tracks?: Sprite[] }

function tankSprites(look: TeamLook): VehSprites {
  const tracks: Sprite[] = [];
  for (let f = 0; f < 4; f++) {
    tracks.push(make(64, 46, (g) => {
      for (const y of [-21, 15]) {
        g.fillStyle = '#1b1e20'; rr(g, -31, y, 62, 7, 2.5); g.fill();
        g.fillStyle = '#2d3236';
        for (let x = -30 + f * 1.5; x < 30; x += 6) g.fillRect(x, y + 0.6, 2.4, 5.8);
      }
    }));
  }
  const hull = make(64, 46, (g) => {
    g.fillStyle = look.hull;
    g.beginPath(); g.moveTo(-28, -15); g.lineTo(24, -15); g.lineTo(30, -9); g.lineTo(30, 9); g.lineTo(24, 15); g.lineTo(-28, 15); g.closePath(); g.fill();
    camo(g, look, -28, -15, 58, 30, 7);
    g.strokeStyle = 'rgba(10,12,14,0.65)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(-28, -15); g.lineTo(24, -15); g.lineTo(30, -9); g.lineTo(30, 9); g.lineTo(24, 15); g.lineTo(-28, 15); g.closePath(); g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(-27, -10, 9, 20);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.7;
    for (let x = -26; x < -18; x += 2.2) { g.beginPath(); g.moveTo(x, -9); g.lineTo(x, 9); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.moveTo(24, -15); g.lineTo(30, -9); g.lineTo(30, 9); g.lineTo(24, 15); g.closePath(); g.fill();
    g.fillStyle = look.accent; g.fillRect(-20, 12, 6, 2);
  });
  const turret = make(40, 34, (g) => {
    g.fillStyle = look.hull2;
    g.beginPath(); g.moveTo(-13, -11); g.lineTo(7, -12); g.lineTo(13, -6); g.lineTo(13, 6); g.lineTo(7, 12); g.lineTo(-13, 11); g.lineTo(-16, 0); g.closePath(); g.fill();
    camo(g, look, -16, -12, 29, 24, 13);
    g.strokeStyle = 'rgba(10,12,14,0.7)'; g.lineWidth = 1.1; g.stroke();
    g.fillStyle = look.hull; g.beginPath(); g.arc(-4, -4, 3.6, 0, 7); g.fill(); g.stroke();
    g.beginPath(); g.arc(-3, 5, 2.6, 0, 7); g.fill(); g.stroke();
    g.fillStyle = look.accent; g.fillRect(-12, -1, 3, 2);
  }, 16, 17);
  const barrel = make(40, 8, (g) => {
    g.fillStyle = '#2a2f33'; rr(g, 0, -1.8, 36, 3.6, 1.2); g.fill();
    g.fillStyle = '#3c4247'; g.fillRect(16, -2.4, 6, 4.8);
    g.fillStyle = '#1b1e20'; g.fillRect(33, -2.2, 3, 4.4);
  }, 0, 4);
  const gun2 = make(20, 8, (g) => { g.fillStyle = '#1f2326'; rr(g, 0, -1, 15, 2, 0.8); g.fill(); g.fillStyle = '#353b40'; rr(g, -3, -2.6, 6, 5.2, 1); g.fill(); }, 3, 4);
  return { hull, turret, barrel, gun2, wreck: wreckOf(64, 46, 'tank'), tracks };
}

function ifvSprites(look: TeamLook): VehSprites {
  const tracks: Sprite[] = [];
  for (let f = 0; f < 4; f++) {
    tracks.push(make(56, 40, (g) => {
      for (const y of [-18, 12]) {
        g.fillStyle = '#1b1e20'; rr(g, -26, y, 52, 6, 2); g.fill();
        g.fillStyle = '#2d3236';
        for (let x = -25 + f * 1.4; x < 25; x += 5.5) g.fillRect(x, y + 0.6, 2, 4.8);
      }
    }));
  }
  const hull = make(56, 40, (g) => {
    g.fillStyle = look.hull;
    g.beginPath(); g.moveTo(-25, -13); g.lineTo(18, -13); g.lineTo(26, -7); g.lineTo(26, 7); g.lineTo(18, 13); g.lineTo(-25, 13); g.closePath(); g.fill();
    camo(g, look, -25, -13, 51, 26, 21);
    g.strokeStyle = 'rgba(10,12,14,0.65)'; g.lineWidth = 1.1; g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.28)'; rr(g, -24, -6, 6, 12, 1); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(-14, -11, 22, 4); g.fillRect(-14, 7, 22, 4);
    g.fillStyle = look.hull2; g.beginPath(); g.arc(-12, -5, 2.4, 0, 7); g.arc(-12, 5, 2.4, 0, 7); g.fill();
    g.fillStyle = look.accent; g.fillRect(-20, 10, 5, 2);
  });
  const turret = make(26, 24, (g) => {
    g.fillStyle = look.hull2; rr(g, -9, -8, 18, 16, 4); g.fill();
    g.strokeStyle = 'rgba(10,12,14,0.7)'; g.lineWidth = 1; g.stroke();
    g.fillStyle = look.hull; g.beginPath(); g.arc(-2, -2, 3, 0, 7); g.fill(); g.stroke();
  }, 11, 12);
  const barrel = make(30, 6, (g) => { g.fillStyle = '#2a2f33'; rr(g, 0, -1.2, 25, 2.4, 1); g.fill(); g.fillStyle = '#1b1e20'; g.fillRect(22, -1.6, 3, 3.2); }, 0, 3);
  return { hull, turret, barrel, gun2: null, wreck: wreckOf(56, 40, 'ifv'), tracks };
}

function jeepSprites(look: TeamLook): VehSprites {
  const hull = make(46, 30, (g) => {
    g.fillStyle = '#151719';
    for (const [x, y] of [[-12, -11], [11, -11], [-12, 8], [11, 8]]) { rr(g, x - 4, y, 8, 3.6, 1.4); g.fill(); }
    g.fillStyle = look.hull;
    rr(g, -19, -10, 39, 20, 5); g.fill();
    camo(g, look, -19, -10, 39, 20, 33);
    g.strokeStyle = 'rgba(10,12,14,0.7)'; g.lineWidth = 1.1; rr(g, -19, -10, 39, 20, 5); g.stroke();
    g.fillStyle = 'rgba(150,200,230,0.55)'; rr(g, 4, -8, 4, 16, 1.4); g.fill();
    g.fillStyle = look.hull2; rr(g, 8, -8.5, 11, 17, 3); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.3)'; rr(g, -16, -7.5, 18, 15, 2); g.fill();
    g.fillStyle = look.accent; g.fillRect(-18, -2, 2, 4);
  });
  const gun2 = make(26, 12, (g) => {
    g.fillStyle = '#2d3338'; g.beginPath(); g.arc(0, 0, 4.2, 0, 7); g.fill();
    g.fillStyle = '#1b1f22'; rr(g, 0, -1.2, 18, 2.4, 1); g.fill();
    g.fillStyle = '#3d454c'; rr(g, -2, -3, 6, 6, 1); g.fill();
  }, 6, 6);
  return { hull, turret: null, barrel: null, gun2, wreck: wreckOf(46, 30, 'jeep') };
}

function heliSprites(look: TeamLook): VehSprites {
  const hull = make(80, 44, (g) => {
    // 꼬리
    g.fillStyle = look.hull2; rr(g, -40, -2.2, 30, 4.4, 2); g.fill();
    g.fillStyle = look.hull; rr(g, -42, -7, 5, 14, 2); g.fill();
    g.strokeStyle = 'rgba(30,34,38,0.6)'; g.lineWidth = 2; g.beginPath(); g.moveTo(-40, -8); g.lineTo(-40, 8); g.stroke();
    // 날개와 로켓 포드
    g.fillStyle = look.hull2; rr(g, -6, -17, 9, 34, 2); g.fill();
    g.fillStyle = '#2a2f33';
    for (const y of [-17, 12]) { rr(g, -9, y, 15, 5, 2.4); g.fill(); }
    // 동체
    g.fillStyle = look.hull;
    g.beginPath(); g.ellipse(2, 0, 20, 7.2, 0, 0, 7); g.fill();
    camo(g, look, -18, -7, 40, 14, 47);
    g.strokeStyle = 'rgba(10,12,14,0.7)'; g.lineWidth = 1.1; g.beginPath(); g.ellipse(2, 0, 20, 7.2, 0, 0, 7); g.stroke();
    g.fillStyle = 'rgba(140,200,235,0.7)'; g.beginPath(); g.ellipse(14, 0, 6.5, 4.4, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(140,200,235,0.55)'; g.beginPath(); g.ellipse(4, 0, 4.5, 3.8, 0, 0, 7); g.fill();
    g.fillStyle = '#1e2225'; g.beginPath(); g.arc(21, 0, 2.2, 0, 7); g.fill();
    g.fillStyle = look.accent; g.fillRect(-14, -1, 4, 2);
  }, 44, 22);
  const rotor = make(84, 84, (g) => {
    g.fillStyle = 'rgba(30,34,38,0.16)'; g.beginPath(); g.arc(0, 0, 40, 0, 7); g.fill();
    g.strokeStyle = 'rgba(25,28,31,0.75)'; g.lineWidth = 3;
    for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 40, Math.sin(a) * 40); g.stroke(); }
    g.fillStyle = '#2b3034'; g.beginPath(); g.arc(0, 0, 3.4, 0, 7); g.fill();
  });
  const gun2 = make(20, 8, (g) => { g.fillStyle = '#1f2326'; rr(g, 0, -1.2, 13, 2.4, 1); g.fill(); g.fillStyle = '#353b40'; g.beginPath(); g.arc(0, 0, 3, 0, 7); g.fill(); }, 4, 4);
  return { hull, turret: null, barrel: null, gun2, wreck: wreckOf(70, 40, 'heli'), rotor };
}

function wreckOf(w: number, h: number, type: VehicleType): Sprite {
  return make(w, h, (g) => {
    g.fillStyle = '#26221f';
    if (type === 'heli') { g.beginPath(); g.ellipse(2, 0, 20, 7, 0.1, 0, 7); g.fill(); rr(g, -32, -2, 22, 4, 2); g.fill(); }
    else { rr(g, -w / 2 + 3, -h / 2 + 4, w - 6, h - 8, 4); g.fill(); }
    g.fillStyle = '#3a332c';
    for (let k = 0; k < 7; k++) { g.beginPath(); g.arc((Math.sin(k * 7.1) * w) / 3, (Math.cos(k * 3.3) * h) / 4, 2 + (k % 3), 0, 7); g.fill(); }
    g.fillStyle = 'rgba(255,120,40,0.25)'; g.beginPath(); g.arc(-4, 2, 5, 0, 7); g.fill();
  });
}

// ───────── 나무, 효과 ─────────

function pine(seed: number, snowy: boolean): Sprite {
  return make(64, 64, (g) => {
    let s = seed;
    const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const layers = [[24, '#1d3d33'], [18, '#24493c'], [12, '#2d5847'], [6, '#36654f']] as const;
    for (const [rad, col] of layers) {
      g.fillStyle = col;
      g.beginPath();
      const n = 9;
      for (let k = 0; k <= n * 2; k++) {
        const a = (k / (n * 2)) * Math.PI * 2 + seed;
        const rr2 = k % 2 ? rad * 0.62 : rad * (0.92 + r() * 0.16);
        const x = Math.cos(a) * rr2, y = Math.sin(a) * rr2;
        if (k) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.closePath();
      g.fill();
      if (snowy) {
        g.fillStyle = 'rgba(235,242,248,0.55)';
        for (let k = 0; k < 5; k++) { g.beginPath(); g.arc((r() - 0.6) * rad, (r() - 0.6) * rad, 2 + r() * 2.5, 0, 7); g.fill(); }
      }
    }
  });
}

function birch(seed: number, snowy: boolean): Sprite {
  return make(56, 56, (g) => {
    let s = seed;
    const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (let k = 0; k < 11; k++) {
      g.fillStyle = k % 3 === 0 ? '#5e6d34' : k % 3 === 1 ? '#76843d' : '#8c8f46';
      g.globalAlpha = 0.92;
      g.beginPath();
      g.arc((r() - 0.5) * 22, (r() - 0.5) * 22, 7 + r() * 6, 0, 7);
      g.fill();
    }
    if (snowy) { g.fillStyle = 'rgba(235,242,248,0.5)'; for (let k = 0; k < 5; k++) { g.beginPath(); g.arc((r() - 0.5) * 18, (r() - 0.5) * 18, 3 + r() * 3, 0, 7); g.fill(); } }
  });
}

function puff(r: number, g0: string, g1: string): Sprite {
  return make(r * 2, r * 2, (g) => {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
    gr.addColorStop(0, g0);
    gr.addColorStop(0.55, g1);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
  }, r, r, 1);
}

export interface Sprites {
  body: Record<string, Sprite>;
  lying: Sprite[];
  weapons: Record<WeaponKind, Sprite>;
  veh: Record<string, VehSprites>;
  pines: Sprite[];
  birches: Sprite[];
  smoke: Sprite;
  dust: Sprite;
  glow: Sprite;
  fire: Sprite;
  snowPuff: Sprite;
  dark: Sprite;
}

export function buildSprites(snowy: boolean): Sprites {
  const body: Record<string, Sprite> = {};
  for (const t of [0, 1]) for (const c of ['assault', 'engineer', 'medic', 'recon'] as ClassId[]) body[`${t}${c}`] = soldierBody(LOOKS[t], c);
  const weapons = {} as Record<WeaponKind, Sprite>;
  for (const k of ['ar', 'carbine', 'smg', 'shotgun', 'lmg', 'dmr', 'sniper', 'rpg', 'aa', 'ugl', 'torch'] as WeaponKind[]) weapons[k] = weaponSprite(k);
  const veh: Record<string, VehSprites> = {};
  for (const t of [0, 1]) {
    veh[`${t}tank`] = tankSprites(LOOKS[t]);
    veh[`${t}ifv`] = ifvSprites(LOOKS[t]);
    veh[`${t}jeep`] = jeepSprites(LOOKS[t]);
    veh[`${t}heli`] = heliSprites(LOOKS[t]);
  }
  return {
    body, lying: [lyingBody(LOOKS[0]), lyingBody(LOOKS[1])], weapons, veh,
    pines: [1, 2, 3, 4].map((k) => pine(k * 17, snowy)),
    birches: [1, 2, 3].map((k) => birch(k * 31, snowy)),
    smoke: puff(64, 'rgba(120,124,128,0.55)', 'rgba(110,114,118,0.3)'),
    dust: puff(64, 'rgba(150,138,118,0.5)', 'rgba(140,128,110,0.25)'),
    glow: puff(64, 'rgba(255,240,200,0.95)', 'rgba(255,170,70,0.35)'),
    fire: puff(64, 'rgba(255,220,120,0.95)', 'rgba(240,90,30,0.55)'),
    snowPuff: puff(64, 'rgba(245,248,252,0.8)', 'rgba(235,240,246,0.4)'),
    dark: puff(64, 'rgba(30,32,34,0.7)', 'rgba(30,32,34,0.35)'),
  };
}

export const WEAPON_KIND: Record<string, WeaponKind> = {
  '돌격소총': 'ar', '전투소총': 'ar', '카빈': 'carbine', '기관단총': 'smg', '중기관단총': 'smg', '산탄총': 'shotgun',
  '경기관총': 'lmg', '분대지원화기': 'lmg', '지정사수소총': 'dmr', '대물저격소총': 'sniper', '경저격소총': 'sniper',
};
