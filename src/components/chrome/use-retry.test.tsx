import {
  act,
  startTransition,
  Suspense,
  use,
  useEffect,
  useState,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useRetry } from "./use-retry";

/*
  Try again on the error screens (the stability audit). They called
  `reset()`, which draws the failed page again from what the browser holds,
  so a server render that had failed failed again at once. And a read sent
  with no signal is Next's full browser navigation, onto the browser's own
  "no internet" page.
*/

let online = true;

beforeEach(() => {
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** The phone finds its signal, the way a browser says so. */
function signalBack() {
  online = true;
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
}

function Probe({ retry }: { retry: () => void }) {
  const { tryAgain, retrying, waiting } = useRetry(retry);
  return (
    <>
      <button type="button" onClick={tryAgain}>
        {retrying ? "Trying again" : "Try again"}
      </button>
      <p data-testid="waiting">{waiting ? "waiting" : "not waiting"}</p>
    </>
  );
}

const tap = () =>
  act(() => {
    screen.getByRole("button").click();
  });

describe("Try again", () => {
  it("reads the page again", () => {
    const retry = vi.fn();
    render(<Probe retry={retry} />);
    tap();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("with no signal, reads nothing until the signal is back, then reads once", () => {
    online = false;
    const retry = vi.fn();
    render(<Probe retry={retry} />);
    tap();
    expect(retry).not.toHaveBeenCalled();
    expect(screen.getByTestId("waiting")).toHaveTextContent("waiting");

    signalBack();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("waiting")).toHaveTextContent("not waiting");
  });

  it("reads once for two taps and a signal that comes back twice", () => {
    online = false;
    const retry = vi.fn();
    render(<Probe retry={retry} />);
    tap();
    tap();
    act(() => {
      online = true;
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online"));
    });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("reads nothing for a screen that is gone before the signal is back", () => {
    online = false;
    const retry = vi.fn();
    const { unmount } = render(<Probe retry={retry} />);
    tap();
    unmount();
    signalBack();
    expect(retry).not.toHaveBeenCalled();
  });

  it("stays busy until the read has landed", async () => {
    /*
      Next's router, in miniature: a refresh sets the router's state to the
      read's promise inside a transition, and the tree waits on it with
      `use`. `retrying` is that transition's.
    */
    let land: () => void = () => {};
    let setRead: (read: Promise<void>) => void = () => {};
    function Router({ children }: { children: React.ReactNode }) {
      const [read, set] = useState<Promise<void>>(Promise.resolve());
      useEffect(() => {
        setRead = set;
      }, []);
      use(read);
      return children;
    }
    const retry = () =>
      startTransition(() =>
        setRead(
          new Promise<void>((resolve) => {
            land = resolve;
          }),
        ),
      );

    await act(async () => {
      render(
        <Suspense>
          <Router>
            <Probe retry={retry} />
          </Router>
        </Suspense>,
      );
    });
    // Awaited: the tree suspends on the read inside this tap.
    await act(async () => {
      screen.getByRole("button").click();
    });
    expect(screen.getByRole("button")).toHaveTextContent("Trying again");

    await act(async () => land());
    expect(screen.getByRole("button")).toHaveTextContent("Try again");
  });
});
