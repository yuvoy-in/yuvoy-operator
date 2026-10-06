import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const refresh = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace }),
  // The address as the bar has it, which is what Next's own hook follows.
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const { OnlineOnly } = await import("@/components/ui/online-only");
const { SETTLE_MS } = await import("@/components/ui/use-online");
const { ReadOnlyWhenOffline } = await import("./read-only-when-offline");
const { RefreshOnFocus } = await import("./refresh-on-focus");
const { resetSchedule } = await import("./refresh-schedule");
const { InspectorSheet } = await import("@/app/calendar/inspector-sheet");

let online = true;

beforeEach(() => {
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
});

afterEach(() => {
  // The screen's one re-read schedule lives as long as the page does.
  resetSchedule();
  vi.restoreAllMocks();
  refresh.mockReset();
  replace.mockReset();
  window.history.replaceState(null, "", "/");
});

/** The phone loses or finds its signal, the way a browser says so. */
function goOffline() {
  online = false;
  act(() => {
    window.dispatchEvent(new Event("offline"));
  });
}
function goOnline() {
  online = true;
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
}

/*
  The Calendar with no signal (operator experiment B's offline state): it
  stays readable, nothing that changes something can be pressed, a link that
  needs the server is held with the reason, and it re-reads itself when the
  signal comes back.
*/
describe("controls that change something", () => {
  it("are switched off while there is no signal, and back on after", () => {
    render(
      <OnlineOnly>
        <button type="button">Close this day</button>
        <input aria-label="Seats" />
      </OnlineOnly>,
    );
    expect(
      screen.getByRole("button", { name: "Close this day" }),
    ).toBeEnabled();

    goOffline();
    expect(
      screen.getByRole("button", { name: "Close this day" }),
    ).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Seats" })).toBeDisabled();

    goOnline();
    expect(
      screen.getByRole("button", { name: "Close this day" }),
    ).toBeEnabled();
  });

  it("are not announced as a group of their own", () => {
    const { container } = render(
      <OnlineOnly>
        <button type="button">Add departures</button>
      </OnlineOnly>,
    );
    expect(container.querySelector("fieldset")).toHaveAttribute("role", "none");
  });
});

describe("a screen that is read-only with no signal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Long enough for a change of signal to be said (`useSettledOnline`). */
  function settle() {
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
  }

  function board() {
    return render(
      <ReadOnlyWhenOffline what="The calendar">
        <a href="/calendar?week=2026-10-12">Next week</a>
        <a href="tel:+918121657657">Call Yuvoy</a>
        <a href="#board-week">Skip to the week</a>
        <a href="https://example.com/help" target="_blank" rel="noreferrer">
          Help
        </a>
      </ReadOnlyWhenOffline>,
    );
  }

  it("says nothing while there is a signal, and lets every link go", () => {
    board();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    const next = screen.getByRole("link", { name: "Next week" });
    expect(fireEvent.click(next)).toBe(true);
  });

  it("says it is read-only, and holds a link that needs the server", () => {
    board();
    goOffline();
    settle();
    expect(screen.getByRole("status")).toHaveTextContent(
      "No signal The calendar is read-only until you are back online. What it shows may be out of date.",
    );

    const next = screen.getByRole("link", { name: "Next week" });
    // `false` is a click whose default was prevented.
    expect(fireEvent.click(next)).toBe(false);
    expect(screen.getByRole("status")).toHaveTextContent(
      "That opens once you are back online.",
    );
  });

  it("still lets a phone call, a spot on this page and a new tab through", () => {
    board();
    goOffline();
    for (const name of ["Call Yuvoy", "Skip to the week", "Help"]) {
      expect(fireEvent.click(screen.getByRole("link", { name }))).toBe(true);
    }
  });

  it("starts plain again the next time the signal drops", () => {
    board();
    goOffline();
    fireEvent.click(screen.getByRole("link", { name: "Next week" }));
    goOnline();
    settle();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    goOffline();
    settle();
    expect(screen.getByRole("status")).toHaveTextContent("No signal");
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "That opens once you are back online.",
    );
  });

  /*
    The notice sits in the flow, above the board: on a connection that drops
    and comes back inside a couple of seconds, each blip used to push the
    whole board down and pull it back under the thumb (the stability audit,
    P3-1). Controls still switch off at once; only the words wait.
  */
  it("does not move the board for a blip, and still switches writes off at once", () => {
    render(
      <ReadOnlyWhenOffline what="The calendar">
        <OnlineOnly>
          <button type="button">Close this day</button>
        </OnlineOnly>
      </ReadOnlyWhenOffline>,
    );
    goOffline();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(
      screen.getByRole("button", { name: "Close this day" }),
    ).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(SETTLE_MS - 500);
    });
    goOnline();
    settle();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(
      screen.getByRole("button", { name: "Close this day" }),
    ).toBeEnabled();
  });

  it("says why a held link did nothing at once, before the drop has settled", () => {
    board();
    goOffline();
    expect(
      fireEvent.click(screen.getByRole("link", { name: "Next week" })),
    ).toBe(false);
    expect(screen.getByRole("status")).toHaveTextContent(
      "No signal The calendar is read-only until you are back online.",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "That opens once you are back online.",
    );
  });
});

describe("re-reading the screen", () => {
  it("never refreshes with no signal, and re-reads once it is back", () => {
    render(<RefreshOnFocus />);
    goOffline();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(refresh).not.toHaveBeenCalled();

    goOnline();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes on focus with a signal, as before", () => {
    render(<RefreshOnFocus />);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("the inspector with no signal", () => {
  function inspector(title = "07:00 Try-dive at Nemo Reef", dep = "slot_dawn") {
    return (
      <InspectorSheet
        dep={dep}
        title={title}
        closeHref="/calendar?day=2026-10-15"
      >
        <button type="button">Stop selling it</button>
      </InspectorSheet>
    );
  }
  /** The board opened on a departure, as its address names it. */
  function opened(dep = "slot_dawn") {
    window.history.replaceState(
      null,
      "",
      `/calendar?day=2026-10-15&dep=${dep}`,
    );
  }

  it("closes on the phone, with the same address in the bar", async () => {
    opened();
    render(inspector());
    goOffline();
    expect(
      screen.getByRole("button", { name: "Stop selling it" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(window.location.pathname + window.location.search).toBe(
      "/calendar?day=2026-10-15",
    );
  });

  /*
    O08 A (approved 4 Oct 2026): closing answers the tap. The address loses
    the departure at once and the board re-reads behind the sheet, instead
    of the sheet waiting on a navigation and vanishing when it landed.
  */
  it("leaves on the tap with a signal, the address follows at once, and the board re-reads", async () => {
    opened();
    render(inspector());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(window.location.pathname + window.location.search).toBe(
      "/calendar?day=2026-10-15",
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows a different departure opened where one was closed offline", async () => {
    opened();
    const { rerender } = render(inspector());
    goOffline();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    goOnline();
    opened("slot_snorkel");
    rerender(inspector("09:00 Snorkel trip to Elephant Beach", "slot_snorkel"));
    expect(
      screen.getByRole("dialog", {
        name: "09:00 Snorkel trip to Elephant Beach",
      }),
    ).toBeInTheDocument();
  });

  it("shows the same departure again once the address opens it again", async () => {
    opened();
    const { rerender } = render(inspector());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Gone until the address names it again: a re-render alone keeps it shut.
    rerender(inspector());
    expect(screen.queryByRole("dialog")).toBeNull();

    opened();
    rerender(inspector());
    expect(
      screen.getByRole("dialog", { name: "07:00 Try-dive at Nemo Reef" }),
    ).toBeInTheDocument();
  });
});
