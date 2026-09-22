import type { Metadata } from "next";
import Link from "next/link";
import { operatorApi } from "@/lib/api/server-client";
import { requireOperator } from "@/lib/auth/session";
import {
  standingOf,
  type OperatorCredential,
  type Standing,
} from "@/lib/account/standing";
import { toFormValues, type BusinessDetails } from "@/lib/profile/details";
import {
  suggestedCredentialType,
  waitingOnOperator,
} from "@/lib/profile/credentials";
import { readShape } from "@/lib/account/read-shape";
import { reviewNote, reviewOf } from "@/lib/account/review";
import { getChangeRequests } from "@/lib/money/fetch";
import { Screen } from "@/components/chrome/screen";
import { ChevronRightIcon } from "@/components/ui/icons";
import { panelClass } from "@/components/ui/panel";
import { Problem } from "@/components/ui/states";
import { DetailsForm } from "./details-form";
import { CredentialForm } from "./credential-form";

export const metadata: Metadata = { title: "Business details" };
export const dynamic = "force-dynamic";

/**
 * O6 — what Yuvoy verifies, and what an operator can do about it.
 *
 * ## Why this screen was not built for a month
 *
 * The two endpoints the issue named did not exist: `GET /me` carried no
 * profile at all, and `POST /change-requests` was not a route. There was
 * nothing to render and nothing to edit, so it was left unbuilt rather than
 * built against guessed field names — "a form that posts fields the API does
 * not have fails at the one moment an operator is trusting it."
 *
 * `GET`/`PUT /profile` and `POST /credentials` landed on 5–6 September
 * (yuvoy-api#63), and the second is the one that matters: "until it existed
 * the screen named a blocker and then asked them to ring us."
 *
 * ## What this screen deliberately does NOT duplicate
 *
 * Verification shows the standing, the blockers split by who has to move
 * next, and every credential with its expiry date. This screen is the
 * *acting* half: fill the details in, send the document.
 *
 * It used to repeat the list of what is waiting on the operator, word for
 * word: "Both items then repeat word for word on Business details, so the
 * operator meets the same two sentences twice" (yuvoy-operator#88 s13, "show
 * each blocker in one place only, and link to it from the other"). So it
 * links to that list instead, with the count.
 */
export default async function ProfilePage() {
  const { token, me } = await requireOperator();
  const client = operatorApi(token);

  /*
    Both reads together, and neither is allowed to cost the other.

    The standing comes from `GET /me`, which every page in this portal already
    reads for its chrome; the details come from `/profile`. A failing profile
    read must still leave the document form usable — an operator whose account
    is blocked on an insurance certificate should be able to send it even if
    the details endpoint is having a bad minute.
  */
  const [detailsResult, meResult, changes] = await Promise.all([
    client.GET("/profile", {}).catch(() => null),
    client.GET("/me", {}).catch(() => null),
    /*
      Whether a change to the details is waiting on us (yuvoy-operator#89
      f10). Soft: `[]` on failure says nothing rather than something false.
    */
    getChangeRequests(token),
  ]);

  const standing: Standing | null =
    meResult && !meResult.error ? standingOf(meResult.data?.account) : null;

  const details: BusinessDetails | null =
    detailsResult && !detailsResult.error
      ? readShape(detailsResult.data)
      : null;
  const detailsUnavailable = !detailsResult || Boolean(detailsResult.error);
  const review = reviewNote(reviewOf(changes, "profile", details?.submittedAt));

  const credentials: OperatorCredential[] = standing?.credentials ?? [];
  const theirMove = waitingOnOperator(standing?.blocking ?? []);

  return (
    <Screen nav={{ back: { href: "/account/settings", label: "settings" } }}>
      {/* One title (op#80 t2): no eyebrow over it, no caption in the bar. */}
      <h1 className="font-display tracking-display text-4xl leading-[1.05]">
        Business details
      </h1>

      {/*
        What is waiting on THEM: counted and linked, not repeated (op#88 s13).
        Verification says each one once, with the way to it. Only the
        operator's half is counted: somebody waiting on us should not be sent
        to chase what we already hold.
      */}
      {theirMove.length > 0 ? (
        <Link
          href="/account/verification"
          className={panelClass(
            "alert",
            "ease-interaction hover:bg-paper mt-6 flex items-center justify-between gap-4 p-4 transition-colors duration-200",
          )}
        >
          <span className="text-base font-bold">
            {theirMove.length === 1
              ? "1 thing waiting on you"
              : `${theirMove.length} things waiting on you`}
          </span>
          <ChevronRightIcon className="text-terra-deep size-5 shrink-0" />
        </Link>
      ) : null}

      <div className="mt-8">
        {detailsUnavailable ? (
          <Problem
            title="We could not load your details"
            body="Nothing is lost. Refresh and they should come back. You can still send us a document below."
          />
        ) : (
          <DetailsForm
            details={details}
            values={toFormValues(details)}
            canManage={me.canManage}
            review={review}
          />
        )}
      </div>

      {/*
        `#documents` is a real anchor because a blocker links to it — a
        `CREDENTIAL_MISSING` or `CREDENTIAL_EXPIRED` row on Business sends the
        operator straight to the form that clears it (yuvoy-operator#33). A
        link to a fragment that does not exist scrolls nowhere and reads as the
        portal ignoring the tap.

        `scroll-mt` so the heading is not pinned under the top of the viewport
        when the browser jumps here.
      */}
      <div id="documents" className="mt-8 scroll-mt-6">
        <CredentialForm
          suggested={suggestedCredentialType(credentials)}
          pendingTypes={credentials
            .filter((c) => c.state === "pending")
            .map((c) => c.type ?? "")
            .filter(Boolean)}
        />
      </div>

      {/*
        Where the expiry dates live. Not repeated here: Verification renders
        every credential with the date and the sixty-day warning, and two
        copies of a date an operator plans a season around is two places for
        them to disagree. It used to point at `/account`, which stopped
        holding them when the profile became a profile (#58).
      */}
      <Link
        href="/account/verification"
        className={panelClass(
          "raised",
          "ease-interaction hover:bg-paper mt-10 flex items-center justify-between gap-3 px-4 py-3 transition-colors duration-200",
        )}
      >
        <span className="text-base font-bold">
          Documents we hold, and when they run out
        </span>
        <ChevronRightIcon className="text-terra-deep size-5 shrink-0" />
      </Link>
    </Screen>
  );
}
