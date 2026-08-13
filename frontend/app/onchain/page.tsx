import { HullFrame } from "@/components/HullFrame";
import { OnchainOps } from "@/components/OnchainOps";

export default function OnchainPage() {
  return (
    <HullFrame active="onchain">
      <div className="play-console onchain-console">
        <div className="training-mode-banner live-mode-banner">
          LIVE OPERATION · BASE SEPOLIA · INCO LIGHTNING
        </div>
        <OnchainOps />
      </div>
    </HullFrame>
  );
}
