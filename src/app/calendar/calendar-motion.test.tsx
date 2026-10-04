import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const { DayStrip } = await import("./day-strip");
const { InspectorPresence, InspectorSheet, useNoteSeatsSaved } =
  await import("./inspector-sheet");

afterEach(() => {
  refresh.mockReset();
  window.history.replaceState(null, "", "/");
});

/*
  The calendar (O08 A, approved 4 Oct 2026): the day answers the press, the
  inspector leaves the way it came and is held on the page until it has,
  and a row whose seats were saved in it is marked as it goes.
*/
const DAYS = ["2026-10-15", "2026-10-16", "2026-10-17"].map((day, i) => ({
  day,
  href: `/calendar?day=${day}`,
  name: `Day ${i + 1}`,
  weekday: ["Thu", "Fri", "Sat"][i],
  date: String(15 + i),
  today: i === 0,
  on: i !== 2,
}));

describe("the day strip", () => {
  it("fills the tapped day in the frame it is pressed, before the server answers", () => {
    render(<DayStrip days={DAYS} open="2026-10-15" />);
    const friday = screen.getByRole("link", { name: "Day 2" });
    fireEvent.click(friday);
    expect(friday).toHaveAttribute("aria-current", "page");
    expect(friday.className).toMatch(/\bbg-forest\b/);
    expect(screen.getByRole("link", { name: "Day 1" })).not.toHaveAttribute(
      "aria-current",
    );
    // Its colours change in 150ms, the mark under the date with them.
    expect(friday.className).toMatch(/\bduration-150\b/);
  });

  it("follows the address once it answers, and the history when it decides", () => {
    const { rerender } = render(<DayStrip days={DAYS} open="2026-10-15" />);
    fireEvent.click(screen.getByRole("link", { name: "Day 2" }));
    rerender(<DayStrip days={DAYS} open="2026-10-16" />);
    expect(screen.getByRole("link", { name: "Day 2" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    fireEvent.click(screen.getByRole("link", { name: "Day 3" }));
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByRole("link", { name: "Day 2" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("leaves a day opened in a new tab to the browser", () => {
    render(<DayStrip days={DAYS} open="2026-10-15" />);
    const friday = screen.getByRole("link", { name: "Day 2" });
    fireEvent.click(friday, { ctrlKey: true });
    expect(friday).not.toHaveAttribute("aria-current");
  });
});

function Saves({ id }: { id: string }) {
  const note = useNoteSeatsSaved();
  return (
    <button type="button" onClick={() => note(id)}>
      Set seats
    </button>
  );
}

function board(opened: boolean) {
  return (
    <>
      <ul>
        <li data-departure="slot_dawn">07:00 Try-dive</li>
        <li data-departure="slot_noon">11:30 Try-dive</li>
      </ul>
      <InspectorPresence>
        {opened ? (
          <InspectorSheet
            dep="slot_dawn"
            title="07:00 Try-dive at Nemo Reef"
            closeHref="/calendar?day=2026-10-15"
          >
            <Saves id="slot_dawn" />
          </InspectorSheet>
        ) : null}
      </InspectorPresence>
    </>
  );
}

describe("the inspector", () => {
  it("is held on the page after the board stops drawing it, until it has left", async () => {
    window.history.replaceState(null, "", "/calendar?dep=slot_dawn");
    const { rerender } = render(board(true));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // A step back: the address lets it go, and so does the server.
    window.history.replaceState(null, "", "/calendar");
    rerender(board(false));
    // Still drawn, leaving: inert, and nothing in it answers.
    expect(screen.getByRole("dialog").parentElement).toHaveAttribute("inert");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("marks the row whose seats were saved in it, as it goes", async () => {
    window.history.replaceState(null, "", "/calendar?dep=slot_dawn");
    render(board(true));
    fireEvent.click(screen.getByRole("button", { name: "Set seats" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const dawn = screen.getByText("07:00 Try-dive");
    expect(dawn.querySelector(".motion-mark")).not.toBeNull();
    expect(
      screen.getByText("11:30 Try-dive").querySelector(".motion-mark"),
    ).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("marks nothing when nothing was saved", async () => {
    window.history.replaceState(null, "", "/calendar?dep=slot_dawn");
    const { container } = render(board(true));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(container.querySelector(".motion-mark")).toBeNull();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
