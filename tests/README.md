# Isla Rush tests

Headless regression suites that run the game's own `Physics`, `AIDriver` and `Game.simulate` code in Chromium (Playwright).

```
node tests/handling.mjs [isla-rush.html] [out.json] [baseline.json]   # handling + nitro measurements (JSON)
node tests/report.mjs out.json [baseline.json]                         # readable summary, optional comparison
node tests/race.mjs [isla-rush.html]                                   # full 2-lap races, all cars: must print RACE SUITE PASS
```

Set `THREE_JS=/path/to/three.min.js` to serve three.js locally instead of from cdnjs.
To compare against an older build: `git show <branch>:isla-rush.html > old.html`, run `handling.mjs` on it first, then pass its JSON
as the baseline (the third argument re-drives its >= 140 km/h stretches from the same entry speeds).
