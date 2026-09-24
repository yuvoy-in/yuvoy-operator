import type { Metadata } from "next";
import { requireOperator } from "@/lib/auth/session";
import { operatorApi } from "@/lib/api/server-client";
import { categoryChoices, destinationChoices } from "@/lib/services/vocabulary";
import { Screen } from "@/components/chrome/screen";
import { Problem } from "@/components/ui/states";
import { Stepper } from "../steps/stepper";
import { BasicsStep } from "../steps/basics";

export const metadata: Metadata = { title: "Add a listing" };
export const dynamic = "force-dynamic";

/**
 * Where a listing starts — yuvoy-operator#58 item 7.
 *
 * The builder's first step with no draft behind it. Saving here is the only
 * moment `POST /experiences` is called, and the URL is replaced with
 * `/account/listings/{id}/edit?step=selling` the instant it answers, so
 * everything from then on is a draft being amended rather than a form being
 * filled in.
 *
 * Nothing is created before then. An operator who opens this and changes their
 * mind leaves nothing behind, which is the difference between a builder and a
 * screen that litters drafts.
 */
export default async function NewListingPage() {
  const { token, me } = await requireOperator();

  if (!me.canManage || me.suspension) {
    return (
      <Screen nav={{ back: { href: "/account", label: "your business" } }}>
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

  return (
    <Screen nav={{ back: { href: "/account", label: "your business" } }}>
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
        <>
          {/*
            The seven, with none of them reachable yet. There is no draft to
            link to, and a step list that goes nowhere is still worth drawing:
            it says how long this is before somebody starts.
          */}
          <Stepper id="" current="basics" unfinished={new Set()} />
          <BasicsStep
            id=""
            vocabulary={vocabulary}
            categories={categories}
            destinations={destinationChoices(vocabulary)}
            listing={{}}
          />
        </>
      )}
    </Screen>
  );
}
