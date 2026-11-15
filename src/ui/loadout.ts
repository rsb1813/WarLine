// 로드아웃 편집기: 병과 탭, 다섯 칸(주무기·보조무기·장비1·장비2·투척), 무기 고르기, 가운데 3D 미리보기를 둘러싼
// 부착물 슬롯 7개, 수치 막대 증감, 장비 고르기와 변형. 메뉴와 전투 배치 화면이 함께 쓴다. 바뀌면 바로 saveProfile.
import type * as THREE from 'three';
import './menus.css';
import type { Attachments, ClassId, GadgetDef, GadgetPick, GadgetVariant, Loadout, Profile, SlotId, WeaponCat, WeaponDef, WeaponPick, WeaponStats } from '../types';
import { SLOT_IDS } from '../types';
import { ATTACHMENTS, CAT_NAMES, CLASSES, CLASS_IDS, GADGETS, PRIMARY_IDS, SECONDARY_IDS, SLOT_NAMES, WEAPONS, computeStats, defaultAttachments } from '../defs';
import { defaultLoadout, saveProfile } from '../profile';
import { buildGadgetModel, buildGunModel } from '../render/gunmodel';
import { Studio } from './menu-preview';
import { barRow, miniBars, modeText, statRows, traitChips } from './menu-stats';
import { esc, isTouch } from './menu-util';
import { CLASS_IC, IC, SLOT_IC } from './menu-icons';

type Slot = 'primary' | 'secondary' | 'gadget1' | 'gadget2' | 'throwable';
const SLOTS: Slot[] = ['primary', 'secondary', 'gadget1', 'gadget2', 'throwable'];
const SLOT_LABEL: Record<Slot, string> = { primary: '주무기', secondary: '보조무기', gadget1: '장비 1', gadget2: '장비 2', throwable: '투척' };
const SLOT_ICON: Record<Slot, string> = { primary: IC.rifle, secondary: IC.pistol, gadget1: IC.gadget, gadget2: IC.gadget, throwable: IC.grenade };
const isWeaponSlot = (s: Slot): s is 'primary' | 'secondary' => s === 'primary' || s === 'secondary';

const KIND: Record<string, string> = {
  rocket: '대전차 로켓', aa: '대공 유도 미사일', repair: '수리 도구', atmine: '대전차 지뢰', ugl: '총열 아래 유탄', stim: '아드레날린',
  breach: '접착 폭약', medbag: '의료 상자', ammobag: '탄약 상자', defib: '제세동기', cover: '이동식 방벽', drone: '정찰 드론',
  sensor: '동작 감지기', beacon: '스폰 비컨', claymore: '클레이모어', frag: '세열 수류탄', smoke: '연막탄', flash: '섬광탄',
  incendiary: '소이탄', impact: '충격 수류탄',
};

/** 장비 수치 이름, 단위, 좋은 방향(1 클수록 좋음, -1 작을수록 좋음, 0 중립) */
const PARAM: Record<string, { l: string; u?: string; b: 1 | -1 | 0; f?: (v: number) => string }> = {
  dmg: { l: '피해', b: 1 }, dmgInfantry: { l: '보병 피해', b: 1 }, dmgVehicle: { l: '차량 피해', b: 1 }, wallDmg: { l: '구조물 피해', b: 1 },
  radius: { l: '반경', u: 'm', b: 1 }, velocity: { l: '속도', u: 'm/s', b: 1 }, range: { l: '사거리', u: 'm', b: 1 },
  lockTime: { l: '조준 고정', u: '초', b: -1 }, rate: { l: '수리량', u: '/초', b: 1 }, heat: { l: '과열까지', u: '초', b: 1 },
  smoke: { l: '연막', b: 0, f: (v) => (v ? '연막탄' : '고폭탄') }, heal: { l: '회복', b: 1 }, speedMul: { l: '이동 속도', b: 1, f: (v) => `${Math.round(v * 100)}%` },
  duration: { l: '지속 시간', u: '초', b: 1 }, healPerSec: { l: '초당 회복', b: 1 }, magsPerSec: { l: '초당 탄창', b: 1 }, life: { l: '유지 시간', u: '초', b: 1 },
  reviveTime: { l: '소생 시간', u: '초', b: -1 }, hp: { l: '체력', b: 1 }, width: { l: '폭', u: 'm', b: 1 }, spotRadius: { l: '탐지 반경', u: 'm', b: 1 },
  speed: { l: '비행 속도', u: 'm/s', b: 1 }, fuse: { l: '신관', u: '초', b: 0 }, blind: { l: '실명 시간', u: '초', b: 1 }, dps: { l: '초당 피해', b: 1 },
};
const num = (v: number) => (Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : Math.abs(v) < 10 ? v.toFixed(2).replace(/0$/, '') : v.toFixed(1));
const pTxt = (k: string, v: number) => { const P = PARAM[k]; return P?.f ? P.f(v) : `${num(v)}${P?.u ?? ''}`; };
const pLabel = (k: string) => PARAM[k]?.l ?? '수치';

// 무기를 바꿨다가 돌아오면 부착물을 기억 (이번 실행 동안)
const attMemo = new Map<string, Attachments>();
// 실루엣 그림 캐시
const thumbs = new Map<string, string>();

export function openLoadoutEditor(host: HTMLElement, profile: Profile, cls: ClassId, onClose: () => void): void {
  openEditor(host, profile, cls, onClose, { history: true });
}

/**
 * 편집기를 연다. 돌려받은 함수는 onClose 를 부르지 않고 조용히 닫는다(경로를 떠날 때).
 * history: true 면 기기 뒤로 가기로 닫히도록 기록을 하나 쌓는다.
 */
export function openEditor(host: HTMLElement, profile: Profile, cls: ClassId, onClose: () => void, opts: { history: boolean }): () => void {
  const touch = isTouch();
  const st = {
    cls: CLASSES[cls] ? cls : (CLASS_IDS[0] as ClassId),
    slot: 'primary' as Slot,
    att: 'optic' as SlotId,
    picking: false,
    cat: null as WeaponCat | null,
    hover: '' as string,
  };
  let closed = false;
  let pushed = false;
  let studio: Studio | null = null;
  let modelKey = '';
  let raf = 0;
  const queue: { key: string; build: () => THREE.Object3D }[] = [];

  // ───────── 뼈대 ─────────
  const el = document.createElement('div');
  el.className = 'wlo';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', '로드아웃');
  el.tabIndex = -1;
  el.innerHTML = `
    <header class="wlo-top">
      <div class="wlo-top-t"><p class="wm-eyebrow"><i></i>로드아웃</p><h2 class="wlo-title"></h2></div>
      <p class="wlo-top-hint">${IC.info}<span>바뀐 내용은 바로 저장됩니다${opts.history ? ' · 다음 배치부터 적용' : ''}</span></p>
      <button class="primary wlo-done" data-a="done">${IC.check}<span>완료</span></button>
    </header>
    <div class="wlo-body">
      <aside class="wlo-left">
        <div class="wlo-classes" role="tablist" aria-label="병과"></div>
        <p class="wlo-cls-note"></p>
        <div class="wlo-slots" role="tablist" aria-label="칸"></div>
      </aside>
      <section class="wlo-center">
        <div class="wlo-head"></div>
        <div class="wlo-stage">
          <canvas class="wlo-canvas" aria-label="3D 미리보기"></canvas>
          <svg class="wlo-lines" aria-hidden="true"></svg>
          <div class="wlo-hot"></div>
          <p class="wlo-stage-hint">${IC.rotate}<span>끌어서 돌리기</span></p>
          <p class="wlo-nogl" hidden>${IC.info}<span>이 기기에서는 3D 미리보기를 쓸 수 없습니다</span></p>
        </div>
        <div class="wlo-chips"></div>
        <div class="wlo-drawer"></div>
        <div class="wlo-pick" hidden></div>
      </section>
      <aside class="wlo-right"></aside>
    </div>`;
  host.appendChild(el);
  const q = <T extends Element = HTMLElement>(s: string) => el.querySelector(s) as T;
  const $title = q('.wlo-title'), $classes = q('.wlo-classes'), $note = q('.wlo-cls-note'), $slots = q('.wlo-slots');
  const $center = q('.wlo-center'), $head = q('.wlo-head'), $hot = q('.wlo-hot'), $lines = q<SVGSVGElement>('.wlo-lines');
  const $chips = q('.wlo-chips'), $drawer = q('.wlo-drawer'), $pick = q('.wlo-pick'), $right = q('.wlo-right');

  try {
    studio = new Studio(q<HTMLCanvasElement>('.wlo-canvas'), profile.settings?.quality ?? 'medium');
  } catch (e) {
    console.warn('로드아웃 미리보기 실패', e);
    studio = null;
    q('.wlo-nogl').hidden = false;
    q('.wlo-stage-hint').hidden = true;
  }
  const wide = matchMedia('(min-width: 720px)');
  const applyFrame = () => studio?.setFrame(wide.matches ? 1.9 : 1.22);
  applyFrame();
  wide.addEventListener?.('change', applyFrame);

  // ───────── 프로필 ─────────
  const lo = (): Loadout => profile.loadouts?.[st.cls] ?? ensure(st.cls);
  function ensure(c: ClassId): Loadout {
    let changed = false;
    let dl: Loadout | null = null;
    const D = (): Loadout => (dl ??= defaultLoadout(c));
    if (!profile.loadouts) (profile as { loadouts: Record<ClassId, Loadout> }).loadouts = {} as Record<ClassId, Loadout>;
    let L = profile.loadouts[c];
    if (!L) { L = profile.loadouts[c] = D(); changed = true; }
    const fixW = (p: WeaponPick | undefined, ids: string[], d: () => WeaponPick): WeaponPick => {
      if (!p || !WEAPONS[p.id] || !ids.includes(p.id)) { changed = true; const x = d(); return { id: x.id, att: { ...(x.att ?? {}) } }; }
      if (!p.att) { p.att = {}; changed = true; }
      return p;
    };
    L.primary = fixW(L.primary, PRIMARY_IDS, () => D().primary);
    L.secondary = fixW(L.secondary, SECONDARY_IDS, () => D().secondary);
    const C = CLASSES[c];
    const fixG = (p: GadgetPick | undefined, ids: string[], avoid: string | null): GadgetPick => {
      const ok = !!p && ids.includes(p.id) && !!GADGETS[p.id] && (avoid === null || p.id !== avoid || ids.length < 2);
      if (!ok || !p) {
        const id = ids.find((x) => GADGETS[x] && x !== avoid) ?? ids[0] ?? '';
        changed = true;
        return { id, variant: GADGETS[id]?.variants[0]?.id ?? '' };
      }
      const g = GADGETS[p.id];
      if (!g.variants.some((v) => v.id === p.variant)) { p.variant = g.variants[0]?.id ?? ''; changed = true; }
      return p;
    };
    L.gadget1 = fixG(L.gadget1, C?.gadgets ?? [], null);
    L.gadget2 = fixG(L.gadget2, C?.gadgets ?? [], L.gadget1.id);
    L.throwable = fixG(L.throwable, C?.throwables ?? [], null);
    if (changed) saveProfile(profile);
    return L;
  }
  const commit = () => saveProfile(profile);
  const wpick = (): WeaponPick => (st.slot === 'secondary' ? lo().secondary : lo().primary);
  const gpick = (s: Slot = st.slot): GadgetPick => lo()[s as 'gadget1' | 'gadget2' | 'throwable'];
  const curAtt = (w: WeaponDef, att: Attachments, s: SlotId): string | undefined => {
    const list = w.slots[s];
    if (!list || !list.length) return undefined;
    const a = att[s];
    return a && list.includes(a) ? a : list[0];
  };
  const fullAtt = (w: WeaponDef, att: Attachments): Attachments => {
    const o: Attachments = {};
    for (const s of SLOT_IDS) { const a = curAtt(w, att, s); if (a) o[s] = a; }
    return o;
  };
  const stats = (id: string, att: Attachments): WeaponStats => computeStats(id, att, st.cls);
  const isSig = (cat: WeaponCat) => CLASSES[st.cls]?.signature.includes(cat) ?? false;
  const changedCount = (w: WeaponDef, att: Attachments) => SLOT_IDS.filter((s) => { const l = w.slots[s]; return l && l.length && curAtt(w, att, s) !== l[0]; }).length;

  // ───────── 실루엣 ─────────
  const attKey = (att: Attachments) => SLOT_IDS.map((s) => att[s] ?? '').join(',');
  function thumb(key: string, build: () => THREE.Object3D): string {
    const got = thumbs.get(key);
    if (got !== undefined) return got ? ` src="${got}"` : '';
    if (studio && !queue.some((x) => x.key === key)) queue.push({ key, build });
    return '';
  }
  const wThumb = (id: string, att: Attachments) => thumb(`w:${id}:${attKey(att)}`, () => buildGunModel(id, att));
  const gThumb = (id: string) => thumb(`g:${id}`, () => buildGadgetModel(id));
  const imgAttr = (key: string) => `data-thumb="${esc(key)}"`;
  function pump(): void {
    if (closed) return;
    if (!el.isConnected) { pushed = false; finish(false); return; }
    const item = queue.shift();
    if (item && studio) {
      let url = '';
      try { url = studio.snapshot(item.build(), 240, 96) ?? ''; } catch { url = ''; }
      thumbs.set(item.key, url);
      if (url) el.querySelectorAll<HTMLImageElement>('img[data-thumb]').forEach((im) => { if (im.dataset.thumb === item.key) im.src = url; });
    }
    raf = requestAnimationFrame(pump);
  }
  raf = requestAnimationFrame(pump);

  // ───────── 그리기 ─────────
  function renderAll(): void {
    const C = CLASSES[st.cls];
    $title.innerHTML = `<span class="wlo-title-i">${CLASS_IC[st.cls] ?? ''}</span>${esc(C?.name ?? '')}<small>${esc(C?.role ?? '')}</small>`;
    $classes.innerHTML = CLASS_IDS.map((id) => {
      const c = CLASSES[id];
      return `<button class="wlo-cls" role="tab" aria-selected="${id === st.cls}" data-a="cls" data-v="${id}">
        <span class="wlo-cls-i">${CLASS_IC[id] ?? ''}</span>
        <span class="wlo-cls-b"><b>${esc(c.name)}</b><small>${esc(c.role)}</small></span>
        <span class="wlo-cls-tr">${esc(c.trait)}</span>
      </button>`;
    }).join('');
    $note.innerHTML = C ? `<b>${esc(C.trait)}</b><span>${esc(C.desc)}</span>` : '';
    renderSlots();
    renderCenter();
    renderRight();
  }

  function renderSlots(): void {
    const L = lo();
    $slots.innerHTML = SLOTS.map((s) => {
      let name = '', sub = '', img = '';
      if (isWeaponSlot(s)) {
        const p = L[s];
        const w = WEAPONS[p.id];
        const fa = w ? fullAtt(w, p.att) : {};
        name = w?.name ?? p.id;
        const ch = w ? changedCount(w, p.att) : 0;
        sub = `${esc(CAT_NAMES[w?.cat ?? 'ar'] ?? '')}${ch ? ` · 개조 ${ch}곳` : ' · 기본 구성'}`;
        const key = `w:${p.id}:${attKey(fa)}`;
        img = `<img ${imgAttr(key)}${wThumb(p.id, fa)} alt="">`;
      } else {
        const p = L[s];
        const g = GADGETS[p.id];
        name = g?.name ?? p.id;
        const v = g?.variants.find((x) => x.id === p.variant);
        sub = esc(v?.name ?? KIND[g?.kind ?? ''] ?? '');
        img = `<img ${imgAttr(`g:${p.id}`)}${gThumb(p.id)} alt="">`;
      }
      return `<button class="wlo-slot" role="tab" aria-selected="${s === st.slot}" data-a="slot" data-v="${s}">
        <span class="wlo-slot-k">${SLOT_ICON[s]}<span>${SLOT_LABEL[s]}</span></span>
        <span class="wlo-slot-img">${img}</span>
        <b class="wlo-slot-n">${esc(name)}</b>
        <small class="wlo-slot-s">${sub}</small>
      </button>`;
    }).join('');
  }

  function renderCenter(): void {
    $center.classList.toggle('picking', st.picking);
    $center.classList.toggle('gadget', !isWeaponSlot(st.slot));
    $pick.hidden = !st.picking;
    if (st.picking) {
      studio?.setActive(false);
      renderPicker();
      return;
    }
    $pick.innerHTML = '';
    renderHead();
    syncModel();
    renderHot();
    renderDrawer();
    studio?.setActive(true);
  }

  function renderHead(): void {
    if (isWeaponSlot(st.slot)) {
      const p = wpick();
      const w = WEAPONS[p.id];
      $head.innerHTML = `<div class="wlo-head-t">
          <p class="wlo-eyebrow">${SLOT_LABEL[st.slot]} · ${esc(CAT_NAMES[w.cat] ?? '')}${isSig(w.cat) ? ' <em class="wlo-sig">숙련</em>' : ''}</p>
          <h3 class="wlo-name">${esc(w.name)}</h3>
        </div>
        <div class="wlo-acts">
          <button data-a="pick">${IC.swap}<span>무기 변경</span></button>
          <button data-a="reset" ${changedCount(w, p.att) ? '' : 'disabled'}>${IC.reset}<span>기본값으로</span></button>
        </div>`;
    } else {
      const p = gpick();
      const g = GADGETS[p.id];
      const list = st.slot === 'throwable' ? CLASSES[st.cls].throwables : CLASSES[st.cls].gadgets;
      $head.innerHTML = `<div class="wlo-head-t">
          <p class="wlo-eyebrow">${SLOT_LABEL[st.slot]} · ${esc(KIND[g?.kind ?? ''] ?? '')}</p>
          <h3 class="wlo-name">${esc(g?.name ?? '')}</h3>
        </div>
        <div class="wlo-acts"><button data-a="pick" ${list.length > 1 ? '' : 'disabled'}>${IC.swap}<span>${st.slot === 'throwable' ? '투척물 변경' : '장비 변경'}</span></button></div>`;
    }
  }

  function syncModel(): void {
    if (!studio) return;
    let key: string, build: () => THREE.Object3D;
    if (isWeaponSlot(st.slot)) {
      const p = wpick();
      const w = WEAPONS[p.id];
      const fa = fullAtt(w, p.att);
      key = `w:${p.id}:${attKey(fa)}`;
      build = () => buildGunModel(p.id, fa);
    } else {
      const id = gpick().id;
      key = `g:${id}`;
      build = () => buildGadgetModel(id);
    }
    if (key === modelKey) return;
    modelKey = key;
    try { studio.setModel(build(), isWeaponSlot(st.slot) ? 'gun' : 'gadget'); } catch (e) { console.warn('모델 생성 실패', e); studio.setModel(null, 'gun'); }
  }

  function renderHot(): void {
    if (!isWeaponSlot(st.slot)) { $hot.innerHTML = ''; $chips.innerHTML = ''; $lines.innerHTML = ''; return; }
    const p = wpick();
    const w = WEAPONS[p.id];
    if (!(w.slots[st.att]?.length)) st.att = SLOT_IDS.find((s) => w.slots[s]?.length) ?? 'optic';
    const btn = (s: SlotId, cls: string) => {
      const list = w.slots[s] ?? [];
      const cur = curAtt(w, p.att, s);
      const mod = !!cur && list.length > 0 && cur !== list[0];
      const name = cur ? ATTACHMENTS[cur]?.name ?? cur : '장착 불가';
      return `<button class="${cls}${mod ? ' mod' : ''}" data-a="att" data-v="${s}" data-pos="${s}" aria-pressed="${s === st.att}" ${list.length ? '' : 'disabled'}>
        <span class="wlo-hs-k">${SLOT_IC[s] ?? ''}<span>${esc(SLOT_NAMES[s] ?? s)}</span>${list.length > 1 ? `<em>${list.length}</em>` : ''}</span>
        <b>${esc(name)}</b>
      </button>`;
    };
    $hot.innerHTML = SLOT_IDS.map((s) => btn(s, 'wlo-hs')).join('');
    $chips.innerHTML = SLOT_IDS.map((s) => btn(s, 'wlo-chip')).join('');
    $lines.innerHTML = SLOT_IDS.filter((s) => w.slots[s]?.length).map((s) => `<path data-l="${s}" class="${s === st.att ? 'on' : ''}"/><circle data-c="${s}" r="3.2" class="${s === st.att ? 'on' : ''}"/>`).join('');
    // 고른 칩이 보이게
    const on = $chips.querySelector('[aria-pressed=true]') as HTMLElement | null;
    if (on) $chips.scrollLeft = Math.max(0, on.offsetLeft - $chips.clientWidth / 2 + on.offsetWidth / 2);
  }

  /** 슬롯 버튼 → 총의 해당 부분으로 가는 꺾은 선 */
  function updateLines(): void {
    if (!studio || st.picking || !isWeaponSlot(st.slot) || !wide.matches) return;
    const paths = $lines.querySelectorAll<SVGPathElement>('path[data-l]');
    if (!paths.length) return;
    paths.forEach((path) => {
      const s = path.dataset.l as SlotId;
      const b = $hot.querySelector(`[data-pos=${s}]`) as HTMLElement | null;
      const c = $lines.querySelector(`circle[data-c=${s}]`) as SVGCircleElement | null;
      const pt = studio!.project(s);
      if (!b || !pt || !c) return;
      const x0 = b.offsetLeft, y0 = b.offsetTop, bw = b.offsetWidth, bh = b.offsetHeight;
      let ex: number, ey: number, nx = 0, ny = 0;
      const dx = pt.x - (x0 + bw / 2), dy = pt.y - (y0 + bh / 2);
      if (Math.abs(dy) * bw > Math.abs(dx) * bh) { ex = x0 + bw / 2; ey = dy > 0 ? y0 + bh : y0; ny = dy > 0 ? 1 : -1; }
      else { ey = y0 + bh / 2; ex = dx > 0 ? x0 + bw : x0; nx = dx > 0 ? 1 : -1; }
      const kx = ex + nx * 12, ky = ey + ny * 12;
      path.setAttribute('d', `M${ex.toFixed(1)} ${ey.toFixed(1)}L${kx.toFixed(1)} ${ky.toFixed(1)}L${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`);
      c.setAttribute('cx', pt.x.toFixed(1));
      c.setAttribute('cy', pt.y.toFixed(1));
    });
  }
  if (studio) studio.onFrame = updateLines;

  function renderDrawer(): void {
    if (isWeaponSlot(st.slot)) {
      const p = wpick();
      const w = WEAPONS[p.id];
      const list = w.slots[st.att] ?? [];
      const cur = curAtt(w, p.att, st.att);
      $drawer.innerHTML = `<div class="wlo-dh"><h4>${SLOT_IC[st.att] ?? ''}<span>${esc(SLOT_NAMES[st.att] ?? st.att)}</span><small>${list.length}개</small></h4>
          <p>${touch ? '눌러서 장착 · 수치는 오른쪽(아래)에서 기본 구성과 비교' : '가리키면 수치 변화 미리보기 · 눌러서 장착'}</p></div>
        <div class="wlo-opts">${list.map((id, i) => {
          const a = ATTACHMENTS[id];
          const on = id === cur;
          return `<button class="wlo-opt" data-a="opt" data-v="${esc(id)}" data-hv="att:${esc(id)}" aria-pressed="${on}">
            <span class="wlo-opt-h"><b>${esc(a?.name ?? id)}</b>${i === 0 ? '<em>기본</em>' : ''}${on ? `<em class="on">${IC.check}장착 중</em>` : ''}</span>
            ${a?.desc ? `<span class="wlo-opt-d">${esc(a.desc)}</span>` : ''}
            <span class="wlo-pc">${(a?.pros ?? []).map((t) => `<i class="pro">${esc(t)}</i>`).join('')}${(a?.cons ?? []).map((t) => `<i class="con">${esc(t)}</i>`).join('')}</span>
          </button>`;
        }).join('')}</div>`;
    } else {
      const p = gpick();
      const g = GADGETS[p.id];
      if (!g) { $drawer.innerHTML = ''; return; }
      const curV = g.variants.find((v) => v.id === p.variant) ?? g.variants[0];
      $drawer.innerHTML = `<div class="wlo-dh"><h4>${IC.settings}<span>변형</span><small>${g.variants.length}개</small></h4>
          <p>${g.variants.length > 1 ? (touch ? '눌러서 고르기' : '가리키면 수치 비교 · 눌러서 고르기') : '이 장비는 변형이 하나뿐입니다'}</p></div>
        <div class="wlo-opts">${g.variants.map((v, i) => {
          const on = v.id === curV?.id;
          return `<button class="wlo-opt wlo-var" data-a="variant" data-v="${esc(v.id)}" data-hv="var:${esc(v.id)}" aria-pressed="${on}">
            <span class="wlo-opt-h"><b>${esc(v.name)}</b>${i === 0 ? '<em>기본</em>' : ''}${on ? `<em class="on">${IC.check}장착 중</em>` : ''}</span>
            <span class="wlo-opt-d">${esc(v.desc)}</span>
            <span class="wlo-params">${paramChips(v, curV)}</span>
          </button>`;
        }).join('')}</div>`;
    }
  }

  function paramChips(v: GadgetVariant, ref: GadgetVariant | undefined): string {
    return Object.keys(v.params).map((k) => {
      const val = v.params[k];
      const rv = ref?.params[k];
      let cls = '';
      if (ref && ref !== v && rv !== undefined && Math.abs(rv - val) > 1e-6) {
        const b = PARAM[k]?.b ?? 0;
        cls = b === 0 ? 'neu' : (val - rv) * b > 0 ? 'up' : 'dn';
      }
      return `<i class="${cls}"><span>${esc(pLabel(k))}</span><b>${esc(pTxt(k, val))}</b></i>`;
    }).join('');
  }

  function renderPicker(): void {
    if (isWeaponSlot(st.slot)) {
      const prim = st.slot === 'primary';
      const ids = (prim ? PRIMARY_IDS : SECONDARY_IDS).filter((id) => WEAPONS[id]);
      const cats: WeaponCat[] = [];
      for (const k of Object.keys(CAT_NAMES) as WeaponCat[]) if (ids.some((id) => WEAPONS[id].cat === k)) cats.push(k);
      for (const id of ids) if (!cats.includes(WEAPONS[id].cat)) cats.push(WEAPONS[id].cat);
      const curId = wpick().id;
      if (!st.cat || !cats.includes(st.cat)) st.cat = WEAPONS[curId]?.cat ?? cats[0] ?? null;
      const shown = ids.filter((id) => WEAPONS[id].cat === st.cat);
      $pick.innerHTML = `<div class="wlo-pick-h">
          <div><p class="wlo-eyebrow">${SLOT_LABEL[st.slot]}</p><h3 class="wlo-name">${prim ? '주무기 선택' : '보조무기 선택'}</h3></div>
          <button data-a="unpick">${IC.close}<span>닫기</span></button>
        </div>
        ${cats.length > 1 ? `<div class="wlo-cats" role="tablist">${cats.map((c) => `<button role="tab" data-a="cat" data-v="${c}" aria-selected="${c === st.cat}"><span>${esc(CAT_NAMES[c] ?? c)}</span>${isSig(c) ? '<em class="wlo-sig">숙련</em>' : ''}<small>${ids.filter((id) => WEAPONS[id].cat === c).length}</small></button>`).join('')}</div>` : ''}
        ${cats.length > 1 && st.cat && isSig(st.cat) ? `<p class="wlo-sig-note">${IC.bolt}<span>${esc(CLASSES[st.cls].name)} 숙련 분류: 정조준 속도와 반동 제어가 조금 좋아집니다</span></p>` : ''}
        <div class="wlo-wgrid">${shown.map((id) => {
          const w = WEAPONS[id];
          const da = defaultAttachments(id);
          const fa = fullAtt(w, da);
          const s = stats(id, da);
          const eq = id === curId;
          return `<button class="wlo-wc" data-a="weapon" data-v="${esc(id)}" data-hv="wpn:${esc(id)}" aria-pressed="${eq}">
            <span class="wlo-wc-top"><span>${esc(CAT_NAMES[w.cat] ?? '')}</span>${isSig(w.cat) ? '<em class="wlo-sig">숙련</em>' : ''}${eq ? `<em class="on">${IC.check}장착 중</em>` : ''}</span>
            <span class="wlo-wc-img"><img ${imgAttr(`w:${id}:${attKey(fa)}`)}${wThumb(id, fa)} alt=""></span>
            <b class="wlo-wc-n">${esc(w.name)}</b>
            <span class="wlo-wc-d">${esc(w.desc)}</span>
            ${miniBars(s)}
            <span class="wlo-wc-f">${esc(modeText(s))} · 탄창 ${Math.round(s.mag)}</span>
          </button>`;
        }).join('')}</div>`;
    } else {
      const slot = st.slot;
      const list = (slot === 'throwable' ? CLASSES[st.cls].throwables : CLASSES[st.cls].gadgets).filter((id) => GADGETS[id]);
      const cur = gpick().id;
      const otherSlot: Slot | null = slot === 'gadget1' ? 'gadget2' : slot === 'gadget2' ? 'gadget1' : null;
      const other = otherSlot ? gpick(otherSlot).id : '';
      $pick.innerHTML = `<div class="wlo-pick-h">
          <div><p class="wlo-eyebrow">${SLOT_LABEL[slot]}</p><h3 class="wlo-name">${slot === 'throwable' ? '투척물 선택' : '장비 선택'}</h3></div>
          <button data-a="unpick">${IC.close}<span>닫기</span></button>
        </div>
        ${otherSlot ? `<p class="wlo-sig-note">${IC.swap}<span>두 장비 칸에는 서로 다른 장비를 넣습니다. ${SLOT_LABEL[otherSlot]}에 있는 장비를 고르면 맞바꿉니다.</span></p>` : ''}
        <div class="wlo-wgrid wlo-ggrid">${list.map((id) => {
          const g = GADGETS[id];
          const eq = id === cur;
          const sw = !!otherSlot && id === other;
          return `<button class="wlo-wc wlo-gc" data-a="gadget" data-v="${esc(id)}" data-hv="gad:${esc(id)}" aria-pressed="${eq}">
            <span class="wlo-wc-top"><span>${esc(KIND[g.kind] ?? g.kind)}</span>${eq ? `<em class="on">${IC.check}장착 중</em>` : ''}${sw ? `<em class="swap">${IC.swap}${SLOT_LABEL[otherSlot!]}</em>` : ''}</span>
            <span class="wlo-wc-img"><img ${imgAttr(`g:${id}`)}${gThumb(id)} alt=""></span>
            <b class="wlo-wc-n">${esc(g.name)}</b>
            <span class="wlo-wc-d">${esc(g.desc)}</span>
            <span class="wlo-wc-f">사용 ${g.uses}회 · 재사용 ${num(g.cooldown)}초 · 변형 ${g.variants.length}</span>
          </button>`;
        }).join('')}</div>`;
    }
  }

  function renderRight(): void {
    const [hk, hid] = st.hover ? [st.hover.slice(0, 3), st.hover.slice(4)] : ['', ''];
    if (isWeaponSlot(st.slot)) {
      const p = wpick();
      const w = WEAPONS[p.id];
      const curS = stats(p.id, p.att);
      let base: WeaponStats, next: WeaponStats | null, cap: string, show: WeaponDef = w;
      if (st.picking && hk === 'wpn' && WEAPONS[hid] && hid !== p.id) {
        show = WEAPONS[hid];
        base = curS;
        next = stats(hid, defaultAttachments(hid));
        cap = `<b>${esc(w.name)}</b>${IC.arrow}<b>${esc(show.name)}</b>`;
      } else if (!st.picking && hk === 'att' && ATTACHMENTS[hid]) {
        base = curS;
        next = stats(p.id, { ...p.att, [st.att]: hid });
        const same = curAtt(w, p.att, st.att) === hid;
        cap = same ? `<b>장착 중</b><span>${esc(ATTACHMENTS[hid].name)}</span>` : `<b>장착하면</b><span>${esc(ATTACHMENTS[hid].name)}</span>`;
      } else if (st.picking) {
        base = curS; next = null; cap = '<b>현재 무기</b><span>카드를 가리키면 비교</span>';
      } else {
        base = stats(p.id, defaultAttachments(p.id));
        next = curS;
        cap = changedCount(w, p.att) ? '<b>기본 구성 대비</b><span>지금 구성</span>' : '<b>기본 구성</b>';
      }
      const sigCats = CLASSES[st.cls].signature.map((c) => CAT_NAMES[c]).join(' · ');
      $right.innerHTML = `<div class="wlo-r-h">
          <p class="wlo-eyebrow">${esc(CAT_NAMES[show.cat] ?? '')} · ${esc(modeText(next ?? base))}</p>
          <h3>${esc(show.name)}</h3>
          <p class="wlo-r-d">${esc(show.desc)}</p>
        </div>
        <div class="wlo-traits">${traitChips(base, next)}</div>
        <div class="wlo-cmp"><span class="wlo-cmp-t">${cap}</span><span class="wlo-legend"><i class="up"></i>향상<i class="dn"></i>저하</span></div>
        <div class="wlo-stats">${statRows(base, next)}</div>
        <p class="wlo-foot">${IC.info}<span>${isSig(show.cat) ? `숙련 보너스 적용: ${esc(CLASSES[st.cls].name)}은(는) ${esc(CAT_NAMES[show.cat])}의 정조준과 반동이 조금 좋습니다.` : `${esc(CLASSES[st.cls].name)} 숙련 분류: ${esc(sigCats)}`} 막대는 길수록 좋습니다.</span></p>`;
    } else {
      const p = gpick();
      let g: GadgetDef | undefined = GADGETS[p.id];
      let v = g?.variants.find((x) => x.id === p.variant) ?? g?.variants[0];
      let ref: GadgetVariant | undefined;
      let cap = '<b>장착한 변형</b>';
      if (st.picking && hk === 'gad' && GADGETS[hid]) { g = GADGETS[hid]; v = g.variants[0]; cap = '<b>기본 변형</b>'; }
      else if (!st.picking && hk === 'var' && g) {
        const hv = g.variants.find((x) => x.id === hid);
        if (hv && hv.id !== v?.id) { ref = v; v = hv; cap = `<b>${esc(ref?.name ?? '')}</b>${IC.arrow}<b>${esc(hv.name)}</b>`; }
      }
      if (!g || !v) { $right.innerHTML = ''; return; }
      const keys = Object.keys(v.params);
      const rows = keys.map((k) => {
        const P = PARAM[k];
        const vals = g!.variants.map((x) => x.params[k]).filter((x) => Number.isFinite(x));
        const max = Math.max(...vals.map((x) => Math.abs(x)), 1e-6), min = Math.min(...vals.map((x) => Math.abs(x)));
        const fill = (x: number) => {
          if (P?.b === -1) return Math.max(0.06, Math.min(1, (min || 1e-6) / Math.max(1e-6, Math.abs(x)))) * 0.85;
          return Math.max(0.06, Math.min(1, Math.abs(x) / max)) * 0.85;
        };
        const cur = v!.params[k];
        if (!ref || ref.params[k] === undefined || Math.abs(ref.params[k] - cur) < 1e-6) return barRow(pLabel(k), pTxt(k, cur), '', fill(cur), 0, '');
        const fb = fill(ref.params[k]), fn = fill(cur);
        const dir = (P?.b ?? 0) === 0 ? 'neu' : fn > fb ? 'up' : 'dn';
        return barRow(pLabel(k), pTxt(k, ref.params[k]), pTxt(k, cur), Math.min(fb, fn), Math.abs(fn - fb), dir);
      }).join('');
      $right.innerHTML = `<div class="wlo-r-h">
          <p class="wlo-eyebrow">${esc(KIND[g.kind] ?? g.kind)}</p>
          <h3>${esc(g.name)}</h3>
          <p class="wlo-r-d">${esc(g.desc)}</p>
        </div>
        <dl class="wlo-gstat">
          <div><dt>사용 횟수</dt><dd>${g.uses}</dd></div>
          <div><dt>재사용 대기</dt><dd>${num(g.cooldown)}<small>초</small></dd></div>
          <div><dt>변형</dt><dd>${g.variants.length}</dd></div>
        </dl>
        <div class="wlo-cmp"><span class="wlo-cmp-t">${cap}<span>${esc(v.name)}</span></span>${ref ? '<span class="wlo-legend"><i class="up"></i>향상<i class="dn"></i>저하</span>' : ''}</div>
        <p class="wlo-r-d wlo-var-d">${esc(v.desc)}</p>
        <div class="wlo-stats">${rows || '<p class="wlo-r-d">수치 없음</p>'}</div>
        <p class="wlo-foot">${IC.info}<span>사용 횟수는 탄약 상자로 다시 채웁니다. 막대는 같은 장비의 변형끼리 비교합니다.</span></p>`;
    }
  }

  // ───────── 동작 ─────────
  function act(a: string, v: string): void {
    const L = lo();
    switch (a) {
      case 'done': finish(true); return;
      case 'cls':
        if (!CLASSES[v as ClassId] || v === st.cls) return;
        st.cls = v as ClassId;
        profile.cls = st.cls;
        ensure(st.cls);
        commit();
        st.picking = false; st.hover = ''; st.cat = null;
        modelKey = '';
        renderAll();
        return;
      case 'slot':
        if (!SLOTS.includes(v as Slot)) return;
        if (v === st.slot && !st.picking) return;
        st.slot = v as Slot; st.picking = false; st.hover = ''; st.cat = null;
        renderSlots(); renderCenter(); renderRight();
        scrollStageIntoView();
        return;
      case 'att': {
        if (!(SLOT_IDS as string[]).includes(v)) return;
        st.att = v as SlotId; st.hover = '';
        renderHot(); renderDrawer(); renderRight();
        return;
      }
      case 'opt': {
        if (!isWeaponSlot(st.slot)) return;
        const p = wpick();
        p.att = { ...p.att, [st.att]: v };
        commit();
        st.hover = touch ? '' : `att:${v}`;
        renderSlots(); renderHead(); syncModel(); renderHot(); renderDrawer(); renderRight();
        return;
      }
      case 'reset': {
        if (!isWeaponSlot(st.slot)) return;
        const p = wpick();
        p.att = { ...defaultAttachments(p.id) };
        attMemo.delete(`${st.cls}:${p.id}`);
        commit();
        st.hover = '';
        renderSlots(); renderHead(); syncModel(); renderHot(); renderDrawer(); renderRight();
        return;
      }
      case 'pick': st.picking = true; st.hover = ''; renderCenter(); renderRight(); scrollStageIntoView(); return;
      case 'unpick': st.picking = false; st.hover = ''; renderCenter(); renderRight(); return;
      case 'cat': st.cat = v as WeaponCat; st.hover = ''; renderPicker(); renderRight(); return;
      case 'weapon': {
        if (!isWeaponSlot(st.slot) || !WEAPONS[v]) return;
        const old = wpick();
        attMemo.set(`${st.cls}:${old.id}`, { ...old.att });
        const pick: WeaponPick = { id: v, att: { ...(attMemo.get(`${st.cls}:${v}`) ?? defaultAttachments(v)) } };
        if (st.slot === 'primary') L.primary = pick; else L.secondary = pick;
        commit();
        st.picking = false; st.hover = '';
        renderSlots(); renderCenter(); renderRight();
        return;
      }
      case 'gadget': {
        if (isWeaponSlot(st.slot) || !GADGETS[v]) return;
        const slot = st.slot as 'gadget1' | 'gadget2' | 'throwable';
        const cur: GadgetPick = { ...L[slot] };
        if (cur.id !== v) {
          const os = slot === 'gadget1' ? 'gadget2' : slot === 'gadget2' ? 'gadget1' : null;
          if (os && L[os].id === v) {
            // 다른 장비 칸에 있던 것을 고르면 맞바꾼다 (변형도 같이)
            const theirs: GadgetPick = { ...L[os] };
            L[os] = cur;
            L[slot] = theirs;
          } else L[slot] = { id: v, variant: GADGETS[v].variants[0]?.id ?? '' };
          commit();
        }
        st.picking = false; st.hover = '';
        modelKey = '';
        renderSlots(); renderCenter(); renderRight();
        return;
      }
      case 'variant': {
        if (isWeaponSlot(st.slot)) return;
        const p = gpick();
        if (!GADGETS[p.id]?.variants.some((x) => x.id === v)) return;
        p.variant = v;
        commit();
        st.hover = '';
        renderSlots(); renderDrawer(); renderRight();
        return;
      }
    }
  }

  function scrollStageIntoView(): void {
    if (wide.matches) return;
    const r = $center.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    if (r.top < er.top || r.top > er.top + er.height * 0.6) el.scrollTo({ top: el.scrollTop + r.top - er.top - 8, behavior: 'smooth' });
  }

  // 클릭
  const onClick = (e: MouseEvent) => {
    const t = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
    if (!t || !el.contains(t) || (t as HTMLButtonElement).disabled) return;
    act(t.dataset.a ?? '', t.dataset.v ?? '');
  };
  el.addEventListener('click', onClick);

  // 가리키기 미리보기 (마우스·키보드 초점)
  const setHover = (k: string) => {
    if (k === st.hover) return;
    st.hover = k;
    renderRight();
  };
  const onOver = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const t = (e.target as HTMLElement).closest('[data-hv]') as HTMLElement | null;
    setHover(t ? t.dataset.hv ?? '' : '');
  };
  const onFocus = (e: FocusEvent) => {
    const t = (e.target as HTMLElement).closest?.('[data-hv]') as HTMLElement | null;
    if (t) setHover(t.dataset.hv ?? '');
  };
  el.addEventListener('pointerover', onOver);
  el.addEventListener('focusin', onFocus);

  // 전투 화면 쪽 입력으로 새지 않게
  const stop = (e: Event) => e.stopPropagation();
  const STOP = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchmove', 'touchend', 'wheel', 'contextmenu', 'keydown', 'keyup'];
  STOP.forEach((n) => el.addEventListener(n, stop));

  // Esc: 고르는 중이면 고르기만 닫고, 아니면 편집기 닫기
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || closed) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (st.picking) act('unpick', '');
    else finish(true);
  };
  window.addEventListener('keydown', onKey, true);

  // 기기 뒤로 가기
  const onPop = () => { if (closed) return; pushed = false; finish(true); };
  if (opts.history) {
    try {
      const prev = (history.state ?? {}) as Record<string, unknown>;
      history.pushState({ ...prev, wlEditor: 1 }, '', location.href);
      pushed = true;
      window.addEventListener('popstate', onPop);
    } catch { /* 기록 없이 */ }
  }

  function teardown(): void {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf);
    queue.length = 0;
    el.removeEventListener('click', onClick);
    el.removeEventListener('pointerover', onOver);
    el.removeEventListener('focusin', onFocus);
    STOP.forEach((n) => el.removeEventListener(n, stop));
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('popstate', onPop);
    wide.removeEventListener?.('change', applyFrame);
    studio?.dispose();
    studio = null;
    el.remove();
  }

  function finish(callBack: boolean): void {
    if (closed) return;
    teardown();
    if (pushed) { pushed = false; try { history.back(); } catch { /* 무시 */ } }
    if (callBack) { try { onClose(); } catch (e) { console.error(e); } }
  }

  ensure(st.cls);
  renderAll();
  requestAnimationFrame(() => { if (!closed) el.focus({ preventScroll: true }); });

  return () => {
    if (closed) return;
    // 경로를 떠날 때: 기록은 이미 움직였으니 건드리지 않는다
    pushed = false;
    teardown();
  };
}
