import { FocusedSkeleton } from "@/components/states/route-skeletons";

/*
  The list of commission statements. In its own `(list)` group so this
  fallback belongs to the list and not to `/earnings/commission/{id}`, which
  answers `notFound()` for a statement that is not this business's: a boundary
  over that would stream a 200 on its way to a 404.
*/
export default function Loading() {
  return <FocusedSkeleton width="md" rows={4} />;
}
