// 엔진 핵심 규칙: 지도 생성, 길찾기, 파괴, 전투 진행, 프로필
import { describe, expect, it } from 'vitest';
import { DEFAULT_KITS, MAPS, SIZES, WEAPONS, weaponStats, type Kit } from '../src/game/defs';
import { genWorld } from '../src/game/mapgen';
import { buildNav, pathDist, updateNav } from '../src/game/nav';
import { createBattle, damageCell, step } from '../src/game/battle';
import { CELL, MOVE_BLOCK, RUBBLE, WALL, WINDOW } from '../src/game/grid';
import { loadProfile, newProfile, rankOf } from '../src/game/profile';

describe('지도 생성', () => {
  for (const def of MAPS) {
    it(`${def.id}: 건물과 거점이 있고 모든 거점이 양쪽 본부와 걸어서 이어진다`, () => {
      const w = genWorld(def, false);
      expect(w.buildings.length).toBeGreaterThanOrEqual(15);
      expect(w.flags.length).toBeGreaterThanOrEqual(5);
      expect(w.hq).toHaveLength(2);
      expect(w.roads.length).toBeGreaterThan(0);
      const nav = buildNav(w);
      const nf = w.flags.length;
      for (let f = 0; f < nf; f++) for (const hq of w.hq) expect(Number.isFinite(pathDist(w, nav, f, hq.x, hq.y))).toBe(true);
      // 본부 둘 사이도 차량으로 갈 수 있다
      expect(Number.isFinite(pathDist(w, nav, nf, w.hq[1].x, w.hq[1].y, true))).toBe(true);
    });
  }

  it('같은 지도는 늘 같은 모양으로 만들어진다', () => {
    const a = genWorld(MAPS[0], false), b = genWorld(MAPS[0], false);
    expect(Array.from(a.t)).toEqual(Array.from(b.t));
    expect(a.buildings.length).toBe(b.buildings.length);
  });
});

describe('파괴', () => {
  it('벽을 부수면 잔해가 되고 막혔던 길이 열린다', () => {
    const b = createBattle({ map: MAPS[0], size: 'small', diff: 'easy', side: 'us', kits: DEFAULT_KITS, playerCls: 'assault', squadCls: ['medic', 'engineer', 'recon'] });
    const w = b.world;
    const i = w.t.findIndex((t, k) => t === WALL && w.bld[k] >= 0);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(MOVE_BLOCK[w.t[i]]).toBe(1);
    const k = 0;
    const before = b.nav.foot[k][i];
    damageCell(b, i, 99999);
    expect(w.t[i]).toBe(RUBBLE);
    expect(MOVE_BLOCK[w.t[i]]).toBe(0);
    updateNav(w, b.nav, 1);
    const after = b.nav.foot[k][i];
    expect(Number.isFinite(after)).toBe(true);
    expect(after).toBeLessThanOrEqual(before);
  });

  it('벽이 절반 넘게 무너지면 건물이 통째로 주저앉는다', () => {
    const b = createBattle({ map: MAPS[1], size: 'small', diff: 'easy', side: 'us', kits: DEFAULT_KITS, playerCls: 'assault', squadCls: ['medic', 'engineer', 'recon'] });
    const w = b.world;
    const bl = w.buildings.find((x) => !x.collapsed)!;
    const id = w.buildings.indexOf(bl);
    for (let y = bl.y; y < bl.y + bl.h && !bl.collapsed; y++) for (let x = bl.x; x < bl.x + bl.w && !bl.collapsed; x++) {
      const i = y * w.cw + x;
      if (w.bld[i] === id && (w.t[i] === WALL || w.t[i] === WINDOW)) damageCell(b, i, 99999);
    }
    expect(bl.collapsed).toBe(true);
    for (let y = bl.y; y < bl.y + bl.h; y++) for (let x = bl.x; x < bl.x + bl.w; x++) expect(w.roof[y * w.cw + x]).toBe(0);
  });
});

describe('전투 진행', () => {
  it('봇끼리 2분을 돌려도 값이 깨지지 않고 티켓이 줄어든다', () => {
    const b = createBattle({ map: MAPS[2], size: 'small', diff: 'normal', side: 'ru', kits: DEFAULT_KITS, playerCls: 'medic', squadCls: ['assault', 'engineer', 'recon'] });
    b.player.bot = true;
    expect(b.soldiers).toHaveLength(SIZES.small.team * 2);
    const t0 = [...b.tickets];
    for (let k = 0; k < 30 * 120 && !b.over; k++) { step(b, 1 / 30); b.events.length = 0; }
    for (const s of b.soldiers) expect(Number.isFinite(s.x + s.y + s.hp)).toBe(true);
    for (const v of b.vehicles) expect(Number.isFinite(v.x + v.y + v.hp)).toBe(true);
    expect(b.tickets[0] + b.tickets[1]).toBeLessThan(t0[0] + t0[1]);
    expect(b.soldiers.reduce((a, s) => a + s.kills, 0)).toBeGreaterThan(0);
    expect(b.flags.some((f) => f.owner >= 0)).toBe(true);
  });
});

describe('장비', () => {
  it('부착물이 수치를 예상한 방향으로 바꾼다', () => {
    const base: Kit = { ...DEFAULT_KITS.recon, optic: 'iron', muzzle: 'none', mag: 'std', grip: 'none' };
    const s0 = weaponStats(base);
    expect(weaponStats({ ...base, mag: 'ext' }).mag).toBeGreaterThan(s0.mag);
    expect(weaponStats({ ...base, muzzle: 'supp' }).supp).toBe(true);
    if (WEAPONS[base.weapon].optics.includes('x6')) {
      const sc = weaponStats({ ...base, optic: 'x6' });
      expect(sc.look).toBeGreaterThan(s0.look);
      expect(sc.scope).toBe(true);
    }
  });
});

describe('프로필', () => {
  it('저장소가 없어도 기본값으로 시작하고 기본 난이도는 쉬움이다', () => {
    const p = loadProfile();
    expect(p.diff).toBe('easy');
    expect(p.kits.assault.weapon).toBe(newProfile().kits.assault.weapon);
  });
  it('경험치가 늘면 계급이 내려가지 않는다', () => {
    let last = 0;
    for (let xp = 0; xp < 200000; xp += 777) { const r = rankOf(xp).rank; expect(r).toBeGreaterThanOrEqual(last); last = r; }
    expect(rankOf(0).rank).toBe(1);
  });
});

void CELL;
