import type { BiomeId } from '../../run';
import { mirrorDef, parseTemplate } from './parse';
import type { ParsedTemplate, TemplateDef } from './types';
import { PRISON_TEMPLATES } from './prison';
import { RAMPARTS_TEMPLATES } from './ramparts';
import { SPECIAL_TEMPLATES } from './special';

export type { ParsedTemplate, TemplateDef, TemplateTag, Site, Side } from './types';
export { siteKey, oppositeSide } from './types';
export { parseTemplate, mirrorDef } from './parse';

const cache = new Map<string, ParsedTemplate>();

function parsed(def: TemplateDef): ParsedTemplate {
  let p = cache.get(def.id);
  if (!p) {
    p = parseTemplate(def);
    cache.set(def.id, p);
  }
  return p;
}

const DEFS: Record<'prison' | 'ramparts', TemplateDef[]> = { prison: PRISON_TEMPLATES, ramparts: RAMPARTS_TEMPLATES };

/** The hand-authored templates of a biome (no mirrored copies). */
export function authoredTemplates(biome: BiomeId): ParsedTemplate[] {
  const defs = biome === 'prison' || biome === 'ramparts' ? DEFS[biome] : [];
  return defs.map(parsed);
}

/**
 * Everything the generator may pick from: every authored template plus its horizontal mirror image
 * (mirroring keeps door sites valid: L<->R, T/B columns 14..17 map onto themselves).
 */
export function templatePool(biome: BiomeId): ParsedTemplate[] {
  const defs = biome === 'prison' || biome === 'ramparts' ? DEFS[biome] : [];
  const out: ParsedTemplate[] = [];
  for (const d of defs) {
    out.push(parsed(d));
    out.push(parsed(mirrorDef(d)));
  }
  return out;
}

/** The passage room (A, H, X, torches) and the boss arena; free-size templates. */
export function specialTemplate(id: 'passage' | 'boss_arena'): ParsedTemplate {
  const def = SPECIAL_TEMPLATES.find((t) => t.id === id)!;
  return parsed(def);
}
