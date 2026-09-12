import { formatBytes, type PreflightProblem } from "./preflight";

/**
 * What we check about a photograph before spending a byte of somebody's
 * uplink — yuvoy-operator#27.
 *
 * ## Why this is not `preflight.ts`
 *
 * That file checks a *clip*: duration, aspect ratio, and a 200 MB ceiling. A
 * photograph has no duration, no shape requirement — a gallery holds whatever
 * shape the operator took — and a ceiling an order of magnitude smaller.
 * Sharing one function would mean a signature where half the fields are
 * meaningless to half the callers, which is how a video rule ends up refusing a
 * photograph.
 *
 * What they DO share is `formatBytes` and the `PreflightProblem` shape, so the
 * two upload screens say the same kind of thing in the same words.
 *
 * ## The limit is the server's, and it is smaller than Cloudflare's
 *
 * `maxBytes` comes back on the intent. Ours is 5 MB where the host allows 10:
 * "a 10 MB photograph on a listing costs the traveller the download on island
 * 4G, which is the whole reason posters exist." So it is read off the intent
 * and never hardcoded — the server stays the authority on its own ceiling, and
 * a change there needs no deploy here.
 */

/** What the browser managed to read out of the image locally. */
export interface LocalImageFacts {
  width?: number;
  height?: number;
}

/**
 * The refusals that need nothing from the server.
 *
 * Run BEFORE an intent is asked for, exactly as the clip path does. An intent
 * is a slot with an expiry and a one-time URL; asking for one to discover that
 * somebody picked a PDF spends it on a file that was never going to be
 * uploaded.
 */
export function localPhotoRefusals(file: {
  size: number;
  type: string;
}): PreflightProblem[] {
  if (file.size === 0) {
    return [{ severity: "refuse", message: "That file is empty." }];
  }
  if (file.type && !file.type.startsWith("image/")) {
    const kind = file.type.split("/")[0] || "file";
    return [
      {
        severity: "refuse",
        // "an audio", "a video" — the article follows the word.
        message: `That is ${/^[aeiou]/i.test(kind) ? "an" : "a"} ${kind}, not a photograph.`,
      },
    ];
  }
  /*
    An animated format is a video wearing an image's content type. It would
    upload and then sit in a gallery as a still of its first frame, which is
    not what anybody chose. Named rather than silently accepted.
  */
  if (file.type === "image/gif") {
    return [
      {
        severity: "refuse",
        message:
          "A GIF shows as a single still on a listing. Upload it as a reel if it moves, or as a JPEG or PNG if it does not.",
      },
    ];
  }
  return [];
}

/**
 * The smallest long edge worth putting on a listing card.
 *
 * A WARNING, never a refusal, and the distinction is deliberate: the server
 * asks for no dimensions at all, so refusing on this would be inventing a rule
 * the API does not have — the thing this portal is careful not to do. But a
 * 400px photograph stretched across a phone card is visibly soft, and the
 * operator is the only person who can go and find a bigger one.
 *
 * 1000px is roughly a 2x phone card. Below it, softness is not a matter of
 * taste.
 */
const SOFT_LONG_EDGE = 1000;

export function photoPreflight(
  file: { name: string; size: number; type: string },
  limits: { maxBytes: number },
  facts: LocalImageFacts,
): PreflightProblem[] {
  const local = localPhotoRefusals(file);
  if (local.length) return local;

  const problems: PreflightProblem[] = [];

  if (file.size > limits.maxBytes) {
    problems.push({
      severity: "refuse",
      message: `That photograph is ${formatBytes(file.size)}. The most we can take is ${formatBytes(limits.maxBytes)}. Travellers open these on island 4G, so a smaller export is better for them too.`,
    });
  }

  const longEdge = Math.max(facts.width ?? 0, facts.height ?? 0);
  if (longEdge > 0 && longEdge < SOFT_LONG_EDGE) {
    problems.push({
      severity: "warn",
      message: `That is ${facts.width}×${facts.height}, which will look soft on a phone. It will still upload. A larger one from the original photo is better if you have it.`,
    });
  }

  if (facts.width === undefined) {
    // Said rather than swallowed, the same as the clip path: if the browser
    // could not read it, the check above did not run.
    problems.push({
      severity: "warn",
      message:
        "This browser could not read the photograph to check its size. It should still upload.",
    });
  }

  return problems;
}

/**
 * Read a picture's dimensions in the browser.
 *
 * Resolves to an empty object rather than rejecting: a format this browser
 * cannot decode is not a reason to refuse a file the host handles perfectly
 * well — the same call the clip path makes about a phone's HEVC.
 *
 * The object URL is always revoked. A leaked one holds the whole file in
 * memory, and an operator adding twenty photographs on a phone is exactly who
 * would notice.
 */
export function readImageFacts(file: Blob): Promise<LocalImageFacts> {
  return new Promise((resolve) => {
    if (
      typeof Image === "undefined" ||
      typeof URL?.createObjectURL !== "function"
    ) {
      resolve({});
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    const done = (facts: LocalImageFacts) => {
      URL.revokeObjectURL(url);
      resolve(facts);
    };
    img.onload = () =>
      done({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => done({});
    img.src = url;
  });
}
