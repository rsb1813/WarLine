// 설정: 그래픽 품질, 감도, 정조준 감도, 시야각, Y 반전, 음량, 조준 보정, FPS 표시, 정조준 방식. 바로 저장.
import type { Quality, Settings } from '../types';
import { DEFAULT_SETTINGS } from '../profile';
import type { AppCtx } from './menu-util';
import { esc, isTouch, onAct } from './menu-util';
import { IC } from './menu-icons';

type NumKey = 'sens' | 'adsSens' | 'fov' | 'volume' | 'aimAssist';
type BoolKey = 'invertY' | 'showFps';

const RANGES: Record<NumKey, { min: number; max: number; step: number; label: string; hint: string; fmt: (v: number) => string }> = {
  sens: { min: 0.2, max: 3, step: 0.05, label: '시선 감도', hint: '마우스와 터치 끌기 모두에 적용', fmt: (v) => `${v.toFixed(2)}×` },
  adsSens: { min: 0.4, max: 1.5, step: 0.05, label: '정조준 감도', hint: '정조준 중 감도 배율 (배율 조준경은 추가로 보정)', fmt: (v) => `${v.toFixed(2)}×` },
  fov: { min: 60, max: 95, step: 1, label: '시야각', hint: '수직 시야각. 넓을수록 주변이 많이 보이고 멀리 있는 적은 작아짐', fmt: (v) => `${Math.round(v)}°` },
  volume: { min: 0, max: 1, step: 0.05, label: '전체 음량', hint: '총성, 폭발, 차량, 알림', fmt: (v) => `${Math.round(v * 100)}%` },
  aimAssist: { min: 0, max: 1, step: 0.05, label: '조준 보정', hint: '터치 조작에서만 적용. 적 위를 지날 때 시선이 조금 느려지고 따라감', fmt: (v) => (v <= 0 ? '끔' : `${Math.round(v * 100)}%`) },
};

const QUALITY: { id: Quality; name: string; hint: string }[] = [
  { id: 'low', name: '낮음', hint: '그림자와 효과를 줄이고 해상도를 낮춥니다. 휴대폰과 저사양 노트북용.' },
  { id: 'medium', name: '보통', hint: '부드러운 그림자와 적당한 효과. 대부분의 기기에 알맞습니다.' },
  { id: 'high', name: '높음', hint: '선명한 그림자, 파티클 최대, 높은 해상도. 성능이 넉넉한 PC용.' },
];

export function mountSettings(ctx: AppCtx): () => void {
  const p = ctx.profile;
  p.settings = { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) } as Settings;
  const set = p.settings;
  const touch = isTouch();

  const el = document.createElement('div');
  el.className = 'wm-screen wm-page wm-set';
  const range = (k: NumKey) => {
    const r = RANGES[k];
    const v = Math.min(r.max, Math.max(r.min, Number(set[k]) || 0));
    return `<div class="wm-row wm-row-range">
      <label class="wm-row-l" for="wm-r-${k}"><b>${r.label}</b><small>${r.hint}</small></label>
      <div class="wm-range-w">
        <input id="wm-r-${k}" class="wm-range" type="range" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}" data-k="${k}" style="--p:${(((v - r.min) / (r.max - r.min)) * 100).toFixed(1)}%">
        <output class="wm-out" data-o="${k}">${r.fmt(v)}</output>
      </div>
    </div>`;
  };
  const toggle = (k: BoolKey, label: string, hint: string) => `<div class="wm-row">
      <div class="wm-row-l"><b>${label}</b><small>${hint}</small></div>
      <button class="wm-switch" role="switch" aria-checked="${!!set[k]}" data-a="toggle" data-k="${k}" aria-label="${esc(label)}"><i></i></button>
    </div>`;

  el.innerHTML = `
    <header class="wm-top">
      <button class="wm-back" data-a="back" aria-label="뒤로">${IC.back}<span>뒤로</span></button>
      <div class="wm-top-t"><p class="wm-eyebrow"><i></i>장비 점검</p><h2 class="wm-h2">설정</h2></div>
      <span class="wm-saved" aria-live="polite"></span>
    </header>
    <div class="wm-body wm-narrow">
      <section class="wm-sec">
        <h3 class="wm-h3">${IC.sun}그래픽</h3>
        <div class="wm-row wm-row-col">
          <div class="wm-row-l"><b>그래픽 품질</b><small>다음 전투부터 적용</small></div>
          <div class="wm-seg" role="radiogroup" aria-label="그래픽 품질">
            ${QUALITY.map((q) => `<button role="radio" data-a="quality" data-v="${q.id}" aria-checked="${set.quality === q.id}">${q.name}</button>`).join('')}
          </div>
          <p class="wm-hint" data-hint="quality"></p>
        </div>
        ${toggle('showFps', 'FPS 표시', '화면 아래에 초당 프레임 수를 보여 줍니다')}
      </section>
      <section class="wm-sec">
        <h3 class="wm-h3">${IC.mouse}조작</h3>
        ${range('sens')}
        ${range('adsSens')}
        ${range('fov')}
        ${toggle('invertY', 'Y축 반전', '위로 움직이면 아래를 봅니다')}
        <div class="wm-row wm-row-col">
          <div class="wm-row-l"><b>정조준 방식 (PC)</b><small>마우스 오른쪽 버튼 동작</small></div>
          <div class="wm-seg wm-seg-2" role="radiogroup" aria-label="정조준 방식">
            <button role="radio" data-a="hold" data-v="1" aria-checked="${set.holdAds}">누르고 있기</button>
            <button role="radio" data-a="hold" data-v="0" aria-checked="${!set.holdAds}">눌러서 켜고 끄기</button>
          </div>
        </div>
        <div class="${touch ? '' : 'wm-muted'}">${range('aimAssist')}</div>
      </section>
      <section class="wm-sec">
        <h3 class="wm-h3">${IC.sound}소리</h3>
        ${range('volume')}
      </section>
      <section class="wm-sec wm-reset-sec">
        <button class="wm-danger" data-a="reset">${IC.reset}<span>기본값으로 초기화</span></button>
        <small>전적과 로드아웃은 그대로 남습니다.</small>
      </section>
    </div>`;
  ctx.root.appendChild(el);

  const saved = el.querySelector('.wm-saved') as HTMLElement;
  let savedT = 0;
  const commit = () => {
    ctx.save();
    saved.textContent = '저장됨';
    saved.classList.add('on');
    clearTimeout(savedT);
    savedT = window.setTimeout(() => saved.classList.remove('on'), 1200);
  };

  const sync = () => {
    el.querySelectorAll<HTMLButtonElement>('[data-a=quality]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === set.quality)));
    el.querySelectorAll<HTMLButtonElement>('[data-a=hold]').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.v === '1') === set.holdAds)));
    el.querySelectorAll<HTMLButtonElement>('[data-a=toggle]').forEach((b) => b.setAttribute('aria-checked', String(!!set[b.dataset.k as BoolKey])));
    (el.querySelector('[data-hint=quality]') as HTMLElement).textContent = QUALITY.find((q) => q.id === set.quality)?.hint ?? '';
    el.querySelectorAll<HTMLInputElement>('input.wm-range').forEach((inp) => {
      const k = inp.dataset.k as NumKey;
      const r = RANGES[k];
      const v = Math.min(r.max, Math.max(r.min, Number(set[k]) || 0));
      inp.value = String(v);
      paintRange(inp, k);
    });
  };
  const paintRange = (inp: HTMLInputElement, k: NumKey) => {
    const r = RANGES[k];
    const v = Number(inp.value);
    inp.style.setProperty('--p', `${(((v - r.min) / (r.max - r.min)) * 100).toFixed(1)}%`);
    const o = el.querySelector(`[data-o=${k}]`);
    if (o) o.textContent = r.fmt(v);
  };
  sync();

  const onInput = (e: Event) => {
    const inp = e.target as HTMLInputElement;
    if (!inp.matches('input.wm-range')) return;
    const k = inp.dataset.k as NumKey;
    set[k] = Number(inp.value);
    paintRange(inp, k);
    commit();
  };
  el.addEventListener('input', onInput);

  let resetArm = 0;
  const off = onAct(el, (a, t) => {
    if (a === 'back') { ctx.back(); return; }
    if (a === 'quality') { set.quality = (t.dataset.v as Quality) ?? 'medium'; }
    else if (a === 'hold') { set.holdAds = t.dataset.v === '1'; }
    else if (a === 'toggle') { const k = t.dataset.k as BoolKey; set[k] = !set[k]; }
    else if (a === 'reset') {
      const label = t.querySelector('span') as HTMLElement;
      if (!resetArm) {
        t.classList.add('armed');
        label.textContent = '한 번 더 누르면 초기화';
        resetArm = window.setTimeout(() => { resetArm = 0; t.classList.remove('armed'); label.textContent = '기본값으로 초기화'; }, 3000);
        return;
      }
      clearTimeout(resetArm);
      resetArm = 0;
      t.classList.remove('armed');
      label.textContent = '기본값으로 초기화';
      Object.assign(set, DEFAULT_SETTINGS);
    } else return;
    sync();
    commit();
  });

  return () => {
    off();
    el.removeEventListener('input', onInput);
    clearTimeout(savedT);
    clearTimeout(resetArm);
  };
}
