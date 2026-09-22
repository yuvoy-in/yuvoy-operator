/**
 * Notification switches — yuvoy-operator#46 items 5 and 6.
 *
 * ## Everything here is the API's words, not ours
 *
 * `label` and `description` are rendered as sent, and the reason is in the
 * contract: the description says "what the switch covers and who those messages
 * go to. Every person sees every switch, so this is how a staff member can tell
 * that a payout summary was never going to reach them." A portal writing its own
 * copy would have to know which messages reach which role, and it does not.
 *
 * ## Only the switches the API sends, never one it did not
 *
 * The set grows by contract change: `seat_confirmations` arrived at yuvoy-api
 * e7291e3 (yuvoy-operator#94 item 3), a once-a-day list of departures off sale
 * or going off sale because nobody confirmed their seats, on by default. It
 * needs no code here: it is drawn where the API puts it, in the API's words,
 * like the five before it. And an older API that does not send it gets no row,
 * because a row it did not send has no true state: drawn off, it tells
 * somebody they silenced something they never touched, and drawn on, it
 * promises a message that service never sends.
 *
 * ## A switch that is off is not a message that vanishes
 *
 * "A switch that is off does not make a message vanish: it is recorded as not
 * sent, with the reason. Some messages have no switch at all, and `alwaysSent`
 * says which." So `alwaysSent` is drawn under the list rather than dropped: a
 * screen of five switches reads as the whole of what somebody will be told, and
 * it is not.
 */

export interface SwitchRow {
  group: string;
  label: string;
  description: string;
  on: boolean;
  changedAt?: string;
  changedBy?: { id: string; name: string };
}

export interface NotificationSettings {
  userId: string;
  name: string;
  switches: SwitchRow[];
  alwaysSent: string;
}

/** Whatever the API sent, narrowed without inventing a switch. */
export function toSettings(raw: {
  userId?: string;
  name?: string;
  switches?: readonly {
    group?: string;
    label?: string;
    description?: string;
    on?: boolean;
    changedAt?: string;
    changedBy?: { id?: string; name?: string };
  }[];
  alwaysSent?: string;
}): NotificationSettings {
  return {
    userId: raw.userId ?? "",
    name: raw.name ?? "",
    switches: (raw.switches ?? [])
      .filter((s) => typeof s.group === "string" && s.group !== "")
      .map((s) => ({
        group: s.group!,
        /*
          A switch with no words is still a switch: falling back to its group
          name is ugly and honest, and dropping it would hide something that is
          on and sending messages.
        */
        label: s.label ?? s.group!,
        description: s.description ?? "",
        /*
          Absent is ON. "Every switch is on until somebody turns it off", and a
          missing boolean read as off would tell somebody they had silenced
          something they had not.
        */
        on: s.on !== false,
        ...(s.changedAt ? { changedAt: s.changedAt } : {}),
        ...(s.changedBy?.id && s.changedBy.name
          ? { changedBy: { id: s.changedBy.id, name: s.changedBy.name } }
          : {}),
      })),
    alwaysSent: raw.alwaysSent ?? "",
  };
}

/**
 * "Changed by Priya Raut on 14 September", or nothing.
 *
 * Only when somebody ELSE did it (item 5). Your own change needs no
 * attribution: you were there. Somebody else's is the whole point of the line —
 * an owner may turn a staff member's switch off, and that person opening this
 * screen should find out who, not conclude the portal did it on its own.
 */
export function changedLine(
  row: SwitchRow,
  meId: string,
  timeZone = "Asia/Kolkata",
): string | null {
  if (!row.changedBy || !row.changedAt) return null;
  if (row.changedBy.id === meId) return null;
  const when = new Date(row.changedAt);
  if (Number.isNaN(when.getTime())) return null;
  const date = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    timeZone,
  }).format(when);
  return `Changed by ${row.changedBy.name} on ${date}`;
}
