import { formatPaise } from "@/lib/format/money";
import type { GiveBack } from "@/lib/money/give-back";
import { CashBack } from "@/app/bookings/cash-back";
import { panelClass } from "@/components/ui/panel";

/**
 * Cash the business is holding for cancelled parties, on the departure page
 * (moved out of `page.tsx` for the 500-line cap, yuvoy-operator#178).
 */
export function GiveBackPanel({
  giveBack,
  canManage,
}: {
  giveBack: GiveBack;
  canManage: boolean;
}) {
  return (
    <section className="mt-6" aria-labelledby="give-back">
      <div className={panelClass("alert")}>
        <h2 id="give-back" className="text-base font-bold text-balance">
          You are holding {formatPaise(giveBack.totalPaise)} that is not yours
        </h2>
        <p className="text-forest/80 leading-body mt-2 text-sm text-pretty">
          {giveBack.parties.length === 1
            ? "This traveller paid you in cash, so nothing of theirs reached us to refund. Hand it back, then record it here."
            : "These travellers paid you in cash, so nothing of theirs reached us to refund. Hand it back, then record each one here."}
        </p>
        <ul className="mt-4 space-y-3">
          {giveBack.parties.map((party) => (
            <li
              key={party.bookingId}
              className="border-paper-line border-t pt-3"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="tracking-ref text-base font-bold slashed-zero tabular-nums">
                  {party.reference || "-"}
                </p>
                <p className="shrink-0 text-base font-bold tabular-nums">
                  {formatPaise(party.amountPaise)}
                </p>
              </div>
              <p className="text-forest/70 mt-1 text-sm">
                {[
                  party.name,
                  party.guests === 1
                    ? "1 guest"
                    : party.guests > 1
                      ? `${party.guests} guests`
                      : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {/*
              OWNER, ADMIN or MANAGER: "STAFF cannot record giving the
              cash back". A staff login is told who can, rather than
              shown a control the API will refuse.
            */}
              {canManage ? (
                <CashBack
                  bookingId={party.bookingId}
                  amountPaise={party.amountPaise}
                  refreshLabel="Update the list"
                />
              ) : (
                <p className="text-forest/70 leading-body mt-2 text-sm text-pretty">
                  An owner, an admin or a manager records it once it is handed
                  back.
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
