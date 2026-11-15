// 화면 없이 봇끼리 전투를 돌려 엔진이 멀쩡한지, 판이 얼마나 걸리는지 본다
// 사용: npx tsx scripts/sim.ts [small|medium|large] [분] [지도 순번]
import type { ClassId, Loadout, SizeId } from '../src/types';
import { CLASS_IDS, MAPS } from '../src/defs';
import { defaultLoadout } from '../src/profile';
import { createGame, deploySoldier, spawnOptions, stepGame } from '../src/sim/game';

const size = (process.argv[2] ?? 'medium') as SizeId;
const minutes = Number(process.argv[3] ?? 3);
const map = MAPS[Number(process.argv[4] ?? 0)] ?? MAPS[0];
const loadouts = Object.fromEntries(CLASS_IDS.map((c) => [c, defaultLoadout(c)])) as Record<ClassId, Loadout>;

const t0 = Date.now();
const g = createGame({ map, size, diff: 'normal', side: 'us', loadouts, playerCls: 'assault' });
console.log(`${map.name} ${size}: 생성 ${Date.now() - t0}ms, 상자 ${g.world.boxes.length}, 건물 ${g.world.buildings.length}, 나무 ${g.world.trees.length}, 병사 ${g.soldiers.length}, 차량 ${g.vehicles.length}`);

const steps = Math.round(minutes * 60 * 60);
const t1 = Date.now();
let worst = 0;
for (let i = 0; i < steps && !g.over; i++) {
  const pl = g.soldiers[g.player];
  if (g.playerNeedsDeploy && pl.respawnT <= 0) {
    const opt = spawnOptions(g, g.player).find((o) => o.ok);
    if (opt) deploySoldier(g, g.player, opt, 'assault', loadouts.assault);
  }
  const a = performance.now();
  stepGame(g, 1 / 60);
  worst = Math.max(worst, performance.now() - a);
  g.events.length = 0;
  if (i % (60 * 30) === 0) {
    const alive = g.soldiers.filter((s) => s.state === 'alive').length;
    console.log(`  ${(g.time / 60).toFixed(1)}분 티켓 ${g.tickets.join(':')} 거점 ${g.flags.map((f) => (f.owner < 0 ? '-' : f.owner)).join('')} 생존 ${alive} 투사체 ${g.projectiles.length}`);
  }
}
const ms = (Date.now() - t1) / Math.max(1, Math.round(g.time * 60));
for (const s of g.soldiers) if (!Number.isFinite(s.pos.x + s.pos.y + s.pos.z + s.hp)) throw new Error('NaN 병사 ' + s.id);
for (const v of g.vehicles) if (!Number.isFinite(v.pos.x + v.pos.y + v.pos.z + v.hp)) throw new Error('NaN 차량 ' + v.id);
const sum = (t: number, k: 'kills' | 'deaths' | 'revives' | 'caps' | 'vkills') => g.soldiers.filter((s) => s.team === t).reduce((a, s) => a + s[k], 0);
console.log(`끝: ${(g.time / 60).toFixed(1)}분 ${g.over ? `승자 ${g.over.winner} (${g.over.reason})` : '진행 중'} 티켓 ${g.tickets.join(':')}`);
console.log(`처치 ${sum(0, 'kills')}:${sum(1, 'kills')} 소생 ${sum(0, 'revives') + sum(1, 'revives')} 점령 ${sum(0, 'caps') + sum(1, 'caps')} 차량 격파 ${sum(0, 'vkills') + sum(1, 'vkills')} 무너진 건물 ${g.world.buildings.filter((b) => b.collapsed).length}`);
console.log(`스텝당 ${ms.toFixed(2)}ms (최악 ${worst.toFixed(1)}ms)`);
