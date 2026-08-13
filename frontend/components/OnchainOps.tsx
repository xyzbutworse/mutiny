'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { encodeFunctionData, parseEventLogs, type Address, type Hex, type TransactionReceipt } from 'viem';
import { BlackwaterShip } from '@/components/BlackwaterShip';
import { BlackBoxArchive, type ArchiveActor, type ArchivePlayer, type ArchiveTriple, type BlackBoxEvidence } from '@/components/BlackBoxArchive';
import { FirstOperationBriefing } from '@/components/FirstOperationBriefing';
import { useGameAudio } from '@/components/GameAudio';
import {
  BASE_SEPOLIA_CHAIN_ID,
  MUTINY_ADDRESS,
  connectWallet,
  decryptPrivate,
  encryptUint,
  getIncoFee,
  mutinyAbi,
  publicClient,
  restoreWallet,
  revealPublic,
  switchToBaseSepolia,
  type ConnectedWallet,
} from '@/lib/chain';
import {
  packOrder,
  roleBrief,
  SYSTEM_NAMES,
  unpackOrder,
  type Order,
  type Role,
  type SideAction,
} from '@/lib/game';
import { operationErrorMessage } from '@/lib/onchain-errors';
import { readLocalValue, removeLocalValue, writeLocalValue } from '@/lib/storage';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const PHASE = ['LOBBY', 'ACTION', 'DISCUSSION', 'VOTING', 'FINISHED'] as const;
const ROLE_BY_CODE: Record<number, Role> = {
  1: 'CAPTAIN',
  2: 'ENGINEER',
  3: 'MEDIC',
  4: 'SMUGGLER',
  5: 'QUARTERMASTER',
  6: 'SABOTEUR',
};
const EMPTY_ORDER: Order = { allocations: [1, 1, 1], sideAction: 'NONE', target: 0 };
const CREW_PORTRAITS = ['voss', 'iris', 'kline', 'rook', 'mercer'] as const;
const CREW_QUIPS = [
  'Relax. Systems are fine.',
  'Happy to help fix things.',
  "Let's keep this ship moving.",
  "Numbers don't lie. People do.",
  'I saw nothing.',
] as const;

type Summary = {
  host: Address;
  phase: number;
  round: number;
  humanCount: number;
  botCount: number;
  actionDeadline: number;
  discussionDeadline: number;
  voteDeadline: number;
  players: readonly Address[];
  bots: readonly boolean[];
};

type PublicRound = { round: number; health: number[]; claimed: number[]; ejected?: number };
type TxState = { stage: 'idle' | 'wallet' | 'pending' | 'confirmed'; label: string; hash?: Hex };
type Command =
  | { name: 'createMatch' }
  | { name: 'joinMatch'; matchId: bigint }
  | { name: 'setReady'; matchId: bigint; ready: boolean }
  | { name: 'startMatch'; matchId: bigint; value: bigint }
  | { name: 'submitOrders'; matchId: bigint; payload: Hex; value: bigint }
  | { name: 'resolveRound'; matchId: bigint }
  | { name: 'sendComms'; matchId: bigint; message: string }
  | { name: 'openVote'; matchId: bigint }
  | { name: 'submitVote'; matchId: bigint; payload: Hex; value: bigint }
  | { name: 'resolveVote'; matchId: bigint };

function short(address?: string | null) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'UNASSIGNED';
}

function objectiveLabel(code: number) {
  if (code === 100) return 'Bring Reactor to critical condition before extraction.';
  if (code === 102) return 'Bring Navigation to critical condition before extraction.';
  return ({
    1: 'Preserve command integrity through extraction.',
    2: 'Keep Reactor integrity above 40%.',
    3: 'Keep as many crew members aboard as possible.',
    4: 'Complete two quiet contraband extractions.',
    5: 'Keep all three ship systems supplied.',
  } as Record<number, string>)[code] || 'Classified directive unavailable.';
}

function archiveSpecial(role: Role, target: number) {
  if (role === 'ENGINEER') return `OVERCLOCK +2 / ${SYSTEM_NAMES[target % 3]}`;
  if (role === 'QUARTERMASTER') return 'SURGE +1 / ALL SYSTEMS';
  if (role === 'MEDIC') return `MEDICAL LOCKOUT / SEAT ${target + 1}`;
  if (role === 'SMUGGLER') return 'CONTRABAND EXTRACTION / +1';
  if (role === 'SABOTEUR') return `TELEMETRY POISON / ${SYSTEM_NAMES[target % 3]}`;
  return `CAPTAIN AUDIT / ${SYSTEM_NAMES[target % 3]}`;
}

function healthClass(value: number) {
  if (value < 20) return 'critical';
  if (value < 40) return 'warning';
  if (value > 60) return 'stable';
  return 'nominal';
}

function tokens(value: number) {
  return Array.from({ length: 3 }, (_, index) => <i key={index} className={index < value ? 'filled' : ''} />);
}

export function OnchainOps() {
  const { play, setAmbience } = useGameAudio();
  const configured = MUTINY_ADDRESS.toLowerCase() !== ZERO_ADDRESS;
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [matchCode, setMatchCode] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [ready, setReadyState] = useState<boolean[]>([false, false, false, false, false]);
  const [seat, setSeat] = useState<number | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [objectiveCode, setObjectiveCode] = useState<number | null>(null);
  const [order, setOrder] = useState<Order>(EMPTY_ORDER);
  const [vote, setVote] = useState(5);
  const [orderSubmitted, setOrderSubmitted] = useState(false);
  const [voteSubmitted, setVoteSubmitted] = useState(false);
  const [canResolve, setCanResolve] = useState(false);
  const [publicRound, setPublicRound] = useState<PublicRound | null>(null);
  const [ejectedSeats, setEjectedSeats] = useState<number[]>([]);
  const [commsDraft, setCommsDraft] = useState('');
  const [comms, setComms] = useState<string[]>([]);
  const [blackBox, setBlackBox] = useState<BlackBoxEvidence | null>(null);
  const [tx, setTx] = useState<TxState>({ stage: 'idle', label: 'Bridge standing by' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [syncIssue, setSyncIssue] = useState('');
  const [revealIssue, setRevealIssue] = useState('');
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const lastPublicRound = useRef<PublicRound | null>(null);
  const ballotDialog = useRef<HTMLDialogElement | null>(null);
  const operationLock = useRef(false);
  const syncSequence = useRef(0);

  const id = useMemo(() => matchCode ? BigInt(matchCode) : null, [matchCode]);
  const onBase = chainId === BASE_SEPOLIA_CHAIN_ID;
  const isHost = Boolean(account && summary && account.toLowerCase() === summary.host.toLowerCase());
  const seated = seat !== null && seat !== 255;
  const currentReady = seated ? ready[seat] : false;
  const allHumansReady = summary ? ready.slice(0, summary.humanCount).every(Boolean) : false;
  const energy = order.allocations.reduce((sum, value) => sum + value, 0) + (order.sideAction === 'NONE' ? 0 : 1);
  const deadline = summary?.phase === 1 ? summary.actionDeadline : summary?.phase === 2 ? summary.discussionDeadline : summary?.phase === 3 ? summary.voteDeadline : 0;
  const secondsLeft = Math.max(0, deadline - now);
  const playerEjected = seated && ejectedSeats.includes(seat);
  const txBusy = tx.stage === 'wallet' || tx.stage === 'pending';

  useEffect(() => {
    const dialog = ballotDialog.current;
    if (!dialog) return;
    const shouldOpen = summary?.phase === 3 && seated && !playerEjected;
    if (shouldOpen && !dialog.open) dialog.showModal();
    if (!shouldOpen && dialog.open) dialog.close();
  }, [playerEjected, seated, summary?.phase]);

  useEffect(() => () => setAmbience(false), [setAmbience]);

  useEffect(() => {
    if (summary?.phase === 4) {
      setAmbience(false);
      return;
    }
    const minimum = publicRound ? Math.min(...publicRound.health) : 55;
    setAmbience(Boolean(summary), Math.max(0, Math.min(1, (55 - minimum) / 45)));
  }, [publicRound, setAmbience, summary]);

  useEffect(() => {
    if (!publicRound || lastPublicRound.current?.round === publicRound.round) return;
    const previous = lastPublicRound.current;
    lastPublicRound.current = publicRound;
    if (!previous) return;
    if (Math.min(...publicRound.health) < 20) play('alert');
    else if (publicRound.health.some((value, index) => value < (previous.health[index] ?? value))) play('damage');
    else play('transmission');
  }, [play, publicRound]);

  const clearPrivateState = useCallback(() => {
    setRole(null);
    setObjectiveCode(null);
    setOrderSubmitted(false);
    setVoteSubmitted(false);
    setBlackBox(null);
  }, []);

  const readPublicRound = useCallback(async (matchId: bigint, round: number) => {
    if (round < 1) return null;
    const handles = await publicClient.readContract({
      address: MUTINY_ADDRESS,
      abi: mutinyAbi,
      functionName: 'publicRoundHandles',
      args: [matchId, round],
    });
    const values = await revealPublic([...handles[0], ...handles[1]] as Hex[]);
    const ejected = await revealPublic([handles[2]]);
    return {
      round,
      health: values.slice(0, 3).map(Number),
      claimed: values.slice(3, 6).map(Number),
      ejected: ejected[0] === undefined ? undefined : Number(ejected[0]),
    } satisfies PublicRound;
  }, []);

  const loadComms = useCallback(async (matchId: bigint, fromBlock: bigint) => {
    const events = await publicClient.getContractEvents({
      address: MUTINY_ADDRESS,
      abi: mutinyAbi,
      eventName: 'Comms',
      args: { matchId },
      fromBlock,
      toBlock: 'latest',
    });
    return events.map((event) => {
      const sender = event.args.sender;
      return `R${Number(event.args.round)} · ${short(sender)} · ${event.args.message}`;
    });
  }, []);

  const syncMatch = useCallback(async (options?: { quiet?: boolean; code?: string }) => {
    if (!configured) return;
    const code = options?.code ?? matchCode;
    if (!code) return;
    const matchId = BigInt(code);
    const request = ++syncSequence.current;
    try {
      const [raw, readyRaw, createdBlock] = await Promise.all([
        publicClient.readContract({ address: MUTINY_ADDRESS, abi: mutinyAbi, functionName: 'matchSummary', args: [matchId] }),
        publicClient.readContract({ address: MUTINY_ADDRESS, abi: mutinyAbi, functionName: 'readyState', args: [matchId] }),
        publicClient.readContract({ address: MUTINY_ADDRESS, abi: mutinyAbi, functionName: 'matchCreatedBlock', args: [matchId] }),
      ]);
      const next: Summary = {
        host: raw[0], phase: Number(raw[1]), round: Number(raw[2]), humanCount: Number(raw[3]), botCount: Number(raw[4]),
        actionDeadline: Number(raw[5]), discussionDeadline: Number(raw[6]), voteDeadline: Number(raw[7]), players: raw[8], bots: raw[9],
      };
      if (request !== syncSequence.current) return;
      setSummary(next);
      setReadyState([...readyRaw]);
      let nextSeat = 255;
      if (account) {
        nextSeat = Number(await publicClient.readContract({ address: MUTINY_ADDRESS, abi: mutinyAbi, functionName: 'seatOf', args: [matchId, account] }));
        if (request !== syncSequence.current) return;
        setSeat(nextSeat);
      } else {
        setSeat(null);
      }
      if (nextSeat !== 255 && next.phase === 1) {
        const submitted = await publicClient.readContract({ address: MUTINY_ADDRESS, abi: mutinyAbi, functionName: 'actionSubmitted', args: [matchId, next.round, nextSeat] });
        if (request !== syncSequence.current) return;
        setOrderSubmitted(submitted);
      } else if (next.phase !== 1) setOrderSubmitted(false);
      if (nextSeat !== 255 && next.phase === 3) {
        const submitted = await publicClient.readContract({ address: MUTINY_ADDRESS, abi: mutinyAbi, functionName: 'voteSubmitted', args: [matchId, next.round, nextSeat] });
        if (request !== syncSequence.current) return;
        setVoteSubmitted(submitted);
      } else if (next.phase !== 3) setVoteSubmitted(false);
      const resolvable = next.phase === 1
        ? await publicClient.readContract({ address: MUTINY_ADDRESS, abi: mutinyAbi, functionName: 'canResolveRound', args: [matchId] })
        : next.phase === 3
          ? await publicClient.readContract({ address: MUTINY_ADDRESS, abi: mutinyAbi, functionName: 'canResolveVote', args: [matchId] })
          : false;
      if (request !== syncSequence.current) return;
      setCanResolve(resolvable);

      const resolvedRound = next.phase === 2 || next.phase === 3 || next.phase === 4 ? next.round : next.round - 1;
      if (resolvedRound > 0) {
        try {
          const latestRound = await readPublicRound(matchId, resolvedRound);
          if (request !== syncSequence.current) return;
          setPublicRound(latestRound);
          setRevealIssue('');
        } catch (roundError) {
          if (request !== syncSequence.current) return;
          setRevealIssue(operationErrorMessage(roundError));
        }
        const ejections: number[] = [];
        for (let round = 1; round <= resolvedRound; round++) {
          try {
            const result = await readPublicRound(matchId, round);
            if (result?.ejected !== undefined && result.ejected < 5) ejections.push(result.ejected);
          } catch (roundError) {
            if (request !== syncSequence.current) return;
            setRevealIssue(operationErrorMessage(roundError));
          }
        }
        if (request !== syncSequence.current) return;
        setEjectedSeats([...new Set(ejections)]);
      }
      if (next.phase >= 2) {
        const messages = await loadComms(matchId, createdBlock);
        if (request !== syncSequence.current) return;
        setComms(messages);
      }
      if (typeof window !== 'undefined') {
        writeLocalValue('mutiny:last-match', code);
        const url = new URL(window.location.href);
        url.searchParams.set('match', code);
        window.history.replaceState({}, '', url);
      }
      if (!options?.quiet) setNotice(`Operation ${code} synchronized.`);
      if (!options?.quiet) setError('');
      setSyncIssue('');
    } catch (syncError) {
      if (request !== syncSequence.current) return;
      const message = operationErrorMessage(syncError);
      setSyncIssue(message);
      if (!options?.quiet) setError(message);
    }
  }, [account, configured, loadComms, matchCode, readPublicRound]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get('match');
    const saved = readLocalValue('mutiny:last-match');
    const initial = query?.replace(/\D/g, '') || saved?.replace(/\D/g, '') || '';
    if (initial) setMatchCode(initial);
    if (readLocalValue('mutiny:wallet-disconnected') === 'true') return;
    void restoreWallet().then((connection) => {
      if (!connection) return;
      setWallet(connection.wallet);
      setAccount(connection.account);
      setChainId(connection.chainId);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider?.on) return;
    const recoverProviderIdentity = async () => {
      if (readLocalValue('mutiny:wallet-disconnected') === 'true') return false;
      const connection = await restoreWallet();
      if (!connection) return false;
      setWallet(connection.wallet);
      setAccount(connection.account);
      setChainId(connection.chainId);
      setError('');
      return true;
    };
    const accountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? args[0] : [];
      const next = accounts[0];
      if (typeof next !== 'string') {
        void recoverProviderIdentity().then((recovered) => {
          if (recovered) return;
          setWallet(null); setAccount(null); setSeat(null); clearPrivateState(); setError('Crew identity lost. The operation code remains stored for reconnection.');
        }).catch(() => {
          setWallet(null); setAccount(null); setSeat(null); clearPrivateState(); setError('Crew identity lost. The operation code remains stored for reconnection.');
        });
      } else {
        if (readLocalValue('mutiny:wallet-disconnected') === 'true') return;
        void recoverProviderIdentity().then((recovered) => {
          if (recovered) clearPrivateState();
        }).catch((restoreError) => setError(operationErrorMessage(restoreError)));
      }
    };
    const chainChanged = (...args: unknown[]) => {
      const value = args[0];
      setChainId(typeof value === 'string' ? Number.parseInt(value, 16) : null);
    };
    const connected = (...args: unknown[]) => {
      const detail = args[0];
      const value = typeof detail === 'object' && detail && 'chainId' in detail ? detail.chainId : null;
      if (typeof value === 'string') setChainId(Number.parseInt(value, 16));
      setError('');
      setNotice('Crew identity confirmed.');
    };
    const disconnected = () => {
      if (readLocalValue('mutiny:wallet-disconnected') === 'true') return;
      setChainId(null);
      setError('');
      setNotice('Wallet signal interrupted. Your crew identity and operation remain secured while the relay reconnects.');
    };
    provider.on('accountsChanged', accountsChanged);
    provider.on('chainChanged', chainChanged);
    provider.on('connect', connected);
    provider.on('disconnect', disconnected);
    return () => {
      provider.removeListener?.('accountsChanged', accountsChanged);
      provider.removeListener?.('chainChanged', chainChanged);
      provider.removeListener?.('connect', connected);
      provider.removeListener?.('disconnect', disconnected);
    };
  }, [clearPrivateState]);

  useEffect(() => {
    if (!matchCode) { setSummary(null); return; }
    void syncMatch({ quiet: true });
    const poll = window.setInterval(() => void syncMatch({ quiet: true }), 5000);
    return () => window.clearInterval(poll);
  }, [matchCode, account, syncMatch]);

  useEffect(() => {
    if (tx.stage !== 'pending' || !tx.hash) return;
    const hash = tx.hash;
    const poll = window.setInterval(() => {
      void publicClient.getTransactionReceipt({ hash }).then((receipt) => {
        if (receipt.status !== 'success') {
          setError(operationErrorMessage(new Error('Transaction reverted')));
          setTx({ stage: 'idle', label: 'Base Sepolia rejected the transmission' });
          return;
        }
        setTx({ stage: 'confirmed', label: 'Delayed transmission confirmed', hash });
        setNotice('Base Sepolia confirmed the delayed transmission. Bridge state is synchronized.');
        void syncMatch({ quiet: true });
      }).catch(() => undefined);
    }, 8_000);
    return () => window.clearInterval(poll);
  }, [syncMatch, tx.hash, tx.stage]);

  async function connect() {
    await perform(async () => {
      setError(''); setTx({ stage: 'wallet', label: 'Opening crew identification' });
      play('relay');
      const connection = await connectWallet();
      removeLocalValue('mutiny:wallet-disconnected');
      setWallet(connection.wallet); setAccount(connection.account); setChainId(connection.chainId);
      setError(''); setNotice('Crew identity confirmed.');
      setTx({ stage: 'confirmed', label: 'Crew identity confirmed' });
      if (matchCode) await syncMatch({ code: matchCode });
    }, 'Crew identification paused');
  }

  async function disconnectWallet() {
    if (txBusy) return;
    operationLock.current = true;
    try {
      writeLocalValue('mutiny:wallet-disconnected', 'true');
      const provider = window.ethereum;
      if (provider) {
        try {
          await provider.request({
            method: 'wallet_revokePermissions',
            params: [{ eth_accounts: {} }],
          });
        } catch {
          // Some injected wallets do not support programmatic permission revocation.
        }
      }
      setWallet(null);
      setAccount(null);
      setChainId(null);
      setSeat(null);
      clearPrivateState();
      setError('');
      setNotice('Crew identity disconnected. Operation code preserved for observation or later reconnection.');
      setTx({ stage: 'idle', label: 'Crew identity disconnected' });
      play('relay');
    } finally {
      operationLock.current = false;
    }
  }

  async function switchNetwork() {
    await perform(async () => {
      setError(''); setTx({ stage: 'wallet', label: 'Requesting Base Sepolia' });
      play('relay');
      setChainId(await switchToBaseSepolia());
      setTx({ stage: 'confirmed', label: 'Base Sepolia signal locked' });
    }, 'Network change cancelled');
  }

  async function send(command: Command, label: string): Promise<TransactionReceipt> {
    if (!wallet || !account) throw new Error('Wallet disconnected');
    if (!onBase) throw new Error('Wrong network');
    const value = 'value' in command ? command.value : 0n;
    setError(''); setNotice(''); setTx({ stage: 'wallet', label: `Authorize ${label}` });
    let data: Hex;
    switch (command.name) {
      case 'createMatch': data = encodeFunctionData({ abi: mutinyAbi, functionName: 'createMatch' }); break;
      case 'joinMatch': data = encodeFunctionData({ abi: mutinyAbi, functionName: 'joinMatch', args: [command.matchId] }); break;
      case 'setReady': data = encodeFunctionData({ abi: mutinyAbi, functionName: 'setReady', args: [command.matchId, command.ready] }); break;
      case 'startMatch': data = encodeFunctionData({ abi: mutinyAbi, functionName: 'startMatch', args: [command.matchId] }); break;
      case 'submitOrders': data = encodeFunctionData({ abi: mutinyAbi, functionName: 'submitOrders', args: [command.matchId, command.payload] }); break;
      case 'resolveRound': data = encodeFunctionData({ abi: mutinyAbi, functionName: 'resolveRound', args: [command.matchId] }); break;
      case 'sendComms': data = encodeFunctionData({ abi: mutinyAbi, functionName: 'sendComms', args: [command.matchId, command.message] }); break;
      case 'openVote': data = encodeFunctionData({ abi: mutinyAbi, functionName: 'openVote', args: [command.matchId] }); break;
      case 'submitVote': data = encodeFunctionData({ abi: mutinyAbi, functionName: 'submitVote', args: [command.matchId, command.payload] }); break;
      case 'resolveVote': data = encodeFunctionData({ abi: mutinyAbi, functionName: 'resolveVote', args: [command.matchId] }); break;
    }
    const [estimatedGas, gasPrice, balance] = await Promise.all([
      publicClient.estimateGas({ account, to: MUTINY_ADDRESS, data, value }),
      publicClient.getGasPrice(),
      publicClient.getBalance({ address: account }),
    ]);
    const gas = estimatedGas * 125n / 100n;
    const transactionCost = value + gas * gasPrice;
    if (balance < transactionCost) throw new Error('Insufficient funds');
    const hash = await wallet.sendTransaction({
      to: MUTINY_ADDRESS,
      data,
      value,
      gas,
      gasPrice,
    });
    setTx({ stage: 'pending', label: `${label} entering the BLACK BOX`, hash });
    play('transmission');
    let receipt: TransactionReceipt;
    try {
      receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    } catch (receiptError) {
      const message = receiptError instanceof Error ? receiptError.message : String(receiptError);
      if (/timeout|timed out/i.test(message)) {
        setTx({ stage: 'pending', label: `${label} confirmation delayed`, hash });
        throw new Error(`Confirmation delayed for ${hash}`);
      }
      throw receiptError;
    }
    if (receipt.status !== 'success') throw new Error('Transaction reverted');
    setTx({ stage: 'confirmed', label: `${label} confirmed`, hash });
    return receipt;
  }

  async function perform(work: () => Promise<void>, failureLabel = 'No operation change') {
    if (operationLock.current) {
      setNotice('Command lock active. The first request remains authoritative.');
      return;
    }
    operationLock.current = true;
    try {
      await work();
    } catch (actionError) {
      play('alert');
      setError(operationErrorMessage(actionError));
      const delayed = actionError instanceof Error && /confirmation delayed/i.test(actionError.message);
      if (!delayed) setTx({ stage: 'idle', label: failureLabel });
      if (matchCode) await syncMatch({ quiet: true });
    } finally {
      operationLock.current = false;
    }
  }

  async function checkPendingTransmission() {
    if (!tx.hash || operationLock.current) return;
    operationLock.current = true;
    setError('');
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: tx.hash });
      if (receipt.status !== 'success') throw new Error('Transaction reverted');
      setTx({ stage: 'confirmed', label: 'Delayed transmission confirmed', hash: tx.hash });
      setNotice('Base Sepolia confirmed the delayed transmission. Bridge state is synchronizing.');
      await syncMatch({ quiet: true });
    } catch (receiptError) {
      const text = receiptError instanceof Error ? receiptError.message : String(receiptError);
      if (/transaction receipt.*not found|could not be found/i.test(text)) {
        setNotice('Transmission remains in the Base Sepolia queue. No replacement was sent.');
      } else {
        setError(operationErrorMessage(receiptError));
      }
    } finally {
      operationLock.current = false;
    }
  }

  async function createMatch() {
    await perform(async () => {
      const receipt = await send({ name: 'createMatch' }, 'new operation');
      const events = parseEventLogs({ abi: mutinyAbi, eventName: 'MatchCreated', logs: receipt.logs });
      const createdId = events[0]?.args.matchId;
      if (createdId === undefined) throw new Error('Match creation event missing');
      const code = createdId.toString(); setMatchCode(code); clearPrivateState();
      await syncMatch({ code }); setNotice(`Operation ${code} created. Share the invitation with your crew.`);
    });
  }

  async function prepareOperation() {
    if (!account) {
      await connect();
      return;
    }
    if (!onBase) {
      await switchNetwork();
      return;
    }
    await createMatch();
  }

  async function joinMatch() { if (!id) return; await perform(async () => { await send({ name: 'joinMatch', matchId: id }, 'boarding'); await syncMatch(); }); }
  async function toggleReady() { if (!id || !seated) return; await perform(async () => { await send({ name: 'setReady', matchId: id, ready: !currentReady }, currentReady ? 'stand down' : 'crew readiness'); await syncMatch(); }); }
  async function startMatch() { if (!id) return; await perform(async () => { const fee = await getIncoFee(); await send({ name: 'startMatch', matchId: id, value: fee * 3n }, 'launch sequence'); await syncMatch(); }); }

  async function revealRole() {
    if (!wallet || !account || !id || !seated || !summary) return;
    await perform(async () => {
      setTx({ stage: 'wallet', label: 'Opening your sealed personnel file' }); setError('');
      const handles = await publicClient.readContract({ address: MUTINY_ADDRESS, abi: mutinyAbi, functionName: 'privateHandles', args: [id, seat, summary.round], account });
      const values = await decryptPrivate(wallet, [handles[0], handles[1]]);
      const nextRole = ROLE_BY_CODE[Number(values[0])];
      if (!nextRole) throw new Error('Role unavailable');
      play('dossier'); setRole(nextRole); setObjectiveCode(Number(values[1])); setTx({ stage: 'confirmed', label: 'Personnel file opened for your eyes only' });
    }, 'Personnel file remains sealed');
  }

  async function submitOrders() {
    if (!id || !account || energy > 3) return;
    await perform(async () => {
      setTx({ stage: 'pending', label: 'Sealing your orders' });
      const payload = await encryptUint(packOrder(order), account); const fee = await getIncoFee();
      await send({ name: 'submitOrders', matchId: id, payload, value: fee }, 'sealed orders'); play('seal-order'); setOrderSubmitted(true); await syncMatch({ quiet: true });
    });
  }

  async function resolveRound() { if (!id) return; await perform(async () => { await send({ name: 'resolveRound', matchId: id }, 'round resolution'); await syncMatch(); }); }
  async function openVote() { if (!id) return; await perform(async () => { await send({ name: 'openVote', matchId: id }, 'sealed ballot'); await syncMatch(); }); }
  async function submitVote() { if (!id || !account) return; await perform(async () => { play('ballot'); setTx({ stage: 'pending', label: 'Sealing your ballot' }); const payload = await encryptUint(BigInt(vote), account); const fee = await getIncoFee(); await send({ name: 'submitVote', matchId: id, payload, value: fee }, 'sealed ballot'); setVoteSubmitted(true); await syncMatch({ quiet: true }); }); }
  async function resolveVote() {
    if (!id || !summary) return;
    await perform(async () => {
      const resolvedRound = summary.round;
      await send({ name: 'resolveVote', matchId: id }, 'crew verdict');
      const result = await readPublicRound(id, resolvedRound);
      if (result?.ejected !== undefined && result.ejected < 5) play('ejection');
      else play('relay');
      setOrder(EMPTY_ORDER);
      setVote(5);
      await syncMatch();
    });
  }
  async function sendMessage() { if (!id || !commsDraft.trim()) return; const message = commsDraft.trim(); await perform(async () => { await send({ name: 'sendComms', matchId: id, message }, 'crew transmission'); setCommsDraft(''); await syncMatch({ quiet: true }); }); }

  async function copyInvite() {
    if (!matchCode) return;
    const url = new URL(window.location.href); url.searchParams.set('match', matchCode);
    try { await navigator.clipboard.writeText(url.toString()); setNotice('Crew invitation copied.'); }
    catch { setNotice(url.toString()); }
  }

  async function revealIntel() {
    if (!wallet || !account || !id || !seated || !summary) return;
    await perform(async () => {
      setTx({ stage: 'wallet', label: 'Opening private field report' });
      const handles = await publicClient.readContract({ address: MUTINY_ADDRESS, abi: mutinyAbi, functionName: 'privateHandles', args: [id, seat, summary.round], account });
      const values = await decryptPrivate(wallet, [handles[2], handles[3]]);
      const readable = values.filter((value) => value !== 255n).map((value) => value === 2n ? 'Anomalous activity detected.' : `Private reading: ${value}.`);
      play('dossier'); setNotice(readable.join(' ') || 'No private finding was produced this round.'); setTx({ stage: 'confirmed', label: 'Private field report opened' });
    }, 'Field report unavailable');
  }

  async function revealBlackBox() {
    if (!id) return;
    await perform(async () => {
      setAmbience(false); play('blackbox');
      setTx({ stage: 'pending', label: 'Recovering the complete flight record' }); setError('');
      const identity = await publicClient.readContract({ address: MUTINY_ADDRESS, abi: mutinyAbi, functionName: 'blackBoxIdentityHandles', args: [id] });
      const identityValues = await revealPublic([...identity[0], ...identity[1], identity[2], identity[3]] as Hex[]);
      const roles: Role[] = identityValues.slice(0, 5).map((value) => {
        const recoveredRole = ROLE_BY_CODE[Number(value)];
        if (!recoveredRole) throw new Error(`Unknown role code ${value}`);
        return recoveredRole;
      });
      const objectives = identityValues.slice(5, 10).map((value) => objectiveLabel(Number(value)));
      const target = Number(identityValues[10]) === 0 ? 'REACTOR' : 'NAVIGATION';
      const winner = Number(identityValues[11]) === 1 ? 'SABOTEUR' : 'CREW';
      const players: ArchivePlayer[] = roles.map((recoveredRole, index) => ({
        seat: index,
        callsign: summary?.bots[index] ? `SHIPBOARD ${index + 1}` : short(summary?.players[index]),
        role: recoveredRole,
        objective: objectives[index],
      }));
      const rounds: BlackBoxEvidence['rounds'] = [];
      let before: ArchiveTriple = [55, 55, 55];
      const activeSeats = new Set(players.map((player) => player.seat));
      for (let round = 1; round <= 5; round++) {
        const data = await publicClient.readContract({ address: MUTINY_ADDRESS, abi: mutinyAbi, functionName: 'blackBoxRoundHandles', args: [id, round] });
        const values = await revealPublic([
          ...data[0], ...data[1], ...data[2], ...data[3], ...data[4], ...data[5], ...data[6],
          ...data[7], ...data[8], ...data[9], data[10],
        ] as Hex[]);
        const actions = values.slice(0, 5).map(unpackOrder); const votes = values.slice(5, 10).map(Number);
        const truth = values.slice(10, 13).map(Number) as ArchiveTriple;
        const shown = values.slice(13, 16).map(Number) as ArchiveTriple;
        const claimed = values.slice(16, 19).map(Number) as ArchiveTriple;
        const sabotage = values.slice(19, 22).map(Number) as ArchiveTriple;
        const telemetry = values.slice(22, 25).map((value) => Number(value) === 1) as [boolean, boolean, boolean];
        const anomalies = values.slice(25, 30).map((value) => Number(value) === 1);
        const clues = values.slice(30, 35).map(Number);
        const audits = values.slice(35, 40).map(Number);
        const ejectedValue = Number(values[40]);
        const ejected = ejectedValue < 5 ? ejectedValue : null;
        const actors: ArchiveActor[] = actions.flatMap((action, index) => {
          if (!activeSeats.has(index)) return [];
          const player = players[index];
          const investigation = action.sideAction === 'INVESTIGATE'
            ? clues[index] === 2
              ? `${players[action.target % 5].callsign} produced an anomalous encrypted trace`
              : clues[index] === 0
                ? `No anomaly found for ${players[action.target % 5].callsign}`
                : 'No private report produced'
            : audits[index] !== 255
              ? `Canonical ${SYSTEM_NAMES[action.target % 3]} health was ${audits[index]}%`
              : undefined;
          return [{
            ...player,
            claimed: action.allocations,
            actual: action.allocations.map((value) => player.role === 'SABOTEUR' ? -value : value) as ArchiveTriple,
            sideAction: action.sideAction,
            target: action.target,
            anomalous: anomalies[index],
            ballot: votes[index],
            investigation,
            specialEffect: action.sideAction === 'SPECIAL' ? archiveSpecial(player.role, action.target) : undefined,
            beneficiary: player.role === 'SABOTEUR' ? 'SABOTEUR' : player.role === 'SMUGGLER' && action.sideAction === 'SPECIAL' ? 'SELF' : 'CREW',
          }];
        });
        rounds.push({ round, before, trueHealth: truth, reportedHealth: shown, claimedTotals: claimed, sabotage, telemetry, actors, ejected });
        before = truth;
        if (ejected !== null) activeSeats.delete(ejected);
      }
      const finalTruth = rounds[rounds.length - 1]?.trueHealth ?? [0, 0, 0];
      setBlackBox({
        winner,
        target,
        finalCondition: winner === 'SABOTEUR'
          ? `${target} reached the hostile threshold or a ship system reached zero integrity.`
          : `All ship systems survived five rounds and ${target} stayed above the hostile threshold. Final canonical integrity was ${finalTruth.join(' / ')}.`,
        proofLabel: 'BASE SEPOLIA / INCO LIGHTNING REVEAL',
        players,
        rounds,
      });
      setTx({ stage: 'confirmed', label: 'BLACK BOX recovered' });
    }, 'BLACK BOX recovery paused');
  }

  const special = role ? roleBrief(role, objectiveCode === 100 ? 0 : 2).special : '';
  const targetCrew = order.sideAction === 'INVESTIGATE' || (order.sideAction === 'SPECIAL' && role === 'MEDIC');
  const targetOptions = targetCrew
    ? Array.from({ length: 5 }, (_, index) => ({ value: index, label: `SEAT ${index + 1} · ${summary?.bots[index] ? 'AUTONOMOUS' : short(summary?.players[index])}` }))
    : SYSTEM_NAMES.map((name, index) => ({ value: index, label: name }));
  const vesselHealth: [number, number, number] = publicRound
    ? [publicRound.health[0] ?? 55, publicRound.health[1] ?? 55, publicRound.health[2] ?? 55]
    : [55, 55, 55];

  if (summary?.phase === 4 && blackBox) return <div className="onchain-blackbox-shell">{account ? <button className="wallet-disconnect" type="button" disabled={txBusy} onClick={disconnectWallet}><span>{short(account)}</span><b>DISCONNECT</b></button> : <button className="wallet-disconnect wallet-reconnect" type="button" disabled={txBusy} onClick={connect}><span>CREW ID LOST</span><b>RECONNECT</b></button>}<BlackBoxArchive evidence={blackBox} /></div>;

  const minimumHealth = Math.min(...vesselHealth);
  const shipState = minimumHealth < 20 ? 'critical' : minimumHealth < 40 ? 'warning' : minimumHealth > 60 ? 'stable' : 'nominal';

  const statusLayer = <>
    {!configured && <div className="chain-warning"><b>LIVE OPERATION OFFLINE</b><span>No deployed operation address was found.</span><Link href="/play">ENTER TRAINING</Link></div>}
    {account && !onBase && <div className="chain-warning network-warning"><b>WRONG SIGNAL</b><span>Switch your wallet to Base Sepolia.</span><button disabled={txBusy} onClick={switchNetwork}>SWITCH NETWORK</button></div>}
    {(error || notice) && <div className={`operation-message ${error ? 'error' : 'notice'}`} role={error ? 'alert' : 'status'}><span>{error || notice}</span>{error && matchCode && !txBusy && <button type="button" onClick={account ? () => syncMatch() : connect}>{account ? 'RETRY' : 'RECONNECT'}</button>}</div>}
    {!error && syncIssue && <div className="operation-message error" role="alert"><span>{syncIssue}</span><button type="button" disabled={txBusy} onClick={() => syncMatch()}>RETRY RELAY</button></div>}
    {revealIssue && <div className="operation-message attestation" role="status"><span>{revealIssue}</span><button type="button" disabled={txBusy} onClick={() => syncMatch()}>RETRY ATTESTATION</button></div>}
    <div className={`tx-status ${tx.stage}`}><i /><span>{tx.label}</span>{tx.stage === 'pending' && <b>CONFIRMING</b>}{tx.stage === 'pending' && tx.hash && <button type="button" onClick={checkPendingTransmission}>CHECK</button>}</div>
    {account ? <button className="wallet-disconnect" type="button" disabled={txBusy} onClick={disconnectWallet}><span>{short(account)}</span><b>DISCONNECT</b></button> : summary && <button className="wallet-disconnect wallet-reconnect" type="button" disabled={txBusy} onClick={connect}><span>CREW ID LOST</span><b>RECONNECT</b></button>}
  </>;

  if (!summary) return <div className="chain-shell multiplayer-shell onchain-entry-shell">{statusLayer}<section className="boarding-screen onchain-boarding"><div className="boarding-topline"><span>BLACKWATER–7 / LIVE CREW INTAKE</span><span>BASE SEPOLIA / INCO LIGHTNING</span></div><div className="boarding-copy"><span className="micro-kicker">LIVE OPERATION / 07-A</span><h1>BOARD THE<br />VESSEL.</h1><p>Connect your wallet, create a crew lobby, or enter an operation code from your captain.</p><button className="wallet-button mechanical-command" type="button" disabled={txBusy} onClick={connect}><span>{account ? short(account) : 'IDENTIFY CREW'}</span><b>BASE SEPOLIA</b><i>→</i></button></div><div className="onchain-entry-actions"><div className="entry-panel"><span>NEW OPERATION</span><h2>Take command.</h2><button className="primary create-operation-button" disabled={!configured || txBusy} onClick={prepareOperation}>{!account ? 'CONNECT WALLET TO CREATE' : !onBase ? 'SWITCH TO BASE SEPOLIA' : 'CREATE OPERATION'}</button></div><div className="entry-panel"><span>CREW INVITATION</span><h2>Board by code.</h2><input inputMode="numeric" value={matchCode} onChange={(event) => setMatchCode(event.target.value.replace(/\D/g, ''))} placeholder="OPERATION CODE" /><button disabled={!configured || !matchCode || txBusy} onClick={() => syncMatch()}>FIND OPERATION</button></div></div></section></div>;

  if (summary.phase === 0) return <div className="chain-shell multiplayer-shell onchain-entry-shell">{statusLayer}<section className="boarding-screen onchain-boarding"><div className="boarding-topline"><span>BLACKWATER–7 / CREW MANIFEST</span><span>OPERATION {matchCode}</span></div><div className="boarding-copy"><span className="micro-kicker">LIVE LOBBY / {summary.humanCount} HUMAN</span><h1>SEAL THE<br />MANIFEST.</h1><p>Share the operation code. Empty stations become shipboard crew when the captain launches.</p><button className="copy-live-invite" onClick={copyInvite}>COPY CREW INVITE</button></div><div className="manifest-table">{Array.from({ length: 5 }, (_, index) => { const occupied = index < summary.humanCount; return <div className="manifest-row" key={index}><span className="manifest-index">{String(index + 1).padStart(2, '0')}</span><span className="manifest-glyph"><img src={`/crew/${CREW_PORTRAITS[index]}.png`} alt="" /></span><span className="manifest-name"><b>{occupied ? short(summary.players[index]) : 'OPEN STATION'}</b><small>{occupied ? seat === index ? 'YOU / HUMAN' : 'HUMAN CREW' : 'BOT ON LAUNCH'}</small></span><span className="manifest-clearance">{occupied ? 'WALLET VERIFIED' : 'AUTONOMOUS'}</span><span className="manifest-status"><i />{occupied ? ready[index] ? 'READY' : 'BOARDING' : 'STANDBY'}</span></div>; })}</div><div className="onchain-lobby-actions">{!seated && <button disabled={!account || !onBase || txBusy || summary.humanCount >= 5} onClick={joinMatch}>CLAIM OPEN SEAT</button>}{seated && <button disabled={!onBase || txBusy} onClick={toggleReady}>{currentReady ? 'READY / STAND DOWN' : 'MARK READY'}</button>}{isHost && <button className="primary" disabled={!allHumansReady || !onBase || txBusy} onClick={startMatch}>LAUNCH / FILL {5 - summary.humanCount} BOT SEATS</button>}</div></section></div>;

  return <div className="chain-shell multiplayer-shell onchain-bridge-shell">{statusLayer}<section className={`bridge-screen ship-${shipState}`} data-ship-state={shipState}><header className="bridge-topbar"><div><span>LIVE COMMAND DECK</span><b>OPERATION {matchCode}</b></div><div className="round-indicator"><small>ROUND</small><strong>{String(summary.round).padStart(2, '0')}</strong><span>/ 05</span></div><div className="phase-indicator"><span>PHASE</span><b>{PHASE[summary.phase]}</b></div><div className="bridge-signal"><i /> {onBase ? 'BASE SEPOLIA / LIVE' : 'SIGNAL LOST'}</div></header><div className="bridge-layout"><aside className="crew-manifest-v2"><div className="section-code"><span>CREW MANIFEST</span><b>{summary.humanCount} HUMAN / {summary.botCount} BOT</b></div><div className="crew-entries">{Array.from({ length: 5 }, (_, index) => <div className={`crew-entry ${seat === index ? 'selected' : ''} ${ejectedSeats.includes(index) ? 'inactive' : ''}`} key={index}><span className="crew-number">{String(index + 1).padStart(2, '0')}</span><span className="crew-portrait-frame"><img src={`/crew/${CREW_PORTRAITS[index]}.png`} alt="" /></span><span className="crew-ident"><b>{summary.bots[index] ? `SHIPBOARD ${index + 1}` : short(summary.players[index])}</b><small>{seat === index ? 'YOU / OWNER ONLY' : summary.bots[index] ? 'AUTONOMOUS' : 'IDENTITY SEALED'}</small></span><span className="trust-meter"><i style={{ width: ejectedSeats.includes(index) ? '100%' : '18%' }} /></span><span className="trust-number">{ejectedSeats.includes(index) ? 'XX' : '18'}</span><span className="crew-quips">{ejectedSeats.includes(index) ? 'Removed from the vessel.' : CREW_QUIPS[index]}</span></div>)}</div></aside><main className="bridge-core"><div className="ship-stage"><BlackwaterShip health={vesselHealth} compact /><div className="crisis-banner"><span>PUBLIC SYSTEM FEED</span><b>{vesselHealth.join(' / ')}</b><em>REPORTED TELEMETRY MAY BE COMPROMISED</em></div></div><div className="command-deck">{!seated && <div className="observer-console"><span>PUBLIC OBSERVER / NO SEAT</span><h2>Watch the operation.</h2><p>Connect the seated wallet to issue orders. Public telemetry remains visible.</p></div>}{seated && !role && <div className="observer-console dossier-open-console"><span>SEALED PERSONNEL FILE</span><h2>Your directive is waiting.</h2><p>Your wallet opens only your role and objective.</p><button disabled={!wallet || !onBase || txBusy} onClick={revealRole}>OPEN EYES-ONLY FILE <b>OWNER ONLY ↗</b></button></div>}{summary.phase === 1 && seated && role && !playerEjected && <><FirstOperationBriefing stage="ACTION" /><div className="command-title-row"><div><span className="micro-kicker">YOUR MOVE / {role}</span><h2>Choose where power goes.</h2></div><div className="energy-reserve"><span>ENERGY RESERVE</span><div>{tokens(Math.max(0, 3 - energy))}</div><b>{Math.max(0, 3 - energy)} REMAIN</b></div></div><div className="allocation-console">{SYSTEM_NAMES.map((name, index) => <div className={`allocation-channel ${healthClass(vesselHealth[index])}`} key={name}><div className="allocation-label"><span>SYS / 0{index + 1}</span><b>{name}</b></div><div className="allocation-bay" aria-hidden="true"><i /><i /><i /></div><button className="allocation-step down" disabled={orderSubmitted || txBusy} onClick={() => setOrder((current) => { const allocations = [...current.allocations] as [number, number, number]; allocations[index] = Math.max(0, allocations[index] - 1); return { ...current, allocations }; })}>−</button><div className="energy-chits">{tokens(order.allocations[index])}</div><strong className="allocation-value">{order.allocations[index]}</strong><button className="allocation-step up" disabled={orderSubmitted || txBusy} onClick={() => setOrder((current) => { const allocations = [...current.allocations] as [number, number, number]; allocations[index] = Math.min(3, allocations[index] + 1); return { ...current, allocations }; })}>+</button></div>)}</div><div className="allocation-privacy-note"><span>CREW SEES</span><b>YOUR CLAIM</b><span>BLACK BOX SEES</span><b>YOUR TRUE EFFECT</b></div><div className="order-options">{(['NONE', 'INVESTIGATE', 'SPECIAL'] as SideAction[]).map((action, index) => <button key={action} className={order.sideAction === action ? 'selected' : ''} disabled={orderSubmitted || txBusy} onClick={() => setOrder({ ...order, sideAction: action, target: 0 })}><span>0{index}</span><b>{action === 'NONE' ? 'USE ALL POWER' : action === 'INVESTIGATE' ? 'CHECK A CREWMATE' : 'USE ROLE POWER'}</b><small>{action === 'SPECIAL' ? special : action === 'INVESTIGATE' ? 'Costs 1 power.' : 'No side action.'}</small></button>)}</div>{order.sideAction !== 'NONE' && <div className="sealed-target-row"><label><span>TARGET</span><select disabled={orderSubmitted || txBusy} value={order.target} onChange={(event) => setOrder({ ...order, target: Number(event.target.value) })}>{targetOptions.map((target) => <option value={target.value} key={target.value}>{target.label}</option>)}</select></label><div><span>VISIBILITY</span><b>OWNER ONLY</b></div></div>}<button className="seal-lever" disabled={orderSubmitted || energy > 3 || !onBase || txBusy} onClick={submitOrders}><span className="lever-track"><i /></span><span className="lever-copy"><small>ENCRYPTED ORDER</small><b>{orderSubmitted ? 'ORDERS SEALED' : 'SEAL ORDER'}</b></span><span className="lever-code">EXEC / 0{summary.round}</span></button>{canResolve && <button className="onchain-resolve" disabled={txBusy} onClick={resolveRound}>RESOLVE CREW ORDERS</button>}</>}{summary.phase === 2 && <div className="comms-phase"><FirstOperationBriefing stage="DISCUSSION" /><div className="comms-heading"><span>COMMS OPEN / {secondsLeft}s</span><b>WHO LIED?</b></div><div className="comms-feed">{comms.length ? comms.map((line, index) => <p key={index}>{line}</p>) : <p>No crew transmissions yet.</p>}</div>{seated && !playerEjected && <div className="comms-compose"><input maxLength={180} value={commsDraft} onChange={(event) => setCommsDraft(event.target.value)} placeholder="Transmit to the crew" /><button disabled={!commsDraft.trim() || txBusy} onClick={sendMessage}>TRANSMIT</button></div>}<div className="phase-actions">{seated && !playerEjected && <button disabled={txBusy} onClick={revealIntel}>OPEN PRIVATE REPORT</button>}{(isHost || secondsLeft === 0) && <button className="open-ballot" disabled={!account || !onBase || txBusy} onClick={openVote}>VOTE WHO LEAVES <span>→</span></button>}</div></div>}{summary.phase === 3 && seated && !playerEjected && <dialog ref={ballotDialog} className="ballot-modal" aria-labelledby="live-ballot-title" onCancel={(event) => event.preventDefault()}><div className="ballot-phase"><div className="ballot-heading"><span>SECRET VOTE / BASE SEPOLIA</span><h2 id="live-ballot-title">Who leaves?</h2><p>Nobody sees your encrypted choice.</p></div><div className="ballot-crew">{Array.from({ length: 5 }, (_, index) => <button className={vote === index ? 'selected' : ''} disabled={voteSubmitted || txBusy || ejectedSeats.includes(index)} onClick={() => setVote(index)} key={index}><span className="ballot-portrait"><img src={`/crew/${CREW_PORTRAITS[index]}.png`} alt="" /></span><b>{summary.bots[index] ? `SHIPBOARD ${index + 1}` : short(summary.players[index])}</b><small>SEAT {index + 1}</small><i /></button>)}<button className={`retain ${vote === 5 ? 'selected' : ''}`} disabled={voteSubmitted || txBusy} onClick={() => setVote(5)}><span>00</span><b>KEEP EVERYONE</b><small>SKIP EJECTION</small><i /></button></div><button className="seal-ballot" disabled={voteSubmitted || !onBase || txBusy} onClick={submitVote}>{voteSubmitted ? 'BALLOT SEALED' : 'SEAL EJECTION BALLOT'} <span>→</span></button>{canResolve && <button className="seal-ballot secondary" disabled={txBusy} onClick={resolveVote}>REVEAL CREW VERDICT</button>}</div></dialog>}{playerEjected && summary.phase < 4 && <div className="observer-console"><span>CREW STATUS / EJECTED</span><h2>You are off the ship.</h2><p>No power. No role ability. No vote. Watch the crew finish the operation.</p>{canResolve && summary.phase === 1 && <button onClick={resolveRound}>WATCH CREW ORDERS <b>RESOLVE ↗</b></button>}{canResolve && summary.phase === 3 && <button onClick={resolveVote}>WATCH VOTE RESULT <b>REVEAL ↗</b></button>}</div>}{summary.phase === 4 && <div className="observer-console blackbox-card"><span>RECOVERY COMPLETE</span><h2>BLACK BOX</h2><p>Every hidden role, order, ballot, and lie is ready for declassification.</p><button disabled={txBusy} onClick={revealBlackBox}>{tx.stage === 'pending' ? 'RECOVERING' : 'RECOVER FLIGHT RECORD'} <b>DECLASSIFY ↗</b></button></div>}</div></main><aside className="intel-column"><div className="section-code"><span>PRIVATE INTEL</span><b>OWNER ONLY</b></div><div className="intel-feed-v2">{role ? <article className={`intel-report ${role === 'SABOTEUR' ? 'hostile' : 'role'}`}><header><span>01</span><b>{role}</b></header><p>{objectiveLabel(objectiveCode ?? 0)}</p></article> : <div className="empty-feed">PERSONNEL FILE SEALED</div>}</div><div className="section-code public"><span>SHIP FEED</span><b>PUBLIC</b></div><div className="ship-feed-v2">{SYSTEM_NAMES.map((name, index) => <div key={name}><span>0{index + 1}</span><p>{name} / {revealIssue ? '--' : `${vesselHealth[index]}%`}</p></div>)}{publicRound?.ejected !== undefined && <div><span>05</span><p>{publicRound.ejected === 255 ? 'NO EJECTION' : `SEAT ${publicRound.ejected + 1} EJECTED`}</p></div>}</div></aside></div></section></div>;
}
