import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { watchMotion } from "@/lib/motion/testing";
import {
  TUESDAY,
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

/*
  The stability audit, P1-1. A seat count sent with the keyboard's Go keeps
  the focus in its box, and React leaves a focused number field's default
  alone, so the reset after a refusal took the box back to the count on file
  while the next save still sent the new one.
*/
describe("a refused save", () => {
  it("shows the seats it would send again, sent with Go from the box", async () => {
    saveSchedule.mockResolvedValueOnce({
      message: "No signal. The schedule was not saved.",
    });
    form();
    // Typed with the box focused, and sent with Go, which leaves it there.
    const seats = usualSeats() as HTMLInputElement;
    seats.focus();
    fireEvent.change(seats, { target: { value: "10" } });
    await act(async () => {
      seats.form?.requestSubmit();
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No signal. The schedule was not saved.",
    );
    expect(usualSeats()).toHaveValue(10);
    expect(sent()[0].seats).toBe(10);
  });

  it("says no signal in place when the request never came back", async () => {
    saveSchedule.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    form();
    fireEvent.change(usualSeats(), { target: { value: "10" } });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Save the schedule" }),
      );
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No signal. The schedule was not saved.",
    );
    expect(usualSeats()).toHaveValue(10);
  });
});
