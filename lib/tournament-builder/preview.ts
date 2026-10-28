import { validateDraft } from './validate';
import { definitionHash } from './requests';
import { MODULE_CATALOG } from './catalog';
import type { ValidationResult } from './definition';

export interface DefinitionPreview extends ValidationResult {
  revision: number; definitionHash?: string; maximumMatches?: number;
  entryType?: string; thirdPlace?: string; moduleNames?: string[];
  scoring?: string; warningCodes?: string[];
}

/** Shared web/MCP review. Counts describe capacity; actual roster is checked again at lock. */
export function previewDefinition(input: unknown, revision: number): DefinitionPreview {
  const validation = validateDraft(input);
  const d = validation.definition;
  if (!d) return { ...validation, revision };
  const capacity = d.registration.max_entries;
  const rr = d.nodes.some(n => n.module === 'round_robin@1');
  const qualification = d.nodes.find(n => n.module === 'qualify@1');
  const elimination = d.nodes.find(n => n.module === 'elimination@1');
  const bracketSize = qualification?.module === 'qualify@1' ? qualification.config.count :
    [16, 8, 4, 2].find(n => n <= capacity && n >= d.registration.min_entries) ?? 0;
  const bronze = elimination?.module === 'elimination@1' && elimination.config.bronze;
  const maximumMatches = (rr ? capacity * (capacity - 1) / 2 : 0) +
    (elimination ? bracketSize - 1 + Number(bronze) : 0);
  return {
    ...validation, revision, definitionHash: definitionHash(d), maximumMatches,
    entryType: d.registration.entry_type,
    thirdPlace: elimination ? bronze ? 'bronze_match' : bracketSize >= 4 ? 'shared' : 'not_applicable' : 'ranking',
    moduleNames: d.nodes.map(n => MODULE_CATALOG.find(m => m.id === n.module)?.id ?? n.module),
    scoring: `${d.policies.match.target} points, win by ${d.policies.match.win_by}`,
    warningCodes: [...new Set(validation.warnings.map(w => w.code))],
  };
}
