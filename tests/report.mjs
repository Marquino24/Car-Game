// Summarise a handling.mjs JSON result, optionally against a baseline:  node tests/report.mjs new.json [base.json]
import fs from 'fs';
const A = JSON.parse(fs.readFileSync(process.argv[2])), B = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3])) : null;
const p = (...x) => console.log(...x);
p('errors:', A.errors.length ? A.errors : 'none');
p('\nnitro power curve (bar -> x accel):', A.power.map(([l, v]) => `${l * 100}%: ${v}`).join('  '));
p('\nFULL LOCK on open tarmac (entry km/h, throttle -> settled km/h, max drift amount, max slip deg, spins)');
for (const r of A.fullLock) p(`  ${r.key.padEnd(9)} ${String(r.kmh).padStart(3)} thr ${r.thr}: ${String(r.endKmh).padStart(6)} km/h  R ${String(r.radius).padStart(5)} m  drift ${r.dMax}  slip ${r.slipMax}/${r.slipLate}  spins ${r.spins}`);
p('  manual, full throttle:'); for (const r of A.fullLockManual) p(`  ${r.key.padEnd(9)} ${r.kmh}: drift ${r.dMax} slip ${r.slipMax} spins ${r.spins}`);
p('\nSTEER-TO-DRIFT onset, lowest entry km/h (full stick, 70% throttle, 0.6 s):');
for (const [lbl, key] of [['first slide (amount > 0.1)', 'onsetFirst'], ['half strength (> 0.5)', 'onset'], ['full strength (> 0.95)', 'onsetFull']])
  if (A[key]) p(`  ${lbl.padEnd(28)}`, A[key].map(([k, v]) => `${k} ${v}`).join(', ') + (B && B[key] ? '   | step7 ' + B[key].map(([k, v]) => v).join('/') : ''));
p('\nBRAKE TAP max drift amount:', A.tap.map(r => `${r.key}@${r.kmh}=${r.dMax}`).join(' '));
p('DOWNSHIFT (manual) max drift:', A.downshift.map(r => `${r.key}@${r.kmh}${r.shifted ? '' : '(blocked)'}=${r.dMax}/${r.slipMax}deg`).join(' '));
p('HANDBRAKE max drift:', A.handbrake.map(r => `${r.key}@${r.kmh}=${r.dMax}`).join(' '));
p('\nHAIRPINS (all 6), steady 25% throttle, no brakes: speed range in the hairpins, max drift amount, max slip, barrier contact steps');
for (const h of A.hairpins) {
  const H = h.hairpins, vmin = Math.min(...H.map(x => x.vMin)), vmax = Math.max(...H.map(x => x.vMax)), d = Math.max(...H.map(x => x.dMax)), sl = Math.max(...H.map(x => x.slipMax));
  const w = H.map(x => x.wallSteps), fail = H.filter(x => !x.done).length;
  p(`  ${h.key.padEnd(9)} ${h.manual ? 'manual' : 'auto  '} entry ${h.entry || 85}: ${vmin}-${vmax} km/h  drift ${d}  slip ${sl}  walls [${w.join(',')}]${fail ? ' FAIL ' + fail : ''}`);
}
p('\nHIGH-SPEED DRIFT (peak angle deg, end km/h)' + (B ? ' vs step 7, identical trace?' : ''));
for (const h of A.highDrift) {
  const b = B && B.highDrift.find(x => x.key === h.key && x.kmh === h.kmh);
  p(`  ${h.key.padEnd(9)} ${h.kmh}: ${h.peakAngle} deg, ${h.endKmh} km/h` + (b ? `   step7 ${b.peakAngle} deg, ${b.endKmh}  ${JSON.stringify(b.trace) === JSON.stringify(h.trace) ? 'IDENTICAL' : 'DIFFERENT'}` : ''));
}
p('\nNITRO 100-200 km/h (s), bar level at fire');
for (const k of A.keys) p(`  ${k.padEnd(9)} ` + A.nitro.filter(r => r.key === k).map(r => `${r.level * 100}%: ${r.secs}s (burn ${r.burn}s)`).join('  ') + (B ? '   | step7 ' + B.nitro.filter(r => r.key === k).map(r => `${r.level * 100}%: ${r.secs}`).join(' ') : ''));
p('\nLAPS (autopilot, nitro off)');
for (const l of A.laps) {
  const b = B && B.laps.find(x => x.key === l.key);
  let fast = '';
  if (b && b.at && l.at) {   // time spent on samples where step 7 ran >= 140 km/h, in runs of >= 20 samples (50 m)
    let ta = 0, tb = 0, n = l.at.length;
    for (let i = 1; i < n; i++) if (b.spd[i] >= 140 && b.spd[i - 1] >= 140 && l.at[i] > 0 && l.at[i - 1] > 0) { ta += l.at[i] - l.at[i - 1]; tb += b.at[i] - b.at[i - 1]; }
    fast = `  >=140 km/h sections: ${ta.toFixed(3)}s vs step7 ${tb.toFixed(3)}s (${(ta - tb >= 0 ? '+' : '') + (ta - tb).toFixed(3)})`;
  }
  p(`  ${l.key.padEnd(9)} ${l.lapTime}s resets ${l.resets} spins ${l.spins}` + (b ? `   step7 ${b.lapTime}s` : '') + fast);
}
if (A.sections && B && B.sections) {
  p('\nFAST SECTIONS (step-7 stretches >= 140 km/h, entered at the same speed, autopilot, nitro off)');
  for (const k of A.keys) {
    const a = A.sections.filter(x => x.key === k), b = B.sections.filter(x => x.key === k);
    const ta = a.reduce((x, y) => x + y.secs, 0), tb = b.reduce((x, y) => x + y.secs, 0), same = a.every((x, i) => x.secs === b[i].secs);
    p(`  ${k.padEnd(9)} ${a.length} sections: ${ta.toFixed(4)}s vs step7 ${tb.toFixed(4)}s  ${same ? 'IDENTICAL' : 'diff ' + (ta - tb).toFixed(4) + 's'}` + (same ? '' : '  ' + a.map((x, i) => x.secs !== b[i].secs ? `[@${x.i0} ${x.secs} vs ${b[i].secs}, min ${x.minKmh}]` : '').join('')));
  }
}
