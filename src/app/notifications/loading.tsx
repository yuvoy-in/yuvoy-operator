import { FocusedSkeleton } from "@/components/states/route-skeletons";

/*
  A screen gone into, so the fallback wears the focused chassis: the back
  control's place held, the inbox, and no bar. It drew the tab root's before,
  which put a floating bar over a sheet that had no room reserved for one.
*/
export default function Loading() {
  return <FocusedSkeleton width="md" rows={3} />;
}
