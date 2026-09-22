"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { badgeText } from "@/lib/site/nav";
import { InboxIcon } from "@/components/ui/icons";
import { useChrome } from "./chrome-context";

/**
 * The inbox, at the right edge of every signed-in screen's stage
 * (yuvoy-operator#96).
 *
 * Messages is not a stop on the bar. A guest writes whatever screen the
 * operator happens to be on, so the way to the conversations is on every
 * screen rather than one tap into a tab.
 *
 * ## The count keeps the tab bar's rules
 *
 * It is the conversations with a message nobody has read, counted on the
 * server by the root layout (`readInbox`). **Absent means unknown and draws
 * nothing; zero draws nothing** too, because an empty inbox is not news. The
 * bubble is decorative and the number is said through the link's NAME,
 * "Messages, 2 unread conversations", for the reason the bar says its counts
 * that way: a span beside the label is announced with a stray pause, and the
 * name still starts with the word a voice-control user says.
 *
 * Not drawn on the conversations list itself, where it would be a link to
 * the page already open.
 */
export function InboxLink({ className }: { className?: string }) {
  const { unread } = useChrome();
  const pathname = usePathname() ?? "";
  if (pathname === "/messages" || pathname.startsWith("/messages/")) {
    return null;
  }

  const count = typeof unread === "number" && unread > 0 ? unread : null;

  return (
    <Link
      href="/messages"
      aria-label={
        count === null
          ? "Messages"
          : `Messages, ${count} unread ${count === 1 ? "conversation" : "conversations"}`
      }
      className={cn(
        "ease-interaction bg-paper/10 text-paper ring-paper/12 hover:bg-paper/15 relative inline-flex size-11 shrink-0 items-center justify-center rounded-full ring-1 transition-[transform,background-color] duration-200 active:scale-[0.96]",
        className,
      )}
    >
      <InboxIcon className="size-5" />
      {count !== null ? (
        <span
          aria-hidden="true"
          className="bg-paper text-forest ring-forest absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] leading-none font-bold tabular-nums ring-2"
        >
          {badgeText(count)}
        </span>
      ) : null}
    </Link>
  );
}
