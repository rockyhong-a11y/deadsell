import { test, expect, type Page } from '@playwright/test';
import { boot } from './helpers';

/**
 * docs/CONTENT2.md in the real game (Chromium, real asset loading + real render loop, sound ON so audio errors surface):
 *  - all 30 enemy types spawn on their own sprite sheet and fight without errors,
 *  - the four mid-bosses (one per biome pair, picked by the run seed) wake with a name card + HP bar, telegraph every attack,
 *    and drop exactly one weapon and one skill (tier + 1, affix) when they die.
 * The debug hooks (__ds.spawn / gotoMiniboss) set the scene up; the simulation is stepped synchronously for determinism.
 */
test.use({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
test.setTimeout(180_000);

const BASES = ['ghoul', 'jailer', 'archer', 'bomber', 'harpy', 'lancer'];
const VARIANTS: Record<string, string[]> = {
  ghoul: ['plague', 'frenzy', 'shackled', 'wraith'],
  jailer: ['warden', 'torch', 'spear', 'chain'],
  archer: ['fire', 'volley', 'crossbow', 'shadow'],
  bomber: ['frost', 'cluster', 'kamikaze', 'alchemist'],
  harpy: ['storm', 'raven', 'siren', 'ember'],
  lancer: ['halberd', 'paladin', 'duelist', 'dragoon'],
};
const ALL = BASES.flatMap((b) => [b, ...VARIANTS[b].map((v) => `${b}_${v}`)]);
const MIDBOSSES = ['mb_abbess', 'mb_arachne', 'mb_valkyrie', 'mb_witch'];
const SKILLS = ['fire_grenade', 'ice_grenade', 'turret', 'wolf_trap'];

async function startRun(page: Page, seed: number) {
  // wait for the NEW scene (the old level scene may still be up while the fade runs)
  await page.evaluate((s) => { (window as any).__prev = (window as any).__ds.game.scene; (window as any).__ds.start(s); }, seed);
  await page.waitForFunction(() => { const d = (window as any).__ds; return d.game.scene !== (window as any).__prev && d.game.scene?.constructor?.name === 'LevelScene' && d.game.fade < 0.3 && d.player?.onGround === true; }, null, { timeout: 30_000 });
}
async function toLevel(page: Page, name: string) {
  await page.evaluate((n) => { (window as any).__prev = (window as any).__ds.game.scene; (window as any).__ds.gotoLevel(n); }, name);
  await page.waitForFunction(() => { const d = (window as any).__ds; return d.game.scene !== (window as any).__prev && d.game.fade < 0.3 && d.player?.onGround === true; }, null, { timeout: 30_000 });
}

test('all 30 enemy types use their own sheet and fight without errors', async ({ page }) => {
  const c = await boot(page, { query: '?seed=1&god=1' });
  await startRun(page, 1);

  const sheets = await page.evaluate((ids) => {
    const a = (window as any).__ds.game.assets;
    return ids.filter((id: string) => a.sheet(id).placeholder);
  }, [...ALL, ...MIDBOSSES]);
  expect(sheets, 'sheets that fell back to the placeholder').toEqual([]);

  expect(ALL).toHaveLength(30);
  for (const base of BASES) {
    const family = [base, ...VARIANTS[base].map((v) => `${base}_${v}`)];
    const res = await page.evaluate((family) => {
      const ds = (window as any).__ds;
      const w = ds.world, p = w.player, inp = w.input;
      for (const e of w.entities) if (e.team === 'enemy' && e.targetable && e.kind) e.dead = true;
      ds.step(2);
      const made = family.map((id: string, i: number) => {
        const e = ds.spawn(id, (i % 2 ? 1 : -1) * (90 + i * 26));
        return { id, kind: e?.kind as string | undefined, cls: e?.constructor.name as string | undefined };
      });
      const bad: string[] = [];
      for (let f = 0; f < 480; f++) {
        const near = w.entities
          .filter((e: any) => e.team === 'enemy' && !e.dead && !e.dying && typeof e.hp === 'number' && Math.abs(e.x - p.x) < 320)
          .sort((a: any, b: any) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
        inp.setAxis('sweep', near && Math.abs(near.x - p.x) > 44 ? Math.sign(near.x - p.x) : 0, 0);
        if (f % 12 === 0) inp.tap('attack1');
        if (f % 150 === 20) inp.tap('roll');
        ds.step(1);
        for (const e of w.entities) if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) bad.push(`${e.constructor.name} at ${e.x},${e.y}`);
        if (bad.length) break;
      }
      inp.setAxis('sweep', 0, 0);
      return { made, bad };
    }, family);
    for (const m of res.made) expect(m.kind, `__ds.spawn('${m.id}')`).toBe(m.id);
    expect(res.bad, family.join(',')).toEqual([]);
    await page.waitForTimeout(250); // let the real render loop draw this family
  }
  expect(c.errors).toEqual([]);
});

test('the four mid-bosses: name card + bar, telegraphed attacks, one weapon + one skill on death', async ({ page }) => {
  const c = await boot(page, { query: '?seed=1&god=1' });

  // find a run seed for each of the four (two per biome, picked by the seed)
  const seeds: Record<string, number> = {};
  for (let s = 1; s <= 14 && Object.keys(seeds).length < 4; s++) {
    await startRun(page, s);
    const a = await page.evaluate(() => (window as any).__ds.world.entities.find((e: any) => e.spec?.id)?.spec.id as string | undefined);
    if (a && !(a in seeds)) seeds[a] = s;
    if (Object.keys(seeds).length >= 4) break;
    await toLevel(page, 'ramparts');
    const r = await page.evaluate(() => (window as any).__ds.world.entities.find((e: any) => e.spec?.id)?.spec.id as string | undefined);
    if (r && !(r in seeds)) seeds[r] = s;
  }
  expect(Object.keys(seeds).sort(), 'every mid-boss shows up for some seed').toEqual([...MIDBOSSES].sort());

  for (const id of MIDBOSSES) {
    await test.step(id, async () => {
      await startRun(page, seeds[id]);
      if (id === 'mb_valkyrie' || id === 'mb_witch') await toLevel(page, 'ramparts');
      const out = await page.evaluate((SKILLS) => {
        const ds = (window as any).__ds;
        const mb0 = ds.gotoMiniboss();
        if (!mb0) throw new Error('gotoMiniboss returned null');
        const w = ds.world, p = w.player, inp = w.input, mb = mb0;
        const run = ds.game.run;
        const ev: string[] = [];
        w.on((e: any) => { if (e.type.startsWith('miniboss')) ev.push(e.type); });
        const hud = ds.game.scene.ui.hud;
        // walk in until it wakes
        let f = 0;
        for (; f < 2400 && mb.state === 'dormant'; f++) { inp.setAxis('sweep', Math.sign(mb.x - p.x), 0); ds.step(1); }
        inp.setAxis('sweep', 0, 0);
        const woke = mb.state !== 'dormant';
        let card = false, bar = false;
        // watch the intro and the first attacks: every damaging (active) phase must be preceded by a windup
        const attacks = new Set<string>();
        const skipped: string[] = [];
        let prev = mb.state;
        for (f = 0; f < 1500 && attacks.size < 3; f++) {
          inp.setAxis('sweep', Math.abs(mb.x - p.x) > 120 ? Math.sign(mb.x - p.x) : 0, 0);
          ds.step(1);
          card = card || hud.miniCardActive;
          bar = bar || hud.miniBarVisible;
          if (mb.state === 'windup') attacks.add(mb.attack);
          if (mb.state === 'active' && prev !== 'windup' && prev !== 'active') skipped.push(mb.attack);
          prev = mb.state;
        }
        inp.setAxis('sweep', 0, 0);
        const mini = !!ds.game.scene.ui.miniboss;
        // fight for real from 10 % health
        mb.hp = Math.round(mb.maxHp * 0.1);
        for (f = 0; f < 3600 && !mb.dead && mb.state !== 'dying'; f++) {
          const dx = mb.x - p.x;
          inp.setAxis('sweep', Math.abs(dx) > 50 ? Math.sign(dx) : 0, 0);
          if (f % 12 === 0) inp.tap('attack1');
          if (f % 90 === 45) inp.tap('jump');
          ds.step(1);
        }
        inp.setAxis('sweep', 0, 0);
        const killedByHand = mb.state === 'dying' || mb.dead;
        if (!killedByHand) ds.killAll();
        const tier = run.tier;
        ds.step(200);
        const drops = w.entities.filter((e: any) => e.constructor.name === 'ItemDrop' && !e.dead).map((e: any) => ({ id: e.inst.id as string, tier: e.inst.tier as number, affix: e.inst.affix as string | null }));
        return {
          name: mb.spec.name as string, woke, card, bar, mini, attacks: [...attacks], skipped, killedByHand, ev, tier, drops,
          weapons: drops.filter((d: any) => !SKILLS.includes(d.id)), skills: drops.filter((d: any) => SKILLS.includes(d.id)),
          miniAfter: !!ds.game.scene.ui.miniboss,
        };
      }, SKILLS);
      expect(out.woke, 'the boss wakes when the player walks in').toBe(true);
      expect(out.ev.filter((e: string) => e === 'minibossStart'), 'minibossStart fired once').toHaveLength(1);
      expect(out.card, 'name card shown').toBe(true);
      expect(out.bar, 'HP bar shown').toBe(true);
      expect(out.mini).toBe(true);
      expect(out.attacks.length, `telegraphed attacks seen: ${out.attacks}`).toBeGreaterThanOrEqual(2);
      expect(out.skipped, 'an attack hit without a windup').toEqual([]);
      expect(out.ev.filter((e: string) => e === 'minibossDefeated'), 'minibossDefeated fired once').toHaveLength(1);
      expect(out.weapons, JSON.stringify(out.drops)).toHaveLength(1);
      expect(out.skills, JSON.stringify(out.drops)).toHaveLength(1);
      for (const d of out.drops) {
        expect(d.tier, `${d.id} tier`).toBe(out.tier + 1);
        expect(d.affix, `${d.id} affix`).toBeTruthy();
      }
      expect(out.miniAfter, 'the HUD bar clears after the kill').toBe(false);
    });
  }
  expect(c.errors).toEqual([]);
});
