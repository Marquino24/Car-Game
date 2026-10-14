// Step 9 checks: Time Trial (sectors, deltas, records, ghost recording + playback), the map image size on iOS, photo
// mode (PNG), menus by keyboard / controller path / touch, and console warnings on every preset.
//   node tests/polish.mjs [isla-rush.html]
import { createRequire } from 'module'; import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const file = path.resolve(process.argv[2] || new URL('../isla-rush.html', import.meta.url).pathname);
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let ok = true;
const fail = (m) => { ok = false; console.log('  FAIL ' + m); };
async function open(q, ctxOpts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1024, height: 640 } }, ctxOpts));
  const page = await ctx.newPage();
  if (process.env.THREE_JS) await page.route('**/three.min.js', r => r.fulfill({ body: fs.readFileSync(process.env.THREE_JS), contentType: 'application/javascript' }));
  const msgs = []; page.on('pageerror', e => msgs.push('error ' + e.message)); page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') msgs.push(m.type() + ' ' + m.text().slice(0, 240)); });
  await page.goto('file://' + file + '?q=' + q);
  await page.waitForFunction(() => window.IslaRush && window.IslaRush.line && document.body.classList.contains('loaded'), null, { timeout: 600000 });
  return { ctx, page, msgs };
}

// ---- 1. Time Trial: 3 laps on autopilot ----
{
  const { ctx, page, msgs } = await open('low');
  const r = await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
    const g = window.IslaRush; resetAllRecords();
    g.startRace('kazeRS', 0, { mode: 'trial' });
    const ai = new AIDriver(g.car, g.line, CONFIG.race.difficulty.normal, mulberry32(3), { autopilot: true }); ai.launchDelay = 0;
    g.input.update = function () { return Object.assign(this.ctrl, ai.update(1 / 60, 10, 1), { nitroWant: false }); };
    const ev = []; const orig = g.trialEvents.bind(g);
    g.trialEvents = function () { for (const e of this.trial.events) ev.push(Object.assign({ lap: g.laps.lap }, e)); orig(); };
    let ghostFrames = 0, hiddenFrames = 0, maxGap = 0, gapLap3 = 0, t = performance.now();
    for (let f = 0; f < 60 * 480 && g.laps.lap < 4; f++) {
      g.simulate(1 / 60);
      if (f % 2 === 0) {
        Settings.data.ghost = f % 600 < 60 ? 'off' : 'on';           // the toggle hides it
        g.trial.frame(Settings.data.ghost === 'on');
        const G = g.trial.ghost;
        if (G && Settings.data.ghost === 'off' && G.root.visible) hiddenFrames++;
        if (G && G.root.visible) {
          ghostFrames++;
          const d = G.root.position.distanceTo(new THREE.Vector3(g.car.state.x, g.car.state.y, g.car.state.z));
          maxGap = Math.max(maxGap, d); if (g.laps.lap === 3) gapLap3 = Math.max(gapLap3, d);
        }
      }
    }
    const rec = TrialStore.of('kazeRS');
    return { laps: g.laps.lap, events: ev.map(e => ({ type: e.type, lap: e.lap, n: e.n, t: e.t && +e.t.toFixed(3), delta: e.delta === null || e.delta === undefined ? null : +e.delta.toFixed(3), purple: e.purple, best: e.best, theo: e.theo && +e.theo.toFixed(3) })),
      rec: rec && { lap: +rec.lap.toFixed(3), splits: rec.splits.map(x => +x.toFixed(3)), bestSectors: rec.bestSectors.map(x => +x.toFixed(3)), laps: rec.laps, ghostBytes: rec.ghost.length },
      storage: (localStorage.getItem('islaRush.trial') || '').length, ghostFrames, hiddenFrames, maxGap: +maxGap.toFixed(1), gapLap3: +gapLap3.toFixed(1), bests: Bests.data.kazeRS };
  });
  console.log('TIME TRIAL (Kaze RS, autopilot, 3 timed laps)');
  for (const e of r.events) console.log('  ' + (e.type === 'split' ? `lap ${e.lap} ${e.n < 3 ? 'sector ' + e.n : 'finish  '} t ${e.t}s  delta ${e.delta === null ? '(first lap)' : (e.delta > 0 ? '+' : '') + e.delta}${e.purple ? '  best sector' : ''}` : `${e.type}${e.best ? ' NEW BEST' : ''} ${e.t || ''}s${e.theo ? ' theoretical ' + e.theo : ''}`));
  console.log(`  record: ${JSON.stringify(r.rec)}  storage ${r.storage} chars`);
  console.log(`  ghost: visible ${r.ghostFrames} frames, shown while toggled off ${r.hiddenFrames}, max distance to the car ${r.maxGap} m (lap 3: ${r.gapLap3} m), bests ${JSON.stringify(r.bests)}`);
  const splits = r.events.filter(e => e.type === 'split');
  if (splits.length < 9) fail('expected 9 splits, got ' + splits.length);
  if (splits.slice(3).some(e => e.delta === null)) fail('no delta after the first lap');
  if (!r.rec || !(r.rec.bestSectors.reduce((a, b) => a + b, 0) <= r.rec.lap + 1e-6)) fail('theoretical best > best lap');
  if (!r.ghostFrames || r.hiddenFrames) fail('ghost playback / toggle');
  if (msgs.length) fail('console: ' + msgs.slice(0, 3));
  await ctx.close();
}

// ---- 2. The map image on iOS (iPad user agent) vs a desktop ----
for (const [name, opts] of [['desktop', {}], ['iPad', { userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1', hasTouch: true, isMobile: true, viewport: { width: 1024, height: 768 } }]]) {
  const { ctx, page } = await open('low', opts);
  const r = await page.evaluate(() => { window.requestAnimationFrame = () => 0; const g = IslaRush; g.startRace('brisaGT', 0, { mode: 'free' }); return { w: g.cityMap.img.width, h: g.cityMap.img.height, ios: IS_IOS, scale: g.cityMap.sc }; });
  console.log(`\nMAP IMAGE ${name}: ${r.w} x ${r.h} px (${r.scale.toFixed(3)} px/m, IS_IOS ${r.ios})`);
  if (name === 'iPad' && (Math.max(r.w, r.h) > 2048 || !r.ios)) fail('iPad map too big');
  await ctx.close();
}

// ---- 3. Photo mode + 4. menus (keyboard, the controller's code path, touch) ----
{
  const { ctx, page, msgs } = await open('medium');
  const kb = async (code) => { await page.keyboard.press(code); await page.waitForTimeout(80); };
  const name = () => page.evaluate(() => IslaRush.menu.name);
  const log = [];
  await kb('ArrowDown'); await kb('ArrowDown'); await kb('Enter'); log.push(['keyboard: Down, Down, Enter', await name()]);
  await kb('Escape'); log.push(['keyboard: Esc', await name()]);
  await page.evaluate(() => { const m = IslaRush.menu; m.nav('down'); m.activate(); }); log.push(['controller path: down, confirm (focus was on Records)', await name()]);
  await page.evaluate(() => IslaRush.menu.back()); log.push(['controller path: back', await name()]);
  await page.click('#scr-main button[data-act="settings"]'); log.push(['touch / click: Settings', await name()]);
  await page.evaluate(() => IslaRush.menu.back());
  await page.click('#scr-main button[data-act="trial"]'); await page.click('#scr-select button[data-act="race"]'); log.push(['touch: Time Trial, Race', await name() + ' / mode ' + await page.evaluate(() => Settings.data.mode)]);
  await page.click('#scr-mode button[data-act="start"]'); await page.waitForTimeout(800);
  await kb('Escape'); await page.waitForFunction(() => IslaRush.menu.name === 'pause', null, { timeout: 30000 }).catch(() => {}); log.push(['in the trial, Esc', await name()]);
  await page.evaluate(() => IslaRush.menu.go('photo')); await page.waitForTimeout(500); log.push(['Photo mode', await name()]);
  const shot = await page.evaluate(() => { window.requestAnimationFrame = () => 0; IslaRush.saveScreenshot(); return IslaRush.lastShot || 0; });
  await kb('Escape'); await page.waitForTimeout(1500); log.push(['photo: Esc', await name() + ' paused ' + await page.evaluate(() => IslaRush.paused)]);
  console.log('\nMENUS + PHOTO MODE');
  for (const [a, b] of log) console.log('  ' + a.padEnd(32) + b);
  console.log('  screenshot PNG data URL: ' + shot + ' chars');
  const want = ['records', 'main', 'settings', 'main', 'settings', 'mode / mode trial', 'pause', 'photo', 'pause paused true'];
  log.forEach(([a, b], i) => { if (b !== want[i]) fail(a + ': ' + b + ' (expected ' + want[i] + ')'); });
  if (!(shot > 10000)) fail('screenshot');
  if (msgs.length) fail('console: ' + msgs.slice(0, 3));
  await ctx.close();
}

// ---- 5. Console warnings on every preset: load, a Free Drive frame, a Time Trial frame ----
console.log('\nCONSOLE ON EVERY PRESET (load + one Free Drive frame in the city + one Time Trial frame)');
for (const q of ['low', 'medium', 'high', 'ultra', 'extreme']) {
  const { ctx, page, msgs } = await open(q);
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0; const g = IslaRush;
    Settings.data.spawn = 'downtown'; g.startRace('brisaGT', 0, { mode: 'free' }); g.last = performance.now() - 16; g.loop(performance.now());
    g.toMainMenu(); g.startRace('ciclonR', 0, { mode: 'trial' }); g.last = performance.now() - 16; g.loop(performance.now());
    g.renderer.getContext().finish();
  });
  console.log(`  ${q.padEnd(8)} ${msgs.length ? msgs.length + ' message(s): ' + msgs.slice(0, 3).join(' | ') : 'clean'}`);
  if (msgs.some(m => m.startsWith('error'))) fail(q + ' errors');
  await ctx.close();
}
await browser.close();
console.log(ok ? '\nPOLISH SUITE PASS' : '\nPOLISH SUITE FAIL');
process.exit(ok ? 0 : 1);
