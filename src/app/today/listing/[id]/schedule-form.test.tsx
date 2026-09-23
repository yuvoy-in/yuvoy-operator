import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const saveSchedule = vi.fn();

vi.mock("./actions", () => ({
  saveSchedule: (prev: unknown, form: FormData) => saveSchedule(prev, form),
}));

const { ScheduleForm } = await import("./schedule-form");

beforeEach(() => saveSchedule.mockReset().mockResolvedValue({}));

const TUESDAY = { weekday: 2, startTime: "09:00", seats: 8 };
const FRIDAY = { weekday: 5, startTime: "14:30", seats: 6 };

function form(
  over: {
    weekly?: { weekday: number; startTime: string; seats: number }[];
    repeatsWeekly?: boolean;
  } = {},
) {
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

/*
  The weekly schedule on the listing hub (yuvoy-operator#85 s8). "Save the
  schedule" was the loudest button on the screen, above the departures, with
  nothing to save: the first dark button committed a form nobody had filled
  in. It is drawn once the rows differ from what the listing has.
*/
describe("a schedule nobody has touched", () => {
  it("reads the listing's own rows back, and offers nothing to commit", () => {
    form();

    expect(screen.getAllByLabelText("Day")[0]).toHaveValue("2");
    expect(screen.getAllByLabelText("Time")[1]).toHaveValue("14:30");
    expect(save()).toBeNull();
    expect(undo()).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Remove the weekly schedule" }),
    ).toBeNull();
  });

  it("offers nothing to commit on a listing with no schedule at all", () => {
    form({ weekly: [], repeatsWeekly: false });

    expect(screen.getByText("No weekly schedule.")).toBeInTheDocument();
    expect(save()).toBeNull();
    expect(undo()).toBeNull();
  });
});

describe("a schedule that has been changed", () => {
  it("draws Save once a row differs, beside a way to put it back", () => {
    form();

    fireEvent.change(screen.getAllByLabelText("Seats")[0], {
      target: { value: "10" },
    });
    expect(save()).toBeVisible();
    expect(undo()).toBeVisible();

    fireEvent.click(undo() as HTMLElement);
    expect(screen.getAllByLabelText("Seats")[0]).toHaveValue(TUESDAY.seats);
    expect(save()).toBeNull();
    expect(undo()).toBeNull();
  });

  it("counts an added day, and a removed one, as a change", () => {
    form({ weekly: [], repeatsWeekly: false });

    fireEvent.click(screen.getByRole("button", { name: "Add a day" }));
    expect(save()).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /^Remove/ }));
    expect(save()).toBeNull();
    expect(screen.getByText("No weekly schedule.")).toBeInTheDocument();
  });

  it("sends the whole schedule as one field, in order", () => {
    form();

    fireEvent.change(screen.getAllByLabelText("Time")[0], {
      target: { value: "07:15" },
    });
    fireEvent.click(save() as HTMLElement);

    const sent = saveSchedule.mock.calls[0][1] as FormData;
    expect(sent.get("experienceId")).toBe("exp_snorkel");
    expect(JSON.parse(String(sent.get("weekly")))).toEqual([
      { ...TUESDAY, startTime: "07:15" },
      FRIDAY,
    ]);
  });

  /*
    The row that removes names the day and the time, because "Remove" on its
    own is the same word four times over to anybody not looking at the screen.
  */
  it("names the day each Remove takes off", () => {
    form();

    expect(
      screen.getByRole("button", { name: "Remove Tuesday 09:00" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Remove Friday 14:30" }),
    ).toBeVisible();
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
    for (let i = 0; i < 2; i += 1) {
      fireEvent.click(screen.getAllByRole("button", { name: /^Remove/ })[0]);
    }
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

  it("puts every row back when the change is undone", () => {
    clear();
    fireEvent.click(undo() as HTMLElement);

    expect(screen.getAllByLabelText("Day")).toHaveLength(2);
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
    fireEvent.click(screen.getByRole("button", { name: /^Remove/ }));

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

    fireEvent.change(screen.getAllByLabelText("Seats")[0], {
      target: { value: "10" },
    });
    fireEvent.click(save() as HTMLElement);

    expect(
      await screen.findByText("The weekly schedule is saved"),
    ).toBeInTheDocument();
    expect(screen.getByText("14 departures made, 2 closed.")).toBeVisible();
    expect(
      screen.getByText("Your licence has lapsed, so none of them are on sale."),
    ).toBeVisible();
  });

  it("marks the row the API refused, rather than one sentence over seven", async () => {
    saveSchedule.mockResolvedValue({
      message: "That schedule was not saved.",
      rowProblems: { "weekly[1].startTime": "Times look like 07:00." },
    });
    form();

    fireEvent.change(screen.getAllByLabelText("Seats")[0], {
      target: { value: "10" },
    });
    fireEvent.click(save() as HTMLElement);

    expect(
      await screen.findByText("Times look like 07:00."),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That schedule was not saved.",
    );
  });
});
