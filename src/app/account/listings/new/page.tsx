import type { Metadata } from "next";
import { requireOperator } from "@/lib/auth/session";
import { operatorApi } from "@/lib/api/server-client";
import {
  categoryChoices,
  destinationChoices,
  marketName,
} from "@/lib/services/vocabulary";
import { Screen } from "@/components/chrome/screen";
import { Problem } from "@/components/ui/states";
import { NewListingForm } from "@/components/listings/new-listing-form";

export const metadata: Metadata = { title: "Add a listing" };
export const dynamic = "force-dynamic";

/**
 * Add a listing, from the + on the business profile — yuvoy-operator#58.
 *
 * ## What this is, and what it is not
 *
 * It is the existing create form on a focused screen of its own, reachable from
 * where an operator now goes to add things. It is NOT the seven-step builder
 * item 7 describes: one draft saved step by step, with Basics, Selling,
 * Schedule, Location and safety, Questions, Media and Review. That is a
 * separate piece of work and is not built.
 *
 * The capability is here either way — a listing can be created, edited and sent
 * for review without touching the old Listings pages — and the wizard is a
 * better shape for the same act rather than a different act.
 */
export default async function NewListingPage() {
  const { token, me } = await requireOperator();

  if (!me.canManage || me.suspension) {
    return (
      <Screen
        nav={{ back: { href: "/account", label: "your business" } }}
        stageLabel="Add a listing"
      >
        <h1 className="font-display tracking-display text-3xl leading-tight">
          Add a listing
        </h1>
        <div className="mt-6">
          <Problem
            title="Only owners, admins and managers can add a listing"
            body="A staff login runs the day. Ask an owner, an admin or a manager."
          />
        </div>
      </Screen>
    );
  }

  const vocabulary = await operatorApi(token)
    .GET("/catalog/vocabulary", {})
    .then((r) => (r.error ? null : r.data))
    .catch(() => null);

  const categories = categoryChoices(vocabulary);
  const destinations = destinationChoices(vocabulary);

  return (
    <Screen
      nav={{ back: { href: "/account", label: "your business" } }}
      stageLabel="Add a listing"
    >
      <h1 className="font-display tracking-display text-4xl leading-[1.05]">
        Add a listing
      </h1>

      {categories.length === 0 ? (
        /*
          The vocabulary decides what a listing may be, and a form with an empty
          category picker cannot produce one the API will take. Said rather than
          drawn: an operator filling in six fields and meeting a 400 on the
          first has lost more than the round trip.
        */
        <div className="mt-6">
          <Problem
            title="We could not load what a listing can be"
            body="Nothing is lost. Reload the page and try again."
          />
        </div>
      ) : (
        <div className="mt-6">
          <NewListingForm
            categories={categories}
            vocabulary={vocabulary}
            destinations={destinations}
            market={marketName(vocabulary)}
            commissionRateBps={me.commissionRateBps}
            startOpen
          />
        </div>
      )}
    </Screen>
  );
}
