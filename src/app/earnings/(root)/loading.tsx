import { SheetSkeleton } from "@/components/states/route-skeletons";

/*
  The Money tab root. In its own `(root)` group so this fallback belongs to
  the tab and not to `/earnings/{id}`, which is a settlement gone into from
  it and answers `notFound()` for one that is not on this account: a boundary
  over that would paint a screen on its way to a 404.
*/
export default function Loading() {
  return <SheetSkeleton width="md" rows={4} />;
}
