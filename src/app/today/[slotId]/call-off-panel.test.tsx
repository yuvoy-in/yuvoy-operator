import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

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

  it("names the time and what happens, over the loud button", () => {
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

    expect(
      screen.getByRole("heading", { name: "Call off 09:00?" }),
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
      screen.getByLabelText("Type the departure id to confirm"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it("keeps its fields apart when two departures are asked about at once", () => {
    render(
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
    const boxes = screen.getAllByLabelText("Type the departure id to confirm");
    expect(boxes).toHaveLength(2);
    expect(new Set(boxes.map((box) => box.id)).size).toBe(2);
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
