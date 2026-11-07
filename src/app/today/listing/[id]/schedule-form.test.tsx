import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  TUESDAY,
  FRIDAY,
  save,
  undo,
  chip,
  usualTime,
  usualSeats,
  formWith,
  sentFrom,
} from "./schedule-form-kit";

const saveSchedule = vi.fn();

vi.mock("./actions", () => ({
  saveSchedule: (prev: unknown, form: FormData) => saveSchedule(prev, form),
}));

const { ScheduleForm } = await import("./schedule-form");

beforeEach(() => saveSchedule.mockReset().mockResolvedValue({}));

const form = (over?: Parameters<typeof formWith>[1]) =>
  formWith(ScheduleForm, over);

const sent = () => sentFrom(saveSchedule);

/*
  The weekly schedule, picked (yuvoy-operator#111): days as chips, a time and
  seats for all of them, and the days that differ underneath. The fixture
  reads back as Tuesday on the usual 09:00 with 8 seats, and Friday with its
  own 14:30 and 6.
*/
describe("a schedule nobody has touched", () => {
  it("reads the listing's own week back, and offers nothing to commit", () => {
    form();

    expect(chip("Tuesday")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Friday")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Monday")).toHaveAttribute("aria-pressed", "false");
    expect(usualTime()).toHaveValue("09:00");
    expect(usualSeats()).toHaveValue(8);
    // Friday differs, so what it has is on screen rather than folded away.
    expect(screen.getByLabelText("Leaves at, Friday")).toHaveValue("14:30");
    expect(screen.getByLabelText("Seats, Friday")).toHaveValue(6);

    expect(save()).toBeNull();
    expect(undo()).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Remove the weekly schedule" }),
    ).toBeNull();
  });

  it("offers nothing to commit on a listing with no schedule at all", () => {
    form({ weekly: [], repeatsWeekly: false });

    expect(screen.getByText("No weekly schedule.")).toBeInTheDocument();
    for (const day of ["Monday", "Sunday"]) {
      expect(chip(day)).toHaveAttribute("aria-pressed", "false");
    }
    expect(save()).toBeNull();
    expect(undo()).toBeNull();
  });

  it("keeps a second departure on a day that already has one", () => {
    const SUNDAY_EARLY = { weekday: 0, startTime: "07:00", seats: 8 };
    const SUNDAY_LATE = { weekday: 0, startTime: "15:00", seats: 8 };
    form({ weekly: [SUNDAY_EARLY, SUNDAY_LATE, TUESDAY] });

    // Sunday has two, and both are read back as Sunday's own.
    const sunday = screen.getAllByLabelText("Leaves at, Sunday");
    expect(sunday.map((time) => (time as HTMLInputElement).value)).toEqual([
      "07:00",
      "15:00",
    ]);
    expect(save()).toBeNull();

    // Another day ticked: both of Sunday's go with it, untouched.
    fireEvent.click(chip("Monday"));
    fireEvent.click(save() as HTMLElement);
    expect(sent()).toEqual([
      SUNDAY_EARLY,
      SUNDAY_LATE,
      { ...TUESDAY, weekday: 1 },
      TUESDAY,
    ]);
  });
});

describe("the days", () => {
  it("are toggle buttons a keyboard can work", async () => {
    const user = userEvent.setup();
    form({ weekly: [], repeatsWeekly: false });

    chip("Monday").focus();
    await user.keyboard(" ");
    expect(chip("Monday")).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("{Enter}");
    expect(chip("Monday")).toHaveAttribute("aria-pressed", "false");
  });

  it("show their word and are named the whole day", () => {
    form();
    // "Mon" on screen, "Monday" by name: the name starts with the word.
    expect(chip("Monday")).toHaveTextContent(/^Mon$/);
  });

  it("are all ticked by Every day, which then has nothing left to do", () => {
    form({ weekly: [], repeatsWeekly: false });

    fireEvent.click(screen.getByRole("button", { name: "Every day" }));

    for (const day of [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]) {
      expect(chip(day)).toHaveAttribute("aria-pressed", "true");
    }
    expect(screen.queryByRole("button", { name: "Every day" })).toBeNull();
  });
});

describe("a schedule that has been changed", () => {
  it("draws Save once the week differs, beside a way to put it back", () => {
    form();

    fireEvent.change(usualSeats(), { target: { value: "10" } });
    expect(save()).toBeVisible();
    expect(undo()).toBeVisible();

    fireEvent.click(undo() as HTMLElement);
    expect(usualSeats()).toHaveValue(TUESDAY.seats);
    expect(save()).toBeNull();
    expect(undo()).toBeNull();
  });

  it("counts a ticked day, and unticking it again, as a change and then none", () => {
    form({ weekly: [], repeatsWeekly: false });

    fireEvent.click(chip("Monday"));
    expect(save()).toBeVisible();

    fireEvent.click(chip("Monday"));
    expect(save()).toBeNull();
    expect(screen.getByText("No weekly schedule.")).toBeInTheDocument();
  });

  it("applies one time and one seat count to every day ticked, in one body", () => {
    form({ weekly: [], repeatsWeekly: false });

    for (const day of ["Monday", "Wednesday", "Friday"]) {
      fireEvent.click(chip(day));
    }
    fireEvent.change(usualTime(), { target: { value: "07:30" } });
    fireEvent.change(usualSeats(), { target: { value: "10" } });
    fireEvent.click(save() as HTMLElement);

    const sentForm = saveSchedule.mock.calls[0][1] as FormData;
    expect(sentForm.get("experienceId")).toBe("exp_snorkel");
    expect(sent()).toEqual([
      { weekday: 1, startTime: "07:30", seats: 10 },
      { weekday: 3, startTime: "07:30", seats: 10 },
      { weekday: 5, startTime: "07:30", seats: 10 },
    ]);
  });

  it("gives a day its own time, starting from the usual one", () => {
    form();

    fireEvent.click(chip("Tuesday is different"));
    // A copy of the usual departure: nothing has changed yet.
    expect(screen.getByLabelText("Leaves at, Tuesday")).toHaveValue("09:00");
    expect(save()).toBeNull();

    fireEvent.change(screen.getByLabelText("Leaves at, Tuesday"), {
      target: { value: "10:00" },
    });
    // Tuesday's 09:00 is the one that goes, so the save asks first.
    fireEvent.click(save() as HTMLElement);
    fireEvent.click(
      screen.getByRole("button", { name: "Save and close them" }),
    );
    expect(sent()).toEqual([{ ...TUESDAY, startTime: "10:00" }, FRIDAY]);
  });

  it("adds a second time to a day, and names each Remove by what it takes off", () => {
    form();

    fireEvent.click(
      screen.getByRole("button", { name: "Add another time on Friday" }),
    );
    const times = screen.getAllByLabelText("Leaves at, Friday");
    fireEvent.change(times[1], { target: { value: "17:00" } });

    expect(
      screen.getByRole("button", { name: "Remove Friday 14:30" }),
    ).toBeVisible();
    fireEvent.click(save() as HTMLElement);
    expect(sent()).toEqual([
      TUESDAY,
      FRIDAY,
      { ...FRIDAY, startTime: "17:00" },
    ]);
  });
});

describe("what would be refused, held back before it is sent", () => {
  it("asks for a time, and says why Save waits", () => {
    form();

    fireEvent.click(screen.getByRole("button", { name: "Add another time" }));

    expect(
      screen.getByText("Pick a time for each departure."),
    ).toBeInTheDocument();
    expect(save()).toBeDisabled();
    expect(save()).toHaveAccessibleDescription(
      "Fix what is marked above to save.",
    );
  });

  it("never folds a day's problem out of sight", async () => {
    form();
    fireEvent.click(
      screen.getByRole("button", { name: "Add another time on Friday" }),
    );
    const different = screen
      .getByText("Different on some days")
      .closest("details") as HTMLDetailsElement;

    // Folded by hand, as a tap on its summary would.
    different.open = false;
    fireEvent(different, new Event("toggle"));

    await screen.findByText("Pick a time for each departure.");
    expect(different.open).toBe(true);
    expect(screen.getByText("Pick a time for each departure.")).toBeVisible();
  });

  it("refuses one time twice on a day", () => {
    form();

    fireEvent.click(screen.getByRole("button", { name: "Add another time" }));
    fireEvent.change(screen.getAllByLabelText("Leaves at")[1], {
      target: { value: "09:00" },
    });

    expect(screen.getByText("09:00 is listed twice.")).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });
});
