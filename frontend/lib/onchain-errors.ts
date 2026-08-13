function errorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) return 0;
  const code = error.code;
  if (typeof code === "number") return code;
  if (typeof code === "string") return Number(code);
  return 0;
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

export function operationErrorMessage(error: unknown) {
  const code = errorCode(error);
  const message = errorText(error);
  if (code === 4001 || /rejected|denied|user cancelled/i.test(message)) {
    return "Wallet hatch closed. No order left the bridge.";
  }
  if (/insufficient funds|exceeds balance|insufficient base sepolia eth/i.test(message)) {
    return "Fuel reserve empty. Add Base Sepolia test ETH, then retry the transmission.";
  }
  if (/NO_INJECTED_WALLET|install or open an ethereum wallet/i.test(message)) {
    return "No wallet detected. Open MUTINY in MetaMask, Coinbase Wallet, or a browser with a wallet extension.";
  }
  if (/wallet disconnected|no wallet account|no account/i.test(message)) {
    return "Crew identity lost. Reconnect the same wallet to resume this operation.";
  }
  if (/wrong network|wallet returned an invalid network|chain mismatch/i.test(message)) {
    return "Wrong signal band. Tune the wallet to Base Sepolia before issuing orders.";
  }
  if (/CREW_NOT_READY/i.test(message)) return "Launch lock active. Every human seat must mark ready.";
  if (/ALREADY_SEATED/i.test(message)) return "This crew identity already occupies a seat.";
  if (/MATCH_FULL/i.test(message)) return "Manifest sealed. All five human seats are occupied.";
  if (/MATCH_NOT_FOUND/i.test(message)) return "No operation answers this code. Check the invitation and retry.";
  if (/ALREADY_SUBMITTED/i.test(message)) return "Duplicate rejected. Your first sealed decision stays authoritative.";
  if (/ORDERS_PENDING/i.test(message)) return "Order lock active. Await the remaining crew or the crisis clock.";
  if (/VOTES_PENDING/i.test(message)) return "Ballot lock active. Await the remaining votes or the voting clock.";
  if (/DISCUSSION_ACTIVE/i.test(message)) return "COMMS remains open. The Captain or crisis clock opens the ballot.";
  if (/MESSAGE_LENGTH/i.test(message)) return "Transmission rejected. COMMS accepts 1 to 180 characters.";
  if (/NOT_CREW|PRIVATE_HANDLE/i.test(message)) return "Clearance denied. This wallet does not own the requested sealed record.";
  if (/BAD_PHASE|LOBBY_CLOSED|COMMS_CLOSED/i.test(message)) {
    return "Bridge state changed before the command arrived. Synchronize before trying again.";
  }
  if (/BLACK_BOX_LOCKED/i.test(message)) return "BLACK BOX remains classified until the operation ends.";
  if (/role unavailable|unknown role|attesteddecrypt|decrypt|decryption/i.test(message)) {
    return "Eyes-only channel failed to decrypt. Your sealed data remains intact. Retry the private link.";
  }
  if (/attestedreveal|reveal|covalidator|attestation/i.test(message)) {
    return "Inco attestation is still settling. Flight data remains sealed. Retry recovery shortly.";
  }
  if (/timeout|timed out|confirmation delayed/i.test(message)) {
    return "Transmission entered Base Sepolia, but confirmation is delayed. Check its status before sending again.";
  }
  if (/failed to fetch|fetch failed|rpc|network request|http request|socket|503|429/i.test(message)) {
    return "Base Sepolia relay is silent. Existing bridge data is preserved. Retry synchronization.";
  }
  if (/transaction reverted|execution reverted/i.test(message)) {
    return "Base Sepolia rejected the command. Synchronize the bridge before issuing a replacement.";
  }
  return "Command lost before confirmation. Bridge state is preserved. Synchronize, then retry.";
}
