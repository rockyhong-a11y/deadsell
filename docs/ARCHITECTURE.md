# Architecture & code contract

Read with docs/DESIGN.md (game design + asset contract). TypeScript, strict mode,
no runtime dependencies. `npm run dev` (Vite), `npm run typecheck`, `npm test` (Vitest,
`tests/*.test.ts`, node environment), `npm run build`.

## Frame & coordinate conventions
* Fixed step 1/60 s (`Game.step`). Pixels; y down. Tile = 24 px.
* Entity position (x, y) = **centre-bottom** of its box = the sprite anchor.
  `bounds` = `{x: x - w/2, y: y - h, w, h}`. `facing` 1 = right, -1 = left (sprites mirror).
* Two spaces. **World**: the low-res buffer `display.wctx`, `display.worldW × worldH` (height = the 해상도 setting
  288 / 360 / 432, width follows the screen aspect, limits scale with the height), camera translation applied
  (`LevelScene.render`). **UI**: `display.ui` in a fixed virtual space `display.W × display.H` (W = 480..800, H = 360 always)
  at device resolution (crisp text, `FONT` = Galmuri11), so the HUD has the same size at every world resolution.
  HUD code that follows a world object converts with `display.uiPerWorld` (see `Hud.drawPrompt`). Code that sizes
  the camera / lighting / world-buffer backdrops uses `worldW/worldH`; everything that lays out UI uses `W/H`.
* Layers: world buffer -> `display.screen` canvas (behind; nearest or bilinear blit, CRT/LCD overlay baked in
  `engine/filters.ts`, colour filters = CSS `filter` on this element only) -> `display.canvas` = the transparent UI
  canvas on top (takes the pointer events). `Display.present()` does the blit and clears the UI canvas.
  `computeLayout` (pure) fits the picture: 'fill' or 'integer' (k x k device pixels per world pixel + letterbox).
* Tap targets: every frame, UI code registers rectangles in `game.taps` (cleared each frame);
  the touch layer routes touches that start inside one to it instead of gameplay gestures.

## Module map (owner in brackets)
```
src/main.ts                     boot, loading bar                                   [core]
src/engine/config.ts            constants + DEBUG url flags                          [core]
src/engine/display.ts           world buffer + screen layer + UI canvas, resize, toVirtual, applyGfx [core]
src/engine/filters.ts           graphics options (filter / resolution / fit / quality), computeLayout, CRT/LCD overlays [core]
src/engine/gamepad.ts           Gamepad API: pure mapPad (map + deadzone + edges + menu nav), remap helpers, GamepadManager [core]
src/engine/assets.ts            loader, SpriteSheet, AnimPlayer (play/playFor/playPhased) [core]
src/engine/input.ts             action Input (press/release/tap, pressedWithin, axes per source: kb, touch, vbtn, pad) + keyboard [core]
src/engine/camera.ts            follow, bounds, shake, override (cinematics)         [core]
src/engine/math.ts, rng.ts      helpers, seeded Rng, hash2                           [core]
src/engine/audio.ts             WebAudio synth SFX + music (API: play, music, unlock) [fx]
src/game/game.ts                Game: scenes, fade, run lifecycle                    [core]
src/game/world.ts               World: entities, actors, events, hitstop, queries, breakable tiles [core]
src/game/entity.ts              Entity, Actor (hp, damage pipeline, status, drawSprite) [core]
src/game/physics.ts             moveBody (tiles, one-way platforms)                  [core]
src/game/tilemap.ts             TileMap (tiles, bg layer, explored fog)               [core]
src/game/combat.ts              DamageInfo, hitArea, isBehind, COLOR_HEX              [core]
src/game/run.ts                 RunState, LEVEL_SEQUENCE                              [core]
src/game/debug.ts               window.__ds test hooks                                [core]
src/game/scenes/levelScene.ts   level lifecycle + render order                        [core]
src/game/player/*               Player controller, weapons, skills                    [player]
src/game/items/*                item catalogue, rolling, pickups, item drops          [player]
src/game/enemies/*              enemy AI, enemy projectiles, createEnemy, pools       [enemies]
src/game/boss/*                 The Iron Matron, boss projectiles/hazards             [enemies]
src/game/enemies/variants.ts    30 enemy types: 6 bases + 24 variants (table, spawn picker)  [enemies]
src/game/miniboss/*             4 mid-bosses (abbess, arachne, valkyrie, witch), hazards  [enemies]
src/game/allies/golem.ts        누더기 골렘: player-team Actor that follows / slams / leashes; spawnRunGolem, newGolemState  [economy]
src/game/level/*                templates, generator, populate, LevelRenderer         [level]
src/game/props/*                interactables & decor (doors, chests, altars, NPCs, shop, fountain, torches, gates) [level]
                                + the 쉼터 of docs/CONTENT3.md: seamstress.ts (Selma), corpseShop.ts (시체 상점 pedestal + stock), golemPile.ts  [economy]
src/game/ui/*                   touch gestures, virtual buttons (vbuttons.ts), HUD, overlays, minimap, menus, settings screen (settings.ts),
                                codex screen (codex.ts) + its entry list (codexData.ts)  [ui]
src/game/rules.ts               shared tuning numbers (crit, affixes, scroll/flask/food, tier/elite scaling, loot, and CORPSE / LOOP / GOLEM) read by gameplay AND the codex [core]
src/game/scenes/{title,death,victory,loopClear}Scene.ts                               [ui]
src/game/meta/*                 save (loop / body / loopRuns), Alchemist upgrades, body.ts (sew the carried pieces, complete a loop)  [ui]
src/game/fx/*                   particles, fx (numbers, slashes, rings, flash), lighting [fx]
```
Only edit files your role owns. If you need something from another module that does not
exist yet, code against the stub's exported signature (stubs exist for every module) and
note the dependency in your report; do not edit the other module.

## Key APIs (stable — do not change signatures without updating every caller)
* `world.spawn(e)`, `world.entities`, `world.actors`, `world.player`, `world.run`,
  `world.ui` (LevelUI), `world.input`, `world.audio`, `world.assets`, `world.map`, `world.rng`,
  `world.camera`, `world.particles.emit(preset, x, y, opts)`, `world.fx.*`, `world.lights.add(...)`,
  `world.addHitstop(s)`, `world.shake(mag, dur)`, `world.emit(event)` / `world.on(fn)`,
  `world.query(box, filter)`, `world.nearestInteractable(x, y)`.
* Damage: build a `DamageInfo` and call `hitArea(world, box, team, info, alreadyHitSet)` or
  `actor.takeDamage(info)`. Subclasses customise via `intercept()` (block/parry/shield),
  `onHurt()`, `die()`. Never subtract hp directly.
* Events (`GameEvent` in world.ts): enemyKilled, playerHurt, playerDied, bossStart,
  bossDefeated, minibossStart, minibossDefeated, levelExit, pickup, roomEntered, tileBroken, toast.
* Interactables: implement `Interactable` (world.ts) on an Entity; the player picks the
  nearest one, the HUD shows the prompt bubble, `interact()` performs it.
* Level flow: `levelExit` event → next level; `playerDied` → death screen after 1.6 s;
  `bossDefeated` → slow-mo then victory.
* Items: `ITEMS`, `rollItem`, `itemName`, `itemLines`, `itemPrice` (items.ts);
  `dropLoot`, `spawnItemDrop`, `spawnFood`, `spawnScroll` (pickups.ts).
* Enemies: `createEnemy(kind, x, y, {tier, elite})` (`kind` = any of the 30 ids of `ENEMY_DEFS`), `pickEnemy(rng, biome, depth01, flyer)`,
  `ENEMY_POOLS`, `FLYERS`; boss: `createBoss(x, y)`; mid-boss: `createMiniBoss(id, x, y, tier)`, `pickMiniBoss(biome, seed)`
  (docs/CONTENT2.md).
* Level: `buildLevel(spec, seed, save)`, `populateLevel(world, level)`, `LevelRenderer`.
* UI: `LevelUI` (`modal`, `toast`, `openChoice`, `openAlchemist`, `openMap`, `openPause`, `boss`).

## 시체 조각, 쉼터, 골렘, 회차 (docs/CONTENT3.md)
* **State.** `save.loop` (1..99), `save.body` (0..99 pieces sewn in this loop), `save.loopRuns`; `run.loop` (copied from the save by `applyRunStart`),
  `run.pieces` (carried, lost on death like cells), `run.piecesSewn`, `run.golem` (`{hp, maxHp}` | null). Every number is in `rules.ts`:
  `CORPSE` (body 100, drops 1 / 3 / 8 / 12), `LOOP` (+30 % hp, +20 % damage, +5 points elite chance, +50 % shop prices, golem cost 30 + 15 per
  step, steps = min(loop, 5) - 1: `loopK`, `loopHpMul`, `loopDmgMul`, `loopEliteBonus`, `loopPriceMul`, `golemCost`, `golemStatMul`), `GOLEM`.
* **Drops.** `dropLoot(world, x, y, { cells, gold, pieces })` scatters `Coin` pickups of kind `'piece'` (the `corpse` sheet, `piece_big` from `CORPSE.big`);
  they home in on the heroine like cells and emit `pickup` events with `what: 'pieces'` (the HUD adds a counter and a `+N 조각` toast).
  `Enemy` / `MiniBoss` / `Matron` call it from `dropRewards` / `die`.
* **Loops.** Enemies, mid-bosses and the Matron read `world.run.loop` in `init()` (hp x `loopHpMul`, damage x `loopDmgMul`); `populateLevel` adds
  `loopEliteBonus` to the elite chance. `enemyHpMul` / `enemyDmgMul` take the loop as an optional last argument (the codex shows loop 1).
* **Sewing.** `meta/body.ts`: `sewPlan` (what a sew does), `sewPieces(run, save)` (carried -> body, capped at what the body needs; a body made whole
  runs `completeLoop`: loop + 1, body 0, loopRuns 0, the surplus is lost; returns the `LoopInfo` of the cleared loop), `bodyNeed`. `Seamstress`
  (Selma) calls it, persists the save at once, then after a 0.6 s slow-motion `game.loopClear(info)` -> `LoopClearScene` (-> title).
  `Game.victory()` sews the carried pieces on the spot and hands the `SewResult` to `VictoryScene`; a completed body sends its tap to the loop-clear scene.
* **쉼터 (the `passage` level).** The template is 64 x 18 with markers `Z` (seamstress), `C` (corpse-shop pedestal, 3x) and `G` (golem pile)
  (`MARKER_SPAWN`, spawn types `seamstress` / `corpse_shop` / `golem_pile`). `populateLevel` stocks the pedestals with `corpseShopStock(rng, 3)`:
  distinct ids from `UNIQUE_IDS` (items/types.ts; none yet = three empty "품절" pedestals); the price is `uniquePrice(id, loop)` (items.ts).
* **Golem.** `allies/golem.ts`: a `team: 'player'` Actor (enemy melee / area attacks hit it through `hitArea`, enemy AI keeps targeting the heroine).
  It writes its hp into `run.golem` every step, so `LevelScene` can bring it to the next level with `spawnRunGolem(world, player, level.kind)`
  (healed in every 쉼터). `GolemPile` pays `golemCost(loop)` pieces, plays `assemble` and spawns the `Golem`; `newGolemState(run)` creates the slot.

## Settings, control modes, graphics
`save.settings` (validated field by field in `loadSave`, old saves load with defaults): `controlMode`
('gesture' | 'buttons' | 'gamepad'), `btnSize`, `btnOpacity`, `gamepadMap` (action -> physical button), `filter`,
`resolution`, `fit`, `quality`, plus the old `sfx/music/hints/muted`. `Game.settingsChanged()` applies and saves
(display, audio, control mode); the settings screen (`ui/settings.ts`, one class used by the title scene and, wrapped in
`SettingsModal`, by the pause menu) calls it after every change.
* Keyboard input is always active. Gamepad input is polled every `Game.step` whatever the mode.
* **gesture**: `GestureRecognizer` unchanged. **buttons**: the HUD builds `vbLayout` every frame into `game.vb.layout`
  (null while a modal is open), `attachTouch` routes a pointer that starts on a virtual button (and not on a UI tap
  region) to `VButtonController` for its whole life; the recogniser still handles UI taps but no gestures
  (`gestures()` option). **gamepad**: neither touch layer drives gameplay; UI taps still work.
* Gamepad: `mapPad` (pure) -> `Game.stepPad`: gameplay edges + the 'pad' axis go to Input (unless the scene
  `captures()` the pad: a modal / the settings screen is open), menu keys (`NavKey`: direction edges with auto-repeat,
  A = confirm, B = cancel, Start = pause, Back = map) go to `scene.nav()`. Menus always use the physical A/B. While the
  remap UI waits (`pad.capture`), the next button press is delivered to it and nothing else.
* Scenes may implement `nav(k)` and `captures()`; `LevelUI.nav` feeds the top modal exactly like the keyboard.
  `NavKey` also has `tabL` / `tabR` (the physical LB / RB, whatever the gameplay map says): tabbed screens switch tabs with them
  (`Modal.tab(dir)`, Q / E on the keyboard).
  `NavKey` also has the `ScrollKey`s (`scrollUp` / `scrollDown` = 2 lines, `pageUp` / `pageDown`, `scrollTop` / `scrollEnd`) for long text
  panels (`Modal.scroll(k)`): the right stick makes `scrollUp` / `scrollDown` with its own auto-repeat (`PadState.scroll`; ignored on a pad
  whose `Gamepad.mapping` is not 'standard'), the keyboard PageUp / PageDown / Home / End and Shift+arrows (codex only).

## Codex (도감)
`ui/codex.ts` (`CodexScreen`, one class like the settings screen: the title scene shows it as a modal over the title, the pause menu
wraps it in `CodexModal`, so the run stays paused) draws tabs / entry list / detail panel from `ui/codexData.ts`, which builds one
`CodexEntry` per weapon, skill, enemy, boss, pickup, alchemist upgrade and affix **from the game's own tables** (nothing typed twice:
values that were private are exported, shared ones live in `rules.ts`; `enemyNumbers` uses the same `enemyHpMul` / `enemyDmgMul` as `Enemy`).
Only the Korean flavour text and the animation lists (an art contract) are written there; `tests/codex.test.ts` checks both against
the real `public/assets/sprites/*.json` and against real enemy / boss instances. Previews are a timeline of `PreviewStep`s on one sheet
(+ an optional prop sprite: grenade arc, turret, trap, arrow), framed from the opaque pixel bounds of their frames and drawn at a whole
number of device pixels per sprite pixel (`fitScale`); `codexLayout(W, H)` is the pure geometry (tests check it at W = 480..800).
The detail text of a page that does not fit (final boss on a narrow view: up to ~100 px too tall) scrolls by drag / wheel **and** by the
`ScrollKey`s (`CodexScreen.key`, `bodyMax` = how far it can go); `tests/codex.test.ts` walks every page at W = 480..800 to its last line.

## Testing & verification
* Unit tests per area in `tests/<area>.test.ts` (vitest, node env: no DOM at import time).
* Visual/e2e: run a dev server on your own port (`npx vite --port <p> --strictPort`) and
  drive it with Playwright (`node_modules/playwright`, Chromium is pre-installed):
  `window.__ds` offers `start(seed)`, `gotoLevel('boss')`, `god()`, `teleport(x,y)`,
  `killAll()`, `give(itemId, slot)` (the slot comes from `ITEMS[id].slot`), `step(n)`, `info()`, `spawn(enemyId, dx)`, `gotoMiniboss()`,
  and for docs/CONTENT3.md `pieces(n)` (carried), `body(n)` (sewn, saved), `loop(n)` (saved + the run), `golem()` (spawns one for the run). URL flags: `?seed=1&debug=2&god=1&level=boss&mute=1`.
  Screenshot and look at the result (Read tool) — do not assume it looks right.
* End-to-end (Playwright, `npx playwright test`, 844x390 mobile-landscape Chromium against the Vite dev server):
  * `e2e/smoke.spec.ts` - real touch gestures (CDP touch events) on the title / HUD / death screens.
  * `e2e/fullrun.spec.ts` - a complete run Title -> Prison -> Passage -> Ramparts -> Passage -> Boss -> Victory -> Title,
    death -> retry, pause/map/flask HUD, corrupted saves, fps, and a real-physics traversal of 8 seeds per biome.
    It fails on any console error/warning or page error (sound stays ON so audio errors surface). Screenshots for a human
    to look at are written to `e2e-shots/` (git-ignored).
  * `e2e/bot.ts` - `botWalk`, an in-page navigation bot: plans with `level/nav.ts` (the generator's own movement graph) and
    drives the real player through `Input` + real physics, stepping with `__ds.step`. Use it to prove an exit is reachable.
  * `e2e/helpers.ts` - boot, touch fingers, `tapRegion(id)` (taps a registered `game.taps` rectangle), event capture.
  * `e2e/corpse.spec.ts` - docs/CONTENT3.md: kills -> pieces -> HUD counter, Selma sews (body saved), the 시체 상점 pays in pieces, the golem pile builds a
    golem that follows into the next level, body 99 + 1 -> loop-clear scene -> title `2회차`, victory auto-sew, death loses carried pieces, the HUD
    counters in all three control modes at 480 / 800 UI widths (screenshots `e2e/__shots__/`, git-ignored; text is read by recording `fillText`).
  * `e2e/codex.spec.ts` - the codex from the title (touch, keyboard, mocked pad) and from the pause menu; one screenshot per tab
    (`e2e-shots/codex_*.png`).
  * `e2e/settings.spec.ts` - settings by touch, virtual buttons with real multi-touch, a mocked `navigator.getGamepads`
    (stick, buttons, remap, menus), every filter / resolution / fit applied live (screenshots `e2e-shots/settings_*.png`).
