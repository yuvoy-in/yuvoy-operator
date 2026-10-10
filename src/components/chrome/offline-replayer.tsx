"use client";

import { useEffect, useSyncExternalStore } from "react";
import { markAttendance } from "@/app/today/[slotId]/actions";
import { recordCashCollected } from "@/app/bookings/cash-actions";
import {
  offlineWrites,
  replayWrites,
  wasEarlier,
  writesFor,
  type Senders,
} from "@/lib/site/offline-writes";
import { useChrome } from "./chrome-context";
import { useScheduledRefresh } from "./refresh-schedule";

/** How often to look again while something is kept and nothing said "online". */
const RETRY_MS = 20_000;

/**
 * The two writes as the server actions send them, read back into what the
 * replay needs: sent (and whether somebody else was first), keep and try
 * again, or refused for good with the reason.
 */
export const senders: Senders = {
  async arrived(write) {
    const form = new FormData();
    form.set("bookingId", write.bookingId);
    form.set("slotId", write.slotId);
    form.set("outcome", "arrived");
    /*
      The tap's time, kept with the write, so the manifest says when they
      were seen and not when the signal came back (yuvoy-api#263). The same
      on every attempt, so every send of one check-in is one body.
    */
    form.set("seenAt", new Date(write.at).toISOString());
    try {
      const answer = await markAttendance({}, form);
      if (answer.retryable) return { kind: "retry" };
      if (answer.message) return { kind: "refused", message: answer.message };
      return answer.arrivedAt && wasEarlier(answer.arrivedAt, write.at)
        ? { kind: "sent", earlier: { at: answer.arrivedAt } }
        : { kind: "sent" };
    } catch {
      // The request never came back: the phone is offline again. Or the
      // session ended, and Next is already on its way to sign in: kept, it
      // goes once they are back (party-row.test.tsx).
      return { kind: "retry" };
    }
  },
  async cash(write) {
    const form = new FormData();
    form.set("bookingId", write.bookingId);
    form.set("slotId", write.slotId);
    form.set("mode", write.mode);
    if (write.mode === "less") form.set("amount", write.amount);
    try {
      const answer = await recordCashCollected({}, form);
      if (answer.retryable) return { kind: "retry" };
      const recorded = answer.recorded;
      if (!recorded) {
        return {
          kind: "refused",
          message: answer.message ?? "That could not be recorded.",
        };
      }
      return recorded.alreadyRecorded &&
        wasEarlier(recorded.collectedAt, write.at)
        ? {
            kind: "sent",
            earlier: {
              at: recorded.collectedAt,
              collectedPaise: recorded.collectedPaise,
            },
          }
        : { kind: "sent" };
    } catch {
      return { kind: "retry" };
    }
  },
};

/**
 * Sends what was kept on this phone offline, from whichever screen is open
 * (boarding mode, operator experiment D).
 *
 * Mounted once in the chrome, so a check-in kept at the jetty goes even if the
 * operator closed the app there and opens it later on Today. It runs while
 * this person has something kept: as it mounts, when the browser says the
 * signal is back, and every 20 seconds besides, because a phone on a dead wifi
 * says "online" and never fires the event. Then the screen re-reads, so what
 * was sent shows as done.
 */
export function OfflineReplayer() {
  const { userId } = useChrome();
  /*
    Through the screen's one schedule, so it counts as the re-read it is:
    `RefreshOnFocus` skips its own for a few seconds and its minute counts
    from this one. Forced, because a re-read already on its way was asked
    before these writes landed and would not show them.
  */
  const refresh = useScheduledRefresh();
  const list = useSyncExternalStore(
    offlineWrites.subscribe,
    offlineWrites.list,
    offlineWrites.serverList,
  );
  const waiting = writesFor(list, userId).length > 0;

  useEffect(() => {
    if (!userId || !waiting) return;
    const run = async () => {
      if (!navigator.onLine) return;
      const { sent } = await replayWrites(userId, senders);
      /*
        Not skipped when this effect has been torn down meanwhile: the send
        that empties the list is what tears it down (nothing is waiting any
        more), and that is exactly the send whose result must be shown.
      */
      if (sent > 0 && navigator.onLine) refresh(true);
    };
    void run();
    window.addEventListener("online", run);
    const timer = setInterval(run, RETRY_MS);
    return () => {
      window.removeEventListener("online", run);
      clearInterval(timer);
    };
  }, [userId, waiting, refresh]);

  return null;
}
