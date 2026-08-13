"use client";

import Link from "next/link";

export default function OperationError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="route-failure route-crash" role="alert">
      <span>BLACKWATER–7 / COMMAND PROCESS INTERRUPTED</span>
      <h1>UPLINK<br />FRACTURED.</h1>
      <p>The bridge preserved your stored operation code. Reopen this compartment before abandoning the operation.</p>
      <nav>
        <button type="button" onClick={reset}>RETRY COMPARTMENT</button>
        <Link href="/onchain">RETURN TO LIVE BRIDGE</Link>
        <Link href="/play">ENTER TRAINING</Link>
      </nav>
    </main>
  );
}
