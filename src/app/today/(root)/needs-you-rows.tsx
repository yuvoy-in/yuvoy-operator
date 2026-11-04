"use client";

/** The rows of "Needs you" that are not a request, a guest or cash, moved out of needs-you.tsx (yuvoy-operator#178). */
import Link from "next/link";
import { helpHref } from "@/lib/help/types";
import type {
  ConfirmSeatsNeed,
  DocumentNeed,
  LinkNeed,
} from "@/lib/home/needs";
import { cn } from "@/lib/cn";
import { Button, ButtonLink } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { LayersIcon } from "@/components/ui/icons";
import { RowChevron } from "@/components/ui/link-pending";
import { panelClass } from "@/components/ui/panel";

/** A document about to take listings down, with where its replacement goes. */
export function DocumentCard({ need }: { need: DocumentNeed }) {
  return (
    <li
      aria-label="A document is running out"
      className={panelClass("raised", "p-4 sm:p-5")}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="label text-forest/75 flex items-center gap-1.5">
          <LayersIcon className="size-4" />
          Document
        </p>
        <Chip tone="accent">{need.chip}</Chip>
      </div>
      <p className="mt-2 text-base leading-snug font-bold text-balance">
        {need.text}
      </p>
      {need.action ? (
        <div className="mt-4">
          <ButtonLink href={need.action.href} variant="secondary">
            {need.action.label}
          </ButtonLink>
        </div>
      ) : null}
    </li>
  );
}

/** Departures off sale for unconfirmed seats, and one tap to confirm them all. */
export function ConfirmSeatsRow({
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
    <li className={panelClass("alert", "p-4 sm:p-5")}>
      {/*
        No listing named: Home confirms every listing's (yuvoy-operator#94
        item 2), everything the counts include, in one call with no dates
        (yuvoy-api#241). Any dates are the server's to decide, never this
        form's: a year of windows only against an API from before #244.
      */}
      <form action={action}>
        <p className="text-base font-bold text-balance">{need.text}</p>
        {need.detail ? (
          <p className="text-forest/80 mt-1 text-sm">{need.detail}</p>
        ) : null}
        {/*
          Why seats need confirming at all is not something anybody would
          guess, so the answer is one tap away rather than on the row.
        */}
        <Link
          href={helpHref("seats-not-confirmed", "/today")}
          className="text-forest/80 tap-target text-sm underline underline-offset-4"
        >
          Why?
        </Link>
        <div className="mt-3">
          <Button
            type="submit"
            variant="secondary"
            pending={pending}
            pendingLabel="Confirming"
          >
            Confirm all
          </Button>
        </div>
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
export function SeatsConfirmed({ n }: { n: number }) {
  return (
    <li role="status" className={panelClass("done", "p-4")}>
      <p className="text-base font-bold text-balance">
        {n === 0
          ? "Nothing needed confirming"
          : n === 1
            ? "Seats confirmed on 1 departure"
            : `Seats confirmed on ${n} departures`}
      </p>
      {n > 0 ? (
        <p className="text-forest/80 leading-body mt-1 text-sm text-pretty">
          Back on sale, with the seats as they were.
        </p>
      ) : null}
    </li>
  );
}

/** A row whose one action is to go where the thing is put right. */
export function LinkRow({ need }: { need: LinkNeed }) {
  const className = panelClass(
    need.tone === "alert" ? "alert" : "raised",
    "ease-interaction hover:bg-paper flex items-center gap-3 px-4 py-3 transition-colors duration-200",
  );
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-base font-bold text-balance",
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
      <RowChevron className="text-terra-deep size-5 shrink-0" />
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
