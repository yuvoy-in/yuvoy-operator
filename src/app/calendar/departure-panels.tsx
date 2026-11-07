import Link from "next/link";
import type { DepartureState } from "./departure-actions";
import { departureCount } from "@/lib/day/departures";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { LinkRing } from "@/components/ui/link-pending";

/*
  The three panels the departure form shows in place of itself: the receipt
  for a batch, and the two absences of listings. Moved from departure-form.tsx
  unchanged (yuvoy-operator#178). Why the two absences are kept apart is said
  where the form picks between them.
*/

export function DepartureReceipt({
  result,
  onAgain,
}: {
  result: NonNullable<DepartureState["result"]>;
  onAgain: () => void;
}) {
  const { created, asked, note, onSale, notOnSaleDetail, experienceId } =
    result;
  return (
    <Panel tone={created > 0 ? "done" : "raised"}>
      {created > 0 ? (
        <>
          <p className="text-base font-bold text-balance">
            {departureCount(created)} added
          </p>
          {created < asked ? (
            /*
              Asked for more than were made: the rest already existed. Said
              plainly, because the alternative is an operator counting rows
              and concluding the portal dropped some.
            */
            <p className="text-forest/80 leading-body mt-2 text-sm text-pretty">
              {asked - created} of the {asked} you asked for already had a
              departure at that time, so those were left alone.
            </p>
          ) : (
            /*
              The server's own sentence when they are NOT on sale, and only
              the plain claim when they are — yuvoy-operator#30 §4.

              This said "they are on sale from now" unconditionally, which
              was untrue for a draft listing, an unpriced one, a withdrawn
              one, and an operator not selling. Production held a draft
              listing with hundreds of departures no traveller could book,
              every one of which this sentence claimed was selling.

              `notOnSaleDetail` is rendered VERBATIM rather than mapped from
              `notOnSaleReason` — the contract asks for that explicitly, and
              the reason set is open enough that a client mapping it would
              have an unhandled arm the first time one is added. The reason
              code is deliberately not read here at all.

              Not on sale, it links to the listing, where what is missing is
              said. The fallback said "Check it on Listings", a tab that went
              in #96 (yuvoy-operator#117 item 2).
            */
            <p className="text-forest/80 leading-body mt-2 text-sm text-pretty">
              {onSale === false
                ? (notOnSaleDetail ?? "They are not on sale yet.")
                : "They are on sale from now."}{" "}
              You can change the seats on each one below.
              {onSale === false ? (
                <>
                  {" "}
                  <Link
                    href={`/account/listings/${encodeURIComponent(experienceId)}`}
                    className="text-forest font-bold underline underline-offset-2"
                  >
                    Open the listing
                    <LinkRing />
                  </Link>
                </>
              ) : null}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="text-base font-bold text-balance">Nothing to add</p>
          <p className="text-forest/80 leading-body mt-2 text-sm text-pretty">
            Every one of those days and times already has a departure, so
            nothing was changed. Pressing again is safe. It never sells the same
            boat twice.
          </p>
        </>
      )}
      {note ? (
        <p className="text-forest/80 leading-body mt-2 text-sm text-pretty">
          {note}
        </p>
      ) : null}
      <Button onClick={onAgain} variant="secondary" className="mt-4">
        Add more departures
      </Button>
    </Panel>
  );
}

export function ListingsUnavailable() {
  return (
    <Panel tone="alert">
      <p className="text-base font-bold text-balance">
        We could not load your listings just now
      </p>
      <p className="text-forest/80 leading-body mt-2 text-sm text-pretty">
        Everything below still works. This is only the list of listings to add a
        departure to. Reload the page to try again.
      </p>
    </Panel>
  );
}

export function NoListingsYet() {
  return (
    <Panel>
      <p className="text-base font-bold text-balance">Adding a departure</p>
      <p className="text-forest/80 leading-body mt-2 text-sm text-pretty">
        A departure belongs to a listing, and you have not written one yet.
      </p>
      {/*
        "Message us and we will add the first one for you" stopped being true
        when the portal gained listing creation (yuvoy-operator#30 §4). An
        operator with no departures now has a screen that can make one — and
        telling them to message us instead is a day of waiting for something
        they could do in a minute.
      */}
      {/*
        "Message us and we will add the first one for you" stopped being
        true when the portal gained listing creation (yuvoy-operator#30 §4,
        #32). An operator with no listings now has a screen that makes one,
        and telling them to message us instead is a day of waiting for
        something they could do in a minute.
      */}
      <p className="text-forest/80 leading-body mt-2 text-sm text-pretty">
        Write your first one on{" "}
        <a href="/account" className="underline underline-offset-2">
          your business
        </a>
        .
      </p>
    </Panel>
  );
}
