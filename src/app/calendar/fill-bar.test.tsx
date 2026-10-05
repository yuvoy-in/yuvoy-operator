import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EASE } from "@/lib/motion";
import type { OperatorSlot } from "@/lib/day/types";
import { FillBar } from "./fill-bar";
import { noteSeatsSent } from "./seats-sent";

const setCapacity = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("./actions", () => ({
  setCapacity: (prev: unknown, form: FormData) => setCapacity(prev, form),
  recordOfflineSale: vi.fn(async () => ({})),
  takeBackOfflineSale: vi.fn(async () => ({})),
  closeDeparture: vi.fn(async () => ({})),
}));

const { SeatsForm } = await import("./departure-controls");

/*
  The desktop board's fill bar (O08 A, approved 4 Oct 2026): "on the desktop
  board the bar would scale from the left, 200ms --ease-move" when the
  operator sets a departure's seats, and only then. Under reduced motion it
  simply changes; the row's mark as the inspector leaves is the inspector's.
*/

let played: {
  el: Element;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
}[] = [];

function reduce(on: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: on && query === "(prefers-reduced-motion: reduce)",
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => {
  played = [];
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    writable: true,
    value(
      this: Element,
      frames: Keyframe[],
      options: KeyframeAnimationOptions,
    ) {
      played.push({ el: this, frames, options });
      return {
        finished: Promise.resolve(),
        cancel() {},
      } as unknown as Animation;
    },
  });
  reduce(false);
  setCapacity.mockReset();
});

afterEach(() => {
  delete (Element.prototype as unknown as Record<string, unknown>).animate;
  vi.unstubAllGlobals();
});

const bar = (container: HTMLElement) =>
  container.querySelector("span > span") as HTMLElement;

describe("the fill bar on the desktop board", () => {
  it("draws the share sold, from the left, and moves nothing on the first paint", () => {
    const { container } = render(
      <FillBar departure="slot_1" people={4} seats={8} />,
    );
    expect(bar(container).style.width).toBe("50%");
    expect(bar(container)).toHaveClass("origin-left");
    expect(played).toHaveLength(0);
  });

  it("grows from the old fill to the new when the operator set the seats", () => {
    const { container, rerender } = render(
      <FillBar departure="slot_2" people={4} seats={8} />,
    );
    noteSeatsSent("slot_2", 5);
    rerender(<FillBar departure="slot_2" people={4} seats={5} />);

    expect(bar(container).style.width).toBe("80%");
    expect(played).toHaveLength(1);
    expect(played[0].el).toBe(bar(container));
    // Laid out at 80%, played back from 50%: the old fill over the new.
    expect(played[0].frames).toEqual([
      { transform: "scaleX(0.625)" },
      { transform: "none" },
    ]);
    expect(played[0].options).toMatchObject({
      duration: 200,
      easing: EASE.move,
    });
  });

  it("starts a shorter bar past its new end, which its track clips", () => {
    const { container, rerender } = render(
      <FillBar departure="slot_3" people={4} seats={8} />,
    );
    noteSeatsSent("slot_3", 10);
    rerender(<FillBar departure="slot_3" people={4} seats={10} />);
    expect(played[0].frames[0]).toEqual({ transform: "scaleX(1.25)" });
    expect(bar(container).parentElement).toHaveClass("overflow-hidden");
  });

  it("does not move for a change the operator did not make", () => {
    const { rerender } = render(
      <FillBar departure="slot_4" people={4} seats={8} />,
    );
    // Somebody booked, and another login set the seats.
    rerender(<FillBar departure="slot_4" people={5} seats={8} />);
    rerender(<FillBar departure="slot_4" people={5} seats={10} />);
    expect(played).toHaveLength(0);
  });

  it("does not move for a count other than the one sent", () => {
    const { rerender } = render(
      <FillBar departure="slot_5" people={4} seats={8} />,
    );
    noteSeatsSent("slot_5", 10);
    rerender(<FillBar departure="slot_5" people={4} seats={12} />);
    expect(played).toHaveLength(0);
  });

  it("simply changes under reduced motion, and never replays later", () => {
    reduce(true);
    const { container, rerender } = render(
      <FillBar departure="slot_6" people={4} seats={8} />,
    );
    noteSeatsSent("slot_6", 5);
    rerender(<FillBar departure="slot_6" people={4} seats={5} />);
    expect(bar(container).style.width).toBe("80%");
    expect(played).toHaveLength(0);

    reduce(false);
    rerender(<FillBar departure="slot_6" people={4} seats={8} />);
    rerender(<FillBar departure="slot_6" people={4} seats={5} />);
    expect(played).toHaveLength(0);
  });

  it("is told the count by Set seats before it is sent", async () => {
    setCapacity.mockResolvedValue({ slotId: "slot_7", seats: 10 });
    const slot: OperatorSlot = {
      id: "slot_7",
      title: "Sky diving at key west",
      startsAt: "2026-09-24T03:30:00Z",
      timezone: "Asia/Kolkata",
      seats: 8,
      sold: 4,
      remaining: 4,
      bookingMode: "allotment",
      status: "open",
      onSale: true,
    };
    const user = userEvent.setup();
    const board = (seats: number) => (
      <>
        <SeatsForm slot={{ ...slot, seats }} />
        <FillBar departure="slot_7" people={4} seats={seats} />
      </>
    );
    const { rerender } = render(board(8));
    await user.clear(screen.getByLabelText("Seats offered"));
    await user.type(screen.getByLabelText("Seats offered"), "10");
    await user.click(screen.getByRole("button", { name: "Set seats" }));
    await screen.findByText("Now offering 10.");

    // What the re-read board draws.
    rerender(board(10));
    expect(played.some((p) => p.frames[0]?.transform === "scaleX(1.25)")).toBe(
      true,
    );
  });
});
