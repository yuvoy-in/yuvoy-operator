"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { useOnline, useSettledOnline } from "@/components/ui/use-online";
import { panelClass } from "@/components/ui/panel";
import { marketTime } from "@/lib/format/market-time";
import {
  lastBatchFor,
  offlineWrites,
  outcomeLine,
  savedItems,
  savedLine,
  writesFor,
} from "@/lib/site/offline-writes";
import { useChrome } from "./chrome-context";
import { useHeldLinks } from "./read-only-when-offline";

/**
 * One departure's screens with no signal: boarding and the manifest
 * (operator experiment D, approved 3 Oct 2026). A quiet strip that never
 * lies, in a status region that is always mounted:
 *
 *   - offline: what is kept on this phone, "3 check-ins and ₹9,000 taken are
 *     saved on this phone. They send when the signal is back.", and what waits
 *     for the signal (closing out, messages, cancelling);
 *   - back online, while it goes: "Sending 3 check-ins and ₹9,000 taken,
 *     kept on this phone.";
 *   - once it has gone: "Sent at 06:41.", and anybody who had already been
 *     checked in, or whose cash was already recorded, before this phone's tap.
 *
 * A link to another page of this app is held while offline, as on the
 * Calendar: Next would otherwise fall back to the browser's "no internet"
 * page and take this screen, and the strip, with it.
 *
 * The strip says the signal has gone, or come back, once the change has held
 * for a moment (`useSettledOnline`), as the Calendar's notice does: it sits
 * above the manifest, so a flapping connection moved every row under the
 * thumb at the jetty. The check-ins and cash it describes follow the phone's
 * own answer at once, and a held link is said at once.
 */
export function KeptOnThisPhone({
  slotId,
  timezone,
  names,
  children,
}: {
  slotId: string;
  timezone: string;
  /**
   * The parties on this departure by booking id. Nothing kept on the phone
   * carries a name (owner ruling, 4 Oct 2026), so the screen supplies them.
   */
  names: Readonly<Record<string, string>>;
  children: ReactNode;
}) {
  const online = useOnline();
  const { userId } = useChrome();
  const { held, onClickCapture } = useHeldLinks(online);
  const offline = !useSettledOnline() || held;
  const list = useSyncExternalStore(
    offlineWrites.subscribe,
    offlineWrites.list,
    offlineWrites.serverList,
  );
  const outcomes = useSyncExternalStore(
    offlineWrites.subscribe,
    offlineWrites.outcomes,
    offlineWrites.serverOutcomes,
  );
  const kept = writesFor(list, userId, slotId);
  const saved = savedLine(kept);
  const items = savedItems(kept);
  const last = lastBatchFor(outcomes, slotId);
  const sent = last.filter((o) => o.result === "sent");
  const lines = last
    .map((o) => outcomeLine(o, timezone, (id) => names[id] || "A party"))
    .filter((line): line is string => line !== null);
  const sentAt =
    sent.length > 0
      ? marketTime(
          new Date(Math.max(...sent.map((o) => o.answeredAt))).toISOString(),
          timezone,
        )
      : null;

  let strip: ReactNode = null;
  if (offline) {
    strip = (
      <div className={panelClass("alert", "p-4")}>
        <p className="text-terra-deep text-base font-bold text-balance">
          No signal
        </p>{" "}
        <p className="text-forest/80 leading-body mt-1 text-sm text-pretty">
          {saved
            ? `${saved} They send when the signal is back.`
            : "Check-ins and cash you take are kept on this phone and sent when the signal is back."}{" "}
          Closing out, messages and cancelling wait for the signal.
          {held ? " That opens once you are back online." : null}
        </p>
      </div>
    );
  } else if (saved) {
    strip = (
      <div className={panelClass("raised", "p-4")}>
        <p className="text-base font-bold text-balance">Sending</p>{" "}
        <p className="text-forest/80 leading-body mt-1 text-sm text-pretty">
          Sending {items?.phrase}, kept on this phone.
        </p>
      </div>
    );
  } else if (sentAt || lines.length > 0) {
    strip = (
      <div className={panelClass(lines.length > 0 ? "alert" : "done", "p-4")}>
        {sentAt ? (
          <p className="text-base font-bold text-balance tabular-nums">
            What was kept on this phone was sent at {sentAt}.
          </p>
        ) : null}
        {lines.map((line) => (
          <p
            key={line}
            className="text-forest/80 leading-body mt-1 text-sm text-pretty"
          >
            {line}
          </p>
        ))}
      </div>
    );
  }

  return (
    <div onClickCapture={onClickCapture}>
      <div
        role="status"
        className={strip ? "sticky top-2 z-20 mt-5" : "sr-only"}
      >
        {strip}
      </div>
      {children}
    </div>
  );
}
