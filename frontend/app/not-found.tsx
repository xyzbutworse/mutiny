import Link from "next/link";
import { HullFrame } from "@/components/HullFrame";

export default function NotFound() {
  return (
    <HullFrame>
      <main className="route-failure">
        <span>BLACKWATER–7 / NAVIGATION FAULT 404</span>
        <h1>DECK<br />NOT FOUND.</h1>
        <p>The requested compartment does not exist in the vessel plan. No operation data was changed.</p>
        <nav>
          <Link href="/">RETURN TO UPLINK</Link>
          <Link href="/onchain">OPEN LIVE BRIDGE</Link>
          <Link href="/play">ENTER TRAINING</Link>
        </nav>
      </main>
    </HullFrame>
  );
}
