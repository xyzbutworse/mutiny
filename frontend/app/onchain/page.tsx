import { HullFrame } from "@/components/HullFrame";
import { OnchainOps } from "@/components/OnchainOps";

export default function OnchainPage() {
  return (
    <HullFrame active="onchain">
      <OnchainOps />
    </HullFrame>
  );
}
