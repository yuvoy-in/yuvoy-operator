import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { watchMotion } from "@/lib/motion/testing";

const callOffDeparture = vi.fn();

vi.mock("./actions", () => ({
  callOffDeparture: (prev: unknown, form: FormData) =>
    callOffDeparture(prev, form),
}));

const { CallOffPanel } = await import("./call-off-panel");

afterEach(() => callOffDeparture.mockReset());

/*
  Calling a departure off (yuvoy-operator#88 s3, #81 t5). It read "This
  departure cannot run" and sat alone at the foot of the manifest in the same
  shape as every other control. It is quiet text now, in the product's own
  words, and the confirm names the time and what happens to the people on it.

  Named, not typed (owner ruling, 3 Oct 2026): the departure's id used to be
  typed back. The question names the boat and its day now, and the panel
  sends its own departure with the one loud tap.
*/
describe("calling a departure off", () => {
  it("is quiet text in the product's words until it is asked for", () => {
    render(
      <CallOffPanel slotId="slot_dawn" alreadyCalledOff={false} canManage />,
    );
    const trigger = screen.getByRole("button", {
      name: "Call this departure off",
    });
    expect(trigger).toHaveClass("text-terra-deep");
    expect(trigger).not.toHaveClass("border-2");
    expect(screen.queryByText(/cannot run/)).toBeNull();
  });

  it("names the boat, its day and what happens, over the loud button", () => {
    render(
      <CallOffPanel
        slotId="slot_dawn"
        alreadyCalledOff={false}
        canManage
        time="09:00"
        title="Try-dive at Nemo Reef"
        day="today"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Call this departure off" }),
    );

    expect(
      screen.getByRole("heading", {
        name: "Call off the 09:00 Try-dive at Nemo Reef, today?",
      }),
    ).toBeInTheDocument();
    // True to what the API does (#97): online money back, cash from the till.
    expect(screen.getByText(/Everyone booked is cancelled/)).toHaveTextContent(
      "everything paid online is refunded in full",
    );
    expect(
      screen.getByText(/Anyone who paid you in cash gets it back from you/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Call it off" })).toHaveClass(
      "border-2",
      "border-terra-deep",
    );
    // Nothing to type: the only field to write in is the note.
    expect(screen.getAllByRole("textbox")).toEqual([
      screen.getByLabelText("Anything to add (optional)"),
    ]);
  });

  it("names as much of the departure as it knows", () => {
    render(
      <CallOffPanel
        slotId="slot_dawn"
        alreadyCalledOff={false}
        canManage
        time="09:00"
        startOpen
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Call off the 09:00?" }),
    ).toBeInTheDocument();
  });

  it("asks without a time when the departure has none to name", () => {
    render(
      <CallOffPanel
        slotId="slot_dawn"
        alreadyCalledOff={false}
        canManage
        startOpen
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Call off this departure?" }),
    ).toBeInTheDocument();
  });

  it("opens straight on the confirm, and hands Keep it back, for a screen that already asked", () => {
    const onKeep = vi.fn();
    render(
      <CallOffPanel
        slotId="slot_dawn"
        alreadyCalledOff={false}
        canManage
        time="09:00"
        startOpen
        onKeep={onKeep}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Call off the 09:00?" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it("keeps its fields apart when two departures are asked about at once", () => {
    const { container } = render(
      <>
        <CallOffPanel
          slotId="slot_a"
          alreadyCalledOff={false}
          canManage
          startOpen
        />
        <CallOffPanel
          slotId="slot_b"
          alreadyCalledOff={false}
          canManage
          startOpen
        />
      </>,
    );
    const notes = screen.getAllByLabelText("Anything to add (optional)");
    expect(notes).toHaveLength(2);
    expect(new Set(notes.map((note) => note.id)).size).toBe(2);
    // And each confirms its own departure, not the other's.
    expect(
      [
        ...container.querySelectorAll<HTMLInputElement>("[name=confirmSlotId]"),
      ].map((input) => input.value),
    ).toEqual(["slot_a", "slot_b"]);
  });

  it("tells a staff login who can, rather than offering it", () => {
    render(
      <CallOffPanel
        slotId="slot_dawn"
        alreadyCalledOff={false}
        canManage={false}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(
      screen.getByText(/needs an owner, an admin or a manager/),
    ).toBeInTheDocument();
  });
});

/*
  The audit before release, O1: the trigger took itself away when the confirm
  opened, and Keep took itself away on the way out, so a keyboard or
  screen-reader user's focus fell to the page each time.
*/
describe("focus in the call-off confirm", () => {
  it("lands on the question, and Keep it puts it back on the trigger", async () => {
    const user = userEvent.setup();
    render(
      <CallOffPanel
        slotId="slot_dawn"
        alreadyCalledOff={false}
        canManage
        time="09:00"
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Call this departure off" }),
    );
    expect(
      screen.getByRole("heading", { name: "Call off the 09:00?" }),
    ).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(
      screen.getByRole("button", { name: "Call this departure off" }),
    ).toHaveFocus();
  });
});

/*
  The audit before release, O8: on the listing hub Keep it takes the whole
  panel away, and it could while the call-off ran, so the call-off happened
  and its receipt (the refund, the cash to hand back) was never seen.
*/
describe("while the call-off runs", () => {
  it("sends its own departure, cannot be kept, and tells the screen that opened it to hold it", async () => {
    let finish: (value: unknown) => void = () => {};
    callOffDeparture.mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const busy: boolean[] = [];
    const user = userEvent.setup();
    render(
      <CallOffPanel
        slotId="slot_dawn"
        alreadyCalledOff={false}
        canManage
        time="09:00"
        startOpen
        onKeep={() => {}}
        onBusyChange={(b) => busy.push(b)}
      />,
    );
    await user.click(screen.getAllByRole("radio")[0]);
    await user.click(screen.getByRole("button", { name: "Call it off" }));

    const sent = callOffDeparture.mock.calls[0][1] as FormData;
    expect(sent.get("slotId")).toBe("slot_dawn");
    expect(sent.get("confirmSlotId")).toBe("slot_dawn");
    expect(screen.getByRole("button", { name: "Keep it" })).toBeDisabled();
    expect(busy.at(-1)).toBe(true);
    finish({});
    await screen.findByRole("button", { name: "Keep it" });
  });
});

/*
  O06 B (approved 4 Oct 2026): the one act that cannot be undone arrives
  still. Nothing moves; each new look fades in where the last stood, and the
  confirm Keep it puts away leaves as a held copy over the text that is
  already back. A first paint fades nothing (`useStillConfirm`).
*/
describe("the confirm, arriving and leaving", () => {
  let motion: ReturnType<typeof watchMotion>;
  beforeEach(() => {
    motion = watchMotion();
  });
  afterEach(() => motion.restore());

  it("fades the confirm in where the text was, and nothing on the first paint", () => {
    const { container } = render(
      <CallOffPanel slotId="slot_dawn" alreadyCalledOff={false} canManage />,
    );
    expect(motion.played).toHaveLength(0);
    fireEvent.click(
      screen.getByRole("button", { name: "Call this departure off" }),
    );
    expect(motion.fadeOf(container.querySelector("form"))).toBeDefined();
  });

  it("opens still when the screen that drew it already asked", () => {
    render(
      <CallOffPanel
        slotId="slot_dawn"
        alreadyCalledOff={false}
        canManage
        startOpen
        onKeep={() => {}}
      />,
    );
    // The screen that asked fades it in (the listing hub's row).
    expect(motion.played).toHaveLength(0);
  });

  it("leaves a held copy of the confirm fading over the text that is back", () => {
    render(
      <CallOffPanel
        slotId="slot_dawn"
        alreadyCalledOff={false}
        canManage
        time="09:00"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Call this departure off" }),
    );
    fireEvent.click(screen.getAllByRole("radio")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));

    // The real change has landed: the text is back, and fades in.
    const trigger = screen.getByRole("button", {
      name: "Call this departure off",
    });
    expect(motion.fadeOf(trigger.parentElement)).toBeDefined();
    expect(
      screen.queryByRole("heading", { name: "Call off the 09:00?" }),
    ).toBeNull();

    // The confirm as it was, choice and all, as a picture only.
    const [copy] = motion.copies();
    expect(copy).toHaveTextContent("Call off the 09:00?");
    expect(copy.inert).toBe(true);
    expect(
      (copy.querySelectorAll("input[type=radio]")[1] as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(copy.querySelectorAll("[name]")).toHaveLength(0);
    expect(motion.exitOf(copy)).toBeDefined();
  });

  it("fades the receipt in once the call-off has gone through, with no copy", async () => {
    callOffDeparture.mockResolvedValue({
      result: {
        bookingsCancelled: 3,
        guestsAffected: 5,
        refundedPaise: 2250000,
        holdsReleased: 0,
      },
    });
    const user = userEvent.setup();
    const { container } = render(
      <CallOffPanel slotId="slot_dawn" alreadyCalledOff={false} canManage />,
    );
    await user.click(
      screen.getByRole("button", { name: "Call this departure off" }),
    );
    await user.click(screen.getAllByRole("radio")[0]);
    await user.click(screen.getByRole("button", { name: "Call it off" }));
    await screen.findByRole("heading", { name: "What that did" });
    expect(motion.fadeOf(container.querySelector("section"))).toBeDefined();
    expect(motion.copies()).toHaveLength(0);
  });
});

/*
  The stability audit, P1-1. React resets a form when its action resolves,
  refusals included, so "No signal. Nothing was cancelled." came back over an
  unanswered "Why?" and an empty note, on the screen a storm is handled from.
*/
describe("a refused call-off", () => {
  async function callItOff() {
    render(
      <CallOffPanel
        slotId="slot_dawn"
        alreadyCalledOff={false}
        canManage
        startOpen
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Weather" }));
    fireEvent.change(screen.getByLabelText("Anything to add (optional)"), {
      target: { value: "Swell over the reef" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Call it off" }));
    });
  }

  it("keeps the reason and the note", async () => {
    callOffDeparture.mockResolvedValue({
      message: "No signal. Nothing was cancelled.",
    });
    await callItOff();

    expect(
      await screen.findByText("No signal. Nothing was cancelled."),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Weather" })).toBeChecked();
    expect(screen.getByLabelText("Anything to add (optional)")).toHaveValue(
      "Swell over the reef",
    );
  });

  it("says no signal in place when the request never came back", async () => {
    callOffDeparture.mockRejectedValue(new TypeError("Failed to fetch"));
    await callItOff();

    expect(
      await screen.findByText("No signal. Nothing was cancelled."),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Weather" })).toBeChecked();
  });
});
