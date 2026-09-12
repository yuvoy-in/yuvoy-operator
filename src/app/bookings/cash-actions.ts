"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import { rupeesToPaise } from "@/lib/money/cash";
import { sentence } from "@/lib/format/sentence";

/**
 * Taking the cash — yuvoy-operator#40 §1.
 *
 * `POST /bookings/{id}/cash-collected`. Four properties of the endpoint decide
 * the shape of this action, all from the contract and the issue:
 *
 *   - **It is not arriving.** "Somebody can turn up and not pay." The two are
 *     separate taps on separate forms, and nothing here marks attendance.
 *   - **A retry is not punished.** A phone that loses signal mid-request and
 *     is tapped again gets the first tap's answer with `alreadyRecorded`, and
 *     the amount is never overwritten. So the answer is rendered as the
 *     recorded state either way — not an error, and not a second confirmation.
 *   - **Not role-gated.** "Whoever is holding the phone at the gangway is who
 *     takes the cash." The contract declares no 403, and `pnpm qa` fails a
 *     gate the contract did not ask for.
 *   - **No offline queue.** The issue allows one; this portal has nowhere to
 *     put it — a Server Action needs the network, and `localStorage` is banned
 *     here for the reason the session is an httpOnly cookie. What makes that
 *     safe is the endpoint's own idempotency: a failed tap says nothing was
 *     recorded and that tapping again is safe, because it is.
 */

export interface CashState {
  /** Set only when nothing was recorded. */
  message?: string;
  /** The collection as the API holds it — the FIRST report, on a retry. */
  recorded?: {
    collectedPaise: number;
    shortfallPaise: number;
    collectedAt: string;
    alreadyRecorded: boolean;
  };
  /** What was typed, handed back so a refusal does not empty the box. */
  typed?: string;
  /** Bumped per refused attempt, so the form remounts onto `typed`. */
  attempt?: number;
}

const schema = z.object({
  bookingId: z.string().min(1),
  /** The departure the row sits on, so its manifest re-reads. Empty elsewhere. */
  slotId: z.string(),
  mode: z.enum(["fare", "less"]),
  amount: z.string(),
});

export async function recordCashCollected(
  prev: CashState,
  form: FormData,
): Promise<CashState> {
  const typed = String(form.get("amount") ?? "");
  const again = (message: string): CashState => ({
    message,
    typed,
    attempt: (prev.attempt ?? 0) + 1,
  });

  const parsed = schema.safeParse({
    bookingId: form.get("bookingId"),
    slotId: form.get("slotId") ?? "",
    mode: form.get("mode"),
    amount: typed,
  });
  if (!parsed.success) {
    return again("That could not be recorded. Refresh the page and try again.");
  }

  const { bookingId, slotId, mode } = parsed.data;

  /*
    The whole fare is the common case and sends NO amount — "omit it for the
    whole fare, which is what happens almost every time" — so the fare is
    resolved by the server where it is known, not echoed back from a page that
    may have loaded before it changed.
  */
  let collectedPaise: number | undefined;
  if (mode === "less") {
    const paise = rupeesToPaise(typed);
    if (paise === null) {
      return again("Type what you took in whole rupees, digits only.");
    }
    collectedPaise = paise;
  }

  const { token } = await requireOperator();

  try {
    const { data, error } = await operatorApi(token).POST(
      "/bookings/{id}/cash-collected",
      {
        params: { path: { id: bookingId } },
        body: collectedPaise === undefined ? {} : { collectedPaise },
      },
    );
    if (error) throw error;

    /*
      Revalidated, because the re-rendered row says MORE than a message could:
      it reads `₹10,000 taken · 09:04` from the server's own record, and the
      row does not leave the list, so nothing this action returns is lost to
      the re-render. The shortfall sentence is the one thing only this answer
      carries, and it is said once — the next load has the fact and not the
      sentence, which is what "say it once, quietly" asks for.
    */
    revalidatePath("/bookings");
    revalidatePath(`/bookings/${bookingId}`);
    if (slotId) revalidatePath(`/today/${slotId}`);

    return {
      recorded: {
        collectedPaise: data.collectedPaise,
        shortfallPaise: data.shortfallPaise,
        collectedAt: data.collectedAt,
        alreadyRecorded: data.alreadyRecorded === true,
      },
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return again(
        "No signal. Nothing was recorded yet. Tap again when you have a bar; a second tap is safe, it can only be recorded once.",
      );
    }
    if (err instanceof OperatorApiError) {
      if (err.isNotFound) {
        // Gone and "not yours" are one answer, by design.
        return again(
          "We could not find that booking. Refresh the page. It may have been cancelled.",
        );
      }
      if (err.status === 409 || err.status === 400) {
        /*
          The API's own sentence: already paid online, more than the fare, or
          a booking that can no longer take money. Its message is "safe to
          show", and the three are one code, so the words are the only thing
          that tells them apart.
        */
        return again(
          sentence(err.message) ||
            "That could not be recorded. Refresh to see where the booking is.",
        );
      }
      if (err.status === 503) {
        return again(
          "We cannot record that right now. Nothing was recorded. Write it down and try again shortly.",
        );
      }
    }
    return again("Not recorded. Try again. A second tap is safe.");
  }
}
