import Link from "next/link";

/**
 * The empty screen of a business with nothing booked at all, and the way on
 * from it (yuvoy-operator#83 s4).
 *
 * "No upcoming bookings" and half a screen of white was a dead end. A
 * business with no bookings and no requests is short of departures to sell,
 * and those are put on sale in Calendar, so the second sentence is the link.
 * The whole sentence is the target, at 44px, rather than two words inside it.
 */
export function NothingBooked() {
  return (
    <div className="mt-8">
      <p className="text-base font-bold">Nothing booked yet.</p>
      <Link
        href="/calendar"
        className="text-forest decoration-forest/40 inline-flex min-h-11 items-center text-base underline underline-offset-4"
      >
        Open Calendar to put seats on sale.
      </Link>
    </div>
  );
}
