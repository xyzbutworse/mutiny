"use client";

import { useEffect, useState } from "react";
import { readLocalValue, writeLocalValue } from "@/lib/storage";

type BriefingStage = "MANIFEST" | "LOBBY" | "DOSSIER" | "ACTION" | "DISCUSSION" | "VOTING" | "FINISHED";

const COMPLETE_KEY = "mutiny:first-operation-briefed";

const BRIEFINGS: Record<Exclude<BriefingStage, "FINISHED">, { title: string; points: string[] }> = {
  MANIFEST: {
    title: "Survive five rounds. Find the hostile directive.",
    points: [
      "Keep all three ship systems alive through extraction.",
      "Claims become public. Actual effects remain sealed until BLACK BOX.",
      "Every role has a private motive, so suspicious behavior is not proof.",
    ],
  },
  LOBBY: {
    title: "Five seats. One encrypted Saboteur.",
    points: [
      "The crew wins by keeping the ship alive for five rounds.",
      "One hostile repair secretly becomes damage.",
      "Private objectives give loyal crew reasons to conceal their intent.",
    ],
  },
  DOSSIER: {
    title: "Your directive explains your incentives.",
    points: [
      "Other crew received different private objectives.",
      "You decide what to reveal during COMMS.",
      "A strange order can serve the crew, a private objective, or sabotage.",
    ],
  },
  ACTION: {
    title: "Your order is sealed. Your claim is not.",
    points: [
      "Spend no more than three energy, including a side action.",
      "The bridge reports aggregate claims, never individual effects.",
      "Compare statements with system movement before trusting anyone.",
    ],
  },
  DISCUSSION: {
    title: "COMMS is evidence under pressure.",
    points: [
      "Ask who claimed each system and what changed afterward.",
      "Investigations are imperfect. An anomaly does not reveal motive.",
      "You choose what private evidence to disclose or withhold.",
    ],
  },
  VOTING: {
    title: "Three matching ballots remove a crew member.",
    points: [
      "Ballots stay confidential until the match ends.",
      "A correct ejection removes sabotage from later rounds.",
      "A wrong ejection removes future repair and role abilities.",
    ],
  },
};

export function FirstOperationBriefing({ stage }: { stage: BriefingStage }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const complete = readLocalValue(COMPLETE_KEY) === "true";
    if (stage === "FINISHED") {
      writeLocalValue(COMPLETE_KEY, "true");
      setVisible(false);
      return;
    }
    setVisible(!complete);
  }, [stage]);

  if (!visible || stage === "FINISHED") return null;
  const briefing = BRIEFINGS[stage];

  function dismiss() {
    writeLocalValue(COMPLETE_KEY, "true");
    setVisible(false);
  }

  return (
    <aside className="first-operation-brief" aria-label="First operation briefing">
      <div className="first-brief-register"><span>FIRST OPERATION / CONTEXT</span><button type="button" onClick={dismiss}>DISMISS BRIEFINGS</button></div>
      <div className="first-brief-body">
        <b>{briefing.title}</b>
        <ol>{briefing.points.map((point) => <li key={point}>{point}</li>)}</ol>
      </div>
    </aside>
  );
}
