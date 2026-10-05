import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { BookingLine } from "@/lib/money/bookings";

vi.mock("./list-actions", () => ({ loadMoreBookings: vi.fn() }));

/*
  A booking's state, seen to change on the list (O03 A, approved 4 Oct 2026;
  the named integration change: the list remembers the chips it last drew).

  The list's memory lives for as long as the portal is open, so each test
  takes a fresh copy of the module.
*/
let BookingList: typeof import("./booking-list").BookingList;
beforeEach(async () => {
  vi.resetModules();
  ({ BookingList } = await import("./booking-list"));
});
afterEach(() => vi.useRealTimers());

function booking(over: Partial<BookingLine>): BookingLine {
  return {
    id: "bkg_daniel",
    reference: "YV-DAN1EL22",
    name: "Daniel Okafor",
    guests: 1,
    experience: "Try-dive at Nemo Reef",
    startsAt: "2026-10-15T03:00:00Z",
    timezone: "Asia/Kolkata",
    state: "confirmed",
    ...over,
  };
}
const ASHA = booking({
  id: "bkg_asha",
  reference: "YV-4K2M9P7Q",
  name: "Asha Menon",
  guests: 2,
});

function list(items: BookingLine[]) {
  return (
    <BookingList
      view="upcoming"
      filters={{ q: "", experienceId: "", from: "", to: "" }}
      initial={{ items, complete: true }}
      today="2026-10-15"
      tomorrow="2026-10-16"
    />
  );
}
const said = () =>
  screen
    .queryAllByText(/./, { selector: "[aria-live=polite] > span" })
    .map((el) => el.textContent);
const rowOf = (name: string) =>
  screen.getByText(name).closest("a") as HTMLElement;

describe("a state that changes on a re-read", () => {
  it("is taken in place, cross-faded, marked and said once", () => {
    const { rerender } = render(list([booking({}), ASHA]));
    rerender(list([booking({ state: "arrived" }), ASHA]));

    const daniel = rowOf("Daniel Okafor");
    expect(daniel).toHaveTextContent("Checked in");
    expect(screen.getByText("Checked in")).toHaveClass("motion-in");
    expect(daniel.querySelector(":scope > .motion-mark")).not.toBeNull();
    expect(rowOf("Asha Menon").querySelector(".motion-mark")).toBeNull();
    expect(said()).toEqual(["Daniel Okafor: Checked in."]);
  });

  it("never adds, drops or moves a row under the thumb", () => {
    const { rerender } = render(list([booking({}), ASHA]));
    const sofia = booking({ id: "bkg_sofia", name: "Sofia Alves" });
    rerender(list([sofia, ASHA]));
    expect(screen.queryByText("Sofia Alves")).toBeNull();
    expect(screen.getByText("Daniel Okafor")).toBeInTheDocument();
    expect(said()).toEqual([]);
  });

  it("says nothing when the answer changed nothing", () => {
    const { rerender, container } = render(list([booking({}), ASHA]));
    rerender(list([booking({}), ASHA]));
    expect(container.querySelector(".motion-mark")).toBeNull();
    expect(said()).toEqual([]);
  });
});

describe("a list drawn afresh", () => {
  it("marks nothing the first time it is drawn", () => {
    const { container } = render(list([booking({}), ASHA]));
    expect(container.querySelector(".motion-mark")).toBeNull();
  });

  it("marks, and does not say, a row whose chip is not the one it last drew", () => {
    // The list as it was before the operator opened Daniel's booking.
    const first = render(list([booking({}), ASHA]));
    first.unmount();
    // Back from the booking, where the state changed.
    render(list([booking({ state: "arrived" }), ASHA]));
    expect(
      rowOf("Daniel Okafor").querySelector(":scope > .motion-mark"),
    ).not.toBeNull();
    expect(rowOf("Asha Menon").querySelector(".motion-mark")).toBeNull();
    // Drawn afresh, the chip simply appears, and it is usually the
    // operator's own change: nothing to say.
    expect(screen.getByText("Checked in")).not.toHaveClass("motion-in");
    expect(said()).toEqual([]);
  });
});
