# Content expansion 4 — 질주(대시), 무기·스킬 3배, 보관함, 유니크 조합 (C~SSS)

Extends DESIGN.md, CONTENT2.md and CONTENT3.md and **replaces parts of CONTENT3** (§0 below). Shared contract for the art
and code agents of this expansion. All characters stay female. Ids, sheet names and animation names below are exact.
Every number lives in `src/game/rules.ts` (`SPRINT`, `STASH`, `CRAFT`, `GRADES`) or in the table of its owner
(`items.ts`, `weapons.ts`, `skills.ts`) — never copied into UI or codex text.

Decisions from the requester (2026-10-06): weapons + skills ×3 counting the uniques (21 → 63 kinds); the stash is
permanent and items can be taken out and equipped; corpse pieces become crafting material + golem currency; the loop
(회차) advances when the final boss dies.

---------------------------------------------------------------------------
## 0. What changes from CONTENT3

* **Removed**: sewing the body (몸 꿰매기), `save.body`, the 100-piece body completion, the loop-clear ending
  (`LoopClearScene`, `Game.loopClear`, `run.clearedLoop`, `meta/body.ts`), the corpse shop (`CorpseShopItem`, `C` markers,
  `UNIQUE_PRICE`, `uniquePrice`), the victory auto-sew rows, the title body meter. Delete the code, tests and codex text
  of these; keep the save loader tolerant of old saves that still carry `body` / `loopRuns` (ignore them).
* **Kept**: corpse-piece drops (1 / 3 / 8 / 12), the rag golem (cost now paid from the bank, §3), Selma (now the crafting
  NPC), loops and their scaling (`LOOP`), the 10 existing uniques (now graded C / B, §5).
* **Loop advance**: killing the Iron Matron = victory → `save.loop++` (victory screen row `다음 회차: {N}`). Title shows
  `{loop}회차`. The Matron also yields one **종탑의 파편** (bell shard) tagged with the loop it was won in (§4).
* Title tagline becomes `그들은 죽은 자를 팔았다.` (the 100-piece line no longer matches the game).

---------------------------------------------------------------------------
## 1. 질주 (sprint / dash) — Dead Cells-style run-up and kill-streak speed

Rules (`SPRINT` in rules.ts):

| key | value | meaning |
|---|---|---|
| runUp | 0.9 s | holding a direction on the ground without stopping, turning, attacking, rolling or being hit for this long starts the sprint |
| mult | 1.6 | sprint speed = RUN_SPEED × mult (150 → 240 px/s); acceleration as running |
| airKeep | true | jumping out of a sprint keeps the horizontal sprint speed until landing (or turning) |
| streakKills | 3 | kills within `streakWindow` of each other … |
| streakWindow | 2.5 s | … start **광란 질주** (frenzy) |
| frenzyTime | 5 s | during frenzy every movement is a sprint at once (no run-up); each further kill refreshes it to full |
| endGrace | 0.12 s | releasing the direction for less than this does not end the sprint (touch jitter) |

Ends: stopping (past endGrace), turning, any attack / skill / roll / slam / ledge grab / hurt, a wall in front.
A sprint that ends because the frenzy ran out falls back to a normal run (the run-up timer restarts).

Motion (must be clearly different from running):
* heroine animation `sprint` (new, §6): low forward lean, arms swept back, long strides, scarf and ponytail streaming
  horizontally;
* cyan **after-images**: every 0.05 s while sprinting store the current frame; draw the last 4 behind the heroine with
  alpha 0.35 → 0.08, tinted `#4fe3ff` (frenzy: `#ff4a6a`);
* dust puff at every footfall frame and short horizontal speed lines behind her; frenzy adds an ember aura glow;
* on frenzy start: text pop `광란 질주!` over her head, short screen-shake 1, sfx `crit` at pitch 1.3.
* HUD: none besides the above (keep UI minimal).

---------------------------------------------------------------------------
## 2. 보관함 (stash) — permanent

* `save.stash: StashEntry[]`, capacity **`STASH.capacity` = 24**. `StashEntry` = `ItemInstance` (id, tier, affix, plus
  optional `mb: true` = dropped by a mid-boss). Persists across runs and deaths. Sanitised on load (unknown ids dropped,
  tier 1..5 int, affix valid for the item, at most capacity entries).
* `ItemInstance` gains the optional `mb?: true`; mid-boss drops set it (it survives being equipped / dropped / stashed).
* **Sending to the stash from the field**: when a picked-up item would need a slot swap, the existing choice modal gets a
  third option `보관함으로 보내기 · {n}/24` (disabled with `보관함이 가득 찼다` when full). The item goes straight to the stash.
* **보관함 prop** (`StashChest`, sheet `stash`, §6): stands in the prison **start room** (next to the player start) and in
  every 쉼터 (marker `K`). Interact `보관함` → **StashModal**:
  * top row: the 4 equipped slots (2 weapons, 2 skills); below: the 24-slot grid (6 × 4); header: `시체 조각 {bank}` and
    `종탑의 파편 {n}` (with the loops), and capacity `{n}/24`;
  * select a stash item → buttons `장착` (to the matching slot type; if both slots are full, pick which one — the
    displaced item goes into the stash in its place) and `분해` (salvage → bank pieces, §3);
  * select an equipped item → `맡기기` (to the stash; the slot becomes empty — an empty primary is allowed);
  * the item card (name, grade badge, tier, affix, effect lines) of the selection is shown;
  * touch: tap cells / buttons; keyboard: arrows + Enter, `X` = 분해, Esc; gamepad: d-pad/stick, A, Y = 분해, B.
  * Same visual language and input handling as the existing modals (`ui/modals.ts`: AlchemistModal, ChoiceModal).

---------------------------------------------------------------------------
## 3. 시체 조각 = crafting material and golem currency

* Drops unchanged (1 / 3 / 8 / 12). Carried pieces (`run.pieces`) are still lost on death.
* **Banking**: entering a 쉼터 moves all carried pieces into the permanent bank `save.pieces` (toast
  `시체 조각 {n}개를 셀마에게 맡겼다`); a victory banks them too (victory row `맡긴 시체 조각 +{n}`).
* The bank pays for crafting (§4) and the golem (`30 + 15k`, k as in LOOP). Golem rules otherwise unchanged.
* **분해 (salvage)** in the stash: normal item → `1 + (tier − 1) + (affix ? 1 : 0)` pieces; unique → `GRADES[g].salvage`.
* HUD counter keeps showing the carried pieces; the stash / craft modals show the bank.

---------------------------------------------------------------------------
## 4. 유니크 조합 (crafting) — grades C B A S SS SSS

Selma's prompt becomes `조합` (sub `재봉사 셀마 · 시체 조각 {bank}`); interact → **CraftModal**:
* grade tabs `C B A S SS SSS`; each shows its recipe with have/need per line (green / red), the 5 uniques of that
  grade (icon, name, colour, signature line) to choose from, and `조합` (enabled when every line is met);
* materials are taken from the stash **automatically**: the cheapest qualifying entries (lowest tier, then no affix,
  then not mb, then oldest); the entries that will be consumed are highlighted before confirming;
* result: the chosen unique goes into the stash (needs a free slot after the materials are removed — always true since
  every recipe consumes ≥ 2 items), Selma plays `sew`, toast `{name} 조합 완료`, save persisted at once.
* Each unique can be crafted any number of times. Crafted uniques have no affix and a fixed tier by grade.

Recipes (`CRAFT` in rules.ts):

| grade | stash items consumed | special | bank pieces | unique tier |
|---|---|---|---|---|
| C | any 3 items (weapons or skills, not uniques) | — | 10 | 1 |
| B | 3 items **with an affix** (not uniques) | — | 20 | 2 |
| A | 2 items of **tier ≥ 2** + 1 **mid-boss item** (`mb`) | — | 35 | 2 |
| S | 1 **A** unique + 2 mid-boss items | 1 bell shard (any loop) | 50 | 3 |
| SS | 1 **S** unique + 1 **A** unique | 2 bell shards of **loop ≥ 2** | 80 | 3 |
| SSS | 1 **SS** unique + 1 **S** unique | 3 bell shards of **loop ≥ 3** | 120 | 4 |

Calibration: one run through prison + 쉼터 + ramparts yields ≈ 3–6 items (pedestals, chests, elites, the two mid-bosses
drop 2 items each) and ≈ 70 pieces → **a C unique after one or two repetitions of stages 1–2** (requester rule).
Bell shards: `save.shards: number[]` (the loop of each), +1 per Matron kill; SS/SSS need shards from later loops, so the
top grades follow the loops.

Grade table (`GRADES`): badge colour, salvage value, power target (DPS over the same-family normal item at equal tier,
signature on top):

| grade | badge | salvage | power target |
|---|---|---|---|
| C | `#9aa4b2` | 5 | +15 % |
| B | `#5ec24a` | 10 | +20 % |
| A | `#4f9dff` | 20 | +30 % |
| S | `#b05be8` | 35 | +45 % |
| SS | `#ff9a3d` | 55 | +60 % |
| SSS | `#ff4a58` (gold `#ffd23f` outline) | 80 | +80 % |

The grade badge (`[S]` pill in the grade colour) is drawn on item cards, stash cells, the craft list, the HUD weapon
icons (small corner letter) and the codex. Unique name colour stays `#f0d9a0`.

---------------------------------------------------------------------------
## 5. Item catalogue ×3 (Dead Cells families reused with original names)

21 → 63 kinds: weapons 13 → 39 (normal 7 → 21, unique 6 → 18), skills 8 → 24 (normal 4 → 12, unique 4 → 12).
Normal items join the random drop pool **as alchemist blueprints** (`META_UPGRADES` unlock rows, cost 20–40 cells) except
the four marked ★ which are unlocked from the start (added to `STARTER_UNLOCKS`). Uniques are crafted only (never in
drops, chests, pedestals, shops, mid-boss drops, blueprints).

New heroine animation families (§6): `whip_1..2`, `heavy_1..3`, `cast`, plus `sprint`. Until the art lands, code maps a
missing animation to a fallback (`whip_*` → `spear_*`, `heavy_*` → `hammer_1/hammer_2/sword_3`, `cast` → `throw`)
through one small helper.

### 5.1 New normal weapons (14)

| id | 이름 | colour | family / anim | mechanic |
|---|---|---|---|---|
| `broadsword` | 대검 | brutality | heavy_1..3 | slow, very wide 3-hit; 3rd hit crit |
| `frantic_sword` | 광란의 검 | brutality | sword_1..3 | crit while HP < 50 % |
| `rapier` | 레이피어 | tactics | spear_1..3 (shorter, fast) | the first hit within 1.5 s after a roll crits |
| `sadist_stiletto` | 가학의 단검 | tactics | dagger_1..4 | crit vs burning, frozen or stunned targets |
| `grave_shovel` ★ | 무덤 삽 | survival | heavy_1..2 | heavy, stuns 0.8 s; crit vs stunned |
| `torch` | 횃불 | brutality | sword_1..2 | every hit ignites (burn 3 s) |
| `leather_whip` ★ | 가죽 채찍 | tactics | whip_1..2 | reach 104 px, hits in the outer 24 px crit |
| `iron_katana` | 철 도 | brutality | heavy_3 + sprint | hold attack 0.6 s to charge, release = dash slash 120 px through enemies (invulnerable during the dash) |
| `multi_bow` | 연발 활 | tactics | bow | full draw fires 3 arrows (±8°), each 45 % damage |
| `ice_bow` | 서리 활 | tactics | bow | arrows freeze 1.2 s, 70 % damage |
| `heavy_crossbow` | 중석궁 | brutality | bow | 5 bolts in a ±14° spread, range 160 px, slow (draw 0.7 s) |
| `throwing_knives` ★ | 투척 단검 | tactics | throw | quick 2-knife volley, bleed 2 s |
| `fire_staff` | 화염 지팡이 | brutality | cast | hold: flame cone 64 px, 9 dmg / 0.15 s + burn; moveScale 0.3 |
| `spiked_shield` | 가시 방패 | brutality | shield | parry deals 40 + bleed; block 75 % |

### 5.2 New normal skills (8)

| id | 이름 | colour | cast | mechanic | cd |
|---|---|---|---|---|---|
| `stun_grenade` ★ | 섬광탄 | tactics | throw | stun 2 s in r 64, 6 dmg | 12 |
| `magnet_grenade` | 자석 수류탄 | tactics | throw | pulls enemies in r 96 to the centre for 0.6 s, then 24 dmg | 13 |
| `cluster_grenade` | 집속 수류탄 | brutality | throw | blast 18 + splits into 4 bomblets (12 each) | 14 |
| `tesla_coil` | 테슬라 코일 | tactics | deploy | 8 s: zaps the nearest enemy in 140 px every 0.5 s (6 dmg, chains to 1 more) | 16 |
| `flame_turret` | 화염 포탑 | brutality | deploy | 6 s: fire cone 70 px in front, 4 dmg / 0.2 s + burn | 15 |
| `phaser` | 위상 전이 | tactics | throw | teleport behind the nearest enemy within 160 px, stun it 1 s; your next hit within 2 s crits | 10 |
| `wave_of_denial` | 거부의 파동 | survival | deploy | push every enemy in r 110 away (knockback 420), 12 dmg, destroys enemy projectiles in range | 11 |
| `tornado` | 회오리 | survival | throw | a vortex travels 200 px forward over 2 s, drags enemies along, 3 dmg / 0.2 s | 15 |

### 5.3 Uniques (30, crafted) — the existing 10 get grades C / B

| grade | weapons (3) | skills (2) |
|---|---|---|
| C | `bone_cleaver`, `stitch_needle`, `coffin_lid` (existing) | `bone_spikes`, `chain_hook` (existing) |
| B | `reaper_scythe`, `widow_fangs`, `marrow_bow` (existing) | `corpse_bomb`, `soul_lantern` (existing) |
| A | `grave_bell`, `leech_whip`, `bone_rampart` | `plague_censer`, `bone_turret` |
| S | `executioner_blade`, `storm_staff`, `moon_glaives` | `death_orb`, `chain_prison` |
| SS | `matron_flail`, `soulfire_bow`, `bell_aegis` | `rag_doll`, `crimson_rain` |
| SSS | `selma_shears`, `ember_blade`, `ninefold_whip` | `last_bell`, `requiem` |

New uniques (signatures; numbers to tune within the grade power target):

| id | 이름 | colour | family | signature |
|---|---|---|---|---|
| `grave_bell` | 장례 종 | survival | hammer_1..2 | every hit tolls: ring r 64, 12 dmg, stun 0.6 s around the target |
| `leech_whip` | 거머리 채찍 | brutality | whip_1..2 | heals 5 % of damage dealt; tip hits pull the target 30 px toward her |
| `bone_rampart` | 뼈 성벽 | survival | shield | 100 % block for the first 0.5 s of a block; a parry heals 10 % max HP |
| `plague_censer` | 역병 향로 | survival | deploy | 6 s poison aura r 72 around her, 8 dps |
| `bone_turret` | 뼈 포탑 | tactics | deploy | 10 s turret firing piercing bone shards (14 dmg) |
| `executioner_blade` | 집행자의 대검 | brutality | heavy_1..3 | 3rd hit executes non-boss enemies below 25 % HP (bosses / mid-bosses take ×3 instead) |
| `storm_staff` | 폭풍 지팡이 | tactics | cast | chain lightning: up to 5 targets, −15 % per bounce, 22 base |
| `moon_glaives` | 쌍월 칼날 | tactics | dagger_1..4 | every 4th hit throws a returning glaive (boomerang, 18 dmg both ways) |
| `death_orb` | 죽음의 구슬 | brutality | throw | 8 s orb ahead of her; enemies killed within 90 px burst (20 dmg r 48) and heal her 2 % |
| `chain_prison` | 사슬 감옥 | survival | deploy | chains root every enemy in r 120 for 2.5 s (no actions), 20 dmg |
| `matron_flail` | 여교도관의 종철퇴 | brutality | hammer_1..2 | slams send a floor shockwave both ways (30 dmg, jumpable), heavy knockback |
| `soulfire_bow` | 혼불 활 | tactics | bow | full-draw arrows explode in soul fire (r 48, burn); tap shots fire 2 homing wisps |
| `bell_aegis` | 종의 방패 | survival | shield | parry stuns every enemy within 160 px 2 s and reflects projectiles at ×2 damage |
| `rag_doll` | 누더기 인형 | survival | deploy | summons a small rag doll (half-size golem sprite) for 10 s that slams nearby enemies |
| `crimson_rain` | 핏빛 비 | brutality | throw | 2 s rain of blood needles over 160 px ahead, 5 dmg / hit, bleed |
| `selma_shears` | 셀마의 대가위 | brutality | heavy_1..3 | every hit bleeds ×2 stacks; crit vs bleeding; kills drop +1 corpse piece |
| `ember_blade` | 신더의 불씨검 | tactics | sword_1..3 | ×1.5 damage at full HP; 30 % of hits release a seeking ember (15 dmg) |
| `ninefold_whip` | 아홉 꼬리 채찍 | tactics | whip_1..2 | each lash hits 3 times in a cone (each hit once per lash), tip crits, pulls |
| `last_bell` | 마지막 종 | survival | deploy | every enemy on screen takes 120 dmg + stun 2 s (bosses / mid-bosses: 40 dmg, no stun); cd 40 |
| `requiem` | 진혼곡 | brutality | deploy | 6 s: each kill refunds 30 % of the other skill's cooldown and starts the frenzy sprint; hits heal 1 % |

All 30 uniques: `ItemDef.unique = true`, `ItemDef.grade`, no affix, tier from §4, signature line on the card and in the
codex. The C/B existing uniques keep their current numbers (they already sit near their power targets).

---------------------------------------------------------------------------
## 6. Art (Blender, DESIGN §7 pipeline)

1. **heroine** (existing sheet; frame 128×112, anchor 64,100): APPEND rows — existing rows must stay pixel-identical
   (verify with a PIL diff against the committed PNG; restore committed pixels if a re-render drifts):
   * `sprint` (8 f, loop, 14 fps) — §1 pose;
   * `whip_1` (7 f: overhead crack forward), `whip_2` (7 f: horizontal lash) with a leather whip prop (long segmented
     curve, the tip reaching ≈ 104 px in front at the active frame);
   * `heavy_1` (8 f: rising diagonal slash), `heavy_2` (9 f: overhead chop to the floor), `heavy_3` (9 f: full spin
     sweep) with a two-handed greatsword prop;
   * `cast` (6 f: one-hand staff thrust forward, the off hand flared) with a gnarled staff prop (glowing tip);
   * attack anims carry windup / active / recover frame counts in the JSON like the existing ones.
2. **icons** (existing sheet, append rows; existing frames identical): one 32×32 icon per new item id (14 + 8 + 20 = 42)
   + `bell_shard` (종탑의 파편) + `stash` (codex). Models per the names in §5 (tasteful, readable silhouettes;
   corpse / bone motifs for uniques; grade is NOT baked into the icon — the badge is drawn in code).
3. **stash** (new sheet, frame 64×80, anchor 32,78): an upright reliquary coffin with iron bands, small skull relief,
   a cyan-glowing lock; anims `idle` (6 f loop, lock glow pulse), `open` (6 f, lid swings open, cyan light spills).

---------------------------------------------------------------------------
## 7. Codex, debug, tests, docs

* Codex: 무기 tab groups `일반` / `유니크 C` … `유니크 SSS`; 스킬 likewise; each unique shows grade badge, recipe row
  (from `CRAFT`) and signature; normal items show `해금: 기본` or `해금: 연금술사 {cost}셀`. 아이템 tab: 시체 조각 (new
  rules), 종탑의 파편, 보관함, 조합 (recipe table), 누더기 골렘, plus the existing entries. Remove the body / loop-clear
  text. Everything from tables.
* Debug (`window.__ds`): `stash()` (list), `stashAdd(id, tier?, affix?, mb?)`, `bank(n)`, `shards(...loops)`,
  `craft(grade, id)`, `sprint()` (start a frenzy); `give()` accepts every id; remove `body()`.
* Unit tests: sprint run-up / end conditions / air keep / frenzy streak & refresh; stash capacity, persistence and
  sanitising, send-from-field, equip/swap/deposit/salvage values; banking at 쉼터 / on victory / loss on death; every
  recipe (have/need, auto-selection order, consumption, result tier, shards by loop); loop advance on victory and the
  bell shard; every new item's mechanic (one focused test each); rollItem never returns a unique; blueprint unlocks;
  codex coverage of all 63 items.
* e2e: sprint (run 1 s → sprint anim + speed), kill streak frenzy, stash (send from field, open chest, equip, salvage),
  craft a C unique end-to-end (stash 3 items + bank 10 → craft → equip → swing), victory → loop + shard; screenshots of
  the stash and craft modals at 844×390 and 667×375 and of the sprint after-images, looked at.
* Docs: README (Korean) sections for 질주 / 보관함 / 조합 / item lists; ARCHITECTURE modules; DESIGN §2/§5 flow.

---------------------------------------------------------------------------
## 8. Lanes and file ownership

* **Art-H**: heroine script + sheet. **Art-I**: icons script + sheet, `stash` sheet. (No `src/`.)
* **Code-1 (systems)**: §0, §1, §2, §3, §4 (framework, recipes, CraftModal with the 10 existing uniques graded and the
  new unique ids registered as `ItemDef` stubs so the list is complete), StashModal, StashChest, banking, salvage, bell
  shards, mb flag, loop advance, sprint, fallback-animation helper, debug hooks, their tests, docs.
* **Code-2 (normal items)**: §5.1, §5.2 (+ blueprints, starter unlocks, codex entries, tests).
* **Code-3 (uniques)**: §5.3 new uniques' behaviour (+ codex entries, tests).
Code lanes run one after another (shared files); art lanes run beside them.
