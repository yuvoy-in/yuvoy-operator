import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SETTLE_MS, useOnline, useSettledOnline } from "./use-online";

/*
  The signal a screen SAYS it has (the stability audit, P3-1). The no-signal
  strips sit in the flow of the page, so on a jetty connection that drops and
  returns every few seconds each blip pushed the rows down and pulled them
  back under the operator's thumb. What is said now waits for a change to
  hold; what is let through (`useOnline`) never waits.
*/

let online = true;

beforeEach(() => {
  vi.useFakeTimers();
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The phone loses or finds its signal, the way a browser says so. */
function signal(now: boolean) {
  online = now;
  act(() => {
    window.dispatchEvent(new Event(now ? "online" : "offline"));
  });
}

function wait(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** Every value the screen was drawn with, in order. */
let said: string[] = [];

function Probe() {
  const raw = useOnline();
  const settled = useSettledOnline();
  said.push(settled ? "connected" : "no signal");
  return (
    <>
      <p data-testid="raw">{raw ? "connected" : "no signal"}</p>
      <p data-testid="said">{settled ? "connected" : "no signal"}</p>
    </>
  );
}

beforeEach(() => {
  said = [];
});

describe("the signal a screen says", () => {
  it("says no signal once the drop has held for the window, and not before", () => {
    render(<Probe />);
    signal(false);
    // What is let through follows the phone at once.
    expect(screen.getByTestId("raw")).toHaveTextContent("no signal");

    wait(SETTLE_MS - 1);
    expect(screen.getByTestId("said")).toHaveTextContent("connected");
    wait(1);
    expect(screen.getByTestId("said")).toHaveTextContent("no signal");
  });

  it("says nothing at all about a drop that comes back inside the window", () => {
    render(<Probe />);
    signal(false);
    wait(SETTLE_MS - 500);
    signal(true);
    wait(SETTLE_MS * 3);
    expect(said).not.toContain("no signal");
  });

  it("says the signal is back once it has held, and not about a return that drops again", () => {
    render(<Probe />);
    signal(false);
    wait(SETTLE_MS);
    expect(screen.getByTestId("said")).toHaveTextContent("no signal");

    // Back for a second, then gone again: still no signal, throughout.
    said = [];
    signal(true);
    wait(1_000);
    signal(false);
    wait(SETTLE_MS * 3);
    expect(said).not.toContain("connected");

    signal(true);
    wait(SETTLE_MS - 1);
    expect(screen.getByTestId("said")).toHaveTextContent("no signal");
    wait(1);
    expect(screen.getByTestId("said")).toHaveTextContent("connected");
  });

  it("says no signal at once on a screen drawn with none, which is not a change", () => {
    online = false;
    render(<Probe />);
    expect(screen.getByTestId("said")).toHaveTextContent("no signal");
  });

  it("leaves no timer running once the screen has gone", () => {
    const { unmount } = render(<Probe />);
    signal(false);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
