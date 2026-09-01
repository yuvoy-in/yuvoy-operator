"use client";

import Link from "next/link";

/**
 * What a screen says when it could not load.
 *
 * **This file did not exist until O3, and its absence was a live defect.**
 * `requireOperator()` documented itself as throwing "to the error boundary,
 * which says what is actually true" — into nothing. Every failure this portal
 * could not handle rendered Next's default page, on a jetty, at 0.5 Mbps,
 * where the connection dropping is the common path rather than the exception.
 *
 * ## Why it does not say what went wrong
 *
 * It cannot. In production Next replaces a thrown error's message with a
 * generic one before a boundary ever sees it, leaving only an opaque `digest`.
 * So a boundary that branched on the error would be branching on nothing —
 * which is why `account_not_active` is now handled where it is *known*, in
 * `requireOperator()`, rather than being thrown here in the hope that this
 * file could work it out.
 *
 * What is left is one honest sentence, the retry that is usually the answer,
 * and a way back. The `digest` stays off the screen and in the server logs,
 * following the rule the rest of the portal already keeps: "a correlation id
 * is for a support conversation that happens later — it goes to the logs, not
 * into sunlight."
 */
export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className="bg-cream text-forest flex min-h-dvh flex-col">
      <div className="container-page mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-12">
        <p className="eyebrow text-terra-deep">Yuvoy for operators</p>
        <h1 className="font-display tracking-display mt-4 text-4xl leading-[1.05]">
          That did not load
        </h1>
        <p className="text-forest/70 mt-3 text-base">
          Usually the connection rather than anything you did. Nothing on this
          screen is lost — it simply is not here yet.
        </p>

        <button
          type="button"
          onClick={reset}
          className="rounded-edge dock-target label bg-forest text-cream mt-8 w-full px-5 font-bold"
        >
          Try again
        </button>

        <Link
          href="/today"
          className="rounded-edge dock-target label border-cream-line bg-cream-deep text-forest mt-3 flex items-center justify-center border px-5"
        >
          Back to today
        </Link>

        {/*
          The one thing a retry screen owes somebody who was mid-action. A
          relay that reached eleven people twice is not a cosmetic failure, and
          this portal cannot tell them from here whether the tap landed.
        */}
        <p className="border-cream-line text-forest/70 mt-10 border-t pt-6 text-sm">
          If you had just tapped something — accepted a request, sent a message,
          marked somebody off — check whether it took effect before doing it
          again.
        </p>
      </div>
    </main>
  );
}
