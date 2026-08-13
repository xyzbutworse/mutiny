import "dotenv/config";
import { ethers } from "hardhat";
import { type HexString } from "@inco/lightning-js";
import { Lightning } from "@inco/lightning-js/lite";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const MUTINY_ADDRESS = "0x4A13c85BEC1B460f0DFCDD12074c55E034522eA0";
const INCO_EXECUTOR_ADDRESS = "0x4b9911b0191B0b6a6eA8F2Ed562e20Cff5AC8624";
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

function requirePrivateKey(value: string | undefined): asserts value is `0x${string}` {
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("PRIVATE_KEY must be a 32-byte hex value");
  }
}

function requireHandle(value: unknown): asserts value is HexString {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("Contract returned an invalid confidential handle");
  }
}

async function confirm(transaction: Promise<{ wait(): Promise<unknown> }>) {
  const pending = await transaction;
  await pending.wait();
}

async function main() {
  requirePrivateKey(process.env.PRIVATE_KEY);
  const account = privateKeyToAccount(process.env.PRIVATE_KEY);
  const [signer] = await ethers.getSigners();
  const signerAddress = await signer.getAddress();
  if (signerAddress.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("Hardhat signer and directive signer do not match");
  }

  const mutiny = await ethers.getContractAt("Mutiny", MUTINY_ADDRESS, signer);
  const lightning = await Lightning.at(
    { executorAddress: INCO_EXECUTOR_ADDRESS, chainId: baseSepolia.id },
    { hostChainRpcUrls: [BASE_SEPOLIA_RPC_URL] },
  );
  const wallet = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(BASE_SEPOLIA_RPC_URL),
  });

  const requestedMatchId = process.env.VERIFY_MATCH_ID;
  const matchId = requestedMatchId ? BigInt(requestedMatchId) : await mutiny.nextMatchId();
  if (!requestedMatchId) {
    const fee = await mutiny.incoFee();
    await confirm(mutiny.createMatch());
    await confirm(mutiny.setReady(matchId, true));
    await confirm(mutiny.startMatch(matchId, { value: fee * 3n }));
  }

  const handles = await mutiny.privateHandles(matchId, 0, 1);
  requireHandle(handles[0]);
  requireHandle(handles[1]);
  const directive = await lightning.attestedDecrypt(wallet, [handles[0], handles[1]]);
  if (directive.length !== 2) throw new Error("Directive response was incomplete");

  console.log(`DIRECTIVE DECRYPTED FOR MATCH ${matchId}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
