import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { operatorApi } from "@/lib/api/server-client";
import { classifyMeFailure } from "@/lib/account/status";
import {
  blockerAction,
  blockerText,
  byDocumentType,
  byGatingFirst,
  gatesSale,
  credentialText,
  headline,
  stateLabel,
  documentAction,
  expirySentences,
  splitByWaitingOn,
  standingOf,
  verifiedWithoutFile,
  type Standing,
} from "@/lib/account/standing";
import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "@/lib/site/contact";
import {
  blockerFor,
  documentCount,
  fileLine,
  takesFile,
} from "@/lib/account/documents";
import { credentialTypeLabel } from "@/lib/profile/credentials";
import { marketDateLabel, now } from "@/lib/format/market-time";
import { readSessionToken, SIGN_IN_PATH } from "@/lib/auth/session";
import { Screen } from "@/components/chrome/screen";
import { ButtonLink } from "@/components/ui/button";
import { Panel, panelClass } from "@/components/ui/panel";
import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/cn";
import { SendDocument } from "@/app/account/send-document";

export const metadata: Metadata = { title: "Verification" };
export const dynamic = "force-dynamic";

/**
 * What is outstanding, and every document we hold — yuvoy-operator#58 item 10.
 *
 * Moved here from the Business tab UNCHANGED, which is the point: the profile
 * became a profile (#58 item 2) and this is what came off it. Everything that
 * links to "what is outstanding" now links here — Home's account strip, the
 * profile's own strip, and a `not_selling` listing.
 *
 * The two components below are the ones that were on `/account`, reading
 * `GET /me` as they did there. Nothing about what they say has changed.
 */
export default async function VerificationPage() {
  const token = await readSessionToken();
  if (!token) redirect(SIGN_IN_PATH);

  const result = await operatorApi(token)
    .GET("/me", {})
    .catch(() => null);

  /*
    A `GET /me` that fails is not an account state. The same classification the
    Business screen applies, so the two cannot disagree about whether an
    operator is offboarded or the server simply had a bad minute.
  */
  const failure = classifyMeFailure(result?.error);
  if (failure === "signed-out") redirect(SIGN_IN_PATH);

  /*
    Two ways to have no standing, and they are not the same sentence. A read
    that failed can be retried; a 200 with no `account` block cannot, and the
    contract is explicit about what it means: "Absent means unknown — never
    'everything is fine'." Both refuse to say anybody is fine.
  */
  const unreadable = !result || Boolean(result.error);
  const standing: Standing | null = unreadable
    ? null
    : standingOf(result.data?.account);
  const at = await now();

  return (
    <Screen
      nav={{ back: { href: "/account/settings", label: "settings" } }}
      stageLabel="Verification"
    >
      <p className="eyebrow text-terra-deep">Your account</p>
      <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
        Verification
      </h1>

      {/*
        WHERE THEY STAND, ONCE — yuvoy-operator#33 §3, moved here with the list
        it belongs to (#58 item 10). The profile is headed by the business now,
        and this is the screen that answers whether it can be booked, so the
        sentence travels with the outstanding items rather than being said on a
        screen that no longer shows them.

        "Your account is live" and a LIVE chip say the same thing twice, but
        "You cannot be booked yet" and a `Prospect` chip do NOT: one is a state
        name and the other is what it means. So the chip and this sentence stay
        together as one status block.
      */}
      <p className="mt-4 text-lg font-bold">
        {standing
          ? headline(standing).title
          : "We cannot tell you where you stand"}
      </p>
      <p className="text-forest/70 mt-2 text-base">
        {standing
          ? headline(standing).body
          : unreadable
            ? "This portal could not read your account's standing just now. It does not mean anything is wrong, but it does mean we should not tell you that nothing is. Reload the page and it should come back."
            : "This portal could not read your account's standing just now. It does not mean anything is wrong, but it does mean we should not tell you that nothing is."}
      </p>

      {/*
        `state` is DISPLAYED, never branched on. It is a bare string in the
        contract with no enum, and its values already disagree with the examples
        beside them: the schema shows ONBOARDING/LIVE/PAUSED while the API's own
        worked example returns PROSPECT. `bookable` is what every sentence above
        and below is derived from.
      */}
      {standing?.state ? (
        <Chip
          className={cn(
            "label mt-4",
            standing.bookable
              ? "bg-forest text-paper"
              : "border-terra-deep text-terra-deep border bg-transparent",
          )}
        >
          {stateLabel(standing.state)}
        </Chip>
      ) : null}

      {/*
        And out of the way. An operator who can sell came here to check one
        thing; the way back to the day is on the screen rather than two taps up
        through settings.
      */}
      {standing?.bookable ? (
        <ButtonLink href="/today" className="mt-6">
          Go to today
        </ButtonLink>
      ) : null}

      {standing === null ? null : (
        <>
          <Outstanding standing={standing} />
          <Credentials standing={standing} at={at} />
        </>
      )}
    </Screen>
  );
}

function Outstanding({ standing }: { standing: Standing }) {
  /*
    Sorted before it is split, so the thing that is costing money is the first
    row an operator meets in each section — yuvoy-operator#38. `gates` is the
    field that tells them apart, and a row that will not say which it is sits
    between the two rather than being sorted as though it were harmless.
  */
  const { operator, yuvoy } = splitByWaitingOn(
    byGatingFirst(standing.blocking),
  );

  return (
    <div className="mt-8 space-y-6">
      {operator.length > 0 ? (
        <section aria-labelledby="waiting-on-you">
          <h2 id="waiting-on-you" className="label text-terra-deep">
            Waiting on you
          </h2>
          <ul className="mt-3 space-y-3">
            {operator.map((b, i) => {
              /*
                THE WAY OUT OF THE BLOCKER — yuvoy-operator#33.

                This screen listed everything stopping a business from selling
                and gave no way to fix any of it. Every line was a sentence
                with no button, so the only route forward was to ring us and
                have somebody do it from the admin console — the concierge
                path the self-serve portal exists to remove.

                `null` for a code we do not recognise, deliberately. A link to
                the wrong screen is worse than no link, and `OTHER` exists so a
                reason can be added operationally without a contract change.
              */
              const action = blockerAction(b);
              return (
                <li
                  key={`${b.code}-${i}`}
                  /*
                    Alert tone is for what is costing money. A logo that stops
                    no sale sitting in the same red panel as a lapsed licence
                    is how a screen teaches an operator to ignore all of it —
                    so an item that says it does not gate is drawn quietly.
                    Unknown keeps the loud panel: it is the safer guess when
                    the row will not say.
                  */
                  className={panelClass(
                    gatesSale(b) === false ? undefined : "alert",
                  )}
                >
                  <p className="text-base font-bold">{blockerText(b)}</p>
                  {/*
                    WHETHER IT IS COSTING THEM ANYTHING — yuvoy-operator#38.

                    A missing logo and an unfinished registered address are
                    real asks that stop no sale; paperwork and operator status
                    do. Saying which is the difference between an operator who
                    clears this at the weekend and one who thinks their
                    business is shut. Only `gates: false` earns a marker: the
                    gating case is already the loudest thing on the screen,
                    and a row that does not carry the field gets no claim in
                    either direction.
                  */}
                  {gatesSale(b) === false ? (
                    <p className="label text-forest/70 mt-1.5">
                      Not stopping sales
                    </p>
                  ) : null}
                  {b.since ? (
                    <p className="text-forest/70 mt-2 text-sm">
                      Outstanding since {marketDateLabel(b.since.slice(0, 10))}.
                    </p>
                  ) : null}
                  {action ? (
                    <ButtonLink
                      href={action.href}
                      variant="secondary"
                      className="mt-4"
                    >
                      {action.label}
                    </ButtonLink>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {/*
            "There is no upload on this screen yet" was here, and it stopped
            being true: `/profile` sends business details and documents, and
            `/logo` sends the logo. What is left to say is the thing the links
            above cannot — that a person reads each one.
          */}
          <p className="text-forest/70 mt-3 text-sm">
            A person at Yuvoy checks each of these. If one was turned down and
            you do not know why, ring us. We cannot show you the reason here
            yet.
          </p>
        </section>
      ) : null}

      {yuvoy.length > 0 ? (
        <section aria-labelledby="waiting-on-us">
          <h2 id="waiting-on-us" className="label text-forest/75">
            With Yuvoy
          </h2>
          <ul className="mt-3 space-y-3">
            {yuvoy.map((b, i) => (
              <li key={`${b.code}-${i}`} className={panelClass()}>
                <p className="text-base font-bold">{blockerText(b)}</p>
                <p className="text-forest/70 mt-2 text-sm">
                  {/*
                    Both halves are true and the second one changes what an
                    operator does with their morning: something of ours that
                    is holding a listing back is worth a phone call, and
                    something that is not can simply be waited on.
                  */}
                  {gatesSale(b) === true
                    ? "Nothing for you to do, but this is holding a listing back. We will tell you when it moves."
                    : "Nothing for you to do. We will tell you when it moves."}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** Every document Yuvoy holds or is waiting for, and when it runs out. */
function Credentials({ standing, at }: { standing: Standing; at: number }) {
  /*
    THE SENTENCE AN EXPIRY EARNS — yuvoy-operator#46, verbatim, above the list
    rather than inside a row: "Public liability insurance expires 30 Nov 2026.
    Listings that need it come down that day." A date in small type on the
    fourth row down is how a lapsed licence becomes a cancelled booking.
  */
  const expiring = expirySentences(standing.credentials, at);
  /*
    One action per DOCUMENT, on the first row of its type. The list is the
    history — last year's certificate sits beside this year's — so the action
    is decided for the type as a whole, and only where `POST /credentials`
    will take what it leads to.
  */
  const actions = new Map(
    [...byDocumentType(standing.credentials)].map(([type, rows]) => [
      type,
      documentAction(rows, at),
    ]),
  );
  const offered = new Set<string>();

  /*
    How many of the required documents are verified — yuvoy-operator#46 item 1.

    Read from `requiredDocuments` and never counted from the rows below. The
    contract is explicit about why: the set is "what your market requires of
    every business, plus what the categories and activities you have published
    listings in require, so it can grow when a listing in a new category is
    approved." Counting the rows answers a different question and goes wrong the
    day a listing is approved in a new category.
  */
  const required = standing.requiredDocuments;
  const count = documentCount(required);

  return (
    <section className="mt-10" aria-labelledby="documents">
      <h2 id="documents" className="label text-forest/75">
        Your documents
      </h2>
      {count ? <p className="mt-2 text-base font-bold">{count}</p> : null}

      {/*
        Every required document that is NOT met, with the blocker that says why.
        Above the list of what we hold, because the list is a history — last
        year's certificate sits beside this year's — and what is missing does not
        appear in it at all.
      */}
      {required.some((d) => !d.satisfied) ? (
        <ul className="mt-3 space-y-2">
          {required
            .filter((d) => !d.satisfied)
            .map((doc) => {
              const blocker = blockerFor(doc.type, standing.blocking);
              return (
                <li key={doc.type}>
                  <Panel tone="alert" className="p-4">
                    <p className="text-sm font-bold">
                      {credentialTypeLabel(doc.type)}
                    </p>
                    {/*
                      "A document that is not satisfied always has a
                      `CREDENTIAL_*` entry in `blocking` saying why." Rendered
                      verbatim; when nothing matches, the type alone is said
                      rather than a reason nobody gave.
                    */}
                    {blocker ? (
                      <p className="text-forest/80 mt-1 text-sm">
                        {blocker.label}
                      </p>
                    ) : null}
                  </Panel>
                </li>
              );
            })}
        </ul>
      ) : null}
      {expiring.length > 0 ? (
        <Panel tone="alert" className="mt-3">
          <ul className="space-y-2">
            {expiring.map((line) => (
              <li key={line} className="text-base font-bold">
                {line}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <ul className="mt-3 space-y-3">
        {standing.credentials.map((c, i) => {
          const row = credentialText(c, at);
          const noFile = verifiedWithoutFile(c);
          const type = c.type?.trim() ?? "";
          const action = offered.has(type) ? null : (actions.get(type) ?? null);
          offered.add(type);
          return (
            <li key={`${c.type}-${i}`} className={panelClass()}>
              <div className="flex items-baseline justify-between gap-3">
                {/*
                  `credentialTypeLabel`, not `credentialName`. The latter
                  title-cases the raw type, so this row read "Oxygen" and "Boat"
                  while the required-documents list above it said "Oxygen
                  certificate" and "Boat papers" — the same screen naming the
                  same document two ways, and the vaguer of the two is the one
                  `CREDENTIAL_TYPES` exists to replace: "'Oxygen' alone is not a
                  document anybody recognises."

                  Done at the call site rather than inside `credentialName`,
                  because `credentials.ts` already imports from `standing.ts`
                  and reaching back the other way for a value would make that a
                  runtime cycle.
                */}
                <p className="text-base font-bold">
                  {credentialTypeLabel(c.type)}
                </p>
                {/*
                  `mandatory` is what separates "the account cannot go live
                  without this" from "nice to have on file", and an operator
                  deciding what to chase first needs it.
                */}
                {c.mandatory ? (
                  <span className="label text-forest/70 shrink-0">
                    Required
                  </span>
                ) : null}
              </div>
              <p
                className={cn(
                  "mt-2 text-sm",
                  row.tone === "problem"
                    ? "text-terra-deep font-bold"
                    : row.tone === "warn"
                      ? "text-terra-deep"
                      : "text-forest/80",
                )}
              >
                {row.text}
              </p>
              {c.expiresOn ? (
                <p className="text-forest/70 mt-1 text-sm">
                  {/*
                    A DATE, not an instant — "a licence expires on a day, and
                    sending a timestamp invites a timezone bug on the one field
                    an operator plans a season around."
                  */}
                  Valid until {marketDateLabel(c.expiresOn)}
                  {c.issuer ? ` · ${c.issuer}` : null}
                </p>
              ) : c.issuer ? (
                <p className="text-forest/70 mt-1 text-sm">{c.issuer}</p>
              ) : null}
              {/*
                The file behind this document, and never a blank. `hasFile`
                decides it rather than the name being present: a response
                carrying a name without the flag is one disagreeing with itself,
                and showing the name would say we hold a file we may not.

                Left out when the status above has already said we hold no
                file, so the row does not say it twice.
              */}
              {row.saysNoFile ? null : (
                <p
                  className={cn(
                    "mt-1 text-sm break-all",
                    noFile ? "text-terra-deep font-bold" : "text-forest/70",
                  )}
                >
                  {fileLine(c)}
                </p>
              )}

              {/*
                Sending a file is offered on a PENDING document only. "Once
                somebody at Yuvoy has verified or rejected a document, a new file
                behind it would change the evidence under a decision nobody
                re-made", which answers `409 document_locked` — so the control is
                withheld rather than offered and refused.
              */}
              {takesFile(c.state) && c.id ? (
                <SendDocument
                  credentialId={c.id}
                  label={credentialTypeLabel(c.type)}
                />
              ) : null}

              {/*
                VERIFIED, and we hold no file for it (yuvoy-operator#93).

                The review asked for "Send the file" here too, and the pinned
                API decided otherwise: the operator's upload answers
                `409 document_locked` for any state but pending, and "our staff
                can put a file behind a verified document that has none" (D56).
                A control here would be refused the day a documents bucket
                exists, so the ask goes by the route that can take the file: a
                person, who puts it on record. Said plainly, because a checked
                document we cannot produce is our gap, not a fault of theirs.
              */}
              {noFile ? (
                <p className="text-forest/80 mt-2 text-sm">
                  A checked document cannot take a file from this screen. If you
                  have a copy, call us on{" "}
                  <a
                    href={SUPPORT_PHONE_HREF}
                    className="text-terra-deep tap-target font-bold whitespace-nowrap underline underline-offset-4"
                  >
                    {SUPPORT_PHONE}
                  </a>{" "}
                  and we will put it on record.
                </p>
              ) : null}

              {action ? (
                <ButtonLink
                  href={action.href}
                  variant="secondary"
                  className="mt-4"
                >
                  {action.label}
                </ButtonLink>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
