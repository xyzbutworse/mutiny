"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BlackwaterShip } from "@/components/BlackwaterShip";

const BOOT = [
  "BLACKWATER SYSTEMS / LONG-RANGE VESSEL 07",
  "ESTABLISHING SECURE UPLINK...",
  "CREW MANIFEST: CORRUPTED",
  "5 LIFE SIGNS DETECTED",
  "1 HOSTILE DIRECTIVE DETECTED",
];

export function LandingExperience() {
  const [bootLine, setBootLine] = useState(0);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const timers = BOOT.map((_, index) => window.setTimeout(() => setBootLine(index + 1), 280 + index * 360));
    const enterTimer = window.setTimeout(() => setEntered(true), 2300);
    return () => {
      timers.forEach(window.clearTimeout);
      window.clearTimeout(enterTimer);
    };
  }, []);

  return (
    <div className={`landing-v2 ${entered ? "is-ready" : ""}`}>
      <div className={`boot-sequence ${entered ? "is-gone" : ""}`} aria-hidden={entered}>
        <div className="boot-crosshair">+</div>
        <div className="boot-register"><span>SECURE LINK / CHANNEL 07</span><b>{String(bootLine).padStart(2, "0")} / 05</b></div>
        <div className="boot-copy">
          {BOOT.map((line, i) => (
            <div key={line} className={i < bootLine ? "shown" : ""}>
              <span>{String(i + 1).padStart(2, "0")}</span>{line}
            </div>
          ))}
        </div>
        <div className="boot-progress"><i style={{ transform: `scaleX(${bootLine / BOOT.length})` }} /></div>
        <button type="button" className="boot-skip" onClick={() => setEntered(true)}>SKIP UPLINK</button>
      </div>

      <section className="landing-stage">
        <div className="landing-meta top-left">BW–7 / COMMAND UPLINK</div>
        <div className="landing-meta top-right"><span className="signal-dot" /> CONFIDENTIAL SIGNAL / INCO × BASE</div>

        <div className="landing-headline-wrap">
          <div className="headline-index">EMERGENCY PROTOCOL / 04</div>
          <h1 className="landing-headline">
            <span>EVERYONE</span>
            <span>HAS SOMETHING</span>
            <span className="headline-em">TO HIDE.</span>
          </h1>
          <p className="landing-thesis">
            Five crew members. Three failing systems. Every order is sealed. One person is quietly turning survival into sabotage.
          </p>
        </div>

        <div className="landing-vessel-wrap">
          <BlackwaterShip />
        </div>

        <div className="landing-actions-v2">
          <Link href="/play" className="board-command">
            <span className="command-index">01</span>
            <span className="command-copy"><b>BOARD BLACKWATER–7</b><small>ENTER TRAINING OPERATION</small></span>
            <span className="command-arrow">↗</span>
          </Link>
          <Link href="/onchain" className="quiet-command">ONCHAIN OPERATION ↗</Link>
          <Link href="/protocol" className="quiet-command">OPEN OPERATIONS MANUAL ↗</Link>
        </div>

        <div className="landing-classified">THE CHAIN RECORDS EVERYTHING. IT DOES NOT TELL YOU ENOUGH TO CHEAT.</div>
      </section>

      <section className="doctrine-grid" aria-label="How Mutiny works">
        {[
          ["01", "ALLOCATE", "Commit three units of power across a ship that is already failing. Individual orders remain sealed."],
          ["02", "DECEIVE", "A hostile repair can become encrypted damage while the public board reports something else."],
          ["03", "ACCUSE", "Interrogate imperfect evidence, argue over comms, then cast a ballot nobody can inspect."],
          ["04", "DECLASSIFY", "At extraction, BLACK BOX reconstructs every hidden role, lie, vote and poisoned reading."],
        ].map(([n, title, copy]) => (
          <article key={n}>
            <span>{n}</span>
            <h2>{title}</h2>
            <p>{copy}</p>
          </article>
        ))}
      </section>

      <section className="landing-endcap">
        <div className="endcap-label">CONFIDENTIAL SOCIAL STRATEGY / INCO LIGHTNING × BASE</div>
        <h2>THE SHIP ONLY<br />NEEDS ONE LIAR.</h2>
        <Link href="/play">BEGIN OPERATION <span>→</span></Link>
      </section>
    </div>
  );
}
