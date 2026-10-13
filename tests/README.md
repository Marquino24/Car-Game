# Isla Rush tests

Headless regression suites that run the game's own `Physics`, `AIDriver` and `Game.simulate` code in Chromium (Playwright).

```
node tests/handling.mjs [isla-rush.html] [out.json] [baseline.json]   # handling + nitro measurements (JSON)
node tests/report.mjs out.json [baseline.json]                         # readable summary, optional comparison
node tests/race.mjs [isla-rush.html]                                   # full 2-lap races, all cars: must print RACE SUITE PASS
node tests/city.mjs [isla-rush.html] [low,medium,high,ultra]           # Free Drive city: handling-style switch, collisions at speed, jumps,
                                                                       # tunnel / highway, causeway link, district drives per preset
```

`city.mjs` must print CITY SUITE PASS. Its frame times come from SwiftShader (software GL), so only the draw calls,
triangles and the JS share of the frame mean anything for real hardware.

Set `THREE_JS=/path/to/three.min.js` to serve three.js locally instead of from cdnjs.
To compare against an older build: `git show <branch>:isla-rush.html > old.html`, run `handling.mjs` on it first, then pass its JSON
as the baseline (the third argument re-drives its >= 140 km/h stretches from the same entry speeds).
