/**
 * What the two schedule form test files share (yuvoy-operator#178). Not a
 * test file itself: only `*.test.tsx` files are collected. The mock of the
 * actions and the import of the form stay in each test file, since `vi.mock`
 * is per file, so the form and the mock come in as arguments.
 */
import type { Mock } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ScheduleForm } from "./schedule-form";

export type Row = { weekday: number; startTime: string; seats: number };

export const TUESDAY = { weekday: 2, startTime: "09:00", seats: 8 };

export const FRIDAY = { weekday: 5, startTime: "14:30", seats: 6 };

/** The form on the fixture's week, unless a test gives it another. */
export function formWith(
  Component: typeof ScheduleForm,
  over: { weekly?: Row[]; repeatsWeekly?: boolean } = {},
) {
  return render(
    <Component
      experienceId="exp_snorkel"
      repeatsWeekly={over.repeatsWeekly ?? true}
      weekly={over.weekly ?? [TUESDAY, FRIDAY]}
    />,
  );
}

export const save = () =>
  screen.queryByRole("button", { name: "Save the schedule" });

export const undo = () =>
  screen.queryByRole("button", { name: "Undo changes" });

export const chip = (name: string) => screen.getByRole("button", { name });

export const usualTime = () => screen.getAllByLabelText("Leaves at")[0];

export const usualSeats = () => screen.getAllByLabelText("Seats")[0];

/** The weekly rows the first save sent. */
export const sentFrom = (mock: Mock): Row[] =>
  JSON.parse(String((mock.mock.calls[0][1] as FormData).get("weekly")));
