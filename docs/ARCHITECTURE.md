# Architecture & code contract

Read with docs/DESIGN.md (game design + asset contract). TypeScript, strict mode,
no runtime dependencies. `npm run dev` (Vite), `npm run typecheck`, `npm test` (Vitest,
`tests/*.test.ts`, node environment), `npm run build`.

## Frame & coordinate conventions
* Fixed step 1/60 s (`Game.step`). Pixels; y down. Tile = 24 px.
* Entity position (x, y) = **centre-bottom** of its box = the sprite anchor.
  `bounds` = `{x: x - w/2, y: y - h, w, h}`. `facing` 1 = right, -1 = left (sprites mirror).
* World drawing happens in the low-res buffer `display.wctx` with the camera
  translation applied (`LevelScene.render`). UI is drawn on `display.ui` in the same
  virtual coordinates (W × 360) but at device resolution (crisp text, `FONT` = Galmuri11).
* Tap targets: every frame, UI code registers rectangles in `game.taps` (cleared each frame);
  the touch layer routes touches that start inside one to it instead of gameplay gestures.

## Module map (owner in brackets)
```
src/main.ts                     boot, loading bar                                   [core]
src/engine/config.ts            constants + DEBUG url flags                          [core]
src/engine/display.ts           world buffer + UI canvas, resize, toVirtual          [core]
src/engine/assets.ts            loader, SpriteSheet, AnimPlayer (play/playFor/playPhased) [core]
src/engine/input.ts             action Input (press/release/tap, pressedWithin, axes) + keyboard [core]
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
src/game/level/*                templates, generator, populate, LevelRenderer         [level]
src/game/props/*                interactables & decor (doors, chests, altars, NPCs, shop, fountain, torches, gates) [level]
src/game/ui/*                   touch gestures, HUD, overlays, minimap, menus         [ui]
src/game/scenes/{title,death,victory}Scene.ts                                         [ui]
src/game/meta/*                 save, Alchemist upgrades                              [ui]
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
  bossDefeated, levelExit, pickup, roomEntered, tileBroken, toast.
* Interactables: implement `Interactable` (world.ts) on an Entity; the player picks the
  nearest one, the HUD shows the prompt bubble, `interact()` performs it.
* Level flow: `levelExit` event → next level; `playerDied` → death screen after 1.6 s;
  `bossDefeated` → slow-mo then victory.
* Items: `ITEMS`, `rollItem`, `itemName`, `itemLines`, `itemPrice` (items.ts);
  `dropLoot`, `spawnItemDrop`, `spawnFood`, `spawnScroll` (pickups.ts).
* Enemies: `createEnemy(kind, x, y, {tier, elite})`, `ENEMY_POOLS`, `FLYERS`; boss: `createBoss(x, y)`.
* Level: `buildLevel(spec, seed, save)`, `populateLevel(world, level)`, `LevelRenderer`.
* UI: `LevelUI` (`modal`, `toast`, `openChoice`, `openAlchemist`, `openMap`, `openPause`, `boss`).

## Testing & verification
* Unit tests per area in `tests/<area>.test.ts` (vitest, node env: no DOM at import time).
* Visual/e2e: run a dev server on your own port (`npx vite --port <p> --strictPort`) and
  drive it with Playwright (`node_modules/playwright`, Chromium is pre-installed):
  `window.__ds` offers `start(seed)`, `gotoLevel('boss')`, `god()`, `teleport(x,y)`,
  `killAll()`, `give(itemId, slot)`, `step(n)`, `info()`. URL flags: `?seed=1&debug=2&god=1&level=boss&mute=1`.
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
