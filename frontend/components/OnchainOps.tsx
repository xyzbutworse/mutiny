'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseEventLogs, type Address, type Hex, type TransactionReceipt } from 'viem';
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
import { readLocalValue, writeLocalValue } from '@/lib/storage';

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
    const accountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? args[0] : [];
      const next = accounts[0];
      if (typeof next !== 'string') {
        setWallet(null); setAccount(null); setSeat(null); clearPrivateState(); setError('Crew identity lost. The operation code remains stored for reconnection.');
      } else {
        void restoreWallet().then((connection) => {
          if (!connection) return;
          setWallet(connection.wallet); setAccount(connection.account); setChainId(connection.chainId); clearPrivateState();
        }).catch((restoreError) => setError(operationErrorMessage(restoreError)));
      }
    };
    const chainChanged = (...args: unknown[]) => {
      const value = args[0];
      setChainId(typeof value === 'string' ? Number.parseInt(value, 16) : null);
    };
    const disconnected = () => { setWallet(null); setAccount(null); setSeat(null); clearPrivateState(); setError('Crew identity lost. Reconnect the same wallet to resume this operation.'); };
    provider.on('accountsChanged', accountsChanged);
    provider.on('chainChanged', chainChanged);
    provider.on('disconnect', disconnected);
    return () => {
      provider.removeListener?.('accountsChanged', accountsChanged);
      provider.removeListener?.('chainChanged', chainChanged);
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
      setWallet(connection.wallet); setAccount(connection.account); setChainId(connection.chainId);
      setTx({ stage: 'confirmed', label: 'Crew identity confirmed' });
      if (matchCode) await syncMatch({ code: matchCode });
    }, 'Crew identification paused');
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
    if (value > 0n) {
      const balance = await publicClient.getBalance({ address: account });
      if (balance <= value) throw new Error('Insufficient funds');
    }
    setError(''); setNotice(''); setTx({ stage: 'wallet', label: `Authorize ${label}` });
    let hash: Hex;
    switch (command.name) {
      case 'createMatch': hash = await wallet.writeContract({ address: MUTINY_ADDRESS, abi: mutinyAbi, functionName: 'createMatch' }); break;
      case 'joinMatch': hash = await wallet.writeContract({ address: MUTINY_ADDRESS, abi: mutinyAbi, functionName: 'joinMatch', args: [command.matchId] }); break;
      case 'setReady': hash = await wallet.writeContract({ address: MUTINY_ADDRESS, abi: mutinyAbi, functionName: 'setReady', args: [command.matchId, command.ready] }); break;
      case 'startMatch': hash = await wallet.writeContract({ address: MUTINY_ADDRESS, abi: mutinyAbi, functionName: 'startMatch', args: [command.matchId], value: command.value }); break;
      case 'submitOrders': hash = await wallet.writeContract({ address: MUTINY_ADDRESS, abi: mutinyAbi, functionName: 'submitOrders', args: [command.matchId, command.payload], value: command.value }); break;
      case 'resolveRound': hash = await wallet.writeContract({ address: MUTINY_ADDRESS, abi: mutinyAbi, functionName: 'resolveRound', args: [command.matchId] }); break;
      case 'sendComms': hash = await wallet.writeContract({ address: MUTINY_ADDRESS, abi: mutinyAbi, functionName: 'sendComms', args: [command.matchId, command.message] }); break;
      case 'openVote': hash = await wallet.writeContract({ address: MUTINY_ADDRESS, abi: mutinyAbi, functionName: 'openVote', args: [command.matchId] }); break;
      case 'submitVote': hash = await wallet.writeContract({ address: MUTINY_ADDRESS, abi: mutinyAbi, functionName: 'submitVote', args: [command.matchId, command.payload], value: command.value }); break;
      case 'resolveVote': hash = await wallet.writeContract({ address: MUTINY_ADDRESS, abi: mutinyAbi, functionName: 'resolveVote', args: [command.matchId] }); break;
    }
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

  if (summary?.phase === 4 && blackBox) return <BlackBoxArchive evidence={blackBox} />;

  return (
    <div className="chain-shell multiplayer-shell">
      <header className="chain-head">
        <div><div className="kicker">LIVE OPERATION · BASE SEPOLIA</div><h1>BLACKWATER<span>–7</span></h1><p>Five seats. One hostile directive. Every decision sealed.</p></div>
        <div className="chain-head-actions">
          <Link href="/play" className="training-link">TRAINING SIMULATION</Link>
          <button className="wallet-button" type="button" disabled={txBusy} onClick={connect}>{account ? short(account) : 'IDENTIFY CREW'}</button>
        </div>
        <div className="chain-vessel" aria-hidden="true"><BlackwaterShip health={vesselHealth} compact /></div>
      </header>

      {!configured && <div className="chain-warning"><b>LIVE OPERATION OFFLINE</b><span>This build has no deployed Base Sepolia operation address. Use the clearly labeled training simulation while the live bridge is configured.</span><Link href="/play">ENTER TRAINING</Link></div>}
      {account && !onBase && <div className="chain-warning network-warning"><b>WRONG SIGNAL</b><span>Your crew identity is connected on another network.</span><button disabled={txBusy} onClick={switchNetwork}>TUNE TO BASE SEPOLIA</button></div>}
      {(error || notice) && <div className={`operation-message ${error ? 'error' : 'notice'}`} role={error ? 'alert' : 'status'}><span>{error || notice}</span>{error && matchCode && !txBusy && <button type="button" onClick={() => syncMatch()}>SYNCHRONIZE BRIDGE</button>}</div>}
      {!error && syncIssue && <div className="operation-message error" role="alert"><span>{syncIssue}</span><button type="button" disabled={txBusy} onClick={() => syncMatch()}>RETRY RELAY</button></div>}
      {revealIssue && <div className="operation-message attestation" role="status"><span>{revealIssue}</span><button type="button" disabled={txBusy} onClick={() => syncMatch()}>RETRY ATTESTATION</button></div>}
      <div className={`tx-status ${tx.stage}`}><i /><span>{tx.label}</span>{tx.stage === 'pending' && <b>CONFIRMING</b>}{tx.stage === 'pending' && tx.hash && <button type="button" onClick={checkPendingTransmission}>CHECK TRANSMISSION</button>}</div>
      {!summary && <FirstOperationBriefing stage="LOBBY" />}

      {!summary ? (
        <section className="operation-entry">
          <div className="entry-panel"><span>NEW OPERATION</span><h2>Take command.</h2><p>Create a crew lobby, invite real wallets, then fill unclaimed stations with shipboard crew.</p><button className="primary" disabled={!configured || !account || !onBase || txBusy} onClick={createMatch}>CREATE OPERATION</button></div>
          <div className="entry-divider">OR</div>
          <div className="entry-panel"><span>CREW INVITATION</span><h2>Board by code.</h2><p>Paste the operation code sent by your captain.</p><input inputMode="numeric" value={matchCode} onChange={(event) => setMatchCode(event.target.value.replace(/\D/g, ''))} placeholder="OPERATION CODE" /><button disabled={!configured || !matchCode || txBusy} onClick={() => syncMatch()}>FIND OPERATION</button></div>
        </section>
      ) : (
        <>
          <section className="operation-strip">
            <div><span>OPERATION</span><b>{matchCode}</b></div><div><span>PHASE</span><b>{PHASE[summary.phase]}</b></div><div><span>ROUND</span><b>{summary.round || 'LOBBY'} / 5</b></div><div><span>CRISIS CLOCK</span><b>{deadline ? `${secondsLeft}s` : 'STANDBY'}</b></div><button onClick={copyInvite}>COPY CREW INVITE</button>
          </section>

          {summary.phase === 0 && <section className="lobby-console">
            <FirstOperationBriefing stage="LOBBY" />
            <div className="lobby-heading"><div><span>CREW MANIFEST</span><h2>Awaiting personnel.</h2></div><p>The captain launches when every human is ready. Empty stations become autonomous crew.</p></div>
            <div className="seat-grid">{Array.from({ length: 5 }, (_, index) => {
              const occupied = index < summary.humanCount; const mine = seat === index;
              return <article className={`${occupied ? 'occupied' : 'vacant'} ${mine ? 'mine' : ''}`} key={index}><span>SEAT {index + 1}</span><b>{occupied ? short(summary.players[index]) : 'OPEN STATION'}</b><small>{occupied ? ready[index] ? 'READY' : 'BOARDING' : 'BOT ON LAUNCH'}</small></article>;
            })}</div>
            <div className="lobby-actions">
              {!seated && <button className="primary" disabled={!account || !onBase || txBusy || summary.humanCount >= 5} onClick={joinMatch}>{summary.humanCount >= 5 ? 'MANIFEST SEALED' : 'CLAIM OPEN SEAT'}</button>}
              {seated && <button className={currentReady ? 'ready' : 'primary'} disabled={!onBase || txBusy} onClick={toggleReady}>{currentReady ? 'READY · STAND DOWN' : 'MARK READY'}</button>}
              {isHost && <button disabled={!allHumansReady || !onBase || txBusy} onClick={startMatch}>LAUNCH · FILL {5 - summary.humanCount} BOT SEATS</button>}
            </div>
          </section>}

          {summary.phase > 0 && <div className="multiplayer-grid">
            <aside className="crew-column"><div className="panel-title">CREW STATUS</div>{Array.from({ length: 5 }, (_, index) => <div className={`crew-status ${seat === index ? 'mine' : ''} ${ejectedSeats.includes(index) ? 'ejected' : ''}`} key={index}><span>0{index + 1}</span><b>{summary.bots[index] ? `SHIPBOARD ${index + 1}` : short(summary.players[index])}</b><small>{ejectedSeats.includes(index) ? 'EJECTED' : summary.bots[index] ? 'AUTONOMOUS' : seat === index ? 'YOU' : 'CREW'}</small></div>)}</aside>
            <main className="operation-deck">
              {!seated && <div className="spectator-card"><h2>Observation channel</h2><p>This wallet does not hold a seat in operation {matchCode}. Public telemetry and the final flight record remain visible.</p></div>}
              {seated && !role && <section className="dossier-card"><span>SEALED PERSONNEL FILE</span><h2>Your directive is waiting.</h2><p>Your wallet opens only your role and objective. No other crew identity is exposed.</p><button className="primary" disabled={!wallet || !onBase || txBusy} onClick={revealRole}>OPEN EYES-ONLY FILE</button></section>}
              {role && <section className={`dossier-card revealed ${role === 'SABOTEUR' ? 'hostile' : ''}`}><FirstOperationBriefing stage="DOSSIER" /><span>EYES ONLY · SEAT {(seat ?? 0) + 1}</span><h2>{role}</h2><p>{objectiveLabel(objectiveCode ?? 0)}</p><small>{special}</small></section>}

              {summary.phase === 1 && seated && !playerEjected && <section className="phase-card"><FirstOperationBriefing stage="ACTION" /><div className="phase-heading"><div><span>ROUND {summary.round} · ACTION</span><h2>Seal your orders.</h2></div><b>{energy} / 3 ENERGY</b></div><div className="allocation-grid">{SYSTEM_NAMES.map((name, index) => <div key={name}><span>{name}</span><button disabled={orderSubmitted || txBusy} onClick={() => { play('relay'); setOrder((current) => { const allocations = [...current.allocations] as [number, number, number]; allocations[index] = Math.max(0, allocations[index] - 1); return { ...current, allocations }; }); }}>−</button><strong>{order.allocations[index]}</strong><button disabled={orderSubmitted || txBusy} onClick={() => { play('relay'); setOrder((current) => { const allocations = [...current.allocations] as [number, number, number]; allocations[index] = Math.min(3, allocations[index] + 1); return { ...current, allocations }; }); }}>+</button></div>)}</div><div className="allocation-privacy-note"><span>PUBLIC AFTER RESOLUTION</span><b>AGGREGATE SYSTEM CLAIMS</b><span>SEALED UNTIL BLACK BOX</span><b>WHO HELPED / WHO HARMED</b></div><div className="order-settings"><label>SIDE ACTION<select disabled={orderSubmitted || txBusy} value={order.sideAction} onChange={(event) => { play('relay'); setOrder({ ...order, sideAction: event.target.value as SideAction, target: 0 }); }}><option value="NONE">FULL REPAIR ALLOCATION</option><option value="INVESTIGATE">INVESTIGATE CREW</option><option value="SPECIAL">USE ROLE ABILITY</option></select></label><label>TARGET<select disabled={orderSubmitted || txBusy || order.sideAction === 'NONE'} value={order.target} onChange={(event) => { play('relay'); setOrder({ ...order, target: Number(event.target.value) }); }}>{targetOptions.map((target) => <option value={target.value} key={target.value}>{target.label}</option>)}</select></label></div><button className="primary" disabled={orderSubmitted || energy > 3 || !onBase || txBusy} onClick={submitOrders}>{orderSubmitted ? 'ORDERS SEALED' : 'SEAL ORDERS'}</button>{canResolve && <button disabled={txBusy} onClick={resolveRound}>RESOLVE SEALED ORDERS</button>} {!canResolve && orderSubmitted && <p className="waiting-copy">{secondsLeft === 0 ? 'CRISIS CLOCK EXPIRED · SYNCHRONIZING RESOLUTION CLEARANCE' : 'Waiting for remaining crew or the crisis clock.'}</p>}</section>}

              {summary.phase === 2 && <section className="phase-card discussion-card"><FirstOperationBriefing stage="DISCUSSION" /><div className="phase-heading"><div><span>ROUND {summary.round} · DISCUSSION</span><h2>State your case.</h2></div><b>{secondsLeft}s</b></div><div className="comms-feed">{comms.length ? comms.map((line, index) => <p key={index}>{line}</p>) : <p>COMMS carrier open. No crew transmissions recorded.</p>}</div>{seated && !playerEjected && <div className="comms-compose"><input maxLength={180} value={commsDraft} onChange={(event) => setCommsDraft(event.target.value)} placeholder="Transmit to the crew" /><button disabled={!commsDraft.trim() || txBusy} onClick={sendMessage}>TRANSMIT</button></div>}<div className="phase-actions">{seated && !playerEjected && <button disabled={txBusy} onClick={revealIntel}>OPEN PRIVATE FIELD REPORT</button>}{(isHost || secondsLeft === 0) && <button className="primary" disabled={!account || !onBase || txBusy} onClick={openVote}>OPEN SEALED BALLOT</button>}</div></section>}

              {summary.phase === 3 && seated && !playerEjected && <section className="phase-card"><FirstOperationBriefing stage="VOTING" /><div className="phase-heading"><div><span>ROUND {summary.round} · BALLOT</span><h2>Choose who stays aboard.</h2></div><b>{secondsLeft}s</b></div><div className="ballot-grid">{Array.from({ length: 5 }, (_, index) => <button className={vote === index ? 'selected' : ''} disabled={voteSubmitted || txBusy || ejectedSeats.includes(index)} onClick={() => { play('relay'); setVote(index); }} key={index}><span>SEAT {index + 1}</span><b>{summary.bots[index] ? `SHIPBOARD ${index + 1}` : short(summary.players[index])}</b></button>)}<button className={vote === 5 ? 'selected' : ''} disabled={voteSubmitted || txBusy} onClick={() => { play('relay'); setVote(5); }}><span>RETAIN</span><b>NO EJECTION</b></button></div><button className="primary" disabled={voteSubmitted || !onBase || txBusy} onClick={submitVote}>{voteSubmitted ? 'BALLOT SEALED' : 'SEAL BALLOT'}</button>{canResolve && <button disabled={txBusy} onClick={resolveVote}>REVEAL CREW VERDICT</button>} {!canResolve && voteSubmitted && <p className="waiting-copy">{secondsLeft === 0 ? 'VOTING CLOCK EXPIRED · SYNCHRONIZING VERDICT CLEARANCE' : 'Waiting for remaining ballots or the voting clock.'}</p>}</section>}

              {canResolve && (!seated || playerEjected) && summary.phase === 1 && <section className="phase-card spectator-card"><h2>The sealed orders are ready.</h2><p>Any connected crew identity may advance the operation after every active order arrives or the crisis clock expires.</p><button className="primary" disabled={!account || !onBase || txBusy} onClick={resolveRound}>RESOLVE SEALED ORDERS</button></section>}
              {canResolve && (!seated || playerEjected) && summary.phase === 3 && <section className="phase-card spectator-card"><h2>The crew verdict is ready.</h2><p>Any connected crew identity may reveal the aggregate ejection result.</p><button className="primary" disabled={!account || !onBase || txBusy} onClick={resolveVote}>REVEAL CREW VERDICT</button></section>}
              {playerEjected && !canResolve && summary.phase === 1 && <section className="phase-card spectator-card"><span>EJECTION CONSEQUENCE</span><h2>Observer channel only.</h2><p>Your order channel is sealed to zero. The crisis clock releases any missing human slots for resolution in {secondsLeft}s.</p></section>}
              {playerEjected && !canResolve && summary.phase === 3 && <section className="phase-card spectator-card"><span>EJECTION CONSEQUENCE</span><h2>Ballot clearance revoked.</h2><p>Your ballot no longer counts. The voting clock releases any missing human slots in {secondsLeft}s.</p></section>}

              {summary.phase === 4 && <section className="dossier-card blackbox-card"><FirstOperationBriefing stage="FINISHED" /><span>RECOVERY COMPLETE</span><h2>BLACK BOX</h2><p>The operation has ended. Hidden roles, decisions, ballots, sabotage, private field reports, and poisoned readings are now public evidence.</p><button className="primary" disabled={txBusy} onClick={revealBlackBox}>{tx.stage === 'pending' ? 'DECLASSIFYING FLIGHT RECORD' : 'RECOVER FLIGHT RECORD'}</button></section>}
            </main>
            <aside className="telemetry-column"><div className="panel-title">PUBLIC TELEMETRY</div>{SYSTEM_NAMES.map((name, index) => <div className="system-reading" key={name}><span>{name}</span><b>{revealIssue ? '--' : `${publicRound?.health[index] ?? 55}%`}</b><i><em style={{ width: revealIssue ? '0%' : `${publicRound?.health[index] ?? 55}%` }} /></i><small>{revealIssue ? 'INCO ATTESTATION PENDING' : publicRound ? `ROUND ${publicRound.round} REPORTED` : 'INITIAL STATE'}</small></div>)}{publicRound?.ejected !== undefined && <div className="verdict-card"><span>LAST VERDICT</span><b>{publicRound.ejected === 255 ? 'NO EJECTION' : `SEAT ${publicRound.ejected + 1} EJECTED`}</b></div>}<div className="signal-card"><span>NETWORK</span><b>{syncIssue ? 'RELAY DEGRADED' : onBase ? 'BASE SEPOLIA · LIVE' : 'SIGNAL LOST'}</b><small>{syncIssue ? 'PRESERVING LAST CONFIRMED STATE' : account ? 'CREW IDENTITY ACTIVE' : 'IDENTIFY CREW TO ACT'}</small></div></aside>
          </div>}
        </>
      )}
    </div>
  );
}
