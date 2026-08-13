export const SYSTEM_NAMES = ["REACTOR", "LIFE SUPPORT", "NAVIGATION"] as const;
export type SystemName = (typeof SYSTEM_NAMES)[number];

export const ROLE_NAMES = [
  "CAPTAIN",
  "ENGINEER",
  "MEDIC",
  "SMUGGLER",
  "QUARTERMASTER",
  "SABOTEUR",
] as const;
export type Role = (typeof ROLE_NAMES)[number];

export type Phase = "ACTION" | "DISCUSSION" | "VOTING" | "FINISHED";
export type SideAction = "NONE" | "INVESTIGATE" | "SPECIAL";

export type Order = {
  allocations: [number, number, number];
  sideAction: SideAction;
  target: number;
};

export type CrewMember = {
  seat: number;
  callsign: string;
  role: Role;
  objective: string;
  active: boolean;
  suspicion: number;
};

export type ActorRecord = {
  seat: number;
  callsign: string;
  role: Role;
  claimed: [number, number, number];
  actual: [number, number, number];
  sideAction: SideAction;
  target: number;
  anomalous: boolean;
};

export type RoundRecord = {
  round: number;
  before: [number, number, number];
  trueAfter: [number, number, number];
  displayedAfter: [number, number, number];
  claimedTotals: [number, number, number];
  sabotageTotals: [number, number, number];
  telemetrySystem: number | null;
  actors: ActorRecord[];
  votes?: number[];
  ejected?: number | null;
};

export type Intel = {
  type: "INVESTIGATION" | "AUDIT" | "SYSTEM";
  text: string;
};

export type GameState = {
  phase: Phase;
  round: number;
  crew: CrewMember[];
  playerSeat: number;
  trueHealth: [number, number, number];
  displayHealth: [number, number, number];
  telemetrySpent: boolean;
  smugglerProgress: number;
  protectedSeat: number | null;
  lastAnomaly: boolean[];
  intel: Intel[];
  feed: string[];
  records: RoundRecord[];
  saboteurTarget: 0 | 2;
  winner: "CREW" | "SABOTEUR" | null;
};

const CALLSIGNS = ["VOSS", "IRIS", "KLINE", "ROOK", "MERCER"];
const DECAY: [number, number, number] = [8, 7, 6];

const OBJECTIVES: Record<Role, string> = {
  CAPTAIN: "Keep the ship alive and preserve command integrity.",
  ENGINEER: "Keep Reactor integrity above 40% at extraction.",
  MEDIC: "Keep as many crew alive as possible.",
  SMUGGLER: "Extract contraband twice without exposing your motive.",
  QUARTERMASTER: "Keep all three systems supplied through extraction.",
  SABOTEUR: "Drive your assigned target to critical condition before extraction.",
};

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

export function startSimulation(): GameState {
  const baseRoles: Role[] = ["CAPTAIN", "ENGINEER", "MEDIC", "SMUGGLER", "QUARTERMASTER"];
  const rotation = Math.floor(Math.random() * 5);
  const saboteurSeat = Math.floor(Math.random() * 5);
  const roles = baseRoles.map((_, seat) => (seat === saboteurSeat ? "SABOTEUR" : baseRoles[(seat + rotation) % 5]));
  const crew = roles.map((role, seat) => ({
    seat,
    callsign: CALLSIGNS[seat],
    role,
    objective: OBJECTIVES[role],
    active: true,
    suspicion: 0,
  }));
  const saboteurTarget = (Math.random() < 0.5 ? 0 : 2) as 0 | 2;
  const player = crew[0];
  const targetText = saboteurTarget === 0 ? "REACTOR" : "NAVIGATION";

  return {
    phase: "ACTION",
    round: 1,
    crew,
    playerSeat: 0,
    trueHealth: [55, 55, 55],
    displayHealth: [55, 55, 55],
    telemetrySpent: false,
    smugglerProgress: 0,
    protectedSeat: null,
    lastAnomaly: [false, false, false, false, false],
    intel: [
      {
        type: "SYSTEM",
        text:
          player.role === "SABOTEUR"
            ? `EYES ONLY — sabotage directive: ${targetText}. Bring it to 10% or below.`
            : `EYES ONLY — ${player.role}. ${player.objective}`,
      },
    ],
    feed: [
      "BLACKWATER-7 lost long-range comms.",
      "Five crew remain conscious.",
      "One sealed directive is hostile.",
    ],
    records: [],
    saboteurTarget,
    winner: null,
  };
}

export function energyUsed(order: Order) {
  return order.allocations.reduce((a, b) => a + b, 0) + (order.sideAction === "NONE" ? 0 : 1);
}

export function validOrder(order: Order) {
  return (
    order.allocations.every((v) => Number.isInteger(v) && v >= 0 && v <= 3) &&
    energyUsed(order) <= 3 &&
    order.target >= 0 &&
    order.target <= 7
  );
}

function lowestSystem(health: [number, number, number]) {
  let idx = 0;
  for (let i = 1; i < 3; i++) if (health[i] < health[idx]) idx = i;
  return idx;
}

function botOrder(state: GameState, member: CrewMember): Order {
  if (!member.active) return { allocations: [0, 0, 0], sideAction: "NONE", target: 0 };

  const low = lowestSystem(state.displayHealth);
  const alloc: [number, number, number] = [0, 0, 0];

  if (member.role === "SABOTEUR") {
    const target = state.saboteurTarget;
    if (!state.telemetrySpent && state.round >= 2 && Math.random() < 0.4) {
      alloc[target] = 2;
      return { allocations: alloc, sideAction: "SPECIAL", target };
    }
    alloc[target] = 3;
    return { allocations: alloc, sideAction: "NONE", target };
  }

  if (member.role === "SMUGGLER" && (state.round === 2 || state.round === 4)) {
    alloc[low] = 2;
    return { allocations: alloc, sideAction: "SPECIAL", target: 0 };
  }

  if (member.role === "ENGINEER" && state.displayHealth[0] < 45 && Math.random() < 0.65) {
    alloc[0] = 2;
    return { allocations: alloc, sideAction: "SPECIAL", target: 0 };
  }

  if (member.role === "MEDIC" && state.round >= 3 && Math.random() < 0.3) {
    alloc[low] = 2;
    const target = state.crew
      .filter((c) => c.active && c.seat !== member.seat)
      .sort((a, b) => a.suspicion - b.suspicion)[0]?.seat ?? 0;
    return { allocations: alloc, sideAction: "SPECIAL", target };
  }

  if (member.role === "CAPTAIN" && state.round >= 2 && Math.random() < 0.25) {
    alloc[low] = 2;
    return { allocations: alloc, sideAction: "SPECIAL", target: low };
  }

  alloc[low] = 2;
  alloc[(low + 1) % 3] = 1;
  return { allocations: alloc, sideAction: "NONE", target: low };
}

function roleSpecial(
  state: GameState,
  member: CrewMember,
  order: Order,
  engineerBonus: number[],
  quarterBonus: number[],
  telemetry: { system: number | null },
  intel: Intel[],
) {
  if (order.sideAction !== "SPECIAL") return;
  const targetSystem = Math.max(0, Math.min(2, order.target));

  switch (member.role) {
    case "ENGINEER":
      engineerBonus[targetSystem] += 2;
      break;
    case "QUARTERMASTER":
      quarterBonus[0] += 1;
      quarterBonus[1] += 1;
      quarterBonus[2] += 1;
      break;
    case "MEDIC":
      state.protectedSeat = Math.max(0, Math.min(4, order.target));
      break;
    case "SMUGGLER":
      state.smugglerProgress += 1;
      break;
    case "SABOTEUR":
      if (!state.telemetrySpent) {
        state.telemetrySpent = true;
        telemetry.system = targetSystem;
      }
      break;
    case "CAPTAIN":
      if (member.seat === state.playerSeat) {
        intel.push({
          type: "AUDIT",
          text: `COMMAND AUDIT — ${SYSTEM_NAMES[targetSystem]} true integrity was ${state.trueHealth[targetSystem]}% before this resolution.`,
        });
      }
      break;
  }
}

export function resolveOrders(stateInput: GameState, playerOrder: Order): GameState {
  if (stateInput.phase !== "ACTION") return stateInput;
  if (!validOrder(playerOrder)) throw new Error("SEALED ORDER EXCEEDS 3 ENERGY");

  const state: GameState = structuredClone(stateInput);
  const before = [...state.trueHealth] as [number, number, number];
  const orders: Order[] = state.crew.map((member) =>
    member.seat === state.playerSeat
      ? member.active
        ? playerOrder
        : { allocations: [0, 0, 0], sideAction: "NONE", target: 0 }
      : botOrder(state, member),
  );

  const claimed = [0, 0, 0];
  const good = [0, 0, 0];
  const bad = [0, 0, 0];
  const engineerBonus = [0, 0, 0];
  const quarterBonus = [0, 0, 0];
  const anomalies = [false, false, false, false, false];
  const telemetry = { system: null as number | null };
  const intel: Intel[] = [];
  const actors: ActorRecord[] = [];

  state.protectedSeat = null;

  state.crew.forEach((member, seat) => {
    const order = orders[seat];
    if (!member.active) return;

    for (let s = 0; s < 3; s++) {
      claimed[s] += order.allocations[s];
      if (member.role === "SABOTEUR") bad[s] += order.allocations[s];
      else good[s] += order.allocations[s];
    }

    const allocated = order.allocations.reduce((a, b) => a + b, 0);
    anomalies[seat] =
      (member.role === "SABOTEUR" && allocated > 0) ||
      (member.role === "SMUGGLER" && order.sideAction === "SPECIAL");

    if (order.sideAction === "INVESTIGATE" && seat === state.playerSeat) {
      const target = Math.max(0, Math.min(4, order.target));
      intel.push({
        type: "INVESTIGATION",
        text: state.lastAnomaly[target]
          ? `FORENSICS — ${state.crew[target].callsign} produced anomalous telemetry last round. This does not identify motive.`
          : `FORENSICS — no anomalous activity from ${state.crew[target].callsign} last round. This is not an innocence result.`,
      });
    }

    roleSpecial(state, member, order, engineerBonus, quarterBonus, telemetry, intel);

    actors.push({
      seat,
      callsign: member.callsign,
      role: member.role,
      claimed: [...order.allocations] as [number, number, number],
      actual: order.allocations.map((v) => (member.role === "SABOTEUR" ? -v : v)) as [number, number, number],
      sideAction: order.sideAction,
      target: order.target,
      anomalous: anomalies[seat],
    });
  });

  const next: [number, number, number] = [0, 0, 0];
  for (let s = 0; s < 3; s++) {
    next[s] = clamp(before[s] - DECAY[s] + good[s] + engineerBonus[s] + quarterBonus[s] - bad[s]);
  }

  const displayed = [...next] as [number, number, number];
  if (telemetry.system !== null) displayed[telemetry.system] = clamp(displayed[telemetry.system] + 20);

  if (state.crew[state.playerSeat].role === "CAPTAIN" && playerOrder.sideAction === "SPECIAL") {
    const target = Math.max(0, Math.min(2, playerOrder.target));
    intel.push({
      type: "AUDIT",
      text: `COMMAND AUDIT — ${SYSTEM_NAMES[target]} true integrity after resolution: ${next[target]}%.`,
    });
  }

  state.trueHealth = next;
  state.displayHealth = displayed;
  state.lastAnomaly = anomalies;
  state.intel = [...intel, ...state.intel].slice(0, 6);

  // Public outcomes shift suspicion, but do not expose individual allocations.
  const damage = next.reduce((sum, value, s) => sum + Math.max(0, before[s] - value), 0);
  state.crew.forEach((member) => {
    if (!member.active) return;
    const noise = Math.floor(Math.random() * 9) - 3;
    member.suspicion = clamp(member.suspicion + Math.max(0, damage - 10) + noise, 0, 100);
  });

  state.records.push({
    round: state.round,
    before,
    trueAfter: next,
    displayedAfter: displayed,
    claimedTotals: claimed as [number, number, number],
    sabotageTotals: bad as [number, number, number],
    telemetrySystem: telemetry.system,
    actors,
  });

  const delta = displayed.map((v, s) => v - before[s]);
  state.feed = [
    `ROUND ${state.round} RESOLVED — sealed orders accepted.`,
    `${SYSTEM_NAMES[0]} ${delta[0] >= 0 ? "+" : ""}${delta[0]} → ${displayed[0]}%.`,
    `${SYSTEM_NAMES[1]} ${delta[1] >= 0 ? "+" : ""}${delta[1]} → ${displayed[1]}%.`,
    `${SYSTEM_NAMES[2]} ${delta[2] >= 0 ? "+" : ""}${delta[2]} → ${displayed[2]}%.`,
    "Individual contributions remain classified.",
    ...state.feed,
  ].slice(0, 12);
  state.phase = "DISCUSSION";
  return state;
}

export function openVoting(stateInput: GameState): GameState {
  if (stateInput.phase !== "DISCUSSION") return stateInput;
  const state = structuredClone(stateInput);
  state.phase = "VOTING";
  state.feed = [`VOTE ${state.round} OPEN — ballots are sealed.`, ...state.feed].slice(0, 12);
  return state;
}

function botVote(state: GameState, voter: CrewMember): number {
  if (!voter.active) return 5;
  const candidates = state.crew.filter((c) => c.active && c.seat !== voter.seat);
  if (!candidates.length || Math.random() < 0.22) return 5;

  if (voter.role === "SABOTEUR") {
    const loyal = candidates.filter((c) => c.role !== "SABOTEUR");
    return loyal.sort((a, b) => b.suspicion - a.suspicion)[0]?.seat ?? 5;
  }

  const weighted = candidates
    .map((c) => ({ seat: c.seat, score: c.suspicion + Math.random() * 35 + (c.role === "SABOTEUR" ? 7 : 0) }))
    .sort((a, b) => b.score - a.score);
  return weighted[0]?.seat ?? 5;
}

function finishGame(state: GameState) {
  const targetCritical = state.trueHealth[state.saboteurTarget] <= 10;
  const anyDead = state.trueHealth.some((v) => v <= 0);
  state.winner = targetCritical || anyDead ? "SABOTEUR" : "CREW";
  state.phase = "FINISHED";
  state.feed = [
    "BLACK BOX ACCESS GRANTED.",
    `${state.winner} VICTORY — classified operation decryption complete.`,
    ...state.feed,
  ].slice(0, 12);
}

export function resolveVoting(stateInput: GameState, playerVote: number): GameState {
  if (stateInput.phase !== "VOTING") return stateInput;
  const state = structuredClone(stateInput);
  const votes = state.crew.map((member) => {
    if (!member.active) return 5;
    if (member.seat === state.playerSeat) return Math.max(0, Math.min(5, playerVote));
    return botVote(state, member);
  });

  const counts = [0, 0, 0, 0, 0, 0];
  votes.forEach((vote, voter) => {
    if (state.crew[voter].active) counts[vote] += 1;
  });

  let best = 5;
  for (let i = 0; i < 5; i++) {
    if (counts[i] > counts[best]) best = i;
  }

  let ejected: number | null = null;
  if (best < 5 && counts[best] >= 3) {
    if (state.protectedSeat === best) {
      state.feed = [
        `VOTE SEALED — ${counts[best]} ballots targeted ${state.crew[best].callsign}. Medical lockout prevented ejection.`,
        ...state.feed,
      ].slice(0, 12);
    } else {
      state.crew[best].active = false;
      ejected = best;
      state.feed = [
        `EJECTION CONFIRMED — ${state.crew[best].callsign} removed with ${counts[best]} sealed votes.`,
        ...state.feed,
      ].slice(0, 12);
    }
  } else {
    state.feed = ["NO MAJORITY — no crew member ejected.", ...state.feed].slice(0, 12);
  }

  const rec = state.records[state.records.length - 1];
  if (rec) {
    rec.votes = votes;
    rec.ejected = ejected;
  }

  if (state.round >= 5) {
    finishGame(state);
  } else {
    state.round += 1;
    state.phase = "ACTION";
    state.protectedSeat = null;
    state.feed = [`ROUND ${state.round} — crisis clock resumed.`, ...state.feed].slice(0, 12);
  }
  return state;
}

export function roleBrief(role: Role, saboteurTarget: 0 | 2) {
  if (role === "SABOTEUR") {
    return {
      title: "HOSTILE DIRECTIVE",
      objective: `Bring ${SYSTEM_NAMES[saboteurTarget]} to 10% or lower by extraction. Your apparent allocations damage the canonical system state.`,
      special: "CORRUPT TELEMETRY — once per match, make one system publicly report +20 integrity for a round.",
    };
  }
  const special: Record<Exclude<Role, "SABOTEUR">, string> = {
    CAPTAIN: "AUDIT — privately read one system's true integrity.",
    ENGINEER: "OVERCLOCK — add +2 real integrity to one system.",
    MEDIC: "AIRLOCK SHIELD — protect one seat. You still vote.",
    SMUGGLER: "EXTRACT — progress your private contraband objective.",
    QUARTERMASTER: "SURGE — add +1 real integrity to every system.",
  };
  return { title: role, objective: OBJECTIVES[role], special: special[role] };
}

export function packOrder(order: Order): bigint {
  const action = order.sideAction === "NONE" ? 0 : order.sideAction === "INVESTIGATE" ? 1 : 2;
  return BigInt(
    order.allocations[0] +
      order.allocations[1] * 4 +
      order.allocations[2] * 16 +
      action * 64 +
      order.target * 256,
  );
}

export function unpackOrder(value: bigint): Order {
  const n = Number(value);
  const actionCode = Math.floor(n / 64) % 4;
  return {
    allocations: [n % 4, Math.floor(n / 4) % 4, Math.floor(n / 16) % 4],
    sideAction: actionCode === 1 ? "INVESTIGATE" : actionCode === 2 ? "SPECIAL" : "NONE",
    target: Math.floor(n / 256) % 8,
  };
}
