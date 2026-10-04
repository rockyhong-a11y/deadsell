# DEADSELL — Design & Contract

A mobile-first 2D roguelite action-platformer that reproduces the core *Dead Cells*
loop (fast melee combat, procedurally assembled levels from hand-made rooms,
permanent death with meta-progression, biome → passage → biome → boss).
Mechanics follow Dead Cells closely; **all names, characters and art are original**.
Every character in the game is female.

This file is the single source of truth shared by every contributor (human or
agent). If you need to deviate from it, update this file in the same change.

---------------------------------------------------------------------------
## 1. Platform & tech

* Web (HTML5 Canvas 2D), TypeScript, Vite. Playable in a mobile browser in landscape;
  keyboard also works on desktop (for development and automated tests).
* Internal world resolution: height **360 px** by default (settings: 288 / 360 / 432), width = height × screen
  aspect, clamped to [480, 800] × (height / 360). Nearest-neighbour upscale to the device (or bilinear / CRT / LCD /
  colour filters, see Settings). UI text and HUD are drawn on a separate full-resolution canvas in a fixed 360-tall
  virtual space (width 480..800), so they stay crisp and keep their size at every world resolution.
* Fixed simulation step 1/60 s. Units are pixels, y points **down**.
* Tile size **24 px**.
* Korean UI text, font **Galmuri11** (OFL, bundled from the `galmuri` npm package).

---------------------------------------------------------------------------
## 2. Game flow

```
Title ─tap─▶ Biome 1 "Sunken Prison" (가라앉은 감옥, procedural)
             └─exit door─▶ 쉼터 (rest stop = the passage level: Alchemist + flask refill + cell spending,
                           │        Selma: sew pieces into the body / 시체 상점 / golem pile)
                           └─▶ Biome 2 "Moonlit Ramparts" (달빛 성벽, procedural)
                               └─exit door─▶ 쉼터
                                             └─▶ Boss arena "Bell of Chains" (사슬의 종탑)
                                                 └─ boss dies ─▶ Victory screen ─▶ Title
                                                    (carried pieces are sewn; body 100 ─▶ Loop-clear scene ─▶ Title)
Death anywhere ─▶ Death screen (stats, cells and pieces lost) ─▶ new run from Biome 1 (new seed)
Body made whole at Selma's (100/100) ─▶ Loop-clear scene ─▶ Title, the next 회차 (loop) starts harder
```

Corpse pieces (시체 조각, docs/CONTENT3.md): every kill drops pieces (1 / elite 3 / mid-boss 8 / the Matron 12; ≈ 100 for a full loop of
the stages). Selma, the corpse seamstress waiting in each 쉼터, sews the carried pieces into Cinder's body (permanent, `save.body` 0..99),
sells unique relics (시체 상점) and stitches a rag golem (누더기 골렘) that fights beside Cinder for the run. A body of 100 pieces clears the
loop; each loop above the first has stronger enemies (+30 % hp, +20 % damage, more elites, pricier golem / shop, ceiling at loop 5).

Run state that persists across the levels of one run: HP, max HP, flask charges,
equipment (2 weapons + 2 skills), stat levels, gold, carried cells, carried corpse pieces, the golem, kills, time.
Meta state that persists across runs (localStorage): unlocked items, upgrades
bought from the Alchemist, best time, runs won, the loop (회차) and the pieces sewn into the body.

---------------------------------------------------------------------------
## 3. Characters (all female)

| id | Name (KR) | Role | Look |
|----|-----------|------|------|
| `heroine` | Cinder (신더), the Ashen Prisoner | Player | Pale skin, long silver-white hair in a high ponytail whose tip glows cyan like an ember, glowing cyan eyes, long crimson scarf trailing behind, dark-teal corset with steel collar and pauldrons, crimson skirt over dark leggings, brown leather boots and belt with gold buckle. Agile, lean. |
| `ghoul` | 구울 (Ghoul) | Biome 1 melee grunt | Undead female prisoner: grey-green skin, long matted black hair over the face, torn grey-purple prison dress, bare feet, long clawed hands, hunched. Eyes glow orange. |
| `jailer` | 여간수 (Jailer) | Shield bearer | Stocky armored warden woman: iron helmet with braids coming out, rusty plate armor over a dark red tabard, huge tower shield (front), short mace. |
| `archer` | 궁수 (Archer) | Ranged | Hooded female archer with a dark green cloak, leather bodice, longbow, quiver; long hair visible from the hood. |
| `bomber` | 폭탄마 (Bomber) | Lobs bombs | Wild-haired alchemist-bomber girl with goggles on the forehead, apron, bandolier of round bombs, satchel. |
| `harpy` | 하피 (Harpy) | Flyer (Biome 2) | Woman with large dark-violet feathered wings instead of arms, taloned feet, wild hair, flies and dives. |
| `lancer` | 창기병 (Lancer) | Charger (Biome 2) | Tall armored knight woman, plumed helmet with ponytail, long lance, kite shield on back, purple/gold heraldry. Charges across the screen. |
| `matron` | 강철 여교도관 (The Iron Matron) | Boss | Giant (≈2.4× player height) armored jailer-queen: spiked iron crown/helm, long braid, massive pauldrons, chain wrapped around the body, a huge iron bell-flail (a bell on a chain) as weapon, glowing ember eyes, tattered dark cape. |
| `alchemist` | 연금술사 모르웬 (Morwen) | Meta NPC (Collector role) | Tall hooded alchemist woman with a bird-beak plague mask pushed up on her head, many glowing blue vials on her coat, a huge backpack with a tank of cells. |
| `merchant` | 상인 펠 (Pell) | Shop NPC | Cheerful merchant woman with a big backpack of goods, wide hat, scarf, lantern. |
| `seamstress` | 재봉사 셀마 (Selma) | 쉼터 NPC (docs/CONTENT3.md) | Tall gaunt corpse seamstress: bone-white skin with stitch lines, black hair in a bun pierced with needles, monocle, patchwork dress, measuring-tape scarf, thread spools, huge shears on her back. Sews the body, runs the 시체 상점. |
| `golem` | 누더기 골렘 (Rag Golem) | Player's ally | Big (≈ 1.6× the heroine) female rag-doll giant of burlap and corpse-pale patches, dark-red yarn braids, two cyan button eyes (Cinder's ember), stitched smile, bandaged fists. Built at the golem pile in the 쉼터. |

Elite enemies are the normal sprite at 1.0× scale with a stat boost and a coloured aura (code side; see docs/CONTENT2.md — elites are not mid-bosses).

---------------------------------------------------------------------------
## 4. Controls (touch first, minimal UI)

The default mode ("터치 제스처") splits the screen in two invisible zones. No on-screen d-pad, no attack buttons.
Settings (title screen / pause menu) offer two more control modes, the keyboard always works:
* **가상 버튼**: d-pad (← → ↓) bottom-left; 공격 / 점프 / 구르기 / 보조 and the equipped skills bottom-right; true multi-touch,
  size and opacity options, gesture recognition off.
* **게임패드**: Gamepad API, standard layout, remappable (default A jump, B roll, X attack, Y secondary, LB heal,
  RB interact, LT/RT skills, Back map, Start pause; stick/D-pad move, A/B confirm/back in every menu).

| Zone / gesture | Action |
|---|---|
| Left half: touch & drag | Floating joystick (appears faintly where the thumb lands). Horizontal = move. Down = drop through platform when combined with jump/swipe-down. |
| Right half: tap | Primary weapon attack (tap repeatedly to continue the combo) |
| Right half: swipe up | Jump (again in the air = double jump). Holding the finger after the swipe keeps the full jump height; lifting early cuts it. |
| Right half: swipe left/right | Dodge roll in that direction (i-frames, passes through enemies) |
| Right half: swipe down | In air: ground slam. On a platform: drop through. |
| Right half: long press (≥ 0.22 s) | Secondary weapon (bow: hold to draw, release to shoot; shield: hold to block, early = parry; melee: attacks while held) |
| Tap the small flask icon (HUD, top-left) | Drink health flask |
| Tap one of the two small skill icons (bottom-right corner) | Use skill 1 / 2 |
| Tap the floating prompt bubble above an object | Interact (open chest, pick item, talk, enter door) |
| Tap minimap (top-right) | Open full map; tap anywhere to close |

Keyboard (dev/test): A/D or ←/→ move, S/↓ down, W/↑ or Space jump, J attack1, K attack2,
L or Shift roll, Q skill1, E skill2, F interact, R heal, M map, Esc pause.

---------------------------------------------------------------------------
## 5. Core mechanics (numbers are starting values; tune in code)

Player movement: run 150 px/s (reach full speed in ~0.08 s), gravity 1300 px/s², max fall
540 px/s, jump height ≈ 80 px (v ≈ 456 px/s), double jump ≈ 0.9×, coyote 0.1 s,
jump buffer 0.12 s, variable jump (release → vy × 0.4). Roll 0.32 s at 300 px/s,
invulnerable 0.04–0.30 s, cancels attack recovery. Ground slam: dive 620 px/s,
AoE damage + stun on landing. Ledge grab & auto-climb. One-way platforms.
No ladders (vertical travel = platforms and jumps).

Combat: hit-stop 50–80 ms on hits, small screen shake, knockback, white hit flash,
damage numbers (crits yellow and larger). Enemies telegraph every attack (wind-up
pose + flash + "!" mark). No contact damage — only attacks hurt.
"Rally": damage taken leaves a recoverable segment on the HP bar that decays over
~3 s; dealing damage restores 30 % of damage dealt from that segment.
Stats (Dead Cells "scrolls"): **Brutality (red, 잔혹)**, **Tactics (purple, 전술)**,
**Survival (green, 생존)**. Each item has one colour; its damage × (1 + 0.15 × level).
Every scroll: +10 % max HP (Survival scroll +20 %).
Status effects: burn (DoT), bleed (stacking DoT), freeze (stops enemy), stun.
Crit = ×2 damage.

Items (`id`: name, colour, notes)
* Melee: `rusty_sword` 녹슨 검 (red, 3-hit combo), `blood_sword` 피의 검 (red, 2-hit, bleed),
  `spear` 창 (red, long thrusts, 3rd hit crits), `twin_daggers` 쌍단검 (purple, 4 fast hits,
  crit from behind), `war_hammer` 전쟁 망치 (green, 2 slow AoE hits, stun)
* Ranged: `hunter_bow` 사냥꾼의 활 (purple)
* Shield: `old_shield` 낡은 방패 (green, block / parry)
* Skills: `fire_grenade` 화염 수류탄, `ice_grenade` 얼음 수류탄, `turret` 석궁 포탑,
  `wolf_trap` 늑대 덫 (all purple)
* Pickups: cells (blue orbs, meta currency), gold, food (heals), scroll of power (choose a
  colour), health flask refill (passage fountain).
* Items have a tier (+damage per biome) and may roll one affix (burn on hit, bleed on hit,
  +20 % damage, +15 % attack speed, heal on kill).

Meta (Alchemist in each passage; cells are lost on death unless spent there):
+1 flask charge (×2), +100 starting gold, and unlocking items into the drop pool
(`blood_sword`, `spear`, `twin_daggers`, `war_hammer`, `ice_grenade`, `turret`, `wolf_trap`).
A new save starts with `rusty_sword`, `hunter_bow`, `old_shield`, `fire_grenade` unlocked.

Boss "The Iron Matron" (2 phases): bell-flail overhead slam (shockwave along the
floor — jump over it), horizontal flail sweep, shoulder charge across the arena
(roll through it; she crashes into the wall and is stunned), leap + crash. Phase 2
(≤ 50 % HP): roars, chains/debris fall from the ceiling, attacks chain faster.

---------------------------------------------------------------------------
## 6. Level structure

Levels are assembled from hand-made ASCII room templates on a macro grid.

* Chunk = **32 × 18 tiles** (768 × 432 px). A template covers w × h chunks (w,h ∈ 1..3).
* Door sites are at fixed positions on chunk edges, so any two templates can connect:
  * **side door** (between horizontally adjacent chunks): tile rows 12–15 open
    (4 tall), row 16 is solid floor on both sides of the edge.
  * **vertical door** (between vertically adjacent chunks): tile columns 14–17 open
    (4 wide). Templates with a top door must provide a jump path (one-way platforms
    ≤ 3 tiles apart vertically) from their floor to the opening.
* A template "offers" a door site simply by leaving those edge tiles open; the
  generator seals the sites it does not use.
* Every template must be internally connected between all of its door sites with the
  player's movement (verified by an automated test).

Template legend:
```
#  solid            =  one-way platform     ^  spikes        x  breakable (secret) wall
.  empty (interior, back wall drawn)        ,  empty (open sky / far background visible)
E  ground enemy     F  flying enemy         T  treasure chest   S  scroll altar
I  item pedestal    M  merchant             A  alchemist        P  player start
X  exit door        B  boss                 L  torch/light      D  random decoration
$  shop item slot   H  health fountain
Z  seamstress (Selma, 쉼터)   C  corpse-shop pedestal (3 per 쉼터)   G  golem pile
```

---------------------------------------------------------------------------
## 7. Art direction

* 3D models built **by script in Blender** (`tools/blender/*.py`, using `common.py`),
  rendered orthographically with flat 3-band toon shading and **no anti-aliasing**,
  then post-processed into pixel art (`tools/pack/sheet.py`: hard alpha + 1 px dark
  outline `#120a1a`). This is the same 3D→pixel pipeline Dead Cells used.
* Scale: **1 Blender unit = 32 px**. Heroine ≈ 1.75 u ≈ 56 px tall.
* Camera: orthographic, character faces **+X** (right), camera yawed ~20° toward the
  front, pitch ~4°. Only right-facing frames are rendered; the game mirrors.
* Lighting: warm key light from upper front, cool rim `#9fe8ff` from behind
  (`toon(..., rim=...)`). Shadows are pushed toward purple/blue.
* Look: dark, high-contrast, saturated accents; glowing eyes/embers use emission
  materials. Enemies have warm (orange/red) glowing eyes so they read against
  backgrounds; the heroine glows cyan.
* Silhouettes must read as female at 56 px: hair, waist/hips, skirts/dresses, faces.

---------------------------------------------------------------------------
## 8. Asset contract

Pipeline: `tools/build_assets.sh` runs every Blender script, each of which writes PNG
frames + `spec.json` into `build/frames/<sheet>/` (git-ignored), then
`python3 tools/pack/pack_all.py` packs them into `public/assets/sprites/<sheet>.png`
+ `<sheet>.json`. Each Blender script must be runnable on its own:
`blender -b --factory-startup -P tools/blender/<script>.py`.
`python3 tools/pack/contact.py build/frames/<sheet> build/preview/<sheet>.png 3`
writes an upscaled contact sheet for visual review.

### 8.1 Sprite sheet manifest (`public/assets/sprites/<sheet>.json`)
```json
{ "image": "heroine.png", "frameW": 128, "frameH": 112, "anchor": [64, 100],
  "animations": {
    "idle":    { "row": 0, "frames": 8, "fps": 10, "loop": true },
    "sword_1": { "row": 5, "frames": 8, "fps": 16, "loop": false,
                 "windup": 3, "active": 2, "recover": 3 } } }
```
* One animation per row, frames left→right.
* `anchor` = the pixel that corresponds to the entity's position: **centre of the feet**
  (bottom of the hitbox) for every character, including flyers.
* Attack animations carry `windup`/`active`/`recover` frame counts (sum = frames). The
  game stretches each phase over its gameplay duration, so frame counts and
  gameplay timing are decoupled. `active` frames show the blade at full extension.
* Animations not marked `loop` hold their last frame.

### 8.2 Required sheets and animations (names are exact)

**`heroine`** — frame 128×112, anchor (64,100). Weapons are visible only in the attack
animations that use them (Dead Cells style); idle/run show her unarmed (sword on back optional).
```
idle(loop) run(loop) jump fall(loop) land double_jump roll ledge_climb hurt death
slam_dive(loop) slam_land heal(drinks a flask) throw(skill throw) deploy(kneel & place)
sword_1 sword_2 sword_3          (rusty sword; also used by blood_sword with code tint)
spear_1 spear_2 spear_3          (long thrusts; reach ≈ 64 px in front)
dagger_1 dagger_2 dagger_3 dagger_4   (very fast stabs/slashes, two daggers)
hammer_1 hammer_2                (huge two-handed hammer: overhead slam, then sweep)
bow_draw bow_shoot               (draw holds last frame while charging)
shield_block shield_parry        (shield raised; parry = quick bash)
```
Attack animations need `windup/active/recover`. Reach guide (px in front of the anchor):
sword ≈ 44, spear ≈ 64, daggers ≈ 30, hammer ≈ 52 (and above head).

**Enemies** — frame 128×112, anchor (64,100) unless noted.
```
ghoul:   idle walk attack(windup/active/recover) hurt death
jailer:  idle walk attack(shield bash + mace) block hurt death
archer:  idle walk shoot(windup=draw/active=release/recover) hurt death
bomber:  idle walk throw(windup/active/recover) hurt death
harpy:   fly(loop) dive_windup dive(loop) recover hurt death        (anchor = talons)
lancer:  idle walk charge_windup charge(loop) thrust(windup/active/recover) hurt death
```
**`matron`** (boss) — frame 288×224, anchor (144,212). Height ≈ 4.2 u ≈ 134 px.
```
idle walk slam(w/a/r) sweep(w/a/r) charge_windup charge(loop) crash(stunned against wall)
leap(rise) leap_fall(loop) leap_land roar summon hurt death
```
**NPCs** — frame 128×128, anchor (64,116): `alchemist`: idle talk ; `merchant`: idle talk.

**Projectiles & skill objects** — sheet `projectiles`, frame 48×48, anchor (24,24) (centre):
```
arrow  bomb(loop, lit fuse)  fire_grenade(loop)  ice_grenade(loop)  boss_debris
turret_deploy turret_idle(loop) turret_shoot   trap_open trap_snap   feather
```
**Pickups** — sheet `pickups`, frame 24×24, anchor (12,22):
```
cell(loop glow)  gold_coin(loop spin)  gold_pile  food_apple  food_bread  food_meat
scroll_red scroll_purple scroll_green  flask
```
**Props** — sheet `props`, frame 96×96, anchor (48,92) (bottom-centre):
```
door_exit(closed→open anim)  chest(open anim; frame0 = closed)  altar(loop glow)  pedestal
torch(loop, wall torch; anchor = bracket)  fountain(loop)  shop_stall  cage  chains  barrel
crates  bones  banner  boss_gate(open anim)  bell(boss arena decor)
```
**Item icons** — sheet `icons`, frame 32×32, anchor (16,16); one 1-frame animation per item id
(`rusty_sword blood_sword spear twin_daggers war_hammer hunter_bow old_shield
fire_grenade ice_grenade turret wolf_trap`), plus `cells gold flask scroll`.

### 8.3 Tiles & backgrounds
* `public/assets/tiles/<biome>.png` + `<biome>.json`, biomes: `prison`, `ramparts`, `tower`
  (boss arena). 24 px cells; the JSON names regions, e.g.
  `{"tile":24,"fill":[[x,y],...],"top":[...],"bottom":[...],"left":[...],"right":[...],
  "outer":{"tl":[x,y],...},"inner":{...},"platform":{"l":..,"m":[..],"r":..},
  "backwall":[...],"backdeco":{...},"spikes":[...],"breakable":[...]}` (cell coordinates).
* `public/assets/bg/<biome>_<n>.png` parallax layers + `public/assets/bg/<biome>.json`
  `{"sky":"#hex","layers":[{"image":"prison_0.png","parallax":0.1,"y":0,"repeatX":true}]}`.
* `public/assets/ui/title.png` title key art (heroine), `public/assets/ui/boss_portrait.png`.

### 8.4 Fallbacks
Code must run when an asset is missing: the loader substitutes a coloured placeholder
box with the right frame size/anchor so gameplay work never blocks on art.
