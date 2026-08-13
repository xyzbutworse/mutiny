import Link from "next/link";
import type { ReactNode } from "react";
import { SoundControl } from "@/components/GameAudio";

export function HullFrame({ children, active = "" }: { children: ReactNode; active?: string }) {
  return (
    <div className="hull-frame-v2">
      <aside className="hull-rail" aria-label="Mission navigation">
        <Link className="rail-mark" href="/" aria-label="MUTINY home">
          <span>BW</span><b>7</b>
        </Link>
        <div className="rail-rule" />
        <nav className="rail-nav">
          <Link className={active === "play" ? "active" : ""} href="/play"><span>01</span>BRIDGE</Link>
          <Link className={active === "onchain" ? "active" : ""} href="/onchain"><span>02</span>CHAIN</Link>
          <Link className={active === "protocol" ? "active" : ""} href="/protocol"><span>03</span>ARCHIVE</Link>
        </nav>
        <div className="rail-rule lower" />
        <SoundControl />
        <div className="rail-status">
          <i />
          <span>INCO<br />BASE</span>
        </div>
      </aside>
      <main className="hull-main">
        <div className="screen-noise" aria-hidden="true" />
        <div className="screen-vignette" aria-hidden="true" />
        {children}
      </main>
    </div>
  );
}
