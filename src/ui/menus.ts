// 메뉴 화면: 첫 화면, 전투 설정, 병과 장비, 분대 편성, 설정, 조작법
import { CLASSES, CLASS_ORDER, DEFAULT_KITS, DIFFS, FACTIONS, LORE, MAPS, SIZES, type ClassId, type Diff, type Side, type SizeId } from '../game/defs';
import { createBattle, step } from '../game/battle';
import { genWorld } from '../game/mapgen';
import { CELL } from '../game/grid';
import { rankOf, saveProfile, type Profile } from '../game/profile';
import { QUALITY, Renderer, type Quality } from '../render/renderer';
import { Terrain } from '../render/terrain';
import { clsIcon } from './game';
import { kitSummary, renderKit } from './kit';

export interface Screen { destroy(): void }
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function onClick(el: HTMLElement, fn: (a: string, t: HTMLElement) => void) {
  el.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
    if (t && !(t as HTMLButtonElement).disabled) fn(t.dataset.a!, t);
  });
}

// ───────── 첫 화면 ─────────

export function homeScreen(root: HTMLElement, p: Profile, go: (to: string) => void): Screen {
  const rk = rankOf(p.xp);
  const map = MAPS.find((m) => m.id === p.map) ?? MAPS[0];
  root.innerHTML = `<div class="home">
    <canvas class="bg"></canvas><div class="shade"></div>
    <main>
      <p class="eyebrow">2147 · 베링 해협</p>
      <h1>WAR<span>LINE</span></h1>
      <p class="lore">${LORE} 병사 한 명이 되어 분대와 함께 거점을 빼앗으십시오. 전차와 헬기를 몰고, 벽을 부수고, 쓰러진 전우를 일으키십시오.</p>
      <div class="go">
        <button data-a="battle" class="primary huge">출격<small>${esc(map.name)} · ${SIZES[p.size].name} · ${DIFFS[p.diff].name}</small></button>
        <div class="menu">
          <button data-a="setup">전투 설정</button>
          <button data-a="loadout">병과·장비</button>
          <button data-a="squad">분대 편성</button>
          <button data-a="settings">설정</button>
          <button data-a="help">조작법</button>
        </div>
      </div>
      <div class="me"><span class="rk">계급 ${rk.rank}</span><i><b style="width:${(rk.cur / rk.next) * 100}%"></b></i><small>${p.stats.games}전 ${p.stats.wins}승 · 사살 ${p.stats.kills} · 소생 ${p.stats.revives}</small></div>
    </main>
  </div>`;
  const el = root.firstElementChild as HTMLElement;
  onClick(el, (a) => go(a));
  // 배경: 봇끼리 싸우는 실제 전투
  const b = createBattle({ map: MAPS[2], size: 'medium', diff: 'normal', side: 'us', kits: DEFAULT_KITS, playerCls: 'assault', squadCls: ['medic', 'engineer', 'recon'] });
  b.player.bot = true;
  for (let i = 0; i < 60 * 35; i++) { step(b, 1 / 30); b.events.length = 0; }
  const r = new Renderer(el.querySelector('canvas.bg') as HTMLCanvasElement, b, p.quality === 'high' ? 'medium' : p.quality);
  let follow = -1, switchT = 0, raf = 0, last = performance.now(), dead = false;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const frame = (now: number) => {
    if (dead) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!still) { step(b, dt); for (const e of b.events) r.handle(e); b.events.length = 0; }
    if (b.over) { b.over = null; b.tickets = [...b.startTickets]; }
    for (const s of b.soldiers) s.seen = true;
    for (const v of b.vehicles) v.seen = true;
    switchT -= dt;
    const cur = b.soldiers[follow];
    if (switchT <= 0 || !cur || cur.state !== 0) {
      const busy = b.soldiers.filter((s) => s.state === 0 && s.veh < 0 && s.ai.target >= 0);
      const pool = busy.length ? busy : b.soldiers.filter((s) => s.state === 0);
      follow = pool.length ? pool[Math.floor(Math.random() * pool.length)].id : 0;
      switchT = 8;
    }
    const f = b.soldiers[follow];
    const k = 1 - Math.pow(0.05, dt);
    r.cam.x += (f.x - r.cam.x) * k; r.cam.y += (f.y - r.cam.y) * k;
    r.cam.z = r.baseZoom() * 1.15;
    r.draw(still ? 0 : dt);
  };
  const f0 = b.soldiers.find((s) => s.state === 0) ?? b.soldiers[0];
  r.cam.x = f0.x; r.cam.y = f0.y;
  raf = requestAnimationFrame(frame);
  return { destroy() { dead = true; cancelAnimationFrame(raf); r.destroy(); } };
}

// ───────── 전투 설정 ─────────

const previews = new Map<string, HTMLCanvasElement>();

function mapPreview(id: string): HTMLCanvasElement {
  const have = previews.get(id);
  if (have) return have;
  const def = MAPS.find((m) => m.id === id)!;
  const w = genWorld(def, false);
  const t = new Terrain(w, 0.25);
  const c = document.createElement('canvas');
  c.width = w.cw * 2; c.height = w.ch * 2;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = true;
  g.drawImage(t.low, 0, 0, c.width, c.height);
  const s = c.width / w.w;
  g.fillStyle = 'rgba(36,40,44,0.9)';
  for (const b of w.buildings) g.fillRect(b.x * CELL * s, b.y * CELL * s, b.w * CELL * s, b.h * CELL * s);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const f of w.flags) {
    g.fillStyle = 'rgba(8,13,18,0.85)'; g.beginPath(); g.arc(f.x * s, f.y * s, 9, 0, 7); g.fill();
    g.fillStyle = '#e8d9a8'; g.font = '800 12px "Saira Condensed", sans-serif'; g.fillText(f.tag, f.x * s, f.y * s + 1);
  }
  w.hq.forEach((h, k) => { g.strokeStyle = k === 0 ? '#4aa8ff' : '#ff5d4a'; g.lineWidth = 2; g.strokeRect(h.x * s - 5, h.y * s - 5, 10, 10); });
  previews.set(id, c);
  return c;
}

export function setupScreen(root: HTMLElement, p: Profile, go: (to: string) => void): Screen {
  const render = () => {
    root.innerHTML = `<div class="page setup"><div class="page-in">
      <header class="ph"><button data-a="home" class="back">←</button><div><p class="eyebrow">전투 설정</p><h1>어디서 싸울까요</h1></div></header>
      <h3>전장</h3>
      <div class="maps">${MAPS.map((m) => `<button class="mapc${m.id === p.map ? ' on' : ''}" data-a="map" data-v="${m.id}">
        <span class="pv" data-pv="${m.id}"></span><b>${esc(m.name)}</b><small>${esc(m.place)} · 거점 ${m.flags.length} · 추천 ${SIZES[m.size].name}</small><span class="d">${esc(m.desc)}</span></button>`).join('')}</div>
      <h3>규모</h3>
      <div class="segs big">${(Object.keys(SIZES) as SizeId[]).map((s) => `<button class="seg${s === p.size ? ' on' : ''}" data-a="size" data-v="${s}">${SIZES[s].name}<small>차량 ${SIZES[s].vehicles.length}대 · 티켓 ${SIZES[s].tickets}</small></button>`).join('')}</div>
      <h3>난이도</h3>
      <div class="segs big">${(Object.keys(DIFFS) as Diff[]).map((d) => `<button class="seg${d === p.diff ? ' on' : ''}" data-a="diff" data-v="${d}">${DIFFS[d].name}<small>${DIFFS[d].desc}</small></button>`).join('')}</div>
      <h3>진영</h3>
      <div class="segs big">${(['us', 'ru'] as Side[]).map((s) => `<button class="seg side${s === p.side ? ' on' : ''}" data-a="side" data-v="${s}" style="--c:${FACTIONS[s].color}">${FACTIONS[s].name}<small>${FACTIONS[s].army}</small></button>`).join('')}</div>
      <div class="foot"><button data-a="battle" class="primary huge">출격</button></div>
    </div></div>`;
    // 미리보기는 하나씩 천천히 만든다
    let k = 0;
    const next = () => {
      const m = MAPS[k++];
      if (!m || !root.querySelector('.setup')) return;
      const slot = root.querySelector(`[data-pv="${m.id}"]`);
      if (slot) { slot.innerHTML = ''; slot.appendChild(mapPreview(m.id)); }
      setTimeout(next, 30);
    };
    setTimeout(next, 30);
  };
  const handler = (a: string, t: HTMLElement) => {
    const v = t.dataset.v!;
    if (a === 'home' || a === 'battle') { saveProfile(p); go(a); return; }
    if (a === 'map') { p.map = v; const m = MAPS.find((x) => x.id === v); if (m) p.size = m.size; }
    else if (a === 'size') p.size = v as SizeId;
    else if (a === 'diff') p.diff = v as Diff;
    else if (a === 'side') p.side = v as Side;
    saveProfile(p);
    const y = (root.querySelector('.page') as HTMLElement).scrollTop;
    render();
    (root.querySelector('.page') as HTMLElement).scrollTop = y;
  };
  const el = root;
  const fn = (e: Event) => {
    const t = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
    if (t && root.querySelector('.setup')) handler(t.dataset.a!, t);
  };
  el.addEventListener('click', fn);
  render();
  return { destroy() { el.removeEventListener('click', fn); } };
}

// ───────── 병과·장비 ─────────

export function loadoutScreen(root: HTMLElement, p: Profile, go: (to: string) => void): Screen {
  let cls: ClassId = p.cls;
  const render = () => {
    root.innerHTML = `<div class="page loadout"><div class="page-in wide">
      <header class="ph"><button data-a="home" class="back">←</button><div><p class="eyebrow">병과·장비</p><h1>무엇을 들고 갈까요</h1></div>
        <button data-a="battle" class="primary">출격</button></header>
      <div class="ctabs">${CLASS_ORDER.map((c) => `<button data-a="cls" data-v="${c}" class="${c === cls ? 'on' : ''}"><span class="ci">${clsIcon(c)}</span><b>${CLASSES[c].name}</b><small>${CLASSES[c].role}</small></button>`).join('')}</div>
      <div class="kit"></div>
      <div class="foot"><button data-a="reset" class="ghost">이 병과 기본값으로</button><button data-a="use" class="primary">${CLASSES[cls].name}으로 출격</button></div>
    </div></div>`;
    renderKit(root.querySelector('.kit') as HTMLElement, p, cls, () => saveProfile(p));
  };
  const fn = (e: Event) => {
    const t = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
    if (!t || !root.querySelector('.loadout')) return;
    const a = t.dataset.a!;
    if (a === 'home' || a === 'battle') { saveProfile(p); go(a); return; }
    if (a === 'cls') { cls = t.dataset.v as ClassId; render(); }
    if (a === 'reset') { p.kits[cls] = { ...DEFAULT_KITS[cls] }; saveProfile(p); render(); }
    if (a === 'use') { p.cls = cls; saveProfile(p); go('battle'); }
  };
  root.addEventListener('click', fn);
  render();
  return { destroy() { root.removeEventListener('click', fn); } };
}

// ───────── 분대 편성 ─────────

export function squadScreen(root: HTMLElement, p: Profile, go: (to: string) => void): Screen {
  const render = () => {
    root.innerHTML = `<div class="page squadp"><div class="page-in">
      <header class="ph"><button data-a="home" class="back">←</button><div><p class="eyebrow">분대 편성</p><h1>함께 갈 분대원</h1></div></header>
      <p class="lead">분대원 세 명은 나를 따라다니며 싸웁니다. 병과마다 내가 맞춘 장비를 그대로 씁니다. 쓰러지면 의무병이 일으켜 주고, 공병은 차량을 고치고, 정찰병은 적을 표시합니다.</p>
      <div class="me-card"><span class="ci">${clsIcon(p.cls)}</span><div><b>나 · ${CLASSES[p.cls].name}</b><small>${kitSummary(p, p.cls)}</small></div></div>
      ${p.squad.map((c, i) => `<div class="mate"><h4>분대원 ${i + 1}</h4><div class="segs">${CLASS_ORDER.map((x) => `<button class="seg${x === c ? ' on' : ''}" data-a="mate" data-i="${i}" data-v="${x}"><span class="ci">${clsIcon(x)}</span>${CLASSES[x].short}</button>`).join('')}</div><small>${kitSummary(p, c)}</small></div>`).join('')}
      <div class="foot"><button data-a="loadout" class="ghost">병과 장비 바꾸기</button><button data-a="battle" class="primary">출격</button></div>
    </div></div>`;
  };
  const fn = (e: Event) => {
    const t = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
    if (!t || !root.querySelector('.squadp')) return;
    const a = t.dataset.a!;
    if (a === 'mate') { p.squad[Number(t.dataset.i)] = t.dataset.v as ClassId; saveProfile(p); render(); return; }
    go(a);
  };
  root.addEventListener('click', fn);
  render();
  return { destroy() { root.removeEventListener('click', fn); } };
}

// ───────── 설정 ─────────

export function settingsScreen(root: HTMLElement, p: Profile, go: (to: string) => void): Screen {
  const render = () => {
    root.innerHTML = `<div class="page settings"><div class="page-in">
      <header class="ph"><button data-a="home" class="back">←</button><div><p class="eyebrow">설정</p><h1>설정</h1></div></header>
      <h3>그래픽</h3>
      <div class="segs big">${(Object.keys(QUALITY) as Quality[]).map((q) => `<button class="seg${q === p.quality ? ' on' : ''}" data-a="q" data-v="${q}">${QUALITY[q].name}<small>${q === 'high' ? '선명한 지형, 효과 많이' : q === 'medium' ? '폰에 알맞음' : '오래된 기기용'}</small></button>`).join('')}</div>
      <h3>소리</h3>
      <label class="range" for="s-vol">음량 <input id="s-vol" type="range" min="0" max="1" step="0.05" value="${p.volume}"></label>
      <h3>터치 조작</h3>
      <label class="range" for="s-assist">조준 보정 <input id="s-assist" type="range" min="0" max="1" step="0.1" value="${p.assist}"></label>
      <label class="tog" for="s-auto"><input type="checkbox" id="s-auto" ${p.autofire ? 'checked' : ''}><span>오른쪽 스틱을 밀면 바로 쏘기<small>끄면 끝까지 밀어야 쏩니다</small></span></label>
      <h3>도움말</h3>
      <label class="tog" for="s-hints"><input type="checkbox" id="s-hints" ${p.hints ? 'checked' : ''}><span>전투 초반에 조작 안내 보이기</span></label>
    </div></div>`;
    const bind = (id: string, f: (el: HTMLInputElement) => void) => (root.querySelector(id) as HTMLInputElement).addEventListener('input', (e) => { f(e.target as HTMLInputElement); saveProfile(p); });
    bind('#s-vol', (e) => (p.volume = Number(e.value)));
    bind('#s-assist', (e) => (p.assist = Number(e.value)));
    bind('#s-auto', (e) => (p.autofire = e.checked));
    bind('#s-hints', (e) => (p.hints = e.checked));
  };
  const fn = (e: Event) => {
    const t = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
    if (!t || !root.querySelector('.settings')) return;
    if (t.dataset.a === 'q') { p.quality = t.dataset.v as Quality; saveProfile(p); render(); return; }
    go(t.dataset.a!);
  };
  root.addEventListener('click', fn);
  render();
  return { destroy() { root.removeEventListener('click', fn); } };
}

// ───────── 조작법 ─────────

export function helpScreen(root: HTMLElement, _p: Profile, go: (to: string) => void): Screen {
  root.innerHTML = `<div class="page help"><div class="page-in">
    <header class="ph"><button data-a="home" class="back">←</button><div><p class="eyebrow">조작법</p><h1>조작과 규칙</h1></div></header>
    <div class="cols">
      <section><h3>키보드와 마우스</h3><table>
        <tr><th>WASD</th><td>이동</td></tr><tr><th>마우스</th><td>조준 · 좌클릭 사격</td></tr><tr><th>우클릭</th><td>정조준 (멀리 보고 정확해짐) · 전차에서는 기관총</td></tr>
        <tr><th>Shift</th><td>달리기</td></tr><tr><th>C</th><td>앉기 (낮은 엄폐물 뒤에서 탄을 막아 줌)</td></tr><tr><th>R</th><td>재장전</td></tr>
        <tr><th>1 · 2 · 3</th><td>주무기 · 장비 1 · 장비 2</td></tr><tr><th>G</th><td>수류탄 (조준한 곳에 던짐)</td></tr><tr><th>Q</th><td>조준한 쪽의 적 표시</td></tr>
        <tr><th>E</th><td>차량 탑승·하차 · 누르고 있으면 쓰러진 아군 소생</td></tr><tr><th>F</th><td>차량 좌석 바꾸기</td></tr><tr><th>Space</th><td>차량 연막·섬광탄</td></tr>
        <tr><th>Tab · M · Esc</th><td>점수판 · 지도 · 일시 정지</td></tr></table></section>
      <section><h3>터치</h3><p>왼쪽 화면을 끌면 이동, 오른쪽을 끌면 그쪽을 조준하며 쏩니다. 조준은 보이는 적 쪽으로 조금 당겨집니다. 오른쪽 버튼으로 정조준, 재장전, 수류탄, 장비, 앉기, 표시를 씁니다. 차량 곁이나 쓰러진 아군 곁에서는 탑승·소생 버튼이 나타납니다.</p>
      <h3>이기는 법</h3><p>깃발 원 안에 아군만 있으면 점령이 진행됩니다. 여럿이 함께 있을수록 빠릅니다. 거점을 절반 넘게 쥐면 적의 티켓이 계속 줄어듭니다. 병사가 다시 나올 때마다 티켓이 하나씩 듭니다. 티켓이 바닥나면 집니다.</p>
      <h3>쓰러짐과 소생</h3><p>체력이 다하면 쓰러집니다. 의무병은 어느 아군이든 1초 만에 일으키고, 분대원은 누구든 3.5초 걸려 일으킵니다. 일으켜지면 티켓이 줄지 않습니다.</p>
      <h3>파괴</h3><p>로켓, 유탄, 전차 포, 수류탄은 벽을 부숩니다. 벽이 절반 넘게 부서진 건물은 무너지며 안에 있던 병사를 다치게 합니다. 전차는 나무와 울타리를 밀고 지나가고 벽을 들이받아 부숩니다.</p>
      <h3>차량</h3><p>전차와 장갑차는 총에 끄떡없습니다. 공병의 대전차 로켓과 지뢰, 다른 전차로 잡으세요. 뒤쪽을 맞히면 1.5배 들어갑니다. 헬기는 공병의 대공 미사일이나 기관포로 잡습니다. 차량은 본부 근처에서 저절로 고쳐집니다.</p></section>
    </div>
  </div></div>`;
  const fn = (e: Event) => {
    const t = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
    if (t && root.querySelector('.help')) go(t.dataset.a!);
  };
  root.addEventListener('click', fn);
  return { destroy() { root.removeEventListener('click', fn); } };
}
