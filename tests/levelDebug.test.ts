import { it } from 'vitest';
import { authoredTemplates } from '../src/game/level/templates';
import { analyzeTemplate } from '../src/game/level/nav';

it('debug', () => {
  const only = process.env.ONLY;
  for (const biome of ['prison', 'ramparts'] as const) {
    for (const t of authoredTemplates(biome)) {
      if (only && !t.id.includes(only)) continue;
      const a = analyzeTemplate(t);
      if (a.problems.length) console.log(a.problems.join('\n'));
    }
  }
}, 120000);
