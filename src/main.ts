import './style.css';
import { loadProfile, saveProfile } from './game/profile';
import { GameScreen } from './ui/game';
import { helpScreen, homeScreen, loadoutScreen, settingsScreen, setupScreen, squadScreen, type Screen } from './ui/menus';

type View = 'home' | 'setup' | 'loadout' | 'squad' | 'settings' | 'help' | 'battle';
const VIEWS: View[] = ['home', 'setup', 'loadout', 'squad', 'settings', 'help', 'battle'];

const root = document.getElementById('screen')!;
const p = loadProfile();
let cur: Screen | null = null;
let view: View | null = null;

const hashView = (): View => {
  const h = location.hash.replace('#', '') as View;
  return VIEWS.includes(h) ? h : 'home';
};

/** 화면을 바꾸고 주소의 해시에 남긴다 (기기의 뒤로 가기가 먹는다) */
function go(to: string) {
  const v = (VIEWS.includes(to as View) ? to : 'home') as View;
  view = v;
  try { if (hashView() !== v) location.hash = v; } catch { /* 해시를 못 쓰면 화면만 바꾼다 */ }
  cur?.destroy();
  root.innerHTML = '';
  if (v === 'battle') {
    cur = new GameScreen(root, p, {
      end: () => go('home'),
      quit: () => go('home'),
      again: () => { cur?.destroy(); cur = null; view = null; go('battle'); },
    });
  } else {
    const make = { home: homeScreen, setup: setupScreen, loadout: loadoutScreen, squad: squadScreen, settings: settingsScreen, help: helpScreen }[v];
    cur = make(root, p, go);
  }
  saveProfile(p);
}

window.addEventListener('hashchange', () => { const v = hashView(); if (v !== view) go(v); });
// 전투는 저장되지 않으므로 새로 고침하면 첫 화면으로
const first = hashView();
go(first === 'battle' ? 'home' : first);
