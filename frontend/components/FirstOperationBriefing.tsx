"use client";

import { useEffect, useState } from "react";
import { readLocalValue, writeLocalValue } from "@/lib/storage";

type BriefingStage = "MANIFEST" | "LOBBY" | "DOSSIER" | "ACTION" | "DISCUSSION" | "VOTING" | "FINISHED";

const COMPLETE_KEY = "mutiny:first-operation-briefed";

const BRIEFINGS: Record<Exclude<BriefingStage, "FINISHED">, { title: string; detail: string }> = {
  MANIFEST: {
    title: "Keep the ship alive for five rounds.",
    detail: "One crewmate is secretly causing damage.",
  },
  LOBBY: {
    title: "Five seats. One Saboteur.",
    detail: "Fill empty seats with bots, then start.",
  },
  DOSSIER: {
    title: "This is your secret.",
    detail: "Play your role. Share only what helps you.",
  },
  ACTION: {
    title: "Spend 3 power. Keep your split secret.",
    detail: "The crew sees your claim, not your true effect.",
  },
  DISCUSSION: {
    title: "Talk. Compare claims. Pick a suspect.",
    detail: "A strange move is suspicious, not proof.",
  },
  VOTING: {
    title: "Three votes send someone out.",
    detail: "Choose carefully. Votes stay secret.",
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
        <p>{briefing.detail}</p>
      </div>
    </aside>
  );
}
