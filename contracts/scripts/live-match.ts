import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { ethers } from "hardhat";
import { handleTypes, type HexString } from "@inco/lightning-js";
import { Lightning } from "@inco/lightning-js/lite";

const MUTINY_ADDRESS = "0x4A13c85BEC1B460f0DFCDD12074c55E034522eA0";
const INCO_EXECUTOR_ADDRESS = "0x4b9911b0191B0b6a6eA8F2Ed562e20Cff5AC8624";
const BASE_SEPOLIA_CHAIN_ID = 84532;
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

type Proof = {
  contract: string;
  network: string;
  player: string;
  matchId: string;
  startedAt: string;
  completedAt?: string;
  phase?: number;
  round?: number;
  transactions: Array<{ action: string; round?: number; hash: string; block: number }>;
  blackBox?: { roles: string[]; objectives: string[]; saboteurTarget: string; winner: string };
};

async function main() {
  const [signer] = await ethers.getSigners();
  const player = await signer.getAddress();
  const balance = await ethers.provider.getBalance(player);
  if (balance === 0n) throw new Error("Deployment wallet has no Base Sepolia ETH");

  const mutiny = await ethers.getContractAt("Mutiny", MUTINY_ADDRESS, signer);
  const lightning = await Lightning.at(
    {
      executorAddress: INCO_EXECUTOR_ADDRESS,
      chainId: BASE_SEPOLIA_CHAIN_ID,
    },
    { hostChainRpcUrls: [BASE_SEPOLIA_RPC_URL] },
  );
  const matchId = await mutiny.nextMatchId();
  const fee = await mutiny.incoFee();
  const proof: Proof = {
    contract: MUTINY_ADDRESS,
    network: "Base Sepolia",
    player,
    matchId: matchId.toString(),
    startedAt: new Date().toISOString(),
    transactions: [],
  };

  async function confirm(action: string, transaction: Promise<{ hash: string; wait(): Promise<null | { blockNumber: number }> }>, round?: number) {
    const pending = await transaction;
    console.log(`${action}${round ? ` R${round}` : ""}: ${pending.hash}`);
    const receipt = await pending.wait();
    if (!receipt) throw new Error(`${action} receipt unavailable`);
    proof.transactions.push({ action, round, hash: pending.hash, block: receipt.blockNumber });
  }

  async function encrypt(value: bigint) {
    return lightning.encrypt(value, {
      accountAddress: player,
      dappAddress: MUTINY_ADDRESS,
      handleType: handleTypes.euint256,
    });
  }

  await confirm("CREATE_MATCH", mutiny.createMatch());
  await confirm("READY", mutiny.setReady(matchId, true));
  await confirm("START_MATCH", mutiny.startMatch(matchId, { value: fee * 3n }));

  for (let round = 1; round <= 5; round++) {
    const order = await encrypt(21n);
    await confirm("SUBMIT_ORDER", mutiny.submitOrders(matchId, order, { value: fee }), round);
    await confirm("RESOLVE_ROUND", mutiny.resolveRound(matchId), round);
    await confirm("OPEN_VOTE", mutiny.openVote(matchId), round);
    const ballot = await encrypt(5n);
    await confirm("SUBMIT_BALLOT", mutiny.submitVote(matchId, ballot, { value: fee }), round);
    await confirm("RESOLVE_VOTE", mutiny.resolveVote(matchId), round);
  }

  const summary = await mutiny.matchSummary(matchId);
  proof.phase = Number(summary.phase);
  proof.round = Number(summary.round);
  proof.completedAt = new Date().toISOString();
  if (proof.phase !== 4) throw new Error(`Expected finished phase 4, received ${proof.phase}`);

  const identities = await mutiny.blackBoxIdentityHandles(matchId);
  const revealed = await lightning.attestedReveal([
    ...identities.roles,
    ...identities.objectives,
    identities.saboteurTarget,
    identities.winner,
  ] as HexString[]);
  const values = revealed.map((entry) => BigInt(entry.plaintext.value).toString());
  proof.blackBox = {
    roles: values.slice(0, 5),
    objectives: values.slice(5, 10),
    saboteurTarget: values[10],
    winner: values[11],
  };

  await writeFile("live-match-proof.json", `${JSON.stringify(proof, null, 2)}\n`, "utf8");
  console.log(`LIVE MATCH COMPLETE: ${matchId}`);
  console.log(`BLACK BOX WINNER CODE: ${proof.blackBox.winner}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
