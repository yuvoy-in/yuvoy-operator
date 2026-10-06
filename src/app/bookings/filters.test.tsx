import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Filters } from "@/lib/bookings/list";

/*
  Clear undid itself (the stability audit, P1-2).

  The search box was seeded from the address once and stayed mounted when
  the address changed. The empty state's Clear is a link: it emptied the
  address, the box kept "asha", and the debounce put it back 300ms later.
*/

const replace = vi.fn();
let address = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => address,
}));

const { BookingFilters } = await import("./filters");
const { PillPanel, PillSwap } = await import("./pill-row");

const NONE: Filters = { q: "", experienceId: "", from: "", to: "" };
const TODAY = "2026-10-06";
const TOMORROW = "2026-10-07";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  replace.mockReset();
  address = new URLSearchParams();
});

function at(filters: Filters) {
  address = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value),
  );
  return (
    <BookingFilters
      filters={filters}
      view="upcoming"
      today={TODAY}
      tomorrow={TOMORROW}
      listings={[]}
    />
  );
}

const box = () =>
  screen.getByLabelText("Guest name or booking reference") as HTMLInputElement;

describe("the address is the truth", () => {
  it("keeps a Clear from a link, rather than putting the search back", () => {
    const { rerender } = render(at({ ...NONE, q: "asha" }));
    expect(box()).toHaveValue("asha");

    // The empty state's Clear: a link to the same pill with nothing set.
    rerender(at(NONE));
    act(() => vi.advanceTimersByTime(1000));

    expect(box()).toHaveValue("");
    expect(replace).not.toHaveBeenCalled();
  });

  it("follows back to an earlier search", () => {
    const { rerender } = render(at({ ...NONE, q: "asha" }));
    rerender(at({ ...NONE, q: "ravi" }));
    act(() => vi.advanceTimersByTime(1000));

    expect(box()).toHaveValue("ravi");
    expect(replace).not.toHaveBeenCalled();
  });

  it("puts the date pickers away when the range goes from the address", () => {
    const { rerender } = render(
      at({ ...NONE, from: "2026-10-12", to: "2026-10-20" }),
    );
    expect(screen.getByLabelText("From")).toBeInTheDocument();

    rerender(at(NONE));
    expect(screen.queryByLabelText("From")).toBeNull();
    expect(screen.getByLabelText("Which dates")).toHaveValue("any");
  });

  it("still sends what is typed, and is not thrown off by the address catching up", () => {
    const { rerender } = render(at(NONE));
    fireEvent.change(box(), { target: { value: "as" } });
    act(() => vi.advanceTimersByTime(300));
    expect(replace).toHaveBeenLastCalledWith("/bookings?q=as&view=upcoming", {
      scroll: false,
    });

    // More typing while that search is on its way, then it arrives.
    fireEvent.change(box(), { target: { value: "asha" } });
    rerender(at({ ...NONE, q: "as" }));
    expect(box()).toHaveValue("asha");

    act(() => vi.advanceTimersByTime(300));
    expect(replace).toHaveBeenLastCalledWith("/bookings?q=asha&view=upcoming", {
      scroll: false,
    });
    rerender(at({ ...NONE, q: "asha" }));
    act(() => vi.advanceTimersByTime(1000));
    expect(replace).toHaveBeenCalledTimes(2);
    expect(box()).toHaveValue("asha");
  });

  it("keeps a Clear from a link after the address once agreed with the box", () => {
    const { rerender } = render(at(NONE));
    // Typed, and the address arrives with the same search from elsewhere.
    fireEvent.change(box(), { target: { value: "asha" } });
    rerender(at({ ...NONE, q: "asha" }));
    rerender(at(NONE));
    act(() => vi.advanceTimersByTime(1000));

    expect(box()).toHaveValue("");
    expect(replace).not.toHaveBeenCalled();
  });
});

/*
  A search on one bar of signal replaced the address outside any transition,
  so the old rows sat there looking like the answer for as long as the server
  took (the stability audit, P3-2). The router moves inside a transition; here
  the new address never lands, as on a slow answer.
*/
describe("the rows while a search is on its way", () => {
  it("say they are waiting once it is slow, as they do for a pill", () => {
    replace.mockImplementation(() => new Promise(() => {}));
    render(
      <PillSwap>
        {at(NONE)}
        <PillPanel view="upcoming">
          <p>Rows for upcoming</p>
        </PillPanel>
      </PillSwap>,
    );
    const rows = screen.getByText("Rows for upcoming").parentElement!;

    fireEvent.change(box(), { target: { value: "asha" } });
    act(() => vi.advanceTimersByTime(300));
    expect(replace).toHaveBeenCalledWith("/bookings?q=asha&view=upcoming", {
      scroll: false,
    });
    act(() => vi.advanceTimersByTime(299));
    expect(rows).not.toHaveAttribute("aria-busy");
    act(() => vi.advanceTimersByTime(1));
    expect(rows).toHaveAttribute("aria-busy", "true");
  });
});
