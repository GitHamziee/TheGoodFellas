// CLIENT-only account fields — see User.states / User.carriers in schema.prisma.
// Centralized here (not hand-checked per call site) the same way lead-fields.ts centralizes
// Lead field validation.

export const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia",
  "Wisconsin", "Wyoming",
] as const;

const US_STATE_SET = new Set<string>(US_STATES);

export function isValidState(state: string): boolean {
  return US_STATE_SET.has(state);
}

const MAX_CARRIERS = 50;
const MAX_CARRIER_LENGTH = 80;

type ParseResult = { value: string[] } | { error: string };

/** `undefined` means the key was absent from input — caller should leave the field
 * unchanged. Otherwise either a validated, deduped list or an error. */
export function parseStates(raw: unknown): ParseResult | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return { error: "States must be a list" };

  const states = [...new Set(raw)];
  for (const s of states) {
    if (typeof s !== "string" || !US_STATE_SET.has(s)) return { error: `Invalid state: ${String(s)}` };
  }
  return { value: states };
}

export const ACCEPTED_CARDS = ["DIRECT_EXPRESS", "DEBIT_CARD", "CREDIT_CARD"] as const;
const ACCEPTED_CARD_SET = new Set<string>(ACCEPTED_CARDS);

/** Card types a client accepts — a deduped subset of ACCEPTED_CARDS. `undefined` means the
 * key was absent from input. */
export function parseAcceptedCards(raw: unknown): ParseResult | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return { error: "Accepted cards must be a list" };

  const cards = [...new Set(raw)];
  for (const c of cards) {
    if (typeof c !== "string" || !ACCEPTED_CARD_SET.has(c)) return { error: `Invalid card type: ${String(c)}` };
  }
  return { value: cards };
}

const PLAN_TYPES = ["LEVEL", "GRADED", "MODIFIED", "GI"] as const;
export type StatePlan = { state: string; carrier: string; plans: (typeof PLAN_TYPES)[number][] };

/** Per state x carrier plan selections: `[{ state, carrier, plans }]`. States must be real US
 * states, carrier names follow the roster's trim rules, plans must be valid PlanType values.
 * An entry with an empty plan list is kept: the carrier is available in that state, no plans
 * ticked yet. `undefined` means the key was absent from input. */
export function parseStatePlans(raw: unknown): { value: StatePlan[] } | { error: string } | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return { error: "State plans must be a list" };

  const out: StatePlan[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return { error: "Invalid state plan entry" };
    const { state, carrier, plans } = entry as Record<string, unknown>;
    if (typeof state !== "string" || !US_STATE_SET.has(state)) return { error: `Invalid state: ${String(state)}` };
    const name = parseCarriers([carrier]);
    if (!name || "error" in name) return { error: name && "error" in name ? name.error : "Invalid carrier" };
    if (!name.value.length) continue;
    if (!Array.isArray(plans)) return { error: "Plans must be a list" };
    for (const p of plans) {
      if (typeof p !== "string" || !(PLAN_TYPES as readonly string[]).includes(p)) return { error: `Invalid plan: ${String(p)}` };
    }
    const key = `${state}|${name.value[0].toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ state, carrier: name.value[0], plans: [...new Set(plans)] as StatePlan["plans"] });
  }
  return { value: out };
}

/** Per-state carrier lists derived from state plans — the shape ClientStateCarrier stores. */
export function carriersByState(plans: StatePlan[]): { state: string; carriers: string[] }[] {
  const map = new Map<string, string[]>();
  for (const p of plans) map.set(p.state, [...(map.get(p.state) ?? []), p.carrier]);
  return [...map.entries()].map(([state, carriers]) => ({ state, carriers }));
}

/** Carriers are freehand text (no fixed list) — trimmed, deduped case-insensitively,
 * empty entries dropped. `undefined` means the key was absent from input. */
export function parseCarriers(raw: unknown): ParseResult | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return { error: "Carriers must be a list" };

  const carriers: string[] = [];
  const seen = new Set<string>();
  for (const c of raw) {
    if (typeof c !== "string") return { error: "Each carrier must be text" };
    const trimmed = c.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_CARRIER_LENGTH) return { error: `Carrier name too long: ${trimmed}` };
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    carriers.push(trimmed);
  }
  if (carriers.length > MAX_CARRIERS) return { error: `Too many carriers (max ${MAX_CARRIERS})` };
  return { value: carriers };
}
