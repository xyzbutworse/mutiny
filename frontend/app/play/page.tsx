import { HullFrame } from "@/components/HullFrame";
import { SimulationGame } from "@/components/SimulationGame";

export default function PlayPage() {
  return (
    <HullFrame active="play">
      <div className="training-mode-banner">
        TRAINING SIMULATION · LOCAL CREW LOGIC · NO LIVE WALLETS OR BASE SEPOLIA ACTIONS
      </div>
      <SimulationGame />
    </HullFrame>
  );
}
