import { IconLink } from "@/components/ui/icon-button";
import { ArrowLeftIcon } from "@/components/ui/icons";

/**
 * The way back from a focused screen: a plain link to a stated fallback,
 * never `history.back()`. History is not ours to read on a phone that was
 * handed over mid-morning, and a link is deterministic on every path in.
 */
export function BackButton({ href, label }: { href: string; label: string }) {
  return (
    <IconLink href={href} label={`Back to ${label}`} variant="onDark">
      <ArrowLeftIcon />
    </IconLink>
  );
}
