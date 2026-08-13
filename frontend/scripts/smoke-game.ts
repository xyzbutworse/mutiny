import {
  openVoting,
  packOrder,
  resolveOrders,
  resolveVoting,
  startSimulation,
  unpackOrder,
  type Order,
} from "../lib/game";
import { operationErrorMessage } from "../lib/onchain-errors";
import { parseTrainingSession } from "../lib/training-session";
import { BASE_SEPOLIA_CHAIN_ID, connectWallet, sendWalletTransaction, switchToBaseSepolia } from "../lib/chain";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const observedRoles = new Set<string>();

for (let match = 0; match < 50; match++) {
  let state = startSimulation();
  const saboteurs = state.crew.filter((member) => member.role === "SABOTEUR");
  assert(saboteurs.length === 1, `match ${match}: expected exactly one Saboteur`);
  state.crew.forEach((member) => observedRoles.add(member.role));

  while (state.phase !== "FINISHED") {
    if (state.phase === "ACTION") {
      const order: Order = { allocations: [1, 1, 1], sideAction: "NONE", target: 0 };
      state = resolveOrders(state, order);
    } else if (state.phase === "DISCUSSION") {
      state = openVoting(state);
    } else if (state.phase === "VOTING") {
      state = resolveVoting(state, 5);
    }
  }

  assert(state.records.length === 5, `match ${match}: BLACK BOX did not contain five rounds`);
  assert(state.winner === "CREW" || state.winner === "SABOTEUR", `match ${match}: invalid winner`);
}

for (let i = 0; i < 500; i++) {
  const allocations: [number, number, number] = [0, 0, 0];
  let remaining = 3;
  for (let system = 0; system < 3; system++) {
    const value = Math.floor(Math.random() * (remaining + 1));
    allocations[system] = value;
    remaining -= value;
  }
  const sideAction = remaining > 0 && Math.random() > 0.5 ? (Math.random() > 0.5 ? "INVESTIGATE" : "SPECIAL") : "NONE";
  const order: Order = { allocations, sideAction, target: Math.floor(Math.random() * 8) };
  const decoded = unpackOrder(packOrder(order));
  assert(JSON.stringify(decoded) === JSON.stringify(order), `codec mismatch: ${JSON.stringify(order)} -> ${JSON.stringify(decoded)}`);
}

const expectedRoles = ["CAPTAIN", "ENGINEER", "MEDIC", "SMUGGLER", "QUARTERMASTER", "SABOTEUR"];
for (const role of expectedRoles) assert(observedRoles.has(role), `role never observed in smoke run: ${role}`);

let ejectedPlayerState = startSimulation();
ejectedPlayerState.crew[ejectedPlayerState.playerSeat].active = false;
ejectedPlayerState = resolveOrders(ejectedPlayerState, { allocations: [2, 0, 0], sideAction: "SPECIAL", target: 0 });
const ejectedRound = ejectedPlayerState.records[0];
assert(!ejectedRound.actors.some((actor) => actor.seat === ejectedPlayerState.playerSeat), "ejected player submitted an energy order");
ejectedPlayerState = openVoting(ejectedPlayerState);
ejectedPlayerState = resolveVoting(ejectedPlayerState, 2);
assert(ejectedPlayerState.records[0].votes?.[ejectedPlayerState.playerSeat] === 5, "ejected player cast an ejection ballot");

const errorCases: Array<[unknown, string]> = [
  [{ code: 4001 }, "Wallet hatch closed"],
  [new Error("insufficient funds"), "Fuel reserve empty"],
  [{ shortMessage: "Transaction failed", cause: { details: "insufficient funds for gas * price + value" } }, "Fuel reserve empty"],
  [new Error("NO_INJECTED_WALLET"), "No wallet detected"],
  [new Error("Wallet disconnected"), "Crew identity lost"],
  [{ message: "TransactionExecutionError", cause: { code: 4902, shortMessage: "Chain mismatch" } }, "Wrong signal band"],
  [new Error("Wrong network"), "Wrong signal band"],
  [new Error("MATCH_FULL"), "Manifest sealed"],
  [new Error("ALREADY_SUBMITTED"), "Duplicate rejected"],
  [new Error("execution reverted: BAD_PHASE"), "Bridge state changed"],
  [new Error("attestedDecrypt failed"), "Eyes-only channel failed"],
  [new Error("attestedReveal failed"), "Inco attestation is still settling"],
  [new Error("Confirmation delayed"), "Transmission entered Base Sepolia"],
  [new Error("RPC failed to fetch"), "Base Sepolia relay is silent"],
];
for (const [error, expected] of errorCases) {
  assert(operationErrorMessage(error).includes(expected), `wrong recovery copy for ${String(error)}`);
}
assert(/relay code [0-9A-F]{8}/.test(operationErrorMessage(new Error("unclassified provider failure"))), "unknown wallet failure has no diagnostic code");
assert(operationErrorMessage(new Error("WALLET_SUBMISSION_FAILED")).includes("wallet failed"), "wallet submission failure lost its stage");

const resumable = startSimulation();
const savedSession = JSON.stringify({
  game: resumable,
  entry: "BRIDGE",
  order: { allocations: [1, 1, 1], sideAction: "NONE", target: 0 },
  selectedCrew: 3,
  vote: 5,
});
const restored = parseTrainingSession(savedSession);
assert(restored?.game.round === 1 && restored.selectedCrew === 3, "training session did not survive serialization");
assert(parseTrainingSession("{corrupt") === null, "corrupt training session was accepted");
assert(parseTrainingSession(JSON.stringify({ ...JSON.parse(savedSession), game: { phase: "ACTION" } })) === null, "partial training state was accepted");

async function verifyWalletRecovery() {
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    ethereum: {
      request: async ({ method }: { method: string }) => {
        if (method === "eth_requestAccounts") throw Object.assign(new Error("User rejected request"), { code: 4001 });
        if (method === "eth_chainId") return "0x1";
        return null;
      },
    },
  },
});
let rejected = false;
try {
  await connectWallet();
} catch (error) {
  rejected = operationErrorMessage(error).includes("Wallet hatch closed");
}
assert(rejected, "wallet rejection did not reach the fiction-native recovery state");

let activeChain = 1;
const walletRequests: string[] = [];
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    ethereum: {
      request: async ({ method }: { method: string }) => {
        walletRequests.push(method);
        if (method === "eth_requestAccounts" || method === "eth_accounts") return ["0x0000000000000000000000000000000000000001"];
        if (method === "wallet_switchEthereumChain") {
          activeChain = BASE_SEPOLIA_CHAIN_ID;
          return null;
        }
        if (method === "eth_chainId") return `0x${activeChain.toString(16)}`;
        if (method === "eth_sendTransaction") return `0x${"1".repeat(64)}`;
        return null;
      },
    },
  },
});
const wrongNetwork = await connectWallet();
assert(wrongNetwork.chainId === 1, "wrong-chain wallet state was not detected");
assert(await switchToBaseSepolia(wrongNetwork.provider) === BASE_SEPOLIA_CHAIN_ID, "Base Sepolia switch did not complete");
assert(walletRequests.includes("wallet_switchEthereumChain"), "wallet network switch was not requested");
let decoyProviderUsed = false;
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    ethereum: {
      request: async () => {
        decoyProviderUsed = true;
        throw new Error("wrong provider selected");
      },
    },
  },
});
const hash = await sendWalletTransaction(wrongNetwork.provider, {
  account: wrongNetwork.account,
  to: wrongNetwork.account,
  data: "0x",
  value: 0n,
});
assert(hash === `0x${"1".repeat(64)}`, "bound provider did not return its transaction hash");
assert(walletRequests.includes("eth_sendTransaction"), "bound provider did not receive the transaction");
assert(!decoyProviderUsed, "transaction leaked to a different injected wallet provider");
Object.defineProperty(globalThis, "window", { configurable: true, value: undefined });
}

void verifyWalletRecovery().then(() => {
  console.log("MUTINY smoke: 50/50 matches, 500/500 codecs, 11/11 failure states, wallet rejection, chain switching, provider binding, and refresh recovery valid.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
