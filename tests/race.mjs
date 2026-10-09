// Full races through the game's own loop (Game.simulate), player on autopilot: errors, finishes, resets, spins, nitro use.
//   node tests/race.mjs [isla-rush.html]
import { createRequire } from 'module'; import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const file = path.resolve(process.argv[2] || new URL('../isla-rush.html', import.meta.url).pathname);
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
if (process.env.THREE_JS) await page.route('**/three.min.js', r => r.fulfill({ body: fs.readFileSync(process.env.THREE_JS), contentType: 'application/javascript' }));
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('file://' + file + '?q=low');
await page.waitForFunction(() => window.IslaRush && window.IslaRush.line, null, { timeout: 120000 });
const results = [], LAPS = +(process.env.LAPS || 2), REPS = +(process.env.REPS || 1);
for (let rep = 0; rep < REPS; rep++) for (const [key, difficulty, trans] of [['brisaGT', 'normal', 'auto'], ['toroV8', 'hard', 'manual'], ['kazeRS', 'easy', 'auto'], ['montanaX', 'normal', 'manual'], ['ciclonR', 'hard', 'auto']]) {
  results.push(await page.evaluate(([key, difficulty, trans, LAPS]) => {
    window.requestAnimationFrame = () => 0;                          // stop the render loop: we step the game ourselves
    const g = window.IslaRush, fires = [];
    Settings.data.transmission = trans;
    const orig = Nitro.prototype.update;
    Nitro.prototype.update = function (dt, want, car) { const lv = this.level, on = orig.call(this, dt, want, car); if (this.fired) fires.push([car === g.car ? 'player' : 'ai', +lv.toFixed(2)]); return on; };
    g.startRace(key, 0, { mode: 'race', laps: LAPS, difficulty });
    const pilot = new AIDriver(g.car, g.line, CONFIG.race.difficulty.hard, mulberry32(3), { autopilot: true }); pilot.launchDelay = 0;
    g.input.update = function () { const r = g.race; const c = pilot.update(1 / 60, r ? r.time : 0, 1); const lv = g.nitro.level; return Object.assign(this.ctrl, c, { nitroWant: lv > 0.85 || (g.nitro.active && lv > 0) }); };
    let t = 0;
    while (t < 450 * LAPS && !(g.race && g.race.allDone)) { g.simulate(1 / 60); t += 1 / 60; if (g.race && g.race.playerDone && t > 300 * LAPS) break; }
    Nitro.prototype.update = orig;
    const r = g.race;
    return { key, difficulty, trans, simSecs: Math.round(t), allDone: r.allDone, playerDone: r.playerDone,
      racers: r.racers.map(x => ({ name: x.name, car: x.key, rank: x.rank, done: !!x.finished && !x.estimated, ft: x.finishTime && +x.finishTime.toFixed(1), resets: x.ai ? x.ai.resets : 0, spins: x.car.state.spins, nitroUses: x.ai ? x.ai.nitroUses : null })),
      aiFireLevels: fires.filter(f => f[0] === 'ai').map(f => f[1]), playerFireLevels: fires.filter(f => f[0] === 'player').map(f => f[1]) };
  }, [key, difficulty, trans, LAPS]));
}
await browser.close();
let ok = errors.length === 0; const spreads = [];
for (const r of results) {
  const resets = r.racers.reduce((a, x) => a + x.resets, 0), spins = r.racers.reduce((a, x) => a + x.spins, 0);
  const lowFires = r.aiFireLevels.filter(l => l < 0.85).length, ft = r.racers.map(x => x.ft).filter(Number.isFinite);
  r.spread = ft.length ? Math.max(...ft) - Math.min(...ft) : null; spreads.push(r.spread);
  console.log(`${r.key} ${r.difficulty} ${r.trans}: spread ${r.spread != null ? r.spread.toFixed(1) : '?'}s, finished ${r.racers.filter(x => x.done).length}/${r.racers.length} in ${r.simSecs}s sim, AI resets ${resets}, spins ${spins}, AI nitro fires ${r.aiFireLevels.length} (min bar ${Math.min(...r.aiFireLevels)}), player fires ${r.playerFireLevels.length}`);
  if (!r.playerDone || lowFires || r.racers.some(x => !x.done)) ok = false;
  console.log('   ', r.racers.map(x => `${x.rank}. ${x.name}(${x.car}) ${x.ft}s`).join('  '));
}
console.log(`laps ${LAPS}, races ${results.length}: first-to-last spread ` + results.map(r => `${r.key}/${r.difficulty} ${r.spread.toFixed(1)}s`).join(', ') + `  | max ${Math.max(...spreads).toFixed(1)}s, mean ${(spreads.reduce((a, b) => a + b, 0) / spreads.length).toFixed(1)}s`);
console.log('errors:', errors.length ? errors : 'none');
console.log(ok ? 'RACE SUITE PASS' : 'RACE SUITE FAIL');
process.exit(ok ? 0 : 1);
