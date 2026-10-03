import { describe, it, expect } from 'vitest';
import { authoredTemplates } from '../src/game/level/templates';
import { analyzeTemplate } from '../src/game/level/nav';

describe('templates', () => {
  for (const biome of ['prison', 'ramparts'] as const) {
    for (const t of authoredTemplates(biome)) {
      it(`${t.id} is valid`, () => {
        const a = analyzeTemplate(t);
        expect(a.problems).toEqual([]);
      }, 60000);
    }
  }
});
