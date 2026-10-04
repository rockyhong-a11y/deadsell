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
src/game/level/*                templates, generator, populate, LevelRenderer         [level]
src/game/props/*                interactables & decor (doors, chests, altars, NPCs, shop, fountain, torches, gates) [level]
src/game/ui/*                   touch gestures, virtual buttons (vbuttons.ts), HUD, overlays, minimap, menus, settings screen (settings.ts) [ui]
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
  * `e2e/settings.spec.ts` - settings by touch, virtual buttons with real multi-touch, a mocked `navigator.getGamepads`
    (stick, buttons, remap, menus), every filter / resolution / fit applied live (screenshots `e2e-shots/settings_*.png`).
