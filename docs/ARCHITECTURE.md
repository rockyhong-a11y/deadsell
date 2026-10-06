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
src/game/player/*               Player controller, weapons, skills, projectiles, uniques.ts (entities of the A-SSS uniques)  [player]
src/game/items/*                item catalogue, rolling, pickups, item drops          [player]
src/game/enemies/*              enemy AI, enemy projectiles, createEnemy, pools       [enemies]
src/game/boss/*                 The Iron Matron, boss projectiles/hazards             [enemies]
src/game/enemies/variants.ts    30 enemy types: 6 bases + 24 variants (table, spawn picker)  [enemies]
src/game/miniboss/*             4 mid-bosses (abbess, arachne, valkyrie, witch), hazards  [enemies]
src/game/allies/golem.ts        누더기 골렘: player-team Actor that follows / slams / leashes; spawnRunGolem, newGolemState  [economy]
src/game/level/*                templates, generator, populate, LevelRenderer         [level]
src/game/props/*                interactables & decor (doors, chests, altars, NPCs, shop, fountain, torches, gates) [level]
                                + the 쉼터 of docs/CONTENT3.md / CONTENT4.md: seamstress.ts (Selma: crafting), golemPile.ts, stashChest.ts (보관함)  [economy]
src/game/ui/*                   touch gestures, virtual buttons (vbuttons.ts), HUD, overlays, minimap, menus, settings screen (settings.ts),
                                codex screen (codex.ts) + its entry list (codexData.ts), stashModal.ts (보관함), craftModal.ts (조합)  [ui]
src/game/rules.ts               shared tuning numbers (crit, affixes, scroll/flask/food, tier/elite scaling, loot, CORPSE / LOOP / GOLEM, SPRINT, STASH, GRADES / CRAFT) read by gameplay AND the codex [core]
src/game/scenes/{title,death,victory}Scene.ts                                         [ui]
src/game/meta/*                 save (loop / pieces / stash / shards), Alchemist upgrades, bank.ts (carried pieces -> bank, winning a run), stash.ts (the stash operations),
                                craft.ts (recipes: plan / craft)  [ui]
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
* UI: `LevelUI` (`modal`, `toast`, `openChoice`, `openAlchemist`, `openStash`, `openCraft`, `openMap`, `openPause`, `boss`).

## 시체 조각, 쉼터, 골렘, 회차 (docs/CONTENT3.md, changed by docs/CONTENT4.md)
* **State.** `save.loop` (1..99, goes up when the Iron Matron falls), `save.pieces` (the bank), `save.stash`, `save.shards` (the loop of each bell shard); `run.loop` (copied from the
  save by `applyRunStart`), `run.pieces` (carried, lost on death like cells), `run.golem` (`{hp, maxHp}` | null). Old saves with `body` / `loopRuns` load (both ignored). Every number is in
  `rules.ts`: `CORPSE` (drops 1 / 3 / 8 / 12), `LOOP` (+30 % hp, +20 % damage, +5 points elite chance, golem cost 30 + 15 per step, steps = min(loop, 5) - 1: `loopK`, `loopHpMul`,
  `loopDmgMul`, `loopEliteBonus`, `golemCost`, `golemStatMul`), `GOLEM`.
* **Drops.** `dropLoot(world, x, y, { cells, gold, pieces })` scatters `Coin` pickups of kind `'piece'` (the `corpse` sheet, `piece_big` from `CORPSE.big`);
  they home in on the heroine like cells and emit `pickup` events with `what: 'pieces'` (the HUD adds a counter and a `+N 조각` toast).
  `Enemy` / `MiniBoss` / `Matron` call it from `dropRewards` / `die`.
* **Loops.** Enemies, mid-bosses and the Matron read `world.run.loop` in `init()` (hp x `loopHpMul`, damage x `loopDmgMul`); `populateLevel` adds
  `loopEliteBonus` to the elite chance. `enemyHpMul` / `enemyDmgMul` take the loop as an optional last argument (the codex shows loop 1).
* **Banking.** `meta/bank.ts`: `bankPieces(run, save)` moves every carried piece into `save.pieces`; `LevelScene.enter` calls it when a `passage` level starts (toast `시체 조각 {n}개를 셀마에게 맡겼다`).
  `winRun(run, save)` (called by `Game.victory()`) banks the carried pieces, pushes a bell shard tagged `run.loop` into `save.shards` and sets `save.loop = min(MAX_LOOP, run.loop + 1)`;
  the victory scene shows `맡긴 시체 조각 +n`, `종탑의 파편 +1` and `다음 회차: n`. There is no loop-clear scene, no body and no corpse shop any more (docs/CONTENT4.md §0).
* **쉼터 (the `passage` level).** The template is 64 x 18 with markers `Z` (seamstress), `K` (stash chest) and `G` (golem pile) (`MARKER_SPAWN`, spawn types `seamstress` / `stash` / `golem_pile`).
  `GolemPile` pays `golemCost(loop)` from the **bank** (`save.pieces`, persisted at once), plays `assemble` and spawns the `Golem`; `newGolemState(run)` creates the slot.
* **Golem.** `allies/golem.ts`: a `team: 'player'` Actor (enemy melee / area attacks hit it through `hitArea`, enemy AI keeps targeting the heroine).
  It writes its hp into `run.golem` every step, so `LevelScene` can bring it to the next level with `spawnRunGolem(world, player, level.kind)`
  (healed in every 쉼터).

## 보관함, 조합, 등급 (docs/CONTENT4.md §2-§4)
* **Stash.** `save.stash: StashEntry[]` (= `ItemInstance`, optional `mb: true` = dropped by a mid-boss; `MiniBoss.dropRewards` sets it), at most `STASH.capacity` (24) entries without holes, sanitised by
  `sanitizeStash` in `loadSave` (unknown ids dropped, tier 1..5, an affix only when `affixPool(id)` has it). `meta/stash.ts` holds the operations on the save / run (`addToStash`, `equipFromStash`
  (the old item takes the entry's place), `depositEquipped`, `salvageEntry`, `salvageValue`: normal `1 + (tier - 1) + (affix ? 1 : 0)`, unique `GRADES[g].salvage`).
  `ItemDrop.interact` offers `보관함으로 보내기 · n/24` as the third choice when both slots are taken. `props/stashChest.ts` (`StashChest`, sheet `stash`, marker `K`: the prison start templates and the
  쉼터) opens `StashModal` (`ui/stashModal.ts`, `LevelUI.openStash`): equipment row + 6 x 4 grid + item card; `장착` (asks which slot when both are taken, `pending`), `맡기기`, `분해` (armed by the
  first press, done by the second within 3 s); keys arrows / Enter / X (`ModalKey` `'special'`, the pad's Y) / Esc. `stashLayout(W, H)` is the pure geometry.
* **Grades and recipes.** `rules.ts`: `GRADE_IDS` C B A S SS SSS, `GRADES` (badge colour, salvage, power target), `CRAFT[grade]` (`items`: stash lines `any` / `affix` / `tier` (>= `CRAFT_MIN_TIER`) / `mb` / `unique` of a grade;
  `shards: { n, minLoop }`; `pieces`; `tier` of the crafted unique). `ItemDef.grade` marks the 30 uniques (`UNIQUE_IDS`, five per grade, C and B are the ten of docs/CONTENT3.md; A to SSS are the 20 of docs/CONTENT4.md §5.3,
  next sections). Every one of the 63 ids has its behaviour now (`buildCodex` lists the items that have a `WEAPONS` / `SKILLS` entry, which is all of them). `rollItem` never returns a unique.
* **Crafting.** `meta/craft.ts`: `planCraft(grade, save)` -> `CraftPlan` (`lines` with have / need, `picks` = the stash indices that would be consumed, `shardPicks`); lines claim entries most specific first
  (unique, mb, tier, affix, any), cheapest first (lowest tier, no affix, not mb, oldest); `craftUnique(save, grade, id)` consumes them, takes the bank pieces and the shards (lowest loops first) and
  puts the unique (tier by grade, no affix) into the stash. `Seamstress` (prompt `조합`; after a craft she plays `sew` and says one of `SELMA_LINES`) opens `CraftModal` (`ui/craftModal.ts`, `LevelUI.openCraft(onCraft)`): grade tabs (Q / E, LB / RB, left / right),
  recipe lines (green / red), a mini stash grid with the entries to be consumed highlighted, the five uniques, `조합`.
* **Grade badges.** `ui/draw.ts`: `gradeBadge` (pill: item cards in the HUD, stash card, craft list, tabs, codex) and `gradeLetter` (corner letter: HUD weapon / skill icons, stash cells).

## 질주 (sprint, docs/CONTENT4.md §1)
* `rules.ts` `SPRINT`. `Player`: `sprintStep` (called from `tickFree` with the held direction) keeps the run-up timer (`runT`, only on the ground) and ends the sprint on a stop past `endGrace`, a turn or a
  wall in front; `update` ends it whenever the mode is not `free` (attack, skill, roll, slam, ledge, hurt, death) and restarts the run-up. In the air with `airKeep` a sprint keeps `vx` even with no direction.
  `onKillStreak` (listens to `enemyKilled`) counts kills within `streakWindow`; three start `startFrenzy` (`frenzyT`; every sprint is immediate, each kill refreshes it; when it runs out the run-up restarts).
* Motion: the `sprint` heroine animation, `tickSprintFx` stores a frame every `after.interval` s (the last `after.count` are drawn behind her in `after.color` / `after.frenzyColor` through `DrawOpts.tint`,
  alpha 0.35 -> 0.08), footfall dust (`footFrames`), speed lines, an ember glow in the frenzy, the pop text `광란 질주!`.
* `engine/assets.ts` `ANIM_FALLBACK` / `resolveAnim`: `AnimPlayer.play*` maps an animation the sheet does not have to its fallback (`whip_*` -> `spear_*`, `heavy_1 / 2 / 3` -> `hammer_1 / hammer_2 / sword_3`,
  `cast` -> `throw`, `sprint` -> `run`).

## Ordinary items of the expansion (docs/CONTENT4.md §5.1 / §5.2)
* **Tables.** 14 weapons in `player/weapons.ts` (`WEAPONS`) and 8 skills in `player/skills.ts` (`SKILL_BASE` + one spec constant each: `STUN_GRENADE`, `MAGNET_GRENADE`, `CLUSTER_GRENADE`, `TESLA_COIL`, `FLAME_TURRET`, `PHASER`,
  `WAVE_OF_DENIAL`, `TORNADO`; cooldowns in `ITEMS`). `WeaponDef` is `melee` | `bow` | `shield` | `staff`. New fields: melee `burn` (every hit ignites), `critBelowHp`, `critFirstAfterRoll`, `critVs` (burn / freeze / stun),
  `dash` (철 도), per hit `tip` (whip: the outer px crit) and `shoot` (`Volley`: the throwing knives leave the hand when the windup ends); bow `volley` (a full draw fans out `n` arrows over +-`spread` degrees at `frac` of the
  damage), `freeze`, `range`, `look`; shield `counter` (가시 방패: a parry strikes the attacker); staff `flame` (화염 지팡이: hold to breathe a cone).
* **Player modes.** `charge` -> `dash` (철 도: hold `dash.charge` s, let go to dash `dash.distance` px, invulnerable while `go`, every enemy on the line hit once; letting go early is the tap slash `hits[0]`), `staff` (hold: `flameBurst`
  every `flame.interval` s). `nextCritT` / `armCrit` (위상 전이: the next weapon hit within `PHASER.critWindow` s crits, whatever it is: swing, arrow, knife); `rollCritSpent` (레이피어: the first hit after a roll only).
  A skill whose `use` returns `false` (the phaser with nobody in reach) spends no cooldown. The `speed` affix shortens the katana's charge and the staff's tick like a swing; a `burn` / `bleed` affix lengthens the burn / bleed
  of items that have their own (`Math.max`), never shortens it.
* **Entities** (`player/projectiles.ts`). `Arrow` takes `ArrowOpts` (`pierce`, `range`, `outline`, `scale`, `knife`); `Grenade` has the types `stun`, `magnet` (spawns a `MagnetWell`: pulls, then bursts), `cluster` (splits into four `bomblet`s
  that burst after `BOMBLET_FUSE`, never on contact); `explode` takes a `BlastKind` (`BLAST` table) and `extra` fields (stun, knockback); `TeslaCoil` (zap + one chain, line of sight), `FlameTurret`, `Tornado` (drags enemies unless
  `knockbackTaken` < `minKnockback`, ends at a wall), `denialWave` (knockback + wipes enemy `Arrow` / `Bolt` / `Bomb` / `WebBlob`, not the ones she reflected), `flameBurst` (the cone shared by the staff and the turret).
* **Pool.** `STARTER_UNLOCKS` = the base four + the four ★ items (`grave_shovel`, `leather_whip`, `throwing_knives`, `stun_grenade`); `loadSave` always merges it in, so an old save gains the ★ items and keeps what it unlocked. Every
  other ordinary item is a `META_UPGRADES` blueprint row (`unlock_<id>`, 20-40 cells, weapons first). The Alchemist screen shows `ALCHEMIST_PAGE` (10) rows per page (`<` `>`, LB / RB, the page follows the selection; after a purchase the
  selection moves to the next upgrade still for sale). Codex: group `일반` with a `해금` row (`기본` or `연금술사 {cost}셀`).

## Unique items of grades A to SSS (docs/CONTENT4.md §5.3)
* **Tables.** 12 weapons in `player/weapons.ts` and 8 skills in `player/skills.ts` (`SKILL_BASE` + one spec constant each: `PLAGUE_CENSER`, `BONE_TURRET`, `DEATH_ORB`, `CHAIN_PRISON`, `RAG_DOLL`, `CRIMSON_RAIN`, `LAST_BELL`, `REQUIEM`; cooldowns in `ITEMS`).
  The base table of a weapon sits at the power target of its grade over the DPS of the ordinary weapon of its family (A +30 %, S +45 %, SS +60 %, SSS +80 %; 셀마의 대가위 / 신더의 불씨검 / 아홉 꼬리 채찍 a little lower because
  their signature multiplies damage), the signature on top; `tests/uniques4.test.ts` checks the ratios. New table fields: melee `toll`, `leech`, `tipPull`, `glaive`, `quake`, `bleedStacks`, `killPieces`, `fullHpMul`, `ember`, per hit
  `multi` (a lash that lands n times, each with its own box and once-per-target set) and `execute`; bow `soulfire`; shield `fullBlock`, `parryHeal`, `bell`; and a new weapon kind `wand` (`WandWeapon.bolt`, the 폭풍 지팡이).
* **Player hooks.** `Player.strike` (one test of a swing's box; `swingHit` runs it once, or once per lash) + `signatureHit` (executioner mark, extra bleed stacks, the toll ring, the ember, the whip's pull), `throwGlaive` (every n-th swing that
  connects, counted per weapon slot), `releaseQuake` (at the end of the windup, on the ground only), `fireArrow` / `fireWisps` (a full draw bursts, a short one sends wisps), `parryFeedback` pays one reward per block (`BlockState.rewarded`:
  shockwave, `parryHeal`, `parryBell`), `blockHit` stops everything inside `fullBlock`, `tickStaff` calls `chainLightning` for a wand, `onDealt` adds the leech, the requiem heal (at most once per `REQUIEM.healCd`) and the kill pieces;
  `startRequiem` / `requiemKill` (`requiemT`; the kill listener of the kill streak refunds the other slot and keeps the frenzy up). `Actor.isBoss` (set by the Matron and the mid-bosses) marks the targets the executioner, the last bell and
  the chains treat differently.
* **Entities** (`player/uniques.ts`, numbers come in as specs). `Wisp` (homing: the soul fire bow's tap shot and the ember; an ember leaves the enemy it came from and flies on to the next one), `Glaive` (out, then back to her hand, one set of
  targets for each way), `Quake` (a wave that runs along the floor, `QUAKE_H` px tall: whoever is above it is spared; the two waves of a slam share one set), `chainLightning` + `LightningArcs` (the arcs of `projectiles.ts` `drawArcs`), `PlagueAura`,
  `DeathOrb` (listens to `enemyKilled`), `ChainPrison` (stun + held on the spot unless the target is heavy), `NeedleRain`, `summonDoll` (a `Golem` with a `DollSpec`: half scale, its own hp and damage, a faster slam, never touches `run.golem`),
  `lastBell` + `GreatBell` (every enemy whose hurtbox is in the camera view; a boss takes the boss damage and no stun). `projectiles.ts` gained the blast kinds `toll` / `soul` / `death`, `ExplosionOpts.already`, `ArrowOpts.burst`, `TurretSpec`
  (the 뼈 포탑 is a `Turret` with piercing, outlined shards) and exports `dragToward` / `nearestEnemy`.
* **Text.** `signatureText` reads the tables for the 20 (`higherSignature` in `items.ts`), the codex (`codexData.ts`) has the rows of every new field, and its unique pages end with the recipe row of `CRAFT`.

## Unique items (docs/CONTENT3.md §5)
* **Identity.** An `ItemDef` with `unique: true` and a `grade` (items.ts): thirty of them (`UNIQUE_IDS`, the ten of docs/CONTENT3.md are grades C and B), crafted only at Selma. `rollItem` filters them out of every pool (drops, chests,
  pedestals, the gold shop, mid-boss drops), `affixPool` is empty for them, `loadSave` drops them from `unlocked` and `unlockedCount` does not count them.
  `itemColor(id)` is the name colour (`UNIQUE_COLOR` `#f0d9a0` for uniques, the stat colour otherwise) and `UNIQUE_TAG` (`유니크`) the tag on the item card and
  in the codex. `signatureText(id)` is the effect line, read from the tables below (item card, codex).
* **Numbers.** Weapons: `player/weapons.ts` (`bleed` + `critBleeding`, `healOnKill`, `critAfterRoll`, `critAfterHurt`, shield `shockwave`, bow `pierce`);
  skills: `player/skills.ts` (`SKILL_BASE`, `CORPSE_BOMB`, `BONE_SPIKES`, `SOUL_LANTERN`, `CHAIN_HOOK`). Every number the UI shows comes from there.
* **Hooks.** `Player` keeps `sinceRoll` / `sinceHurt` for the two crit windows and `signatureCrit` in `swingHit`; the shield's parry (`parryFeedback`)
  releases the shockwave once per block; `Arrow` takes `ArrowOpts.pierce` (a fully drawn 골수 활 shot); `Grenade` has a `corpse` type (the blast of the 시체 폭탄,
  and one chain burst for each enemy it kills). New entities in `player/projectiles.ts`: `BoneSpikes`, `SoulFlames`, `ChainHook` (the hook holds its victim
  stunned for the full `CHAIN_HOOK.stun` while it drags it, so the stun runs out after the pull).

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
  and for docs/CONTENT3.md / CONTENT4.md `pieces(n)` (carried), `bank(n)` (banked, saved), `shards(...loops)`, `loop(n)` (saved + the run), `golem()` (spawns one for the run), `stash()` / `stashAdd(id, tier?, affix?, mb?)`,
  `drop(id, tier?, affix?, mb?)` (an item on the floor), `craft(grade, id)`, `sprint()` (starts the frenzy). URL flags: `?seed=1&debug=2&god=1&level=boss&mute=1`.
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
  * `e2e/corpse.spec.ts` - docs/CONTENT3.md / CONTENT4.md §3: kills -> pieces -> HUD counter, entering the 쉼터 banks them (toast), Selma opens the craft screen, the golem pile is paid from the bank and builds a
    golem that follows into the next level, death loses carried pieces (the bank stays), the Matron's pieces are banked on victory, the HUD counters in all three control modes at 480 / 800 UI widths and all ten
    C / B uniques used in the real render loop (screenshots `e2e/__shots__/`, git-ignored; text is read by recording `fillText`).
  * `e2e/content4.spec.ts` - docs/CONTENT4.md: the sprint (run-up, 240 px/s, sprint animation, air keep), the kill-streak frenzy, the stash (send from the field with a real touch, the chest, equip with a slot choice, put
    away, salvage, reload), the keyboard flow, a C unique crafted end to end (stash + bank -> craft -> equip -> swing), the victory that banks pieces, advances the loop and keeps a bell shard, screenshots of the
    stash and craft screens at 844x390 and 667x375.
    Also: every new ordinary weapon and skill equipped with `__ds.give` and used once in the real loop (states, projectiles, hurt ghouls, cooldown, screenshots `40_item_*` / `41_item_*`), and the paged Alchemist
    screen bought from by touch (screenshots `42_alchemist_*` at 844x390 and 667x375).
  * `e2e/uniques4.spec.ts` - docs/CONTENT4.md §5.3: one unique of each grade C B A S SS SSS crafted through the debug hooks (`stashAdd` / `bank` / `shards` / `craft`), equipped from the stash with the real stash operation and used
    on three ghouls; then all 20 uniques of A to SSS equipped with `__ds.give` and used once in the real loop (states, entities drawn, hurt ghouls, cooldown, no console errors; screenshots `50_unique_*` / `51_unique_*`).
  * `e2e/codex.spec.ts` - the codex from the title (touch, keyboard, mocked pad) and from the pause menu; one screenshot per tab
    (`e2e-shots/codex_*.png`).
  * `e2e/settings.spec.ts` - settings by touch, virtual buttons with real multi-touch, a mocked `navigator.getGamepads`
    (stick, buttons, remap, menus), every filter / resolution / fit applied live (screenshots `e2e-shots/settings_*.png`).
