// Free Drive city (Puerto Brisa) suite: handling-style switch, collisions, jumps, tunnel / highway, the road link to the
// circuit, and scripted drives through every district with frame cost, draw calls, triangles and chunk load times.
//   node tests/city.mjs [isla-rush.html] [presets=low,medium,high,ultra]
import { createRequire } from 'module'; import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const file = path.resolve(process.argv[2] || new URL('../isla-rush.html', import.meta.url).pathname);
const presets = (process.argv[3] || 'low,medium,high,ultra').split(',');
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let ok = true;
const fail = (msg) => { ok = false; console.log('  FAIL ' + msg); };

async function open(q, ctxOpts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 960, height: 540 } }, ctxOpts));
  const page = await ctx.newPage();
  if (process.env.THREE_JS) await page.route('**/three.min.js', r => r.fulfill({ body: fs.readFileSync(process.env.THREE_JS), contentType: 'application/javascript' }));
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + file + '?q=' + q);
  await page.waitForFunction(() => window.IslaRush && window.IslaRush.line, null, { timeout: 120000 });
  return { ctx, page, errors };
}

// ---------------------------------------------------------------------------------------------
// 1. Handling style per input type (touch device: phone / iPad emulation)
// ---------------------------------------------------------------------------------------------
{
  const { ctx, page, errors } = await open('low', { hasTouch: true, isMobile: true, viewport: { width: 1024, height: 768 } });
  const r = await page.evaluate(() => {
    const g = window.IslaRush, log = [], cur = () => Settings.data.handling + '/' + g.car.handling.style;
    const pad = { id: 'Test pad', index: 0 };
    log.push(['touch start (IS_TOUCH=' + IS_TOUCH + ')', cur()]);
    g.input.gamepad.pad = pad; g.input.gamepad.onConnect({ name: 'Test pad' }); log.push(['controller connected', cur()]);
    g.input.gamepad.pad = null; g.input.gamepad.onDisconnect(); log.push(['controller disconnected', cur()]);
    // manual choice on touch: Motorfest, remembered for touch only
    g.menu.show('settings'); const rows = g.menu.rows(), i = rows.findIndex(r => r.dataset.key === 'handling'); g.menu.setFocus(i); g.menu.adjust(1);
    log.push(['touch: chose in Settings', cur()]);
    g.input.gamepad.pad = pad; g.input.gamepad.onConnect({ name: 'Test pad' }); log.push(['controller connected', cur()]);
    g.menu.setFocus(i); g.menu.adjust(1); log.push(['controller: chose in Settings', cur()]);
    g.input.gamepad.pad = null; g.input.gamepad.onDisconnect(); log.push(['controller disconnected', cur()]);
    g.input.gamepad.pad = pad; g.input.gamepad.onConnect({ name: 'Test pad' }); log.push(['controller reconnected', cur()]);
    g.input.gamepad.pad = null; g.input.gamepad.onDisconnect();
    g.menu.close();
    return { log, saved: JSON.parse(localStorage.getItem('islaRush.settings')).handlingBy };
  });
  console.log('HANDLING STYLE SWITCH (touch device)');
  for (const [k, v] of r.log) console.log('  ' + k.padEnd(34) + v);
  console.log('  saved per input type: ' + JSON.stringify(r.saved));
  const want = ['grip/grip', 'motorfest/motorfest', 'grip/grip', 'motorfest/motorfest', 'motorfest/motorfest', 'grip/grip', 'motorfest/motorfest', 'grip/grip'];
  r.log.forEach(([k, v], i) => { if (v !== want[i]) fail(`${k}: ${v}, expected ${want[i]}`); });
  // a reload keeps the choices
  await page.reload(); await page.waitForFunction(() => window.IslaRush && window.IslaRush.line);
  const after = await page.evaluate(() => Settings.data.handling);
  console.log('  after reload (touch, no controller): ' + after);
  if (after !== 'motorfest') fail('touch choice not kept after reload');
  // a fresh touch device defaults to Grip
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.IslaRush && window.IslaRush.line);
  const fresh = await page.evaluate(() => Settings.data.handling + '/' + window.IslaRush.car.handling.style);
  console.log('  fresh touch device: ' + fresh);
  if (fresh !== 'grip/grip') fail('fresh touch device is not Grip');
  if (errors.length) fail('page errors ' + errors);
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------
// 2. Physics: collisions at speed, jumps, tunnel + highway, the causeway link (Low preset; physics is preset-free)
// ---------------------------------------------------------------------------------------------
{
  const { ctx, page, errors } = await open('low');
  const r = await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
    const g = window.IslaRush, DT = CONFIG.physics.dt;
    Settings.data.spawn = 'circuit'; Settings.data.traffic = 'off';
    g.startRace('brisaGT', 0, { mode: 'free' });
    const city = g.city, W = g.free, car = g.car, s = car.state;
    const put = (x, z, h, kmh, y) => {
      y = y !== undefined ? y : city.groundAt(x, z, city.base(x, z) + 0.5, {}).h;
      car.placeFree(x, y, z, h, city.gap.index); W.inCity = false; W.events.length = 0;
      const v = kmh / 3.6; s.vx = Math.sin(h) * v; s.vz = Math.cos(h) * v; s.vF = v; s.gear = 5;
      W.ground(car, Math.sin(h), Math.cos(h), DT);
    };
    const ctrl = (o = {}) => Object.assign({ throttle: 1, brake: 0, steer: 0, stick: 0, handbrake: false, nitro: false }, o);
    // inside any collider that blocks at this height?
    const inside = () => {
      const i = Math.floor(s.x / CITY_GRID), j = Math.floor(s.z / CITY_GRID), c = city.cell(i, j, false); if (!c) return null;
      for (const col of c.cols) {
        let y1 = col.y1; if (col.st) { y1 = W.structTop(col.st, s.x, s.z); if (y1 <= s.y + CONFIG.city.stepUp) continue; }
        if (s.y + 1.2 < col.y0 || s.y > y1) continue;
        const dx = s.x - col.x, dz = s.z - col.z;
        if (col.r !== undefined) { if (Math.hypot(dx, dz) < col.r - 0.05) return col; continue; }
        const lz = dx * col.s + dz * col.c, lx = dx * col.c - dz * col.s;
        if (Math.abs(lx) < col.hx - 0.05 && Math.abs(lz) < col.hz - 0.05) return col;
      }
      return null;
    };
    const out = { crash: [], jumps: [], levels: [], link: [] };

    // ---- crashes into walls at 250-330 km/h, straight and at an angle ----
    const crash = (name, x, z, h, kmh, y) => {
      put(x, z, h, kmh, y);
      let hits = 0, clip = 0, minY = Infinity, maxSpeedAfter = 0, firstHit = -1;
      for (let k = 0; k < 240; k++) {
        Physics.step(car, ctrl(), W, DT);
        if (s.wall) { hits++; if (firstHit < 0) firstHit = k; }
        if (inside()) clip++;
        minY = Math.min(minY, s.y);
        if (firstHit >= 0 && k > firstHit + 30) maxSpeedAfter = Math.max(maxSpeedAfter, Math.hypot(s.vx, s.vz) * 3.6);
      }
      out.crash.push({ name, kmh, hits, clip, firstHitM: firstHit >= 0 ? +(firstHit * DT * kmh / 3.6).toFixed(1) : null, end: [+s.x.toFixed(1), +s.y.toFixed(1), +s.z.toFixed(1)], minY: +minY.toFixed(2), speedAfter: Math.round(maxSpeedAfter) });
    };
    crash('Old Town block, head-on', -2700, -290, Math.PI / 2, 260);
    crash('Old Town block, 30 deg', -2700, -280, Math.PI / 2 + 0.5, 280);
    crash('Downtown tower, head-on', -2120, -480, Math.PI / 2, 300);
    crash('Downtown tower, 45 deg', -2120, -480, Math.PI / 4, 300);
    crash('Sea wall (south), 60 deg', -2600, -700, Math.PI - 0.5, 300);
    crash('Sea wall (west), head-on', -2980, 300, -Math.PI / 2, 330);
    crash('Tunnel wall, 20 deg in the bore', -1420, 560, 0.35, 280);
    crash('Highway parapet on the deck, 25 deg', -1900, -160, Math.PI / 2 - 0.45, 300, city.hwy.top);
    crash('Causeway parapet, 25 deg', -1000, -724, Math.PI / 2 + 0.45, 300, city.causewayY(-1000, -724));
    crash('Port warehouse, head-on', -2900, 820, 0, 260);

    // ---- jumps: run-up 90 m, full throttle; air time, distance, landing ----
    for (const j of city.jumps) for (const kmh of [90, 140, 200, 260]) {
      const h = Math.atan2(j.ux, j.uz), x = j.ax - j.ux * 60, z = j.az - j.uz * 60;
      put(x, z, h, kmh);
      let air = 0, took = null, land = null, bounce = 0, maxH = 0, after = 0, vyLand = 0, wall = 0;
      for (let k = 0; k < 900; k++) {
        const wasAir = s.air;
        Physics.step(car, ctrl({ throttle: kmh / 3.6 > s.vF ? 1 : 0.2 }), W, DT);
        if (s.wall) wall++;
        if (s.air) { air += DT; maxH = Math.max(maxH, s.y - city.groundAt(s.x, s.z, s.y, {}).h); }
        if (!wasAir && s.air && !took) took = [s.x, s.z];
        if (wasAir && !s.air && !land) { land = [s.x, s.z]; vyLand = W.events.filter(e => e.type === 'land').pop()?.vy || 0; }
        if (land) { after++; if (s.air) bounce++; if (after > 180) break; }
      }
      const ev = W.events.filter(e => e.type === 'land' && e.st === j);
      g.activities.update(DT, car, W.events);
      out.jumps.push({ name: j.name, kmh, air: +air.toFixed(2), dist: took && land ? +Math.hypot(land[0] - took[0], land[1] - took[1]).toFixed(1) : null, recorded: ev.length ? +ev[0].dist.toFixed(1) : null, maxHeight: +maxH.toFixed(2), vyLand: +vyLand.toFixed(1), bounceSteps: bounce, wallSteps: wall });
      W.events.length = 0;
    }

    // ---- elevated highway + tunnel at speed: never below the deck / never through the floor ----
    const drive = (name, pts, kmh, checks) => {
      const [x0, z0] = pts[0], [x1, z1] = pts[1];
      put(x0, z0, Math.atan2(x1 - x0, z1 - z0), kmh);
      let wp = 1, worst = 0, under = 0, wall = 0, steps = 0, air = 0, maxDy = 0;
      for (let k = 0; k < 120 * 60 && wp < pts.length; k++) {
        const [tx, tz] = pts[wp], dx = tx - s.x, dz = tz - s.z;
        if (Math.hypot(dx, dz) < 14) { wp++; continue; }
        const want = Math.atan2(dx, dz), err = wrapAngle(want - s.h);
        const y0 = s.y;
        Physics.step(car, ctrl({ steer: clamp(-err * 2.5, -1, 1), stick: clamp(-err * 2.5, -1, 1), throttle: s.vF * 3.6 < kmh ? 1 : 0 }), W, DT);
        steps++; if (s.wall) wall++; if (s.air) air++;
        maxDy = Math.max(maxDy, Math.abs(s.y - y0));
        const c = checks(s); if (c > 0) { under++; worst = Math.max(worst, c); }
      }
      out.levels.push({ name, kmh, reached: wp >= pts.length, steps, wallSteps: wall, airSteps: air, violations: under, worst: +worst.toFixed(2), maxStepDy: +maxDy.toFixed(3) });
    };
    const H = city.hwy;
    const onDeck = (s) => (s.x > H.x0 + 10 && s.x < H.x1 - 10 && Math.abs(s.z - H.z) < H.hw) ? Math.max(0, H.top - 0.05 - s.y) : 0;
    drive('Elevated highway W->E (ramp, deck, ramp)', [[-2440, -160], [-2385, -160], [-2170, -160], [-1450, -160], [-1255, -160], [-1236, -100], [-1236, 0]], 240, onDeck);
    drive('Under the highway (avenue x=-2120)', [[-2120, -540], [-2120, -360], [-2120, 0]], 200, (s) => (Math.abs(s.z - H.z) < 10 ? Math.max(0, s.y - 6) : 0));
    const inTube = (s) => (Math.abs(s.x - city.hill.cx) < 9 && Math.abs(s.z - city.hill.cz) < city.hill.R) ? Math.max(0, Math.abs(s.y - city.base(s.x, s.z)) - 0.3) : 0;
    drive('Tunnel S->N', [[-1300, 330], [-1380, 430], [-1420, 505], [-1420, 855], [-1470, 950]], 230, inTube);
    drive('Tunnel N->S', [[-1470, 950], [-1420, 855], [-1420, 505], [-1390, 440], [-1300, 330], [-1240, 150]], 230, inTube);

    // ---- knock-over props, traffic shove, activity records ----
    {
      put(-2770, 560, Math.PI / 2, 80);
      let knocked = 0;
      for (let k = 0; k < 120 * 2.5; k++) { Physics.step(car, ctrl({ throttle: s.vF * 3.6 < 80 ? 1 : 0 }), W, DT); for (const e of W.events) if (e.type === 'prop') knocked++; W.events.length = 0; }
      out.props = { cones: city.props.filter(p => p.type === 'cone' && Math.abs(p.z - 560) < 1).length, knocked, kmhAfter: Math.round(s.vF * 3.6), wallSteps: 0 };
      // traffic: one car stopped on the downtown loop, you hit it from behind at 90 km/h
      const T = g.traffic; T.setDensity('low'); T.clear(); T.max = 1;
      const tc = { col: 0xffffff, spd: 0 }, rt = city.routes.find(r => r.lights), o = {};
      T.at(rt, 120, o); Object.assign(tc, { r: rt, d: 120, v: 0, x: o.x, z: o.z, h: Math.atan2(o.dx, o.dz), hr: Math.atan2(o.dx, o.dz), kx: 0, kz: 0, kvx: 0, kvz: 0, ky: 0, kw: 0, hold: 9, y: city.base(o.x, o.z) });
      T.cars.push(tc);
      put(o.x - o.dx * 40, o.z - o.dz * 40, Math.atan2(o.dx, o.dz), 90);
      let hit = 0, clipT = 0;
      for (let k = 0; k < 120 * 2; k++) {
        Physics.step(car, ctrl({ throttle: 0.5 }), W, DT);
        if (s.wall) hit++;
        if (Math.hypot(s.x - tc.x, s.z - tc.z) < 1.5) clipT++;
        if (k % 2 === 0) T.update(1 / 60, car, city.lightPhase(0), true);
      }
      out.traffic = { contactSteps: hit, pushedM: +Math.hypot(tc.x - o.x, tc.z - o.z).toFixed(1), centresOverlap: clipT, playerKmh: Math.round(s.vF * 3.6) };
      T.clear(); T.setDensity('off');
      // a speed trap + a drift zone + a recorded jump through the real activity code
      const A = g.activities; A.reset();
      put(-2060, -712, Math.PI / 2, 200);
      for (let k = 0; k < 120; k++) { Physics.step(car, ctrl(), W, DT); A.update(DT, car, W.events); W.events.length = 0; }
      out.records = JSON.parse(localStorage.getItem('islaRush.cityRecords') || '{}');
    }

    // ---- the road link: city -> causeway -> circuit, then circuit -> causeway -> city ----
    {
      const P = city.causeway.pts, pts = [[-1500, -712], [-1300, -712]];
      for (let k = 0; k < P.length / 2; k += 3) pts.push([P[k * 2], P[k * 2 + 1]]);
      const T = g.track, gi = city.gap.index, cx = T.X[gi] + T.RX[gi] * 3, cz = T.Z[gi] + T.RZ[gi] * 3;
      pts.push([P[P.length - 2], P[P.length - 1]], [cx, cz], [T.X[(gi + 12) % T.n], T.Z[(gi + 12) % T.n]], [T.X[(gi + 40) % T.n], T.Z[(gi + 40) % T.n]]);
      let trans = [];
      const evs = () => { for (const e of W.events) if (e.type === 'city' || e.type === 'circuit') trans.push(e.type); W.events.length = 0; };
      const [x0, z0] = pts[0], [x1, z1] = pts[1];
      put(x0, z0, Math.atan2(x1 - x0, z1 - z0), 120);
      let wp = 1, wall = 0, minLat = 0, maxDy = 0;
      for (let k = 0; k < 120 * 60 && wp < pts.length; k++) {
        const [tx, tz] = pts[wp], dx = tx - s.x, dz = tz - s.z;
        if (Math.hypot(dx, dz) < 10) { wp++; continue; }
        const err = wrapAngle(Math.atan2(dx, dz) - s.h), y0 = s.y;
        Physics.step(car, ctrl({ steer: clamp(-err * 2.5, -1, 1), stick: clamp(-err * 2.5, -1, 1), throttle: s.vF * 3.6 < (wp > pts.length - 4 ? 70 : 140) ? 1 : 0 }), W, DT);
        if (s.wall) wall++; maxDy = Math.max(maxDy, Math.abs(s.y - y0)); evs();
      }
      const q = T.query(s.x, s.z, s.idx, T.makeQuery());
      out.link.push({ dir: 'city -> circuit', reached: wp >= pts.length, transitions: trans.join(','), wallSteps: wall, maxStepDy: +maxDy.toFixed(3), endOnCircuit: !W.inCity, lateral: +q.lateral.toFixed(1), halfWidth: +q.halfWidth.toFixed(1) });
      // and back: from the circuit 60 m before the junction, turn into the gap
      const back = [[T.X[(gi - 40 + T.n) % T.n], T.Z[(gi - 40 + T.n) % T.n]], [T.X[(gi - 12 + T.n) % T.n] - T.RX[gi] * 4, T.Z[(gi - 12 + T.n) % T.n] - T.RZ[gi] * 4], [cx, cz]];
      for (let k = P.length / 2 - 1; k >= 0; k -= 3) back.push([P[k * 2], P[k * 2 + 1]]);
      back.push([-1300, -712], [-1600, -712]);
      car.placeAt(T, (gi - 40 + T.n) % T.n); W.inCity = false; W.events.length = 0; trans = [];
      let h0 = Math.atan2(back[1][0] - back[0][0], back[1][1] - back[0][1]); s.h = h0;
      wp = 1; wall = 0; maxDy = 0;
      for (let k = 0; k < 120 * 60 && wp < back.length; k++) {
        const [tx, tz] = back[wp], dx = tx - s.x, dz = tz - s.z;
        if (Math.hypot(dx, dz) < 10) { wp++; continue; }
        const err = wrapAngle(Math.atan2(dx, dz) - s.h), y0 = s.y;
        Physics.step(car, ctrl({ steer: clamp(-err * 2.5, -1, 1), stick: clamp(-err * 2.5, -1, 1), throttle: s.vF * 3.6 < (wp < 4 ? 60 : 140) ? 1 : 0 }), W, DT);
        if (s.wall) wall++; if (Math.abs(s.y - y0) > maxDy) { maxDy = Math.abs(s.y - y0); out.dyAt = [Math.round(s.x), Math.round(s.z), +y0.toFixed(2), +s.y.toFixed(2), W.inCity, !!s.air]; } evs();
      }
      out.link.push({ dir: 'circuit -> city', dyAt: out.dyAt, reached: wp >= back.length, transitions: trans.join(','), wallSteps: wall, maxStepDy: +maxDy.toFixed(3), endInCity: W.inCity, end: [Math.round(s.x), Math.round(s.z)] });
      // the gap is closed in races: the same run on the race Track (no city) is stopped by the sea wall
      g.toMainMenu(); g.startRace('brisaGT', 0, { mode: 'race', laps: 1, difficulty: 'normal' }); g.endRace();
      car.placeAt(T, (gi - 40 + T.n) % T.n);
      const c2 = g.car, s2 = c2.state; c2.placeAt(T, (gi - 40 + T.n) % T.n); s2.h = h0; wp = 1; let wall2 = 0, minL = 0;
      for (let k = 0; k < 120 * 12 && wp < 4; k++) {
        const [tx, tz] = back[wp], dx = tx - s2.x, dz = tz - s2.z;
        if (Math.hypot(dx, dz) < 10) { wp++; continue; }
        const err = wrapAngle(Math.atan2(dx, dz) - s2.h);
        Physics.step(c2, ctrl({ steer: clamp(-err * 2.5, -1, 1), stick: clamp(-err * 2.5, -1, 1), throttle: s2.vF * 3.6 < 60 ? 1 : 0 }), T, DT);
        if (s2.wall) wall2++; minL = Math.min(minL, s2.lateral);
      }
      const lim = T.HW[gi] + T.OR[gi];
      out.link.push({ dir: 'race mode, same line', wallSteps: wall2, deepestLateral: +minL.toFixed(2), wallAt: -+lim.toFixed(2), gateVisible: !!(T.gate && T.gate.visible) });
      g.toMainMenu();
    }
    return out;
  });
  console.log('\nCOLLISIONS AT SPEED (2 s at full throttle into the obstacle; clip = steps with the car centre inside a solid)');
  for (const c of r.crash) {
    console.log(`  ${c.name.padEnd(38)} ${c.kmh} km/h: hit after ${c.firstHitM} m, contact steps ${c.hits}, clip ${c.clip}, speed after ${c.speedAfter} km/h, end ${c.end.join(',')}, min y ${c.minY}`);
    if (c.clip) fail(c.name + ' clipped'); if (c.firstHitM === null) fail(c.name + ' never hit');
  }
  console.log('\nJUMPS (60 m run-up; distance take-off -> touchdown, landing vertical speed, steps airborne again within 1.5 s of landing)');
  for (const j of r.jumps) {
    console.log(`  ${j.name.padEnd(16)} ${String(j.kmh).padStart(3)} km/h: air ${j.air}s, ${j.dist} m (recorded ${j.recorded}), peak ${j.maxHeight} m, landing vy ${j.vyLand} m/s, bounce ${j.bounceSteps}, wall ${j.wallSteps}`);
    if (j.bounceSteps) fail(j.name + ' bounced'); if (j.kmh >= 140 && !(j.air > 0.3)) fail(j.name + ' no air at ' + j.kmh);
  }
  console.log('\nELEVATED HIGHWAY + TUNNEL (violations = steps below the deck / off the tunnel floor)');
  for (const l of r.levels) {
    console.log(`  ${l.name.padEnd(42)} ${l.kmh} km/h: reached ${l.reached}, ${l.steps} steps, wall ${l.wallSteps}, air ${l.airSteps}, violations ${l.violations} (worst ${l.worst} m), max height change/step ${l.maxStepDy} m`);
    if (!l.reached || l.violations) fail(l.name);
  }
  console.log('\nPROPS, TRAFFIC, RECORDS');
  console.log('  cones in the yard line: ' + r.props.cones + ', knocked over at 80 km/h: ' + r.props.knocked + ', speed after ' + r.props.kmhAfter + ' km/h');
  console.log('  traffic car rear-ended at 90 km/h: contact steps ' + r.traffic.contactSteps + ', shoved ' + r.traffic.pushedM + ' m, centres overlapping ' + r.traffic.centresOverlap + ', player now ' + r.traffic.playerKmh + ' km/h');
  console.log('  localStorage islaRush.cityRecords: ' + JSON.stringify(r.records));
  if (r.props.knocked < 10) fail('props not knocked'); if (!(r.traffic.pushedM > 0.5) || r.traffic.centresOverlap) fail('traffic shove');
  if (!r.records.trap || !(r.records.trap['Malecón speed trap'] > 150) || !r.records.jump || !r.records.jump['Port jump']) fail('records not saved');
  console.log('\nROAD LINK TO THE CIRCUIT');
  for (const l of r.link) console.log('  ' + JSON.stringify(l));
  if (!r.link[0].reached || !r.link[0].endOnCircuit || !r.link[1].reached || !r.link[1].endInCity) fail('causeway link');
  if (r.link[2].deepestLateral < r.link[2].wallAt - 1) fail('race mode: car passed the sea wall');
  if (errors.length) fail('page errors ' + errors);
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------
// 3. District drives per preset: frame cost (JS), draw calls, triangles, chunk loads (+ race baseline)
// ---------------------------------------------------------------------------------------------
console.log('\nDISTRICT DRIVES PER PRESET (autopilot through each district, traffic per default; 960x540, SwiftShader software GL)');
console.log('  frame = whole frame incl. software rendering; js = frame minus render calls; calls / tris = per frame (avg / max)');
for (const q of presets) {
  const { ctx, page, errors } = await open(q);
  const r = await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
    const g = window.IslaRush, R = g.renderer;
    R.info.autoReset = false;
    let rT = 0; const origRender = R.render.bind(R); R.render = (a, b) => { const t = performance.now(); origRender(a, b); rT += performance.now() - t; };
    const runFrames = (n, pilot) => {
      const st = { frames: 0, ms: [], js: [], calls: [], tris: [] };
      let t = performance.now();
      g.input.update = function () { return Object.assign(this.ctrl, pilot()); };
      for (let k = 0; k < n; k++) {
        R.info.reset(); rT = 0;
        const t0 = performance.now();
        t += 1000 / 60; g.last = t - 1000 / 60; g.loop(t);
        const ms = performance.now() - t0;
        st.ms.push(ms); st.js.push(ms - rT); st.calls.push(R.info.render.calls); st.tris.push(R.info.render.triangles);
      }
      const avg = a => a.reduce((x, y) => x + y, 0) / a.length, mx = a => Math.max(...a);
      return { ms: +avg(st.ms).toFixed(1), msMax: +mx(st.ms).toFixed(1), js: +avg(st.js).toFixed(2), jsMax: +mx(st.js).toFixed(2), calls: Math.round(avg(st.calls)), callsMax: mx(st.calls), tris: Math.round(avg(st.tris)), trisMax: mx(st.tris) };
    };
    const out = { preset: QUALITY_NAME, rows: [] };
    // race baseline: grid start, driving the circuit
    g.startRace('brisaGT', 0, { mode: 'race', laps: 1, difficulty: 'normal' });
    const ai = new AIDriver(g.car, g.line, CONFIG.race.difficulty.hard, mulberry32(3), { autopilot: true }); ai.launchDelay = 0;
    g.intro = 0; g.countdown = 0; g.race.aiStarts();
    out.rows.push(Object.assign({ name: 'RACE (baseline, circuit, 5 AI)' }, runFrames(240, () => ai.update(1 / 60, g.race ? g.race.time : 0, 1))));
    g.toMainMenu();
    Settings.data.spawn = 'circuit';
    g.startRace('brisaGT', 0, { mode: 'free' });
    out.build = g.cityStats;
    g.countdown = 0;
    const ai2 = new AIDriver(g.car, g.line, CONFIG.race.difficulty.hard, mulberry32(3), { autopilot: true }); ai2.launchDelay = 0;
    out.rows.push(Object.assign({ name: 'Free Drive on the circuit' }, runFrames(240, () => ai2.update(1 / 60, 10, 1))));
    const city = g.city, s = g.car.state;
    const route = (name, pts, kmh, n) => {
      const [x0, z0] = pts[0], [x1, z1] = pts[1], h = Math.atan2(x1 - x0, z1 - z0);
      g.car.placeFree(x0, city.groundAt(x0, z0, city.base(x0, z0) + 0.5, {}).h, z0, h, city.gap.index);
      g.free.inCity = false; g.cameraRig.snap(g.car);
      const loads0 = g.cityView.stats.loads, lm0 = g.cityView.stats.loadMs.length;
      let wp = 1;
      const pilot = () => {
        let [tx, tz] = pts[wp % pts.length]; if (Math.hypot(tx - s.x, tz - s.z) < 14) { wp++; [tx, tz] = pts[wp % pts.length]; }
        const err = wrapAngle(Math.atan2(tx - s.x, tz - s.z) - s.h), st = clamp(-err * 2.5, -1, 1);
        return { steer: st, stick: st, throttle: s.vF * 3.6 < kmh ? 1 : 0, brake: s.vF * 3.6 > kmh + 25 ? 0.5 : 0, handbrake: false, nitroWant: false };
      };
      const row = Object.assign({ name }, runFrames(n, pilot));
      const lm = g.cityView.stats.loadMs.slice(lm0);
      row.chunkLoads = g.cityView.stats.loads - loads0; row.chunkMs = lm.length ? +Math.max(...lm).toFixed(1) : 0; row.rebuildMs = +g.cityView.stats.lastMs.toFixed(1);
      row.traffic = g.traffic.cars.length; row.wp = wp;
      out.rows.push(row);
    };
    route('Old Town (cobbles, 90 deg corners)', [[-2760, -260], [-2940, -260], [-2940, -620], [-2460, -620], [-2460, -260]], 70, 300);
    route('Downtown avenues + roundabout', [[-2120, -540], [-1580, -540], [-1580, 200], [-2120, 200], [-2120, -540]], 110, 300);
    route('Elevated highway', [[-2440, -160], [-2385, -160], [-1255, -160], [-1236, -100], [-1236, 100]], 180, 300);
    route('Port + yard', [[-2405, 640], [-2615, 640], [-2900, 640], [-2900, 760], [-2700, 760]], 100, 300);
    route('Malecón + causeway', [[-2900, -712], [-1200, -712], [-900, -731]], 200, 300);
    route('Ring road north + tunnel', [[-2300, 980], [-1800, 1040], [-1470, 950], [-1420, 855], [-1420, 505], [-1300, 330]], 180, 300);
    out.view = { chunks: g.cityView.chunks.size, detail: g.cityView.CQ.detail };
    return out;
  });
  console.log(`  ${q.toUpperCase()}: city build ${r.build.buildMs.toFixed(0)} ms (layout ${r.build.layoutMs.toFixed(0)} ms), near-detail radius ${r.view.detail} m, ${r.view.chunks} chunks built in the run`);
  for (const x of r.rows) console.log(`    ${x.name.padEnd(36)} frame ${String(x.ms).padStart(5)} ms (max ${x.msMax})  js ${String(x.js).padStart(5)} ms (max ${x.jsMax})  calls ${String(x.calls).padStart(3)} (max ${x.callsMax})  tris ${String(x.tris).padStart(7)} (max ${x.trisMax})` + (x.chunkLoads !== undefined ? `  chunks loaded ${x.chunkLoads}, slowest ${x.chunkMs} ms, near rebuild ${x.rebuildMs} ms, traffic ${x.traffic}` : ''));
  if (errors.length) fail(q + ' page errors ' + errors.slice(0, 3));
  await ctx.close();
}
await browser.close();
console.log(ok ? '\nCITY SUITE PASS' : '\nCITY SUITE FAIL');
process.exit(ok ? 0 : 1);
