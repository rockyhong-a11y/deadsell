import { it } from 'vitest';
import { authoredTemplates } from '../src/game/level/templates';
import { analyzeTemplate, dumpReach } from '../src/game/level/nav';

it('debug', () => {
  const only = process.env.ONLY;
  const dump = process.env.DUMP;
  for (const biome of ['prison', 'ramparts'] as const) {
    for (const t of authoredTemplates(biome)) {
      if (only && !t.id.includes(only)) continue;
      if (dump) {
        console.log(t.id, 'from', dump, '\n' + dumpReach(t, dump, !!process.env.OPEN));
        continue;
      }
      const a = analyzeTemplate(t);
      if (a.problems.length) console.log(a.problems.join('\n'));
    }
  }
}, 120000);
