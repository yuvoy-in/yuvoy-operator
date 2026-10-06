"use client";

import { useEffect, useState, useTransition } from "react";

/**
 * Try again, for the screens that stand in for a page that failed: the error
 * screen and the global one.
 *
 * ## It reads the page again
 *
 * Both called `reset()`, which draws the failed page again from what the
 * browser already holds and never asks the server. A page whose server
 * render had failed failed again at once, so Try again could only ever
 * answer with the same screen (the stability audit). `retry()` (Next 16.3)
 * reads the page again first, as a refresh does, and `retrying` holds until
 * that read has landed or failed back onto the screen: Next commits it as a
 * transition, and the transition started here is not done until it is in.
 *
 * ## Never with no signal
 *
 * A read that cannot reach the server makes Next fall back to a full browser
 * navigation, and with no network that is the browser's own "no internet"
 * page in place of the screen. So a tap with no signal is kept (`waiting`,
 * for the screen to say so) and tried once the signal is back, the moment a
 * screen's own re-read would run (`RefreshOnFocus`). The traveller app's
 * error screen does the same, so the two products answer alike.
 */
export function useRetry(retry: () => void): {
  tryAgain: () => void;
  retrying: boolean;
  waiting: boolean;
} {
  const [retrying, start] = useTransition();
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (!waiting) return;
    /*
      Once: a connection that flaps can say "online" twice before the screen
      is drawn again, and each would have been a read of the whole page.
    */
    const back = () => {
      setWaiting(false);
      start(() => retry());
    };
    window.addEventListener("online", back, { once: true });
    return () => window.removeEventListener("online", back);
  }, [waiting, retry]);

  const tryAgain = () => {
    if (!navigator.onLine) {
      setWaiting(true);
      return;
    }
    setWaiting(false);
    start(() => retry());
  };

  return { tryAgain, retrying, waiting };
}
