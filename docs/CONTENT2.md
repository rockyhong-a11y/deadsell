# Content expansion 2 — enemy variants ×5 and mid-bosses

Extends docs/DESIGN.md. Shared contract for the art and code agents of this expansion.
All characters are female. All names below are exact (sheet names, animation names).

## 1. Enemy variants (6 bases × 5 = 30 enemy types)

Each base keeps its sheet (`ghoul`, `jailer`, `archer`, `bomber`, `harpy`, `lancer`) and gets
**4 new variants**, each with its OWN sprite sheet `public/assets/sprites/<id>.png/.json`.
A variant sheet has the **same frame size, anchor and animation names as its base**
(DESIGN §8.2), so the base AI code drives it. Variants must look clearly different at 1×:
different outfit/silhouette details, weapon or prop, colour palette, hair; eye glow stays warm
(orange/red) except where noted. Behaviour differences are implemented in code on top of the base AI.

| id | 이름 | Look (art) | Behaviour twist (code) | Biome / tier |
|---|---|---|---|---|
| ghoul | 구울 | (existing) | (existing) | prison |
| ghoul_plague | 역병 구울 | bloated, sickly green skin, pustules, green rags, green eye glow | slower; on death leaves a poison cloud (r≈40 px, 3 s, DoT 4/s) | prison |
| ghoul_frenzy | 광란 구울 | emaciated, blood-red rags, wild white hair, long claws | fast; 2-swipe combo; HP ×0.7 | prison late, ramparts |
| ghoul_shackled | 족쇄 구울 | iron collar + long chain with an iron ball held in hands, grey rags | slow; attack = chain-ball swing, reach ×1.7, dmg ×1.4, knockback | prison |
| ghoul_wraith | 망령 구울 | translucent pale-blue spectral body, floating tattered dress, cyan eyes | short blink (teleport ≤90 px) behind the player before attacking; immune to knockback; HP ×0.8 | prison late, ramparts |
| jailer | 여간수 | (existing) | (existing) | prison |
| jailer_warden | 수석 간수 | heavier black-iron plate, horned helm, bigger shield, flanged mace | mace slam sends a small floor shockwave (jumpable) | prison late, ramparts |
| jailer_torch | 횃불 간수 | leather + torch instead of mace (emissive flame) | attack ignites (burn 3 s); carries a light | prison |
| jailer_spear | 창 간수 | blue tabard, spear + round shield | attack = spear thrust, reach ×1.6 | prison, ramparts |
| jailer_chain | 사슬 간수 | chainmail, hooked chain coiled on arm | ranged: throws a chain hook (≤180 px) that pulls the player in, then bashes | prison late, ramparts |
| archer | 궁수 | (existing) | (existing) | prison, ramparts |
| archer_fire | 화염 궁수 | red cloak, bow with burning arrow tips (emissive) | arrows ignite (burn 3 s) | prison, ramparts |
| archer_volley | 연사 궁수 | short bow, double quiver, teal scarf | fires a 3-arrow spread (±12°) | ramparts |
| archer_crossbow | 석궁수 | heavy crossbow, brass goggles, armored vest | long windup (1.2 s), piercing bolt, dmg ×1.8 | prison late, ramparts |
| archer_shadow | 그림자 궁수 | black hooded, mask, purple eye glow | blinks away (≤120 px) when the player gets close | ramparts |
| bomber | 폭탄마 | (existing) | (existing) | prison, ramparts |
| bomber_frost | 서리 폭탄마 | white/blue fur coat, frost bombs (cyan emissive) | bombs freeze (2 s) instead of damage ×0.6 | ramparts |
| bomber_cluster | 집속 폭탄마 | yellow-black hazard apron, big bomb sack | bomb splits into 3 bomblets on landing | ramparts |
| bomber_kamikaze | 자폭병 | crazed, bomb strapped to back with lit fuse, no satchel | runs at the player (speed ×1.8) and self-destructs (r≈50, unblockable, dmg ×1.5); dies doing it | prison late, ramparts |
| bomber_alchemist | 독약사 | purple robe, flask bandolier (green emissive) | throws a flask that leaves an acid puddle (2.5 s, DoT) | prison |
| harpy | 하피 | (existing) | (existing) | prison, ramparts |
| harpy_storm | 폭풍 하피 | grey-white wings, storm-blue hair | ranged: feather volley (3 feathers) instead of diving | ramparts |
| harpy_raven | 까마귀 하피 | black wings and hair, red eyes | faster dives (×1.4), shorter windup | ramparts |
| harpy_siren | 세이렌 | pale pink wings, long blonde hair, shell ornaments | "song": expanding ring that slows the player (−40 % speed, 2 s) | ramparts |
| harpy_ember | 불꽃 하피 | orange-red fiery wings (emissive tips) | dive impact leaves fire on the floor (2 s burn patch) | prison late, ramparts |
| lancer | 창기병 | (existing) | (existing) | ramparts |
| lancer_halberd | 미늘창 기사 | heavy grey plate, halberd, no plume | no charge; wide 2-hit halberd sweep (reach ~70 px) | ramparts |
| lancer_paladin | 성기사 | white-gold armor, kite shield in hand, golden glow | shield blocks frontal hits (like jailer); still charges | ramparts |
| lancer_duelist | 결투가 | light leather, feathered hat, rapier, cape | quick 3-thrust combo; parries (blocks) the first hit after each attack | ramparts |
| lancer_dragoon | 용기병 | dark-blue dragon-scale armor, winged helm, short spear | leaps onto the player (jump arc + AoE landing) instead of charging | ramparts |

Spawning: ENEMY_POOLS become variant-aware. Early rooms mostly base types; variants grow with
level progress (`depth` 0..1) and tier. Every biome must be able to show ≥ 12 different types
across a run. `FLYERS` include the harpy variants.

Elites: keep the elite stat boost and aura but **remove the size scaling** (scale 1.0); elites are
NOT mid-bosses.

## 2. Mid-bosses (중간 보스) — 4 new characters

One mid-boss per biome per run, picked from that biome's two by the run seed, fought in a dedicated
room on the main path (template tag `miniboss`, marker `N`). On engage: name card + a mid-boss HP bar
(event `{type:'minibossStart', boss, name}`; on death `{type:'minibossDefeated', boss}`).
**Drop on death: one weapon AND one skill** (tier + 1, affix guaranteed) via spawnItemDrop, plus
cells ×10–15 and gold ×60–100. HP ≈ 650 (prison) / 900 (ramparts) before tier scaling. Knockback 0,
hitstun only on parry/stun. Every attack is telegraphed (wind-up pose + flash + markers).

Sheets: frame **224×176, anchor (112,164)** (feet/base centre), facing +X, 32 px/unit.

| id | 이름 | Biome | Form (art) | Animations (exact) | Attacks (code) |
|---|---|---|---|---|---|
| mb_abbess | 처형인 수녀원장 | prison | ~3.0 u tall gaunt nun-executioner: black/white habit, veil, chain rosary, iron mask over the eyes, giant guillotine-blade cleaver | idle(loop) walk(loop) cleave(w/a/r) spin(loop) spin_end summon hurt death | cleave: overhead chop, floor crack line; spin: spinning blade dash across the room; summon: rings bell, 2 ghouls rise |
| mb_arachne | 거미 여왕 | prison | woman's upper body (pale, long black hair, crown of bone) on a huge black spider body with 8 legs (non-humanoid silhouette), ~2.4 u tall, ~4 u long | idle(loop) walk(loop) web(w/a/r) leap leap_land(w/a/r) bite(w/a/r) hurt death | web: shoots web blob that roots the player 1.2 s; leap: jumps to the player's position (shadow marker); bite: short lunge |
| mb_valkyrie | 발키리 기사단장 | ramparts | armored knight woman with large white feathered wings, winged helm, greatsword, blue cape | idle(loop) walk(loop) slash(w/a/r) fly(loop) dive(w/a/r) wave(w/a/r) hurt death | slash: 2-hit greatsword combo; dive: takes off, hovers, dives along a marked line; wave: sword-beam projectile along the floor |
| mb_witch | 달의 마녀 | ramparts | floating witch (no visible feet; long flowing dress), crescent-moon staff, big hat, silver hair, glowing orb familiars | idle(loop) float(loop) orb(w/a/r) blink shards(w/a/r) hurt death | orb: 3 slow homing orbs; blink: teleports to another spot; shards: moon shards fall at marked spots |

`(w/a/r)` = the spec entry carries "windup","active","recover" (sum = frames).

## 3. Files
- Art: `tools/blender/asset_<id>.py` per sheet (variants may share a parametrised builder per base,
  e.g. `asset_ghoul_variants.py` writing four sheets — `tools/build_assets.sh` runs every `asset_*.py`),
  outputs packed with `python3 tools/pack/pack_all.py <id>`.
- Code: `src/game/enemies/variants.ts` (variant table + pools), base AI hooks in the existing enemy
  files; mid-bosses in `src/game/miniboss/*.ts`; level template(s) with `N`; loader list in
  `src/engine/assets.ts` (`SHEETS`) must include every new sheet.
