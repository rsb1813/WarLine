// 조준경 화면: 검은 가림막 + 둥근 렌즈 + 조준선. 크기·조준선·배율이 바뀔 때만 다시 그린다.
import { el, setShow } from './hud-util';

export class ScopeView {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private key = '';
  private on = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'h-scope', parent);
    this.canvas = el('canvas', 'sc-canvas', this.root);
    this.ctx = this.canvas.getContext('2d');
    setShow(this.root, false);
  }

  update(active: boolean, reticle: string, zoom: number, w: number, h: number): void {
    if (active !== this.on) { this.on = active; setShow(this.root, active); }
    if (!active) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const key = `${Math.round(w)}x${Math.round(h)}@${dpr}:${reticle}:${zoom.toFixed(1)}`;
    if (key === this.key) return;
    this.key = key;
    this.draw(reticle, zoom, w, h, dpr);
  }

  private draw(reticle: string, zoom: number, w: number, h: number, dpr: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    this.canvas.width = W; this.canvas.height = H;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) * 0.46;
    // 가림막
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-out';
    const hole = ctx.createRadialGradient(cx, cy, R * 0.94, cx, cy, R);
    hole.addColorStop(0, 'rgba(0,0,0,1)');
    hole.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hole;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // 렌즈 가장자리 어둡게, 살짝 푸른 코팅
    const vig = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(0.75, 'rgba(0,6,10,0.18)');
    vig.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = vig;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(40,90,120,0.035)';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    // 반사광
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = R * 0.05;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.86, Math.PI * 1.1, Math.PI * 1.42); ctx.stroke();
    // 경통 테
    ctx.strokeStyle = 'rgba(12,12,12,1)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, R - 1, 0, Math.PI * 2); ctx.stroke();

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R - 2, 0, Math.PI * 2); ctx.clip();
    const ink = 'rgba(6,8,8,0.95)';
    const line = (x0: number, y0: number, x1: number, y1: number, lw: number, col = ink): void => {
      ctx.strokeStyle = col; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    };
    const posts = (gap: number, lw: number): void => {
      line(cx - R, cy, cx - gap, cy, lw);
      line(cx + gap, cy, cx + R, cy, lw);
      line(cx, cy + gap, cx, cy + R, lw);
    };
    const step = R * 0.075;
    switch (reticle) {
      case 'mil': {
        line(cx - R, cy, cx + R, cy, 1.1);
        line(cx, cy - R, cx, cy + R, 1.1);
        posts(R * 0.52, 5);
        line(cx, cy - R, cx, cy - R * 0.52, 5);
        ctx.fillStyle = ink;
        for (let i = 1; i <= 5; i++) {
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            ctx.beginPath(); ctx.arc(cx + dx * step * i, cy + dy * step * i, i === 5 ? 2.2 : 1.8, 0, Math.PI * 2); ctx.fill();
          }
        }
        // 낙차 보정 눈금
        for (let i = 1; i <= 4; i++) line(cx - step * (0.9 - i * 0.12), cy + step * i + step * 0.5, cx + step * (0.9 - i * 0.12), cy + step * i + step * 0.5, 0.9);
        break;
      }
      case 'chevron': {
        line(cx - R, cy + step * 1.6, cx - step * 3, cy + step * 1.6, 1.4);
        line(cx + step * 3, cy + step * 1.6, cx + R, cy + step * 1.6, 1.4);
        line(cx, cy + step * 2.2, cx, cy + R, 1.4);
        ctx.strokeStyle = 'rgba(255,90,40,0.95)';
        ctx.lineWidth = 2.2;
        ctx.lineJoin = 'miter';
        ctx.beginPath();
        ctx.moveTo(cx - step * 1.4, cy + step * 1.5); ctx.lineTo(cx, cy); ctx.lineTo(cx + step * 1.4, cy + step * 1.5);
        ctx.stroke();
        for (let i = 1; i <= 3; i++) line(cx - step * 0.35, cy + step * (2.2 + i * 1.1), cx + step * 0.35, cy + step * (2.2 + i * 1.1), 1.2);
        break;
      }
      case 'dot':
      case 'holo':
      case 'iron': {
        line(cx - R, cy, cx - step * 2.5, cy, 1.2);
        line(cx + step * 2.5, cy, cx + R, cy, 1.2);
        line(cx, cy + step * 2.5, cx, cy + R, 1.2);
        ctx.strokeStyle = 'rgba(255,60,50,0.9)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(cx, cy, step * 1.6, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(255,60,50,1)';
        ctx.beginPath(); ctx.arc(cx, cy, 2.2, 0, Math.PI * 2); ctx.fill();
        break;
      }
      default: { // cross
        line(cx - R, cy, cx + R, cy, 1);
        line(cx, cy - R, cx, cy + R, 1);
        posts(R * 0.42, 4.5);
        line(cx, cy - R, cx, cy - R * 0.42, 4.5);
        ctx.fillStyle = 'rgba(255,60,50,0.95)';
        ctx.beginPath(); ctx.arc(cx, cy, 1.6, 0, Math.PI * 2); ctx.fill();
        for (let i = 1; i <= 3; i++) line(cx - 4, cy + step * i * 1.2, cx + 4, cy + step * i * 1.2, 1);
      }
    }
    ctx.restore();
    // 배율 표시
    ctx.fillStyle = 'rgba(200,210,215,0.55)';
    ctx.font = `600 12px 'Saira Condensed', sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const ang = Math.PI * 0.2;
    ctx.fillText(`${zoom.toFixed(zoom % 1 ? 1 : 0)}×`, cx + Math.cos(ang) * (R + 10), cy + Math.sin(ang) * (R + 10));
  }
}
