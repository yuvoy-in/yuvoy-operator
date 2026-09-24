import Link from "next/link";
import { SUPPORT_PHONE_HREF } from "@/lib/site/contact";

/**
 * The empty screen of a business with nothing booked at all, and the way on
 * from it (yuvoy-operator#83 s4).
 *
 * "No upcoming bookings" and half a screen of white was a dead end. A
 * business with no bookings and no requests is short of departures to sell,
 * and those are put on sale in Calendar, so the second sentence is the link.
 * The whole sentence is the target, at 44px, rather than two words inside it.
 *
 * ## Worded by what this login can do (the audit before release, O7)
 *
 * "Open Calendar to put seats on sale" was a dead end of its own for two
 * people. A staff login cannot add a departure, so it is told who can. A
 * business on hold cannot put anything on sale, so it is told that, with the
 * one way forward there is: calling us.
 */
export function NothingBooked({
  canManage,
  suspended,
}: {
  /** OWNER, ADMIN or MANAGER: may add departures in Calendar. */
  canManage: boolean;
  /** The account is on hold: nothing new can go on sale. */
  suspended: boolean;
}) {
  const way =
    "text-forest decoration-forest/40 inline-flex min-h-11 items-center text-base underline underline-offset-4";

  return (
    <div className="mt-8">
      <p className="text-base font-bold">Nothing booked yet.</p>
      {suspended ? (
        <>
          <p className="text-forest/80 mt-1 text-base">
            Your account is on hold, so nothing new can go on sale.
          </p>
          <a href={SUPPORT_PHONE_HREF} className={way}>
            Call Yuvoy
          </a>
        </>
      ) : canManage ? (
        <Link href="/calendar" className={way}>
          Open Calendar to put seats on sale.
        </Link>
      ) : (
        <p className="text-forest/80 mt-1 text-base">
          An owner, an admin or a manager puts seats on sale in Calendar.
        </p>
      )}
    </div>
  );
}
