// Extreme vs Ultra: draw calls, triangles and frame time per view, the cost of each Extreme feature (switched off one at
// a time), and screenshots of the same views on both presets. Software GL (SwiftShader): times are CPU rasterisation,
// useful for comparing features with each other, not as real GPU frame rates.
//   node tests/extreme.mjs [isla-rush.html] [outDir]
import { createRequire } from 'module'; import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const file = path.resolve(process.argv[2] || new URL('../isla-rush.html', import.meta.url).pathname);
const outDir = process.argv[3] || '.';
const W = 640, H = 360, FR = +(process.env.FRAMES || 3);
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const VIEWS = [
  ['start', 'trial', { idx: -8 }],
  ['seafront-sun', 'trial', { idx: 2380, faceSun: true }],
  ['oldtown', 'free', { x: -2700, z: -500, h: 0 }],
  ['downtown', 'free', { x: -1860, z: -540, h: Math.PI / 2 }],
];

async function open(q, settings = {}) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  if (process.env.THREE_JS) await page.route('**/three.min.js', r => r.fulfill({ body: fs.readFileSync(process.env.THREE_JS), contentType: 'application/javascript' }));
  const msgs = []; page.on('pageerror', e => msgs.push('error ' + e.message)); page.on('console', m => { if (m.type() === 'error') msgs.push(m.text().slice(0, 200)); });
  await page.addInitScript((s) => { try { const d = JSON.parse(localStorage.getItem('islaRush.settings') || '{}'); localStorage.setItem('islaRush.settings', JSON.stringify(Object.assign(d, s))); } catch (e) {} }, Object.assign({ traffic: 'medium' }, settings));
  await page.goto('file://' + file + '?q=' + q);
  await page.waitForFunction(() => window.IslaRush && window.IslaRush.line && document.body.classList.contains('loaded'), null, { timeout: 900000 });
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; document.getElementById('help').style.display = 'none'; IslaRush.renderer.info.autoReset = false; });
  return { page, msgs, loadMs: await page.evaluate(() => IslaRush.loadMs) };
}
async function setView(page, [, mode, v]) {
  await page.evaluate(([mode, v]) => {
    const g = IslaRush;
    if (g.state !== 'race' || g.raceOpts.mode !== mode) { g.toMainMenu(); Settings.data.spawn = 'circuit'; g.startRace('brisaGT', 0, { mode }); }
    g.countdown = 0; g.intro = 0;
    if (mode === 'free') { const c = g.city, y = c.groundAt(v.x, v.z, c.base(v.x, v.z) + 0.5, {}).h; g.car.placeFree(v.x, y, v.z, v.h, c.gap.index); g.cityView.update(v.x, v.z, true); g.traffic.clear(); }
    else { g.car.placeAt(g.track, (g.track.n + v.idx) % g.track.n); if (v.faceSun) g.car.state.h = Math.atan2(g.world.sunDir.x, g.world.sunDir.z); }
    g.car.updateVisual(1, 0); g.cameraRig.snap(g.car);
    g.input.update = function () { return Object.assign(this.ctrl, { throttle: 0, brake: 0, steer: 0, stick: 0, handbrake: false, nitroWant: false }); };
  }, [mode, v]);
}
async function measure(page) {
  return page.evaluate((FR) => {
    const g = IslaRush, gl = g.renderer.getContext(), px = new Uint8Array(4), ms = [];
    let t = performance.now(), calls = 0, tris = 0;
    for (let k = 0; k < FR + 1; k++) {
      g.renderer.info.reset(); t += 33; g.last = t - 33;
      const t0 = performance.now(); g.loop(t); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (k > 0) { ms.push(performance.now() - t0); calls = g.renderer.info.render.calls; tris = g.renderer.info.render.triangles; }
    }
    ms.sort((a, b) => a - b);
    const v = g.renderer.getDrawingBufferSize(new THREE.Vector2());
    return { ms: Math.round(ms[ms.length >> 1]), calls, tris, px: v.x + 'x' + v.y };
  }, FR);
}

const res = { ultra: {}, extreme: {}, features: {}, reload: {} };
// Ultra baseline + screenshots
{
  const { page, msgs, loadMs } = await open('ultra');
  res.ultraLoad = loadMs;
  for (const v of VIEWS) { await setView(page, v); res.ultra[v[0]] = await measure(page); await page.screenshot({ path: path.join(outDir, `${v[0]}_ultra.png`), timeout: 900000 }); }
  if (msgs.length) console.log('ultra console:', msgs.slice(0, 3));
  await page.close();
}
// Extreme: all on, then each live switch off in turn
const LIVE = ['x_ssaa', 'x_aa', 'x_contact', 'x_ssao', 'x_rays', 'x_flare', 'x_lamps', 'x_carRefl', 'x_ocean', 'x_foam', 'x_wet', 'x_grass', 'x_sway', 'x_clouds', 'x_bloom', 'x_motion', 'x_dof', 'x_chroma', 'x_grain', 'x_grade'];
{
  const { page, msgs, loadMs } = await open('extreme');
  res.extremeLoad = loadMs; res.loadSteps = await page.evaluate(() => IslaRush.loadSteps);
  for (const v of VIEWS) {
    await setView(page, v);
    res.extreme[v[0]] = await measure(page);
    await page.screenshot({ path: path.join(outDir, `${v[0]}_extreme.png`), timeout: 900000 });
    if (v[0] === 'start' || v[0] === 'oldtown' || v[0] === 'seafront-sun') {
      for (const k of LIVE) {
        await page.evaluate((k) => { Settings.data[k] = false; IslaRush.applySettings(); }, k);
        (res.features[k] = res.features[k] || {})[v[0]] = await measure(page);
        await page.evaluate((k) => { Settings.data[k] = true; IslaRush.applySettings(); }, k);
      }
    }
  }
  res.postStages = await page.evaluate(() => IslaRush.post.stats.ms);
  if (msgs.length) console.log('extreme console:', msgs.slice(0, 3));
  await page.close();
}
// switches that need a reload (shader / target changes)
for (const k of ['x_msaa', 'x_csm', 'x_pcss', 'x_materials']) {
  const { page } = await open('extreme', { [k]: false });
  for (const v of VIEWS.filter(v => v[0] === 'start' || v[0] === 'oldtown')) { await setView(page, v); (res.reload[k] = res.reload[k] || {})[v[0]] = await measure(page); }
  await page.close();
}
await browser.close();

const f = (m) => `${String(m.ms).padStart(6)} ms  ${String(m.calls).padStart(4)} calls  ${String(m.tris).padStart(9)} tris`;
console.log(`ULTRA vs EXTREME at ${W}x${H} CSS px (load: Ultra ${res.ultraLoad} ms, Extreme ${res.extremeLoad} ms)`);
for (const v of VIEWS) console.log(`  ${v[0].padEnd(13)} Ultra ${f(res.ultra[v[0]])} @${res.ultra[v[0]].px}   |   Extreme ${f(res.extreme[v[0]])} @${res.extreme[v[0]].px}`);
console.log('\nEXTREME FEATURE COST (everything on, minus the frame with that one feature off; positive = what it costs)');
const base = res.extreme;
for (const k of LIVE) {
  const r = res.features[k], d = (vn) => r[vn] ? `${vn} ${String(base[vn].ms - r[vn].ms).padStart(5)} ms ${String(base[vn].calls - r[vn].calls).padStart(4)} calls ${String(base[vn].tris - r[vn].tris).padStart(8)} tris` : '';
  console.log(`  ${k.padEnd(11)} ${d('start')}   ${d('oldtown')}   ${d('seafront-sun')}`);
}
for (const k in res.reload) {
  const r = res.reload[k], d = (vn) => `${vn} ${String(base[vn].ms - r[vn].ms).padStart(5)} ms ${String(base[vn].calls - r[vn].calls).padStart(4)} calls ${String(base[vn].tris - r[vn].tris).padStart(8)} tris`;
  console.log(`  ${k.padEnd(11)} ${d('start')}   ${d('oldtown')}   (reload)`);
}
console.log('\npost stages (ms, CPU-side, last view): ' + JSON.stringify(Object.fromEntries(Object.entries(res.postStages).map(([k, v]) => [k, +v.toFixed(1)]))));
console.log('extreme load steps: ' + JSON.stringify(res.loadSteps));
fs.writeFileSync(path.join(outDir, 'extreme.json'), JSON.stringify(res, null, 1));
