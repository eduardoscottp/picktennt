import type { DefinitionJsonSchema } from './definition-schema';

export const MODULE_IDS = ['registration@1', 'entries@1', 'round_robin@1', 'standings@1', 'qualify@1', 'elimination@1', 'placements@1'] as const;
export type ModuleId = typeof MODULE_IDS[number];
export const RANKING_KEYS = ['wins_desc', 'differential_desc', 'points_for_desc', 'points_against_asc', 'points_for_in_losses_desc'] as const;
export type RankingKey = typeof RANKING_KEYS[number];
export type DefinitionNode =
  | { id: string; module: 'registration@1'; config?: Record<string, never> }
  | { id: string; module: 'entries@1' | 'round_robin@1' | 'standings@1' | 'placements@1'; from: string; config?: Record<string, never> }
  | { id: string; module: 'qualify@1'; from: string; config: { count: 2 | 4 } }
  | { id: string; module: 'elimination@1'; from: string; config: { seeding: 'draw' | 'ranked'; bronze: boolean } };
export interface TournamentDefinition {
  schema_version: '1.0';
  event: { name: string; starts_at: string; expected_end_at: string; timezone: string; venue_name: string; visibility: 'public' | 'unlisted'; courts: number };
  registration: { mode: 'open' | 'approval'; entry_type: 'singles' | 'fixed_doubles'; max_entries: number; min_entries: number; closes_at: string; partner_consent: boolean; organizer_plays: boolean };
  policies: { match: { version: 1; games: 1; target: 11 | 15 | 21; win_by: 1 | 2; cap: null; scoring: 'side_out' | 'rally' }; ranking: { version: 1; order: RankingKey[]; final_tie: 'recorded_draw' }; confirmation: 'opponent_or_admin_v1'; withdrawal: 'stage_sensitive_v1'; correction: 'impact_review_void_and_replay_v1' };
  scheduling: { estimated_slot_minutes: number; minimum_rest_minutes: number; contingency_minutes: number };
  nodes: DefinitionNode[];
}
export type DeepPartial<T> = T extends (infer U)[] ? DeepPartial<U>[] : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
export type TournamentDraft = DeepPartial<TournamentDefinition>;
export interface ValidationIssue { code: 'MISSING_FIELD' | 'UNSUPPORTED_MODULE' | 'UNSUPPORTED_RULE' | 'INCOMPATIBLE_CONNECTION' | 'INVALID_CAPACITY' | 'INVALID_ADVANCEMENT' | 'RESOURCE_CONFLICT' | 'INSUFFICIENT_TIME'; message: string; field_path: string; node_id?: string; allowed_values?: unknown[]; constraints?: DefinitionJsonSchema }
export interface ValidationResult { valid: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[]; missing_fields: ValidationIssue[]; definition?: TournamentDefinition }
export interface ValidationOptions { now?: Date; publication?: boolean }
