# Content expansion 3 — 시체 조각 (corpse pieces), 시체 상점, 누더기 골렘, 회차 (NG+)

Extends docs/DESIGN.md and docs/CONTENT2.md. Shared contract for the art and code agents of this expansion.
All characters are female (the golem is a female rag-doll construct). Names below are exact (ids, sheet names,
animation names). Every number lives in `src/game/rules.ts` (`CORPSE`, `LOOP`, `GOLEM`) or in the table of its owner
(unique items: `items.ts` / `weapons.ts` / `skills.ts`) — never copied into UI or codex text.

---------------------------------------------------------------------------
## 0. The title: DEAD + SELL (story)

The Sunken Prison is a corpse market. Prisoners who die there are cut apart and **sold piece by piece** from the
Bell of Chains; the Iron Matron keeps the books. Cinder (신더) was executed and her body was sold off in
**100 pieces**. What walks out of the cell is her ember-soul (the cyan glow) in a hollow frame, with nothing of
her own left: **0 pieces**. Every prisoner and guard she cuts down carries a stolen scrap of the dead
(시체 조각). Selma (셀마), a corpse seamstress who used to stitch "merchandise" for the Matron and defected,
waits in each rest stop (쉼터). She can

1. **sew** the pieces back into Cinder's body (permanent progress),
2. **sell** relics she stitched from the dead (시체 상점: unique weapons and skills), or
3. **stitch the leftovers into a rag golem** (누더기 골렘) that fights beside Cinder.

When the body is whole (100/100) the bell tolls once more, the Matron's chain-curse tears her apart again,
and the next loop (회차) begins — harder.

Tagline (title screen, under the logo): `그들은 나를 백 조각으로 나눠 팔았다.`

The passage level is renamed **통로 → 쉼터** in every player-facing string (LEVEL_SEQUENCE names, codex text, death
screen hint). Code ids stay `passage`.

---------------------------------------------------------------------------
## 1. Rules (decisions — the assumptions are listed in §9)

State:
* `save.loop` — current loop (회차), starts at **1**. Persists.
* `save.body` — pieces sewn into the body in the current loop, **0..99** (100 completes the loop and resets to 0).
* `run.pieces` — pieces carried in this run (at risk). `run.loop` is copied from `save.loop` at run start.
* `run.piecesSewn` — sewn during this run (stats). `run.golem: { hp: number; maxHp: number } | null`.

Gaining pieces — every kill drops corpse-piece pickups (physical pickups that fly to the heroine like cells):

| source | pieces |
|---|---|
| ordinary enemy | 1 |
| elite enemy | 3 |
| mid-boss | 8 |
| the Iron Matron | 12 |

A biome level holds ≈35 enemies (measured: 27–47), so a full loop of the stages (prison → 쉼터 → ramparts → 쉼터 →
boss) killing everything yields ≈ 70 + elites ≈10 + mid-bosses 16 + boss 12 ≈ **100–110** — this is the
"전체 스테이지 루프 100개 기준" calibration. Chests and the golem pile drop none.

Keeping pieces:
* Carried pieces are **lost on death** (death screen row `잃어버린 시체 조각`), exactly like cells.
* At a 쉼터, talking to Selma **sews all carried pieces** into the body (only as many as the body still needs;
  any surplus stays carried). Sewn pieces are permanent.
* On victory over the Matron, carried pieces are **sewn automatically** (victory stats row `꿰맨 시체 조각 +N`).

Completing the body (= loop clear):
* When a sew brings `save.body` to **100**: the run ends right there with the **Loop-clear scene**
  (`LoopClearScene`), `save.loop++`, `save.body = 0`; any surplus carried pieces are lost (2회차 starts at 0 like
  the first). Selma's prompt warns before it happens (§3). After a victory auto-sew completes it, the victory
  scene's tap goes to the loop-clear scene instead of the title.
* The loop-clear scene: title `온전한 몸`, subtitle `{N}회차 클리어`, a 3-line typewriter epilogue, stats
  (`회차`, `도전 횟수` (runs this loop), `처치한 적` (this run)), then `{N+1}회차 시작 — 적이 강해집니다`; tap → title.

Spending instead of sewing (the choice the design is about): carried pieces can be spent at the corpse shop
or on the golem **before** sewing. Spent pieces never reach the body.

Loop scaling (`LOOP`, k = min(loop, 5) − 1, so loop 5+ is the ceiling):

| what | per loop above 1 |
|---|---|
| enemy / mid-boss / Matron HP | × (1 + 0.30 k) |
| enemy / mid-boss / Matron damage | × (1 + 0.20 k) |
| elite chance (biome levels) | + 0.05 k (absolute, after the existing clamp) |
| golem cost | 30 + 15 k (`1회차 기준 30`) |
| corpse-shop prices | × (1 + 0.5 k), rounded |
| golem HP and damage | × (1 + 0.30 k) (keeps pace with enemy HP) |

`save.runs` per loop: add `save.loopRuns` (runs started in the current loop; reset at loop clear) for the scene stat.

---------------------------------------------------------------------------
## 2. HUD and screens

* HUD: a third counter `시체 조각` (icon `corpse_piece` from the `icons` sheet, colour `#e8d7c3` bone, outline
  red stitch) under / next to cells and gold, with the same pop animation and `+N 조각` aggregated toast.
  Must fit all three control modes (gesture / buttons / gamepad) at 480×360 and 800×360 UI sizes.
* Title: under the existing stats line, `{loop}회차 · 몸 {body}/100` plus a small body meter: the heroine `idle`
  frame drawn as a dark silhouette with the sewn share filled in from the feet up (clip rect), bone colour with a
  red rim. Tagline under the logo (§0).
* Death screen: row `잃어버린 시체 조각` (only shown value, coloured when > 0) and hint
  `※ 꿰매지 않은 시체 조각은 사라졌습니다. 쉼터의 재봉사 셀마에게 맡기세요.` (the cells hint already exists;
  show both when both apply, keep it readable at 480 wide — two lines max).
* Victory screen: row `꿰맨 시체 조각 +N` and `몸 {body}/100`.
* Loop-clear scene: §1. Same visual language as VictoryScene (embers, gradient), but bone/red palette.

---------------------------------------------------------------------------
## 3. 쉼터 (passage) contents

Template `passage` grows from 48 to **64** columns (same 18 rows); keep P, A (alchemist), H (fountain), X (exit),
torches and decorations, and add:

| marker | spawn type | what |
|---|---|---|
| `Z` | `seamstress` | Selma, the corpse seamstress (NPC, interactable) |
| `C` | `corpse_shop` | one corpse-shop pedestal (3 markers → 3 slots) |
| `G` | `golem_pile` | the rag pile where the golem is stitched (interactable) |

Layout left → right on the floor row: `P … A … H … Z C C C … G … X`. Must pass the template tests
(tests/level.test.ts) and look tidy (pedestals 2 tiles apart, nothing overlapping the fountain / door).

**Selma** (`src/game/props/seamstress.ts`, sheet `seamstress`):
* idle (loop) when far, faces the player within 130 px, `sew` animation while sewing (1.2 s), `talk` for banter.
* prompt when the heroine carries pieces: `몸 꿰매기 · {n}조각`, sub `재봉사 셀마 · 몸 {body}/100`.
  If that sew completes the body: prompt `몸 완성하기 · {need}조각`, sub `{loop}회차 클리어!` and, if surplus > 0,
  ` · 남는 {surplus}조각은 사라짐`.
* prompt with nothing carried: `대화`, sub `재봉사 셀마 · 몸 {body}/100` → one of ≥6 lore banter lines (bubble),
  e.g. `여기 있던 팔, 종탑에서 은화 세 닢에 팔렸지.` / `실은 붉은 걸로. 피가 덜 티 나거든.` /
  `골렘? 남는 조각 서른 개면 꿰매 주지.` / `죽은 건 팔 수 있어. 산 건 아직 비싸고.`
* sewing: carried → body (capped), `run.piecesSewn += n`, persist the save immediately, particles (red thread
  sparks) on the heroine, sfx `heal`, toast `시체 조각 {n}개를 꿰맸다 · 몸 {body}/100`.
  Completion: short flash + slow-mo (0.6 s), then `game.loopClear()`.

**Corpse shop** (`CorpseShopItem`, `src/game/props/corpseShop.ts`; reuses the `props` sheet `pedestal` with a
bone-white glow): 3 slots, each a **unique item** (§5) drawn without repeats from `UNIQUE_IDS` with the level rng.
Tier = `run.tier`, affix `null`. Price = the item's `price` × loop multiplier, paid in **carried** pieces.
Prompt `구매 · {name}`, sub `{price}조각 · {unique effect line}`; red price when unaffordable; on buy the item drops
at the pedestal like the gold shop (`spawnItemDrop`) and the slot empties; toast `{name} 구매`.
Not enough pieces → sfx `error`, toast `시체 조각이 부족하다`.

**Golem pile** (`GolemPile`, `src/game/props/golemPile.ts`, drawn with the `golem` sheet `pile` animation):
* prompt `누더기 골렘 제작`, sub `{cost}조각 · 조력자 (이번 런 동안 함께 싸움)`.
* buy: pays carried pieces, the pile plays `assemble` and becomes the golem (spawn a `Golem` at the pile,
  `run.golem = { hp: max, maxHp: max }`), toast `누더기 골렘이 일어섰다`.
* while a golem lives: prompt `골렘 수선`, sub `체력 {hp}/{max}` and `canInteract()` false (no repair — keep it
  simple; the 쉼터 already heals it, see §4). Not enough pieces → error toast `시체 조각이 부족하다`.

---------------------------------------------------------------------------
## 4. 누더기 골렘 (Rag Golem) — `src/game/allies/golem.ts`

A `player`-team `Actor` (so enemy melee / AoE that use `hitArea` hit it; enemy AI keeps targeting the heroine).
Numbers in `rules.ts` `GOLEM`:

| key | value |
|---|---|
| hp | 300 (× loop factor) |
| damage | 26 per slam (× (1 + TIER_DMG (tier − 1)) × loop factor) |
| slam | windup 0.45 s, active 0.10 s, recover 0.50 s, cooldown 1.2 s; box 72 × 56 in front; knockback 180, stun 0.6 |
| aggro | nearest targetable enemy within 140 px horizontally and 70 px vertically of the golem |
| follow | walks (110 px/s) to stay 40–90 px behind the heroine; jumps (vy 420) when a wall blocks and the heroine is higher; drops through one-way platforms when she is lower |
| leash | > 360 px from the heroine, or stuck (no progress) for 2.5 s, or off the map → teleport 40 px behind her in a puff of rag particles |
| invuln after a hit | 0.35 s; knockbackTaken 0.2 |
| heal | full HP at the start of every 쉼터 level |

* Persists between the levels of the run (`run.golem`); spawned next to the player at every level start (boss
  arena included), HP restored from `run.golem.hp`; HP written back every step.
* Death: plays `death` (collapses into a rag pile), the pile fades after 3 s, `run.golem = null`, toast
  `골렘이 쓰러졌다`. It can be rebuilt at the next 쉼터.
* No contact damage, does not block the heroine, never targeted by the player's attacks. Its kills drop loot and
  pieces as usual (credit = the kill).
* Draw: `golem` sheet (§6), flash on hit, a small HP bar above it only while damaged in the last 3 s.
* The golem is untouched by the codex "preview" system except one codex entry (§7).

---------------------------------------------------------------------------
## 5. Unique items (시체 상점 전용) — Dead Cells-style item system expansion

Dead Cells reference used: weapon *families* (balanced blades, heavy two-handers, spears/rapiers, daggers, bows,
shields), skill *categories* (grenades, traps/turrets, powers), and *legendary*-style items with a built-in
signature effect. Here a **unique** (`ItemDef.unique = true`) is an item with a fixed signature effect, sold only
by Selma (never in random drops, chests, pedestals, mid-boss drops or the gold shop, never an alchemist blueprint),
drawn with a bone-gold name colour `#f0d9a0` and a `유니크` tag on its item card and in the codex.
Each reuses an existing heroine animation family (no new heroine frames). Ten uniques:

| id | 이름 | colour | slot / family | price | signature (code) |
|---|---|---|---|---|---|
| `bone_cleaver` | 뼈 도살검 | brutality | weapon / sword anims (3 hits) | 22 | every hit bleeds (3 s); **crit against bleeding targets** |
| `reaper_scythe` | 사신의 낫 | brutality | weapon / hammer anims (2 wide sweeps, faster than the hammer) | 26 | each kill heals **8 %** max HP |
| `stitch_needle` | 재봉 바늘 | tactics | weapon / spear anims (3 thrusts) | 22 | **all hits crit for 2 s after a roll** |
| `widow_fangs` | 과부의 송곳니 | tactics | weapon / dagger anims (4 hits) | 24 | **all hits crit for 3 s after taking damage** (spite) |
| `coffin_lid` | 관 뚜껑 | survival | weapon / shield | 20 | blocks 90 %; a **parry releases a shockwave** (r 72, dmg 30, stun 1.5, unblockable) |
| `marrow_bow` | 골수 활 | tactics | weapon / bow | 24 | a fully drawn arrow **pierces every enemy** in its path (each hit once) |
| `corpse_bomb` | 시체 폭탄 | brutality | skill / grenade (cd 12) | 18 | big blast (r 56, dmg 40); enemies it kills **burst again** (r 44, dmg 20, one chain level) |
| `bone_spikes` | 뼈 가시 | tactics | skill / deploy (cd 9) | 16 | 5 bone spikes erupt along the floor in front, one every 0.08 s, 28 px apart (dmg 18 each, knockup 220) |
| `soul_lantern` | 영혼 등불 | survival | skill / deploy (cd 16) | 20 | 3 soul flames orbit the heroine (r 34) for 8 s; touch = dmg 10 + burn 2 s, 0.4 s per-target cooldown |
| `chain_hook` | 사슬 갈고리 | tactics | skill / throw (cd 7) | 16 | a hook flies 220 px forward; the first enemy hit is **pulled to the heroine**, dmg 12, stun 1.0 (enemies with knockbackTaken < 0.3 are not pulled, only stunned) |

Weapon hit tables (damage, boxes, timings) are designed by the code agent in the style of `weapons.ts`; balance target:
roughly the DPS of the existing item of the same family +15 %, the signature being the reason to buy.
`affixPool` for uniques: they never roll an affix (affix `null`). Slash colours: bone `#f0e6d2` / blood `#ff4a58`.

Item text (`desc`, ≤ 16 chars) and the signature line shown on cards / codex come from the table above.
`unlockedCount` (title `해금 x/y`) must ignore uniques (they cannot be unlocked).

Visual effects of the new skills are drawn in code (particles, glows, simple canvas shapes) except the corpse bomb,
which uses the `projectiles` sheet `fire_grenade` animation tinted by a bone-coloured outline, and the item icons.

---------------------------------------------------------------------------
## 6. Art (Blender, same pipeline as DESIGN §7; `tools/blender/asset_*.py` + `tools/pack`)

New sheets (each `public/assets/sprites/<name>.png/.json`, registered in `SHEETS` with a placeholder size):

1. **`corpse`** — frame 24×24, anchor (12, 22). `piece` (6 frames, loop, 10 fps): a small stitched chunk of the dead —
   pale bone/flesh lump with dark-red cross stitches and a cyan ember glint, slowly turning. `piece_big` (6 frames,
   loop): the same, ~1.4× (used for drops worth ≥ 3).
2. **`seamstress`** — frame 128×128, anchor (64, 124), like `alchemist`/`merchant`. Selma: tall, gaunt corpse
   seamstress, bone-white skin with visible stitch lines on cheek and arms, long black hair in a messy bun pierced
   with big needles, a monocle / magnifier over one eye, patchwork dress of mismatched fabrics, a measuring-tape
   scarf, red thread spools on her belt, huge shears strapped on her back. Animations: `idle` (6 f, loop),
   `talk` (6 f, loop), `sew` (8 f, loop: needle pulling red thread in big arcs).
3. **`golem`** — frame 128×128, anchor (64, 124). The rag golem: a big (≈ 92 px tall, ≈ 1.6× the heroine)
   female rag-doll giant sewn from burlap, sacking and corpse-pale patches, long thick braids of dark-red yarn,
   two mismatched button eyes glowing **cyan** (Cinder's ember), stitched smile, oversized arms with bandaged fists,
   a ragged apron-skirt. Animations: `idle` (6 f, loop), `walk` (8 f, loop), `attack` (8 f: two-fist overhead slam;
   frame JSON `windup`/`active`/`recover` like the enemies), `hurt` (3 f), `jump` (2 f), `death` (8 f: collapses
   into a heap of rags), `assemble` (8 f: the heap rises into the golem — the reverse of death), `pile` (1 f: the heap).
4. **`icons`** (existing sheet, re-rendered): add one 32×32 icon per unique (`bone_cleaver`, `reaper_scythe`,
   `stitch_needle`, `widow_fangs`, `coffin_lid`, `marrow_bow`, `corpse_bomb`, `bone_spikes`, `soul_lantern`,
   `chain_hook`) and `corpse_piece` (HUD / codex currency icon) and `golem` (codex). Existing icons must render
   pixel-identical or at least visually unchanged (same builders).

Look: bone white `#e8dcc4`, dried blood `#7a1f2a`, thread red `#c8324a`, rag browns, the cyan ember accent
`#4fe3ff`. Unique weapon models: bone cleaver = a butcher blade of fused bone; reaper scythe = long curved scythe
with a stitched grip; stitch needle = a spear-length sewing needle with red thread trailing from its eye; widow
fangs = two curved black-bone daggers; coffin lid = a narrow coffin lid with iron straps used as a shield; marrow
bow = bow of ribs and sinew; corpse bomb = a stitched leather sack bulging with bones and a burning wick;
bone spikes = a cluster of three spikes; soul lantern = small iron lantern with a cyan flame; chain hook = rusted hook
on a coiled chain.

---------------------------------------------------------------------------
## 7. Codex, debug, tests

* Codex (`ui/codexData.ts`): the 10 uniques appear in the 무기 / 스킬 tabs with the `유니크` tag, price row
  `시체 상점 · {price}조각 (회차 배율)` and the signature row; the 아이템 tab gets `시체 조각` (drop table,
  sewing / death rules, loop clear) and `누더기 골렘` (cost, numbers, persistence) and Selma's 쉼터 role in the text.
  All numbers come from the tables (no copies). The codex tests must keep passing (extend them for the new ids).
* Debug hooks (`window.__ds`): `pieces(n)` sets carried pieces, `body(n)` sets the sewn count, `loop(n)` sets the
  loop, `golem()` spawns a golem for the current run, `give()` must also accept the unique ids (pick the slot from
  `ITEMS[id].slot`, not a hard-coded list).
* Unit tests (vitest): drops per kind; carried pieces lost on death; sew caps at 100 and triggers the loop clear;
  surplus lost; save sanitising (`loop` ≥ 1 int ≤ 99, `body` 0..99, `loopRuns` ≥ 0, old saves without the fields);
  loop scaling numbers; golem cost per loop; shop stock = 3 distinct uniques; `rollItem` never returns a unique;
  `unlockedCount` ignores uniques; each unique's signature (crit vs bleeding, crit after roll, spite, pierce,
  parry shockwave, chain-burst, spikes count, lantern orbit hits, hook pull/no-pull for heavy targets); golem
  follows, attacks, takes damage, dies, persists across levels; passage template valid.
* e2e (`e2e/corpse.spec.ts`, Playwright, the debug hooks): kill enemies → HUD counter rises; go to the 쉼터 →
  sew → body rises; buy a unique; build the golem → it exists in the next level; body 99 + 1 carried → sew → the
  loop-clear scene → title shows `2회차`; dying loses carried pieces. Screenshots of the 쉼터, the HUD and the
  loop-clear scene into `e2e/__shots__/` for review.

---------------------------------------------------------------------------
## 8. File ownership (to avoid edit races between agents)

* Art agent: `tools/blender/asset_corpse.py`, `asset_seamstress.py`, `asset_golem.py`, `asset_icons.py`,
  `lib_objects.py` / `lib_npc.py` additions, `public/assets/sprites/{corpse,seamstress,golem,icons}.*`. No `src/`.
* Economy agent (first): save, run, rules (`CORPSE`, `LOOP`, `GOLEM`), drops, pickups, HUD, title / death /
  victory / loop-clear scenes, game.ts flow, passage template + build, Selma / corpse shop / golem pile props,
  `allies/golem.ts`, loop scaling hooks in enemies / mini-bosses / Matron, debug hooks, codex entries for
  시체 조각 / 골렘, its tests. It defines `UNIQUE_IDS` (empty-safe) for the shop to read.
* Uniques agent (second, after the economy agent): items/types, items.ts, weapons.ts, skills.ts,
  player/projectiles.ts (+ new skill entities), player.ts hooks, codex entries for the uniques, its tests.

---------------------------------------------------------------------------
## 9. Assumptions taken (to confirm with the requester)

1. "쉼터" = the existing passage level between biomes (renamed in UI).
2. Pieces are a new currency next to cells and gold (cells / alchemist unchanged).
3. Carried pieces are lost on death; sewn pieces are permanent (Dead Cells cell rule + a bank).
4. 100 pieces ≈ one full stage loop killing everything (the drop table above).
5. Completing the body ends the current run with the loop-clear scene; loop 2 starts from the title at 0 pieces.
6. Loop 2+ = stronger enemies, pricier golem / shop (ceiling at loop 5). Body requirement stays 100.
7. Uniques are bought for the current run (they are items, not permanent unlocks), shop-only.
8. One golem at a time, lasts the run until it falls, healed at each 쉼터, no repair purchase.
