"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useGameAudio } from "@/components/GameAudio";
import { SYSTEM_NAMES, type Role, type SideAction } from "@/lib/game";

export type ArchiveTriple = [number, number, number];

export type ArchivePlayer = {
  seat: number;
  callsign: string;
  role: Role;
  objective: string;
};

export type ArchiveActor = ArchivePlayer & {
  claimed: ArchiveTriple;
  actual: ArchiveTriple;
  sideAction: SideAction;
  target: number;
  anomalous: boolean;
  ballot: number;
  investigation?: string;
  specialEffect?: string;
  beneficiary?: "CREW" | "SABOTEUR" | "SELF";
};

export type ArchiveRound = {
  round: number;
  before: ArchiveTriple;
  trueHealth: ArchiveTriple;
  reportedHealth: ArchiveTriple;
  claimedTotals: ArchiveTriple;
  sabotage: ArchiveTriple;
  telemetry: [boolean, boolean, boolean];
  actors: ArchiveActor[];
  ejected: number | null;
};

export type BlackBoxEvidence = {
  winner: "CREW" | "SABOTEUR";
  target: string;
  finalCondition: string;
  proofLabel: string;
  players: ArchivePlayer[];
  rounds: ArchiveRound[];
};

type BlackBoxArchiveProps = {
  evidence: BlackBoxEvidence;
  onRestart?: () => void;
};

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function ballotLabel(ballot: number, players: ArchivePlayer[]) {
  if (ballot === 5) return "RETAIN CREW";
  return players.find((player) => player.seat === ballot)?.callsign ?? `SEAT ${ballot + 1}`;
}

function actionTarget(actor: ArchiveActor, players: ArchivePlayer[]) {
  if (actor.sideAction === "NONE") return "No secondary protocol";
  if (actor.sideAction === "INVESTIGATE" || actor.role === "MEDIC") {
    const target = players.find((player) => player.seat === actor.target);
    return `${actor.sideAction === "INVESTIGATE" ? "Investigated" : "Protected"} ${target?.callsign ?? `seat ${actor.target + 1}`}`;
  }
  if (actor.role === "SMUGGLER" || actor.role === "QUARTERMASTER") return actor.specialEffect ?? "Role protocol executed";
  return `${actor.specialEffect ?? "Role protocol"} / ${SYSTEM_NAMES[actor.target % 3]}`;
}

function systemName(index: number) {
  return SYSTEM_NAMES[index] ?? "SYSTEM";
}

export function BlackBoxArchive({ evidence, onRestart }: BlackBoxArchiveProps) {
  const { play } = useGameAudio();
  const [roundIndex, setRoundIndex] = useState(0);
  const [selectedSeat, setSelectedSeat] = useState(evidence.players[0]?.seat ?? 0);
  const soundedRound = useRef(0);
  const round = evidence.rounds[Math.min(roundIndex, Math.max(0, evidence.rounds.length - 1))];

  useEffect(() => {
    if (soundedRound.current === roundIndex) return;
    soundedRound.current = roundIndex;
    play(evidence.rounds[roundIndex]?.telemetry.some(Boolean) ? "corruption" : "relay");
  }, [evidence.rounds, play, roundIndex]);

  const deceptionMoments = useMemo(() => {
    if (!round) return [];
    const moments: Array<{
      key: string;
      kind: "ORDER" | "TELEMETRY";
      system: number;
      claimed: number;
      actual: number;
      actor?: ArchiveActor;
      beneficiary: string;
    }> = [];
    round.actors.forEach((actor) => {
      actor.actual.forEach((actual, system) => {
        if (actual < 0 && actor.claimed[system] > 0) {
          moments.push({
            key: `actor-${actor.seat}-${system}`,
            kind: "ORDER",
            system,
            claimed: actor.claimed[system],
            actual,
            actor,
            beneficiary: "SABOTEUR",
          });
        }
      });
    });
    round.telemetry.forEach((poisoned, system) => {
      if (poisoned || round.reportedHealth[system] !== round.trueHealth[system]) {
        moments.push({
          key: `telemetry-${system}`,
          kind: "TELEMETRY",
          system,
          claimed: round.reportedHealth[system],
          actual: round.trueHealth[system],
          beneficiary: "SABOTEUR",
        });
      }
    });
    return moments;
  }, [round]);

  if (!round) return null;

  const selectedPlayer = evidence.players.find((player) => player.seat === selectedSeat) ?? evidence.players[0];
  const selectedActor = round.actors.find((actor) => actor.seat === selectedPlayer?.seat);
  const ejectedPlayer = round.ejected === null ? null : evidence.players.find((player) => player.seat === round.ejected);
  const ejectionBeneficiary = ejectedPlayer?.role === "SABOTEUR" ? "CREW" : ejectedPlayer ? "SABOTEUR" : null;
  const falseDelta = round.reportedHealth.map((reported, system) => reported - round.trueHealth[system]) as ArchiveTriple;
  const nextRound = evidence.rounds[roundIndex + 1];
  const ballotCounts = round.actors.reduce<number[]>((counts, actor) => {
    counts[actor.ballot] = (counts[actor.ballot] ?? 0) + 1;
    return counts;
  }, [0, 0, 0, 0, 0, 0]);
  const leadingBallot = ballotCounts.reduce((leader, count, index) => count > ballotCounts[leader] ? index : leader, 5);
  const decisionEffect = leadingBallot === 5
    ? `${ballotCounts[5]} ballots favored retaining the crew`
    : `${ballotCounts[leadingBallot]} ballots targeted ${evidence.players[leadingBallot]?.callsign ?? `seat ${leadingBallot + 1}`}`;

  return (
    <section className={`blackbox-archive ${evidence.winner === "CREW" ? "is-crew-win" : "is-saboteur-win"}`}>
      <div className="archive-declassify" aria-hidden="true"><i /><i /><span>DECLASSIFIED</span></div>

      <header className="archive-masthead">
        <div className="archive-case-line"><span>BLACKWATER–7 / FLIGHT RECORD</span><span>{evidence.proofLabel}</span></div>
        <div className="archive-title-lockup">
          <h1>BLACK BOX<br /><em>DECLASSIFIED.</em></h1>
          <div className="archive-final-stamp">
            <span>FINAL VERDICT</span>
            <b>{evidence.winner} VICTORY</b>
            <small>{evidence.finalCondition}</small>
            {onRestart && <button type="button" className="archive-restart-top" onClick={() => { play("relay"); onRestart(); }}>PLAY AGAIN <i>↗</i></button>}
          </div>
        </div>
        <div className="archive-proof-strip">
          <div><span>SEALED ROUNDS</span><b>{evidence.rounds.length}</b></div>
          <div><span>ROLES RELEASED</span><b>{evidence.players.length} / {evidence.players.length}</b></div>
          <div><span>PRIVATE BALLOTS</span><b>{evidence.rounds.reduce((total, item) => total + item.actors.length, 0)}</b></div>
          <div><span>HOSTILE TARGET</span><b>{evidence.target}</b></div>
          <p>Encrypted roles, orders, ballots, canonical health, and private field reports stayed sealed during play. Post-match declassification makes every decision auditable.</p>
        </div>
      </header>

      <nav className="archive-scrubber" aria-label="BLACK BOX round timeline">
        <div className="archive-scrubber-heading"><span>OPERATION TIMELINE</span><b>SCRUB ROUND {String(round.round).padStart(2, "0")}</b></div>
        <div className="archive-round-track">
          {evidence.rounds.map((item, index) => {
            const hasLie = item.actors.some((actor) => actor.actual.some((value) => value < 0)) || item.telemetry.some(Boolean);
            return (
              <button
                type="button"
                key={item.round}
                className={`${index === roundIndex ? "is-current" : ""} ${hasLie ? "has-deception" : ""}`}
                aria-label={`Show round ${item.round}${hasLie ? ", deception detected" : ""}`}
                aria-pressed={index === roundIndex}
                onClick={() => setRoundIndex(index)}
              >
                <span>{String(item.round).padStart(2, "0")}</span>
                <i />
                <small>{item.ejected === null ? "NO EJECTION" : `EJECT S${item.ejected + 1}`}</small>
              </button>
            );
          })}
        </div>
        <div className="archive-range-row">
          <button type="button" disabled={roundIndex === 0} onClick={() => setRoundIndex((value) => Math.max(0, value - 1))}>PREVIOUS</button>
          <input
            type="range"
            min={1}
            max={evidence.rounds.length}
            value={roundIndex + 1}
            aria-label="Scrub operation round"
            onChange={(event) => setRoundIndex(Number(event.target.value) - 1)}
          />
          <button type="button" disabled={roundIndex === evidence.rounds.length - 1} onClick={() => setRoundIndex((value) => Math.min(evidence.rounds.length - 1, value + 1))}>NEXT</button>
        </div>
      </nav>

      <main className="archive-round-sheet" key={round.round}>
        <header className="archive-round-heading">
          <div><span>ROUND</span><b>{String(round.round).padStart(2, "0")}</b></div>
          <h2>{deceptionMoments.length ? `${deceptionMoments.length} concealed distortion${deceptionMoments.length === 1 ? "" : "s"} changed the shared picture.` : "The public record matched the canonical state."}</h2>
          <p>{ejectedPlayer ? `${ejectedPlayer.callsign} was ejected. This result benefited ${ejectionBeneficiary}.` : "The private count produced no ejection."}</p>
        </header>

        <section className="archive-health-ledger" aria-label={`Round ${round.round} canonical and reported system health`}>
          {SYSTEM_NAMES.map((system, index) => {
            const corrupted = falseDelta[index] !== 0;
            return (
              <article className={corrupted ? "is-corrupted" : "is-verified"} key={system}>
                <div className="archive-system-ident"><span>SYS / 0{index + 1}</span><b>{system}</b><small>{corrupted ? "FALSE PUBLIC READING" : "TELEMETRY VERIFIED"}</small></div>
                <div className="archive-health-pair">
                  <div><span>TRUE HEALTH</span><b>{round.trueHealth[index]}%</b><i style={{ width: `${round.trueHealth[index]}%` }} /></div>
                  <div><span>REPORTED HEALTH</span><b>{round.reportedHealth[index]}%</b><i style={{ width: `${round.reportedHealth[index]}%` }} /></div>
                </div>
                <div className="archive-health-effect">
                  <span>{corrupted ? `FALSE ${signed(falseDelta[index])} POINTS` : "NO DISTORTION"}</span>
                  <b>CLAIMED {signed(round.claimedTotals[index])}</b>
                  <b>SABOTAGE {signed(-round.sabotage[index])}</b>
                </div>
              </article>
            );
          })}
        </section>

        <section className={`archive-deception-stage ${deceptionMoments.length ? "has-evidence" : "is-clean"}`}>
          <header><span>DECEPTION RECONSTRUCTION</span><b>{deceptionMoments.length ? "PUBLIC CLAIM / CANONICAL EFFECT" : "NO MATERIAL LIE RECORDED"}</b></header>
          {deceptionMoments.length ? (
            <div className="archive-deception-list">
              {deceptionMoments.map((moment) => (
                <article key={moment.key}>
                  <div className="archive-lie-source"><span>{moment.kind === "ORDER" ? moment.actor?.callsign : "POISONED TELEMETRY"}</span><b>{systemName(moment.system)}</b></div>
                  <div className="archive-lie-comparison">
                    <div><span>{moment.kind === "ORDER" ? "CLAIMED" : "REPORTED HEALTH"}</span><b>{moment.kind === "ORDER" ? `${systemName(moment.system)} ${signed(moment.claimed)}` : `${moment.claimed}%`}</b></div>
                    <i>≠</i>
                    <div><span>{moment.kind === "ORDER" ? "ACTUAL" : "TRUE HEALTH"}</span><b>{moment.kind === "ORDER" ? `${systemName(moment.system)} ${signed(moment.actual)}` : `${moment.actual}%`}</b></div>
                  </div>
                  <div className="archive-causality">
                    <span>WHO BENEFITED / {moment.beneficiary}</span>
                    <p>{moment.kind === "ORDER"
                      ? `${moment.actor?.callsign} added ${Math.abs(moment.actual)} damage while the crew counted ${moment.claimed} repair. The public total entered the ballot discussion as trusted evidence.`
                      : `The bridge showed ${moment.claimed}% while canonical integrity was ${moment.actual}%. Crew made the round ${round.round} ballot decision with a ${Math.abs(moment.claimed - moment.actual)} point false reserve.`}</p>
                    <small>DECISION RECORD / {decisionEffect}. {ejectedPlayer ? `${ejectedPlayer.callsign} was ejected.` : "No ejection followed."} {nextRound ? `Round ${nextRound.round} opened from this state.` : `The distortion fed the final ${evidence.winner} win condition.`}</small>
                  </div>
                </article>
              ))}
            </div>
          ) : <p className="archive-clean-copy">Every displayed health value matched its encrypted canonical value. Claimed repair still differs from net health after passive decay and role effects.</p>}
        </section>

        <section className="archive-personnel">
          <header><span>DECLASSIFIED PERSONNEL</span><b>SELECT A CREW FILE</b></header>
          <div className="archive-personnel-index" role="list">
            {evidence.players.map((player) => (
              <button
                type="button"
                role="listitem"
                key={player.seat}
                className={`${player.seat === selectedSeat ? "is-selected" : ""} ${player.role === "SABOTEUR" ? "is-hostile" : ""}`}
                onClick={() => { play("dossier"); setSelectedSeat(player.seat); }}
              >
                <span>{String(player.seat + 1).padStart(2, "0")}</span><b>{player.callsign}</b><small>{player.role}</small>
              </button>
            ))}
          </div>

          {selectedPlayer && (
            <article className={`archive-personnel-file ${selectedPlayer.role === "SABOTEUR" ? "is-hostile" : ""}`}>
              <div className="archive-identity-block">
                <span>TRUE IDENTITY / SEAT {selectedPlayer.seat + 1}</span>
                <h3>{selectedPlayer.callsign}</h3>
                <b>{selectedPlayer.role}</b>
                <p>{selectedPlayer.objective}</p>
              </div>
              <div className="archive-order-block">
                <span>ROUND {round.round} / SEALED ORDER OPENED</span>
                {selectedActor ? <>
                  <div className="archive-order-triplet">
                    {SYSTEM_NAMES.map((system, index) => <div key={system}><span>{system}</span><small>CLAIMED {signed(selectedActor.claimed[index])}</small><b className={selectedActor.actual[index] < 0 ? "is-negative" : ""}>ACTUAL {signed(selectedActor.actual[index])}</b></div>)}
                  </div>
                  <dl>
                    <div><dt>SECONDARY ACTION</dt><dd>{actionTarget(selectedActor, evidence.players)}</dd></div>
                    <div><dt>PRIVATE FINDING</dt><dd>{selectedActor.investigation ?? "No private report produced"}</dd></div>
                    <div><dt>ANOMALY FLAG</dt><dd>{selectedActor.anomalous ? "DETECTED AFTER DECLASSIFICATION" : "NO ANOMALY"}</dd></div>
                    <div><dt>WHO BENEFITED</dt><dd>{selectedActor.beneficiary ?? (selectedActor.role === "SABOTEUR" ? "SABOTEUR" : "CREW")}</dd></div>
                  </dl>
                </> : <p className="archive-no-action">Ejected before this round. No order affected canonical state.</p>}
              </div>
              <div className="archive-ballot-slip">
                <span>PRIVATE BALLOT / OPENED</span>
                <b>{selectedActor ? ballotLabel(selectedActor.ballot, evidence.players) : "NO ACTIVE BALLOT"}</b>
                <small>{ejectedPlayer ? `AGGREGATE RESULT / ${ejectedPlayer.callsign} EJECTED` : "AGGREGATE RESULT / RETAIN CREW"}</small>
              </div>
            </article>
          )}
        </section>

        <section className="archive-ballot-map">
          <header><span>SEALED BALLOTS / ROUND {round.round}</span><b>PRIVATE INTENT TO PUBLIC VERDICT</b></header>
          <div>
            {round.actors.map((actor) => (
              <button type="button" key={actor.seat} onClick={() => { play("relay"); setSelectedSeat(actor.seat); }}>
                <span>{actor.callsign}</span><i>→</i><b>{ballotLabel(actor.ballot, evidence.players)}</b>
              </button>
            ))}
          </div>
          <p>{ejectedPlayer ? `${ejectedPlayer.callsign} left the ship. ${ejectionBeneficiary} gained the immediate strategic advantage.` : "No candidate reached the confidential majority threshold."}</p>
        </section>
      </main>

      <footer className="archive-footer">
        <div><span>FAIRNESS PROOF</span><p>The same encrypted handles used to resolve the match now supply this archive. No private role, order, ballot, investigation, or canonical health value entered the public record before declassification.</p></div>
        <div><span>FINAL WIN CONDITION</span><b>{evidence.winner}</b><p>{evidence.finalCondition}</p></div>
        {onRestart && <button type="button" onClick={() => { play("relay"); onRestart(); }}>RUN ANOTHER OPERATION <span>RESTART</span></button>}
      </footer>
    </section>
  );
}
