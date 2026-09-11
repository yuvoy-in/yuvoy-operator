import type { BookingCash } from "@/lib/money/bookings";
import { formatPaise } from "@/lib/format/money";

/**
 * A booking's state, in the operator's words.
 *
 * ## These are raw column values, not a traveller-facing vocabulary
 *
 * `GET /operator/v1/bookings` returns `b.fulfilment_state` verbatim. It is not
 * the projected state the traveller app renders — that projection lives in the
 * API (`internal/booking/projection.go`) and is applied on the traveller
 * endpoint only. So this list can hand over `paid_pending_ops`, which is a
 * column value and not a sentence, and printing it at an operator is the same
 * defect as printing `awaiting_operator` at a traveller.
 *
 * ## The operator's words are not the traveller's
 *
 * `declined` reads "Refunded" to the person who was charged. To the operator
 * it means the sale did not complete and the seat came back, which is a
 * different fact about the same row. Each label below is written for the
 * person who runs the boat.
 *
 * ## The unknown branch is the expected steady state
 *
 * The set is a database column, not a contract enum — `state` is typed as a
 * bare `string` — so it grows on the server with no deploy here. An unmapped
 * value renders as `null` and the caller shows no chip: a missing word costs
 * information, a raw token misinforms, and there is no honest generic that is
 * true of both a completed trip and a cancelled one.
 */
export interface BookingStateCopy {
  label: string;
  /** Whether this booking is still going to happen. Drives emphasis only. */
  live: boolean;
}

const STATES: Record<string, BookingStateCopy> = {
  /*
    An unanswered seat request. It is a `pending_request` in the API's own
    words — the contract names it when explaining why such a row carries no
    `money` — and it is the one state here that is asking something of the
    operator, so it says so.
  */
  pending_request: { label: "Waiting on you", live: true },
  confirmed: { label: "Confirmed", live: true },
  /*
    A party marked present on the manifest. The manifest's own total for this
    is "Here"; on a booking row, where there is no departure around it to give
    that word context, "Checked in" is the same fact said in full.
  */
  arrived: { label: "Checked in", live: true },
  /*
    Paid, and not yet visible to the projection — a race window of
    milliseconds to seconds, not a waiting room. TRUE ONLY OF A CARD BOOKING:
    see `describeBookingState` for the cash booking that sits in the same
    state meaning the opposite.
  */
  paid_pending_ops: { label: "Payment clearing", live: true },
  declined: { label: "Not taken · refunded", live: false },
  cancelled: { label: "Cancelled", live: false },
  completed: { label: "Completed", live: false },
  no_show: { label: "Did not board", live: false },
};

/** The states in which the counter can still take the money. The API's own set. */
const CAN_TAKE_CASH = new Set(["paid_pending_ops", "confirmed", "arrived"]);

/**
 * The words for a booking's state — and its cash, which is not optional.
 *
 * ## Why `cash` is a required parameter
 *
 * yuvoy-operator#40. A cash booking sits in `paid_pending_ops` from the moment
 * the traveller commits until the operator records the notes in their hand,
 * and this function used to read state alone — so it said "Payment clearing"
 * about a booking where nothing is clearing and the operator is the one who
 * has to collect ₹10,000. Seen in production on YV-5DT6RKVQ.
 *
 * Required rather than optional so the next screen that describes a booking
 * cannot forget to pass it: `describeBookingState(b.state)` does not compile.
 * Pass `undefined` for a booking that genuinely has none — that is a decision
 * written at the call site, not a default nobody chose.
 */
export function describeBookingState(
  state: string | undefined,
  cash: BookingCash | undefined,
): BookingStateCopy | null {
  const key = state?.trim().toLowerCase();
  if (!key) return null;

  if (cash) {
    if (!cash.collected && CAN_TAKE_CASH.has(key)) {
      /*
        The actionable state — "what puts this booking on somebody's list for
        the morning". Named for the act and the amount, never for a bank.
      */
      return {
        label:
          cash.collectPaise === null
            ? "Collect cash"
            : `Collect ${formatPaise(cash.collectPaise)}`,
        live: true,
      };
    }
    if (key === "paid_pending_ops") {
      /*
        Collected, and the state has not caught up. The API moves a cash
        booking to `confirmed` in the same write that records the notes, so
        this is a read racing that write — and "Payment clearing" is exactly
        the sentence it must not fall through to.
      */
      return { label: "Cash taken", live: true };
    }
    if (key === "declined") {
      // Nothing was ever charged on a cash booking, so nothing was refunded.
      return { label: "Not taken", live: false };
    }
  }

  return STATES[key] ?? null;
}

/**
 * Whether this booking is one the operator still has to turn up for.
 *
 * Used to split the list rather than to make a claim, so an unrecognised
 * state sorts with the past: a booking nobody can name is not one to promise
 * a traveller a seat on.
 */
export function isUpcomingBooking(state: string | undefined): boolean {
  return describeBookingState(state, undefined)?.live === true;
}
