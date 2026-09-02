/**
 * What we check before spending a single byte of somebody's uplink.
 *
 * The whole reason this exists: Havelock runs at 0.5–3 Mbps. A 180 MB clip is
 * twenty minutes of a phone held still on a boat, and finding out afterwards
 * that it was four seconds too long, or filmed sideways, is not a validation
 * message — it is twenty minutes of somebody's morning.
 *
 * The limits are **not hardcoded**. `maxBytes`, `maxSeconds` and `aspectRatio`
 * all come back on the upload intent, so the server stays the authority and
 * this file only enforces what it was told.
 */

export interface UploadLimits {
  maxBytes: number;
  maxSeconds: number;
  /** e.g. `"9:16"`. Absent means the server did not ask for one. */
  aspectRatio?: string;
}

/** What the browser managed to read out of the file locally. */
export interface LocalVideoFacts {
  seconds?: number;
  width?: number;
  height?: number;
}

export interface PreflightProblem {
  /** `refuse` stops the upload; `warn` is shown and does not. */
  severity: "refuse" | "warn";
  message: string;
}

const MB = 1024 * 1024;

/** `"9:16"` → 0.5625. Anything unparseable returns null rather than guessing. */
export function parseAspectRatio(value: string | undefined): number | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d+)\s*[:/]\s*(\d+)$/);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return null;
  return w / h;
}

export function formatBytes(bytes: number): string {
  if (bytes >= MB) {
    const mb = bytes / MB;
    return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Whether this file can be uploaded, and what to say if not.
 *
 * `facts` is what the browser could decode. **An empty `facts` is not a
 * failure**: a phone's HEVC clip is something Safari reads and Chrome does
 * not, and Cloudflare handles both. Refusing to upload a file because *this*
 * browser could not decode it would reject good footage for a reason that has
 * nothing to do with the footage. So the duration and shape checks only run on
 * facts we actually have, and their absence is a warning at most.
 */
/**
 * The refusals that need nothing from the server.
 *
 * Separated because of what asking the server costs here: an upload intent is
 * a **single per-operator slot**, and a second one is refused with 409 while
 * the first is open. So creating an intent to find out that somebody picked a
 * photo burns the slot on a file that was never going to be uploaded — and the
 * contract gives no way to hand it back. A first version did exactly that, and
 * every subsequent upload in the session met "an upload is already going".
 *
 * These two need no limits, so they run first, for free.
 */
export function localRefusals(file: {
  size: number;
  type: string;
}): PreflightProblem[] {
  if (file.size === 0) {
    return [{ severity: "refuse", message: "That file is empty." }];
  }
  if (file.type && !file.type.startsWith("video/")) {
    const kind = file.type.split("/")[0] || "file";
    return [
      {
        severity: "refuse",
        // "an image", not "a image" — the article follows the word.
        message: `That is ${/^[aeiou]/i.test(kind) ? "an" : "a"} ${kind}, not a video.`,
      },
    ];
  }
  return [];
}

export function preflight(
  file: { name: string; size: number; type: string },
  limits: UploadLimits,
  facts: LocalVideoFacts,
): PreflightProblem[] {
  /*
    Type and emptiness first: a 200 MB `.mov` that is really a ProRes master is
    the common mistake, and naming it beats a size number.
  */
  const local = localRefusals(file);
  if (local.length) return local;

  const problems: PreflightProblem[] = [];

  if (file.size > limits.maxBytes) {
    problems.push({
      severity: "refuse",
      message: `That clip is ${formatBytes(file.size)}. The most we can take is ${formatBytes(limits.maxBytes)} — trim it, or export it smaller.`,
    });
  }

  if (typeof facts.seconds === "number" && facts.seconds > limits.maxSeconds) {
    problems.push({
      severity: "refuse",
      message: `That clip is ${Math.round(facts.seconds)} seconds. The feed takes up to ${limits.maxSeconds}.`,
    });
  }

  const wanted = parseAspectRatio(limits.aspectRatio);
  if (wanted && facts.width && facts.height) {
    const actual = facts.width / facts.height;
    /*
      A tolerance, not an equality — and calibrated against the shapes phones
      actually produce rather than picked round.

        0.5625  9:16      what the feed asks for
        0.4622  19.5:9    every iPhone since the notch
        0.6667  2:3       a common vertical crop
        0.75    3:4       upright, but squarely cropped in a 9:16 frame
        1.0     square
        1.7778  16:9      filmed sideways

      ±0.12 accepts the first three silently and warns from 3:4 onward, which
      is where the cropping starts being visible. Landscape is refused outright:
      a sideways clip in a vertical feed is a black-barred postage stamp nobody
      watches, and uploading 180 MB of one over a 1 Mbps link to find that out
      is twenty minutes of somebody's morning.

      A looser tolerance was tried first and let 3:4 through in silence, which
      is the failure this check exists to prevent.
    */
    if (Math.abs(actual - wanted) > 0.12) {
      problems.push({
        severity: actual > 1 ? "refuse" : "warn",
        message:
          actual > 1
            ? `That was filmed sideways — ${facts.width}×${facts.height}. The feed is upright ${limits.aspectRatio}, and a landscape clip shows as a small box between black bars.`
            : `That is ${facts.width}×${facts.height}, not quite ${limits.aspectRatio}. It will still work; it may be cropped a little at the top and bottom.`,
      });
    }
  }

  if (facts.seconds === undefined && facts.width === undefined) {
    /*
      Said, not swallowed. If the browser could not read the file, the checks
      above did not run, and the operator should know that the twenty minutes
      they are about to spend are on trust.
    */
    problems.push({
      severity: "warn",
      message:
        "This browser could not read the video to check its length or shape. It should still upload — we will tell you if it is not usable.",
    });
  }

  return problems;
}

export const refuses = (problems: PreflightProblem[]): boolean =>
  problems.some((p) => p.severity === "refuse");
