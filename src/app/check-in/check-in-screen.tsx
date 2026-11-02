"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { checkInWithCode } from "./actions";
import {
  NOT_A_CODE,
  UNSENT,
  type CheckInResult,
  type CheckInVia,
} from "./check-in-result";
import {
  displayCode,
  holdCheckInLink,
  normaliseCode,
  readCheckInLink,
  takeHeldCheckInLink,
} from "@/lib/day/check-in-link";
import { callAction } from "@/lib/actions/call-action";
import { createSendKeys } from "@/lib/messages/send-key";
import { marketTime } from "@/lib/format/market-time";
import { Button, ButtonLink } from "@/components/ui/button";
import { LinkRing } from "@/components/ui/link-pending";
import { Panel } from "@/components/ui/panel";
import { fieldLabelClass, inputClass } from "@/components/ui/input";

/**
 * Checking a party in from their code (yuvoy-operator#175).
 *
 * ## Sent once, on its own, when the link is good
 *
 * Somebody at the jetty scans the traveller's QR with the phone camera and
 * this opens. There is nothing left for them to decide, so the check-in goes
 * the moment the link is read, and the screen says who it was. Doing it again
 * is safe: the write is idempotent, a repeat answers `alreadyCheckedIn` with
 * the first time, and a resend after a lost answer goes under the same key.
 *
 * ## Typed, when there is no link
 *
 * A traveller with no app, a QR that will not scan, or a link that was not a
 * check-in link: the code can be typed. That one goes with no reference, as
 * `typed`, and the API finds the booking from the code alone.
 */

type Pending = { code: string; reference?: string; via: CheckInVia };
type Arrived = Extract<CheckInResult, { ok: true }>;

type State =
  | { step: "reading" }
  | { step: "typing"; notice?: string }
  | { step: "sending"; pending: Pending }
  | { step: "done"; arrived: Arrived }
  | { step: "refused"; pending: Pending; refused: Refusal };

type Refusal = Extract<CheckInResult, { ok: false }>;

/**
 * The 200 carries no time zone, and every market this portal serves today is
 * India's. When a second market opens, the answer has to say its zone.
 */
const MARKET_ZONE = "Asia/Kolkata";

/** Back to `/check-in` after, where the held link is taken. */
const SIGN_IN_AGAIN = "/sign-in?next=%2Fcheck-in";

const NOT_A_LINK =
  "That link is not a check-in link. Type the code the traveller shows instead.";

export function CheckInScreen() {
  const [state, setState] = useState<State>({ step: "reading" });
  const keys = useRef(createSendKeys());

  async function send(pending: Pending) {
    setState({ step: "sending", pending });
    const key = keys.current.keyFor(
      `${pending.reference ?? ""}.${pending.code}`,
    );
    const result = await callAction<CheckInResult>(
      () => checkInWithCode({ ...pending, key }),
      () => ({ ok: false, message: UNSENT, retry: true }),
    );
    if (result.ok) {
      keys.current.clear();
      setState({ step: "done", arrived: result });
      return;
    }
    if (result.newKey) keys.current.clear();
    /*
      Signed out at the jetty: the link is kept in this tab, as sign-in
      keeps it, so signing in again brings them back to this same check-in.
    */
    if (result.signIn && pending.reference) {
      holdCheckInLink(`${pending.reference}.${pending.code}`);
    }
    setState({ step: "refused", pending, refused: result });
  }

  useEffect(() => {
    /*
      After this commit, not inside it: the fragment is only the browser's,
      so the first render matches the server's ("Reading the link") and the
      screen moves on from there. React runs this effect twice in
      development and drops the first run before its microtask fires, so the
      link is read, taken and sent once.
    */
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      const hash = window.location.hash;
      const link = readCheckInLink(hash) ?? takeHeldCheckInLink();
      if (hash) {
        // The code is not left in the address bar, the history or a share.
        window.history.replaceState(
          window.history.state,
          "",
          window.location.pathname + window.location.search,
        );
      }
      if (link) void send({ ...link, via: "portal_link" });
      else setState({ step: "typing", notice: hash ? NOT_A_LINK : undefined });
    });
    return () => {
      live = false;
    };
  }, []);

  switch (state.step) {
    case "reading":
      return (
        <p
          className="text-forest/70 leading-body mt-6 text-base text-pretty"
          role="status"
        >
          Reading the link.
        </p>
      );
    case "typing":
      return <TypeCode notice={state.notice} onSend={send} />;
    case "sending":
      return (
        <p
          className="text-forest/70 leading-body mt-6 text-base text-pretty"
          role="status"
        >
          Checking in {displayCode(state.pending.code)}.
        </p>
      );
    case "done":
      return (
        <Done
          arrived={state.arrived}
          onAnother={() => setState({ step: "typing" })}
        />
      );
    case "refused":
      return (
        <Refused
          refused={state.refused}
          onRetry={() => void send(state.pending)}
          onType={() => setState({ step: "typing" })}
        />
      );
  }
}

function Done({
  arrived,
  onAnother,
}: {
  arrived: Arrived;
  onAnother: () => void;
}) {
  const at = marketTime(arrived.arrivedAt, MARKET_ZONE);
  const guests = arrived.guests === 1 ? "1 guest" : `${arrived.guests} guests`;
  return (
    <div className="mt-6">
      <Panel tone="done" role="status">
        <p className="font-display tracking-display leading-display text-2xl text-balance">
          {arrived.name}
        </p>
        <p className="leading-body mt-1 text-base text-pretty">
          {guests}, {arrived.reference}
        </p>
        <p className="leading-body mt-3 text-base font-bold text-pretty">
          {arrived.alreadyCheckedIn
            ? `Already checked in at ${at}`
            : `Checked in at ${at}`}
        </p>
      </Panel>
      <div className="mt-6 flex flex-col gap-3">
        <ButtonLink href={`/today/${arrived.slotId}/boarding`} block>
          Open the boarding list
          <LinkRing button />
        </ButtonLink>
        <Button variant="secondary" block onClick={onAnother}>
          Type another code
        </Button>
      </div>
    </div>
  );
}

/**
 * A check-in that did not happen, or may not have.
 *
 * "Try again" is offered only where sending the same again can help (see
 * `retry`). A code that missed is never sent again from here: each miss
 * counts toward the operator's 30 an hour, after which even a right code is
 * refused.
 */
function Refused({
  refused,
  onRetry,
  onType,
}: {
  refused: Refusal;
  onRetry: () => void;
  onType: () => void;
}) {
  return (
    <div className="mt-6">
      <Panel tone="alert" role="alert">
        <p className="leading-body text-base text-pretty">{refused.message}</p>
      </Panel>
      <div className="mt-6 flex flex-col gap-3">
        {refused.signIn ? (
          <ButtonLink href={SIGN_IN_AGAIN} block>
            Sign in again
          </ButtonLink>
        ) : null}
        {refused.retry ? (
          <Button block onClick={onRetry}>
            Try again
          </Button>
        ) : null}
        <Button variant="secondary" block onClick={onType}>
          Type the code
        </Button>
      </div>
      {refused.byName ? (
        <p className="text-forest/70 leading-body mt-6 text-sm text-pretty">
          Is it them?{" "}
          <Link
            href="/today"
            className="text-terra-deep tap-target font-bold underline underline-offset-4"
          >
            Check them in by name on Today
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}

function TypeCode({
  notice,
  onSend,
}: {
  notice?: string;
  onSend: (pending: Pending) => void;
}) {
  const [typed, setTyped] = useState("");
  const [wrong, setWrong] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = normaliseCode(typed);
    if (!code) {
      setWrong(true);
      return;
    }
    onSend({ code, via: "typed" });
  }

  return (
    <form className="mt-6" onSubmit={submit} noValidate>
      {notice ? (
        <p className="leading-body mb-4 text-base text-pretty" role="alert">
          {notice}
        </p>
      ) : null}
      <label htmlFor="check-in-code" className={fieldLabelClass()}>
        Check-in code
      </label>
      <input
        id="check-in-code"
        name="code"
        className={inputClass(
          "mt-2 font-mono text-2xl tracking-[0.4em] uppercase",
        )}
        value={typed}
        onChange={(e) => {
          setTyped(e.target.value);
          setWrong(false);
        }}
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        placeholder="K7QM-2XPA"
        aria-invalid={wrong || undefined}
        aria-describedby={wrong ? "check-in-code-wrong" : undefined}
      />
      {wrong ? (
        <p
          id="check-in-code-wrong"
          className="text-terra-deep leading-body mt-2 text-sm text-pretty"
          role="alert"
        >
          {NOT_A_CODE}
        </p>
      ) : null}
      <Button type="submit" block className="mt-4">
        Check in
      </Button>
    </form>
  );
}
