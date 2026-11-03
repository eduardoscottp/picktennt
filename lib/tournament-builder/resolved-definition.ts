import type { CommandSnapshot } from './commands';

/** Keep the published plan immutable; generation records its completed graph with the locked roster. */
export function resolvedDefinition(snapshot: Pick<CommandSnapshot, 'event' | 'definitions' | 'stages'>) {
  const row = snapshot.definitions.find(d => d.id === snapshot.event?.definition_id) ?? snapshot.definitions.at(-1);
  const output = snapshot.stages.find(stage => stage.module_id === 'entries' && (!stage.definition_id || stage.definition_id === row?.id))?.output as Record<string, unknown> | undefined;
  const definition = row?.definition as Record<string, unknown> | undefined;
  return row && definition?.schema_version === '2.0' && Array.isArray(output?.finalizedNodes)
    ? { ...row, definition: { ...definition, nodes: output.finalizedNodes } }
    : row;
}
