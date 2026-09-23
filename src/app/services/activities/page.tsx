import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Gone to the business profile, where the listings are: yuvoy-operator#96.
 *
 * This URL was the old Listings stop (#22), then a redirect to Home while Home
 * listed every listing (#56). Home is the day now, with the listings counted
 * in one line, and the listings themselves live on Business, where they are
 * made and mended (#58). So an old bookmark lands on them there.
 *
 * A redirect rather than a delete, because this URL is in operators' history
 * and on at least one printed handout.
 */
export default function ActivitiesPage() {
  redirect("/account");
}
