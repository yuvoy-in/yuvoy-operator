import { describe, it, expect } from "vitest";
import vercel from "../../../vercel.json";

/**
 * Where the server functions run (production readiness, 6 Oct 2026).
 *
 * Vercel runs them in Washington (`iad1`) unless `vercel.json` says otherwise,
 * and it did: the API answers from Mumbai, so every API read a render or a
 * Server Action made crossed the world and back, and a boarding check-in made
 * about eight of them in a row. Nothing else would notice the line going:
 * every test and every build pass the same in either region.
 */
describe("vercel.json", () => {
  it("runs the functions in Mumbai, beside the API", () => {
    // Hobby allows one region, and this is it.
    expect(vercel.regions).toEqual(["bom1"]);
  });
});
