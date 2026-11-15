// 도움말: PC·터치 조작표, 정복전 규칙, 병과 요약, 요령
import type { SizeId } from '../types';
import { CAT_NAMES, CLASSES, CLASS_IDS, GADGETS, SIZES } from '../defs';
import type { AppCtx } from './menu-util';
import { esc, isTouch, onAct } from './menu-util';
import { CLASS_IC, IC } from './menu-icons';

const PC: [string, string][] = [
  ['W A S D', '이동'],
  ['마우스', '시선'],
  ['왼쪽 버튼', '사격'],
  ['오른쪽 버튼', '정조준 (설정에서 누르고 있기 / 전환)'],
  ['Shift', '달리기'],
  ['Space', '점프 · 헬기 상승'],
  ['C', '앉기 · 달리다 누르면 미끄러지기 · 헬기 하강'],
  ['Z', '엎드리기'],
  ['R', '재장전'],
  ['1 / 2', '주무기 / 보조무기'],
  ['3 / 4', '장비 1 / 장비 2'],
  ['G', '투척'],
  ['E', '상호작용 · 소생 · 탑승 · 하차'],
  ['Q', '적 표시'],
  ['F1 ~ F4', '차량 좌석 옮기기'],
  ['B', '사격 방식 바꾸기'],
  ['X', '대응책 (연막 · 플레어)'],
  ['Tab', '점수판 (누르고 있기)'],
  ['M', '전장 지도'],
  ['Esc', '일시 정지'],
];

const TOUCH: [string, string][] = [
  ['왼쪽 아래 스틱', '이동 · 끝까지 위로 밀면 달리기'],
  ['오른쪽 절반 끌기', '시선'],
  ['사격 버튼', '사격 · 누른 채 끌면 시선도 움직임'],
  ['정조준 버튼', '정조준 켜고 끄기'],
  ['재장전 · 점프', '재장전 · 점프'],
  ['앉기 버튼', '앉기 · 길게 누르면 엎드리기'],
  ['장비 1 · 장비 2 · 투척', '장비 꺼내기 → 사격 버튼으로 사용'],
  ['무기 바꾸기', '주무기 ↔ 보조무기'],
  ['상호작용', '소생 · 탑승 (상황일 때만 나타남)'],
  ['표시', '앞에 있는 적 표시'],
  ['차량', '가속 · 후진 · 사격 · 좌석 · 하차 · 대응책'],
  ['헬기', '상승 · 하강 버튼 추가'],
];

const TIPS = [
  '거점 반경 안에 아군이 많을수록 빨리 점령합니다. 분대와 함께 움직이세요.',
  '전사하면 티켓이 줄지만, 쓰러진 상태에서 소생되면 줄지 않습니다. 지원병 곁에서 싸우세요.',
  '소음기 없이 쏘면 잠시 적 미니맵에 표시됩니다. 측면을 노릴 때는 소음기를 다세요.',
  '건물 벽은 폭발물로 부술 수 있고, 벽을 많이 잃은 건물은 무너집니다. 안에 숨은 적을 몰아내세요.',
  '전차는 뒤와 위 장갑이 얇습니다. 공병 로켓은 뒤에서 맞히세요.',
  '정찰병의 비컨과 분대원 곁으로 바로 배치할 수 있습니다. 본부에서 걸어가지 마세요.',
  '숙련 무기 분류를 들면 정조준과 반동 제어가 조금 좋아집니다.',
  '달리다 앉으면 미끄러지며 엄폐물로 빠르게 들어갈 수 있습니다.',
];

export function mountHelp(ctx: AppCtx): () => void {
  const p = ctx.profile;
  if (!p.seenHelp) { p.seenHelp = true; ctx.save(); }
  const touch = isTouch();
  const sizes = Object.keys(SIZES) as SizeId[];

  const table = (rows: [string, string][], kb: boolean) => `<table class="wm-keys"><tbody>${rows.map(([k, v]) => `<tr><th>${kb ? k.split(' / ').map((x) => `<kbd>${esc(x)}</kbd>`).join('<span class="wm-sl">/</span>') : `<span class="wm-tk">${esc(k)}</span>`}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`;

  const el = document.createElement('div');
  el.className = 'wm-screen wm-page wm-help';
  el.innerHTML = `
    <header class="wm-top">
      <button class="wm-back" data-a="back" aria-label="뒤로">${IC.back}<span>뒤로</span></button>
      <div class="wm-top-t"><p class="wm-eyebrow"><i></i>작전 교범</p><h2 class="wm-h2">조작법</h2></div>
    </header>
    <nav class="wm-jump" aria-label="바로 가기">
      <button data-a="jump" data-v="pc">${IC.mouse}PC</button>
      <button data-a="jump" data-v="touch">${IC.touch}터치</button>
      <button data-a="jump" data-v="rules">${IC.flag}규칙</button>
      <button data-a="jump" data-v="classes">${IC.users}병과</button>
      <button data-a="jump" data-v="tips">${IC.bolt}요령</button>
    </nav>
    <div class="wm-body">
      <div class="wm-cols ${touch ? 'touch-first' : ''}">
        <section class="wm-sec wm-card" id="wm-h-pc"><h3 class="wm-h3">${IC.mouse}PC · 마우스와 키보드</h3><p class="wm-dim">화면을 클릭하면 마우스가 잠기고, Esc 로 풀립니다.</p>${table(PC, true)}</section>
        <section class="wm-sec wm-card" id="wm-h-touch"><h3 class="wm-h3">${IC.touch}터치 · 휴대폰과 태블릿</h3><p class="wm-dim">가로 화면을 권장합니다. 두 손가락으로 이동과 시선을 동시에 다룹니다.</p>${table(TOUCH, false)}</section>
      </div>
      <section class="wm-sec wm-card" id="wm-h-rules">
        <h3 class="wm-h3">${IC.flag}정복전</h3>
        <ol class="wm-rules">
          <li><b>거점</b><span>지도 곳곳의 거점 반경 안에 들어가면 깃발이 천천히 넘어옵니다. 안에 있는 아군이 많을수록 빠르고, 적이 같이 있으면 멈춥니다.</span></li>
          <li><b>티켓</b><span>양쪽은 증원 티켓을 갖고 시작합니다. 병사가 전사할 때마다 한 장씩 줄고, 거점을 더 많이 쥔 쪽은 상대 티켓을 계속 깎습니다.</span></li>
          <li><b>소생</b><span>치명상을 입으면 쓰러집니다. 출혈 시간 안에 아군이 일으켜 주면 티켓이 줄지 않습니다. 기다릴 수 없으면 포기하고 재배치하세요.</span></li>
          <li><b>승패</b><span>티켓이 먼저 바닥나는 쪽이 집니다. 제한 시간이 끝나면 티켓이 많은 쪽이 이깁니다.</span></li>
          <li><b>배치</b><span>본부, 완전히 장악한 아군 거점, 교전 중이 아닌 분대원 곁, 정찰병 비컨, 빈 좌석이 있는 아군 차량 가운데 골라 투입합니다.</span></li>
        </ol>
        <div class="wm-sizes">${sizes.map((id) => { const s = SIZES[id]; return `<div><b>${s.perTeam} 대 ${s.perTeam}</b><span>거점 ${s.flags}개 · 티켓 ${s.tickets}</span></div>`; }).join('')}</div>
      </section>
      <section class="wm-sec" id="wm-h-classes">
        <h3 class="wm-h3">${IC.users}병과</h3>
        <div class="wm-classes">
          ${CLASS_IDS.map((id) => {
            const c = CLASSES[id];
            const gad = c.gadgets.map((g) => GADGETS[g]?.name).filter(Boolean).join(' · ');
            const thr = c.throwables.map((g) => GADGETS[g]?.name).filter(Boolean).join(' · ');
            return `<article class="wm-card wm-class">
              <header><span class="wm-class-i">${CLASS_IC[id] ?? ''}</span><div><b>${esc(c.name)}</b><small>${esc(c.role)}</small></div></header>
              <p>${esc(c.desc)}</p>
              <dl class="wm-rows">
                <div><dt>특성</dt><dd>${esc(c.trait)}</dd></div>
                <div><dt>숙련</dt><dd>${c.signature.map((s) => esc(CAT_NAMES[s])).join(' · ')}</dd></div>
                <div><dt>장비</dt><dd>${esc(gad)}</dd></div>
                <div><dt>투척</dt><dd>${esc(thr)}</dd></div>
              </dl>
            </article>`;
          }).join('')}
        </div>
      </section>
      <section class="wm-sec wm-card" id="wm-h-tips">
        <h3 class="wm-h3">${IC.bolt}요령</h3>
        <ul class="wm-tips">${TIPS.map((t, i) => `<li><b>${String(i + 1).padStart(2, '0')}</b><span>${esc(t)}</span></li>`).join('')}</ul>
      </section>
    </div>`;
  ctx.root.appendChild(el);

  const off = onAct(el, (a, t) => {
    if (a === 'back') ctx.back();
    else if (a === 'jump') el.querySelector(`#wm-h-${t.dataset.v}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  return off;
}
