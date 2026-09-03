"use client";

import "./globals.css";

/**
 * The boundary for a failure in the root layout itself.
 *
 * It replaces the layout, so it owns `<html>` and `<body>` — and it is the one
 * screen in this portal that cannot assume the stylesheet arrived, because a
 * layout that failed is exactly the thing that would have brought it. The
 * token classes are here for the ordinary case; the inline colours are the
 * literal values behind `--color-cream` and `--color-forest`, written out on
 * purpose so that a page with no CSS at all is still legible in bright sun.
 *
 * That is the only place in this repo where a colour is not a token, and the
 * reason is the failure mode this file exists for.
 */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body
        className="bg-cream text-forest"
        style={{ background: "#f4efe4", color: "#16362e" }}
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
            Something went wrong before the page could start. Try again — if it
            keeps happening, call us on +91 81216 57657.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "2rem",
              minHeight: "3.5rem",
              width: "100%",
              padding: "0 1.25rem",
              background: "#16362e",
              color: "#f4efe4",
              border: 0,
              borderRadius: "9999px",
              fontWeight: 700,
              fontSize: "0.9375rem",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
