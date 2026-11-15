// sim-core 내부 도우미: 결정적 난수, 이벤트, 점수, sim-core 전용 상태(WeakMap).
// game.ts 가 rand/emit/award/soldierById 를 다시 export 한다 (계약의 공개 경로는 './game').
import type { Game, GameEvent, Soldier, Team, Vehicle } from '../types';

/** sim-core 전용 상태. Game 타입을 건드리지 않으려고 WeakMap 에 둔다. */
export interface CoreState {
  /** 병사 수 / 거점 수 (크기가 바뀌면 다시 만든다) */
  n: number;
  nf: number;
  /** 쓰러뜨린 병사 id·무기·헤드샷 (최종 사망 이벤트에 쓴다) */
  downBy: Int32Array;
  downWeapon: string[];
  downHead: Uint8Array;
  /** 마지막으로 표시한 병사 id (-1) */
  spottedBy: Int32Array;
  /** 병사가 서 있는 거점 순번 (-1) — 점령 단계가 갱신 */
  inFlag: Int8Array;
  /** 손으로 소생 중인지 (제세동기 진행 값을 덮어쓰지 않으려고) */
  handRevive: Uint8Array;
  /** 거점별 마지막으로 빼앗기던 시각 */
  lastDrain: Float64Array;
  bleedAcc: number;
  /** 지금 티켓이 깎이는 팀 (-1 = 없음) */
  bleeding: Team | -1;
  /** 아직 알리지 않은 티켓 표시점 (내림차순) */
  ticketMarks: [number[], number[]];
  /** 아직 알리지 않은 남은 시간 표시점 (초, 내림차순) */
  timeMarks: number[];
  /** 지금 처리 중인 폭발의 주인 (붕괴 피해 기여) */
  breakBy: number;
  breakTeam: Team | -1;
}

const CORE = new WeakMap<Game, CoreState>();

function makeCore(g: Game, old: CoreState | undefined): CoreState {
  const n = g.soldiers.length, nf = g.flags.length;
  const marks = (): number[] => {
    const m = [Math.round(g.maxTickets * 0.5), 100, 50, 25, 10].filter((x) => x > 0 && x < g.maxTickets);
    return Array.from(new Set(m)).sort((a, b) => b - a);
  };
  const c: CoreState = {
    n, nf,
    downBy: new Int32Array(n).fill(-1),
    downWeapon: new Array<string>(n).fill(''),
    downHead: new Uint8Array(n),
    spottedBy: new Int32Array(n).fill(-1),
    inFlag: new Int8Array(n).fill(-1),
    handRevive: new Uint8Array(n),
    lastDrain: new Float64Array(nf).fill(-1e9),
    bleedAcc: old ? old.bleedAcc : 0,
    bleeding: old ? old.bleeding : -1,
    ticketMarks: old ? old.ticketMarks : [marks(), marks()],
    timeMarks: old ? old.timeMarks : [300, 60].filter((t) => t < g.limit),
    breakBy: -1,
    breakTeam: -1,
  };
  if (old) {
    const k = Math.min(old.n, n);
    for (let i = 0; i < k; i++) {
      c.downBy[i] = old.downBy[i]; c.downWeapon[i] = old.downWeapon[i]; c.downHead[i] = old.downHead[i];
      c.spottedBy[i] = old.spottedBy[i]; c.inFlag[i] = old.inFlag[i]; c.handRevive[i] = old.handRevive[i];
    }
  }
  return c;
}

export function core(g: Game): CoreState {
  let c = CORE.get(g);
  if (!c || c.n !== g.soldiers.length || c.nf !== g.flags.length) {
    c = makeCore(g, c);
    CORE.set(g, c);
  }
  return c;
}

/** 결정적 0..1 (mulberry32, g.seed 를 진행시킨다) */
export function rand(g: Game): number {
  g.seed = (g.seed + 0x6d2b79f5) >>> 0;
  let t = g.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function emit(g: Game, e: GameEvent): void {
  const ev = g.events;
  // 소비자가 비우지 않는 환경(헤드리스 시뮬레이션)에서도 무한히 쌓이지 않게
  if (ev.length >= 6000) ev.splice(0, 2000);
  ev.push(e);
}

export function award(g: Game, sid: number, pts: number, text: string): void {
  const s = g.soldiers[sid];
  if (!s) return;
  const p = Math.round(pts);
  if (p === 0) return;
  s.score += p;
  emit(g, { k: 'score', s: sid, pts: p, text });
}

export function soldierById(g: Game, id: number): Soldier {
  return g.soldiers[id];
}

/** 실제로 타고 있는 팀 (탑승자가 있으면 그 팀, 없으면 차량 팀) */
export function vehicleTeam(g: Game, v: Vehicle): Team {
  const seats = v.seats;
  for (let i = 0; i < seats.length; i++) {
    const id = seats[i];
    if (id >= 0) { const s = g.soldiers[id]; if (s) return s.team; }
  }
  return v.team;
}

export function occupied(v: Vehicle): boolean {
  const seats = v.seats;
  for (let i = 0; i < seats.length; i++) if (seats[i] >= 0) return true;
  return false;
}
