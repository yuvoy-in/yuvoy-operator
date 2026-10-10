// @vitest-environment node
import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { firstFreeLoopbackPort } from "../../../mocks/free-port";

/**
 * The e2e run's mock media host is its own (yuvoy-operator#163).
 *
 * It listened on 3201 whatever else did, and shrugged when it could not. On a
 * machine where another process held that port, every upload the e2e server
 * minted reached that process, and four upload walks failed at four
 * unrelated-looking lines. The run now takes a free port, and a server that
 * still cannot have its port stops under the e2e web server and warns
 * everywhere else.
 */

/** Holds a loopback port, as another mocked operator server would. */
function hold(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function release(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** A port to hold with room above it, found the way the e2e run finds one. */
function aFreePort(): number {
  return firstFreeLoopbackPort(41_000, 41_999);
}

describe("the first free loopback port", () => {
  it("passes over a port something else holds, and takes it once let go", async () => {
    const taken = aFreePort();
    const holder = await hold(taken);
    try {
      expect(firstFreeLoopbackPort(taken, taken + 20)).toBeGreaterThan(taken);
      expect(() => firstFreeLoopbackPort(taken, taken)).toThrow(
        `No port from ${taken} to ${taken} is free`,
      );
    } finally {
      await release(holder);
    }
    expect(firstFreeLoopbackPort(taken, taken)).toBe(taken);
  });

  it("refuses a range that is not one", () => {
    expect(() => firstFreeLoopbackPort(3299, 3201)).toThrow(RangeError);
    expect(() => firstFreeLoopbackPort(65_530, 65_600)).toThrow(RangeError);
    expect(() => firstFreeLoopbackPort(Number.NaN, 3201)).toThrow(RangeError);
  });
});

describe("a mock media host that cannot have its port", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /** A fresh copy of the host, reading `MOCK_TUS_PORT` as a server would. */
  async function startOn(port: number): Promise<void> {
    vi.stubEnv("MOCK_TUS_PORT", String(port));
    vi.resetModules();
    const { startMockTusServer } = await import("../../../mocks/tus-server");
    await startMockTusServer();
  }

  it("stops the e2e web server, and says which port and how to find its holder", async () => {
    vi.stubEnv("MOCK_TUS_STRICT", "1");
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const taken = aFreePort();
    const holder = await hold(taken);
    try {
      await startOn(taken);
    } finally {
      await release(holder);
    }

    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledTimes(1);
    const said = String(error.mock.calls[0][0]);
    expect(said).toContain(`127.0.0.1:${taken} (EADDRINUSE)`);
    expect(said).toContain(`lsof -nP -iTCP:${taken} -sTCP:LISTEN`);
  });

  it("keeps a dev server up, and warns that its uploads will fail", async () => {
    vi.stubEnv("MOCK_TUS_STRICT", "");
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const taken = aFreePort();
    const holder = await hold(taken);
    try {
      await startOn(taken);
    } finally {
      await release(holder);
    }

    expect(exit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(
      `127.0.0.1:${taken} (EADDRINUSE)`,
    );
  });
});
