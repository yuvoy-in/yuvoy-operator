import { DoorSkeleton } from "@/components/states/route-skeletons";

// Neither claim page answers 404, so a boundary may sit above both.
export default function Loading() {
  return <DoorSkeleton />;
}
