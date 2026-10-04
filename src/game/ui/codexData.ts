import { ITEM_IDS, type AffixId, type ItemId } from '../items/types';
import { AFFIX_NAMES, COLOR_NAMES, ITEMS, affixPool } from '../items/items';
import { WEAPONS, type MeleeWeapon, type WeaponId } from '../player/weapons';
import { SKILLS, SKILL_BASE } from '../player/skills';
import { GRENADE, Turret, WolfTrap } from '../player/projectiles';
import {
  ALL_ENEMY_KINDS, BASE_KINDS, BASE_STATS, ENEMY_DEFS, LATE_DEPTH, type BaseKind, type EnemyDef, type EnemyKind,
} from '../enemies/variants';
import { ABBESS, ARACHNE, MB, MINIBOSS_IDS, MINIBOSS_SPECS, VALKYRIE, WITCH, type MiniBossId } from '../miniboss';
import { MATRON } from '../boss/matron';
import { META_UPGRADES } from '../meta/progression';
import { SCROLL_COLORS, SCROLL_SPRITE } from '../items/pickups';
import { COLOR_HEX } from '../combat';
import { LEVEL_SEQUENCE, type BiomeId } from '../run';
import { AFFIX, AFFIX_ROLL, CRIT_MULT, ELITE, FLASK, FOODS, LOOT, SCROLL, TIER2, TIER_DMG, enemyDmgMul, enemyHpMul } from '../rules';

/**
 * 도감 (codex) data: one entry per weapon, skill, enemy, boss and item of the game, built from the game's own tables
 * (items.ts, player/weapons.ts, player/skills.ts, enemies/variants.ts, miniboss/*, boss/matron.ts, meta/progression.ts,
 * rules.ts) so a number is never typed twice. Only the Korean flavour text lives here. Pure data: no canvas, no DOM.
 */
export type CodexTabId = 'weapon' | 'skill' | 'enemy' | 'boss' | 'item';

export const CODEX_TABS: { id: CodexTabId; label: string }[] = [
  { id: 'weapon', label: '무기' },
  { id: 'skill', label: '스킬' },
  { id: 'enemy', label: '적' },
  { id: 'boss', label: '보스' },
  { id: 'item', label: '아이템' },
];

/** one animation of a sprite sheet (`sheet` = a name of engine/assets SHEETS) */
export interface SpriteRef {
  sheet: string;
  anim: string;
}

export interface PreviewStep {
  anim: string;
  /** seconds the animation is stretched over (default: its native length) */
  dur?: number;
  /** seconds to rest after a non-looping animation before the next step (default 0.5) */
  hold?: number;
}

/** A second sprite next to the main one: a thrown grenade, a turret, a trap, an arrow. */
export interface PreviewProp {
  sheet: string;
  /** its own animation sequence, started `start` seconds into the main cycle */
  steps: PreviewStep[];
  /** anchor offset from the main sprite's anchor, in sprite pixels (x forward, y down) */
  dx: number;
  dy: number;
  start: number;
  /** 'lob' = arcs to (dx + travel, dy) over `flight` s and bursts; 'fly' = flies straight there; undefined = stays */
  motion?: 'lob' | 'fly';
  travel?: number;
  flight?: number;
  /** burst ring on landing (radius in sprite pixels) */
  blast?: { radius: number; color: string };
}

export interface CodexPreview {
  sheet: string;
  /** played in order, then the cycle restarts; a tap / A advances to the next one */
  steps: PreviewStep[];
  /** shown (looping) while holding after a one-shot animation; without it the last frame is held */
  rest?: string;
  /** characters stand on a floor line, pickups float */
  ground: boolean;
  prop?: PreviewProp;
}

export interface CodexRow {
  /** left column (empty = continuation of the row above) */
  label: string;
  text: string;
  color?: string;
}

export interface CodexEntry {
  /** unique across tabs: the item id / enemy id / boss id / `pickup` id */
  id: string;
  tab: CodexTabId;
  /** list heading this entry sits under (enemy family, item category) */
  group?: string;
  name: string;
  /** item colour of weapons and skills (the name is drawn in it) */
  nameColor?: string;
  /** small label right of the name */
  tag?: string;
  /** 1-2 sentence description (non-empty Korean) */
  desc: string;
  /** list thumbnail */
  icon: SpriteRef;
  rows: CodexRow[];
  preview: CodexPreview;
}

// ---------------------------------------------------------------------------------------------------------------------
// helpers

const HEROINE = 'heroine';
const pct = (v: number): string => `${Math.round(v * 100)}%`;
const num = (v: number): string => String(Math.round(v * 100) / 100);
const secs = (v: number): string => `${num(v)}초`;
const uniq = <T>(a: T[]): T[] => [...new Set(a)];

const KIND_LABEL = { melee: '근접', bow: '활', shield: '방패', skill: '스킬' } as const;
const BIOME_SHORT: Record<BiomeId, string> = { prison: '감옥', ramparts: '성벽', tower: '종탑' };
const levelName = (b: BiomeId): string => LEVEL_SEQUENCE.find((l) => l.kind === 'biome' && l.biome === b)?.name ?? BIOME_SHORT[b];
const affixList = (id: ItemId): string => affixPool(id).map((a) => AFFIX_SHORT[a]).join(' · ');
/** the damage multiplier line shared by every weapon / skill ("성장") */
const scaling = (color: keyof typeof COLOR_NAMES): string =>
  `${COLOR_NAMES[color]} 레벨당 피해 +${pct(SCROLL.dmgPerLevel)} · 티어당 +${pct(TIER_DMG)}`;

const AFFIX_SHORT: Record<AffixId, string> = {
  burn: '화상', bleed: '출혈', dmg: `피해 +${pct(AFFIX.dmgMul - 1)}`, speed: `공속 +${pct(1 - AFFIX.speedMul)}`, heal_on_kill: '처치 회복',
};

// ---------------------------------------------------------------------------------------------------------------------
// weapons

function meleeRows(w: MeleeWeapon): CodexRow[] {
  const hits = w.hits;
  const total = (i: number): number => hits[i].windup + hits[i].active + hits[i].recover;
  const reach = Math.max(...hits.map((h) => h.box.x + h.box.w));
  const back = Math.max(0, ...hits.map((h) => -h.box.x));
  const always = hits.map((h, i) => (h.crit === 'always' ? `${i + 1}타` : '')).filter(Boolean);
  const special: string[] = [];
  if (w.bleed) special.push(`출혈 ${secs(w.bleed)} (적중마다 중첩)`);
  const stuns = uniq(hits.map((h) => h.stun ?? 0).filter((s) => s > 0));
  if (stuns.length) special.push(`기절 ${stuns.map(num).join(' / ')}초`);
  const ups = hits.map((h, i) => (h.knockup ? `${i + 1}타` : '')).filter(Boolean);
  if (ups.length) special.push(`${ups.join('·')} 띄우기`);
  const strong = Math.max(...hits.map((h) => h.knockback));
  if (!special.length && strong >= 200) special.push('강한 넉백');
  if (!special.length) special.push('없음 (빠른 연타)');
  return [
    { label: '콤보', text: `${hits.length}연격 · 타당 피해 ${hits.map((h) => h.damage).join(' / ')}` },
    { label: '속도', text: `타당 ${hits.map((_, i) => num(total(i))).join(' / ')}초` },
    { label: '사거리', text: back ? `전방 ${reach}px · 후방 ${back}px` : `전방 ${reach}px` },
    {
      label: '치명타',
      text: always.length ? `${always.join('·')} 치명타 확정 (피해 ×${CRIT_MULT})`
        : hits.some((h) => h.crit === 'behind') ? `적의 등 뒤를 맞히면 치명타 (피해 ×${CRIT_MULT})` : '없음',
    },
    { label: '특수', text: special.join(' · ') },
  ];
}

function weaponEntry(id: WeaponId): CodexEntry {
  const def = ITEMS[id];
  const w = WEAPONS[id];
  let rows: CodexRow[];
  let steps: PreviewStep[];
  let prop: PreviewProp | undefined;
  if (w.kind === 'melee') {
    rows = meleeRows(w);
    steps = w.hits.map((h, i) => ({ anim: h.anim, dur: h.windup + h.active + h.recover, hold: i === w.hits.length - 1 ? 0.7 : 0.04 }));
  } else if (w.kind === 'bow') {
    rows = [
      { label: '피해', text: `완전히 당기면 ${w.damage} · 짧게 탭하면 ${pct(w.minFrac)}` },
      { label: '충전', text: `${secs(w.drawTime)} · 화살 속도 ${w.minSpeed}–${w.maxSpeed}px/s` },
      { label: '이동', text: `당기는 동안 이동 속도 ${pct(w.moveScale)}` },
      { label: '특수', text: '원거리 · 길게 눌러 조준하고 떼면 발사' },
    ];
    steps = [{ anim: 'bow_draw', dur: w.drawTime, hold: 0.04 }, { anim: 'bow_shoot', hold: 0.8 }];
    prop = { sheet: 'projectiles', steps: [{ anim: 'arrow' }], dx: 26, dy: -32, start: w.drawTime + 0.05, motion: 'fly', travel: 92, flight: 0.35 };
  } else {
    rows = [
      { label: '막기', text: `정면 피해 -${pct(w.reduction)} (이동 속도 ${pct(w.moveScale)})` },
      { label: '패링', text: `막기 직후 ${secs(w.parryWindow)} 안에 맞으면 패링 · 공격한 적 기절 ${secs(w.parryStun)}` },
      { label: '특수', text: '공격 수단이 없는 방어 전용 장비' },
    ];
    steps = [{ anim: 'shield_block', hold: 0.9 }, { anim: 'shield_parry', hold: 0.9 }];
  }
  rows.push({ label: '성장', text: w.kind === 'shield' ? '방어량은 성장하지 않음 · 접사로 처치 회복만 가능' : scaling(def.color) });
  rows.push({ label: '접사', text: affixList(id) });
  return {
    id, tab: 'weapon', name: def.name, nameColor: COLOR_HEX[def.color], tag: `${KIND_LABEL[def.kind]} · ${COLOR_NAMES[def.color]}`,
    desc: def.desc, icon: { sheet: 'icons', anim: def.icon }, rows,
    preview: { sheet: HEROINE, steps, rest: 'idle', ground: true, prop },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// skills

type SkillId = keyof typeof SKILL_BASE;

function skillEntry(id: SkillId): CodexEntry {
  const def = ITEMS[id];
  const sk = SKILLS[id]!;
  const base = SKILL_BASE[id];
  const rows: CodexRow[] = [
    { label: '재사용', text: secs(def.cooldown ?? 0) },
    { label: '시전', text: `${sk.anim === 'throw' ? '던지기' : '설치'} ${secs(sk.castTime)} · 이동 속도 ${pct(sk.moveScale)}` },
  ];
  let steps: PreviewStep[] = [{ anim: sk.anim, dur: sk.castTime, hold: 1.4 }];
  let prop: PreviewProp;
  if (id === 'fire_grenade') {
    const g = GRENADE.fire;
    rows.push(
      { label: '피해', text: `폭발 ${base} (반경 ${g.radius}px)` },
      { label: '효과', text: `맞은 적 ${secs(g.burn)} 화상 (초당 ${g.burnDps}) · 넉백` },
    );
    prop = { sheet: 'projectiles', steps: [{ anim: 'fire_grenade' }], dx: 8, dy: -30, start: sk.fireAt, motion: 'lob', travel: 62, flight: 0.55, blast: { radius: g.radius, color: '#ffb347' } };
  } else if (id === 'ice_grenade') {
    const g = GRENADE.ice;
    rows.push(
      { label: '피해', text: `폭발 ${base} (반경 ${g.radius}px)` },
      { label: '효과', text: `범위 안의 적 ${secs(g.freeze)} 빙결` },
    );
    prop = { sheet: 'projectiles', steps: [{ anim: 'ice_grenade' }], dx: 8, dy: -30, start: sk.fireAt, motion: 'lob', travel: 62, flight: 0.55, blast: { radius: g.radius, color: '#9fe8ff' } };
  } else if (id === 'turret') {
    rows.push(
      { label: '피해', text: `화살 1발 ${base} (${secs(Turret.INTERVAL)}마다 사격)` },
      { label: '효과', text: `${secs(Turret.LIFE)} 동안 사거리 ${Turret.RANGE}px 안의 가장 가까운 적을 자동 사격` },
    );
    prop = { sheet: 'projectiles', steps: [{ anim: 'turret_deploy', hold: 0.1 }, { anim: 'turret_idle', dur: 0.6 }, { anim: 'turret_shoot', hold: 0.1 }, { anim: 'turret_idle', dur: 0.5 }], dx: 24, dy: -14, start: sk.fireAt };
    steps = [{ anim: sk.anim, dur: sk.castTime, hold: 3.2 }];
  } else {
    rows.push(
      { label: '피해', text: `덫에 걸린 적 ${base}` },
      { label: '효과', text: `밟은 첫 적을 ${secs(WolfTrap.ROOT)} 속박 (기절)` },
    );
    prop = { sheet: 'projectiles', steps: [{ anim: 'trap_open', dur: 1.2, hold: 0 }, { anim: 'trap_snap', hold: 0.9 }], dx: 26, dy: -6, start: sk.fireAt };
    steps = [{ anim: sk.anim, dur: sk.castTime, hold: 2.4 }];
  }
  rows.push({ label: '성장', text: scaling(def.color) });
  rows.push({ label: '접사', text: affixList(id) });
  return {
    id, tab: 'skill', name: def.name, nameColor: COLOR_HEX[def.color], tag: `스킬 · ${COLOR_NAMES[def.color]}`,
    desc: def.desc, icon: { sheet: 'icons', anim: def.icon }, rows,
    preview: { sheet: HEROINE, steps, rest: 'idle', ground: true, prop },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// enemies

/** animation names of a base type's sheet (all its variants share them: docs/CONTENT2.md); tests check them against the manifests */
export const ENEMY_ANIMS: Record<BaseKind, string[]> = {
  ghoul: ['idle', 'walk', 'attack', 'hurt', 'death'],
  jailer: ['idle', 'walk', 'attack', 'block', 'hurt', 'death'],
  archer: ['idle', 'walk', 'shoot', 'hurt', 'death'],
  bomber: ['idle', 'walk', 'throw', 'hurt', 'death'],
  harpy: ['fly', 'dive_windup', 'dive', 'recover', 'hurt', 'death'],
  lancer: ['idle', 'walk', 'charge_windup', 'charge', 'thrust', 'hurt', 'death'],
};

/** the behaviour line of each enemy; numbers come from its ability parameters (variants.ts), never typed here */
const BEHAVIOUR: Record<EnemyKind, (d: EnemyDef) => string> = {
  ghoul: () => '가장 기본적인 근접 적. 쫓아올수록 점점 빨라진다.',
  ghoul_plague: (d) => `느리다(이동 ×${d.speed}). 죽으면 독구름(반경 ${d.p.cloudR}px, ${secs(d.p.cloudLife)}, 초당 ${d.p.cloudDps})을 남긴다.`,
  ghoul_frenzy: (d) => `빠르다(이동 ×${d.speed}). ${d.p.swipes}연타로 할퀸다. 체력은 ${pct(d.hp)}.`,
  ghoul_shackled: (d) => `쇠사슬 철퇴를 휘두른다: 사거리 ×${d.p.reach}, 피해 ×${d.dmg}, 강한 넉백. 느리다.`,
  ghoul_wraith: (d) => `공격 전에 플레이어 뒤로 순간이동(${d.p.blink}px 이내, ${secs(d.p.blinkCd)}마다)한다. 넉백 무시, 체력 ${pct(d.hp)}.`,
  jailer: () => '정면을 방패로 막는다. 등 뒤나 패링·기절로 뚫어야 한다.',
  jailer_warden: (d) => `메이스 내려찍기가 바닥 충격파(피해 ${d.p.waveDmg}, ${d.p.waveDist}px)를 보낸다. 점프로 피한다.`,
  jailer_torch: (d) => `공격에 점화(${secs(d.p.burn)} 화상, 초당 ${d.p.burnDps}). 횃불 빛(반경 ${d.p.light}px)을 들고 다닌다.`,
  jailer_spear: (d) => `창으로 멀리 찌른다: 사거리 ×${d.p.reach}.`,
  jailer_chain: (d) => `사슬 갈고리(${d.p.hookRange}px)로 플레이어를 끌어당긴 뒤 강타한다. 방패가 없다.`,
  archer: () => '멀리서 화살을 쏘고, 가까워지면 거리를 벌린다.',
  archer_fire: (d) => `불화살: 맞으면 ${secs(d.p.burn)} 화상(초당 ${d.p.burnDps}).`,
  archer_volley: (d) => `화살 ${d.p.arrows}발을 부채꼴(±${d.p.spread}°)로 쏜다. 예비동작 ${secs(d.p.windup)}.`,
  archer_crossbow: (d) => `${secs(d.p.windup)} 조준한 뒤 관통 볼트를 쏜다(피해 ×${d.dmg}, 반사 불가).`,
  archer_shadow: (d) => `가까워지면(${d.p.trigger}px) ${d.p.blinkRange}px 이내로 블링크해 도망친다(${secs(d.p.blinkCd)}마다).`,
  bomber: () => '폭탄을 포물선으로 던진다. 착지하면 폭발한다.',
  bomber_frost: (d) => `서리 폭탄: 폭발에 맞으면 ${secs(d.p.freeze)} 빙결(피해 ×${d.dmg}).`,
  bomber_cluster: (d) => `폭탄이 착지하면 ${d.p.split}개로 분열한다(분열탄 피해 ×${d.p.bombletDmg}, 반경 ${d.p.bombletR}px).`,
  bomber_kamikaze: (d) => `속도 ×${d.speed}로 달려와 자폭한다(반경 ${d.p.radius}px, 방어 불가, 피해 ×${d.dmg}).`,
  bomber_alchemist: (d) => `독 플라스크가 산성 웅덩이(반경 ${d.p.puddleR}px, ${secs(d.p.puddleLife)}, 초당 ${d.p.puddleDps})를 남긴다.`,
  harpy: () => '공중을 날다가 급강하로 덮친다.',
  harpy_storm: (d) => `급강하 대신 깃털 ${d.p.feathers}발(±${d.p.spread}°)을 쏜다.`,
  harpy_raven: (d) => `급강하가 ×${d.speed} 빠르고 예비동작이 짧다(${secs(d.p.windup)}).`,
  harpy_siren: (d) => `노래 파동(반경 ${d.p.songR}px 퍼지는 고리)에 맞으면 ${secs(d.p.slowT)} 동안 이동 −${pct(d.p.slow)}. 급강하와 번갈아 쓴다.`,
  harpy_ember: (d) => `급강하 착지점에 ${secs(d.p.fireLife)} 동안 불길(초당 ${d.p.fireDps})이 남는다.`,
  lancer: () => '창을 겨누고 돌진해 찌른다.',
  lancer_halberd: (d) => `돌진 없이 넓은 ${d.p.hits}연타 휘두르기(사거리 약 ${d.p.reach}px).`,
  lancer_paladin: () => '정면 방패로 막으면서도 돌진한다.',
  lancer_duelist: (d) => `${d.p.thrusts}연속 찌르기. 공격 직후 첫 타격을 쳐낸다(패링).`,
  lancer_dragoon: (d) => `돌진 대신 플레이어 위치로 도약(${d.p.leapMin}–${d.p.leapMax}px)해 반경 ${d.p.aoeR}px에 착지한다.`,
};

/** where an enemy spawns, e.g. "감옥 후반 · 성벽" */
export function spawnLabel(d: EnemyDef): string {
  const parts: string[] = [];
  for (const b of ['prison', 'ramparts', 'tower'] as BiomeId[]) {
    const pl = d.spawn[b];
    if (pl) parts.push(BIOME_SHORT[b] + ((pl.min ?? 0) >= LATE_DEPTH ? ' 후반' : ''));
  }
  return parts.join(' · ') || '-';
}

/** (hp, damage) of an enemy at tier 1 / tier 2 and as an elite of tier 1 - the numbers `Enemy` really uses */
export function enemyNumbers(d: EnemyDef): { hp: [number, number]; dmg: [number, number]; eliteHp: number; eliteDmg: number } {
  const base = BASE_STATS[d.base].hp;
  const hp = (tier: number, elite: boolean): number => Math.round(base * enemyHpMul(d.hp, tier, elite));
  const dm = (tier: number, elite: boolean): number => Math.max(1, Math.round(d.hit * enemyDmgMul(d.dmg, tier, elite)));
  return { hp: [hp(1, false), hp(2, false)], dmg: [dm(1, false), dm(2, false)], eliteHp: hp(1, true), eliteDmg: dm(1, true) };
}

function enemyEntry(id: EnemyKind): CodexEntry {
  const d = ENEMY_DEFS[id];
  const n = enemyNumbers(d);
  const baseName = ENEMY_DEFS[d.base].name;
  const anims = ENEMY_ANIMS[d.base];
  return {
    id, tab: 'enemy', group: baseName, name: d.name, tag: d.variant ? `${baseName} 변종` : '기본형',
    desc: BEHAVIOUR[id](d),
    icon: { sheet: id, anim: anims[0] },
    rows: [
      { label: '서식', text: spawnLabel(d) },
      { label: '체력', text: `1티어 ${n.hp[0]} · 2티어 ${n.hp[1]}` },
      { label: '피해', text: `1티어 ${n.dmg[0]} · 2티어 ${n.dmg[1]}` },
      {
        label: '정예', color: BASE_STATS[d.base].aura,
        text: `체력 ${n.eliteHp} · 피해 ${n.eliteDmg} · 이동 ×${ELITE.speed} · 넉백 ${pct(ELITE.knockbackTaken)} · 오라`,
      },
    ],
    preview: { sheet: id, steps: anims.map((a) => ({ anim: a, hold: a === 'death' ? 0.9 : 0.35 })), ground: !d.flyer },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// bosses

/** animation names of the boss sheets (docs/CONTENT2.md §2, DESIGN §5); tests check them against the manifests */
export const BOSS_ANIMS: Record<MiniBossId | 'matron', string[]> = {
  mb_abbess: ['idle', 'walk', 'cleave', 'spin', 'spin_end', 'summon', 'hurt', 'death'],
  mb_arachne: ['idle', 'walk', 'web', 'leap', 'leap_land', 'bite', 'hurt', 'death'],
  mb_valkyrie: ['idle', 'walk', 'slash', 'fly', 'dive', 'wave', 'hurt', 'death'],
  mb_witch: ['idle', 'float', 'orb', 'blink', 'shards', 'hurt', 'death'],
  matron: ['idle', 'walk', 'slam', 'sweep', 'charge_windup', 'charge', 'crash', 'leap', 'leap_fall', 'leap_land', 'roar', 'summon', 'hurt', 'death'],
};

const dropRow = (): CodexRow => ({
  label: '보상',
  text: `무기 1 + 스킬 1 (티어 +1, 접사 보장) · 셀 ${MB.cells[0]}–${MB.cells[1]} · 골드 ${MB.gold[0]}–${MB.gold[1]}`,
});

function miniBossAttacks(id: MiniBossId, dmgMult: number): string[] {
  const d = (v: number): number => Math.max(1, Math.round(v * dmgMult));
  switch (id) {
    case 'mb_abbess':
      return [
        `내려찍기: 피해 ${d(ABBESS.cleave.dmg)}, 바닥 균열이 달려간다(피해 ${d(ABBESS.cleave.crackDmg)}, 점프로 회피)`,
        `회전 칼날 돌진: 빙글 돌며 질주, 피해 ${d(ABBESS.spin.dmg)}, 방어 불가`,
        `종 울리기: 구울 ${ABBESS.summon.count}마리 소환 (재사용 ${secs(ABBESS.summon.cd)})`,
      ];
    case 'mb_arachne':
      return [
        `거미줄 덩이: 피해 ${d(ARACHNE.web.dmg)}, 맞으면 ${secs(ARACHNE.web.root)} 속박`,
        `도약: 플레이어 위치로 점프(그림자 표시), 반경 ${ARACHNE.leap.radius}px 피해 ${d(ARACHNE.leap.dmg)}`,
        `물기 돌진: 짧게 덮쳐 피해 ${d(ARACHNE.bite.dmg)} + 출혈`,
      ];
    case 'mb_valkyrie':
      return [
        `대검 2연 베기: 피해 ${VALKYRIE.slash.dmg.map(d).join(' / ')}`,
        `급강하: 날아올라 표시된 선을 따라 낙하, 피해 ${d(VALKYRIE.dive.dmg)}, 방어 불가`,
        `검기: 바닥을 훑는 검기, 피해 ${d(VALKYRIE.wave.dmg)} (점프로 회피)`,
      ];
    case 'mb_witch':
      return [
        `유도 구체: 느린 구체 ${WITCH.orb.count}개, 피해 ${d(WITCH.orb.dmg)} (칼질·화살로 터뜨림)`,
        '순간이동: 다른 자리로 블링크 (도착 지점이 표시됨)',
        `달 파편: 표시된 자리에 ${WITCH.shards.count}개 낙하, 피해 ${d(WITCH.shards.dmg)}`,
      ];
  }
}

const MINIBOSS_DESC: Record<MiniBossId, string> = {
  mb_abbess: '철가면을 쓴 처형인 수녀. 단두대 칼날 같은 거대한 도끼를 휘두른다.',
  mb_arachne: '거미의 몸에 여인의 상체가 달린 괴물. 거미줄과 도약으로 몰아붙인다.',
  mb_valkyrie: '하얀 날개를 단 중갑 여기사. 대검 베기와 급강하로 압박한다.',
  mb_witch: '달빛 아래 떠다니는 마녀. 유도 구체, 순간이동, 달 파편을 쓴다.',
};

function miniBossEntry(id: MiniBossId): CodexEntry {
  const s = MINIBOSS_SPECS[id];
  const tier2 = s.biome === 'ramparts';
  const hp = Math.round(s.hp * (tier2 ? TIER2.hp : 1));
  const atk = miniBossAttacks(id, tier2 ? TIER2.dmg : 1);
  return {
    id, tab: 'boss', group: '중간 보스', name: s.name, tag: '중간 보스', desc: MINIBOSS_DESC[id],
    icon: { sheet: id, anim: 'idle' },
    rows: [
      { label: '바이옴', text: levelName(s.biome) },
      { label: '체력', text: `${hp}${tier2 ? ` (기본 ${s.hp} × ${TIER2.hp})` : ''} · 넉백 없음` },
      ...atk.map((t, i): CodexRow => ({ label: i === 0 ? '공격' : '', text: t })),
      dropRow(),
    ],
    preview: { sheet: id, steps: BOSS_ANIMS[id].map((a) => ({ anim: a, hold: a === 'death' ? 1 : 0.3 })), ground: true },
  };
}

function matronEntry(): CodexEntry {
  const M = MATRON;
  const boss = LEVEL_SEQUENCE.find((l) => l.kind === 'boss');
  return {
    id: 'matron', tab: 'boss', group: '최종 보스', name: '강철 여교도관', tag: '최종 보스',
    desc: `종탑을 지키는 거대한 여교도관. 종 달린 철퇴를 휘두르며, 체력이 ${pct(M.phase2)} 이하가 되면 2페이즈에 들어간다.`,
    icon: { sheet: 'matron', anim: 'idle' },
    rows: [
      { label: '바이옴', text: boss?.name ?? '사슬의 종탑' },
      { label: '체력', text: `${M.hp} · 2페이즈(체력 ${pct(M.phase2)} 이하): 포효 뒤 공격이 빨라진다` },
      { label: '공격', text: `종 철퇴 내려찍기: 피해 ${M.slam.dmg}, 방어 불가 + 바닥 충격파 2개(피해 ${M.wave.dmg}, 점프로 회피)` },
      { label: '', text: `철퇴 휘두르기: 피해 ${M.sweep.dmg}, 사거리 ${M.sweep.reach}px` },
      { label: '', text: `어깨 돌진: 피해 ${M.charge.dmg}, 방어 불가 (구르기로 통과) · 벽에 부딪히면 ${secs(M.charge.stun)} 기절` },
      { label: '', text: `도약 후 착지: 피해 ${M.leap.dmg}, 방어 불가` },
      { label: '', text: `사슬 소환(2페이즈): 표시된 자리에 파편 낙하, 피해 ${M.debris.dmg}` },
      { label: '보상', text: `셀 ${M.drop.cells} · 골드 ${M.drop.gold} · 아이템 2개 (티어 ${M.drop.itemTier}) · 고기 1개` },
    ],
    preview: { sheet: 'matron', steps: BOSS_ANIMS.matron.map((a) => ({ anim: a, hold: a === 'death' ? 1 : 0.3 })), ground: true },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// items (pickups, scrolls, flask / fountain, alchemist upgrades, affixes)

const FOOD_NAME: Record<(typeof FOODS)[number]['id'], string> = { apple: '사과', bread: '빵', meat: '고기' };
const FOOD_SOURCE: Record<(typeof FOODS)[number]['id'], string> = {
  apple: '작은 간식 (보통은 드롭되지 않음)',
  bread: `상자에서 ${pct(LOOT.chest.foodChance)} 확률로 나온다`,
  meat: '강철 여교도관을 쓰러뜨리면 나온다',
};
/** a representative icon for each affix (icons sheet) */
export const AFFIX_ICON: Record<AffixId, string> = { burn: 'fire_grenade', bleed: 'blood_sword', dmg: 'war_hammer', speed: 'twin_daggers', heal_on_kill: 'flask' };

const range = (r: readonly [number, number]): string => `${r[0]}–${r[1]}`;
const still = (sheet: string, anim: string, ground = false): CodexPreview => ({ sheet, steps: [{ anim, hold: 0.6 }], ground });

function affixText(a: AffixId): string {
  switch (a) {
    case 'burn': return `적중한 적을 ${secs(AFFIX.burnSecs)} 태운다 (초당 ${AFFIX.burnDps})`;
    case 'bleed': return `적중한 적이 ${secs(AFFIX.bleedSecs)} 출혈한다 (적중마다 중첩, 최대 ${AFFIX.bleedStacks})`;
    case 'dmg': return `이 장비의 피해가 ${pct(AFFIX.dmgMul - 1)} 늘어난다`;
    case 'speed': return `휘두르기·활 당기기가 ${pct(1 - AFFIX.speedMul)} 빨라진다`;
    case 'heal_on_kill': return `적을 처치할 때마다 최대 체력의 ${pct(AFFIX.healPct)}를 회복한다`;
  }
}

function itemEntries(): CodexEntry[] {
  const out: CodexEntry[] = [];
  const add = (e: Omit<CodexEntry, 'tab'>): void => { out.push({ ...e, tab: 'item' }); };
  const E = LOOT.enemy;
  const C = LOOT.chest;

  add({
    id: 'cell', group: '재화', name: '셀', tag: '재화', icon: { sheet: 'pickups', anim: 'cell' },
    desc: '쓰러진 적과 상자에서 나오는 푸른 결정. 통로의 연금술사에게 영구 강화를 살 때 쓴다. 쓰지 않고 죽으면 사라진다.',
    rows: [
      { label: '획득', text: `일반 적 ${range(E.cells)} (정예 ×${E.eliteMult}) · 상자 ${range(C.cells)}` },
      { label: '', text: `중간 보스 ${range(MB.cells)} · 강철 여교도관 ${MATRON.drop.cells}` },
    ],
    preview: still('pickups', 'cell'),
  });
  add({
    id: 'gold', group: '재화', name: '골드', tag: '재화', icon: { sheet: 'pickups', anim: 'gold_coin' },
    desc: '동전과 금화 더미. 상점에서 무기와 스킬을 사는 데 쓰며, 판이 끝나면 사라진다.',
    rows: [
      { label: '획득', text: `일반 적 ${range(E.gold)} (정예 ×${E.eliteMult}) · 중간 보스 ${range(MB.gold)} · 강철 여교도관 ${MATRON.drop.gold}` },
      { label: '', text: `상자 ${range(C.gold)} (티어당 +${C.goldPerTier}, 풍족한 상자 ×${C.richMult})` },
    ],
    preview: { sheet: 'pickups', steps: [{ anim: 'gold_coin' }, { anim: 'gold_pile', dur: 1.4 }], ground: false },
  });
  for (const f of FOODS) {
    add({
      id: `food_${f.id}`, group: '음식', name: FOOD_NAME[f.id], tag: '음식', icon: { sheet: 'pickups', anim: f.sprite },
      desc: `먹으면 최대 체력의 ${pct(f.healPct)}를 바로 회복한다. 체력이 가득 차 있으면 먹지 않는다.`,
      rows: [{ label: '회복', text: `최대 체력의 ${pct(f.healPct)}` }, { label: '획득', text: FOOD_SOURCE[f.id] }],
      preview: still('pickups', f.sprite),
    });
  }
  for (const c of SCROLL_COLORS) {
    add({
      id: `scroll_${c}`, group: '힘의 두루마리', name: `${COLOR_NAMES[c]}의 두루마리`, nameColor: COLOR_HEX[c], tag: COLOR_NAMES[c],
      icon: { sheet: 'pickups', anim: SCROLL_SPRITE[c] },
      desc: `읽으면 ${COLOR_NAMES[c]} 능력이 한 단계 오른다. 제단에서 나온 두루마리에서 세 가지 중 하나를 고른다.`,
      rows: [
        { label: '효과', text: `${COLOR_NAMES[c]} 장비 피해 +${pct(SCROLL.dmgPerLevel)}` },
        { label: '', text: `최대 체력 +${pct(SCROLL.hpPerLevel[c])} (올라간 만큼 즉시 회복)` },
        { label: '누적', text: '두루마리를 읽을 때마다 레벨이 쌓인다' },
      ],
      preview: still('pickups', SCROLL_SPRITE[c]),
    });
  }
  add({
    id: 'flask', group: '회복', name: '회복 플라스크', tag: '회복', icon: { sheet: 'pickups', anim: 'flask' },
    desc: '언제든 마실 수 있는 회복약. 체력이 가득이면 쓰지 않는다.',
    rows: [
      { label: '회복', text: `최대 체력의 ${pct(FLASK.healPct)}를 ${secs(FLASK.healTime)}에 걸쳐 회복` },
      { label: '충전', text: `기본 1개 · 연금술사 강화로 최대 ${1 + META_UPGRADES.filter((u) => u.id.startsWith('flask')).length}개 · 회복 샘에서 가득 참` },
    ],
    preview: still('pickups', 'flask'),
  });
  add({
    id: 'fountain', group: '회복', name: '회복 샘', tag: '회복', icon: { sheet: 'props', anim: 'fountain' },
    desc: '통로에 있는 붉은 샘. 다가가 마시면 회복 플라스크가 모두 채워진다.',
    rows: [{ label: '위치', text: '통로' }, { label: '효과', text: '플라스크 충전을 최대치로 채움 (무제한)' }],
    preview: still('props', 'fountain', true),
  });
  for (const u of META_UPGRADES) {
    const blueprint = u.item ? ITEMS[u.item] : null;
    add({
      id: `meta_${u.id}`, group: '연금술사 강화', name: u.name, tag: `${u.cost} 셀`, icon: { sheet: 'icons', anim: u.icon },
      desc: blueprint ? `${blueprint.name}: ${blueprint.desc}. 사면 드롭 목록에 추가된다.` : `${u.desc}. 연금술사에게서 한 번만 살 수 있다.`,
      rows: [
        { label: '비용', text: `셀 ${u.cost}`, color: '#4fd8ff' },
        { label: '효과', text: u.desc },
        { label: '구매', text: '통로의 연금술사 모르웬 · 영구 적용' },
      ],
      preview: still('icons', u.icon),
    });
  }
  for (const a of Object.keys(AFFIX_NAMES) as AffixId[]) {
    const on = ITEM_IDS.filter((i) => affixPool(i).includes(a)).map((i) => ITEMS[i].name);
    add({
      id: `affix_${a}`, group: '접사', name: AFFIX_NAMES[a], tag: '접사', icon: { sheet: 'icons', anim: AFFIX_ICON[a] },
      desc: affixText(a),
      rows: [
        { label: '붙는 곳', text: on.join(' · ') },
        { label: '획득', text: `드롭마다 ${pct(AFFIX_ROLL.base)}부터 (티어당 +${pct(AFFIX_ROLL.perTier)}, 최대 ${pct(AFFIX_ROLL.max)}) · 중간 보스 장비는 항상 붙음` },
      ],
      preview: still('icons', AFFIX_ICON[a]),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------

let cache: CodexEntry[] | null = null;

/** Every codex entry, in display order (weapons, skills, enemies by family, bosses, items). Built once. */
export function buildCodex(): CodexEntry[] {
  if (cache) return cache;
  const weapons = ITEM_IDS.filter((i) => ITEMS[i].slot === 'weapon').map((i) => weaponEntry(i as WeaponId));
  const skills = ITEM_IDS.filter((i) => ITEMS[i].slot === 'skill').map((i) => skillEntry(i as SkillId));
  const enemies = BASE_KINDS.flatMap((b) => ALL_ENEMY_KINDS.filter((k) => ENEMY_DEFS[k].base === b)).map(enemyEntry);
  const bosses = [...MINIBOSS_IDS.map(miniBossEntry), matronEntry()];
  cache = [...weapons, ...skills, ...enemies, ...bosses, ...itemEntries()];
  return cache;
}

export function codexEntries(tab: CodexTabId): CodexEntry[] {
  return buildCodex().filter((e) => e.tab === tab);
}

