import { SheetSkeleton } from "@/components/states/route-skeletons";

/*
  Home's measure is `xl` (the work and the day side by side on a desktop), so
  the fallback stands exactly where the screen lands and nothing moves when it
  arrives.
*/
export default function Loading() {
  return <SheetSkeleton width="xl" rows={4} />;
}
