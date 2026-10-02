import { dedash } from "@/lib/format/dedash";

/**
 * What happened to each half of a change to a published listing (D-032.3).
 *
 * Since D-032.3 an edit has two destinations. The operator owns the commercial
 * reality (price and its basis, duration, party size, where to meet, the pin,
 * how it sells) and those fields go live the moment they are sent. Yuvoy owns
 * what the listing PROMISES (its name, its wording, what is included and
 * required, the safety notes) and those are read by a person first.
 * `POST /experiences/{id}/revisions` answers `200` when everything applied and
 * `201` when anything is with us, with `applied` and `inReview` naming the
 * fields and `next` saying in one sentence which half is where.
 *
 * The portal said "Your change is with us. It stays on sale on the old terms
 * until we answer." to every one of them, so an operator who corrected their
 * price was told the old price was still selling when the new one already was.
 * The contract says "Render both lists", and this is what renders them.
 */
export interface RevisionOutcome {
  /** Field names live now, in the order the form shows them. */
  applied: string[];
  /** Field names a person at Yuvoy will read first. */
  inReview: string[];
  /** The API's own sentence about which half is where, when it sent one. */
  next?: string;
  /** That bookings already made are unaffected, when the API said so. */
  note?: string;
}

function names(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/**
 * The answer, read defensively.
 *
 * `next` is used only when it is a sentence. Before D-032.3 it was a code
 * (`wait_for_review`), which an operator must never see, so a value without a
 * space is treated as absent and the screen says its own sentence instead.
 */
export function readRevisionOutcome(data: unknown): RevisionOutcome {
  const body = (data ?? {}) as Record<string, unknown>;
  const next =
    typeof body.next === "string" && body.next.trim().includes(" ")
      ? dedash(body.next.trim())
      : undefined;
  const note =
    typeof body.note === "string" && body.note.trim()
      ? dedash(body.note.trim())
      : undefined;
  return {
    applied: names(body.applied),
    inReview: names(body.inReview),
    ...(next ? { next } : {}),
    ...(note ? { note } : {}),
  };
}

/**
 * Each field the API can name, as the edit form labels it.
 *
 * A field this build does not know is shown by its own name rather than
 * dropped: an operator told "These are live now" over an empty list would be
 * told less than the API said.
 */
const FIELD_LABELS: Record<string, string> = {
  title: "Name",
  summary: "One line about it",
  description: "What happens on the day",
  category: "Category",
  activityType: "Activity",
  destination: "Where it runs",
  meetingPoint: "Where to meet",
  meetingLandmark: "What to look for",
  // One pin, two numbers. Named once.
  meetingLat: "Pin on the map",
  meetingLng: "Pin on the map",
  inclusions: "What is included",
  requirements: "What a traveller needs",
  safetyNotes: "Safety notes",
  screenerKey: "Health check before booking",
  durationMinutes: "How long",
  maxPartySize: "Most people per booking",
  unitPricePaise: "Price",
  pricingUnit: "Per person or for the group",
  bookingMode: "How it sells",
};

/** The fields as the form names them, in the API's order, each once. */
export function fieldLabels(fields: string[]): string[] {
  return [...new Set(fields.map((f) => FIELD_LABELS[f] ?? f))];
}

/**
 * Only the fields the operator changed, so an edit is a claim about those
 * and nothing else.
 *
 * The form renders every field filled in with what is on file, and sent all of
 * them. Every name and every line of wording therefore reached our review
 * queue on every edit, including a price change that should have gone live on
 * its own.
 *
 * `defaults` holds the exact strings the form rendered as each field's value,
 * so a field nobody touched compares equal however its value was formatted.
 * Line endings are compared without regard to `\r`, which some browsers add
 * to a textarea's value. A pair (the pin's two numbers) goes together or not
 * at all, because the API takes both or neither.
 */
export function onlyChanged(
  form: FormData,
  defaults: Readonly<Record<string, string>>,
  pairs: readonly (readonly [string, string])[] = [],
): FormData {
  const same = (name: string) => {
    const sent = form.get(name);
    const now = typeof sent === "string" ? sent : "";
    return (
      now.replace(/\r\n?/g, "\n") === (defaults[name] ?? "").replace(/\r/g, "")
    );
  };
  const paired = new Map<string, string>();
  for (const [a, b] of pairs) {
    paired.set(a, b);
    paired.set(b, a);
  }

  const out = new FormData();
  for (const [name, value] of form.entries()) {
    if (!(name in defaults)) {
      // Not a field: the listing id and anything else the form carries.
      out.append(name, value);
      continue;
    }
    const partner = paired.get(name);
    const changed = !same(name) || (partner !== undefined && !same(partner));
    if (changed) out.append(name, value);
  }
  return out;
}
