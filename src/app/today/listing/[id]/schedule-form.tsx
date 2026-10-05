"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { saveSchedule, type ScheduleState } from "./actions";
import {
  closingSentence,
  removedTimes,
  type ScheduleRow,
} from "./schedule-changes";
import {
  planFromRows,
  planProblems,
  rowsFromPlan,
  sortRows,
  type WeekPlan,
} from "./week-plan";
import { WeekPicker } from "./week-picker";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { useConfirmFocus } from "@/components/ui/use-confirm-focus";
import { useStillConfirm } from "@/components/ui/use-still-confirm";

/**
 * The weekly schedule — yuvoy-operator#56 item 8.
 *
 * ## Picked, not typed a row at a time (yuvoy-operator#111)
 *
 * The week is days ticked as chips, a time and seats for all of them, and
 * the days that are different underneath (`WeekPicker`). What is sent is the
 * same body it always was, one row per weekday and time, derived from the
 * picker by `rowsFromPlan`; and what the listing has is read back into the
 * picker by `planFromRows` without losing a row, a second daily departure
 * included. The builder's Schedule step draws this same form.
 *
 * ## It is the WHOLE schedule, and that is the dangerous part
 *
 * `PUT /experiences/{id}/schedule` replaces what is there, so a row removed
 * here is a row removed from the business, and "removing a weekday and time
 * closes what this schedule made at it". So a save that drops a weekday and
 * time the listing had (a day unticked, or its time changed) is a question
 * first, naming what stops selling ("Departures it made on Tuesdays at 09:00
 * stop taking new bookings"). Only saving with none used to ask (the audit,
 * O2). A seats change removes nothing and saves at once.
 *
 * Closed, not cancelled. That distinction is the whole reason the confirmation
 * says it: an operator who clears a schedule believing it cancelled the
 * bookings does not turn up.
 *
 * ## Save appears once there is something to save (yuvoy-operator#85 s8)
 *
 * "Save the schedule" was the loudest button on the listing's screen, above
 * the departures, with nothing to save: the first dark button committed a form
 * nobody had filled in. It is drawn only once the week differs from what the
 * listing has, beside a way to put it back, and the screen's loudest thing
 * stays the departures above it. It waits, disabled, while anything on the
 * week would be refused, which is said where it is.
 *
 * ## The question arrives still (O06 B, approved 4 Oct 2026)
 *
 * It fades in where the save was, and put away (Keep it, Keep editing, or an
 * edit to the week that makes it moot) it fades out as a held copy while
 * what replaced it fades in. The receipt fades in (`useStillConfirm`).
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
  const [plan, setPlanNow] = useState<WeekPlan>(() => planFromRows(weekly));
  const [confirming, setConfirming] = useState(false);
  /*
    Any edit goes back to editing: a question asked about one week is not an
    answer about the next.
  */
  const setPlan = (next: WeekPlan) => {
    setConfirming(false);
    setPlanNow(next);
  };
  const rows = rowsFromPlan(plan);
  /*
    Compared field by field, in the one order both are put in: by weekday from
    Sunday, then by time, the order the API reads them back in. The picker
    always sends that order, so the listing's rows in any other order are the
    same week, and nothing changed is nothing to send.
  */
  const saved = useMemo(() => sortRows(weekly), [weekly]);
  const dirty = !sameSchedule(rows, saved);
  const problems = planProblems(plan);
  const blocked = problems.length > 0;
  const blockedId = useId();
  const [state, act, pending] = useActionState<ScheduleState, FormData>(
    saveSchedule,
    {},
  );

  /*
    Before any early return: the focus hook is a hook. `asks` is whether this
    save is a question first: removing the schedule, or any weekday and time
    it had.
  */
  const removingAll = rows.length === 0 && repeatsWeekly;
  const closing = removingAll ? [] : removedTimes(weekly, rows);
  const asks = dirty && (removingAll || closing.length > 0);
  const { trigger, question } = useConfirmFocus(asks && confirming);
  const { root, frame } = useStillConfirm(
    state.done ? "receipt" : asks && confirming ? "confirm" : "text",
  );

  if (state.done) {
    return frame(
      <Panel ref={root} tone="done" role="status" className="mt-3 p-4">
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
      </Panel>,
    );
  }

  return frame(
    <form action={act} className="mt-3">
      <input type="hidden" name="experienceId" value={experienceId} />
      {/*
        The rows travel as one JSON field rather than as indexed inputs: the
        body is a single array and the server reads it as one, so encoding it
        twice is two places for the shape to drift.
      */}
      <input type="hidden" name="weekly" value={JSON.stringify(rows)} />

      <WeekPicker plan={plan} onChange={setPlan} problems={problems} />

      {state.message ? (
        <div role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          <p>{state.message}</p>
          {/*
            The API names every refused row, as "Tuesday at 09:00" and why
            (`rowProblems`), rather than one sentence over seven of them.
          */}
          {state.rowProblems?.map((problem) => (
            <p key={problem} className="mt-1">
              {problem}
            </p>
          ))}
        </div>
      ) : null}

      {/*
        Said once, beside the save it holds back; what to fix is said where it
        is, above. A disabled button with no reason is a dead end.
      */}
      {dirty && blocked ? (
        <p id={blockedId} className="text-forest/80 mt-4 text-sm">
          Fix what is marked above to save.
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
        <Panel ref={root} tone="alert" className="mt-4 p-4">
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
              pending={pending}
              pendingLabel={removingAll ? "Removing" : "Saving"}
            >
              {removingAll ? "Remove schedule" : "Save and close them"}
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
        <div
          ref={root}
          className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2"
        >
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
              disabled={blocked}
              aria-describedby={blocked ? blockedId : undefined}
              onClick={() => setConfirming(true)}
            >
              Save the schedule
            </Button>
          )}
          <UndoChanges onUndo={() => setPlan(planFromRows(weekly))} />
        </div>
      ) : (
        <div
          ref={root}
          className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2"
        >
          <Button
            type="submit"
            block={false}
            pending={pending}
            pendingLabel="Saving"
            disabled={blocked}
            aria-describedby={blocked ? blockedId : undefined}
          >
            Save the schedule
          </Button>
          <UndoChanges
            onUndo={() => setPlan(planFromRows(weekly))}
            disabled={pending}
          />
        </div>
      )}
    </form>,
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
