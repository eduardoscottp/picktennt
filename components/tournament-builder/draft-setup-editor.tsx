"use client";

import { Input } from "@/components/ui/input";
import type { ValidationIssue } from "@/lib/tournament-builder/definition";

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
type Field = { path: string; label: string; type: "text" | "number" | "date" | "choice"; min?: number; max?: number; maxLength?: number; choices?: [string | boolean, string][] };
const fields: Field[] = [
  { path: "event.name", label: "Tournament name", type: "text", maxLength: 120 },
  { path: "event.venue_name", label: "Venue", type: "text", maxLength: 200 },
  { path: "event.timezone", label: "Event timezone", type: "text", maxLength: 100 },
  { path: "event.starts_at", label: "Tournament starts", type: "date" },
  { path: "event.expected_end_at", label: "Expected finish", type: "date" },
  { path: "event.courts", label: "Courts", type: "number", min: 1, max: 8 },
  { path: "event.visibility", label: "Visibility", type: "choice", choices: [["public", "Public"], ["unlisted", "Unlisted (share the link)"]] },
  { path: "registration.mode", label: "Registration approval", type: "choice", choices: [["open", "Open admission"], ["approval", "Administrator approval"]] },
  { path: "registration.entry_type", label: "Entry type", type: "choice", choices: [["singles", "Singles"], ["fixed_doubles", "Fixed doubles teams"]] },
  { path: "registration.min_entries", label: "Minimum entries to proceed", type: "number", min: 2, max: 16 },
  { path: "registration.max_entries", label: "Maximum entries", type: "number", min: 2, max: 16 },
  { path: "registration.closes_at", label: "Registration closes", type: "date" },
  { path: "registration.partner_consent", label: "Partner consent", type: "choice", choices: [[false, "Individual slots"]] },
  { path: "registration.organizer_plays", label: "Will the organizer play?", type: "choice", choices: [[true, "Yes — joins separately as a player"], [false, "No"]] },
  { path: "scheduling.estimated_slot_minutes", label: "Match slot (minutes)", type: "number", min: 5, max: 120 },
  { path: "scheduling.minimum_rest_minutes", label: "Planned rest (minutes)", type: "number", min: 0, max: 30 },
  { path: "scheduling.contingency_minutes", label: "Contingency (minutes)", type: "number", min: 0, max: 240 },
];
export const draftFieldId = (path: string) => `draft-${(fields.find(field => field.path === path)?.path ?? fields.find(field => field.path.startsWith(`${path}.`))?.path ?? path).replaceAll(".", "-")}`;
export const draftSetupLabel = (path: string) => fields.find(field => field.path === path)?.label ?? (path === "scheduling" ? "Scheduling" : path);
export const hasDraftSetupField = (path: string) => fields.some(field => field.path === path || field.path.startsWith(`${path}.`));
export function draftSetupValue(definition: Record<string, unknown>, path: string): unknown {
  const [section, key] = path.split(".");
  return object(definition[section])[key];
}

/** Convert a wall-clock picker value in the event's IANA zone, independent of browser timezone. */
export function eventTimestamp(local: string, timezone: string, previous?: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(local)) return;
  const wall = local.length === 16 ? `${local}:00` : local;
  const base = Date.parse(`${wall}Z`);
  if (!Number.isFinite(base) || new Date(base).toISOString().slice(0, 19) !== wall) return;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    const offsets = new Set([-36, 0, 36].map(hours => {
      const label = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" }).formatToParts(base + hours * 3_600_000).find(p => p.type === "timeZoneName")!.value;
      return label === "GMT" ? "+00:00" : label.replace("GMT", "");
    }));
    const candidates = [...offsets].map(offset => `${wall}${offset}`).filter(value => {
      const parts = formatter.formatToParts(Date.parse(value));
      const part = (name: string) => parts.find(p => p.type === name)?.value;
      return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}` === wall;
    }).sort((a, b) => Date.parse(a) - Date.parse(b));
    // Preserve an existing repeated-hour choice; new repeated-hour times use the first occurrence.
    return candidates.find(value => previous?.endsWith(value.slice(-6))) ?? candidates[0];
  } catch { return; }
}

export function applyDraftSetupEdit(definition: Record<string, unknown>, path: string, raw: string): Record<string, unknown> {
  const field = fields.find(field => field.path === path);
  if (!field) return definition;
  const [section, key] = path.split(".");
  const nextSection = { ...object(definition[section]) };
  if (raw === "") delete nextSection[key];
  else if (field.type === "number") nextSection[key] = Number(raw);
  else if (field.type === "date") nextSection[key] = eventTimestamp(raw, String(object(definition.event).timezone ?? ""), String(nextSection[key] ?? "")) ?? raw;
  else if (field.type === "choice") nextSection[key] = field.choices?.find(([value]) => String(value) === raw)?.[0] ?? raw;
  else nextSection[key] = raw;
  const next = { ...definition, [section]: nextSection };
  if (path === "event.timezone") for (const dateField of fields.filter(field => field.type === "date")) {
    const old = draftSetupValue(next, dateField.path);
    if (typeof old !== "string") continue;
    const [dateSection, dateKey] = dateField.path.split(".");
    next[dateSection] = { ...object(next[dateSection]), [dateKey]: eventTimestamp(old.slice(0, 19), raw, old) ?? old.slice(0, 19) };
  }
  return next;
}

export function draftSetupError(definition: Record<string, unknown>, path: string): string | undefined {
  const field = fields.find(field => field.path === path);
  if (!field) return fields.filter(child => child.path.startsWith(`${path}.`)).map(child => draftSetupError(definition, child.path)).find(Boolean);
  const value = draftSetupValue(definition, path);
  if (value === undefined || value === null || value === "") return `${field.label} is required.`;
  if (field.type === "number" && (!Number.isInteger(value) || Number(value) < field.min! || Number(value) > field.max!)) return `Enter a whole number from ${field.min} to ${field.max}.`;
  if (field.type === "text" && (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > field.maxLength!)) return `Enter ${field.label.toLowerCase()} without extra spaces (up to ${field.maxLength} characters).`;
  if (field.type === "choice" && !(path === "registration.partner_consent" && value === true && draftSetupValue(definition, "registration.entry_type") === "fixed_doubles") && !field.choices?.some(([choice]) => choice === value)) return `Choose ${field.label.toLowerCase()}.`;
  if (path === "event.timezone") { try { new Intl.DateTimeFormat("en-US", { timeZone: String(value) }).format(); } catch { return "Enter a valid timezone, such as America/New_York."; } }
  if (field.type === "date" && (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !eventTimestamp(value.slice(0, 19), String(object(definition.event).timezone ?? ""), value))) return "Choose a valid date and time in the event timezone.";
  if (path === "event.expected_end_at" && Date.parse(String(value)) <= Date.parse(String(draftSetupValue(definition, "event.starts_at")))) return "Expected finish must follow the tournament start.";
  if (path === "registration.closes_at" && Date.parse(String(value)) > Date.parse(String(draftSetupValue(definition, "event.starts_at")))) return "Registration must close before or at the tournament start.";
  if (path === "registration.min_entries" && Number(value) > Number(draftSetupValue(definition, "registration.max_entries"))) return "Minimum entries cannot exceed the maximum.";
  if (path === "registration.partner_consent" && draftSetupValue(definition, "registration.entry_type") === "singles" && value) return "Singles cannot require partner consent.";
}

export function DraftSetupEditor({ definition, savedDefinition, issues, disabled, onChange }: { definition: Record<string, unknown>; savedDefinition: Record<string, unknown>; issues: ValidationIssue[]; disabled: boolean; onChange: (definition: Record<string, unknown>) => void }) {
  return <fieldset disabled={disabled} className="space-y-4 rounded-xl border p-4 disabled:opacity-60"><legend className="px-1 font-semibold">Complete tournament setup</legend>
    <p className="text-sm text-gray-600">Fields marked Required must be completed before approving the tournament. You can save a partial draft at any time. Dates and times use the event timezone.</p>
    <div className="grid gap-4 sm:grid-cols-2">{fields.map(field => {
      if (field.path === "registration.partner_consent" && typeof draftSetupValue(definition, field.path) === "boolean") return null;
      const value = draftSetupValue(definition, field.path), id = draftFieldId(field.path);
      const serverIssue = value === draftSetupValue(savedDefinition, field.path) ? issues.find(issue => issue.field_path === field.path) : undefined;
      const error = draftSetupError(definition, field.path) ?? serverIssue?.message;
      const describedBy = error ? `${id}-error` : undefined;
      const inputValue = value === undefined || value === null ? "" : String(value);
      const change = (raw: string) => onChange(applyDraftSetupEdit(definition, field.path, raw));
      return <div key={field.path} id={`${id}-field`}>
        {field.type === "choice" ? <><label htmlFor={id} className={`block text-sm font-medium ${error ? "text-red-700" : "text-gray-700"}`}>{field.label} <span className="text-xs">(Required)</span></label><select id={id} required aria-invalid={!!error} aria-describedby={describedBy} className={`mt-1 h-11 w-full rounded-xl border bg-white px-3 text-sm ${error ? "border-red-400" : "border-gray-200"}`} value={inputValue} onChange={event => change(event.target.value)}><option value="">Choose an option</option>{field.choices?.map(([option, label]) => <option key={String(option)} value={String(option)}>{label}</option>)}</select></>
          : <Input id={id} label={`${field.label} (Required)`} required aria-invalid={!!error} aria-describedby={describedBy} type={field.type === "date" ? "datetime-local" : field.type} value={field.type === "date" ? inputValue.slice(0, 16) : inputValue} min={field.min} max={field.max} maxLength={field.maxLength} step={field.type === "number" ? 1 : undefined} className={error ? "border-red-400" : undefined} onChange={event => change(event.target.value)} />}
        {error && <p id={`${id}-error`} className="mt-1 text-xs text-red-600">{error}</p>}
        {field.path === "scheduling.minimum_rest_minutes" && <p className="mt-1 text-xs text-gray-500">Planning allowance; the app does not enforce a waiting period between games.</p>}
      </div>;
    })}</div>
  </fieldset>;
}
