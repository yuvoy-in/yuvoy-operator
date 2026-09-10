/**
 * The READ half of a response the contract gave two 2xx shapes.
 *
 * ## Why this exists, and when to delete it
 *
 * The tenth contract bump (`64d49ee5`) added a `202` — *"Recorded for review,
 * not applied… branch on the status code, not on the body"* — to `GET /logo`
 * and `GET /profile`. That sentence describes a **write**: it is the answer to
 * submitting a change on an account that is already LIVE, where the new value
 * waits for an admin. A `GET` cannot record anything for review, and asking
 * for the current details can never answer "in review".
 *
 * So the `202` is on the wrong verb. It belongs on the `PUT` beside it, which
 * is still declared with `200` alone — which means the case that genuinely
 * happens has no type, and the case that cannot happen has one. Raised on
 * yuvoy-operator#40; this is the client-side accommodation until it moves.
 *
 * `openapi-fetch` unions every 2xx into `data`, so `data.logoUrl` stopped
 * type-checking on a body that will always carry it. The narrowing is written
 * as a real runtime check rather than a cast: if the API ever *did* answer a
 * read with `{ state: "in_review" }`, treating it as the details would render
 * a pending value as current — the exact lie the 202's own description warns
 * against — so it is treated as "we have nothing to show" instead.
 *
 * When the contract moves the `202` to the `PUT`, both call sites lose their
 * union and this file can go.
 */

/** The acknowledgement shape, exactly as both GETs declare it. */
export interface InReview {
  state: "in_review";
  next: string;
}

/**
 * The response with the review acknowledgement excluded, or `null` when that
 * is what came back.
 *
 * `Exclude` distributes over the union `openapi-fetch` built from the two 2xx
 * bodies, so call sites get back the single read shape and go on reading their
 * own fields. The runtime check is what earns the narrowing — this is not a
 * cast, and a body that really did say `in_review` becomes `null` rather than
 * being read as though it were the current values.
 */
export function readShape<T>(data: T | undefined): Exclude<T, InReview> | null {
  if (!data || typeof data !== "object") return null;
  const state = (data as { state?: unknown }).state;
  if (state === "in_review") return null;
  return data as Exclude<T, InReview>;
}
