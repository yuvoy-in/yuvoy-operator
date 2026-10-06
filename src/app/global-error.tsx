"use client";

import "./globals.css";
import { useRetry } from "@/components/chrome/use-retry";

/**
 * The boundary for a failure in the root layout itself.
 *
 * It replaces the layout, so it owns `<html>` and `<body>`, and it is the one
 * screen in this portal that cannot assume the stylesheet arrived, because a
 * layout that failed is exactly the thing that would have brought it. The
 * token classes are here for the ordinary case; the inline colours are the
 * literal values behind `--color-paper` and `--color-forest`, written out on
 * purpose so that a page with no CSS at all is still legible in bright sun.
 *
 * That is the only place in this repo where a colour is not a token, and the
 * reason is the failure mode this file exists for.
 *
 * Try again reads the page again, and with no signal keeps the tap until the
 * signal is back (`useRetry`), as the error screen does.
 */
export default function GlobalError({ retry }: { retry: () => void }) {
  const { tryAgain, retrying, waiting } = useRetry(retry);

  return (
    <html lang="en">
      <body
        className="bg-paper text-forest"
        style={{ background: "#ffffff", color: "#16362e" }}
      >
        <main
          style={{
            margin: "0 auto",
            maxWidth: "28rem",
            padding: "3rem 1.25rem",
          }}
        >
          <h1
            style={{ fontSize: "1.75rem", lineHeight: 1.15, fontWeight: 700 }}
          >
            Yuvoy could not load
          </h1>
          <p style={{ marginTop: "0.75rem", fontSize: "1rem" }}>
            Something went wrong before the page could start. Try again. If it
            keeps happening, call us on +91 81216 57657.
          </p>
          <button
            type="button"
            onClick={tryAgain}
            aria-busy={retrying || undefined}
            aria-disabled={retrying || undefined}
            style={{
              marginTop: "2rem",
              minHeight: "3.5rem",
              width: "100%",
              padding: "0 1.25rem",
              background: "#16362e",
              color: "#ffffff",
              border: 0,
              borderRadius: "9999px",
              fontWeight: 700,
              fontSize: "0.9375rem",
            }}
          >
            {retrying ? "Trying again" : "Try again"}
          </button>
          {/* Mounted from the start, so a screen reader hears it arrive. */}
          <p
            role="status"
            style={{ marginTop: "1rem", fontSize: "0.875rem", fontWeight: 700 }}
          >
            {waiting
              ? "No signal. It tries again once you are back online."
              : null}
          </p>
        </main>
      </body>
    </html>
  );
}
