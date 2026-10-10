import { execFileSync } from "node:child_process";

/**
 * Tries each port in turn with the call the mock media host itself makes,
 * and prints the first one that listens. Exits 1 when none does.
 */
const PROBE = `
const net = require("node:net");
const [from, to] = process.argv.slice(1).map(Number);
(function attempt(port) {
  if (port > to) process.exit(1);
  const server = net.createServer();
  server.once("error", () => attempt(port + 1));
  server.listen(port, "127.0.0.1", () => {
    server.close(() => process.stdout.write(String(port)));
  });
})(from);
`;

/**
 * The first port from `from` to `to` that a server may listen on at
 * 127.0.0.1, asked of the OS the same way the mock media host binds.
 *
 * For `playwright.config.ts`, which is evaluated synchronously and has to
 * know the host's port before it starts the server: the build bakes the
 * origin into the CSP, and the server mints upload URLs with it. Node has no
 * synchronous `listen`, so the asking happens in a child process.
 *
 * Free at this instant, which is all a probe can say. If something takes the
 * port before the server does, the server stops and says so
 * (`MOCK_TUS_STRICT` in `mocks/tus-server.ts`).
 */
export function firstFreeLoopbackPort(from: number, to: number): number {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 1 ||
    from > to ||
    to > 65_535
  ) {
    throw new RangeError(`Not a port range: ${from} to ${to}.`);
  }
  let answer: string;
  try {
    answer = execFileSync(
      process.execPath,
      ["-e", PROBE, String(from), String(to)],
      { encoding: "utf8", timeout: 10_000 },
    );
  } catch {
    throw new Error(
      `No port from ${from} to ${to} is free on 127.0.0.1 for the mock media host.`,
    );
  }
  const port = Number(answer);
  if (!Number.isInteger(port) || port < from || port > to) {
    throw new Error(
      `The free port probe answered "${answer}", which is not a port from ${from} to ${to}.`,
    );
  }
  return port;
}
