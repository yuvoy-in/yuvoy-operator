"use client";

import { useActionState, useState } from "react";
import { saveSchedule, type ScheduleState } from "./actions";
import {
  closingSentence,
  removedTimes,
  WEEKDAYS,
  type ScheduleRow,
} from "./schedule-changes";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { fieldLabelClass, inputClass } from "@/components/ui/input";
import { useConfirmFocus } from "@/components/ui/use-confirm-focus";

/**
 * The weekly schedule — yuvoy-operator#56 item 8.
 *
 * ## It is the WHOLE schedule, and that is the dangerous part
 *
 * `PUT /experiences/{id}/schedule` replaces what is there, so a row removed
 * here is a row removed from the business, and "removing a weekday and time
 * closes what this schedule made at it". So a save that drops a weekday and
 * time the listing had (a row removed, or its day or time changed) is a
 * question first, naming what stops selling ("Departures it made on Tuesdays
 * at 09:00 stop taking new bookings"). Only saving with none used to ask
 * (the audit, O2). A seats change removes nothing and saves at once.
 *
 * Closed, not cancelled. That distinction is the whole reason the confirmation
 * says it: an operator who clears a schedule believing it cancelled the
 * bookings does not turn up.
 *
 * ## Save appears once there is something to save (yuvoy-operator#85 s8)
 *
 * "Save the schedule" was the loudest button on the listing's screen, above
 * the departures, with nothing to save: the first dark button committed a form
 * nobody had filled in. It is drawn only once the rows differ from what the
 * listing has, beside a way to put them back, and the screen's loudest thing
 * stays the departures above it.
 */
type Row = ScheduleRow;

export function ScheduleForm({
  experienceId,
  repeatsWeekly,
  weekly,
}: {
  experienceId: string;
  repeatsWeekly: boolean;
  weekly: Row[];
}) {
  const [rows, setRowsNow] = useState<Row[]>(weekly);
  const [confirming, setConfirming] = useState(false);
  /*
    Any edit goes back to editing: a question asked about one set of rows is
    not an answer about the next.
  */
  const setRows: typeof setRowsNow = (next) => {
    setConfirming(false);
    setRowsNow(next);
  };
  /*
    Compared field by field and in order, because the schedule is sent whole
    and in order: the same days in a different order is a different body, and
    nothing changed is nothing to send.
  */
  const dirty = !sameSchedule(rows, weekly);
  const [state, act, pending] = useActionState<ScheduleState, FormData>(
    saveSchedule,
    {},
  );

  function update(index: number, change: Partial<Row>) {
    setRows((was) =>
      was.map((row, i) => (i === index ? { ...row, ...change } : row)),
    );
  }

  /*
    Before any early return: the focus hook is a hook. `asks` is whether this
    save is a question first: removing the schedule, or any weekday and time
    it had.
  */
  const removingAll = rows.length === 0 && repeatsWeekly;
  const closing = removingAll ? [] : removedTimes(weekly, rows);
  const asks = dirty && (removingAll || closing.length > 0);
  const { trigger, question } = useConfirmFocus(asks && confirming);

  if (state.done) {
    return (
      <Panel tone="done" role="status" className="mt-3 p-4">
        <p className="text-base font-bold">The weekly schedule is saved</p>
        {/*
          The API's own sentence, verbatim: it says how many departures the save
          made and how many it closed, which nothing on this screen can work
          out.
        */}
        {state.note ? (
          <p className="text-forest/80 mt-2 text-sm">{state.note}</p>
        ) : null}
        {/*
          And whether any of it can actually be bought. A week of departures
          that are all off sale is the thing an operator would otherwise
          discover from an empty booking list.
        */}
        {state.notOnSaleDetail ? (
          <p className="text-terra-deep mt-2 text-sm font-bold">
            {state.notOnSaleDetail}
          </p>
        ) : null}
      </Panel>
    );
  }

  return (
    <form action={act} className="mt-3">
      <input type="hidden" name="experienceId" value={experienceId} />
      {/*
        The rows travel as one JSON field rather than as indexed inputs: the
        body is a single array and the server reads it as one, so encoding it
        twice is two places for the shape to drift.
      */}
      <input type="hidden" name="weekly" value={JSON.stringify(rows)} />

      {rows.length === 0 ? (
        <p className="text-forest/70 text-sm">No weekly schedule.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row, i) => {
            const problem =
              state.rowProblems?.[`weekly[${i}].startTime`] ??
              state.rowProblems?.[`weekly[${i}].seats`] ??
              state.rowProblems?.[`weekly[${i}].weekday`];
            return (
              <li key={i} className="flex flex-wrap items-end gap-2">
                <div>
                  <label htmlFor={`weekday-${i}`} className={fieldLabelClass()}>
                    Day
                  </label>
                  <select
                    id={`weekday-${i}`}
                    value={row.weekday}
                    onChange={(e) =>
                      update(i, { weekday: Number(e.target.value) })
                    }
                    className={inputClass("mt-1 h-11 w-auto pr-8")}
                  >
                    {WEEKDAYS.map((name, value) => (
                      <option key={value} value={value}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`time-${i}`} className={fieldLabelClass()}>
                    Time
                  </label>
                  <input
                    id={`time-${i}`}
                    type="time"
                    value={row.startTime}
                    onChange={(e) => update(i, { startTime: e.target.value })}
                    className={inputClass("mt-1 h-11 w-auto")}
                  />
                </div>
                <div>
                  <label htmlFor={`seats-${i}`} className={fieldLabelClass()}>
                    Seats
                  </label>
                  <input
                    id={`seats-${i}`}
                    type="number"
                    min={1}
                    max={200}
                    value={row.seats}
                    onChange={(e) =>
                      update(i, { seats: Number(e.target.value) })
                    }
                    className={inputClass("mt-1 h-11 w-24")}
                  />
                </div>
                <Button
                  variant="secondary"
                  block={false}
                  onClick={() =>
                    setRows((was) => was.filter((_, at) => at !== i))
                  }
                >
                  {/*
                    The space belongs to the visible word, not to the hidden
                    one: an accessible name is built by joining each child's
                    own text with the whitespace trimmed off, so a space that
                    starts the hidden span disappears and the button is
                    announced as "RemoveTuesday 09:00".
                  */}
                  Remove{" "}
                  <span className="sr-only">
                    {WEEKDAYS[row.weekday]} {row.startTime}
                  </span>
                </Button>
                {problem ? (
                  <p className="text-terra-deep w-full text-sm font-bold">
                    {problem}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4">
        <Button
          variant="secondary"
          block={false}
          onClick={() =>
            setRows((was) => [
              ...was,
              { weekday: 1, startTime: "09:00", seats: 8 },
            ])
          }
        >
          Add a day
        </Button>
      </div>

      {state.message ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      {/*
        A save that removes a weekday and time the listing had is a question
        first: "removing a weekday and time closes what this schedule made at
        it", and "closed to new bookings" rather than cancelled is the half an
        operator has to hear. Removing the whole schedule is the same question
        about every time. The control that asks is quiet text when it only
        removes (#81), and the one that closes is the loud one.
      */}
      {!dirty ? null : asks && confirming ? (
        <Panel tone="alert" className="mt-4 p-4">
          <p
            ref={question}
            tabIndex={-1}
            className="text-sm font-bold outline-none"
          >
            {removingAll ? "Remove the weekly schedule?" : "Save the schedule?"}
          </p>
          <p className="text-forest/80 mt-1.5 text-sm">
            {removingAll
              ? "Departures it made are closed to new bookings. Bookings on them stay."
              : closingSentence(closing)}
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              type="submit"
              variant="danger"
              block={false}
              className="flex-1"
              disabled={pending}
            >
              {removingAll
                ? pending
                  ? "Removing…"
                  : "Remove schedule"
                : pending
                  ? "Saving…"
                  : "Save and close them"}
            </Button>
            <Button
              variant="secondary"
              block={false}
              className="flex-1"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              {removingAll ? "Keep it" : "Keep editing"}
            </Button>
          </div>
        </Panel>
      ) : asks ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {removingAll ? (
            <Button
              ref={trigger}
              variant="danger-quiet"
              size="md"
              block={false}
              aria-expanded={false}
              onClick={() => setConfirming(true)}
            >
              Remove the weekly schedule
            </Button>
          ) : (
            <Button
              ref={trigger}
              block={false}
              aria-expanded={false}
              onClick={() => setConfirming(true)}
            >
              Save the schedule
            </Button>
          )}
          <UndoChanges onUndo={() => setRows(weekly)} />
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="submit" block={false} disabled={pending}>
            {pending ? "Saving…" : "Save the schedule"}
          </Button>
          <UndoChanges onUndo={() => setRows(weekly)} disabled={pending} />
        </div>
      )}
    </form>
  );
}

/** The rows as the listing has them, back, with nothing sent. */
function UndoChanges({
  onUndo,
  disabled,
}: {
  onUndo: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onUndo}
      disabled={disabled}
      className="text-forest/80 decoration-forest/40 inline-flex min-h-11 items-center text-sm underline underline-offset-4 disabled:opacity-55"
    >
      Undo changes
    </button>
  );
}

/** Whether two schedules would send the same body. */
function sameSchedule(a: readonly Row[], b: readonly Row[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (row, i) =>
        row.weekday === b[i].weekday &&
        row.startTime === b[i].startTime &&
        row.seats === b[i].seats,
    )
  );
}
