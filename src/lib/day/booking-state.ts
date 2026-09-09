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
    The one that must never reach a screen unmapped. It means the traveller
    has paid and the booking is not yet visible to the projection — a race
    window of milliseconds to seconds, not a waiting room.
  */
  paid_pending_ops: { label: "Payment clearing", live: true },
  declined: { label: "Not taken · refunded", live: false },
  cancelled: { label: "Cancelled", live: false },
  completed: { label: "Completed", live: false },
  no_show: { label: "Did not board", live: false },
};

export function describeBookingState(
  state: string | undefined,
): BookingStateCopy | null {
  const key = state?.trim().toLowerCase();
  if (!key) return null;
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
  return describeBookingState(state)?.live === true;
}
