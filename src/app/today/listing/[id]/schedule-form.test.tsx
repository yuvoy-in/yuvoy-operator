import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { watchMotion } from "@/lib/motion/testing";

const saveSchedule = vi.fn();

vi.mock("./actions", () => ({
  saveSchedule: (prev: unknown, form: FormData) => saveSchedule(prev, form),
}));

const { ScheduleForm } = await import("./schedule-form");

beforeEach(() => saveSchedule.mockReset().mockResolvedValue({}));

type Row = { weekday: number; startTime: string; seats: number };
const TUESDAY = { weekday: 2, startTime: "09:00", seats: 8 };
const FRIDAY = { weekday: 5, startTime: "14:30", seats: 6 };

function form(over: { weekly?: Row[]; repeatsWeekly?: boolean } = {}) {
  return render(
    <ScheduleForm
      experienceId="exp_snorkel"
      repeatsWeekly={over.repeatsWeekly ?? true}
      weekly={over.weekly ?? [TUESDAY, FRIDAY]}
    />,
  );
}

const save = () => screen.queryByRole("button", { name: "Save the schedule" });
const undo = () => screen.queryByRole("button", { name: "Undo changes" });
const chip = (name: string) => screen.getByRole("button", { name });
const usualTime = () => screen.getAllByLabelText("Leaves at")[0];
const usualSeats = () => screen.getAllByLabelText("Seats")[0];
const sent = (): Row[] =>
  JSON.parse(String((saveSchedule.mock.calls[0][1] as FormData).get("weekly")));

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

/*
  The audit before release, O2: "Removing a weekday and time closes what this
  schedule made at it." Only an empty save asked; a save that dropped Tuesday
  09:00 closed a season of Tuesdays with no question at all.
*/
describe("a save that stops a weekday and time selling", () => {
  it("asks first, naming what stops taking bookings and what stays", () => {
    form();
    fireEvent.change(usualTime(), { target: { value: "07:15" } });
    fireEvent.click(save() as HTMLElement);

    expect(saveSchedule).not.toHaveBeenCalled();
    expect(screen.getByText("Save the schedule?")).toHaveFocus();
    expect(
      screen.getByText(
        "Departures it made on Tuesdays at 09:00 stop taking new bookings. Bookings already on them stay.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save and close them" }),
    ).toHaveClass("border-2", "border-terra-deep");
  });

  it("names every time an unticked day and a changed time take away", () => {
    form();
    fireEvent.change(usualTime(), { target: { value: "07:15" } });
    fireEvent.click(chip("Friday"));
    fireEvent.click(save() as HTMLElement);

    expect(
      screen.getByText(
        "Departures it made on Tuesdays at 09:00 and Fridays at 14:30 stop taking new bookings. Bookings already on them stay.",
      ),
    ).toBeInTheDocument();
  });

  it("goes back to editing, with nothing sent, and focus on Save", () => {
    form();
    fireEvent.change(usualTime(), { target: { value: "07:15" } });
    fireEvent.click(save() as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

    expect(saveSchedule).not.toHaveBeenCalled();
    expect(save()).toHaveFocus();
  });

  it("asks again about the week as it is after another edit", () => {
    form();
    fireEvent.change(usualTime(), { target: { value: "07:15" } });
    fireEvent.click(save() as HTMLElement);
    // Put the time back: nothing is removed now, so there is nothing to ask.
    fireEvent.change(usualTime(), { target: { value: "09:00" } });
    expect(screen.queryByText("Save the schedule?")).toBeNull();
  });

  it("saves a change of seats at once: it closes nothing", () => {
    form();
    fireEvent.change(usualSeats(), { target: { value: "10" } });
    expect(save()).toHaveAttribute("type", "submit");
  });
});

/*
  `PUT /experiences/{id}/schedule` replaces what is there, so an empty save on
  a listing that HAS a schedule removes every departure it made. Closed to new
  bookings, not cancelled: an operator who believes otherwise does not turn up.
*/
describe("clearing a schedule the listing has", () => {
  function clear() {
    form();
    fireEvent.click(chip("Tuesday"));
    fireEvent.click(chip("Friday"));
  }

  it("asks quietly first, and the confirm says what stays booked", () => {
    clear();

    const ask = screen.getByRole("button", {
      name: "Remove the weekly schedule",
    });
    expect(ask).toHaveClass("text-terra-deep");
    expect(ask).not.toHaveClass("border-2");
    expect(save()).toBeNull();

    fireEvent.click(ask);
    expect(
      screen.getByText(
        "Departures it made are closed to new bookings. Bookings on them stay.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove schedule" })).toHaveClass(
      "border-2",
      "border-terra-deep",
    );
  });

  it("keeps the schedule when the question is answered with Keep it", () => {
    clear();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove the weekly schedule" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));

    expect(saveSchedule).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Remove the weekly schedule" }),
    ).toBeVisible();
  });

  it("puts every day back when the change is undone", () => {
    clear();
    fireEvent.click(undo() as HTMLElement);

    expect(chip("Tuesday")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Friday")).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.queryByRole("button", { name: "Remove the weekly schedule" }),
    ).toBeNull();
  });

  /*
    An empty save on a listing whose schedule does not repeat removes nothing
    an operator has to be warned about, so it is a save rather than a question.
  */
  it("is a plain save when the listing does not repeat weekly", () => {
    form({ weekly: [TUESDAY], repeatsWeekly: false });
    fireEvent.click(chip("Tuesday"));

    expect(save()).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Remove the weekly schedule" }),
    ).toBeNull();
  });
});

describe("what saving says afterwards", () => {
  it("prints the API's own sentence, and whether any of it can be bought", async () => {
    saveSchedule.mockResolvedValue({
      done: true,
      note: "14 departures made, 2 closed.",
      notOnSaleDetail: "Your licence has lapsed, so none of them are on sale.",
    });
    form();

    fireEvent.change(usualSeats(), { target: { value: "10" } });
    fireEvent.click(save() as HTMLElement);

    expect(
      await screen.findByText("The weekly schedule is saved"),
    ).toBeInTheDocument();
    expect(screen.getByText("14 departures made, 2 closed.")).toBeVisible();
    expect(
      screen.getByText("Your licence has lapsed, so none of them are on sale."),
    ).toBeVisible();
  });

  it("names every row the API refused, by its day and time", async () => {
    saveSchedule.mockResolvedValue({
      message: "Some rows need fixing.",
      rowProblems: ["Tuesday at 09:00: Seats are 1 to 200."],
    });
    form();

    fireEvent.change(usualSeats(), { target: { value: "10" } });
    fireEvent.click(save() as HTMLElement);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Some rows need fixing.");
    expect(alert).toHaveTextContent("Tuesday at 09:00: Seats are 1 to 200.");
  });
});

/*
  O06 B (approved 4 Oct 2026): the question fades in where Save was; put
  away (Keep editing, or an edit that makes it moot) it fades out as a held
  copy while what replaced it fades in; the receipt fades in with no copy
  (`useStillConfirm`).
*/
describe("the question, arriving and leaving still", () => {
  let motion: ReturnType<typeof watchMotion>;
  beforeEach(() => {
    motion = watchMotion();
  });
  afterEach(() => motion.restore());

  function ask() {
    form();
    fireEvent.change(usualTime(), { target: { value: "07:15" } });
    fireEvent.click(save() as HTMLElement);
  }

  it("fades the question in, and Keep editing fades a held copy out as Save comes back", () => {
    ask();
    const question = screen.getByText("Save the schedule?");
    expect(motion.fadeOf(question.parentElement)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(motion.fadeOf(save()!.parentElement)).toBeDefined();
    const [copy] = motion.copies();
    expect(copy).toHaveTextContent("Save the schedule?");
    expect(motion.exitOf(copy)).toBeDefined();
  });

  it("puts the question away the same way when an edit makes it moot", () => {
    ask();
    // The time put back: nothing is removed, and nothing is left to save.
    fireEvent.change(usualTime(), { target: { value: "09:00" } });
    // Gone from the page: what is left of it is a picture a screen reader
    // never meets.
    expect(
      screen.queryByRole("button", { name: "Save and close them" }),
    ).toBeNull();
    expect(motion.copies()[0]).toHaveTextContent("Save the schedule?");
  });

  it("fades the receipt in, with no copy of the question", async () => {
    saveSchedule.mockResolvedValue({ done: true });
    ask();
    fireEvent.click(
      screen.getByRole("button", { name: "Save and close them" }),
    );
    const receipt = await screen.findByText("The weekly schedule is saved");
    expect(motion.fadeOf(receipt.parentElement)).toBeDefined();
    expect(motion.copies()).toHaveLength(0);
  });
});
