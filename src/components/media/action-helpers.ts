/*
  Shared by the upload, publish and photo actions. Not "use server": a
  file with that line may export only actions a browser can call, and this
  is a plain helper (yuvoy-operator#178).
*/

/**
 * Which of the two per-listing ceilings a `409` hit.
 *
 * Read defensively: `details` is `unknown` on the error, the kind is an open
 * string on the wire, and a shape this build has not met must fall through to
 * the API's own sentence rather than produce a confident wrong one.
 */
function fullCeiling(
  details: unknown,
): { limit: number; noun: string; other: string } | null {
  if (!details || typeof details !== "object") return null;
  const { kind, limit } = details as { kind?: unknown; limit?: unknown };
  if (typeof limit !== "number" || !Number.isFinite(limit)) return null;
  if (kind === "image") {
    return { limit, noun: "photographs", other: "reels" };
  }
  if (kind === "video") {
    return { limit, noun: "reels", other: "photographs" };
  }
  return null;
}

export { fullCeiling };
