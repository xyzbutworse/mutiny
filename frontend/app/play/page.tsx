import { HullFrame } from "@/components/HullFrame";
import { SimulationGame } from "@/components/SimulationGame";

export default function PlayPage() {
  return (
    <HullFrame active="play">
      <div className="play-console">
        <div className="training-mode-banner">
          TRAINING MODE · LOCAL CREW · NO LIVE TRANSACTIONS
        </div>
        <SimulationGame />
      </div>
    </HullFrame>
  );
}
