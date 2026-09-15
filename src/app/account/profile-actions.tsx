"use client";

import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";

/**
 * Edit profile · Share · View as a traveller — #58 item 2.
 *
 * ## The URL is never printed
 *
 * `Do not build`: "the raw public URL printed anywhere". It is handed to the
 * share sheet or to the clipboard, and the button says what happened. An
 * operator does not need to read `app.yuvoy.in/o/reef-divers-havelock` to send
 * it to somebody.
 *
 * ## Share falls back rather than disappearing
 *
 * `navigator.share` is missing on every desktop browser and inside some
 * in-app webviews. A Share button that vanished there would leave the operator
 * with no way to send their own page; copying is the same act with one more
 * step.
 */
export function ProfileActions({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    if (!url) return;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ url });
        return;
      } catch {
        /*
          A share sheet the operator dismissed throws, and so does one the
          browser refused. Neither is a failure worth a message: falling through
          to the clipboard gives them the thing either way.
        */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <ButtonLink href="/story" variant="secondary" size="sm" block={false}>
        Edit profile
      </ButtonLink>
      {url ? (
        <Button variant="secondary" size="sm" block={false} onClick={share}>
          {copied ? "Link copied" : "Share"}
        </Button>
      ) : null}
      {url ? (
        <ButtonLink
          href={url}
          variant="secondary"
          size="sm"
          block={false}
          target="_blank"
          rel="noreferrer"
        >
          View as traveller
        </ButtonLink>
      ) : null}
    </div>
  );
}
