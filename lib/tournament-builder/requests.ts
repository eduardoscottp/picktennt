import { createHash } from 'node:crypto';

export class DomainError extends Error {
  constructor(public code: string, message: string, public details?: unknown) { super(message); }
}
export interface CommandEnvelope {
  operation_id: string;
  expected_revision?: number;
  data: Record<string, unknown>;
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseEnvelope(input: unknown, creating = false): CommandEnvelope {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DomainError('INVALID_REQUEST', 'Expected a command object.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['operation_id', 'expected_revision', 'data'].includes(key)) ||
    typeof value.operation_id !== 'string' || !UUID.test(value.operation_id) ||
    !value.data || typeof value.data !== 'object' || Array.isArray(value.data) ||
    (value.expected_revision === undefined ? !creating : !Number.isSafeInteger(value.expected_revision) || Number(value.expected_revision) < 0)) {
    throw new DomainError('INVALID_REQUEST', 'Provide an operation UUID, current revision and command data.');
  }
  return value as unknown as CommandEnvelope;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(',')}}`;
  }
  if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new DomainError('INVALID_REQUEST', 'Only JSON values are supported.');
  return JSON.stringify(value);
}
export function definitionHash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function requestHash(command: string, resource: string | null, revision: number | undefined, data: unknown): string {
  return definitionHash({ command, resource, revision: revision ?? null, data });
}
