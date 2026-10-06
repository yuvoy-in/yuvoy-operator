import { DoorSkeleton } from "@/components/states/route-skeletons";

export default function Loading() {
  // Sign up is the one door drawn on the screen's default sheet, not the
  // narrow one the other two use.
  return <DoorSkeleton width="md" />;
}
