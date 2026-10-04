"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { confirmSeats, type ConfirmSeatsState } from "@/app/calendar/actions";
import { helpHref } from "@/lib/help/types";
import type {
  ConfirmSeatsNeed,
  DocumentNeed,
  LinkNeed,
  Need,
} from "@/lib/home/needs";
import type { RequestView } from "@/lib/day/request-view";
import { changeSentences, needChanges } from "@/lib/home/changes";
import { DURATION, EASE, play, prefersReducedMotion } from "@/lib/motion";
import { markChange } from "@/lib/motion/mark";
import { sameOrder, stableOrder } from "@/lib/site/stable-order";
import { cn } from "@/lib/cn";
import { Announcer } from "@/components/ui/announcer";
import { Button, ButtonLink } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ChevronRightIcon, LayersIcon } from "@/components/ui/icons";
import { panelClass } from "@/components/ui/panel";
import { AnswerAnnouncer } from "@/components/requests/answer-announcer";
import type { Answer, AnswerKind } from "@/components/requests/answer-store";
import { RequestItem } from "@/components/requests/request-item";
import { useAnswers } from "@/components/requests/use-answers";
import { CashCard } from "./cash-card";
import { MessageCard } from "./message-card";

/**
 * "Needs you" on Home: the rows the server worked out, in its order, each
 * finished where it stands (yuvoy-operator#96 block 2; operator experiment A,
 * approved 3 Oct 2026).
 *
 * ## Why this list is a client component, and always mounted
 *
 * What an operator does here leaves something they must still read after the
 * row it came from is gone. An accepted request holds seats that "still have
 * to pay", and leaves the queue the moment it is accepted; a guest answered
 * here is read, and leaves the inbox; taken cash leaves the departure's
 * list. The server re-renders this screen on every focus and every minute,
 * and a receipt kept inside its row would unmount with it.
 *
 * So the answers, and the cards the operator has opened, are held HERE, in
 * state a server re-render reconciles rather than replaces, and each one
 * keeps the place its card had (`stableOrder`) rather than jumping when the
 * server drops it. A real navigation clears it all, which is right: by then
 * the lists are the truth.
 *
 * When nothing is waiting it says so, and names what is next, rather than
 * drawing nothing (experiment A's end state).
 *
 * ## What a re-read changed is marked, not moved (O01 A, approved 4 Oct 2026)
 *
 * The list re-reads under the operator's thumb, so a request can arrive at
 * the top or be answered on another phone while they look. Nothing moves to
 * say so: a card that arrives carries a forest tint that fades over 1.2s; a
 * card that leaves fades out where it is (100ms, and nothing on it can be
 * tapped meanwhile) before the list closes up; the Bookings count in the bar
 * cross-fades. Each is said once in a polite live region, in the owner's
 * words ("Seat request from Kavya Iyer, 18 min left.", "Daniel Okafor's
 * request is no longer waiting."). Only what the operator did not do counts:
 * what they answered, opened or took cash on is kept, and never news.
 */
export function NeedsYou({
  needs,
  canAnswer,
  canAccept,
  nextUp,
}: {
  needs: Need[];
  /** OWNER, ADMIN or MANAGER: who may answer a request at all. */
  canAnswer: boolean;
  /**
   * Whether Accept is drawn: withheld while the account is on hold, and
   * Decline is not, because a suspended business can always let a traveller
   * go (yuvoy-operator#50).
   */
  canAccept: boolean;
  /** "Next: 11:30 Try-dive at Nemo Reef, 5 of 8 booked.", for an empty list. */
  nextUp: string | null;
}) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  const { answers, store } = useAnswers(refresh);
  const [seats, confirmAll, confirming] = useActionState<
    ConfirmSeatsState,
    FormData
  >(confirmSeats, {});

  /*
    The cards the operator opened, by key, with the last data the server sent
    for each: a read conversation or a taken payment leaves the server's list,
    and the card the operator is still looking at must not.
  */
  const [opened, setOpened] = useState<Record<string, Need>>({});
  const [restore, setRestore] = useState<Record<string, AnswerKind>>({});

  const byKey = new Map(needs.map((need) => [need.key, need]));
  const touch = useCallback((need: Need) => {
    setOpened((was) => (was[need.key] ? was : { ...was, [need.key]: need }));
  }, []);

  const ours = new Set<string>([
    ...Object.keys(opened),
    ...Object.keys(answers).map((id) => `request-${id}`),
  ]);

  /*
    What the last re-read changed, against the needs last drawn (React's
    "storing information from previous renders"): the cards leaving, held
    for their fade with the data they were drawn with; the cards arriving,
    to mark; and what to say about both.
  */
  const [drawn, setDrawn] = useState(needs);
  const [leaving, setLeaving] = useState<Record<string, Need>>({});
  const [arrived, setArrived] = useState<{ keys: string[]; n: number }>({
    keys: [],
    n: 0,
  });
  const [said, setSaid] = useState({ text: "", n: 0 });
  const change = needs !== drawn ? needChanges(drawn, needs, ours) : null;
  if (change) {
    setDrawn(needs);
    if (change.gone.length > 0 || change.arrived.length > 0) {
      setLeaving((was) => {
        const next = { ...was };
        for (const need of change.gone) next[need.key] = need;
        // Back before its fade had ended: it is not leaving after all.
        for (const need of change.arrived) delete next[need.key];
        return next;
      });
    }
    if (change.arrived.length > 0) {
      setArrived((was) => ({
        keys: change.arrived.map((need) => need.key),
        n: was.n + 1,
      }));
    }
    const lines = changeSentences(change.arrived, change.gone);
    if (lines.length > 0) {
      setSaid((was) => ({ text: lines.join(" "), n: was.n + 1 }));
    }
  }

  /*
    A leaving card keeps its place while it fades, as a kept one does: from
    the render that finds it gone, before its fade is even in state, or the
    order would let go of it first.
  */
  const kept = new Set<string>([
    ...ours,
    ...Object.keys(leaving),
    ...(change?.gone.map((need) => need.key) ?? []),
  ]);
  const serverKeys = needs
    .filter(
      (need) => need.kind !== "confirm-seats" || seats.confirmed === undefined,
    )
    .map((need) => need.key);
  const [order, setOrder] = useState<string[]>(serverKeys);
  const nextOrder = stableOrder(order, serverKeys, kept);
  if (!sameOrder(nextOrder, order)) setOrder(nextOrder);

  /** The request a key names: from the server, its fade, or its answer. */
  function requestFor(
    key: string,
  ): { view: RequestView; answer?: Answer } | null {
    const need = byKey.get(key) ?? leaving[key];
    if (need?.kind === "request") {
      return { view: need.view, answer: answers[need.view.id] };
    }
    const id = key.startsWith("request-") ? key.slice("request-".length) : "";
    const answer = answers[id];
    return answer ? { view: answer.view, answer } : null;
  }

  const rowsFor = (key: string): ReactElement[] => {
    const request = key.startsWith("request-") ? requestFor(key) : null;
    if (request) {
      const present = byKey.has(key);
      return [
        <RequestItem
          key={key}
          kind="Seat request"
          view={request.view}
          answer={request.answer}
          present={present}
          canAnswer={canAnswer}
          canAccept={canAccept}
          focus={restore[request.view.id]}
          onAccept={() => store.hold("accept", request.view)}
          onDecline={(reason) => store.hold("decline", request.view, reason)}
          onUndo={() => {
            const kind = request.answer?.kind;
            if (store.undo(request.view.id) && kind) {
              setRestore((was) => ({ ...was, [request.view.id]: kind }));
            }
          }}
        />,
      ];
    }
    const live = byKey.get(key);
    const need = live ?? opened[key] ?? leaving[key];
    if (!need) return [];
    switch (need.kind) {
      case "message":
        return [
          <MessageCard key={key} need={need} onTouch={() => touch(need)} />,
        ];
      case "cash":
        /*
          Once the server stops sending this departure's cash, nobody on it
          owes anything: only what was taken HERE is still drawn, never a
          stale "Take" for a party paid on another phone.
        */
        return [
          <CashCard
            key={key}
            // A card fading out is drawn exactly as it was.
            need={live || leaving[key] ? need : { ...need, parties: [] }}
            onTouch={() => touch(need)}
          />,
        ];
      case "document":
        return [<DocumentCard key={key} need={need} />];
      case "confirm-seats":
        return [
          <ConfirmSeatsRow
            key={key}
            need={need}
            action={confirmAll}
            pending={confirming}
            message={seats.message}
          />,
        ];
      case "link":
        return [<LinkRow key={key} need={need} />];
      default:
        return [];
    }
  };
  const items = nextOrder.flatMap((key) =>
    rowsFor(key).map((node) => ({ key, node })),
  );
  const rows = items.map((item) => item.node);

  /*
    The cards drawn, by key, in the order they are on the page, for the marks
    drawn after a commit: every row here is exactly one <li>, under the
    receipt for confirming seats when there is one. A count that does not
    agree is a list drawn some other way, and gets no motion rather than the
    wrong card's.
  */
  const list = useRef<HTMLUListElement>(null);
  const drawnKeys = useRef<string[]>([]);
  useLayoutEffect(() => {
    drawnKeys.current = items.map((item) => item.key);
  });
  const rowOf = useCallback((key: string): HTMLElement | null => {
    const el = list.current;
    if (!el) return null;
    const keys = drawnKeys.current;
    const offset = el.children.length - keys.length;
    if (offset < 0 || offset > 1) return null;
    const at = keys.indexOf(key);
    const row = at < 0 ? null : el.children[offset + at];
    return row instanceof HTMLElement ? row : null;
  }, []);

  // A card that arrived is marked where it landed.
  useLayoutEffect(() => {
    for (const key of arrived.keys) markChange(rowOf(key));
  }, [arrived, rowOf]);

  /*
    A card that left is faded out where it is (100ms, accelerating away;
    120ms when reduced) and cannot be tapped meanwhile; then the list closes
    up over it, in one frame, as it always has.
  */
  const leavingKeys = Object.keys(leaving).join("\n");
  useEffect(() => {
    const keys = leavingKeys ? leavingKeys.split("\n") : [];
    if (keys.length === 0) return;
    const reduced = prefersReducedMotion();
    const ms = reduced ? DURATION.reducedFade : DURATION.press;
    for (const key of keys) {
      const row = rowOf(key);
      if (!row || row.inert) continue;
      row.inert = true;
      play(row, [{ opacity: 1 }, { opacity: 0 }], {
        duration: ms,
        easing: reduced ? "linear" : EASE.exit,
        fill: "forwards",
      });
    }
    const timer = setTimeout(() => {
      setLeaving((was) => {
        const next = { ...was };
        for (const key of keys) delete next[key];
        return next;
      });
    }, ms);
    return () => clearTimeout(timer);
  }, [leavingKeys, rowOf]);

  return (
    <section aria-labelledby="needs-you" className="mt-8">
      <h2 id="needs-you" className="label text-forest/75">
        Needs you
      </h2>
      <AnswerAnnouncer answers={answers} />
      <Announcer said={said} />
      {rows.length === 0 && seats.confirmed === undefined ? (
        <div className={panelClass("done", "mt-3")}>
          <p className="font-display text-2xl leading-tight">
            Nothing needs you now
          </p>
          {nextUp ? (
            <p className="text-forest/80 mt-2 text-sm">{nextUp}</p>
          ) : null}
        </div>
      ) : (
        <ul ref={list} className="mt-3 space-y-3">
          {seats.confirmed !== undefined ? (
            <SeatsConfirmed n={seats.confirmed} />
          ) : null}
          {rows}
        </ul>
      )}
    </section>
  );
}

/** A document about to take listings down, with where its replacement goes. */
function DocumentCard({ need }: { need: DocumentNeed }) {
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
      <p className="mt-2 text-base leading-snug font-bold">{need.text}</p>
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
    <li className={panelClass("alert", "p-4 sm:p-5")}>
      {/*
        No listing named: Home confirms every listing's (yuvoy-operator#94
        item 2), everything the counts include, in one call with no dates
        (yuvoy-api#241). Any dates are the server's to decide, never this
        form's: a year of windows only against an API from before #244.
      */}
      <form action={action}>
        <p className="text-base font-bold">{need.text}</p>
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
            pendingLabel="Confirming…"
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
