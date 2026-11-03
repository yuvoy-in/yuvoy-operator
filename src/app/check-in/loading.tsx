import { FocusedSkeleton } from "@/components/states/route-skeletons";

export default function Loading() {
  return <FocusedSkeleton width="sm" rows={2} />;
}
