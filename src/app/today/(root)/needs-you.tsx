"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useState } from "react";
import {
  acceptRequest,
  declineRequest,
  type RequestActionState,
} from "@/app/bookings/actions";
import { GrantedReceipt, type Receipt } from "@/app/bookings/request-row";
import { confirmSeats, type ConfirmSeatsState } from "@/app/calendar/actions";
import { DECLINE_REASONS } from "@/lib/day/request-types";
import { helpHref } from "@/lib/help/types";
import type {
  ConfirmSeatsNeed,
  LinkNeed,
  Need,
  RequestNeed,
} from "@/lib/home/needs";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { ChevronRightIcon } from "@/components/ui/icons";
import { choiceClass } from "@/components/ui/input";
import { panelClass } from "@/components/ui/panel";

/**
 * "Needs you" on Home (yuvoy-operator#96 block 2): the rows the server worked
 * out, in its order, each with its one action, and the receipts those actions
 * leave behind.
 *
 * ## Why this list is a client component, and always mounted
 *
 * Two of its actions leave something the operator must still read after the
 * row it came from is gone. An accepted request holds seats that "still have
 * to pay", and the request leaves the queue the moment it is accepted; seats
 * confirmed come back on sale, and the row saying they were off sale goes with
 * the re-read (`confirmSeats` revalidates Home). A receipt kept inside its row
 * would unmount with it on the next refresh, which is the exact defect
 * `RequestQueue` on Bookings was built to stop.
 *
 * So the receipts live HERE, in state a server re-render reconciles rather
 * than replaces, and this component is rendered by Home whether or not there
 * is anything in it: it draws nothing when there is nothing to draw, and it
 * is still there, holding a receipt, when the rows under it are all gone. The
 * confirm-all action's state is held here for the same reason: its row is gone
 * in the very render that carries its answer.
 *
 * A real navigation clears it all, which is right: by then the lists are the
 * truth.
 */
export function NeedsYou({
  needs,
  canAccept,
}: {
  needs: Need[];
  /**
   * Whether Accept is drawn. A request row reaches this list only for a
   * login that can answer; Accept is withheld while the account is on hold,
   * and Decline is not, because a suspended business can always let a
   * traveller go (yuvoy-operator#50).
   */
  canAccept: boolean;
}) {
  const router = useRouter();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [declined, setDeclined] = useState<string[]>([]);
  const [seats, confirmAll, confirming] = useActionState<
    ConfirmSeatsState,
    FormData
  >(confirmSeats, {});

  const onGranted = useCallback(
    (receipt: Receipt) => {
      setReceipts((prev) =>
        prev.some((r) => r.id === receipt.id) ? prev : [...prev, receipt],
      );
      // The queue, and the Bookings badge, catch up; the receipt stays here.
      router.refresh();
    },
    [router],
  );

  const onDeclined = useCallback(
    (id: string) => {
      setDeclined((prev) => (prev.includes(id) ? prev : [...prev, id]));
      router.refresh();
    },
    [router],
  );

  const shown = needs.filter((need) => {
    if (need.kind === "request") {
      return (
        !declined.includes(need.id) && !receipts.some((r) => r.id === need.id)
      );
    }
    // Once confirmed, the receipt stands where the row was.
    if (need.kind === "confirm-seats") return seats.confirmed === undefined;
    return true;
  });

  if (
    shown.length === 0 &&
    receipts.length === 0 &&
    seats.confirmed === undefined
  ) {
    return null;
  }

  return (
    <section aria-labelledby="needs-you" className="mt-8">
      <h2 id="needs-you" className="label text-forest/75">
        Needs you
      </h2>
      <ul className="mt-3 space-y-2">
        {receipts.map((receipt) => (
          <GrantedReceipt key={`granted-${receipt.id}`} receipt={receipt} />
        ))}
        {seats.confirmed !== undefined ? (
          <SeatsConfirmed n={seats.confirmed} />
        ) : null}
        {shown.map((need) =>
          need.kind === "request" ? (
            <RequestRow
              key={need.key}
              need={need}
              canAccept={canAccept}
              onGranted={onGranted}
              onDeclined={onDeclined}
            />
          ) : need.kind === "confirm-seats" ? (
            <ConfirmSeatsRow
              key={need.key}
              need={need}
              action={confirmAll}
              pending={confirming}
              message={seats.message}
            />
          ) : (
            <LinkRow key={need.key} need={need} />
          ),
        )}
      </ul>
    </section>
  );
}

/**
 * One seat request: how many, which departure, the clock, and the answer.
 *
 * Accepting is one tap, through the same Server Action as Bookings. Declining
 * is two and asks why, because it is cheap for the operator and final for the
 * traveller; the step says what happens before the tap that does it. It is
 * the quieter of the two words (yuvoy-operator#81), and its confirming button
 * carries the weight.
 */
function RequestRow({
  need,
  canAccept,
  onGranted,
  onDeclined,
}: {
  need: RequestNeed;
  canAccept: boolean;
  onGranted: (receipt: Receipt) => void;
  onDeclined: (id: string) => void;
}) {
  const [state, act, pending] = useActionState<RequestActionState, FormData>(
    async (prev, form) => {
      if (form.get("intent") === "decline") {
        const next = await declineRequest(prev, form);
        if (!next.message) onDeclined(need.id);
        return next;
      }
      return acceptRequest(prev, form);
    },
    {},
  );
  const [declining, setDeclining] = useState(false);

  const receipt: Receipt | null = state.granted
    ? {
        id: need.id,
        contactName: need.contactName,
        guests: need.guests,
        ...(state.receipt ? { sentence: state.receipt } : {}),
        ...(state.payBy ? { payBy: state.payBy } : {}),
        ...(state.untold ? { untold: true } : {}),
      }
    : null;

  useEffect(() => {
    if (receipt) onGranted(receipt);
    // `receipt` is derived from `state.granted`, which flips exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.granted]);

  // Drawn here for the frame before the list takes it over, so it never blinks.
  if (receipt) return <GrantedReceipt receipt={receipt} />;

  return (
    <li className={panelClass(need.urgent ? "alert" : "raised", "p-4")}>
      <p className="truncate text-base font-bold">{need.title}</p>
      <p
        className={cn(
          "mt-1 text-sm",
          need.urgent ? "text-terra-deep font-bold" : "text-forest/80",
        )}
      >
        {need.detail}
      </p>
      {need.short ? (
        <p className="text-terra-deep mt-1 text-sm font-bold">{need.short}</p>
      ) : null}

      {declining ? (
        <form action={act} className="mt-4">
          <input type="hidden" name="intent" value="decline" />
          <input type="hidden" name="requestId" value={need.id} />
          <fieldset>
            <legend className="label text-forest/75">Why?</legend>
            <div className="mt-2 space-y-2">
              {DECLINE_REASONS.map((reason) => (
                <label key={reason.code} className={choiceClass()}>
                  <input
                    type="radio"
                    name="reasonCode"
                    value={reason.code}
                    required
                    className="accent-terra-deep size-5"
                  />
                  <span className="text-sm">{reason.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-forest/80 mt-3 text-sm">
            {need.contactName} is told no, and nothing was charged.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              type="submit"
              variant="danger"
              size="md"
              block={false}
              disabled={pending}
              className="flex-1"
            >
              {pending ? "Declining…" : "Decline"}
            </Button>
            <Button
              variant="secondary"
              size="md"
              block={false}
              onClick={() => setDeclining(false)}
              className="flex-1"
            >
              Back
            </Button>
          </div>
        </form>
      ) : (
        <form action={act} className="mt-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="requestId" value={need.id} />
          {/*
            The departure's zone, so a pay-by time written for an API that
            sends no sentence is the market's, never the phone's.
          */}
          <input type="hidden" name="timezone" value={need.timezone} />
          {canAccept ? (
            <Button
              type="submit"
              variant="outline"
              size="md"
              block={false}
              // Past the ceiling the API answers 409; the row said why above.
              disabled={pending || Boolean(need.short)}
            >
              {pending ? "Working…" : "Accept"}
            </Button>
          ) : null}
          <Button
            variant="danger-quiet"
            size="md"
            block={false}
            disabled={pending}
            onClick={() => setDeclining(true)}
          >
            Decline
          </Button>
        </form>
      )}

      {state.message ? (
        <div role="alert" className="mt-3">
          <p className="text-terra-deep text-sm font-bold">{state.message}</p>
          {state.seeBusiness ? (
            <Link
              href="/account/verification"
              className="text-forest tap-target mt-1 text-sm underline underline-offset-4"
            >
              See what is outstanding
            </Link>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** Departures off sale for unconfirmed seats, and one tap to confirm them all. */
function ConfirmSeatsRow({
  need,
  action,
  pending,
  message,
}: {
  need: ConfirmSeatsNeed;
  action: (form: FormData) => void;
  pending: boolean;
  message?: string;
}) {
  return (
    <li className={panelClass("alert", "p-4")}>
      {/*
        No listing named: Home confirms every listing's departures in the next
        30 days (yuvoy-operator#94 item 2). The window is decided on the
        server, never taken from this form.
      */}
      <form
        action={action}
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold">{need.text}</p>
          {need.detail ? (
            <p className="text-forest/80 mt-1 text-sm">{need.detail}</p>
          ) : null}
          {/*
            Why seats need confirming at all is not something anybody would
            guess, so the answer is one tap away rather than on the row.
          */}
          <Link
            href={helpHref("seats-not-confirmed")}
            className="text-forest/80 tap-target text-sm underline underline-offset-4"
          >
            Why?
          </Link>
        </div>
        <Button
          type="submit"
          variant="outline"
          size="md"
          block={false}
          disabled={pending}
        >
          {pending ? "Confirming…" : "Confirm all"}
        </Button>
      </form>
      {message ? (
        <p role="alert" className="text-terra-deep mt-2 text-sm font-bold">
          {message}
        </p>
      ) : null}
    </li>
  );
}

/** What confirming did, kept after the row that offered it has gone. */
function SeatsConfirmed({ n }: { n: number }) {
  return (
    <li role="status" className={panelClass("done", "p-4")}>
      <p className="text-base font-bold">
        {n === 0
          ? "Nothing needed confirming"
          : n === 1
            ? "Seats confirmed on 1 departure"
            : `Seats confirmed on ${n} departures`}
      </p>
      {n > 0 ? (
        <p className="text-forest/80 mt-1 text-sm">
          Back on sale, with the seats as they were.
        </p>
      ) : null}
    </li>
  );
}

/** A row whose one action is to go where the thing is put right. */
function LinkRow({ need }: { need: LinkNeed }) {
  const className = panelClass(
    need.tone === "alert" ? "alert" : "raised",
    "ease-interaction hover:bg-paper flex items-center gap-3 px-4 py-3 transition-colors duration-200",
  );
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-base font-bold",
            need.tone === "alert" && "text-terra-deep",
          )}
        >
          {need.text}
        </span>
        {need.detail ? (
          <span className="text-forest/70 block truncate text-sm">
            {need.detail}
          </span>
        ) : null}
        <span className="text-terra-deep mt-0.5 block text-sm font-bold">
          {need.action}
        </span>
      </span>
      <ChevronRightIcon className="text-terra-deep size-5 shrink-0" />
    </>
  );

  return (
    <li>
      {/* A phone number is dialled, not routed: a plain anchor, never `Link`. */}
      {need.href.startsWith("tel:") ? (
        <a href={need.href} className={className}>
          {body}
        </a>
      ) : (
        <Link href={need.href} className={className}>
          {body}
        </Link>
      )}
    </li>
  );
}
