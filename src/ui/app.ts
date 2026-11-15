// 메뉴 앱: 해시 라우터(#home #play #loadout #settings #help #battle), 기기 뒤로 가기, 프로필 보관
import './base.css';
import './menus.css';
import type { BattleResult } from '../types';
import { loadProfile, saveProfile } from '../profile';
import { startBattle } from '../app/battle';
import type { AppCtx, Route } from './menu-util';
import { esc, onAct } from './menu-util';
import { mountHome } from './menu-home';
import { mountPlay } from './menu-play';
import { mountSettings } from './menu-settings';
import { mountHelp } from './menu-help';
import { mountResults } from './menu-results';
import { openEditor } from './loadout';
import { IC } from './menu-icons';

const ROUTES: Route[] = ['home', 'play', 'loadout', 'settings', 'help', 'battle', 'results'];

export function startApp(root: HTMLElement): void {
  const profile = loadProfile();
  let current: Route | null = null;
  let cleanup: (() => void) | null = null;
  let last: { r: BattleResult; xpBefore: number } | null = null;

  const parse = (): Route => {
    const h = location.hash.replace(/^#\/?/, '').toLowerCase() as Route;
    return ROUTES.includes(h) ? h : 'home';
  };

  const ctx: AppCtx = {
    root,
    profile,
    save: () => saveProfile(profile),
    go(r: Route) {
      if (r === current) { render(r, true); return; }
      try { history.pushState({ wl: 1 }, '', '#' + r); } catch { location.hash = '#' + r; return; }
      render(r);
    },
    back() {
      const st = history.state as { wl?: number } | null;
      if (st && st.wl) history.back();
      else {
        try { history.replaceState(null, '', '#home'); } catch { /* 무시 */ }
        render('home');
      }
    },
  };

  /** 지금 기록을 바꿔 끼우며 이동 (기록이 쌓이지 않음) */
  const replace = (r: Route) => {
    try { history.replaceState(history.state, '', '#' + r); } catch { /* 무시 */ }
    render(r, true);
  };

  function render(r: Route, force = false): void {
    if (r === current && !force) return;
    if (cleanup) { const c = cleanup; cleanup = null; try { c(); } catch (e) { console.error(e); } }
    current = r;
    root.innerHTML = '';
    root.scrollTop = 0;
    document.body.dataset.wlRoute = r;
    try {
      cleanup = mount(r);
    } catch (e) {
      console.error(e);
      cleanup = mountError(String((e as Error)?.message ?? e));
    }
  }

  function mount(r: Route): () => void {
    switch (r) {
      case 'play': return mountPlay(ctx, () => replace('battle')); // 설정 화면 자리를 전투가 차지: 뒤로 = 홈
      case 'settings': return mountSettings(ctx);
      case 'help': return mountHelp(ctx);
      case 'loadout': return mountLoadout();
      case 'battle': return mountBattle();
      case 'results':
        if (!last) { queueMicrotask(() => replace('home')); return () => {}; }
        return mountResults(ctx, last.r, last.xpBefore, () => replace('battle'), () => ctx.back());
      default: return mountHome(ctx);
    }
  }

  function mountLoadout(): () => void {
    const host = document.createElement('div');
    host.className = 'wm-screen wm-lohost';
    root.appendChild(host);
    const close = openEditor(host, profile, profile.cls, () => ctx.back(), { history: false });
    return close;
  }

  function mountBattle(): () => void {
    let dispose: (() => void) | null = null;
    let dead = false;
    const kill = () => {
      if (dead) return;
      dead = true;
      const d = dispose;
      dispose = null;
      if (d) { try { d(); } catch (e) { console.error(e); } }
    };
    const xpBefore = profile.xp;
    try {
      dispose = startBattle(root, profile, (r) => {
        // 전투 쪽 콜백 안에서 바로 치우지 않고 한 박자 뒤에
        window.setTimeout(() => {
          if (dead) return;
          kill();
          if (r) {
            applyResult(r);
            last = { r, xpBefore };
            replace('results');
          } else ctx.back();
        }, 0);
      });
    } catch (e) {
      console.error(e);
      dead = true;
      return mountError('전장을 열지 못했습니다. ' + String((e as Error)?.message ?? e));
    }
    return kill;
  }

  function applyResult(r: BattleResult): void {
    const s = profile.stats;
    profile.xp = Math.max(0, Math.round(profile.xp + Math.max(0, r.xp || 0)));
    s.games += 1;
    if (r.win) s.wins += 1;
    s.kills += r.kills || 0;
    s.deaths += r.deaths || 0;
    s.revives += r.revives || 0;
    s.caps += r.caps || 0;
    s.heads += r.heads || 0;
    saveProfile(profile);
  }

  function mountError(msg: string): () => void {
    root.innerHTML = `<div class="wm-screen wm-error"><div class="wm-error-card">
      <p class="wm-eyebrow">통신 두절</p><h2 class="wm-h2">문제가 생겼습니다</h2><p class="wm-dim">${esc(msg)}</p>
      <button class="primary wm-big" data-a="home">${IC.back}<span>메인으로</span></button></div></div>`;
    return onAct(root, (a) => { if (a === 'home') { try { history.replaceState(null, '', '#home'); } catch { /* 무시 */ } render('home', true); } });
  }

  const onNav = () => render(parse());
  window.addEventListener('hashchange', onNav);
  window.addEventListener('popstate', onNav);

  // 하위 화면에서 Esc = 뒤로
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (current === 'play' || current === 'settings' || current === 'help') { e.preventDefault(); ctx.back(); }
  });

  render(parse(), true);
}
