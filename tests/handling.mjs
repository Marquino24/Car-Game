// Isla Rush handling + nitro regression suite (step 7b).
// Runs the game's own Physics/AI code headlessly in Chromium and prints JSON results.
//   node tests/handling.mjs [path/to/isla-rush.html] [out.json]
// Needs Playwright (PLAYWRIGHT pre-installed in the cloud env) and network access to cdnjs for three.js,
// or set THREE_JS=/path/to/three.min.js to serve it locally.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }

const file = path.resolve(process.argv[2] || new URL('../isla-rush.html', import.meta.url).pathname);
const out = process.argv[3];
const baseJson = process.argv[4];   // optional: step-7 result; its >= 140 km/h stretches are re-driven from the same entry speed

// ---------------------------------------------------------------------------------------------
// In-page helpers. Everything uses the game's real CONFIG / Car / Physics / Nitro / AIDriver.
// ---------------------------------------------------------------------------------------------
function pageSuite() {
  const g = window.IslaRush, DT = CONFIG.physics.dt, KEYS = Object.keys(CONFIG.cars);
  const flat = {   // endless flat tarmac: no walls, no kerbs
    makeQuery() { return {}; },
    query(x, z, i, q) { Object.assign(q, { index: 0, lateral: 0, halfWidth: 1e5, offroad: 1e5, rx: 1, rz: 0, height: 0, grade: 0, s: 0, section: 0 }); return q; },
    sectionOf() { return CONFIG.track.sections.seafront; },
  };
  const mk = (key, o = {}) => {
    const c = CONFIG.cars[key], car = new Car(c, g.scene, g.world.envMap, g.Q, c.colors[0]);
    g.scene.remove(car.model.root);
    car.handling = { style: 'motorfest', assist: o.assist || 'high' };
    car.manual = !!o.manual;
    return car;
  };
  const gearFor = (car, kmh) => {
    if (car.manual) { const V = Physics.gears(car.cfg).V; let gr = 1; while (gr < V.length && kmh / 3.6 > V[gr - 1] * 0.8) gr++; return gr; }
    const up = car.cfg.gearShiftUp; let gr = 1; while (gr <= up.length && kmh > up[gr - 1]) gr++; return gr;
  };
  const launch = (car, kmh) => {
    const s = car.state, v = kmh / 3.6;
    Object.assign(s, { x: 0, z: 0, y: 0, h: 0, vx: 0, vz: v, vF: v, vS: 0, yawRate: 0, dAmt: 0, dAngle: 0, spinning: false, spins: 0, idx: 0, longAccel: 0, latAccel: 0, shiftTimer: 0, brkHeld: 0, dsKick: 0, boostOver: 0 });
    s.gear = gearFor(car, kmh);
  };
  const lock = car => g.input.usefulLock(car, false);
  const slipDeg = s => Math.atan2(Math.abs(s.vS), Math.max(Math.abs(s.vF), 0.1)) * 57.3;
  const kmhOf = s => Math.hypot(s.vx, s.vz) * 3.6;

  // Full lock at a steady throttle on open tarmac: settled speed / radius, peak drift + slip, spins
  function fullLock(key, kmh, thr, manual = false, secs = 6) {
    const car = mk(key, { manual }), s = car.state; launch(car, kmh);
    let dMax = 0, slipMax = 0, slipLate = 0;
    const steps = Math.round(secs / DT);
    for (let k = 0; k < steps; k++) {
      Physics.step(car, { steer: lock(car), stick: 1, throttle: thr, brake: 0, handbrake: false, nitro: false }, flat, DT);
      dMax = Math.max(dMax, s.dAmt); slipMax = Math.max(slipMax, slipDeg(s));
      if (k > steps / 2) slipLate = Math.max(slipLate, slipDeg(s));
    }
    const v = kmhOf(s);
    return { key, kmh, thr, endKmh: +v.toFixed(1), radius: +(v / 3.6 / Math.max(Math.abs(s.yawRate), 1e-3)).toFixed(1), dMax: +dMax.toFixed(3), slipMax: +slipMax.toFixed(1), slipLate: +slipLate.toFixed(1), spins: s.spins };
  }

  // Per-0.25 s trace of a full-lock run (debugging)
  function trace(key, kmh, thr, secs = 4) {
    const car = mk(key), s = car.state; launch(car, kmh); const tr = [];
    for (let k = 0; k < Math.round(secs / DT); k++) {
      Physics.step(car, { steer: lock(car), stick: 1, throttle: thr, brake: 0, handbrake: false, nitro: false }, flat, DT);
      if (k % 30 === 0) tr.push([+kmhOf(s).toFixed(1), +slipDeg(s).toFixed(1), +s.dAmt.toFixed(2), +(s.dCap ?? 1).toFixed(2), s.drifting ? 1 : 0, +s.yawRate.toFixed(2), +lock(car).toFixed(2)]);
    }
    return tr;
  }

  // Lowest entry speed at which full stick + throttle kicks a steer-to-drift (dAmt > 0.5 within 0.6 s)
  function onset(key, level = 0.5) {
    for (let kmh = 60; kmh <= 220; kmh += 2) {
      const car = mk(key), s = car.state; launch(car, kmh); let d = 0;
      for (let k = 0; k < Math.round(0.6 / DT); k++) { Physics.step(car, { steer: lock(car), stick: 1, throttle: 0.7, brake: 0, handbrake: false, nitro: false }, flat, DT); d = Math.max(d, s.dAmt); }
      if (d > level) return kmh;
    }
    return null;
  }

  // High-speed steer-to-drift trace (must match step 7 exactly at >= 140 km/h)
  function highDrift(key, kmh) {
    const car = mk(key), s = car.state; launch(car, kmh); const tr = [];
    for (let k = 0; k < Math.round(2.4 / DT); k++) {
      const t = k * DT, kick = t < 0.4;
      Physics.step(car, { steer: lock(car) * (kick ? 1 : 0.6), stick: kick ? 1 : 0.6, throttle: kick ? 0.7 : 0.6, brake: 0, handbrake: false, nitro: false }, flat, DT);
      if (k % 12 === 0) tr.push([+(s.dAngle * 57.3).toFixed(3), +kmhOf(s).toFixed(3)]);
    }
    return { key, kmh, peakAngle: Math.max(...tr.map(p => p[0])), endKmh: tr[tr.length - 1][1], trace: tr };
  }

  // Brake tap (L2) while turning: drift or not
  function tap(key, kmh) {
    const car = mk(key), s = car.state; launch(car, kmh); let d = 0;
    for (let k = 0; k < Math.round(1.6 / DT); k++) {
      const t = k * DT;
      Physics.step(car, { steer: lock(car) * 0.8, stick: 0.8, throttle: t < 0.15 ? 0 : 0.3, brake: t < 0.15 ? 1 : 0, handbrake: false, nitro: false }, flat, DT);
      d = Math.max(d, s.dAmt);
    }
    return { key, kmh, dMax: +d.toFixed(3) };
  }

  // Manual: downshift into a full-lock turn
  function downshift(key, kmh) {
    const car = mk(key, { manual: true }), s = car.state; launch(car, kmh);
    const V = Physics.gears(car.cfg).V; let gr = 1; while (gr < V.length && kmh / 3.6 > V[gr - 1] * 0.95) gr++; s.gear = Math.min(V.length, gr + 1);
    const ok = car.shift(-1); let d = 0, slipMax = 0;
    for (let k = 0; k < Math.round(2 / DT); k++) {
      Physics.step(car, { steer: lock(car), stick: 1, throttle: 0.3, brake: 0, handbrake: false, nitro: false }, flat, DT);
      d = Math.max(d, s.dAmt); slipMax = Math.max(slipMax, slipDeg(s));
    }
    return { key, kmh, shifted: ok, dMax: +d.toFixed(3), slipMax: +slipMax.toFixed(1), spins: s.spins };
  }

  // Handbrake still drifts at any speed
  function handbrake(key, kmh) {
    const car = mk(key), s = car.state; launch(car, kmh); let d = 0;
    for (let k = 0; k < Math.round(1 / DT); k++) {
      Physics.step(car, { steer: 1, stick: 1, throttle: 0.4, brake: 0, handbrake: k * DT < 0.5, nitro: false }, flat, DT);
      d = Math.max(d, s.dAmt);
    }
    return { key, kmh, dMax: +d.toFixed(3) };
  }

  // 100-200 km/h at full throttle, nitro fired at a given bar level and held
  function nitroRun(key, level) {
    const car = mk(key), s = car.state; launch(car, 100);
    const n = new Nitro(); n.level = level; let t = 0, burn = 0;
    while (kmhOf(s) < 200 && t < 30) {
      const on = level > 0 ? n.update(DT, true, car) : false;
      if (on) burn += DT;
      Physics.step(car, { steer: 0, stick: 0, throttle: 1, brake: 0, handbrake: false, nitro: on, nitroPower: n.power }, flat, DT);
      t += DT;
    }
    return { key, level, secs: +t.toFixed(2), burn: +burn.toFixed(2) };
  }

  // Real track hairpins: approach at 85 km/h, steady 25% throttle, path-following steering (no brakes, no handbrake)
  function hairpins(key, manual = false, entry = 85, dbg = false) {
    const T = g.track, line = g.line, n = T.n, res = [];
    const starts = []; for (let i = 0; i < n; i++) if (line.R[i] < 45 && line.R[(i - 1 + n) % n] >= 45) starts.push(i);
    for (const apex of starts) {
      const car = mk(key, { manual }), s = car.state, i0 = (apex - 24 + n) % n;
      car.placeAt(T, i0); const v = entry / 3.6; s.vx = Math.sin(s.h) * v; s.vz = Math.cos(s.h) * v; s.vF = v; s.gear = gearFor(car, entry); const tr = [];
      let dMax = 0, slipMax = 0, vMin = 1e9, vMax = 0, walls = 0, k = 0, prog = 0, lastIdx = s.idx;
      while (prog < 70 && k < 20 / DT) {
        const lk = Math.max(3, Math.round((5 + Math.hypot(s.vx, s.vz) * 0.35) / 2.5)), j = (s.idx + lk) % n;
        const o = clamp(line.off[j], -T.HW[j] + 1.5, T.HW[j] - 1.5), tx = T.X[j] + T.RX[j] * o - s.x, tz = T.Z[j] + T.RZ[j] * o - s.z;
        const fx = Math.sin(s.h), fz = Math.cos(s.h), st = clamp(Math.atan2(fx * tz - fz * tx, fx * tx + fz * tz) * 2.8, -1, 1);
        const L = lock(car);
        Physics.step(car, { steer: st * L, stick: st, throttle: 0.25, brake: 0, handbrake: false, nitro: false }, T, DT);
        let d = s.idx - lastIdx; if (d < -n / 2) d += n; if (d > n / 2) d -= n; prog += d; lastIdx = s.idx;
        dMax = Math.max(dMax, s.dAmt); slipMax = Math.max(slipMax, slipDeg(s)); if (s.wall) walls++;
        if (dbg && k % 30 === 0) tr.push([prog, +kmhOf(s).toFixed(1), +slipDeg(s).toFixed(1), +st.toFixed(2), +L.toFixed(2), +s.lateral.toFixed(1), +T.HW[s.idx].toFixed(1), s.wall ? 1 : 0]);
        if (prog > 10) { vMin = Math.min(vMin, kmhOf(s)); vMax = Math.max(vMax, kmhOf(s)); }
        k++;
      }
      res.push({ apex, R: +line.R[apex].toFixed(0), done: prog >= 70, vMin: +vMin.toFixed(1), vMax: +vMax.toFixed(1), dMax: +dMax.toFixed(3), slipMax: +slipMax.toFixed(1), wallSteps: walls, spins: s.spins, ...(dbg ? { tr } : {}) });
    }
    return { key, manual, entry, hairpins: res };
  }

  // One flying lap on autopilot (normal AI), nitro off: lap time + time at each track sample (for split comparisons)
  function lap(key, nitro = false) {
    const T = g.track, n = T.n, car = mk(key), s = car.state;
    const ai = new AIDriver(car, g.line, CONFIG.race.difficulty.normal, mulberry32(7), { autopilot: true }); ai.launchDelay = 0;
    car.placeAt(T, n - 40);
    const at = new Float64Array(n).fill(-1), spd = new Float32Array(n);
    let t = 0, lastIdx = s.idx, prog = 0, started = false, t0 = 0;
    for (let f = 0; f < 60 * 400; f++) {
      const c = ai.update(1 / 60, t, 1); if (!nitro) { c.nitro = false; ai.nitroWant = false; }
      for (let k = 0; k < 2; k++) {
        Physics.step(car, c, T, DT); t += DT;
        let d = s.idx - lastIdx; if (d < -n / 2) d += n; if (d > n / 2) d -= n; lastIdx = s.idx;
        if (!started && s.idx < n / 2) { started = true; t0 = t; prog = s.idx; }
        else if (started) { prog += d; const i = ((prog % n) + n) % n; if (prog < n && prog >= 0 && at[i] < 0) { at[i] = t - t0; spd[i] = kmhOf(s); } }
      }
      if (started && prog >= n) return { key, lapTime: +(t - t0).toFixed(3), at: Array.from(at), spd: Array.from(spd), resets: ai.resets, spins: s.spins };
    }
    return { key, lapTime: null, resets: ai.resets };
  }

  // A fast section on autopilot, entered at a given speed (nitro off): time to cover len samples
  function section(key, i0, len, kmh) {
    const T = g.track, n = T.n, car = mk(key), s = car.state;
    const ai = new AIDriver(car, g.line, CONFIG.race.difficulty.normal, mulberry32(7), { autopilot: true }); ai.launchDelay = 0;
    car.placeAt(T, i0); const v = kmh / 3.6; s.vx = Math.sin(s.h) * v; s.vz = Math.cos(s.h) * v; s.vF = v; s.gear = gearFor(car, kmh);
    let t = 0, prog = 0, last = s.idx, minK = 1e9;
    while (prog < len && t < 120) {
      const c = ai.update(1 / 60, 100 + t, 1); c.nitro = false; ai.nitroWant = false;
      for (let k = 0; k < 2; k++) { Physics.step(car, c, T, DT); t += DT; let d = s.idx - last; if (d < -n / 2) d += n; if (d > n / 2) d -= n; prog += d; last = s.idx; minK = Math.min(minK, kmhOf(s)); }
    }
    return { key, i0, len, kmh, secs: +t.toFixed(4), minKmh: +minK.toFixed(1) };
  }

  return { KEYS, trace, section, fullLock, onset, highDrift, tap, downshift, handbrake, nitroRun, hairpins, lap, power: l => (typeof nitroPower === 'function' ? nitroPower(l) : 1) };
}

// ---------------------------------------------------------------------------------------------
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
if (process.env.THREE_JS) await page.route('**/three.min.js', r => r.fulfill({ body: fs.readFileSync(process.env.THREE_JS), contentType: 'application/javascript' }));
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('file://' + file + '?q=low');
await page.waitForFunction(() => window.IslaRush && window.IslaRush.track && window.IslaRush.line, null, { timeout: 120000 });
await page.evaluate(`window.__S = (${pageSuite.toString()})()`);
const run = (expr) => page.evaluate(expr);

const R = { file: path.basename(file), errors };
R.keys = await run('__S.KEYS');
R.power = await run('[1, 0.85, 0.7, 0.6, 0.5, 0.25, 0.08].map(l => [l, +__S.power(l).toFixed(3)])');
R.fullLock = await run(`__S.KEYS.flatMap(k => [60, 75, 90].flatMap(v => [0.25, 1].map(t => __S.fullLock(k, v, t))))`);
R.fullLockManual = await run(`__S.KEYS.flatMap(k => [60, 90].map(v => __S.fullLock(k, v, 1, true)))`);
R.onset = await run(`__S.KEYS.map(k => [k, __S.onset(k)])`);
R.onsetFirst = await run(`__S.KEYS.map(k => [k, __S.onset(k, 0.1)])`);
R.onsetFull = await run(`__S.KEYS.map(k => [k, __S.onset(k, 0.95)])`);
R.highDrift = await run(`__S.KEYS.flatMap(k => [150, 180, 220].map(v => __S.highDrift(k, v)))`);
R.tap = await run(`__S.KEYS.flatMap(k => [70, 100, 115, 140].map(v => __S.tap(k, v)))`);
R.downshift = await run(`__S.KEYS.flatMap(k => [60, 80, 100].map(v => __S.downshift(k, v)))`);
R.handbrake = await run(`__S.KEYS.flatMap(k => [40, 70, 160].map(v => __S.handbrake(k, v)))`);
R.nitro = await run(`__S.KEYS.flatMap(k => [1, 0.5, 0.25, 0].map(l => __S.nitroRun(k, l)))`);
R.hairpins = await run(`__S.KEYS.flatMap(k => [60, 75, 90].flatMap(e => [__S.hairpins(k, false, e), __S.hairpins(k, true, e)]))`);
R.laps = await run(`__S.KEYS.map(k => __S.lap(k))`);
if (baseJson) {
  const B = JSON.parse(fs.readFileSync(baseJson)), segs = [];
  for (const l of B.laps) {
    const sp = l.spd, n = sp.length; let i = 1;
    while (i < n) {
      if (sp[i] >= 140) { let j = i; while (j < n && sp[j] >= 140) j++; if (j - i >= 40) segs.push([l.key, i, j - i, +sp[i].toFixed(2)]); i = j; } else i++;
    }
  }
  R.sections = await run(`${JSON.stringify(segs)}.map(([k, i, len, v]) => __S.section(k, i, len, v))`);
}
await browser.close();
if (out) fs.writeFileSync(out, JSON.stringify(R));
const brief = { ...R, laps: R.laps.map(l => ({ key: l.key, lapTime: l.lapTime, resets: l.resets, spins: l.spins })), highDrift: R.highDrift.map(h => ({ key: h.key, kmh: h.kmh, peakAngle: h.peakAngle, endKmh: h.endKmh })) };
console.log(JSON.stringify(brief, null, 1));
