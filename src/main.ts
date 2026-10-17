// 飞跃收费站 (RDSTR Toll Jump): game loop and glue.
// Frame rules: renderer.setAnimationLoop, dt clamped to 1/30, all smoothing frame-rate independent, and no
// allocations in the frame loop (module-scope scratch objects and pools only).
import * as THREE from 'three';
import { ARENA, CAR, EXIT, GLB, KMH, PHYS, PLAZA, QUALITY, WALL } from './config';
import { carBox, isNearMiss, makeBox, overlaps, type Box } from './sim/collision';
import { exitGateZ, exitRampX, exitRightExtra, exitZ, nearestExit, nearestPlaza, plazaZ, roadHalfWidth } from './sim/course';
import {
  addAirTime, addDistance, addEtc, addNearMiss, addRoll, addStunt, addToll, loadBest, saveBest, totalScore,
  tollsSkipped,
} from './sim/score';
import { downforceKN, stepSuction, suctionActive, toggleSuction } from './sim/suction';
import { resetTollTracker, tollPrice, updateToll, type TollOutcome } from './sim/toll';
import { applyBoomHit, applyCrash, createInput, forwardSpeed, stepVehicle } from './sim/vehicle';
import { createRun, resetRun as resetRunState, START_SPEED, type Place } from './sim/run';
import { createWallState, stepWall, tryAttach, wallFrameBoxes } from './sim/wall';
import { Arena } from './render/arena';
import { Debris } from './render/debris';
import { createEnvMap, createLights, createSky, createStudio, followMoon, FOG_COLOR, FOG_DENSITY } from './render/environment';
import { ExitRamp } from './render/exitRamp';
import { Post } from './render/post';
import { CameraRig, type CamMode } from './render/camera';
import { Road } from './render/road';
import { Roadster, glbExists, loadGlbCar, type CarModel } from './render/roadster';
import { SmokeSystem } from './render/smoke';
import { Thrusters } from './render/thrusters';
import { TollPlaza } from './render/tollPlaza';
import { makeAlphaTexture, makeGlowTexture, makePoolTexture } from './render/textures';
import { Traffic } from './render/traffic';
import { GameAudio } from './ui/audio';
import { Hud, type HudState } from './ui/hud';
import { getLang, onLang, setLang, SIGNS, t, toggleLang, type Lang } from './ui/i18n';
import { Input } from './ui/input';
import { Screens, type RunStats } from './ui/screens';

// ------------------------------------------------------------------ setup
const params = new URLSearchParams(location.search);
const qParam = params.get('quality');
const Q = QUALITY[qParam === 'low' ? 'low' : qParam === 'high' ? 'high' : 'normal'];
const DEBUG = params.has('debug');
const COMPARE = params.has('compare');
const CAR_MODE = params.get('car'); // 'glb' | 'procedural' | null (auto-detect)
const LANG_PARAM = params.get('lang');
if (LANG_PARAM === 'zh' || LANG_PARAM === 'en') setLang(LANG_PARAM);
if (COMPARE) document.body.classList.add('compare');

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setClearColor(0x000000, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.info.autoReset = false;

let W = window.innerWidth;
let H = window.innerHeight;
let dpr = Math.min(window.devicePixelRatio || 1, Q.dprCap);
const DPR_MAX = dpr;
renderer.setPixelRatio(dpr);
renderer.setSize(W, H, false);

const scene = new THREE.Scene();
const fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
scene.fog = fog;
createEnvMap(renderer); // assigned per material (see environment.ts)

const lights = createLights(scene, Q.shadow);
const sky = createSky();
scene.add(sky.group);
const studio = createStudio();
scene.add(studio.group);

const world = new THREE.Group(); // the highway
scene.add(world);
const road = new Road();
world.add(road.group);
const traffic = new Traffic();
world.add(traffic.group);
const plaza = new TollPlaza();
world.add(plaza.group);
const exitKit = new ExitRamp(road.roadMat);
world.add(exitKit.group);
const arena = new Arena(road.roadMat); // the stunt arena: a separate scene with no traffic
scene.add(arena.group);

const roadster = new Roadster();
scene.add(roadster.group);
const smoke = new SmokeSystem(Q.particles);
scene.add(smoke.mesh);
const thrusters = new Thrusters(smoke, lights.thruster);
scene.add(thrusters.group);
const debris = new Debris();
scene.add(debris.mesh);

// decals under and around the car
const flat = new THREE.PlaneGeometry(1, 1);
flat.rotateX(-Math.PI / 2);
const additive = (map: THREE.Texture, c: THREE.Color) =>
  new THREE.MeshBasicMaterial({ map, color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
const blob = new THREE.Mesh(flat, new THREE.MeshBasicMaterial({
  map: makeAlphaTexture(64, (x, y) => Math.pow(Math.max(0, 1 - Math.hypot(x, y)), 1.1)),
  color: 0x000000, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3,
}));
blob.renderOrder = 2;
const headPool = new THREE.Mesh(flat, additive(makePoolTexture(128), new THREE.Color(0.42, 0.52, 0.8)));
headPool.renderOrder = 1;
const tailPool = new THREE.Mesh(flat, additive(makeGlowTexture(64, 1.6), new THREE.Color(0.2, 0.014, 0.01)));
tailPool.renderOrder = 1;
const boostPool = new THREE.Mesh(flat, additive(makeGlowTexture(64, 1.5), new THREE.Color(0.28, 0.55, 1.0))); // the road lights up behind the boost jets
boostPool.renderOrder = 1;
scene.add(blob, headPool, tailPool, boostPool);

const rig = new CameraRig(W / H);
const post = new Post(renderer, scene, rig.camera, W, H, dpr, Q.msaa, Q.bloom);
const input = new Input(window);
if (params.has('touch') || window.matchMedia('(pointer: coarse)').matches) input.attachTouch(document.getElementById('touch')!);
const audio = new GameAudio();
audio.unlockOnGesture();
const hud = new Hud();
const screens = new Screens({ onStart: () => startGame(), onResume: () => setPaused(false), onRestart: () => startGame(), onLang: () => toggleLang() });
onLang(() => { hud.applyLang(); screens.applyLang(); });

const fadeEl = document.getElementById('fade')!;
const fadeC1 = fadeEl.querySelector('.c1') as HTMLElement;
const fadeC2 = fadeEl.querySelector('.c2') as HTMLElement;

// ------------------------------------------------------------------ game state
type Phase = 'loading' | 'menu' | 'playing' | 'paused' | 'over';
let phase: Phase = 'loading';
let studioOn = true;
// the whole state of the run lives in `run` (src/sim/run.ts): a start and a restart go through the same code
const run = createRun();
const { veh, wall, wev, ev, vin, suction, score, toll, tres, fade } = run;
const carB = makeBox();
const tb = makeBox();
const frameBoxes: Box[] = Array.from({ length: 24 }, makeBox);
const highwayWorld = { halfWidth: roadHalfWidth, rightExtra: exitRightExtra };
const arenaWorld = { halfWidth: () => ARENA.halfX };
let best = loadBest();
let time = 0;
let wheelSpin = 0;
let exitIdx = 0;
let hoverTarget: number | null = null; // debug: bang-bang altitude hold
let frozen = false; // debug: stop the sim but keep rendering (for exact-instant screenshots)
let pendingCar: CarModel | null = null;
const rcs = new Float32Array(4);
const eul = new THREE.Euler();
const tmpV = new THREE.Vector3();
const STUDIO_DIR = new THREE.Vector3(-0.75, 0.5, -0.42).normalize();
const hudState: HudState = {
  score: 0, lives: 3, saved: 0, kmh: 0, gas01: 1, gForce: 1, altFt: 0, pitch: 0, roll: 0, yaw: 0, sucOn: false, downforceKN: 0, warn: false,
};

const pop = (text: string, kind: 'good' | 'bad' | 'info' | 'big' = 'good') => hud.popup(text, kind);

function applyPlace(): void {
  world.visible = !studioOn && run.place === 'highway';
  arena.group.visible = !studioOn && run.place === 'arena';
  sky.group.visible = !studioOn;
  studio.group.visible = studioOn;
  blob.visible = headPool.visible = tailPool.visible = boostPool.visible = !studioOn;
}

function setMode(mode: 'menu' | 'game'): void {
  studioOn = mode === 'menu';
  applyPlace();
  fog.density = studioOn ? 0 : FOG_DENSITY;
  lights.moon.intensity = studioOn ? 0.85 : 0.6;
  renderer.setClearColor(studioOn ? 0x060709 : 0x000000, 1);
  lights.moon.color.set(studioOn ? 0xfff1e4 : 0xb4caff);
  lights.hemi.intensity = studioOn ? 0.14 : 0.3;
  renderer.toneMappingExposure = studioOn ? 0.92 : 1.15;
}

function runStats(): RunStats {
  return {
    score: totalScore(score), best, distance: score.distance, tolls: tollsSkipped(score), saved: score.saved, fines: score.fines,
    stunts: score.stunts, newBest: run.newBest,
  };
}

function resetVehicleForPlace(): void {
  veh.vx = 0; veh.vy = 0; veh.y = 0;
  veh.dir = 1; veh.heading = 0;
  veh.mode = 'free'; veh.grounded = true;
  veh.flipping = false; veh.flipT = 0;
  veh.pitch = 0; veh.roll = 0; veh.yaw = 0; veh.steer = 0;
  veh.barrelT = 0; veh.barrel = 0; veh.assist = 0; veh.righting = 0; veh.burnLatched = false;
  veh.thrustLevel = 0; veh.boostLevel = 0; veh.burn = 0;
}

/** Switch scene right now (the fade calls this at full black). The car keeps its speed. */
function switchPlace(to: Place, speed: number): void {
  resetVehicleForPlace();
  if (to === 'arena') {
    exitIdx = nearestExit(veh.z);
    run.place = 'arena';
    veh.x = 0;
    veh.z = ARENA.spawnZ;
    veh.vz = -Math.min(Math.max(speed, 12), ARENA.speedLimit);
    Object.assign(wall, createWallState());
    run.stuntPending = false;
  } else {
    run.place = 'highway';
    veh.x = 5.6;
    veh.z = exitZ(exitIdx) - EXIT.length - EXIT.mergeBack; // the on-ramp merge
    veh.vz = -Math.max(speed, 18);
    traffic.reset(veh.z);
    resetTollTracker(toll, nearestPlaza(veh.z));
    plaza.place(nearestPlaza(veh.z), toll);
    road.update(veh.z);
    exitKit.update(veh.z);
    run.stuntPending = false;
  }
  smoke.clear();
  debris.clear();
  thrusters.reset();
  applyPlace();
  syncCar();
  rig.snap(veh);
}

function startTransition(to: Place): void {
  if (fade.phase !== 0) return;
  fade.phase = 1;
  fade.t = 0;
  fade.to = to;
  fade.speed = Math.max(0, forwardSpeed(veh));
  const [c1, c2] = to === 'arena' ? SIGNS.arena : SIGNS.backOn;
  fadeC1.textContent = c1;
  fadeC2.textContent = c2;
}

function stepFade(dt: number): void {
  fade.t += dt;
  if (fade.phase === 1) {
    fadeEl.style.opacity = String(Math.min(1, fade.t / 0.45));
    if (fade.t >= 0.45) {
      fadeEl.style.opacity = '1';
      switchPlace(fade.to, fade.speed);
      fadeEl.classList.add('card');
      fade.phase = 2;
      fade.t = 0;
    }
  } else if (fade.phase === 2) {
    if (fade.t >= (fade.to === 'arena' ? 1.3 : 0.5)) {
      fadeEl.classList.remove('card');
      fade.phase = 3;
      fade.t = 0;
    }
  } else if (fade.phase === 3) {
    fadeEl.style.opacity = String(1 - Math.min(1, fade.t / 0.5));
    if (fade.t >= 0.5) {
      fadeEl.style.opacity = '0';
      fade.phase = 0;
      if (fade.to === 'arena') pop(t('popup.arenaHint'), 'info');
    }
  }
}

/** A start and a restart are the same thing: everything goes back to the first frame of a new game. */
function resetRun(): void {
  resetRunState(run); // vehicle, wall, suction, score, lives, toll, place, fade and timers (src/sim/run.ts)
  fadeEl.style.opacity = '0';
  fadeEl.classList.remove('card');
  wheelSpin = 0;
  hoverTarget = null;
  input.forceThrust = null;
  input.releaseHeld(); // a key still down from the last run (W, Shift) must not drive the new one
  smoke.clear();
  debris.clear();
  thrusters.reset();
  traffic.reset(0);
  road.update(0);
  plaza.place(nearestPlaza(0), toll);
  exitKit.update(0);
  rig.reset(veh);
  applyPlace();
  syncCar();
  hud.reset();
}

function startGame(): void {
  if (phase === 'loading') return;
  settle = 0;
  audio.start();
  resetRun();
  setMode('game');
  screens.showStart(false);
  screens.showPause(false);
  screens.showOver(false);
  hud.show(true);
  phase = 'playing';
}

function setPaused(p: boolean): void {
  if (p && phase === 'playing') {
    phase = 'paused';
    screens.showPause(true, runStats());
  } else if (!p && phase === 'paused') {
    phase = 'playing';
    screens.showPause(false);
  }
}

function gameOver(): void {
  phase = 'over';
  const total = totalScore(score);
  run.newBest = total > best;
  if (run.newBest) best = total;
  saveBest(total);
  screens.showOver(true, runStats());
}

// ------------------------------------------------------------------ sim
function crash(label: string): void {
  if (veh.invuln > 0 || phase !== 'playing') return;
  applyCrash(veh);
  run.lives--;
  score.crashes++;
  rig.addTrauma(0.95);
  debris.sparks(veh.x, veh.y + 0.5, veh.z, veh.vx, 3, veh.vz, 40);
  thrusters.puffAt(veh.x, veh.y + 0.6, veh.z, 16, 6);
  audio.crash();
  hud.flash();
  pop(label, 'bad');
  if (run.lives <= 0 && run.overTimer === 0) run.overTimer = 0.0001;
}

function onToll(o: TollOutcome): void {
  const price = tres.price;
  switch (o) {
    case 'flyover':
      addToll(score, 'flyover', price);
      pop(t('popup.flyover', price), 'big');
      audio.chime();
      rig.addTrauma(0.12);
      break;
    case 'jump':
      addToll(score, 'jump', price);
      pop(t('popup.jump', price), 'good');
      audio.chime();
      break;
    case 'etc': // the normal, legal way through: the boom lifts, the fee is paid
      addEtc(score, price);
      pop(t('popup.etc', price), 'info');
      audio.chime();
      break;
    case 'ram':
      addToll(score, 'ram', price, PLAZA.fine);
      applyBoomHit(veh);
      plaza.breakBoom(tres.lane, tmpV);
      debris.pieces(tmpV.x, 1.0, tmpV.z, 14, 9);
      debris.sparks(tmpV.x, 0.9, tmpV.z, 0, 2, 0, 12);
      thrusters.puffAt(tmpV.x, 0.8, tmpV.z, 8, 5);
      audio.boom();
      rig.addTrauma(0.6);
      hud.flash();
      pop(t('popup.ram', PLAZA.fine), 'bad');
      break;
    case 'crash':
      crash(t('popup.crash'));
      break;
    default:
  }
}

function clearEv(): void {
  ev.landed = ev.landedMidRoll = ev.barrierHit = ev.rollStarted = ev.rollCompleted = ev.flipFinished = ev.liftoff = ev.burnStarted = false;
}

function simStep(dt: number): void {
  vin.throttle = input.throttle;
  vin.brake = input.brake;
  vin.steer = input.steer;
  if (hoverTarget !== null) input.forceThrust = veh.y < hoverTarget;
  vin.thrust = input.thrust;
  vin.boost = input.boost;
  vin.roll = input.rollPulse;
  vin.detach = input.detachPulse;
  stepSuction(suction, dt);
  veh.suction = suction.level;
  const sucOn = suctionActive(suction);
  const prevZ = veh.z;
  const arenaOn = run.place === 'arena';

  if (arenaOn && veh.mode === 'free' && veh.grounded && !veh.flipping && forwardSpeed(veh) > ARENA.speedLimit) {
    veh.vz = -ARENA.speedLimit * veh.dir; // the arena has a speed limiter, so the tip launch stays a stunt
  }
  if (veh.mode === 'wall') {
    stepWall(veh, wall, vin, sucOn, dt, wev);
    clearEv();
  } else {
    stepVehicle(veh, vin, dt, arenaOn ? arenaWorld : highwayWorld, ev);
    if (arenaOn) {
      stepWall(veh, wall, vin, sucOn, dt, wev); // cooldown bookkeeping while free
      if (veh.z < WALL.z + 3 && veh.z > WALL.z - 30 && tryAttach(veh, wall, prevZ, wev)) {
        audio.land(0.3);
        rig.addTrauma(0.12);
      }
    }
  }
  if (wev.detached && wev.reason !== 'base') {
    run.stuntPending = true;
    pop(t('popup.detach'), 'big');
    rig.addTrauma(0.2);
    audio.blip();
  }

  // ----- collisions and events (not while on the wall)
  if (veh.mode === 'free') {
    carBox(carB, veh.x, veh.y, veh.z);
    const f = forwardSpeed(veh);
    if (!arenaOn) {
      for (let i = 0; i < traffic.n; i++) {
        if (Math.abs(traffic.z[i] - veh.z) > 14) continue;
        traffic.box(i, tb);
        if (veh.invuln <= 0 && overlaps(carB, tb)) { crash(t('popup.crash')); break; }
        if (!traffic.nearMissed[i] && isNearMiss(carB, tb, f)) {
          traffic.nearMissed[i] = 1;
          addNearMiss(score);
          pop(t('popup.nearMiss'), 'info');
        }
      }
      const o = updateToll(toll, carB, prevZ, tres);
      if (o !== 'none') onToll(o);
      if (tres.curb) {
        // grazing an island curb only deflects the car, with a small speed loss
        veh.x += tres.pushX;
        veh.vx = Math.sign(tres.pushX) * Math.min(1.5, Math.abs(veh.vx));
        if (tres.curbFresh) {
          veh.vz *= 0.94;
          debris.sparks(veh.x - Math.sign(tres.pushX) * 0.95, 0.15, veh.z, veh.vx, 1, veh.vz, 10);
          audio.scrape();
          rig.addTrauma(0.18);
        }
      }
      // the exit to the stunt arena: through the gate at the end of the ramp
      const ei = nearestExit(veh.z);
      const gz = exitGateZ(ei);
      if (prevZ > gz && veh.z <= gz && veh.y < 5 && Math.abs(veh.x - exitRampX(ei, gz)) < EXIT.width / 2 + 0.8) startTransition('arena');
    } else {
      // the wall's rails and truss (the AABB assumes a level car, so skip it while the car is still flipping level)
      if (veh.righting <= 0 && wall.cooldown <= 0 && !veh.flipping) {
        const n = wallFrameBoxes(frameBoxes);
        for (let k = 0; k < n; k++) {
          if (veh.invuln <= 0 && overlaps(carB, frameBoxes[k])) { crash(t('popup.crash')); break; }
        }
      }
      if (veh.z < ARENA.zMin) { veh.z = ARENA.zMin; veh.vz = 0; }
      // driving out through the venue gate (the car faces +Z after the stunt) fades back to the highway
      if (veh.dir < 0 && veh.z >= ARENA.gateZ && veh.grounded && f > 3) startTransition('highway');
    }
    if (ev.barrierHit) {
      debris.sparks(veh.x + Math.sign(veh.x) * 1.0, 0.45, veh.z, veh.vx, 1, veh.vz, 14);
      audio.scrape();
      rig.addTrauma(Math.min(0.5, ev.barrierSpeed * 0.04));
    }
    if (ev.landed) {
      const strength = Math.min(1, ev.impactSpeed / 12);
      if (ev.landedMidRoll) {
        crash(t('popup.rollCrash'));
      } else {
        if (veh.burn > 0.12 || ev.impactSpeed > 4.5) thrusters.landingBurst(veh.x, veh.z, 0.55 + 0.45 * strength);
        if (run.stuntPending && arenaOn && veh.dir < 0) {
          // up the wall, off the tip, flipped and turned around, and down facing the other way
          run.stuntPending = false;
          addStunt(score);
          pop(t('popup.stunt'), 'big');
          audio.chime();
          rig.addTrauma(0.3);
        } else if (ev.impactSpeed < 6.5 && run.lives > 0 && !arenaOn) {
          pop(t('popup.landing'), 'info');
        }
      }
      audio.land(strength);
      rig.addTrauma(0.1 + 0.3 * strength);
    }
    if (ev.rollCompleted) {
      addRoll(score);
      pop(t('popup.roll'), 'good');
    }
    if (!veh.grounded) addAirTime(score, dt);
  }
  if (!arenaOn && veh.z < prevZ) addDistance(score, prevZ - veh.z);

  if (run.overTimer > 0) {
    run.overTimer += dt;
    if (run.overTimer > 1.1) { run.overTimer = 0; gameOver(); }
  }
}

// ------------------------------------------------------------------ visuals
function syncCar(): void {
  const g = roadster.group;
  g.position.set(veh.x, veh.y - veh.squat, veh.z);
  eul.set(veh.pitch, veh.yaw + veh.heading, veh.roll + veh.barrel, 'YXZ');
  g.quaternion.setFromEuler(eul);
  g.updateMatrixWorld(true);
}

function computeRcs(now: number): void {
  rcs[0] = rcs[1] = rcs[2] = rcs[3] = 0;
  if (veh.mode !== 'free') return;
  if (veh.barrelT > 0) {
    const p = 0.55 + 0.45 * Math.sin(now * 30);
    if (veh.barrelDir > 0) { rcs[0] = p; rcs[3] = p; } else { rcs[2] = p; rcs[1] = p; }
  }
  if (veh.flipping || veh.righting > 0) {
    // the flip: RCS puffs in several directions as the car rights itself and turns around
    const k = veh.flipping ? 1 : Math.min(1, veh.righting / 0.5);
    for (let i = 0; i < 4; i++) rcs[i] = Math.max(rcs[i], k * (0.5 + 0.5 * Math.sin(now * 26 + i * 1.9)));
  }
  if (!veh.grounded && veh.thrustLevel > 0.5 && Math.abs(veh.steer) > 0.3) {
    const s = veh.steer > 0 ? 0 : 2;
    rcs[s] = Math.max(rcs[s], 0.6);
    rcs[s + 1] = Math.max(rcs[s + 1], 0.6);
  }
}

function updateVisuals(dt: number, now: number): void {
  const onWall = veh.mode === 'wall';
  const arenaOn = run.place === 'arena';
  syncCar();
  const g = roadster.group;
  g.visible = veh.invuln <= 0 || ((now * 12) | 0) % 2 === 0;
  const fs = onWall ? wall.ds : forwardSpeed(veh);
  wheelSpin += (fs / CAR.wheelRadius) * dt;
  const model = roadster.model;
  model.setWheels(wheelSpin, veh.steer * 0.42);
  model.setLights(phase === 'playing' ? input.brake : 0, veh.boostLevel);

  const down = onWall ? 0 : Math.max(veh.thrustLevel, veh.burn);
  const stunt = arenaOn && (veh.flipping || (veh.mode === 'free' && !veh.grounded && run.stuntPending));
  rig.update(dt, veh, fs, veh.boostLevel, down, stunt);
  rig.camera.updateMatrixWorld();
  followMoon(lights.moon, veh.x, veh.y, veh.z);

  computeRcs(now);
  const sucFx = suction.level * (onWall ? 1 : Math.min(1, Math.abs(fs) / 25));
  thrusters.update(dt, now, {
    model, carMatrix: g.matrixWorld, vx: veh.vx, vy: veh.vy, vz: veh.vz, down, boost: veh.boostLevel, rcs, suction: sucFx,
  });
  const hw0 = arenaOn ? 80 : roadHalfWidth(veh.z);
  smoke.update(
    dt, rig.camera,
    { x: thrusters.lightPos.x, y: thrusters.lightPos.y, z: thrusters.lightPos.z, intensity: thrusters.lightLevel * 2.6 },
    hw0, arenaOn ? 0 : (roadHalfWidth(veh.z + 8) - roadHalfWidth(veh.z - 8)) / 16, veh.z,
  );
  debris.update(dt);

  // decals: the blob shadow is an altitude cue; the pools light the road around the car
  const alt = veh.y;
  const d = veh.dir;
  const bs = 1 + alt * 0.07;
  blob.visible = !onWall && alt < 26;
  blob.position.set(veh.x, 0.03, veh.z);
  blob.scale.set(5.6 * bs, 1, 2.9 * bs);
  blob.rotation.y = veh.yaw + veh.heading;
  (blob.material as THREE.MeshBasicMaterial).opacity = 0.82 * Math.max(0, 1 - alt / 22);
  const near = onWall ? 0 : Math.max(0, 1 - alt / 7);
  headPool.position.set(veh.x, 0.03, veh.z - 19 * d);
  headPool.scale.set(13, 1, 42);
  (headPool.material as THREE.MeshBasicMaterial).opacity = 0.3 * near;
  tailPool.position.set(veh.x, 0.03, veh.z + 4.5 * d);
  tailPool.scale.set(5, 1, 6);
  (tailPool.material as THREE.MeshBasicMaterial).opacity = (0.45 + input.brake * 0.55) * near;
  boostPool.position.set(veh.x, 0.035, veh.z + 13 * d);
  boostPool.scale.set(7, 1, 24);
  (boostPool.material as THREE.MeshBasicMaterial).opacity = 0.75 * veh.boostLevel * Math.max(0.25, near);

  // the world follows
  if (!arenaOn) {
    road.update(veh.z);
    traffic.update(dt, veh.z);
    plaza.update(veh.z, veh.x, toll, dt);
    exitKit.update(veh.z);
  } else {
    arena.update(now);
  }
  sky.update(rig.camera.position);
  post.setSpeed(Math.min(1, Math.max(0, fs) / PHYS.topSpeed));

  // HUD and audio
  hudState.score = totalScore(score);
  hudState.lives = run.lives;
  hudState.saved = score.saved;
  hudState.kmh = Math.abs(fs) / KMH;
  hudState.gas01 = veh.gas;
  hudState.gForce = veh.gForce;
  hudState.altFt = veh.y * 3.2808;
  hudState.pitch = veh.pitch;
  hudState.roll = veh.roll + veh.barrel;
  hudState.yaw = veh.yaw;
  hudState.sucOn = suction.on;
  hudState.downforceKN = onWall ? wall.downforce : downforceKN(suction.level, Math.abs(fs));
  hudState.warn = onWall && wall.warn;
  hud.update(dt, hudState);
  audio.update(now, Math.min(1, Math.abs(fs) / PHYS.topSpeed), Math.max(down, veh.boostLevel), veh.boostLevel, sucFx, Math.min(1, Math.abs(wall.ds) / 26));
}

// ------------------------------------------------------------------ perf
const FT_N = 600;
const ft = new Float32Array(FT_N);
let ftHead = 0;
let ftCount = 0;
let ema = 16.7;
let lastNow = 0;
let lastPerf = 0;
let dprCheck = 0;
let settle = 0; // frames since the run started: the first seconds are noisy, never adapt in them
let fastChecks = 0;
let overlayAcc = 0;
const sortBuf = new Float32Array(FT_N);
const debugEl = document.getElementById('debug')!;
if (DEBUG) debugEl.classList.remove('hidden');

function perfReport(frames = FT_N): { avg: number; p95: number; p99: number; max: number; fps: number; n: number } {
  const n = Math.min(frames, ftCount);
  for (let i = 0; i < n; i++) sortBuf[i] = ft[(ftHead - 1 - i + FT_N * 2) % FT_N];
  const s = sortBuf.subarray(0, n).sort();
  let sum = 0;
  for (let i = 0; i < n; i++) sum += s[i];
  const avg = n ? sum / n : 0;
  return { avg, p95: s[Math.floor(n * 0.95)] ?? 0, p99: s[Math.floor(n * 0.99)] ?? 0, max: s[n - 1] ?? 0, fps: avg ? 1000 / avg : 0, n };
}

function applyDpr(next: number): void {
  dpr = next;
  renderer.setPixelRatio(dpr);
  renderer.setSize(W, H, false);
  post.setSize(W, H, dpr);
}

function adaptDpr(ms: number): void {
  ema += (Math.min(ms, 50) - ema) * 0.04;
  if (++settle < 240) return;
  if (++dprCheck < 90) return;
  dprCheck = 0;
  if (phase === 'loading') return;
  if (ema > 18.5 && dpr > 0.75) { fastChecks = 0; applyDpr(Math.max(0.75, dpr - 0.125)); }
  else if (ema < 13.8 && dpr < DPR_MAX) { if (++fastChecks >= 4) { fastChecks = 0; applyDpr(Math.min(DPR_MAX, dpr + 0.125)); } }
  else fastChecks = 0;
}

// ------------------------------------------------------------------ warm-up (nothing compiles mid-run)
function warmup(): void {
  const wasPhase = phase;
  const vis = { world: world.visible, arena: arena.group.visible, sky: sky.group.visible, studio: studio.group.visible };
  world.visible = true;
  arena.group.visible = true;
  sky.group.visible = true;
  studio.group.visible = true;
  blob.visible = headPool.visible = tailPool.visible = boostPool.visible = true;
  plaza.forceVisible(-24);
  exitKit.forceVisible(-40);
  const keep = { x: veh.x, y: veh.y, z: veh.z };
  veh.x = 0; veh.y = 2.5; veh.z = 0;
  syncCar();
  rig.camera.position.set(0, 3.4, 9);
  rig.camera.lookAt(0, 1.5, -12);
  rig.camera.updateMatrixWorld();
  road.update(0);
  const g = roadster.group;
  const full = new Float32Array(4).fill(1);
  for (let k = 0; k < 3; k++) {
    thrusters.update(1 / 60, k * 0.1, {
      model: roadster.model, carMatrix: g.matrixWorld, vx: 0, vy: 0, vz: -20, down: 1, boost: 1, rcs: full, suction: 1,
    });
    for (let i = 0; i < 40; i++) smoke.spawn(Math.random() * 4 - 2, 0.5 + Math.random() * 3, -Math.random() * 10, 0, 0, 0, 0.3, 2, 3, 0.5, 1, 0, 0, 0.5);
    smoke.update(1 / 60, rig.camera, { x: 0, y: 1, z: 0, intensity: 2 }, 10.5, 0, 0);
    debris.sparks(0, 1, -4, 0, 2, 0, 6);
    debris.update(1 / 60);
  }
  renderer.compile(scene, rig.camera);
  for (let k = 0; k < 3; k++) {
    rig.camera.updateMatrixWorld();
    post.render(1 / 60, k);
  }
  // the arena has its own camera position: render it once too
  world.visible = false;
  rig.camera.position.set(0, 6, WALL.z + 22);
  rig.camera.lookAt(0, 8, WALL.z - 8);
  rig.camera.updateMatrixWorld();
  post.render(1 / 60, 9);
  // restore
  smoke.clear();
  debris.clear();
  thrusters.reset();
  veh.x = keep.x; veh.y = keep.y; veh.z = keep.z;
  world.visible = vis.world;
  arena.group.visible = vis.arena;
  sky.group.visible = vis.sky;
  studio.group.visible = vis.studio;
  phase = wasPhase;
  syncCar();
  roadster.model.setNozzleGlow(new Float32Array(10));
  roadster.model.setUnderGlow(0);
}

// ------------------------------------------------------------------ the car model (procedural, or an optional GLB)
async function initCar(): Promise<void> {
  const url = import.meta.env.BASE_URL + GLB.url;
  try {
    const use = CAR_MODE === 'glb' || (CAR_MODE !== 'procedural' && (await glbExists(url, GLB.probeTimeoutMs)));
    if (!use) return;
    const m = await loadGlbCar(url);
    if (phase === 'playing') { pendingCar = m; return; }
    swapCar(m);
  } catch (e) {
    console.warn('[car] GLB not used, keeping the procedural car:', e);
  }
}

function swapCar(m: CarModel): void {
  const old = roadster.swap(m);
  old.dispose();
  syncCar();
  warmup(); // the new materials must be compiled before they are seen
  console.info('[car] using', m.kind, 'model');
}

// ------------------------------------------------------------------ main loop
function teleport(z: number): void {
  if (run.place !== 'highway') switchPlace('highway', 30);
  if (veh.mode === 'wall') { wall.attached = false; veh.mode = 'free'; veh.grounded = true; veh.y = 0; veh.pitch = 0; }
  veh.z = z;
  resetTollTracker(toll, nearestPlaza(z));
  traffic.reset(z);
  smoke.clear();
  road.update(z);
  plaza.update(z, veh.x, toll, 0.016);
  exitKit.update(z);
  syncCar();
  rig.snap(veh);
}

function frame(nowMs: number): void {
  const now = nowMs / 1000;
  let dt = lastNow === 0 ? 1 / 60 : now - lastNow;
  const realDt = dt;
  lastNow = now;
  dt = Math.min(Math.max(dt, 0.0005), 1 / 30);
  time += dt;
  renderer.info.reset();

  input.poll();
  if (input.anyKey) { audio.start(); input.anyKey = false; }
  if (input.mutePulse) { hud.muted(audio.toggleMute()); }
  if (input.langPulse) toggleLang();
  if (document.hidden && phase === 'playing') setPaused(true);

  if (phase === 'menu') {
    if (input.startPulse && !COMPARE) startGame();
  } else if (phase === 'playing') {
    if (input.pausePulse) setPaused(true);
    else if (input.restartPulse) startGame();
    else if (input.cameraPulse) { const m = rig.cycle(); hud.camera(t(`cam.${m}` as 'cam.chase')); }
    if (input.suctionPulse && fade.phase === 0) {
      const on = toggleSuction(suction);
      pop(on ? t('popup.suctionOn') : t('popup.suctionOff'), 'info');
      audio.blip();
    }
  } else if (phase === 'paused') {
    if (input.pausePulse) setPaused(false);
    else if (input.restartPulse) startGame();
  } else if (phase === 'over') {
    if (input.restartPulse || input.startPulse) startGame();
  }

  if (fade.phase !== 0) stepFade(dt);

  if (phase === 'playing') {
    const slow = run.overTimer > 0 ? 0.55 : 1;
    if ((fade.phase === 0 || fade.phase === 3) && !frozen) simStep(dt * slow);
    updateVisuals(fade.phase === 1 || fade.phase === 2 || frozen ? 0.0001 : dt * slow, time);
  } else if (phase === 'paused') {
    updateVisuals(0.0001, time);
  } else if (phase === 'over') {
    updateVisuals(dt * 0.6, time);
  } else {
    // loading / menu: the studio, the car turning slowly in the spotlight
    syncCar();
    roadster.group.visible = true;
    roadster.model.setWheels(0, 0);
    roadster.model.setLights(0, 0);
    rig.studio(time, COMPARE);
    rig.camera.updateMatrixWorld();
    followMoon(lights.moon, 0, 0, 0, STUDIO_DIR);
    sky.update(rig.camera.position);
  }

  post.render(dt, time);

  // frame-time statistics and the adaptive pixel ratio
  if (lastPerf !== 0) {
    const ms = nowMs - lastPerf;
    ft[ftHead] = ms;
    ftHead = (ftHead + 1) % FT_N;
    if (ftCount < FT_N) ftCount++;
    if (realDt < 0.25) adaptDpr(ms);
  }
  lastPerf = nowMs;
  input.endFrame();

  if (DEBUG) {
    overlayAcc += realDt;
    if (overlayAcc > 0.25) {
      overlayAcc = 0;
      const r = perfReport(120);
      const i = renderer.info;
      debugEl.textContent =
        `fps ${r.fps.toFixed(0)}  ${r.avg.toFixed(1)} ms  p95 ${r.p95.toFixed(1)}  max ${r.max.toFixed(0)}\n`
        + `calls ${i.render.calls}  tris ${(i.render.triangles / 1000).toFixed(0)}k  dpr ${dpr.toFixed(2)}  smoke ${smoke.count}\n`
        + `${phase}/${run.place}  z ${veh.z.toFixed(0)}  ${(Math.abs(veh.vz) / KMH).toFixed(0)} km/h  y ${veh.y.toFixed(1)}  ${veh.mode}  suc ${suction.on ? 'on' : 'off'}  car:${roadster.model.kind}`;
    }
  }
}

// ------------------------------------------------------------------ debug API for scripted checks
const snap = {
  phase: '', place: '', z: 0, x: 0, y: 0, kmh: 0, vy: 0, gas: 0, lives: 0, score: 0, saved: 0, mode: '', grounded: true, thrust: 0, burn: 0,
  boost: 0, camera: '', car: '', particles: 0, calls: 0, triangles: 0, dpr: 1, plazaIndex: 0, wallS: 0, rolls: 0, fines: 0, stunts: 0,
  etcPasses: 0, suction: false, dir: 1, heading: 0, flipping: false, flipT: 0, lang: '', pitch: 0, roll: 0, vz: 0, camFov: 0, camDz: 0,
  etcLift: 0, trauma: 0,
};
const game = {
  get state() {
    snap.phase = phase; snap.place = run.place; snap.z = veh.z; snap.x = veh.x; snap.y = veh.y; snap.kmh = Math.abs(veh.vz) / KMH; snap.vy = veh.vy;
    snap.vz = veh.vz; snap.gas = veh.gas; snap.lives = run.lives; snap.score = totalScore(score); snap.saved = score.saved; snap.fines = score.fines;
    snap.mode = veh.mode; snap.grounded = veh.grounded; snap.thrust = veh.thrustLevel; snap.burn = veh.burn; snap.boost = veh.boostLevel;
    snap.camera = rig.mode; snap.car = roadster.model.kind; snap.particles = smoke.count;
    snap.calls = renderer.info.render.calls; snap.triangles = renderer.info.render.triangles; snap.dpr = dpr;
    snap.plazaIndex = toll.plaza; snap.wallS = wall.s; snap.rolls = score.rolls; snap.stunts = score.stunts; snap.etcPasses = score.etcPasses;
    snap.suction = suction.on; snap.dir = veh.dir; snap.heading = veh.heading; snap.flipping = veh.flipping; snap.flipT = veh.flipT;
    snap.lang = getLang(); snap.pitch = veh.pitch; snap.roll = veh.roll;
    snap.camFov = rig.camera.fov; snap.camDz = rig.camera.position.z - veh.z; snap.trauma = rig.trauma; snap.etcLift = plaza.maxLift();
    return snap;
  },
  perf: (frames = FT_N) => perfReport(frames),
  debug: {
    start: () => startGame(),
    teleport,
    setSpeed: (kmh: number) => { veh.vz = -kmh * KMH * veh.dir; },
    thrust: (on: boolean) => { input.forceThrust = on ? true : null; if (on) input.detachPulse = true; },
    pause: () => setPaused(phase === 'playing'),
    camera: (m: CamMode) => rig.setMode(m),
    camPose: (px: number, py: number, pz: number, lx: number, ly: number, lz: number, fov = 60) => rig.setManual(px, py, pz, lx, ly, lz, fov),
    freeze: (on: boolean) => { frozen = on; },
    setX: (x: number) => { veh.x = x; veh.vx = 0; },
    setAltitude: (m: number) => { veh.y = m; veh.grounded = m <= 0; veh.vy = 0; },
    hover: (m: number | null) => { hoverTarget = m; if (m === null) input.forceThrust = null; },
    gas: (v: number) => { veh.gas = v; veh.gasLocked = false; },
    press: (what: 'roll-left' | 'roll-right' | 'detach' | 'camera' | 'suction' | 'lang') => {
      if (what === 'roll-left') input.rollPulse = -1;
      else if (what === 'roll-right') input.rollPulse = 1;
      else if (what === 'detach') input.detachPulse = true;
      else if (what === 'suction') input.suctionPulse = true;
      else if (what === 'lang') input.langPulse = true;
      else input.cameraPulse = true;
    },
    suction: (on: boolean) => { suction.on = on; suction.level = on ? 1 : 0; },
    lang: (l: Lang) => setLang(l),
    /** Jump into the arena right now (no fade). */
    enterArena: () => { if (phase !== 'playing') startGame(); switchPlace('arena', 25); },
    leaveArena: () => switchPlace('highway', 30),
    /** Put the car on the arena wall at arc length s, lateral offset x. */
    arenaWall: (s: number, x = 0, sucOn = true) => {
      if (run.place !== 'arena') { if (phase !== 'playing') startGame(); switchPlace('arena', 25); }
      suction.on = sucOn;
      suction.level = sucOn ? 1 : 0;
      veh.mode = 'wall';
      veh.grounded = false;
      wall.attached = true;
      wall.s = s;
      wall.x = x;
      wall.ds = 0;
      wall.dx = 0;
      wall.settle = 0;
      stepWall(veh, wall, createInput(), sucOn, 0.001, wev);
      syncCar();
      rig.snap(veh);
    },
    place: () => run.place,
    plazaZ,
    exitZ,
    exitGateZ,
    nearestExit,
    tollPrice,
  },
};
(window as unknown as { __game: typeof game }).__game = game;
if (DEBUG) (window as unknown as { __scene: THREE.Scene; __post: Post }).__scene = scene;
if (DEBUG) (window as unknown as { __post: Post }).__post = post;

// ------------------------------------------------------------------ boot
function resize(): void {
  W = window.innerWidth;
  H = window.innerHeight;
  renderer.setPixelRatio(dpr);
  renderer.setSize(W, H, false);
  post.setSize(W, H, dpr);
  rig.setAspect(W / H);
}
window.addEventListener('resize', resize);

async function boot(): Promise<void> {
  road.update(0);
  plaza.place(0, toll);
  setMode('menu');
  syncCar();
  rig.studio(0, true);
  lights.moon.castShadow = true;
  // let the loading screen paint before the heavy first frames
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  warmup();
  await Promise.race([initCar(), new Promise((r) => setTimeout(r, 9000))]);
  phase = 'menu';
  setMode('menu');
  screens.hideLoading();
  if (!COMPARE) screens.showStart(true);
  if (params.has('autostart')) startGame();
  renderer.setAnimationLoop(frame);
}

void boot();

// swap in a GLB that finished loading while we were driving, at the next quiet moment
setInterval(() => {
  if (pendingCar && phase !== 'playing') { const m = pendingCar; pendingCar = null; swapCar(m); }
}, 1000);
