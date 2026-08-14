import { handleTypes, type HexString } from '@inco/lightning-js';
import { Lightning } from '@inco/lightning-js/lite';
import {
  createPublicClient,
  createWalletClient,
  custom,
  getAddress,
  http,
  isHex,
  numberToHex,
  type Address,
  type EIP1193Provider,
  type Hex,
} from 'viem';
import { baseSepolia } from 'viem/chains';

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

export function contractAddress(value: string | undefined): Address {
  if (!value) return ZERO_ADDRESS;
  try {
    return getAddress(value);
  } catch {
    throw new Error(
      'NEXT_PUBLIC_MUTINY_ADDRESS must be a 0x-prefixed 20-byte contract address.',
    );
  }
}

export const MUTINY_ADDRESS = contractAddress(
  process.env.NEXT_PUBLIC_MUTINY_ADDRESS,
);
export const BASE_SEPOLIA_RPC =
  process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
export const BASE_SEPOLIA = baseSepolia;
export const BASE_SEPOLIA_CHAIN_ID = baseSepolia.id;
export const MAX_RESOLUTION_GAS_LIMIT = 16_000_000n;
export const INCO_EXECUTOR_ADDRESS =
  '0x4b9911b0191B0b6a6eA8F2Ed562e20Cff5AC8624';

export const publicClient = createPublicClient({
  chain: BASE_SEPOLIA,
  transport: http(BASE_SEPOLIA_RPC),
});

type WalletEvent = 'accountsChanged' | 'chainChanged' | 'connect' | 'disconnect';

export type ConnectedProvider = EIP1193Provider & {
  on?: (event: WalletEvent, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: WalletEvent, listener: (...args: unknown[]) => void) => void;
};

function injectedProvider(): ConnectedProvider {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('NO_INJECTED_WALLET');
  }
  return window.ethereum;
}

export async function walletChainId(provider: EIP1193Provider = injectedProvider()) {
  const value = await provider.request({ method: 'eth_chainId' });
  if (typeof value !== 'string') throw new Error('Wallet returned an invalid network.');
  return Number.parseInt(value, 16);
}

export async function switchToBaseSepolia(provider: EIP1193Provider = injectedProvider()) {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${BASE_SEPOLIA_CHAIN_ID.toString(16)}` }],
    });
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? Number(error.code) : 0;
    if (code !== 4902) throw error;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: `0x${BASE_SEPOLIA_CHAIN_ID.toString(16)}`,
          chainName: 'Base Sepolia',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: [BASE_SEPOLIA_RPC],
          blockExplorerUrls: ['https://sepolia.basescan.org'],
        },
      ],
    });
  }
  return walletChainId(provider);
}

async function walletConnection(requestAccounts: boolean, boundProvider?: ConnectedProvider) {
  const provider = boundProvider ?? injectedProvider();
  const method = requestAccounts ? 'eth_requestAccounts' : 'eth_accounts';
  const result = await provider.request({ method });
  const accounts = Array.isArray(result) ? result : [];
  const account = accounts[0];
  if (typeof account !== 'string') {
    if (requestAccounts) throw new Error('No wallet account was selected.');
    return null;
  }
  const wallet = createWalletClient({
    chain: BASE_SEPOLIA,
    account: account as Address,
    transport: custom(provider),
  });
  return { wallet, account: account as Address, chainId: await walletChainId(provider), provider };
}

export function connectWallet() {
  return walletConnection(true).then((connection) => {
    if (!connection) throw new Error('No wallet account was selected.');
    return connection;
  });
}

export function restoreWallet(provider?: ConnectedProvider) {
  return walletConnection(false, provider);
}

export async function sendWalletTransaction(provider: EIP1193Provider, request: {
  account: Address;
  to: Address;
  data: Hex;
  value: bigint;
  gas?: bigint;
}) {
  const result = await provider.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from: request.account,
        to: request.to,
        data: request.data,
        value: numberToHex(request.value),
        ...(request.gas === undefined ? {} : { gas: numberToHex(request.gas) }),
      },
    ],
  });
  if (typeof result !== 'string' || !isHex(result) || result.length !== 66) {
    throw new Error('Wallet returned an invalid transaction hash.');
  }
  return result as Hex;
}

type WalletTransactionRequest = {
  account: Address;
  to: Address;
  data: Hex;
  value: bigint;
};

export function bufferedResolutionGas(estimate: bigint) {
  const buffered = (estimate * 108n + 99n) / 100n;
  if (buffered > MAX_RESOLUTION_GAS_LIMIT) {
    throw new Error('RESOLUTION_GAS_CAP_EXCEEDED');
  }
  return buffered;
}

export async function estimateResolutionGas(request: WalletTransactionRequest) {
  const estimate = await publicClient.estimateGas({
    account: request.account,
    to: request.to,
    data: request.data,
    value: request.value,
  });
  return bufferedResolutionGas(estimate);
}

export async function getZap() {
  return Lightning.at(
    {
      executorAddress: INCO_EXECUTOR_ADDRESS,
      chainId: BASE_SEPOLIA_CHAIN_ID,
    },
    { hostChainRpcUrls: [BASE_SEPOLIA_RPC] },
  );
}

export async function getIncoFee() {
  return publicClient.readContract({
    address: MUTINY_ADDRESS,
    abi: [
      {
        type: 'function',
        name: 'incoFee',
        stateMutability: 'pure',
        inputs: [],
        outputs: [{ type: 'uint256' }],
      },
    ] as const,
    functionName: 'incoFee',
  });
}

export async function encryptUint(value: bigint, account: Address) {
  const zap = await getZap();
  return zap.encrypt(value, {
    accountAddress: account,
    dappAddress: MUTINY_ADDRESS,
    handleType: handleTypes.euint256,
  });
}

export type ConnectedWallet = Awaited<
  ReturnType<typeof connectWallet>
>['wallet'];

export async function decryptPrivate(wallet: ConnectedWallet, handles: Hex[]) {
  const zap = await getZap();
  const nonZero = handles.filter(
    (h) => h && h !== (`0x${'0'.repeat(64)}` as Hex),
  );
  if (!nonZero.length) return [] as bigint[];
  const results = await zap.attestedDecrypt(
    wallet,
    nonZero as HexString[],
  );
  return results.map((r) => BigInt(r.plaintext.value));
}

export async function revealPublic(handles: Hex[]) {
  const zap = await getZap();
  const nonZero = handles.filter(
    (h) => h && h !== (`0x${'0'.repeat(64)}` as Hex),
  );
  if (!nonZero.length) return [] as bigint[];
  const results = await zap.attestedReveal(nonZero as HexString[]);
  return results.map((r) => BigInt(r.plaintext.value));
}

export const mutinyAbi = [
  {
    type: 'function',
    name: 'nextMatchId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'incoFee',
    stateMutability: 'pure',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'createMatch',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [{ name: 'matchId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'joinMatch',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setReady',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'ready', type: 'bool' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'startMatch',
    stateMutability: 'payable',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'submitOrders',
    stateMutability: 'payable',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'encryptedPayload', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'resolveRound',
    stateMutability: 'payable',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'sendComms',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'message', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'openVote',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'submitVote',
    stateMutability: 'payable',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'encryptedVote', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'resolveVote',
    stateMutability: 'payable',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'seatOf',
    stateMutability: 'view',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'player', type: 'address' },
    ],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'readyState',
    stateMutability: 'view',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: [{ type: 'bool[5]' }],
  },
  {
    type: 'function',
    name: 'matchCreatedBlock',
    stateMutability: 'view',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'actionSubmitted',
    stateMutability: 'view',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'round', type: 'uint8' },
      { name: 'seat', type: 'uint8' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'voteSubmitted',
    stateMutability: 'view',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'round', type: 'uint8' },
      { name: 'seat', type: 'uint8' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'canResolveRound',
    stateMutability: 'view',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'canResolveVote',
    stateMutability: 'view',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'matchSummary',
    stateMutability: 'view',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: [
      { name: 'host', type: 'address' },
      { name: 'phase', type: 'uint8' },
      { name: 'round', type: 'uint8' },
      { name: 'humanCount', type: 'uint8' },
      { name: 'botCount', type: 'uint8' },
      { name: 'actionDeadline', type: 'uint64' },
      { name: 'discussionDeadline', type: 'uint64' },
      { name: 'voteDeadline', type: 'uint64' },
      { name: 'players', type: 'address[5]' },
      { name: 'bots', type: 'bool[5]' },
    ],
  },
  {
    type: 'function',
    name: 'privateHandles',
    stateMutability: 'view',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'seat', type: 'uint8' },
      { name: 'round', type: 'uint8' },
    ],
    outputs: [
      { name: 'roleHandle', type: 'bytes32' },
      { name: 'objectiveHandle', type: 'bytes32' },
      { name: 'clueHandle', type: 'bytes32' },
      { name: 'auditHandle', type: 'bytes32' },
    ],
  },
  {
    type: 'function',
    name: 'publicRoundHandles',
    stateMutability: 'view',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'round', type: 'uint8' },
    ],
    outputs: [
      { name: 'displayedHealth', type: 'bytes32[3]' },
      { name: 'claimedTotals', type: 'bytes32[3]' },
      { name: 'ejectedSeat', type: 'bytes32' },
    ],
  },
  {
    type: 'function',
    name: 'blackBoxIdentityHandles',
    stateMutability: 'view',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: [
      { name: 'roles', type: 'bytes32[5]' },
      { name: 'objectives', type: 'bytes32[5]' },
      { name: 'saboteurTarget', type: 'bytes32' },
      { name: 'winner', type: 'bytes32' },
    ],
  },
  {
    type: 'function',
    name: 'blackBoxRoundHandles',
    stateMutability: 'view',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'round', type: 'uint8' },
    ],
    outputs: [
      { name: 'actions', type: 'bytes32[5]' },
      { name: 'votes', type: 'bytes32[5]' },
      { name: 'trueHealth', type: 'bytes32[3]' },
      { name: 'displayedHealth', type: 'bytes32[3]' },
      { name: 'claimedTotals', type: 'bytes32[3]' },
      { name: 'sabotage', type: 'bytes32[3]' },
      { name: 'telemetry', type: 'bytes32[3]' },
      { name: 'anomalies', type: 'bytes32[5]' },
      { name: 'investigationClues', type: 'bytes32[5]' },
      { name: 'auditResults', type: 'bytes32[5]' },
      { name: 'ejectedSeat', type: 'bytes32' },
    ],
  },
  {
    type: 'event',
    name: 'MatchCreated',
    anonymous: false,
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'host', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'SeatJoined',
    anonymous: false,
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'seat', type: 'uint8', indexed: true },
      { name: 'player', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'SeatReady',
    anonymous: false,
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'seat', type: 'uint8', indexed: true },
      { name: 'player', type: 'address', indexed: true },
      { name: 'ready', type: 'bool', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'MatchStarted',
    anonymous: false,
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'humanCount', type: 'uint8', indexed: false },
      { name: 'botCount', type: 'uint8', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'RoundResolved',
    anonymous: false,
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'round', type: 'uint8', indexed: true },
      { name: 'reactorDisplay', type: 'bytes32', indexed: false },
      { name: 'lifeDisplay', type: 'bytes32', indexed: false },
      { name: 'navDisplay', type: 'bytes32', indexed: false },
      { name: 'reactorClaimed', type: 'bytes32', indexed: false },
      { name: 'lifeClaimed', type: 'bytes32', indexed: false },
      { name: 'navClaimed', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'VoteResolved',
    anonymous: false,
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'round', type: 'uint8', indexed: true },
      { name: 'ejectedSeatHandle', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'MatchFinished',
    anonymous: false,
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'winnerHandle', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Comms',
    anonymous: false,
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'round', type: 'uint8', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
      { name: 'message', type: 'string', indexed: false },
    ],
  },
] as const;
