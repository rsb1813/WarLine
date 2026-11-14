// 병과 장비 편집기: 무기, 부착물, 장비 둘을 고르고 효과를 바로 보여 준다
import {
  CLASSES, GADGETS, GRIPS, MAGS, MUZZLES, OPTICS, WEAPONS, weaponStats,
  type ClassId, type GadgetId, type Grip, type MagAtt, type Muzzle, type Optic, type WeaponId,
} from '../game/defs';
import type { Profile } from '../game/profile';

const bar = (label: string, v: number, text: string) =>
  `<span class="sbar"><em>${label}</em><i><b style="width:${Math.max(4, Math.min(100, v * 100)).toFixed(0)}%"></b></i><u>${text}</u></span>`;

export function weaponBars(id: WeaponId): string {
  const w = WEAPONS[id];
  const hit = w.dmg * (w.pellets ?? 1);
  const ttk = Math.ceil(100 / w.dmg) - 1;
  return bar('위력', hit / 120, `${w.dmg}${w.pellets ? '×' + w.pellets : ''}`)
    + bar('연사', w.rpm / 900, `${w.rpm}발/분`)
    + bar('사거리', w.far / 1500, `${w.far}`)
    + bar('조준', 1 - w.ads / 0.03, w.ads < 0.008 ? '매우 정확' : w.ads < 0.016 ? '정확' : '보통')
    + bar('기동', (w.move - 0.82) / 0.3, `${Math.round(w.move * 100)}%`)
    + `<span class="ttk">근거리 ${ttk + 1}발 · 탄창 ${w.mag}발 · 재장전 ${w.reload}초</span>`;
}

export function kitSummary(p: Profile, cls: ClassId): string {
  const k = p.kits[cls];
  const w = WEAPONS[k.weapon];
  return `<b>${w.name}</b> ${w.kind} · ${OPTICS[k.optic].name}<br>${GADGETS[k.ga].name} · ${GADGETS[k.gb].name} · 수류탄`;
}

export function renderKit(el: HTMLElement, p: Profile, cls: ClassId, onChange: () => void) {
  const c = CLASSES[cls];
  const draw = () => {
    const k = p.kits[cls];
    const ws = weaponStats(k);
    const w = WEAPONS[k.weapon];
    const seg = <T extends string>(name: string, slot: string, opts: T[], cur: T, label: (o: T) => string, desc: string) =>
      `<div class="att"><span class="att-n">${name}</span><div class="segs">${opts.map((o) => `<button class="seg${o === cur ? ' on' : ''}" data-k="${slot}" data-v="${o}">${label(o)}</button>`).join('')}</div><p class="att-d">${desc}</p></div>`;
    const gcards = (slot: 'ga' | 'gb', list: GadgetId[]) => list.map((g) =>
      `<button class="gcard${k[slot] === g ? ' on' : ''}" data-k="${slot}" data-v="${g}"><b>${GADGETS[g].name}</b><span>${GADGETS[g].desc}</span></button>`).join('');
    el.innerHTML = `
      <p class="trait"><b>${c.name}</b> ${c.role}. ${c.trait}</p>
      <h4>주무기</h4>
      <div class="wcards">${c.weapons.map((id) => `<button class="wcard${id === k.weapon ? ' on' : ''}" data-k="weapon" data-v="${id}">
        <span class="wc-h"><b>${WEAPONS[id].name}</b><em>${WEAPONS[id].kind}</em></span>
        <span class="bars">${weaponBars(id)}</span><span class="wc-d">${WEAPONS[id].desc}</span></button>`).join('')}</div>
      <h4>부착물 <small>${w.name}에 단다. 정조준 시야 ${ws.look}, 탄창 ${ws.mag}발</small></h4>
      ${seg('조준경', 'optic', w.optics, k.optic, (o) => OPTICS[o].name, OPTICS[k.optic].desc)}
      ${seg('총구', 'muzzle', ['none', 'supp', 'comp'] as Muzzle[], k.muzzle, (o) => MUZZLES[o].name, MUZZLES[k.muzzle].desc)}
      ${seg('탄창', 'mag', ['std', 'ext'] as MagAtt[], k.mag, (o) => MAGS[o].name, MAGS[k.mag].desc)}
      ${seg('손잡이', 'grip', ['none', 'vert'] as Grip[], k.grip, (o) => GRIPS[o].name, GRIPS[k.grip].desc)}
      <h4>장비 1 <small>키 2</small></h4><div class="gcards">${gcards('ga', c.gadgetsA)}</div>
      <h4>장비 2 <small>키 3</small></h4><div class="gcards">${gcards('gb', c.gadgetsB)}</div>`;
  };
  el.onclick = (e) => {
    const t = (e.target as HTMLElement).closest('[data-k]') as HTMLElement | null;
    if (!t) return;
    const k = p.kits[cls];
    const key = t.dataset.k!, v = t.dataset.v!;
    if (key === 'weapon') {
      k.weapon = v as WeaponId;
      if (!WEAPONS[k.weapon].optics.includes(k.optic)) k.optic = WEAPONS[k.weapon].optics.includes('x6') ? 'x6' : 'dot';
    } else if (key === 'optic') k.optic = v as Optic;
    else if (key === 'muzzle') k.muzzle = v as Muzzle;
    else if (key === 'mag') k.mag = v as MagAtt;
    else if (key === 'grip') k.grip = v as Grip;
    else if (key === 'ga') k.ga = v as GadgetId;
    else if (key === 'gb') k.gb = v as GadgetId;
    const sc = el.scrollTop;
    draw();
    el.scrollTop = sc;
    onChange();
  };
  draw();
}
