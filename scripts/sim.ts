// 봇끼리만 싸우는 전투를 화면 없이 돌려 엔진이 멀쩡한지, 판이 얼마나 걸리는지 본다
import { CLASSES, DEFAULT_KITS, MAPS, type Diff, type SizeId } from '../src/game/defs';
import { createBattle, step } from '../src/game/battle';

const diff = (process.argv[2] ?? 'normal') as Diff;
const only = process.argv[3];
const N = Number(process.argv[4] ?? 1);
for (const map of MAPS) {
  if (only && map.id !== only) continue;
  for (const size of ['small', 'medium', 'large'] as SizeId[]) {
    if (process.argv[5] && size !== process.argv[5]) continue;
    for (let k = 0; k < N; k++) {
      const t0 = Date.now();
      const b = createBattle({ map, size, diff, side: 'us', kits: DEFAULT_KITS, playerCls: 'assault', squadCls: ['medic', 'engineer', 'recon'], flip: k % 2 === 1 });
      const gen = Date.now() - t0;
      b.player.bot = true; // 플레이어 자리도 봇이 맡는다
      let steps = 0;
      const t1 = Date.now();
      while (!b.over && steps < 60 * 60 * 20) { step(b, 1 / 30); b.events.length = 0; steps++; }
      const ms = (Date.now() - t1) / steps;
      for (const s of b.soldiers) if (!Number.isFinite(s.x + s.y + s.hp)) throw new Error('NaN soldier ' + s.id);
      const kills = (t: number) => b.soldiers.filter((s) => s.team === t).reduce((a, s) => a + s.kills, 0);
      const deaths = (t: number) => b.soldiers.filter((s) => s.team === t).reduce((a, s) => a + s.deaths, 0);
      const revs = b.soldiers.reduce((a, s) => a + s.revives, 0);
      const vk = b.soldiers.reduce((a, s) => a + s.vkills, 0);
      const broken = b.world.buildings.filter((x) => x.collapsed).length;
      const caps = b.soldiers.reduce((a, s) => a + s.caps, 0);
      console.log(`${map.id.padEnd(9)} ${size.padEnd(6)} ${b.over?.win ? '승' : '패'} ${(b.time / 60).toFixed(1)}분 티켓 ${b.tickets.join(':')} 사살 ${kills(0)}:${kills(1)} 전사 ${deaths(0)}:${deaths(1)} 소생 ${revs} 점령 ${caps} 차량격파 ${vk} 붕괴 ${broken}/${b.world.buildings.length} 거점 ${b.flags.map((f) => (f.owner < 0 ? '-' : f.owner)).join('')} · 생성 ${gen}ms ${ms.toFixed(2)}ms/step`);
    }
  }
}
void CLASSES;
