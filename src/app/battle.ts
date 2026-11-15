// 전투 화면: 게임 루프, 입력 → 내 병사 조작, 카메라, 렌더, HUD, 배치·일시 정지·끝 화면을 묶는다
import * as THREE from 'three';
import type { BattleResult, ClassId, Game, Profile, SpawnOption, Vehicle } from '../types';
import { createGame, deploySoldier, giveUp, stepGame } from '../sim/game';
import { CLASSES, GADGETS, MAPS, VEHICLES } from '../defs';
import { saveProfile } from '../profile';
import { WorldView } from '../render/scene';
import { ActorsView } from '../render/actors';
import { ViewModel } from '../render/viewmodel';
import { Effects } from '../render/effects';
import { Hud } from '../ui/hud';
import { DeployScreen } from '../ui/deploy';
import { openLoadoutEditor } from '../ui/loadout';
import { Input, type InputFrame } from '../input/input';
import { AudioSys } from '../audio/audio';
import { nearestVehicle, seatWorldPos } from '../sim/vehicles';
import { raycast } from '../world';
import { clamp, damp, dirFrom, lerp, wrapAngle } from '../math';
import './battle.css';

const STEP = 1 / 60;
const DEG = Math.PI / 180;

export function startBattle(root: HTMLElement, profile: Profile, onExit: (r: BattleResult | null) => void): () => void {
  root.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'battle';
  el.innerHTML = `<canvas class="bt-view"></canvas><div class="bt-hud"></div><div class="bt-deploy"></div>
    <div class="bt-load"><b>전장 생성 중</b><small>지형과 건물을 만드는 중입니다</small></div>
    <div class="bt-pause" hidden></div><div class="bt-end" hidden></div><div class="bt-fps" hidden></div>`;
  root.appendChild(el);
  const q = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;

  let disposed = false;
  let raf = 0;
  let cleanup: (() => void) | null = null;

  // 무거운 생성은 로딩 글이 한 번 그려진 뒤에
  const boot = window.setTimeout(() => {
    if (disposed) return;
    try {
      cleanup = run();
    } catch (err) {
      console.error(err);
      q('.bt-load').innerHTML = `<b>전장을 열지 못했습니다</b><small>${String((err as Error)?.message ?? err)}</small><button data-x="quit">메인으로</button>`;
      q('.bt-load').querySelector('button')?.addEventListener('click', () => onExit(null));
    }
  }, 40);

  function run(): () => void {
    const map = MAPS.find((m) => m.id === profile.map) ?? MAPS[0];
    const g: Game = createGame({ map, size: profile.size, diff: profile.diff, side: profile.side, loadouts: profile.loadouts, playerCls: profile.cls });
    const pl = g.soldiers[g.player];
    const set = profile.settings;

    const canvas = q<HTMLCanvasElement>('.bt-view');
    const wv = new WorldView(canvas, set.quality);
    wv.setWorld(g.world);
    const cam = wv.camera;
    cam.rotation.order = 'YXZ';
    const actors = new ActorsView(wv.scene, set.quality);
    const vm = new ViewModel();
    const fx = new Effects(wv.scene, cam, set.quality);
    const hud = new Hud(q('.bt-hud'), g);
    const deploy = new DeployScreen(q('.bt-deploy'), g, profile);
    const input = new Input(el, set);
    const audio = new AudioSys();
    audio.setVolume(set.volume);
    q('.bt-load').hidden = true;

    let paused = false;
    let endShown = false;
    let overT = 0;
    let acc = 0;
    let last = performance.now();
    let interactLatch = false;
    let showBoard = false;
    let ctxKey = '';
    let camYaw = pl.yaw, camPitch = -0.35;
    const camPos = new THREE.Vector3(g.world.hq[0].x, g.world.hq[0].y + 40, g.world.hq[0].z + 30);
    let fpsAcc = 0, fpsN = 0;
    const fpsEl = q('.bt-fps');
    fpsEl.hidden = !set.showFps;

    if (import.meta.env.DEV) (window as unknown as { __battle: unknown }).__battle = { g, wv, actors, vm, fx, hud, input, audio };

    // ── 크기 ──
    const resize = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(1, r.width), h = Math.max(1, r.height);
      wv.resize(w, h, window.devicePixelRatio || 1);
      vm.resize(w, h);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // ── 소리 잠금 해제 (첫 손짓) ──
    const unlock = () => audio.unlock();
    el.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    // ── 배치 ──
    const openDeploy = () => {
      if (!deploy.isOpen()) {
        deploy.open();
        input.setMode('hidden');
        if (document.pointerLockElement) document.exitPointerLock();
      }
    };
    deploy.onDeploy = (opt: SpawnOption, cls: ClassId) => {
      profile.cls = cls;
      saveProfile(profile);
      deploySoldier(g, g.player, opt, cls, profile.loadouts[cls]);
      pl.ctl.yaw = pl.yaw;
      pl.ctl.pitch = 0;
      pl.ctl.stance = 'stand';
      camYaw = pl.yaw; camPitch = 0;
      deploy.close();
      audio.unlock();
      audio.ui('deploy');
      if (!input.touch) input.lock();
    };
    deploy.onEdit = (cls: ClassId) => openLoadoutEditor(el, profile, cls, () => deploy.refresh());
    deploy.onQuit = () => confirmQuit();

    hud.onButton = (b) => {
      if (b === 'pause') pause();
      else if (b === 'map') hud.toggleMap();
      else { showBoard = !showBoard; hud.showScoreboard(showBoard); }
    };
    hud.onGiveUp = () => giveUp(g, g.player);

    // ── 일시 정지 ──
    const pauseEl = q('.bt-pause');
    const pause = () => {
      if (paused || g.over) return;
      paused = true;
      input.setMode('hidden');
      if (document.pointerLockElement) document.exitPointerLock();
      pauseEl.hidden = false;
      pauseEl.innerHTML = `<div class="bt-card">
        <h2 class="display">일시 정지</h2>
        <p class="bt-sub">${map.name} · 티켓 ${g.tickets[0]} : ${g.tickets[1]}</p>
        <div class="bt-btns">
          <button class="primary" data-x="resume">전투로 돌아가기</button>
          <button data-x="loadout">로드아웃 (다음 배치부터)</button>
          <label class="bt-range">감도 <input type="range" min="0.2" max="3" step="0.05" value="${set.sens}" data-s="sens"></label>
          <label class="bt-range">음량 <input type="range" min="0" max="1" step="0.05" value="${set.volume}" data-s="volume"></label>
          <button data-x="quit">전투 나가기</button>
        </div></div>`;
    };
    const resume = () => {
      if (!paused) return;
      paused = false;
      pauseEl.hidden = true;
      last = performance.now();
      if (!input.touch && pl.state === 'alive' && !g.playerNeedsDeploy) input.lock();
    };
    pauseEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-x]') as HTMLElement | null;
      if (!b) return;
      const x = b.dataset.x;
      if (x === 'resume') resume();
      else if (x === 'loadout') openLoadoutEditor(el, profile, profile.cls, () => deploy.refresh());
      else if (x === 'quit') confirmQuit();
    });
    pauseEl.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.s === 'sens') set.sens = Number(t.value);
      if (t.dataset.s === 'volume') { set.volume = Number(t.value); audio.setVolume(set.volume); }
      input.setSettings(set);
      saveProfile(profile);
    });
    const confirmQuit = () => {
      if (window.confirm('전투를 나갈까요? 이번 전투 기록은 남지 않습니다.')) finish(null);
    };
    const onLockChange = () => {
      // Esc 로 포인터 잠금이 풀리면 일시 정지
      if (!document.pointerLockElement && !input.touch && !paused && !g.over && pl.state === 'alive' && !g.playerNeedsDeploy) pause();
    };
    document.addEventListener('pointerlockchange', onLockChange);
    const onVis = () => { if (document.hidden) pause(); };
    document.addEventListener('visibilitychange', onVis);

    // ── 끝 ──
    let finished = false;
    const finish = (r: BattleResult | null) => {
      if (finished) return;
      finished = true;
      onExit(r);
    };
    const result = (): BattleResult => {
      const win = g.over ? g.over.winner === 0 : false;
      return {
        win, score: pl.score, kills: pl.kills, deaths: pl.deaths, assists: pl.assists, revives: pl.revives, caps: pl.caps, heads: pl.heads,
        xp: Math.round(pl.score + (win ? 600 : 250)), minutes: g.time / 60, reason: g.over?.reason ?? '',
      };
    };
    const showEnd = () => {
      endShown = true;
      input.setMode('hidden');
      if (document.pointerLockElement) document.exitPointerLock();
      deploy.close();
      const r = result();
      const endEl = q('.bt-end');
      endEl.hidden = false;
      endEl.innerHTML = `<div class="bt-card ${r.win ? 'win' : 'lose'}">
        <h2 class="display">${r.win ? '승리' : '패배'}</h2>
        <p class="bt-sub">${r.reason}</p>
        <dl class="bt-stats"><div><dt>점수</dt><dd>${r.score}</dd></div><div><dt>처치</dt><dd>${r.kills}</dd></div><div><dt>사망</dt><dd>${r.deaths}</dd></div><div><dt>소생</dt><dd>${r.revives}</dd></div><div><dt>점령</dt><dd>${r.caps}</dd></div><div><dt>경험치</dt><dd>+${r.xp}</dd></div></dl>
        <div class="bt-btns"><button class="primary" data-x="done">결과 보기</button></div></div>`;
      endEl.querySelector('[data-x=done]')?.addEventListener('click', () => finish(r));
    };

    // ── 입력 → 내 병사 ──
    const applyInput = (f: InputFrame) => {
      const c = pl.ctl;
      const sens = 1;
      c.yaw = wrapAngle(c.yaw - f.lookX * sens);
      c.pitch = clamp(c.pitch + f.lookY * sens, -1.45, 1.45);
      c.mx = f.mx; c.mz = f.mz;
      c.fire = f.fire; c.ads = f.ads; c.sprint = f.sprint;
      c.lift = f.lift;
      if (f.jump) c.jump = true;
      if (f.reload) c.reload = true;
      if (f.spot) c.spot = true;
      if (f.fireMode) c.fireMode = true;
      if (f.counter) c.counter = true;
      if (f.gadget >= 0) c.gadget = f.gadget;
      if (f.swap) c.switchTo = pl.cur === 0 ? 1 : 0;
      if (f.slot >= 0) c.switchTo = f.slot;
      const v = pl.vehicle >= 0 ? g.vehicles[pl.vehicle] : null;
      if (v) {
        // 차량 안: E 는 하차, 좌석 바꾸기
        c.interact = false;
        if (f.interactEdge) { c.exit = true; interactLatch = true; }
        if (f.seat === -2) c.seat = nextSeat(v, pl.seat);
        else if (f.seat >= 0) c.seat = f.seat;
      } else {
        if (interactLatch && !f.interact) interactLatch = false;
        c.interact = f.interact && !interactLatch;
        // 자세
        if (f.crouch) c.stance = c.stance === 'crouch' ? 'stand' : 'crouch';
        if (f.prone) c.stance = c.stance === 'prone' ? 'stand' : 'prone';
        if (f.sprint && f.mz > 0.3 && c.stance !== 'stand' && pl.sliding <= 0) c.stance = 'stand';
      }
      if (f.map) hud.toggleMap();
      boardKey(f.scoreboard);
      if (f.pause) pause();
    };
    // Tab 을 누르고 있는 동안만 점수판 (키 상태가 바뀔 때만 반응해서 터치 버튼으로 연 점수판을 닫지 않는다)
    let boardHeld = false;
    const boardKey = (held: boolean) => {
      if (held === boardHeld) return;
      boardHeld = held;
      showBoard = held;
      hud.showScoreboard(showBoard);
    };
    const nextSeat = (v: Vehicle, cur: number): number => {
      const n = VEHICLES[v.type].seats.length;
      for (let k = 1; k < n; k++) { const s = (cur + k) % n; if (v.seats[s] < 0) return s; }
      return -1;
    };
    const clearInput = () => {
      const c = pl.ctl;
      c.mx = 0; c.mz = 0; c.fire = false; c.ads = false; c.sprint = false; c.interact = false; c.lift = 0;
    };

    // 터치 버튼 글자와 상황
    const updateContext = () => {
      let interact: string | null = null;
      if (pl.state === 'alive' && pl.vehicle < 0) {
        const downed = g.soldiers.find((o) => o.team === pl.team && o.state === 'down' && Math.hypot(o.pos.x - pl.pos.x, o.pos.z - pl.pos.z) < 1.8);
        if (downed) interact = '소생';
        else {
          const v = nearestVehicle(g, pl, 4.5);
          if (v && v.alive && v.seats.some((x) => x < 0)) interact = '탑승';
        }
      }
      const gn = pl.gadgets.map((s) => GADGETS[s.id]?.name ?? '') as [string, string, string];
      const key = `${interact}|${gn.join(',')}`;
      if (key !== ctxKey) { ctxKey = key; input.setContext({ interact, gadgets: gn }); }
      let mode: 'infantry' | 'vehicle' | 'heli' | 'hidden' = 'infantry';
      if (paused || endShown || deploy.isOpen() || pl.state !== 'alive') mode = 'hidden';
      else if (pl.vehicle >= 0) mode = VEHICLES[g.vehicles[pl.vehicle].type].air && pl.seat === 0 ? 'heli' : 'vehicle';
      if (mode !== curMode) { curMode = mode; input.setMode(mode); }
    };
    let curMode = '';

    // ── 카메라 ──
    const baseFov = () => clamp(set.fov, 55, 100);
    const updateCamera = (dt: number) => {
      const w = pl.weapons[pl.cur];
      let fov = baseFov();
      if (pl.state === 'alive' && pl.vehicle < 0) {
        camPos.set(pl.pos.x, pl.pos.y + pl.eyeH, pl.pos.z);
        camYaw = pl.yaw + (w ? w.kickY : 0);
        camPitch = pl.pitch + (w ? w.kickP : 0);
        if (pl.held === 'weapon' && w) {
          const z = Math.max(1.12, w.st.zoom);
          const a = pl.ads * pl.ads * (3 - 2 * pl.ads);
          fov = (2 * Math.atan(Math.tan((fov * DEG) / 2) / lerp(1, z, a))) / DEG;
        }
        if (pl.sprinting) fov += 4;
        cam.position.copy(camPos);
        cam.rotation.set(camPitch, camYaw, pl.sliding > 0 ? 0.04 : 0, 'YXZ');
      } else if (pl.state === 'alive' && pl.vehicle >= 0) {
        const v = g.vehicles[pl.vehicle];
        const def = VEHICLES[v.type];
        const seat = def.seats[pl.seat];
        const chase = pl.seat === 0 || (def.air && pl.seat === 0);
        if (chase) {
          // 3인칭 추적: 조준 방향 뒤에서
          const back = Math.max(def.size.z * 1.25, 8) + (def.air ? 6 : 0);
          const up = def.size.y * 1.4 + (def.air ? 3 : 1.5);
          const d = dirFrom(pl.ctl.yaw, clamp(pl.ctl.pitch, -0.6, 0.5));
          const tgt = new THREE.Vector3(v.pos.x, v.pos.y + def.size.y * 0.8, v.pos.z);
          const want = new THREE.Vector3(tgt.x - d.x * back, tgt.y + up - d.y * back * 0.6, tgt.z - d.z * back);
          // 벽에 파묻히지 않게
          const dir = want.clone().sub(tgt);
          const L = dir.length();
          dir.normalize();
          const hit = raycast(g.world, { x: tgt.x, y: tgt.y, z: tgt.z }, { x: dir.x, y: dir.y, z: dir.z }, L, true);
          if (hit) want.copy(tgt).addScaledVector(dir, Math.max(1.5, hit.t - 0.6));
          camPos.lerp(want, damp(14, dt));
          cam.position.copy(camPos);
          const look = tgt.clone().add(new THREE.Vector3(d.x * 30, d.y * 30 + 1.5, d.z * 30));
          cam.lookAt(look);
          fov = baseFov() + 5;
          if (pl.ctl.ads && seat?.weapon) fov = baseFov() / 2.2;
        } else {
          const p = seatWorldPos(v, pl.seat);
          camPos.set(p.x, p.y, p.z);
          cam.position.copy(camPos);
          cam.rotation.set(pl.ctl.pitch, pl.ctl.yaw, 0, 'YXZ');
          if (pl.ctl.ads && seat?.weapon) fov = baseFov() / 2.5;
        }
      } else if (pl.state === 'down') {
        camPos.set(pl.pos.x, pl.pos.y + 0.35, pl.pos.z);
        cam.position.copy(camPos);
        cam.rotation.set(-0.1 + Math.sin(g.time * 0.7) * 0.03, pl.yaw, 0.35, 'YXZ');
      } else {
        // 죽었거나 배치 대기: 위에서 내려다본다
        const tgt = g.playerNeedsDeploy && pl.deadT > 3 ? deployFocus() : new THREE.Vector3(pl.pos.x, pl.pos.y, pl.pos.z);
        const want = new THREE.Vector3(tgt.x + 14, tgt.y + 34, tgt.z + 24);
        camPos.lerp(want, damp(2.2, dt));
        cam.position.copy(camPos);
        cam.lookAt(tgt);
      }
      if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = lerp(cam.fov, fov, damp(22, dt)); cam.updateProjectionMatrix(); }
    };
    const deployFocus = () => {
      const f = g.flags.find((x) => x.owner === 0) ?? null;
      const p = f ? f.pos : g.world.hq[0];
      return new THREE.Vector3(p.x, p.y, p.z);
    };

    // ── 루프 ──
    const frame = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!paused && !endShown) {
        // 배치 화면
        if (g.playerNeedsDeploy && !g.over && pl.deadT > 1.2) openDeploy();
        if (deploy.isOpen()) deploy.update(g, dt);
        const f = input.poll(pl.ads > 0.5, pl.weapons[pl.cur]?.st.zoom ?? 1);
        if (pl.state === 'alive' && !deploy.isOpen()) applyInput(f);
        else {
          clearInput();
          if (f.pause) pause();
          boardKey(f.scoreboard);
        }
        acc += dt;
        let n = 0;
        while (acc >= STEP && n < 5) { stepGame(g, STEP); acc -= STEP; n++; }
        if (n >= 5) acc = 0;
        const viewer = g.player;
        for (const e of g.events) {
          fx.event(e, g, viewer);
          audio.event(e, g, viewer);
          hud.event(e, g);
        }
        g.events.length = 0;
        if (g.over) { overT += dt; if (overT > 4 && !endShown) showEnd(); }
        updateContext();
        updateCamera(dt);
        wv.update(g, dt);
        actors.update(g, dt, g.player, cam);
        fx.update(g, dt);
        vm.update(g, pl, dt, { dx: f.lookX, dy: f.lookY });
        audio.listener({ x: cam.position.x, y: cam.position.y, z: cam.position.z }, camYawOf(), camPitch);
        audio.update(g, dt, viewer);
      }
      const r = el.getBoundingClientRect();
      hud.update(g, dt, cam, { w: r.width, h: r.height }, vm.scope());
      wv.render();
      if (pl.state === 'alive' && pl.vehicle < 0 && !vm.scope().active) vm.render(wv.renderer);
      // FPS
      if (set.showFps) {
        fpsAcc += dt; fpsN++;
        if (fpsAcc >= 0.5) { fpsEl.textContent = `${Math.round(fpsN / fpsAcc)} fps`; fpsAcc = 0; fpsN = 0; }
      }
    };
    const camYawOf = () => cam.rotation.y;
    raf = requestAnimationFrame(frame);

    // 배치 화면부터
    openDeploy();
    void CLASSES;

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('visibilitychange', onVis);
      if (document.pointerLockElement) document.exitPointerLock();
      input.dispose(); audio.dispose(); hud.dispose(); deploy.dispose(); fx.dispose(); vm.dispose(); actors.dispose(); wv.dispose();
    };
  }

  return () => {
    disposed = true;
    window.clearTimeout(boot);
    cancelAnimationFrame(raf);
    cleanup?.();
    el.remove();
  };
}
