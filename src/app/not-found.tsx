import { Screen } from "@/components/chrome/screen";
import { ButtonLink } from "@/components/ui/button";

/**
 * A URL this portal does not have.
 *
 * There is nothing to browse here and nothing to search, so the only useful
 * answer is the way back. Short on purpose: whoever is reading it mistyped
 * something or followed a link that has since moved, and neither is worth a
 * paragraph at 6am.
 */
export default function NotFound() {
  return (
    <Screen nav="none" width="sm">
      <p className="eyebrow text-terra-deep">Yuvoy for operators</p>
      <h1 className="font-display tracking-display mt-4 text-4xl leading-[1.05]">
        There is nothing at that address
      </h1>
      <p className="text-forest/70 mt-3 text-base">
        The link may have changed, or the address may have a typo in it.
      </p>
      <ButtonLink href="/today" className="mt-8">
        Go to today
      </ButtonLink>
    </Screen>
  );
}
