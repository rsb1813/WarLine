// 결과 화면: 승패, 사유, 점수, K/D/A, 소생, 점령, 헤드샷, 경험치와 계급 진행
import type { BattleResult } from '../types';
import { MAPS } from '../defs';
import type { AppCtx } from './menu-util';
import { esc, fmtInt, onAct, rankBadge, rankInfo, reducedMotion } from './menu-util';
import { IC } from './menu-icons';

export function mountResults(ctx: AppCtx, r: BattleResult, xpBefore: number, again: () => void, home: () => void): () => void {
  const p = ctx.profile;
  const before = rankInfo(xpBefore);
  const after = rankInfo(p.xp);
  const map = MAPS.find((m) => m.id === p.map);
  const kd = r.kills / Math.max(1, r.deaths);
  const mins = Math.max(0, r.minutes || 0);
  const mm = Math.floor(mins), ss = Math.round((mins - mm) * 60);

  const el = document.createElement('div');
  el.className = `wm-screen wm-res ${r.win ? 'win' : 'lose'}`;
  el.innerHTML = `
    <div class="wm-res-bg" aria-hidden="true"></div>
    <div class="wm-res-in">
      <p class="wm-eyebrow wm-rise" style="--d:0"><i></i>작전 종료 · ${esc(map?.name ?? '')} · ${mm}분 ${String(ss).padStart(2, '0')}초</p>
      <h1 class="wm-res-t wm-rise" style="--d:1">${r.win ? '승리' : '패배'}</h1>
      <p class="wm-res-reason wm-rise" style="--d:2">${esc(r.reason || (r.win ? '적 전선이 무너졌습니다' : '아군 전선이 무너졌습니다'))}</p>
      <dl class="wm-res-grid wm-rise" style="--d:3">
        <div class="wm-res-score"><dt>점수</dt><dd data-n="${Math.round(r.score)}">0</dd></div>
        <div><dt>${IC.target}사살</dt><dd>${fmtInt(r.kills)}</dd></div>
        <div><dt>${IC.skull}전사</dt><dd>${fmtInt(r.deaths)}</dd></div>
        <div><dt>${IC.users}도움</dt><dd>${fmtInt(r.assists)}</dd></div>
        <div><dt>${IC.stack}K/D</dt><dd>${kd.toFixed(2)}</dd></div>
        <div><dt>${IC.heart}소생</dt><dd>${fmtInt(r.revives)}</dd></div>
        <div><dt>${IC.flag}점령</dt><dd>${fmtInt(r.caps)}</dd></div>
        <div><dt>${IC.head}헤드샷</dt><dd>${fmtInt(r.heads)}</dd></div>
      </dl>
      <section class="wm-card wm-res-xp wm-rise" style="--d:4">
        <div class="wm-res-xp-h"><span class="wm-k">획득 경험치</span><b>+<span data-n="${Math.max(0, Math.round(r.xp))}">0</span> XP</b></div>
        <div class="wm-res-rank">
          <span class="wm-res-badge">${rankBadge(before.rank)}</span>
          <div class="wm-res-rank-b">
            <p class="wm-res-rank-t"><b data-rt>${esc(before.title)}</b><span data-rn>계급 ${before.rank}</span></p>
            <div class="wm-xp wm-xp-lg"><i data-bar style="width:${(before.frac * 100).toFixed(1)}%"></i></div>
            <p class="wm-xp-t"><span data-xt>${fmtInt(before.inRank)} / ${fmtInt(before.span)} XP</span><span>총 ${fmtInt(p.xp)} XP</span></p>
          </div>
        </div>
        <p class="wm-rankup" hidden>${IC.bolt}<span>계급 상승 · ${esc(after.title)}</span></p>
      </section>
      <div class="wm-res-btns wm-rise" style="--d:5">
        <button class="primary wm-big" data-a="again">${IC.reset}<span>다시 하기</span></button>
        <button class="wm-big" data-a="home">${IC.back}<span>메인으로</span></button>
      </div>
    </div>`;
  ctx.root.appendChild(el);

  const bar = el.querySelector('[data-bar]') as HTMLElement;
  const xt = el.querySelector('[data-xt]') as HTMLElement;
  const badge = el.querySelector('.wm-res-badge') as HTMLElement;
  const rt = el.querySelector('[data-rt]') as HTMLElement;
  const rn = el.querySelector('[data-rn]') as HTMLElement;
  const up = el.querySelector('.wm-rankup') as HTMLElement;
  const counters = [...el.querySelectorAll<HTMLElement>('dd[data-n], span[data-n]')];

  const still = reducedMotion();
  let raf = 0;
  const t0 = performance.now() + (still ? 0 : 650);
  const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const ranked = after.rank > before.rank;
  let shownUp = false;
  const finalFrame = () => {
    for (const c of counters) c.textContent = fmtInt(Number(c.dataset.n));
    setRank(after.rank, after.title, after.frac, after.inRank, after.span);
    if (ranked) up.hidden = false;
  };
  const setRank = (rank: number, title: string, frac: number, inRank: number, span: number) => {
    bar.style.width = `${(frac * 100).toFixed(1)}%`;
    xt.textContent = `${fmtInt(inRank)} / ${fmtInt(span)} XP`;
    if (rn.textContent !== `계급 ${rank}`) {
      rn.textContent = `계급 ${rank}`;
      rt.textContent = title;
      badge.innerHTML = rankBadge(rank);
    }
  };
  const frame = (now: number) => {
    const t = (now - t0) / 1000;
    if (t < 0) { raf = requestAnimationFrame(frame); return; }
    const k = ease(t / 1.3);
    for (const c of counters) c.textContent = fmtInt(Number(c.dataset.n) * k);
    // 경험치 막대: 쌓인 경험치를 앞에서부터 채운다
    const xpNow = xpBefore + (p.xp - xpBefore) * ease(t / 1.8);
    const ri = rankInfo(xpNow);
    setRank(ri.rank, ri.title, ri.frac, ri.inRank, ri.span);
    if (ri.rank > before.rank && !shownUp) { shownUp = true; up.hidden = false; up.classList.add('pop'); }
    if (t < 1.9) raf = requestAnimationFrame(frame);
    else finalFrame();
  };
  if (still) finalFrame();
  else raf = requestAnimationFrame(frame);

  const off = onAct(el, (a) => {
    if (a === 'again') again();
    else if (a === 'home') home();
  });
  return () => { cancelAnimationFrame(raf); off(); };
}
