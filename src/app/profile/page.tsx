import type { Metadata } from "next";
import { operatorApi } from "@/lib/api/server-client";
import { requireOperator } from "@/lib/auth/session";
import {
  standingOf,
  type OperatorCredential,
  type Standing,
} from "@/lib/account/standing";
import {
  canEdit,
  toFormValues,
  type BusinessDetails,
} from "@/lib/profile/details";
import {
  suggestedCredentialType,
  waitingOnOperator,
} from "@/lib/profile/credentials";
import { readShape } from "@/lib/account/read-shape";
import { Screen } from "@/components/chrome/screen";
import { Panel } from "@/components/ui/panel";
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
 * `/account` already shows the standing, the blockers split by who has to move
 * next, and every credential with its expiry date. That is O3 and it is right
 * where it is — the first thing an operator opens after signing in.
 *
 * This screen is the *acting* half: fill the details in, send the document.
 * The one thing repeated here is what is waiting on THEM, because a form that
 * asks for a document without saying which one is a guessing game.
 */
export default async function ProfilePage() {
  const { token } = await requireOperator();
  const client = operatorApi(token);

  /*
    Both reads together, and neither is allowed to cost the other.

    The standing comes from `GET /me`, which every page in this portal already
    reads for its chrome; the details come from `/profile`. A failing profile
    read must still leave the document form usable — an operator whose account
    is blocked on an insurance certificate should be able to send it even if
    the details endpoint is having a bad minute.
  */
  const [detailsResult, meResult] = await Promise.all([
    client.GET("/profile", {}).catch(() => null),
    client.GET("/me", {}).catch(() => null),
  ]);

  const standing: Standing | null =
    meResult && !meResult.error ? standingOf(meResult.data?.account) : null;

  const details: BusinessDetails | null =
    detailsResult && !detailsResult.error
      ? readShape(detailsResult.data)
      : null;
  const detailsUnavailable = !detailsResult || Boolean(detailsResult.error);

  const credentials: OperatorCredential[] = standing?.credentials ?? [];
  const theirMove = waitingOnOperator(standing?.blocking ?? []);

  return (
    <Screen
      nav={{ back: { href: "/account/settings", label: "settings" } }}
      stageLabel="Business details"
    >
      <p className="eyebrow text-terra-deep">Your account</p>
      <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
        Business details
      </h1>
      <p className="text-forest/70 mt-3 text-base">
        What we hold about the business, and how to send us what is missing.
      </p>

      {/*
        What is waiting on THEM, repeated from `/account` on purpose.

        `waitingOn` is "the field that stops the phone call" — and a form that
        asks for a document without naming which one turns a two-minute job
        into a guess. Only the operator's half is shown: somebody waiting on us
        should not be invited to send another copy of what we already hold.
      */}
      {theirMove.length > 0 ? (
        <section className="mt-8" aria-labelledby="waiting-on-you">
          <h2 id="waiting-on-you" className="label text-terra-deep">
            Waiting on you
          </h2>
          <ul className="mt-3 space-y-3">
            {theirMove.map((blocker, i) => (
              <li key={`${blocker.code}-${i}`}>
                <Panel tone="alert" className="p-4">
                  {/*
                    `label` verbatim. The code set is closed so a client can
                    branch on it, and `OTHER` exists "so a reason can be added
                    operationally without a contract change" — provided the
                    label is rendered for anything unrecognised. Rendering it
                    for everything is simpler and cannot go stale.
                  */}
                  <p className="text-sm font-bold">{blocker.label}</p>
                </Panel>
              </li>
            ))}
          </ul>
        </section>
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
            editable={canEdit(details)}
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
        Where the expiry dates live. Not repeated here — `/account` renders
        every credential with the date and the sixty-day warning, and two
        copies of a date an operator plans a season around is two places for
        them to disagree.
      */}
      <section className="mt-10" aria-labelledby="where-else">
        <h2 id="where-else" className="label text-forest/75">
          What we already hold
        </h2>
        <Panel className="mt-3 p-4">
          <p className="text-sm">
            Every document we have, and when it runs out, is on{" "}
            <a href="/account" className="underline underline-offset-2">
              your business
            </a>
            .
          </p>
        </Panel>
      </section>
    </Screen>
  );
}
