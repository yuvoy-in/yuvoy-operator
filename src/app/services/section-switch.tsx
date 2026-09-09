"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/**
 * The two halves of Services, and the way between them.
 *
 * ## Why a switcher rather than two separate screens
 *
 * The useful question is asked from both directions — *"this listing has no
 * video"* and *"this clip is attached to nothing"* — so an operator moves
 * between these two lists constantly, and neither is a destination they arrive
 * at once. A back control out to a hub would sit in the way every time.
 *
 * The counts are the point of putting it here rather than in the tab bar: a
 * number beside "Reels" is the answer to half the question before anybody taps
 * anything.
 *
 * Rendered as links, not tabs, because they are pages: a middle-click, a
 * long-press and a browser Back all behave the way somebody expects.
 */
/*
  ONE WORD PER THING — D-031 C10, yuvoy-operator#36.

    listing    — everywhere an operator edits. The thing they write and we review.
    experience — everywhere a traveller reads. The thing they are buying.
    departure  — a dated occurrence. Not "slot", which is our word, and not
                 "trip", which is the traveller's word for their own booking.

  Four words were in use for one thing across this portal, the traveller app
  and the admin console — activity, service, experience, listing — and an
  operator reads three of ours in a week. The split between the first two is
  deliberate rather than tidiness: an operator is MANAGING a listing and a
  traveller is CHOOSING an experience, and those are genuinely different
  relationships to the same row.
*/
export function SectionSwitch({
  listings,
  media,
}: {
  /** How many listings they have. */
  listings: number;
  /** How many clips and photographs they have. */
  media: number;
}) {
  const pathname = usePathname() ?? "";

  const items = [
    { href: "/services/activities", label: "Listings", count: listings },
    { href: "/services/reels", label: "Photos & reels", count: media },
  ];

  return (
    <nav aria-label="Services" className="mt-6">
      <ul className="border-cream-line bg-cream-deep flex gap-1 rounded-full border p-1">
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "ease-interaction flex h-11 items-center justify-center gap-2 rounded-full text-sm font-bold transition-[background-color,color] duration-200",
                  active
                    ? "bg-forest text-cream"
                    : "text-forest/70 hover:text-forest",
                )}
              >
                {item.label}
                {/*
                  The count is rendered even at zero. "No reels yet" is the
                  most important thing this section can tell a new operator —
                  it is the state every one of them starts in, and the reason
                  their cards are blank on the traveller app.

                  `text-forest` at full strength on the inactive badge, not the
                  link's own `forest/70`. Inheriting it measured **4.28:1**
                  against the tinted pill — 11px bold needs 4.5 — because the
                  `forest/8` tint darkens the ground the dimmed text sits on.
                  Caught by the axe suite, not by looking: it is a two-decimal
                  miss on an eleven-pixel number.
                */}
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-bold",
                    active ? "bg-cream/15" : "bg-forest/8 text-forest",
                  )}
                >
                  {item.count}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
