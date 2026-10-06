import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

/*
  One schedule for re-reading the screen (the stability audit, P2-4).

  A tab coming back fired `focus` and `visibilitychange` together, and each
  re-read the whole screen while a tap waited behind both; the minute's own
  re-read was not moved by either, and the replayer re-read again after
  sending what was kept on the phone.
*/

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { RefreshOnFocus } = await import("./refresh-on-focus");
const { INTERVAL_MS, QUIET_MS, due, hold, resetSchedule, useScheduledRefresh } =
  await import("./refresh-schedule");

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  resetSchedule();
  vi.useRealTimers();
  vi.restoreAllMocks();
  refresh.mockReset();
});

function comeBack() {
  act(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
}
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe("coming back to the app", () => {
  it("re-reads once, not once per event", () => {
    render(<RefreshOnFocus />);
    comeBack();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("drops a trigger a few seconds after the last re-read, and takes the next", () => {
    render(<RefreshOnFocus />);
    comeBack();
    wait(QUIET_MS - 1_000);
    comeBack();
    expect(refresh).toHaveBeenCalledTimes(1);

    wait(1_000);
    comeBack();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe("the minute", () => {
  it("re-reads every minute while nothing else does", () => {
    render(<RefreshOnFocus />);
    wait(INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    wait(INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("counts from a re-read on focus, rather than following it a second later", () => {
    render(<RefreshOnFocus />);
    wait(INTERVAL_MS - 1_000);
    comeBack();
    expect(refresh).toHaveBeenCalledTimes(1);

    // Where the old minute fell: nothing, the screen was read a second ago.
    wait(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    wait(INTERVAL_MS - 1_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("waits while the phone is offline, and then a minute more", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<RefreshOnFocus />);
    wait(INTERVAL_MS);
    expect(refresh).not.toHaveBeenCalled();
  });
});

/** The replayer's re-read after it has sent what was kept. */
function Replayer({ send }: { send: (go: () => void) => void }) {
  const go = useScheduledRefresh();
  send(() => go(true));
  return null;
}

describe("the replayer's re-read", () => {
  it("counts as one: the screen's own triggers wait, and the minute counts from it", () => {
    let replay = () => {};
    render(
      <>
        <RefreshOnFocus />
        <Replayer send={(go) => (replay = go)} />
      </>,
    );
    wait(30_000);
    act(() => replay());
    expect(refresh).toHaveBeenCalledTimes(1);

    // The signal is back and the tab is in front: already read.
    comeBack();
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    // And the minute is a minute from the replay, not from the page opening.
    wait(INTERVAL_MS - 30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    wait(30_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("is never dropped, because what it sent has to show", () => {
    let replay = () => {};
    render(
      <>
        <RefreshOnFocus />
        <Replayer send={(go) => (replay = go)} />
      </>,
    );
    comeBack();
    act(() => replay());
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe("a re-read on its way", () => {
  it("holds every trigger until it has landed", () => {
    const release = hold();
    expect(due(Date.now())).toBe(false);
    release();
    expect(due(Date.now())).toBe(true);
    // Released twice is still released once.
    release();
    const again = hold();
    expect(due(Date.now())).toBe(false);
    again();
  });
});
