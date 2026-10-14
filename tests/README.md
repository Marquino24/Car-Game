# Isla Rush tests

Headless regression suites that run the game's own `Physics`, `AIDriver` and `Game.simulate` code in Chromium (Playwright).

```
node tests/handling.mjs [isla-rush.html] [out.json] [baseline.json]   # handling + nitro measurements (JSON)
node tests/report.mjs out.json [baseline.json]                         # readable summary, optional comparison
node tests/race.mjs [isla-rush.html]                                   # full 2-lap races, all cars: must print RACE SUITE PASS
node tests/city.mjs [isla-rush.html] [low,medium,high,ultra|none]      # Free Drive city: handling-style switch, collisions at speed, jumps,
                                                                       # tunnel / highway, camera collision, traffic per density (High: 4-min
                                                                       # soak), causeway link, district drives per preset (FRAMES=n caps them)
node tests/polish.mjs [isla-rush.html]                                 # Time Trial (sectors, deltas, records, ghost), iOS map size, photo mode,
                                                                       # menus by keyboard / controller path / touch, console on every preset
node tests/extreme.mjs [isla-rush.html] [outDir]                       # Ultra vs Extreme: calls, triangles, frame time per view, cost of each
                                                                       # Extreme feature, screenshots of the same views (slow: software GL)
```

Dev helper: `ONLY="<expression using __S>" node tests/handling.mjs` evaluates one expression against the handling suite
(e.g. `__S.hairpins('toroV8', false, 90)`) and prints it.

`city.mjs` must print CITY SUITE PASS, `polish.mjs` POLISH SUITE PASS. Frame times in `city.mjs` and `extreme.mjs` come from SwiftShader (software GL), so only the draw calls,
triangles and the JS share of the frame mean anything for real hardware.

Set `THREE_JS=/path/to/three.min.js` to serve three.js locally instead of from cdnjs.
To compare against an older build: `git show <branch>:isla-rush.html > old.html`, run `handling.mjs` on it first, then pass its JSON
as the baseline (the third argument re-drives its >= 140 km/h stretches from the same entry speeds).
