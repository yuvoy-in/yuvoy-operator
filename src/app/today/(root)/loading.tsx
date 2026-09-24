import { SheetSkeleton } from "@/components/states/route-skeletons";

/*
  Home's measure is the default `md`, so the fallback stands exactly where the
  screen lands and nothing moves when it arrives.
*/
export default function Loading() {
  return <SheetSkeleton width="md" rows={4} />;
}
