/**
 * A resumable upload, in the smallest form that is actually resumable.
 *
 * ## Why not a library
 *
 * `tus-js-client` is the obvious choice and it is 40 kB of a protocol we use
 * three verbs of. What it mostly adds is URL storage — keeping the upload URL
 * in `localStorage` so an upload survives a reload — and the contract forbids
 * exactly that: "`uploadUrl` is **never stored server-side**: it is a
 * credential for writing video into our account. Treat it as a secret and do
 * not persist it client-side either."
 *
 * Since yuvoy-api#66 §3 (PR #85) we do not need to. `POST /media/upload-intents`
 * **returns the upload already in flight** with a freshly derived URL rather
 * than a 409, so a reloaded page asks the API for the URL instead of
 * remembering it. That is strictly better than a library's storage: the
 * credential is short-lived and re-obtainable, and it never sits in a place a
 * later script can read.
 *
 * ## What resumable means here, exactly
 *
 * The uplink is 0.5–3 Mbps and it drops. This survives that: a failed chunk is
 * retried after asking the server where it actually got to, so a 40-second
 * dropout costs 40 seconds rather than the whole upload. `HEAD` is what makes
 * it safe — the server's offset is the truth, and a client that assumed its
 * own would write good bytes into the wrong part of the file.
 *
 * It now also survives a reload, a browser restart and a killed app. **That
 * cuts both ways**, which is why `slot.ts` exists: the URL comes back, but the
 * page it comes back to has no memory of whose bytes are behind it, and a
 * resume into the wrong file is a corrupt reel rather than a failed upload.
 * Nothing here decides that — this file moves bytes to an offset it was given.
 */

export const TUS_VERSION = "1.0.0";

export interface TusProgress {
  uploaded: number;
  total: number;
  /** Goes up when a dropped connection is recovered from. */
  resumes: number;
}

export interface TusOptions {
  url: string;
  file: Blob;
  /** From the upload intent. The server decides, not us. */
  chunkBytes: number;
  onProgress?: (p: TusProgress) => void;
  signal?: AbortSignal;
  /** Attempts per chunk before giving up. */
  maxAttempts?: number;
  /** Injected so tests do not sleep. */
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
}

export class TusError extends Error {
  readonly uploaded: number;
  constructor(message: string, uploaded: number) {
    super(message);
    this.name = "TusError";
    this.uploaded = uploaded;
  }
}

/**
 * Exponential backoff with full jitter, the same shape the API client uses.
 *
 * Jitter matters for the same reason it does there: a squall closes a bay,
 * every operator on Havelock loses signal in the same minute, and un-jittered
 * backoff turns that into a synchronised stampede when it comes back.
 */
export function uploadBackoffMs(attempt: number, rand = Math.random): number {
  const base = Math.min(500 * 2 ** attempt, 8_000);
  return Math.round(base * (0.5 + rand() * 0.5));
}

/**
 * The next slice to send, given where the server says it is.
 *
 * Pure and separately tested, because every off-by-one here is a corrupt
 * video that nothing notices until a traveller presses play.
 */
export function nextChunk(
  offset: number,
  total: number,
  chunkBytes: number,
): { start: number; end: number } | null {
  if (offset >= total) return null;
  return { start: offset, end: Math.min(total, offset + chunkBytes) };
}

/** What the server says about the upload behind a URL. */
export interface UploadState {
  /** Bytes it holds. The truth; ours never wins over it. */
  offset: number;
  /**
   * The total length whoever started this upload declared, if it can be read.
   *
   * `null` in two different situations that this deliberately does not
   * distinguish, because the caller must be conservative about both: the
   * length has not been declared yet (nothing has been PATCHed, so the upload
   * is still `Upload-Defer-Length`), or the provider does not expose the header
   * across origins. Either way we do not know how big the file behind this
   * upload is, and `decideSlot` treats not knowing as not knowing.
   *
   * When it IS readable it is the strongest identity signal available — it is
   * the server's own statement about the file it is holding, and it survives a
   * browser whose storage was cleared and a device that was never the one that
   * started the upload.
   */
  declaredLength: number | null;
}

/**
 * Ask the server where it actually got to, and how big it thinks the file is.
 *
 * Both come off one `HEAD`, because they are one question — "what is in this
 * upload" — and asking twice would let the two answers come from either side
 * of a chunk landing.
 */
export async function readUploadState(
  url: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<UploadState> {
  const res = await fetchImpl(url, {
    method: "HEAD",
    headers: { "Tus-Resumable": TUS_VERSION },
    /*
      A cached HEAD is a corrupt upload: the browser would hand back an offset
      from before the last chunk and we would send it again, into the middle of
      the file.
    */
    cache: "no-store",
    signal,
  });
  if (!res.ok) {
    throw new TusError(`The upload could not be found (${res.status}).`, 0);
  }
  /*
    Read the raw header first, and do NOT coerce before checking it.

    `Number(null)` is `0`, and `0` is a perfectly finite, perfectly valid
    offset — so a guard written as `Number.isFinite(Number(header))` treats a
    header that is not there as "the server has nothing", and every resume
    silently restarts from zero. That is the exact failure this branch exists
    to catch, and it was caught by the test rather than by reading the code.
  */
  const raw = res.headers.get("Upload-Offset");
  const offset = raw === null || raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(offset) || offset < 0) {
    /*
      Almost always a missing `Access-Control-Expose-Headers` rather than a
      missing header: cross-origin, an unexposed header reads as null, and the
      symptom is every resume silently restarting from zero.
    */
    throw new TusError(
      "The upload server did not say how much it has. It may not be exposing Upload-Offset across origins.",
      0,
    );
  }

  /*
    Absent is normal and must never read as zero — `Upload-Length: 0` would
    mean an empty file and a zero here would mean "we do not know", and those
    lead to opposite decisions. Not exposed cross-origin is the same as not
    declared, on purpose: see `UploadState.declaredLength`.
  */
  const rawLength = res.headers.get("Upload-Length");
  const length =
    rawLength === null || rawLength.trim() === "" ? NaN : Number(rawLength);
  const declaredLength = Number.isFinite(length) && length > 0 ? length : null;

  return { offset, declaredLength };
}

/** Just the offset, for the upload loop, which has no use for the rest. */
export async function readOffset(
  url: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<number> {
  return (await readUploadState(url, fetchImpl, signal)).offset;
}

export async function uploadResumable(options: TusOptions): Promise<void> {
  const {
    url,
    file,
    chunkBytes,
    onProgress,
    signal,
    maxAttempts = 5,
    sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
    fetchImpl = fetch,
  } = options;

  const total = file.size;
  let resumes = 0;
  let offset = await readOffset(url, fetchImpl, signal);
  onProgress?.({ uploaded: offset, total, resumes });

  let attempt = 0;
  for (;;) {
    if (signal?.aborted) throw new TusError("Upload stopped.", offset);

    const chunk = nextChunk(offset, total, chunkBytes);
    if (!chunk) return;

    try {
      const res = await fetchImpl(url, {
        method: "PATCH",
        headers: {
          "Tus-Resumable": TUS_VERSION,
          "Upload-Offset": String(offset),
          "Content-Type": "application/offset+octet-stream",
          /*
            Declared with the first chunk, because the slot was created without
            it. `POST /media/upload-intents` takes no request body — the API
            cannot know how big the clip is — so the upload is created with
            `Upload-Defer-Length` and the client is the only one that knows.
            Omit this and the provider never learns when the file is finished.
          */
          ...(offset === 0 ? { "Upload-Length": String(total) } : {}),
        },
        body: file.slice(chunk.start, chunk.end),
        signal,
      });

      if (res.status === 409) {
        /*
          The server is somewhere else. Not an error to retry blindly — ask,
          and continue from its answer. This is the branch that stops a resume
          from corrupting a file rather than merely failing.
        */
        offset = await readOffset(url, fetchImpl, signal);
        resumes += 1;
        attempt = 0;
        onProgress?.({ uploaded: offset, total, resumes });
        continue;
      }

      if (!res.ok) {
        throw new TusError(`The upload server answered ${res.status}.`, offset);
      }

      const reported = Number(res.headers.get("Upload-Offset"));
      /*
        Trust the server's number when it gives one. A chunk can be partially
        accepted, and assuming `offset + chunk.length` after a 204 is how a
        client convinces itself it is further along than it is.
      */
      offset = Number.isFinite(reported) ? reported : chunk.end;
      attempt = 0;
      onProgress?.({ uploaded: offset, total, resumes });
    } catch (err) {
      if (signal?.aborted) throw new TusError("Upload stopped.", offset);
      attempt += 1;
      if (attempt >= maxAttempts) {
        throw new TusError(
          err instanceof TusError
            ? err.message
            : "The connection dropped and did not come back.",
          offset,
        );
      }

      await sleep(uploadBackoffMs(attempt - 1));

      /*
        The recovery. Re-read rather than resend: the dropped request may have
        delivered some of its bytes before the socket went, and that is the
        normal case on a bad link rather than the exotic one.
      */
      try {
        const server = await readOffset(url, fetchImpl, signal);
        if (server !== offset) resumes += 1;
        offset = server;
        onProgress?.({ uploaded: offset, total, resumes });
      } catch {
        // Still down. The loop retries the HEAD on the next pass.
      }
    }
  }
}
