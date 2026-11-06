#!/usr/bin/env node
/**
 * Static QA sweep for the operator portal.
 *
 * Ported from yuvoy-app, minus the checks about a video feed and plus four
 * that only matter here. The four new ones all guard the same thing from
 * different sides: **the session token must never become reachable from a
 * browser**, and the portal must never grow the generic API surface that
 * `/operator/v1`'s CORS refusal exists to remove.
 *
 * None of these fail a build. All of them are how the architecture quietly
 * stops being the architecture.
 */

/*
  The checks are in scripts/qa/, one file per group of sections, so no file
  runs past 500 lines (yuvoy-operator#178). They run in the order imported
  here, which is the order they had in this file, and share their state
  through scripts/qa/context.mjs.
*/
import { notes, problems } from "./qa/context.mjs";
import { routes } from "./qa/01-routes-and-basics.mjs";
import "./qa/02-session-boundary.mjs";
import "./qa/03-phones-env-pages.mjs";
import "./qa/04-owner-gates.mjs";
import "./qa/05-gates-copy-storage.mjs";
import "./qa/06-source-and-uploads.mjs";
import "./qa/07-schemas-and-errors.mjs";
import "./qa/08-copy-hydration-e2e.mjs";

/* --------------------------------------------------------------- report -- */

console.log(`\nroutes: ${[...routes].sort().join("  ")}\n`);
if (notes.length) {
  console.log("notes");
  for (const n of notes) console.log(`  · ${n}`);
  console.log("");
}
if (problems.length) {
  console.error(`✗ ${problems.length} QA problem(s)\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("");
  process.exit(1);
}
console.log("✓ QA sweep clean\n");
