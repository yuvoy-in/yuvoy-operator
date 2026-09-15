"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setSwitch } from "./actions";
import {
  changedLine,
  type NotificationSettings,
} from "@/lib/account/notifications";
import { Panel } from "@/components/ui/panel";

/**
 * Every switch, with what each one covers — yuvoy-operator#46 items 5 and 6.
 *
 * ## Redrawn from the answer, never flipped locally
 *
 * A toggle that flipped its own boolean would be right about the switch and
 * wrong about everything else: `changedAt` and `changedBy` come back with the
 * response, and they are the reason this screen exists in two places. An owner
 * turning a staff member's switch off has to show up on that person's own
 * screen, by name.
 *
 * ## `alwaysSent` is under the list, not left out
 *
 * "Some messages have no switch at all, and `alwaysSent` says which." Five
 * switches read as the whole of what somebody will be told, and they are not.
 */
export function SwitchList({
  initial,
  meId,
  memberId,
}: {
  initial: NotificationSettings;
  /** The signed-in person, so their own changes are not attributed to them. */
  meId: string;
  /** Somebody else's switches, or `null` for your own. */
  memberId: string | null;
}) {
  const [settings, setSettings] = useState(initial);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const router = useRouter();

  function toggle(group: string, on: boolean) {
    setFailure(null);
    start(async () => {
      const result = await setSwitch(memberId, group, on);
      if (!result.ok) {
        setFailure(result.message);
        /*
          A 404 means the person is off the team. The list behind this screen is
          then wrong about more than one switch, so it is re-read rather than
          patched.
        */
        if (result.gone) router.refresh();
        return;
      }
      setSettings(result.settings);
    });
  }

  return (
    <>
      <ul className="space-y-3">
        {settings.switches.map((row) => {
          const who = changedLine(row, meId);
          return (
            <li key={row.group}>
              <Panel className="p-4">
                <label className="flex items-start justify-between gap-4">
                  <span className="min-w-0">
                    <span className="block text-base font-bold">
                      {row.label}
                    </span>
                    {/*
                      The API's own description, rendered as sent. It says who
                      the messages go to, which is how a staff member can tell
                      that a payout summary was never going to reach them.
                    */}
                    <span className="text-forest/80 mt-1 block text-sm">
                      {row.description}
                    </span>
                    {who ? (
                      <span className="text-forest/70 mt-1 block text-xs">
                        {who}
                      </span>
                    ) : null}
                  </span>
                  <input
                    type="checkbox"
                    checked={row.on}
                    disabled={saving}
                    onChange={(e) => toggle(row.group, e.target.checked)}
                    className="accent-terra-deep mt-1 size-6 shrink-0"
                  />
                </label>
              </Panel>
            </li>
          );
        })}
      </ul>

      {failure ? (
        <p role="alert" className="text-terra-deep mt-4 text-sm font-bold">
          {failure}
        </p>
      ) : null}

      {settings.alwaysSent ? (
        <Panel tone="outline" className="mt-6 p-4">
          <p className="text-forest/80 text-sm">{settings.alwaysSent}</p>
        </Panel>
      ) : null}
    </>
  );
}
