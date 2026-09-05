import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetSlot, recallSlot, rememberSlot } from "./slot-store";

const reef = { name: "reef.mp4", size: 3 * 1024 * 1024, lastModified: 1000 };

/*
  The environment is jsdom, so `window.localStorage` is real. The throwing and
  absent cases are simulated by replacing the property, because they are the
  ones that matter on a phone: Safari private browsing throws on write, and a
  browser set to block site data throws on access.
*/
function replaceStorage(value: unknown) {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get: () => value,
  });
}

const realStorage = window.localStorage;

beforeEach(() => {
  replaceStorage(realStorage);
  window.localStorage.clear();
});

afterEach(() => {
  replaceStorage(realStorage);
  vi.restoreAllMocks();
});

describe("slot-store", () => {
  it("gives back what went into this intent", () => {
    rememberSlot("upi_1", reef);
    expect(recallSlot("upi_1")).toEqual(reef);
  });

  it("gives nothing back for a different intent", () => {
    /*
      The load-bearing one. A record from a finished or expired upload names a
      file that has nothing to do with the slot being handed out now, and a
      stale identity is worse than none: it would make `decideSlot` confident
      about the wrong file rather than cautious about an unknown one.
    */
    rememberSlot("upi_1", reef);
    expect(recallSlot("upi_2")).toBeNull();
  });

  it("forgets", () => {
    rememberSlot("upi_1", reef);
    forgetSlot();
    expect(recallSlot("upi_1")).toBeNull();
  });

  it("never stores the upload URL", () => {
    /*
      The contract: "`uploadUrl` … is a credential for writing video into our
      account. Treat it as a secret and do not persist it client-side either."
      Asserted against the raw stored bytes rather than the API surface,
      because the way this would break is somebody widening the record.
    */
    rememberSlot("upi_1", reef);
    const raw = window.localStorage.getItem("yuvoy.operator.upload-slot.v1")!;
    expect(raw).not.toMatch(/https?:/);
    expect(Object.keys(JSON.parse(raw))).toEqual(["intentId", "identity"]);
  });

  it("refuses a record that is not a file identity", () => {
    // Anything on this origin can write to storage. A malformed identity would
    // otherwise flow straight into a resume decision.
    for (const bad of [
      "not json",
      JSON.stringify({ intentId: "upi_1" }),
      JSON.stringify({ intentId: "upi_1", identity: { name: "a.mp4" } }),
      JSON.stringify({
        intentId: "upi_1",
        identity: { name: "a.mp4", size: "3", lastModified: 1 },
      }),
      JSON.stringify({
        intentId: "upi_1",
        identity: { name: "a.mp4", size: NaN, lastModified: 1 },
      }),
    ]) {
      window.localStorage.setItem("yuvoy.operator.upload-slot.v1", bad);
      expect(recallSlot("upi_1")).toBeNull();
    }
  });

  it("survives storage that throws, because the upload does not need it", () => {
    /*
      Safari private browsing, or a browser set to block site data. A throw
      here would take out the upload screen; the upload works without the
      memory, falling back to the server's declared length in `decideSlot`.
    */
    replaceStorage(
      new Proxy(
        {},
        {
          get() {
            throw new Error("The operation is insecure.");
          },
        },
      ),
    );
    expect(() => rememberSlot("upi_1", reef)).not.toThrow();
    expect(recallSlot("upi_1")).toBeNull();
    expect(() => forgetSlot()).not.toThrow();
  });

  it("survives storage that is not there at all", () => {
    replaceStorage(undefined);
    expect(() => rememberSlot("upi_1", reef)).not.toThrow();
    expect(recallSlot("upi_1")).toBeNull();
    expect(() => forgetSlot()).not.toThrow();
  });
});
