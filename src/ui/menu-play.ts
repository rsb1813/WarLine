// 전투 설정: 지도 카드(절차 축소 지도), 규모, 난이도, 진영
import type { Diff, Side, SizeId } from '../types';
import { DIFFS, FACTIONS, MAPS, SIZES, VEHICLES } from '../defs';
import type { AppCtx } from './menu-util';
import { esc, isTouch, onAct } from './menu-util';
import { drawMapThumb } from './menu-thumb';
import { IC } from './menu-icons';

const THEME: Record<string, string> = { snow: '설원', tundra: '툰드라', industrial: '산업 지대' };
const TIME: Record<string, string> = { day: '주간', dusk: '해 질 녘', overcast: '흐림' };
const WATER: Record<string, string> = { none: '내륙', coast: '해안', river: '강' };
const SIDE_NOTE: Record<string, string> = { us: '추코트카 해안에 교두보를 세우려는 원정군', ru: '항구와 강, 정유 시설을 지키는 방어군' };

export function mountPlay(ctx: AppCtx, start: () => void): () => void {
  const p = ctx.profile;
  const touch = isTouch();
  const sizeIds = Object.keys(SIZES) as SizeId[];
  const diffIds = Object.keys(DIFFS) as Diff[];
  const sideIds = Object.keys(FACTIONS) as Side[];
  if (!MAPS.some((m) => m.id === p.map) && MAPS[0]) p.map = MAPS[0].id;

  const vehText = (ids: string[]) => {
    const n: Record<string, number> = {};
    for (const v of ids) n[v] = (n[v] ?? 0) + 1;
    return Object.keys(n).map((k) => `${esc(VEHICLES[k as keyof typeof VEHICLES]?.short ?? k)} ${n[k]}`).join(' · ');
  };

  const el = document.createElement('div');
  el.className = 'wm-screen wm-page wm-play';
  el.innerHTML = `
    <header class="wm-top">
      <button class="wm-back" data-a="back" aria-label="뒤로">${IC.back}<span>뒤로</span></button>
      <div class="wm-top-t"><p class="wm-eyebrow"><i></i>작전 준비</p><h2 class="wm-h2">전투 설정</h2></div>
    </header>
    <div class="wm-body">
      <section class="wm-sec">
        <h3 class="wm-h3"><b>01</b>작전 지역</h3>
        <div class="wm-maps">
          ${MAPS.map((m) => `
            <button class="wm-map" data-a="map" data-v="${esc(m.id)}" aria-pressed="${m.id === p.map}">
              <span class="wm-map-img"><canvas data-map="${esc(m.id)}"></canvas><span class="wm-map-size">${Math.round(m.size)} m</span></span>
              <span class="wm-map-b">
                <span class="wm-map-place">${esc(m.place)}</span>
                <b class="wm-map-name">${esc(m.name)}</b>
                <span class="wm-map-desc">${esc(m.desc)}</span>
                <span class="wm-tags"><i>${THEME[m.theme] ?? m.theme}</i><i>${TIME[m.time] ?? m.time}</i><i>${WATER[m.water] ?? m.water}</i></span>
              </span>
              <span class="wm-sel">${IC.check}</span>
            </button>`).join('')}
        </div>
      </section>
      <section class="wm-sec">
        <h3 class="wm-h3"><b>02</b>규모</h3>
        <div class="wm-opts wm-opts-3">
          ${sizeIds.map((id) => {
            const s = SIZES[id];
            const heavy = touch && s.perTeam > 32;
            return `<button class="wm-opt" data-a="size" data-v="${id}" aria-pressed="${id === p.size}">
              <span class="wm-opt-big">${s.perTeam}<em>대</em>${s.perTeam}</span>
              <span class="wm-opt-l">${s.name.includes('대') ? `팀당 ${s.perTeam}명` : `${esc(s.name)} · 팀당 ${s.perTeam}명`}</span>
              <span class="wm-opt-rows"><span>거점 ${s.flags}개</span><span>티켓 ${s.tickets}</span><span>${s.vehicles.length ? `차량 ${vehText(s.vehicles)}` : '차량 없음'}</span></span>
              ${heavy ? `<span class="wm-warn">${IC.info}휴대폰에서는 무거울 수 있습니다</span>` : ''}
              <span class="wm-sel">${IC.check}</span>
            </button>`;
          }).join('')}
        </div>
        ${touch ? `<p class="wm-note">${IC.info}휴대폰에서는 32 대 32 이하 권장</p>` : ''}
      </section>
      <section class="wm-sec">
        <h3 class="wm-h3"><b>03</b>난이도</h3>
        <div class="wm-opts wm-opts-3">
          ${diffIds.map((id, i) => {
            const d = DIFFS[id];
            return `<button class="wm-opt wm-diff" data-a="diff" data-v="${id}" aria-pressed="${id === p.diff}">
              <span class="wm-pips">${[0, 1, 2].map((k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</span>
              <span class="wm-opt-name">${esc(d.name)}</span>
              <span class="wm-opt-desc">${esc(d.desc)}</span>
              <span class="wm-sel">${IC.check}</span>
            </button>`;
          }).join('')}
        </div>
      </section>
      <section class="wm-sec">
        <h3 class="wm-h3"><b>04</b>진영</h3>
        <div class="wm-opts wm-opts-2">
          ${sideIds.map((id) => {
            const f = FACTIONS[id];
            return `<button class="wm-opt wm-side-opt" data-a="side" data-v="${id}" aria-pressed="${id === p.side}" style="--fc:${esc(f.css)}">
              <span class="wm-fac-mark">${esc(f.short)}</span>
              <span class="wm-fac-b"><span class="wm-opt-name">${esc(f.name)}</span><span class="wm-opt-desc">${esc(f.army && f.army !== f.name ? f.army : SIDE_NOTE[id] ?? '')}</span></span>
              <span class="wm-sel">${IC.check}</span>
            </button>`;
          }).join('')}
        </div>
      </section>
    </div>
    <footer class="wm-bar">
      <div class="wm-bar-sum"></div>
      <button class="primary wm-big" data-a="start">${IC.deploy}<span>전투 개시</span></button>
    </footer>`;
  ctx.root.appendChild(el);

  const sum = el.querySelector('.wm-bar-sum') as HTMLElement;
  const refresh = () => {
    el.querySelectorAll<HTMLElement>('[data-a][data-v]').forEach((b) => {
      const a = b.dataset.a, v = b.dataset.v;
      const on = (a === 'map' && v === p.map) || (a === 'size' && v === p.size) || (a === 'diff' && v === p.diff) || (a === 'side' && v === p.side);
      b.setAttribute('aria-pressed', String(on));
    });
    const m = MAPS.find((x) => x.id === p.map);
    const s = SIZES[p.size];
    sum.innerHTML = `<b>${esc(m?.name ?? '')}</b><span>${s ? `${s.perTeam} 대 ${s.perTeam}` : ''} · ${esc(DIFFS[p.diff]?.name ?? '')} · <i class="wm-dot" style="background:${esc(FACTIONS[p.side]?.css ?? '#888')}"></i>${esc(FACTIONS[p.side]?.name ?? '')}</span>`;
  };
  refresh();

  const paint = () => el.querySelectorAll<HTMLCanvasElement>('canvas[data-map]').forEach((c) => {
    const m = MAPS.find((x) => x.id === c.dataset.map);
    if (m) drawMapThumb(c, m);
  });
  const raf = requestAnimationFrame(paint);
  let rt = 0;
  const onResize = () => { clearTimeout(rt); rt = window.setTimeout(paint, 160); };
  window.addEventListener('resize', onResize);

  const off = onAct(el, (a, t) => {
    const v = t.dataset.v ?? '';
    if (a === 'back') { ctx.back(); return; }
    if (a === 'start') { start(); return; }
    if (a === 'map') p.map = v;
    else if (a === 'size' && v in SIZES) p.size = v as SizeId;
    else if (a === 'diff' && v in DIFFS) p.diff = v as Diff;
    else if (a === 'side' && v in FACTIONS) p.side = v as Side;
    else return;
    ctx.save();
    refresh();
  });

  return () => {
    off();
    cancelAnimationFrame(raf);
    clearTimeout(rt);
    window.removeEventListener('resize', onResize);
  };
}
