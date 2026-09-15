import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Gone to Home — yuvoy-operator#56.
 *
 * Listings stopped being a stop on the bar: every listing this operator has is
 * on Home, in the order it needs attention, and one of them opens the hub at
 * `/today/listing/{id}`. Creating and editing moved to the business profile
 * (#58): `/account/listings/new` and `/account/listings/{id}/edit`.
 *
 * A redirect rather than a delete, because this URL is in operators' history
 * and on at least one printed handout. The form components under this folder
 * are still the live ones and are imported by the screens above.
 */
export default function ActivitiesPage() {
  redirect("/today");
}
