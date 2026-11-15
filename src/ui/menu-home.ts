// 첫 화면: 큰 제목, 배경 장면, 주 메뉴, 계급·전적, 다음 작전 요약
import { CLASSES, DIFFS, FACTIONS, LORE, MAPS, SIZES, WEAPONS } from '../defs';
import type { AppCtx, Route } from './menu-util';
import { esc, fmtInt, isTouch, onAct, rankBadge, rankInfo } from './menu-util';
import { Backdrop } from './menu-backdrop';
import { drawMapThumb } from './menu-thumb';
import { CLASS_IC, IC } from './menu-icons';

export function mountHome(ctx: AppCtx): () => void {
  const p = ctx.profile;
  const ri = rankInfo(p.xp);
  const map = MAPS.find((m) => m.id === p.map) ?? MAPS[0];
  const size = SIZES[p.size];
  const diff = DIFFS[p.diff];
  const side = FACTIONS[p.side];
  const cls = CLASSES[p.cls];
  const prim = WEAPONS[p.loadouts?.[p.cls]?.primary?.id ?? ''];
  const st = p.stats;
  const kd = st.kills / Math.max(1, st.deaths);
  const winRate = st.games ? Math.round((st.wins / st.games) * 100) : 0;
  const touch = isTouch();
  const sizeTxt = size ? `${size.perTeam} 대 ${size.perTeam}` : '';
  const word = 'WARLINE';

  const el = document.createElement('div');
  el.className = 'wm-screen wm-home';
  el.innerHTML = `
    <canvas class="wm-home-bg" aria-hidden="true"></canvas>
    <div class="wm-home-shade" aria-hidden="true"></div>
    <header class="wm-home-top">
      <div class="wm-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l9 5v10l-9 5-9-5V7z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7 9l2.5 7L12 11l2.5 5L17 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg><b>WARLINE</b><span>3D</span></div>
      <div class="wm-home-chip">${touch ? `${IC.touch}<span>터치 · 가로 화면 권장</span>` : `${IC.mouse}<span>마우스 · 키보드</span>`}</div>
    </header>
    <main class="wm-home-main">
      <section class="wm-hero">
        <p class="wm-eyebrow wm-rise" style="--d:0"><i></i>2147 · 베링 해협</p>
        <h1 class="wm-word" aria-label="${word}">${[...word].map((c, i) => `<span style="--i:${i}">${c}</span>`).join('')}</h1>
        <p class="wm-tag wm-rise" style="--d:2">대규모 제병협동 정복전 · ${esc(FACTIONS.us?.name ?? '')} 대 ${esc(FACTIONS.ru?.name ?? '')}</p>
        <p class="wm-lore wm-rise" style="--d:3">${esc(LORE)}</p>
        <nav class="wm-nav wm-rise" style="--d:4">
          <button class="wm-deploy" data-a="battle">
            <span class="wm-deploy-t">전투 개시</span>
            <span class="wm-deploy-s">${esc(map?.name ?? '')} · ${esc(sizeTxt)} · ${esc(diff?.name ?? '')}</span>
            <span class="wm-deploy-i">${IC.deploy}</span>
          </button>
          <div class="wm-links">
            ${link('play', IC.setup, '전투 설정', '지도 · 규모 · 난이도 · 진영')}
            ${link('loadout', IC.loadout, '로드아웃', '병과 · 무기 · 부착물 · 장비')}
            ${link('settings', IC.settings, '설정', '그래픽 · 감도 · 소리')}
            ${link('help', IC.help, '조작법', p.seenHelp ? 'PC · 터치 · 규칙' : '처음이라면 먼저 확인하세요', !p.seenHelp)}
          </div>
        </nav>
      </section>
      <aside class="wm-side wm-rise" style="--d:5">
        <div class="wm-card wm-rank">
          ${rankBadge(ri.rank)}
          <div class="wm-rank-b">
            <p class="wm-k">계급 ${ri.rank}</p>
            <p class="wm-rank-t">${esc(ri.title)}</p>
            <div class="wm-xp"><i style="width:${(ri.frac * 100).toFixed(1)}%"></i></div>
            <p class="wm-xp-t"><span>${fmtInt(ri.inRank)} / ${fmtInt(ri.span)} XP</span><span>${ri.toNext > 0 ? `다음 계급까지 ${fmtInt(ri.toNext)}` : '최고 계급'}</span></p>
          </div>
        </div>
        <dl class="wm-quick">
          <div><dt>${IC.stack}전투</dt><dd>${fmtInt(st.games)}</dd></div>
          <div><dt>${IC.flag}승리</dt><dd>${fmtInt(st.wins)}<small>${st.games ? ` ${winRate}%` : ''}</small></dd></div>
          <div><dt>${IC.target}사살</dt><dd>${fmtInt(st.kills)}</dd></div>
          <div><dt>${IC.skull}K/D</dt><dd>${kd.toFixed(2)}</dd></div>
        </dl>
        <div class="wm-card wm-next">
          <div class="wm-next-h"><span class="wm-k">다음 작전</span><button class="wm-ghost" data-a="play">변경${IC.chevron}</button></div>
          <div class="wm-next-map"><canvas class="wm-thumb"></canvas><div><b>${esc(map?.name ?? '-')}</b><small>${esc(map?.place ?? '')}</small></div></div>
          <dl class="wm-rows">
            <div><dt>규모</dt><dd>${esc(sizeTxt)}</dd></div>
            <div><dt>난이도</dt><dd>${esc(diff?.name ?? '-')}</dd></div>
            <div><dt>진영</dt><dd><i class="wm-dot" style="background:${esc(side?.css ?? '#888')}"></i>${esc(side?.name ?? '-')}</dd></div>
            <div><dt>병과</dt><dd><button class="wm-inline" data-a="loadout">${CLASS_IC[p.cls] ?? ''}${esc(cls?.name ?? '')}${prim ? ` · ${esc(prim.name)}` : ''}</button></dd></div>
          </dl>
        </div>
      </aside>
    </main>`;
  ctx.root.appendChild(el);

  const bd = new Backdrop(el.querySelector('.wm-home-bg') as HTMLCanvasElement, p.settings?.quality ?? 'medium');
  bd.start();
  const thumb = el.querySelector('.wm-thumb') as HTMLCanvasElement;
  const raf = requestAnimationFrame(() => { if (map) drawMapThumb(thumb, map); });

  const off = onAct(el, (a) => {
    if (a === 'battle') ctx.go('battle');
    else ctx.go(a as Route);
  });

  return () => {
    cancelAnimationFrame(raf);
    off();
    bd.dispose();
  };
}

function link(a: string, ic: string, t: string, s: string, hot = false): string {
  return `<button class="wm-link${hot ? ' hot' : ''}" data-a="${a}"><span class="wm-link-i">${ic}</span><span class="wm-link-b"><b>${t}</b><small>${s}</small></span><span class="wm-link-c">${IC.chevron}</span></button>`;
}
