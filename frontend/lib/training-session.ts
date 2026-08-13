import type { ActorRecord, CrewMember, GameState, Intel, Order, RoundRecord } from "@/lib/game";
import { readLocalValue, removeLocalValue, writeLocalValue } from "@/lib/storage";

export const TRAINING_SESSION_KEY = "mutiny:training-session:v1";
export type TrainingEntry = "MANIFEST" | "DOSSIER" | "BRIDGE";

export type TrainingSession = {
  game: GameState;
  entry: TrainingEntry;
  order: Order;
  selectedCrew: number;
  vote: number;
};

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value));
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function triple(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const values = value.map(number);
  return values.every((item) => item !== null) ? [values[0]!, values[1]!, values[2]!] : null;
}

function sideAction(value: unknown): Order["sideAction"] | null {
  return value === "NONE" || value === "INVESTIGATE" || value === "SPECIAL" ? value : null;
}

function order(value: unknown): Order | null {
  const item = record(value);
  if (!item) return null;
  const allocations = triple(item.allocations);
  const action = sideAction(item.sideAction);
  const target = number(item.target);
  return allocations && action && target !== null ? { allocations, sideAction: action, target } : null;
}

function crewMember(value: unknown): CrewMember | null {
  const item = record(value);
  if (!item) return null;
  const seat = number(item.seat);
  const suspicion = number(item.suspicion);
  const role = item.role;
  if (seat === null || suspicion === null || typeof item.callsign !== "string" || typeof item.objective !== "string" || typeof item.active !== "boolean") return null;
  if (role !== "CAPTAIN" && role !== "ENGINEER" && role !== "MEDIC" && role !== "SMUGGLER" && role !== "QUARTERMASTER" && role !== "SABOTEUR") return null;
  return { seat, callsign: item.callsign, role, objective: item.objective, active: item.active, suspicion };
}

function actor(value: unknown): ActorRecord | null {
  const item = record(value);
  const member = crewMember(value);
  if (!item || !member) return null;
  const claimed = triple(item.claimed);
  const actual = triple(item.actual);
  const action = sideAction(item.sideAction);
  const target = number(item.target);
  if (!claimed || !actual || !action || target === null || typeof item.anomalous !== "boolean") return null;
  return { seat: member.seat, callsign: member.callsign, role: member.role, claimed, actual, sideAction: action, target, anomalous: item.anomalous };
}

function roundRecord(value: unknown): RoundRecord | null {
  const item = record(value);
  if (!item) return null;
  const round = number(item.round);
  const before = triple(item.before);
  const trueAfter = triple(item.trueAfter);
  const displayedAfter = triple(item.displayedAfter);
  const claimedTotals = triple(item.claimedTotals);
  const sabotageTotals = triple(item.sabotageTotals);
  const telemetrySystem = item.telemetrySystem === null ? null : number(item.telemetrySystem);
  const actors = Array.isArray(item.actors) ? item.actors.map(actor) : [];
  if (round === null || !before || !trueAfter || !displayedAfter || !claimedTotals || !sabotageTotals || telemetrySystem === null && item.telemetrySystem !== null || actors.some((entry) => entry === null)) return null;
  const votes = item.votes === undefined ? undefined : Array.isArray(item.votes) ? item.votes.map(number) : [];
  if (votes?.some((entry) => entry === null)) return null;
  const ejected = item.ejected === undefined || item.ejected === null ? item.ejected : number(item.ejected);
  if (ejected === null && item.ejected !== null && item.ejected !== undefined) return null;
  return {
    round,
    before,
    trueAfter,
    displayedAfter,
    claimedTotals,
    sabotageTotals,
    telemetrySystem,
    actors: actors.filter((entry): entry is ActorRecord => entry !== null),
    votes: votes?.filter((entry): entry is number => entry !== null),
    ejected,
  };
}

function intel(value: unknown): Intel | null {
  const item = record(value);
  if (!item || typeof item.text !== "string") return null;
  if (item.type !== "INVESTIGATION" && item.type !== "AUDIT" && item.type !== "SYSTEM") return null;
  return { type: item.type, text: item.text };
}

function gameState(value: unknown): GameState | null {
  const item = record(value);
  if (!item) return null;
  if (item.phase !== "ACTION" && item.phase !== "DISCUSSION" && item.phase !== "VOTING" && item.phase !== "FINISHED") return null;
  const round = number(item.round);
  const playerSeat = number(item.playerSeat);
  const trueHealth = triple(item.trueHealth);
  const displayHealth = triple(item.displayHealth);
  const smugglerProgress = number(item.smugglerProgress);
  const protectedSeat = item.protectedSeat === null ? null : number(item.protectedSeat);
  const crew = Array.isArray(item.crew) ? item.crew.map(crewMember) : [];
  const intelItems = Array.isArray(item.intel) ? item.intel.map(intel) : [];
  const records = Array.isArray(item.records) ? item.records.map(roundRecord) : [];
  if (round === null || playerSeat === null || !trueHealth || !displayHealth || smugglerProgress === null || protectedSeat === null && item.protectedSeat !== null || typeof item.telemetrySpent !== "boolean") return null;
  if (crew.length !== 5 || crew.some((entry) => entry === null) || intelItems.some((entry) => entry === null) || records.some((entry) => entry === null)) return null;
  if (!Array.isArray(item.lastAnomaly) || !item.lastAnomaly.every((entry) => typeof entry === "boolean") || !Array.isArray(item.feed) || !item.feed.every((entry) => typeof entry === "string")) return null;
  if (item.saboteurTarget !== 0 && item.saboteurTarget !== 2) return null;
  if (item.winner !== null && item.winner !== "CREW" && item.winner !== "SABOTEUR") return null;
  return {
    phase: item.phase,
    round,
    crew: crew.filter((entry): entry is CrewMember => entry !== null),
    playerSeat,
    trueHealth,
    displayHealth,
    telemetrySpent: item.telemetrySpent,
    smugglerProgress,
    protectedSeat,
    lastAnomaly: item.lastAnomaly,
    intel: intelItems.filter((entry): entry is Intel => entry !== null),
    feed: item.feed,
    records: records.filter((entry): entry is RoundRecord => entry !== null),
    saboteurTarget: item.saboteurTarget,
    winner: item.winner,
  };
}

export function loadTrainingSession(): TrainingSession | null {
  const stored = readLocalValue(TRAINING_SESSION_KEY);
  if (!stored) return null;
  return parseTrainingSession(stored);
}

export function parseTrainingSession(stored: string): TrainingSession | null {
  try {
    const item = record(JSON.parse(stored));
    if (!item) return null;
    const game = gameState(item.game);
    const savedOrder = order(item.order);
    const selectedCrew = number(item.selectedCrew);
    const vote = number(item.vote);
    const entry = item.entry;
    if (!game || !savedOrder || selectedCrew === null || vote === null) return null;
    if (entry !== "MANIFEST" && entry !== "DOSSIER" && entry !== "BRIDGE") return null;
    return { game, order: savedOrder, selectedCrew, vote, entry };
  } catch {
    return null;
  }
}

export function saveTrainingSession(session: TrainingSession) {
  return writeLocalValue(TRAINING_SESSION_KEY, JSON.stringify(session));
}

export function clearTrainingSession() {
  return removeLocalValue(TRAINING_SESSION_KEY);
}
