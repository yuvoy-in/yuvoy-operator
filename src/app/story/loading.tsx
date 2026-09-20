import { FocusedSkeleton } from "@/components/states/route-skeletons";

export default function Loading() {
  return <FocusedSkeleton width="md" rows={3} />;
}
