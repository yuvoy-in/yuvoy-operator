import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

/**
 * A tus 1.0.0 endpoint, mocked — **test and dev infrastructure, never shipped.**
 *
 * ## Why this is a separate HTTP server rather than a route handler
 *
 * O8's bytes go **from the browser straight to the video provider**: "bytes
 * never pass through this API." So unlike every other call in this portal, the
 * upload is a request MSW cannot intercept — MSW here runs inside the Next
 * server process and there is no browser worker.
 *
 * The obvious fix is a route handler under `src/app`, and `pnpm qa` fails one
 * on purpose: a browser-callable endpoint on this origin is exactly the
 * surface `/operator/v1`'s CORS refusal exists to remove. So the mock provider
 * is what it is in production — **a different origin** — and it lives here,
 * started only when `NEXT_PUBLIC_API_MOCKING` is on.
 *
 * ## What it actually implements
 *
 * Enough of tus to be worth testing against, and no more. Creation is not
 * here: `POST /media/upload-intents` hands out the upload URL, so the resource
 * already exists by the time the browser sees it.
 *
 *   - `OPTIONS` — CORS preflight, and `Access-Control-Expose-Headers` for
 *     `Upload-Offset`, without which a cross-origin client cannot read the one
 *     header resumption depends on.
 *   - `HEAD` — the current offset. This is the call that makes a dropped
 *     connection recoverable: ask where you got to, carry on from there.
 *   - `PATCH` — append at `Upload-Offset`, `409` on a mismatch, because a
 *     client that resumes from the wrong place must be told rather than
 *     silently corrupt the file.
 *
 * An upload id ending `-drop` fails its second PATCH mid-body, once. That is
 * the whole point of the file: a resumable uploader that has never been
 * interrupted is an uploader whose resume path has never run.
 */

interface Upload {
  /**
   * Unknown until the client declares it.
   *
   * `POST /media/upload-intents` carries no request body, so the API creates
   * the slot without knowing how big the clip is — which is exactly what tus's
   * `Upload-Defer-Length` is for. Modelling it means the client has to send
   * `Upload-Length` with its first chunk, as it would against a real provider,
   * instead of the mock quietly knowing a size nobody told it.
   */
  length: number | null;
  offset: number;
  /** Fails one PATCH, then behaves. */
  dropOnce: boolean;
  dropped: boolean;
}

const uploads = new Map<string, Upload>();

/**
 * @param length The size the slot was opened for, or `null` to defer it.
 *
 * `POST /media/upload-intents` takes `sizeBytes` and fixes the length at
 * creation, so production passes a number and the client must NOT send
 * `Upload-Length` on its first chunk. `null` keeps the older deferred
 * behaviour reachable — the client reads `Upload-Defer-Length` off a `HEAD`
 * rather than assuming either, and both paths are worth exercising.
 */
export function createMockUpload(
  id: string,
  length: number | null = null,
): void {
  uploads.set(id, {
    length,
    offset: 0,
    dropOnce: id.endsWith("-drop"),
    dropped: false,
  });
}

export function mockUploadOffset(id: string): number | null {
  return uploads.get(id)?.offset ?? null;
}

/** Whether every declared byte has arrived. An unknown length is never done. */
export function mockUploadDone(id: string): boolean {
  const upload = uploads.get(id);
  return !!upload && upload.length !== null && upload.offset >= upload.length;
}

export function resetMockUploads(): void {
  uploads.clear();
}

const TUS_HEADERS = {
  "Tus-Resumable": "1.0.0",
  "Tus-Version": "1.0.0",
  "Tus-Extension": "creation,expiration",
  "Tus-Max-Size": String(200 * 1024 * 1024),
};

function cors(res: ServerResponse, origin: string | undefined) {
  res.setHeader("Access-Control-Allow-Origin", origin ?? "*");
  res.setHeader("Access-Control-Allow-Methods", "HEAD, PATCH, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Tus-Resumable, Upload-Offset, Upload-Length, Upload-Defer-Length, Content-Type",
  );
  /*
    The load-bearing one. A cross-origin client cannot read a response header
    it is not told about, and `Upload-Offset` is the entire resumption
    protocol — omit this and every resume silently restarts from zero.
  */
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Upload-Offset, Upload-Length, Upload-Defer-Length, Tus-Resumable",
  );
}

function idOf(url: string | undefined): string | null {
  const m = (url ?? "").match(/^\/uploads\/([A-Za-z0-9_-]+)$/);
  return m ? m[1] : null;
}

/**
 * Photographs that have actually arrived at this "host", by image id.
 *
 * The whole reason `POST /media/photo-intents/complete` exists is that "the
 * host is asked whether the file arrived and who it belongs to; the client is
 * not believed about either." A mock that let `complete` succeed for an id
 * nothing was ever uploaded against would delete that property and let a
 * browser mint a media asset out of a failed upload.
 */
const photos = new Map<string, { bytes: number }>();

export function mockPhotoArrived(imageId: string): boolean {
  return photos.has(imageId);
}

export function resetMockPhotos(): void {
  photos.clear();
}

/** `/photos/<imageId>` → the id, or null. */
function photoIdOf(url: string | undefined): string | null {
  const m = (url ?? "").match(/^\/photos\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * The image host — one multipart POST, no tus.
 *
 * A DIFFERENT ORIGIN from the app, exactly as the video host is and exactly as
 * production is: "bytes never pass through this API". Running it here keeps the
 * client's `fetch` a genuine cross-origin upload rather than a same-origin call
 * that would pass whatever CORS mistake we made.
 */
function handlePhoto(
  req: IncomingMessage,
  res: ServerResponse,
  imageId: string,
) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end();
  }

  const type = String(req.headers["content-type"] ?? "");
  if (!type.startsWith("multipart/form-data")) {
    /*
      The contract says multipart with the field name `file`. Refused rather
      than shrugged at, because a client that sent the raw blob would work
      against a tolerant mock and fail against the host.
    */
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end("Expected multipart/form-data with a `file` field.");
  }

  let received = 0;
  let sawFileField = false;
  req.on("data", (chunk: Buffer) => {
    received += chunk.length;
    // Enough to tell a `file` part from something else without pulling in a
    // multipart parser for a mock.
    if (!sawFileField && chunk.toString("latin1").includes('name="file"')) {
      sawFileField = true;
    }
  });
  req.on("end", () => {
    if (!sawFileField) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.end("No `file` field in the upload.");
    }
    photos.set(imageId, { bytes: received });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ id: imageId, uploaded: true }));
  });
  req.on("error", () => {
    /* The socket went. Nothing is recorded, and `complete` will 400. */
  });
}

function handle(req: IncomingMessage, res: ServerResponse) {
  cors(res, req.headers.origin);
  for (const [k, v] of Object.entries(TUS_HEADERS)) res.setHeader(k, v);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  const photoId = photoIdOf(req.url);
  if (photoId) return handlePhoto(req, res, photoId);

  const id = idOf(req.url);
  const upload = id ? uploads.get(id) : undefined;
  if (!upload) {
    res.statusCode = 404;
    return res.end();
  }

  if (req.method === "HEAD") {
    res.setHeader("Upload-Offset", String(upload.offset));
    if (upload.length === null) res.setHeader("Upload-Defer-Length", "1");
    else res.setHeader("Upload-Length", String(upload.length));
    // A cached offset is a corrupt upload.
    res.setHeader("Cache-Control", "no-store");
    res.statusCode = 200;
    return res.end();
  }

  if (req.method !== "PATCH") {
    res.statusCode = 405;
    return res.end();
  }

  if (req.headers["content-type"] !== "application/offset+octet-stream") {
    res.statusCode = 415;
    return res.end();
  }

  const claimed = Number(req.headers["upload-offset"]);
  if (!Number.isFinite(claimed) || claimed !== upload.offset) {
    /*
      Told, not tolerated. A client resuming from the wrong place would write
      valid-looking bytes into the wrong part of the file, and the failure
      would surface as a corrupt video long after anybody could explain it.
    */
    res.statusCode = 409;
    return res.end();
  }

  /*
    A length declared against an upload whose length is already fixed is a tus
    protocol error, and this refuses it rather than shrugging.

    That is exactly the mistake this client shipped when the endpoint gained
    `sizeBytes`: the header had always been sent unconditionally, correctly,
    right up until the slot stopped being created with a deferred length. A
    mock that tolerated it would let it ship again.

    ## This is deliberately STRICTER than production, and stays that way

    @Himacharan128 measured the real Cloudflare Stream account on 6 Sep 2026
    (yuvoy-operator#24): a final chunk sent WITH `Upload-Length` against a
    fixed-length slot returned `204`, and so did the control without it.
    Cloudflare tolerates the redundant header today.

    Kept strict anyway, because the two are answering different questions.
    Cloudflare's job is to accept the upload; this file's job is to fail the
    one regression that has actually bitten us. Loosening it to match would
    delete the only thing standing between `4c7da30` and shipping again — and
    "the provider happens to tolerate it" is an implementation detail we do
    not control, not a promise in the tus spec.

    The cost Hima named is real — a mock that refuses what production permits
    can fail a correct client for nothing — so the refusal is paid for by
    saying exactly what it wants instead of answering a bare `400`. A client
    that meets this has the fix in front of it.
  */
  if (upload.length !== null && req.headers["upload-length"] !== undefined) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end(
      "Upload-Length was sent against a slot whose length is already fixed. " +
        "Branch on the opening HEAD: declare a length only when it answers " +
        "Upload-Defer-Length. This mock is deliberately stricter than " +
        "Cloudflare Stream, which tolerates the redundant header " +
        "(measured 2026-09-06, yuvoy-operator#24).",
    );
  }

  // Declared once, with the first chunk, and never revised afterwards.
  const declared = Number(req.headers["upload-length"]);
  if (upload.length === null && Number.isFinite(declared) && declared > 0) {
    upload.length = declared;
  }
  if (upload.length === null) {
    // A PATCH before anybody has said how long the file is.
    res.statusCode = 400;
    return res.end();
  }
  const length = upload.length;

  let received = 0;
  let killed = false;

  req.on("data", (chunk: Buffer) => {
    if (killed) return;
    received += chunk.length;

    if (upload.dropOnce && !upload.dropped && upload.offset > 0) {
      /*
        The dropout. Destroyed mid-body rather than answered with a status:
        a jetty losing signal does not send a 500, it stops talking — and a
        client that only handles error responses handles neither.

        The bytes that did arrive are kept, because tus keeps them. Resuming
        from a HEAD is the point.
      */
      upload.dropped = true;
      killed = true;
      upload.offset = Math.min(
        length,
        upload.offset + Math.floor(received / 2),
      );
      req.destroy();
      res.destroy();
    }
  });

  req.on("end", () => {
    if (killed) return;
    upload.offset = Math.min(length, upload.offset + received);
    res.setHeader("Upload-Offset", String(upload.offset));
    res.statusCode = 204;
    res.end();
  });

  req.on("error", () => {
    /* The socket went. Whatever we counted stands. */
  });
}

let server: ReturnType<typeof createServer> | null = null;

export const MOCK_TUS_PORT = Number(process.env.MOCK_TUS_PORT ?? 3201);

/**
 * Idempotent, and never fatal.
 *
 * `instrumentation.register()` re-runs across a hot reload, and `next build`
 * runs it too during static generation — where a listener that held the event
 * loop open would hang a build that was otherwise finished. Hence `unref`, and
 * hence a port already in use being a shrug rather than a crash.
 */
export function startMockTusServer(): void {
  if (server) return;
  server = createServer(handle);
  server.on("error", () => {
    server = null;
  });
  try {
    server.listen(MOCK_TUS_PORT, "127.0.0.1", () => {
      server?.unref();
    });
  } catch {
    server = null;
  }
}
