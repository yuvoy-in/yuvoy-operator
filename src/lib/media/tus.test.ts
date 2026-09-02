import { describe, it, expect } from "vitest";
import {
  TusError,
  nextChunk,
  readOffset,
  uploadBackoffMs,
  uploadResumable,
} from "./tus";

/**
 * A tus server in twenty lines, so the client's recovery can be driven rather
 * than described.
 *
 * It keeps a real offset and answers HEAD from it, because every bug worth
 * catching here is the client disagreeing with the server about how far along
 * it is — and a fake that echoed the client's own number back could not
 * express that disagreement.
 */
function fakeServer(
  total: number,
  script: {
    failAt?: number[];
    conflictAt?: number[];
    partial?: Record<number, number>;
  } = {},
) {
  let offset = 0;
  const patches: number[] = [];
  let n = 0;

  const fetchImpl = (async (_url: string, init: RequestInit = {}) => {
    if (init.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { "Upload-Offset": String(offset) },
      });
    }
    const at = n++;
    patches.push(
      Number((init.headers as Record<string, string>)["Upload-Offset"]),
    );

    if (script.failAt?.includes(at)) {
      /*
        A dropped socket, not an error response. A jetty losing signal does not
        send a 500 — it stops talking, and `fetch` rejects.
      */
      const delivered = script.partial?.[at];
      if (delivered) offset = Math.min(total, offset + delivered);
      throw new TypeError("Failed to fetch");
    }

    if (script.conflictAt?.includes(at)) {
      return new Response(null, { status: 409 });
    }

    const body = init.body as Blob;
    offset = Math.min(total, offset + body.size);
    return new Response(null, {
      status: 204,
      headers: { "Upload-Offset": String(offset) },
    });
  }) as unknown as typeof fetch;

  return { fetchImpl, patches, offsetNow: () => offset };
}

const blob = (size: number) => new Blob([new Uint8Array(size)]);
const noSleep = async () => {};

describe("the next slice to send", () => {
  it("walks the file and stops exactly at the end", () => {
    expect(nextChunk(0, 10, 4)).toEqual({ start: 0, end: 4 });
    expect(nextChunk(4, 10, 4)).toEqual({ start: 4, end: 8 });
    // Short final chunk, not a 4-byte read past the end.
    expect(nextChunk(8, 10, 4)).toEqual({ start: 8, end: 10 });
    expect(nextChunk(10, 10, 4)).toBeNull();
  });

  it("never asks for anything once the server already has it all", () => {
    // A resumed upload that finished during the dropout must not send a
    // zero-length PATCH — some servers answer 400 and the client would read
    // that as a failure at 100%.
    expect(nextChunk(12, 10, 4)).toBeNull();
  });
});

describe("an upload that goes to plan", () => {
  it("sends the file in the server's chunk size, in order", async () => {
    const total = 10;
    const server = fakeServer(total);
    await uploadResumable({
      url: "/u",
      file: blob(total),
      chunkBytes: 4,
      fetchImpl: server.fetchImpl,
      sleep: noSleep,
    });
    expect(server.patches).toEqual([0, 4, 8]);
    expect(server.offsetNow()).toBe(total);
  });

  it("declares the file length with the first chunk, and only the first", async () => {
    /*
      The slot is created by `POST /media/upload-intents`, which takes no
      request body — the API cannot know how big the clip is, so the upload is
      created with `Upload-Defer-Length` and the client is the only party that
      knows. Omit it and the provider never learns when the file is finished;
      repeat it on later chunks and a strict server answers 400.
    */
    const lengths: (string | undefined)[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit = {}) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      if (init.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "Upload-Offset": "0" },
        });
      }
      lengths.push(headers["Upload-Length"]);
      const offset =
        Number(headers["Upload-Offset"]) + (init.body as Blob).size;
      return new Response(null, {
        status: 204,
        headers: { "Upload-Offset": String(offset) },
      });
    }) as unknown as typeof fetch;

    await uploadResumable({
      url: "/u",
      file: blob(10),
      chunkBytes: 4,
      fetchImpl,
      sleep: noSleep,
    });

    expect(lengths).toEqual(["10", undefined, undefined]);
  });

  it("reports progress the operator can watch", async () => {
    const seen: number[] = [];
    const server = fakeServer(10);
    await uploadResumable({
      url: "/u",
      file: blob(10),
      chunkBytes: 4,
      fetchImpl: server.fetchImpl,
      sleep: noSleep,
      onProgress: (p) => seen.push(p.uploaded),
    });
    // Starts at what the server already had, ends at the whole file.
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(10);
  });

  it("starts from what the server already has, not from zero", async () => {
    /*
      The whole point of HEAD. A client that assumed zero would re-send bytes
      the server already holds — which on a 1 Mbps link is the difference
      between finishing and starting again.
    */
    const server = fakeServer(10);
    await server.fetchImpl("/u", {
      method: "PATCH",
      headers: { "Upload-Offset": "0" },
      body: blob(6),
    } as RequestInit);
    server.patches.length = 0;

    await uploadResumable({
      url: "/u",
      file: blob(10),
      chunkBytes: 4,
      fetchImpl: server.fetchImpl,
      sleep: noSleep,
    });
    expect(server.patches).toEqual([6]);
  });
});

describe("an upload on a link that drops", () => {
  it("recovers from a dropped socket and counts the resume", async () => {
    const server = fakeServer(12, { failAt: [1] });
    const resumes: number[] = [];

    await uploadResumable({
      url: "/u",
      file: blob(12),
      chunkBytes: 4,
      fetchImpl: server.fetchImpl,
      sleep: noSleep,
      onProgress: (p) => resumes.push(p.resumes),
    });

    expect(server.offsetNow()).toBe(12);
    // The retried chunk went back to 4, not to 0.
    expect(server.patches).toEqual([0, 4, 4, 8]);
  });

  it("keeps the bytes that landed before the socket went", async () => {
    /*
      The normal case on a bad link, not the exotic one: half a chunk arrives,
      then the connection dies. Re-sending the whole chunk is safe but wasteful;
      what must never happen is resuming from the client's idea of the offset.
    */
    const server = fakeServer(12, { failAt: [1], partial: { 1: 2 } });

    await uploadResumable({
      url: "/u",
      file: blob(12),
      chunkBytes: 4,
      fetchImpl: server.fetchImpl,
      sleep: noSleep,
    });

    // Second attempt resumed from 6 — where the server actually was — not 4.
    expect(server.patches).toEqual([0, 4, 6, 10]);
    expect(server.offsetNow()).toBe(12);
  });

  it("asks the server where it is when it answers 409, rather than retrying blind", async () => {
    /*
      409 means "you are not where you think you are". Retrying the same offset
      loops forever; assuming the next one writes good bytes into the wrong
      part of the file, which surfaces as a corrupt video long after anybody
      can explain it.
    */
    const server = fakeServer(8, { conflictAt: [1] });
    await uploadResumable({
      url: "/u",
      file: blob(8),
      chunkBytes: 4,
      fetchImpl: server.fetchImpl,
      sleep: noSleep,
    });
    expect(server.offsetNow()).toBe(8);
  });

  it("gives up eventually, and says how far it got", async () => {
    const server = fakeServer(12, { failAt: [1, 2, 3, 4, 5, 6, 7, 8] });
    await expect(
      uploadResumable({
        url: "/u",
        file: blob(12),
        chunkBytes: 4,
        fetchImpl: server.fetchImpl,
        sleep: noSleep,
        maxAttempts: 3,
      }),
    ).rejects.toMatchObject({ name: "TusError", uploaded: 4 });
  });

  it("stops when it is told to, without pretending it finished", async () => {
    const server = fakeServer(12);
    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadResumable({
        url: "/u",
        file: blob(12),
        chunkBytes: 4,
        fetchImpl: server.fetchImpl,
        sleep: noSleep,
        signal: controller.signal,
      }),
    ).rejects.toThrow(TusError);
  });
});

describe("reading the offset", () => {
  it("names the CORS cause when the header is not there", async () => {
    /*
      Cross-origin, an unexposed header reads as null — so the symptom of a
      missing `Access-Control-Expose-Headers` is every resume silently
      restarting from zero. Worth saying out loud rather than reporting as a
      generic upload failure.
    */
    const fetchImpl = (async () =>
      new Response(null, { status: 200 })) as unknown as typeof fetch;
    await expect(readOffset("/u", fetchImpl)).rejects.toThrow(/Upload-Offset/);
  });

  it("does not let a cached HEAD decide where to resume", async () => {
    const seen: RequestInit[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      seen.push(init);
      return new Response(null, {
        status: 200,
        headers: { "Upload-Offset": "4" },
      });
    }) as unknown as typeof fetch;

    await readOffset("/u", fetchImpl);
    // A cached offset is a corrupt upload.
    expect(seen[0].cache).toBe("no-store");
  });
});

describe("backoff", () => {
  it("grows, caps, and is jittered", () => {
    // Un-jittered backoff turns "a squall closed the bay" into every operator
    // on Havelock retrying in the same millisecond.
    expect(uploadBackoffMs(0, () => 0)).toBe(250);
    expect(uploadBackoffMs(0, () => 1)).toBe(500);
    expect(uploadBackoffMs(20, () => 1)).toBe(8_000);
    expect(uploadBackoffMs(3, () => 0.5)).toBeGreaterThan(
      uploadBackoffMs(1, () => 0.5),
    );
  });
});
