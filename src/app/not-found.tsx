import { StandInScreen } from "@/components/chrome/stand-in-screen";
import { ButtonLink } from "@/components/ui/button";

/**
 * A URL this portal does not have.
 *
 * There is nothing to browse here and nothing to search, so the only useful
 * answer is the way back. Short on purpose: whoever is reading it mistyped
 * something or followed a link that has since moved, and neither is worth a
 * paragraph at 6am.
 *
 * It is drawn on any route, a booking that has gone as much as an address
 * that never was, so it wears that route's chassis, as the error screen does
 * (`StandInScreen`).
 */
export default function NotFound() {
  return (
    <StandInScreen width="sm">
      <h1 className="font-display tracking-display leading-display text-4xl text-balance">
        There is nothing at that address
      </h1>
      <p className="text-forest/70 leading-body mt-3 text-base text-pretty">
        The link may have changed, or the address may have a typo in it.
      </p>
      <ButtonLink href="/today" className="mt-8">
        Go to today
      </ButtonLink>
    </StandInScreen>
  );
}
