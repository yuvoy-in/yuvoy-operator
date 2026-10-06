"use client";

import { useActionState, useId, useState, type ReactNode } from "react";
import { addBlackout, type BlackoutState } from "./actions";
import { BLACKOUT_REASONS } from "@/lib/day/capacity-types";
import { Button } from "@/components/ui/button";
import { useConfirmFocus } from "@/components/ui/use-confirm-focus";
import { useStillConfirm } from "@/components/ui/use-still-confirm";
import { choiceClass, inputClass, textareaClass } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Panel, panelClass } from "@/components/ui/panel";
import { sendForm } from "@/lib/actions/send-form";

/**
 * Closing dates to new bookings.
 *
 * **Closing dates is not cancelling people**, and that misunderstanding is the
 * whole reason this needs a considered result rather than a tick: "an operator
 * who assumes closing the calendar cancelled the bookings will simply not turn
 * up."
 *
 * So when the API reports bookings still owed, that is what the screen leads
 * with — including people mid-checkout, whose holds predate the closure and
 * can still complete.
 *
 * ## One day, from its Manage panel — yuvoy-operator#45
 *
 * Given a `day`, the same form closes that day alone: the dates are fixed to
 * it, the words name it, and a day that is already closed says so rather than
 * offering to close it again. Reopening is the day's own control, beside the
 * closure it undoes.
 *
 * ## Quiet until asked, loud to confirm (yuvoy-operator#81)
 *
 * Closing dates stops sales, so it is destructive: the range form's trigger is
 * text in the warning colour, and the button that closes carries the `danger`
 * pill. A day's form is opened by the day's own quiet "Close this day", which
 * hands it the day's two verbatim sentences to say first.
 *
 * ## It arrives still (O06 B, approved 4 Oct 2026)
 *
 * The question fades in where the words were, Keep them open fades a held
 * copy of it out as the words come back, and the receipt fades in, as does
 * the fresh form "Close more dates" asks for. A day's form is opened and put
 * away by the day, which draws those two fades (`useStillConfirm`).
 */
export interface ClosingDay {
  /** `YYYY-MM-DD`, in the market's calendar. */
  date: string;
  /** How the calendar names it: "Today", "Tomorrow", or the date written out. */
  label: string;
  /** Every departure still running on it is already closed. */
  closed: boolean;
}

export function BlackoutForm({
  today,
  day,
  onCancel,
  children,
}: {
  today: string;
  day?: ClosingDay;
  /** A way back out of a day's form, for the screen that opened it. */
  onCancel?: () => void;
  /**
   * What a day says before it is closed, in place of the form's own sentence:
   * the calendar's two verbatim sentences about the people already booked.
   */
  children?: ReactNode;
}) {
  /*
    Remounted per closure. `useActionState` keeps its last result for the
    life of the component, so one closure replaced the form with its receipt
    until the operator navigated away and back. A new key is a new form.
  */
  const [round, setRound] = useState(0);
  return (
    <BlackoutRound
      key={round}
      today={today}
      day={day}
      onCancel={onCancel}
      onAgain={() => setRound((r) => r + 1)}
      again={round > 0}
    >
      {children}
    </BlackoutRound>
  );
}

function BlackoutRound({
  today,
  day,
  onCancel,
  onAgain,
  again,
  children,
}: {
  today: string;
  day?: ClosingDay;
  onCancel?: () => void;
  onAgain: () => void;
  /** Drawn for "Close more dates", in place of a receipt, so it fades in. */
  again: boolean;
  children?: ReactNode;
}) {
  /*
    A refusal hands back what was chosen (`sendForm`), and the dates, the
    reason and the note read it back in place: a range refused for its last
    day came back as today to today, with no reason and no note. Not
    remounted, because the question is this confirm's still frame and holds
    the focus.
  */
  const [state, act, pending] = useActionState(
    sendForm<BlackoutState>(addBlackout, () => ({
      message: "No signal. Nothing was closed.",
    })),
    {},
  );
  const typed = state.typed;
  // A day's form is already inside the panel somebody opened to reach it.
  const [open, setOpen] = useState(Boolean(day));
  const { trigger, question } = useConfirmFocus(open);
  const { root, frame } = useStillConfirm(
    state.result
      ? "receipt"
      : day?.closed
        ? "text:closed"
        : open
          ? "confirm"
          : "text",
    { enter: again },
  );
  /*
    Unique per form. The calendar can hold this form more than once — the
    range closure at the top and a day's inside its Manage panel — and two
    `id="from"` inputs would give two labels one field and fail the audit.
  */
  const id = useId();
  /** "Today" reads as "today" mid-sentence; a date keeps its capitals. */
  const spoken = day
    ? /^(Today|Tomorrow)$/.test(day.label)
      ? day.label.toLowerCase()
      : day.label
    : "";

  if (state.result) {
    const owed = state.result.existingBookings;
    return frame(
      <Panel ref={root} tone={owed > 0 ? "alert" : "done"}>
        <p className="text-base font-bold text-balance">
          {day
            ? `${day.label} is closed to new bookings`
            : "Those dates are closed to new bookings"}
        </p>
        {owed > 0 ? (
          <>
            <p className="text-terra-deep mt-2 text-sm font-bold">
              You still owe {owed} {owed === 1 ? "booking" : "bookings"}.
              Closing the calendar did not cancel them.
            </p>
            <p className="text-forest/90 leading-body mt-2 text-sm text-pretty">
              {state.result.note ||
                "That includes anybody mid-checkout. Their hold predates the closure and can still complete. Run them, or call each one off from its own departure."}
            </p>
          </>
        ) : (
          <p className="text-forest/80 leading-body mt-2 text-sm text-pretty">
            {day
              ? "Nothing was booked on it, so nobody is owed anything."
              : "Nothing was booked on them, so nobody is owed anything."}
          </p>
        )}
        {day ? null : (
          <Button onClick={onAgain} variant="secondary" className="mt-4">
            Close more dates
          </Button>
        )}
      </Panel>,
    );
  }

  if (day?.closed) {
    /*
      It said "Reopening a closed day is not something the portal can do yet",
      which stopped being true when the day gained Reopen beside its closure.
    */
    return frame(
      <p ref={root} className="text-forest/80 leading-body text-sm text-pretty">
        {`${day.label} is already closed to new bookings.`}
      </p>,
    );
  }

  if (!open) {
    return frame(
      <div ref={root}>
        <Button
          ref={trigger}
          onClick={() => setOpen(true)}
          variant="danger-quiet"
          size="md"
          block={false}
          aria-expanded={false}
        >
          Close dates to new bookings
        </Button>
      </div>,
    );
  }

  return frame(
    <form ref={root} action={act} className={day ? undefined : panelClass()}>
      <p
        ref={question}
        tabIndex={-1}
        className="text-base font-bold text-balance outline-none"
      >
        {day
          ? `Close ${spoken} to new bookings`
          : "Close dates to new bookings"}
      </p>
      {children ?? (
        <p className="text-forest/80 leading-body mt-2 text-sm text-pretty">
          This stops new sales. It does <strong>not</strong> cancel bookings you
          already have.
        </p>
      )}

      {day ? (
        <>
          <input type="hidden" name="from" value={day.date} />
          <input type="hidden" name="to" value={day.date} />
        </>
      ) : (
        <div className="mt-4 flex gap-3">
          <div className="flex-1">
            <label htmlFor={`${id}-from`} className="label text-forest/75">
              First day
            </label>
            <input
              id={`${id}-from`}
              name="from"
              type="date"
              min={today}
              defaultValue={typed?.from ?? today}
              required
              className={inputClass("bg-paper mt-2 px-3")}
            />
          </div>
          <div className="flex-1">
            <label htmlFor={`${id}-to`} className="label text-forest/75">
              Last day
            </label>
            <input
              id={`${id}-to`}
              name="to"
              type="date"
              min={today}
              defaultValue={typed?.to ?? today}
              required
              className={inputClass("bg-paper mt-2 px-3")}
            />
          </div>
        </div>
      )}

      <fieldset className="mt-4">
        <legend className="label text-forest/75">Why?</legend>
        <div className="mt-2 space-y-2">
          {BLACKOUT_REASONS.map((reason) => (
            <label key={reason.code} className={choiceClass()}>
              <input
                type="radio"
                name="reasonCode"
                value={reason.code}
                required
                defaultChecked={typed?.reasonCode === reason.code}
                className="accent-terra-deep size-5"
              />
              <span className="text-sm">{reason.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4">
        <label htmlFor={`${id}-note`} className="label text-forest/75">
          Anything to add (optional)
        </label>
        <Textarea
          id={`${id}-note`}
          name="note"
          rows={2}
          maxLength={500}
          defaultValue={typed?.note ?? ""}
          className={textareaClass("bg-paper mt-2")}
        />
      </div>

      {state.message ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <Button
          type="submit"
          pending={pending}
          pendingLabel="Closing"
          variant="danger"
          block={false}
          className="flex-1"
        >
          {day ? `Close ${spoken}` : "Close them"}
        </Button>
        {day ? (
          onCancel ? (
            <Button
              onClick={onCancel}
              variant="secondary"
              block={false}
              className="flex-1"
            >
              Keep it open
            </Button>
          ) : null
        ) : (
          <Button
            onClick={() => setOpen(false)}
            variant="secondary"
            block={false}
            className="flex-1"
          >
            Keep them open
          </Button>
        )}
      </div>
    </form>,
  );
}
