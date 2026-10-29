import type { GraphDefinition, GraphNode } from './graph-types';
import { validateDraft } from './validate';
import { definitionHash, DomainError } from './requests';

/** Complete missing connections, preserving the published rules and supplied graph facts. */
export function finalizeGraph(d: GraphDefinition, nodes: unknown): GraphDefinition {
  const validation = validateDraft(nodes === undefined ? d : { ...d, nodes });
  if (!validation.definition || validation.definition.schema_version !== '2.0') throw new DomainError('MISSING_FIELDS', 'Complete the pending tournament graph before generating matches.', validation);
  const complete = validation.definition;
  for (const original of d.nodes) {
    const node = complete.nodes.find(n => n.id === original.id);
    if (!node || Object.entries(original).some(([key, value]) => definitionHash(value) !== definitionHash((node as unknown as Record<string, unknown>)[key]))) throw new DomainError('PUBLISHED_DEFINITION', 'Finalization can complete missing graph facts; it cannot replace published connections or rules.');
  }
  return complete;
}

/** Slot occupancy is separate from the real roster; absent slots never become entries. */
export function assignGroupSlots(d: GraphDefinition, ids: string[], input: unknown): Record<string, string> | undefined {
  if (input === undefined) {
    if (ids.length < d.registration.max_entries) throw new DomainError('INCOMPLETE_ROSTER', 'Review and provide group_assignments for the actual underfilled roster before generation.');
    return undefined;
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DomainError('INVALID_REQUEST', 'Provide group assignments by group node ID.');
  const groups = d.nodes.filter((n): n is Extract<GraphNode, { module: 'round_robin@2' }> => n.module === 'round_robin@2' && n.inputs.every(s => s.kind === 'seed'));
  const assignments = input as Record<string, unknown>;
  if (!groups.length || Object.keys(assignments).length !== groups.length || Object.keys(assignments).some(key => !groups.some(g => g.id === key))) throw new DomainError('INVALID_REQUEST', 'Assign every initial seeded group by its node ID.');
  const slots: Record<string, string> = {}, seen = new Set<string>();
  for (const group of groups) {
    const entries = assignments[group.id];
    if (!Array.isArray(entries) || entries.length < 2 || entries.length > group.inputs.length) throw new DomainError('INVALID_CAPACITY', 'Each initial group requires at least two teams and cannot exceed its planned slots.');
    entries.forEach((id, index) => {
      if (typeof id !== 'string' || !ids.includes(id) || seen.has(id)) throw new DomainError('INCOMPLETE_ROSTER', 'Group assignments must use each actual approved entry exactly once.');
      seen.add(id);
      const source = group.inputs[index];
      if (source.kind === 'seed') slots[source.seed] = id;
    });
  }
  if (seen.size !== ids.length) throw new DomainError('INCOMPLETE_ROSTER', 'Group assignments must cover the entire approved roster.');
  return slots;
}
