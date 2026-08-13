"use client";

import { useEffect, useRef, useState } from "react";
import { BlackwaterShip } from "@/components/BlackwaterShip";
import { BlackBoxArchive, type BlackBoxEvidence } from "@/components/BlackBoxArchive";
import { FirstOperationBriefing } from "@/components/FirstOperationBriefing";
import { useGameAudio } from "@/components/GameAudio";
import {
  SYSTEM_NAMES,
  energyUsed,
  openVoting,
  resolveOrders,
  resolveVoting,
  roleBrief,
  startSimulation,
  type GameState,
  type Order,
  type SideAction,
} from "@/lib/game";
import { clearTrainingSession, loadTrainingSession, saveTrainingSession, type TrainingEntry } from "@/lib/training-session";

const INITIAL_ORDER: Order = { allocations: [1, 1, 1], sideAction: "NONE", target: 0 };

const CREW_PORTRAITS = ["voss", "iris", "kline", "rook", "mercer"] as const;
const CREW_QUIPS = [
  "Relax. Systems are fine.",
  "Happy to help fix things.",
  "Let's keep this ship moving.",
  "Numbers don't lie. People do.",
  "I saw nothing.",
] as const;

type EntryStage = "MANIFEST" | "DOSSIER" | "BURN" | "BRIDGE";
type TransitionKind = "ORDER" | "BALLOT" | "EJECTION";
type MechanicalTransition = { kind: TransitionKind; title: string; detail: string; danger?: boolean };

function healthClass(value: number) {
  if (value < 20) return "critical";
  if (value < 40) return "warning";
  if (value > 60) return "stable";
  return "nominal";
}

function targetLabel(action: SideAction, role: string) {
  if (action === "INVESTIGATE") return "CREW TARGET";
  if (action !== "SPECIAL") return "TARGET";
  if (role === "MEDIC") return "PROTECT CREW";
  if (role === "CAPTAIN" || role === "ENGINEER" || role === "SABOTEUR") return "SYSTEM TARGET";
  return "TARGET";
}

function tokens(value: number) {
  return Array.from({ length: 3 }, (_, i) => <i key={i} className={i < value ? "filled" : ""} />);
}

function archiveSpecial(role: string, target: number) {
  if (role === "ENGINEER") return `OVERCLOCK +2 / ${SYSTEM_NAMES[target % 3]}`;
  if (role === "QUARTERMASTER") return "SURGE +1 / ALL SYSTEMS";
  if (role === "MEDIC") return `MEDICAL LOCKOUT / SEAT ${target + 1}`;
  if (role === "SMUGGLER") return "CONTRABAND EXTRACTION / +1";
  if (role === "SABOTEUR") return `TELEMETRY POISON / ${SYSTEM_NAMES[target % 3]}`;
  if (role === "CAPTAIN") return `CAPTAIN AUDIT / ${SYSTEM_NAMES[target % 3]}`;
  return "NO ROLE PROTOCOL";
}

export function SimulationGame() {
  const { play, setAmbience } = useGameAudio();
  const [game, setGame] = useState<GameState | null>(null);
  const [entry, setEntry] = useState<EntryStage>("MANIFEST");
  const [order, setOrder] = useState<Order>(INITIAL_ORDER);
  const [selectedCrew, setSelectedCrew] = useState(0);
  const [vote, setVote] = useState(5);
  const [error, setError] = useState("");
  const [transition, setTransition] = useState<MechanicalTransition | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const transitionTimer = useRef<number | null>(null);
  const ballotDialog = useRef<HTMLDialogElement | null>(null);
  const coverBlownDialog = useRef<HTMLDialogElement | null>(null);
  const interactionLocked = useRef(false);
  const audioPhase = useRef<string | null>(null);

  function returnToBridgeTop() {
    window.requestAnimationFrame(() => window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    }));
  }

  useEffect(() => {
    const saved = loadTrainingSession();
    if (saved) {
      setGame(saved.game);
      setEntry(saved.entry);
      setOrder(saved.order);
      setSelectedCrew(saved.selectedCrew);
      setVote(saved.vote);
    } else {
      setGame(startSimulation());
    }
    setHydrated(true);
    return () => {
      if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !game) return;
    const savedEntry: TrainingEntry = entry === "MANIFEST" || entry === "DOSSIER" ? entry : "BRIDGE";
    saveTrainingSession({ game, entry: savedEntry, order, selectedCrew, vote });
  }, [entry, game, hydrated, order, selectedCrew, vote]);

  const ambienceHealth = game ? Math.min(...game.displayHealth) : 55;
  const ambiencePhase = game?.phase ?? null;

  useEffect(() => () => setAmbience(false), [setAmbience]);

  useEffect(() => {
    if (!ambiencePhase) return;
    const enteringBlackBox = ambiencePhase === "FINISHED" && audioPhase.current !== "FINISHED";
    audioPhase.current = ambiencePhase;
    if (ambiencePhase === "FINISHED") {
      setAmbience(false);
      if (enteringBlackBox) play("blackbox");
      return;
    }
    setAmbience(true, Math.max(0, Math.min(1, (55 - ambienceHealth) / 45)));
  }, [ambienceHealth, ambiencePhase, play, setAmbience]);

  const playerActive = game?.crew[game.playerSeat]?.active ?? true;
  const playerIsExposedSaboteur = Boolean(game && !playerActive && game.crew[game.playerSeat]?.role === "SABOTEUR");

  useEffect(() => {
    const dialog = ballotDialog.current;
    if (!dialog) return;
    if (game?.phase === "VOTING" && playerActive && !dialog.open) dialog.showModal();
    if ((game?.phase !== "VOTING" || !playerActive) && dialog.open) dialog.close();
  }, [game?.phase, playerActive]);

  useEffect(() => {
    const dialog = coverBlownDialog.current;
    if (!dialog) return;
    if (playerIsExposedSaboteur && !dialog.open) dialog.showModal();
    if (!playerIsExposedSaboteur && dialog.open) dialog.close();
  }, [playerIsExposedSaboteur]);

  if (!game) {
    return (
      <section className="bridge-initializing">
        <span>BLACKWATER–7 / COMMAND UPLINK</span>
        <b>INITIALIZING CONFIDENTIAL OPERATION</b>
        <i />
      </section>
    );
  }

  const player = game.crew[game.playerSeat];
  const brief = roleBrief(player.role, game.saboteurTarget);
  const used = energyUsed(order);
  const lastRecord = game.records[game.records.length - 1];
  const selected = game.crew[selectedCrew] ?? game.crew[0];
  const minimumHealth = Math.min(...game.displayHealth);
  const shipState = minimumHealth < 20 ? "critical" : minimumHealth < 40 ? "warning" : minimumHealth > 60 ? "stable" : "nominal";

  const targets = order.sideAction === "INVESTIGATE" || (order.sideAction === "SPECIAL" && player.role === "MEDIC")
    ? game.crew.map((c) => ({ value: c.seat, label: `${String(c.seat + 1).padStart(2, "0")} / ${c.callsign}` }))
    : SYSTEM_NAMES.map((name, index) => ({ value: index, label: name }));

  function adjustAllocation(index: number, delta: number) {
    if (!player.active) return;
    play("relay");
    setOrder((current) => {
      const next = [...current.allocations] as [number, number, number];
      next[index] = Math.max(0, Math.min(3, next[index] + delta));
      return { ...current, allocations: next };
    });
  }

  function chooseSideAction(sideAction: SideAction) {
    if (!player.active) return;
    play("relay");
    setOrder((current) => ({ ...current, sideAction, target: 0 }));
  }

  function sealOrders() {
    if (!game || interactionLocked.current) return;
    interactionLocked.current = true;

    try {
      setError("");
      const next = resolveOrders(game, order);
      setGame(next);
      play("seal-order");
      setTransition(player.active
        ? { kind: "ORDER", title: "ORDERS SEALED", detail: "Cipher accepted. Resolving claimed contribution against canonical effect." }
        : { kind: "ORDER", title: "CREW ORDERS RESOLVED", detail: "Observer feed received. Your ejected seat submitted no energy." });
      transitionTimer.current = window.setTimeout(() => {
        setTransition(null);
        interactionLocked.current = false;
        if (Math.min(...next.displayHealth) < 20) play("alert");
        else if (next.displayHealth.some((value, index) => value < game.displayHealth[index])) play("damage");
        else play("transmission");
        returnToBridgeTop();
      }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 30 : 950);
    } catch (e) {
      interactionLocked.current = false;
      setError(e instanceof Error ? e.message : "ORDER REJECTED");
    }
  }

  function beginVote() {
    if (!game || !player.active || interactionLocked.current) return;
    interactionLocked.current = true;
    const next = openVoting(game);
    setGame(next);
    play("relay");
    setTransition({ kind: "BALLOT", title: "CHANNEL SEALED", detail: "COMMS shuttered. Anonymous ejection protocol is opening." });
    transitionTimer.current = window.setTimeout(() => {
      setTransition(null);
      interactionLocked.current = false;
      returnToBridgeTop();
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 30 : 720);
    setVote(5);
  }

  function sealVote() {
    if (!game || !player.active || interactionLocked.current) return;
    interactionLocked.current = true;

    const next = resolveVoting(game, vote);
    setGame(next);
    const record = next.records[next.records.length - 1];
    const result = record?.ejected === null || record?.ejected === undefined
      ? { title: "NO EJECTION", detail: "The sealed count produced no valid majority." }
      : { title: `CREW ${String(record.ejected + 1).padStart(2, "0")} EJECTED`, detail: `${next.crew[record.ejected].callsign} has been removed from BLACKWATER–7.` };
    setTransition({ kind: "EJECTION", ...result, danger: record?.ejected !== null && record?.ejected !== undefined });
    play("ballot");
    if (record?.ejected !== null && record?.ejected !== undefined) play("ejection");
    transitionTimer.current = window.setTimeout(() => {
      setOrder(INITIAL_ORDER);
      setSelectedCrew(0);
      setVote(5);
      setTransition(null);
      interactionLocked.current = false;
      returnToBridgeTop();
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 30 : 1150);
  }

  function watchVote() {
    if (!game || player.active || interactionLocked.current) return;
    interactionLocked.current = true;
    const next = resolveVoting(game.phase === "DISCUSSION" ? openVoting(game) : game, 5);
    setGame(next);
    const record = next.records[next.records.length - 1];
    const result = record?.ejected === null || record?.ejected === undefined
      ? { title: "NO EJECTION", detail: "The crew reached no majority." }
      : { title: `${next.crew[record.ejected].callsign} EJECTED`, detail: "You observed the sealed result. Your ballot was not counted." };
    setTransition({ kind: "EJECTION", ...result, danger: record?.ejected !== null && record?.ejected !== undefined });
    play("ballot");
    if (record?.ejected !== null && record?.ejected !== undefined) play("ejection");
    transitionTimer.current = window.setTimeout(() => {
      setOrder(INITIAL_ORDER);
      setSelectedCrew(0);
      setVote(5);
      setTransition(null);
      interactionLocked.current = false;
      returnToBridgeTop();
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 30 : 900);
  }

  function restart() {
    if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
    interactionLocked.current = false;
    clearTrainingSession();
    setGame(startSimulation());
    setEntry("MANIFEST");
    setOrder(INITIAL_ORDER);
    setVote(5);
    setSelectedCrew(0);
    setError("");
    setTransition(null);
    play("relay");
  }

  if (entry === "MANIFEST") {
    return (
      <section className="boarding-screen">
        <div className="boarding-topline"><span>BLACKWATER–7 / CREW INTAKE</span><span>LOCAL TRAINING INSTANCE</span></div>
        <div className="boarding-copy">
          <span className="micro-kicker">BOARDING DIRECTIVE / 07-A</span>
          <h1>SEAL THE<br />MANIFEST.</h1>
          <p>Five seats are required. One is yours. Empty stations are staffed by autonomous crew logic so the operation can begin immediately.</p>
          <FirstOperationBriefing stage="MANIFEST" />
        </div>
        <div className="manifest-table">
          {game.crew.map((member) => (
            <div className="manifest-row" key={member.seat}>
              <span className="manifest-index">{String(member.seat + 1).padStart(2, "0")}</span>
              <span className="manifest-glyph">{member.callsign.slice(0, 2)}</span>
              <span className="manifest-name"><b>{member.callsign}</b><small>{member.seat === game.playerSeat ? "HUMAN OPERATOR" : "AUTONOMOUS CREW"}</small></span>
              <span className="manifest-clearance">CLEARANCE {member.seat === game.playerSeat ? "04" : "SEALED"}</span>
              <span className="manifest-status"><i /> {member.seat === game.playerSeat ? "CONNECTED" : "STANDBY"}</span>
            </div>
          ))}
        </div>
        <button type="button" className="mechanical-command" onClick={() => { play("dossier"); setEntry("DOSSIER"); }}>
          <span>SEAL MANIFEST</span><b>ENGAGE / 01</b><i>→</i>
        </button>
        <div className="boarding-foot">1 HOSTILE DIRECTIVE WILL BE ASSIGNED CONFIDENTIALLY.</div>
      </section>
    );
  }

  if (entry === "DOSSIER") {
    return (
      <section className={`dossier-stage ${player.role === "SABOTEUR" ? "hostile" : ""}`}>
        <div className="dossier-backdrop"><BlackwaterShip compact /></div>
        <div className="sealed-dossier">
          <div className="dossier-notch">EYES ONLY / CLR 04</div>
          <div className="dossier-head"><span>BLACKWATER PERSONNEL COMMAND</span><span>FILE / {String(game.playerSeat + 1).padStart(2, "0")}</span></div>
          <div className="dossier-stamp">{player.role === "SABOTEUR" ? "HOSTILE" : "CONFIDENTIAL"}</div>
          <span className="micro-kicker">IDENTITY CONFIRMED</span>
          <h1>{brief.title}</h1>
          <div className="dossier-rule" />
          <dl>
            <div><dt>LOYALTY</dt><dd>{player.role === "SABOTEUR" ? "SEALED DIRECTIVE" : "BLACKWATER–7"}</dd></div>
            <div><dt>PRIMARY DIRECTIVE</dt><dd>{brief.objective}</dd></div>
            <div><dt>PRIVATE CAPABILITY</dt><dd>{brief.special}</dd></div>
          </dl>
          <FirstOperationBriefing stage="DOSSIER" />
          <div className="dossier-warning">DO NOT DISCLOSE THIS FILE. OTHER CREW IDENTITIES REMAIN ENCRYPTED.</div>
          <button type="button" className="burn-file" onClick={() => {
            if (interactionLocked.current) return;
            interactionLocked.current = true;
            play("transmission");
            setEntry("BURN");
            transitionTimer.current = window.setTimeout(
              () => {
                setEntry("BRIDGE");
                interactionLocked.current = false;
                returnToBridgeTop();
              },
              window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 30 : 1050,
            );
          }}><span>BURN FILE</span><i /></button>
        </div>
      </section>
    );
  }

  if (entry === "BURN") {
    return (
      <section className="burn-transition" aria-live="polite">
        <div className="burn-sheet" aria-hidden="true"><i /><i /><i /></div>
        <div className="burn-transition-copy">
          <span>PERSONNEL FILE / IRREVERSIBLE</span>
          <h1>FILE<br />DESTROYED.</h1>
          <p>PRIVATE DIRECTIVE COMMITTED TO MEMORY. COMMAND DECK ACCESS OPENING.</p>
        </div>
        <div className="burn-shutter" aria-hidden="true" />
      </section>
    );
  }

  if (playerIsExposedSaboteur) {
    return (
      <section className="cover-blown-stage">
        <dialog ref={coverBlownDialog} className="cover-blown-modal" aria-labelledby="cover-blown-title" onCancel={(event) => event.preventDefault()}>
          <div className="cover-blown-register"><span>HOSTILE DIRECTIVE / EXPOSED</span><b>IDENTITY COMPROMISED</b></div>
          <div className="cover-blown-copy">
            <span>THE CREW FOUND YOU.</span>
            <h2 id="cover-blown-title">COVER<br />BLOWN.</h2>
            <p>Your sabotage ends here. Return with a new role and a new lie.</p>
          </div>
          <button type="button" onClick={restart}>PLAY AGAIN <span>NEW IDENTITY ↗</span></button>
        </dialog>
      </section>
    );
  }

  if (game.phase === "FINISHED") {
    const evidence: BlackBoxEvidence = {
      winner: game.winner ?? "CREW",
      target: SYSTEM_NAMES[game.saboteurTarget],
      finalCondition: game.winner === "SABOTEUR"
        ? `${SYSTEM_NAMES[game.saboteurTarget]} reached the hostile threshold or a ship system failed.`
        : `All ship systems survived five rounds and ${SYSTEM_NAMES[game.saboteurTarget]} stayed above the hostile threshold.`,
      proofLabel: "TRAINING ARCHIVE / LOCAL ENGINE",
      players: game.crew.map((member) => ({
        seat: member.seat,
        callsign: member.callsign,
        role: member.role,
        objective: member.objective,
      })),
      rounds: game.records.map((record, recordIndex) => ({
        round: record.round,
        before: record.before,
        trueHealth: record.trueAfter,
        reportedHealth: record.displayedAfter,
        claimedTotals: record.claimedTotals,
        sabotage: record.sabotageTotals,
        telemetry: SYSTEM_NAMES.map((_, system) => record.telemetrySystem === system) as [boolean, boolean, boolean],
        ejected: record.ejected ?? null,
        actors: record.actors.map((actor) => {
          const member = game.crew[actor.seat];
          const priorActor = recordIndex > 0
            ? game.records[recordIndex - 1].actors.find((candidate) => candidate.seat === actor.target)
            : undefined;
          const investigation = actor.sideAction === "INVESTIGATE"
            ? recordIndex === 0
              ? "No prior-round evidence existed"
              : priorActor?.anomalous
                ? `${game.crew[actor.target]?.callsign ?? `SEAT ${actor.target + 1}`} produced an anomalous encrypted trace`
                : `No anomaly found for ${game.crew[actor.target]?.callsign ?? `SEAT ${actor.target + 1}`}`
            : actor.role === "CAPTAIN" && actor.sideAction === "SPECIAL"
              ? `Canonical ${SYSTEM_NAMES[actor.target % 3]} health was ${record.trueAfter[actor.target % 3]}%`
              : undefined;
          return {
            seat: actor.seat,
            callsign: actor.callsign,
            role: actor.role,
            objective: member.objective,
            claimed: actor.claimed,
            actual: actor.actual,
            sideAction: actor.sideAction,
            target: actor.target,
            anomalous: actor.anomalous,
            ballot: record.votes?.[actor.seat] ?? 5,
            investigation,
            specialEffect: actor.sideAction === "SPECIAL" ? archiveSpecial(actor.role, actor.target) : undefined,
            beneficiary: actor.role === "SABOTEUR" ? "SABOTEUR" : actor.role === "SMUGGLER" && actor.sideAction === "SPECIAL" ? "SELF" : "CREW",
          };
        }),
      })),
    };
    return <><FirstOperationBriefing stage="FINISHED" /><BlackBoxArchive evidence={evidence} onRestart={restart} /></>;
  }

  return (
    <section className={`bridge-screen ship-${shipState}`} data-ship-state={shipState}>
      {transition && (
        <div className={`mechanical-transition is-${transition.kind.toLowerCase()} ${transition.danger ? "is-danger" : ""}`} role="status" aria-live="polite">
          <div className="transition-register"><span>BLACKWATER–7 / STATE CHANGE</span><b>{transition.kind}</b></div>
          <div className="transition-copy"><span>CONFIDENTIAL MECHANISM</span><h2>{transition.title}</h2><p>{transition.detail}</p></div>
          <div className="transition-lock" aria-hidden="true"><i /><b /></div>
        </div>
      )}
      <header className="bridge-topbar">
        <div><span>BW–7 / COMMAND DECK</span><b>OPERATION ACTIVE</b></div>
        <div className="round-indicator"><small>ROUND</small><strong>{String(game.round).padStart(2, "0")}</strong><span>/ 05</span></div>
        <div className="phase-indicator"><span>PHASE</span><b>{game.phase}</b></div>
        <div className="bridge-signal"><i /> CONFIDENTIAL LINK / LOCAL</div>
      </header>

      <div className="bridge-layout">
        <aside className="crew-manifest-v2">
          <div className="section-code"><span>CREW MANIFEST</span><b>05 LIFE SIGNS</b></div>
          <div className="crew-entries">
            {game.crew.map((member) => (
              <button type="button" key={member.seat} className={`crew-entry ${selectedCrew === member.seat ? "selected" : ""} ${!member.active ? "inactive" : ""}`} onClick={() => setSelectedCrew(member.seat)}>
                <span className="crew-number">{String(member.seat + 1).padStart(2, "0")}</span>
                <span className="crew-portrait-frame"><img src={`/crew/${CREW_PORTRAITS[member.seat]}.png`} alt="" /></span>
                <span className="crew-ident"><b>{member.callsign}</b><small>{member.seat === game.playerSeat ? "YOU / CLR 04" : "IDENTITY SEALED"}</small></span>
                <span className="trust-meter"><i style={{ width: `${Math.max(6, member.suspicion)}%` }} /></span>
                <span className="trust-number">{member.suspicion.toString().padStart(2, "0")}</span>
                <span className="crew-quips">{CREW_QUIPS[member.seat]}</span>
              </button>
            ))}
          </div>

          <div className="personnel-dossier-mini">
            <div className="dossier-mini-head"><span>PERSONNEL FILE</span><b>{String(selected.seat + 1).padStart(2, "0")}</b></div>
            <h3>{selected.callsign}</h3>
            <dl>
              <div><dt>STATUS</dt><dd>{selected.active ? "ACTIVE" : "EJECTED"}</dd></div>
              <div><dt>KNOWN ROLE</dt><dd>{selected.seat === game.playerSeat ? brief.title : "SEALED"}</dd></div>
              <div><dt>SUSPICION</dt><dd>{selected.suspicion}%</dd></div>
            </dl>
            <div className="assessment-scale"><span>TRUST</span><i><b style={{ left: `${Math.min(100, selected.suspicion)}%` }} /></i><span>HOSTILE</span></div>
          </div>
        </aside>

        <main className="bridge-core">
          <div className="ship-stage">
            <BlackwaterShip health={game.displayHealth} compact />
            <div className="crisis-banner"><span>PASSIVE SYSTEM DECAY</span><b>R −8 / L −7 / N −6</b><em>PUBLIC TELEMETRY MAY BE COMPROMISED</em></div>
          </div>

          <div className="command-deck">
            {game.phase === "ACTION" && (
              <>
                {player.active ? <FirstOperationBriefing stage="ACTION" /> : null}
                {player.active ? <>
                <div className="command-title-row">
                  <div><span className="micro-kicker">YOUR MOVE</span><h2>Choose where power goes.</h2></div>
                  <div className="energy-reserve"><span>ENERGY RESERVE</span><div>{tokens(Math.max(0, 3 - used))}</div><b>{Math.max(0, 3 - used)} REMAIN</b></div>
                </div>

                <div className="allocation-console">
                  {SYSTEM_NAMES.map((name, index) => (
                    <div className={`allocation-channel ${healthClass(game.displayHealth[index])}`} key={name}>
                      <div className="allocation-label"><span>SYS / 0{index + 1}</span><b>{name}</b></div>
                      <div className="allocation-bay" aria-hidden="true"><i /><i /><i /></div>
                      <button type="button" className="allocation-step down" aria-label={`Remove energy from ${name}`} onClick={() => adjustAllocation(index, -1)}>−</button>
                      <div className="energy-chits" aria-label={`${order.allocations[index]} energy allocated`}>{tokens(order.allocations[index])}</div>
                      <strong className="allocation-value">{order.allocations[index]}</strong>
                      <button type="button" className="allocation-step up" aria-label={`Add energy to ${name}`} onClick={() => adjustAllocation(index, 1)}>+</button>
                    </div>
                  ))}
                </div>
                <div className="allocation-privacy-note"><span>CREW SEES</span><b>YOUR CLAIM</b><span>BLACK BOX SEES</span><b>YOUR TRUE EFFECT</b></div>

                <div className="order-options">
                  <button type="button" className={order.sideAction === "NONE" ? "selected" : ""} onClick={() => chooseSideAction("NONE")}><span>00</span><b>USE ALL POWER</b><small>No side action.</small></button>
                  <button type="button" className={order.sideAction === "INVESTIGATE" ? "selected" : ""} onClick={() => chooseSideAction("INVESTIGATE")}><span>01</span><b>CHECK A CREWMATE</b><small>Costs 1 power.</small></button>
                  <button type="button" className={order.sideAction === "SPECIAL" ? "selected" : ""} onClick={() => chooseSideAction("SPECIAL")}><span>02</span><b>USE ROLE POWER</b><small>{brief.special}</small></button>
                </div>

                {order.sideAction !== "NONE" && (
                  <div className="sealed-target-row">
                    <label><span>{targetLabel(order.sideAction, player.role)}</span><select value={order.target} onChange={(e) => { play("relay"); setOrder((current) => ({ ...current, target: Number(e.target.value) })); }}>{targets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</select></label>
                    <div><span>VISIBILITY</span><b>OWNER ONLY</b></div>
                  </div>
                )}

                {error && <div className="bridge-warning">{error}</div>}
                {!player.active && <div className="bridge-warning">YOU WERE EJECTED. ORDERS ARE LOCKED TO ZERO. OBSERVER MODE ENABLED.</div>}
                <button className="seal-lever" type="button" disabled={used > 3} onClick={sealOrders}>
                  <span className="lever-track"><i /></span>
                  <span className="lever-copy"><small>{player.active ? "PRIVATE ORDER" : "OBSERVER"}</small><b>{player.active ? "SEAL ORDER" : "RESOLVE ROUND"}</b></span>
                  <span className="lever-code">EXEC / 0{game.round}</span>
                </button>
                </> : (
                  <div className="observer-console">
                    <span>CREW STATUS / EJECTED</span>
                    <h2>You are off the ship.</h2>
                    <p>No power. No role ability. No vote. You can watch the operation unfold.</p>
                    <button type="button" onClick={sealOrders}>WATCH CREW ORDERS <b>ROUND {String(game.round).padStart(2, "0")} ↗</b></button>
                  </div>
                )}
              </>
            )}

            {game.phase === "DISCUSSION" && (
              <div className="comms-phase">
                <FirstOperationBriefing stage="DISCUSSION" />
                <div className="comms-heading"><span>COMMS OPEN</span><b>WHO LIED?</b></div>
                <p>Compare claims with what happened to the ship.</p>
                <div className="comms-prompts">
                  <blockquote>“Who covered Life Support?”</blockquote>
                  <blockquote>“Why did Reactor drop?”</blockquote>
                  <blockquote>“Show us your evidence.”</blockquote>
                </div>
                {player.active
                  ? <button type="button" className="open-ballot" onClick={beginVote}>VOTE WHO LEAVES <span>→</span></button>
                  : <button type="button" className="open-ballot observer-vote" onClick={watchVote}>WATCH CREW VOTE <span>→</span></button>}
              </div>
            )}

            {game.phase === "VOTING" && player.active && (
              <dialog ref={ballotDialog} className="ballot-modal" aria-labelledby="ballot-title" onCancel={(event) => event.preventDefault()}>
                <div className="ballot-phase">
                <FirstOperationBriefing stage="VOTING" />
                <div className="ballot-heading"><span>SECRET VOTE</span><h2 id="ballot-title">Who leaves?</h2><p>Three matching votes eject. Nobody sees your choice.</p></div>
                <div className="ballot-crew">
                  {game.crew.filter((c) => c.active && c.seat !== game.playerSeat).map((member) => (
                    <button type="button" key={member.seat} className={vote === member.seat ? "selected" : ""} onClick={() => { play("relay"); setVote(member.seat); }}>
                      <span className="ballot-portrait"><img src={`/crew/${CREW_PORTRAITS[member.seat]}.png`} alt="" /></span><b>{member.callsign}</b><small>SUSPICION / {member.suspicion}%</small><i />
                    </button>
                  ))}
                  <button type="button" className={`retain ${vote === 5 ? "selected" : ""}`} onClick={() => { play("relay"); setVote(5); }}><span>00</span><b>KEEP EVERYONE</b><small>SKIP EJECTION</small><i /></button>
                </div>
                <button className="seal-ballot" type="button" onClick={sealVote}>SEAL EJECTION BALLOT <span>→</span></button>
                </div>
              </dialog>
            )}
            {game.phase === "VOTING" && !player.active && (
              <div className="observer-console voting-observer">
                <span>BALLOT STATUS / LOCKED</span>
                <h2>Your vote no longer counts.</h2>
                <p>The remaining crew will decide who leaves.</p>
                <button type="button" onClick={watchVote}>WATCH VOTE RESULT <b>SEALED COUNT ↗</b></button>
              </div>
            )}
          </div>
        </main>

        <aside className="intel-column">
          <div className="section-code"><span>PRIVATE INTEL</span><b>OWNER ONLY</b></div>
          <div className="intel-feed-v2">
            {game.intel.length === 0 && <div className="empty-feed">NO PRIVATE REPORTS</div>}
            {game.intel.map((item, i) => (
              <article className={`intel-report ${item.type.toLowerCase()}`} key={`${item.type}-${i}`}>
                <header><span>{String(i + 1).padStart(2, "0")}</span><b>{item.type}</b></header>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
          <div className="section-code public"><span>SHIP FEED</span><b>PUBLIC</b></div>
          <div className="ship-feed-v2">
            {game.feed.map((line, i) => <div key={`${line}-${i}`}><span>{String(game.feed.length - i).padStart(2, "0")}</span><p>{line}</p></div>)}
          </div>
        </aside>
      </div>
    </section>
  );
}
