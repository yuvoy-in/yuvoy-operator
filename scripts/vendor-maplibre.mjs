/**
 * MapLibre's web worker, served from this origin (yuvoy-operator#113).
 *
 * ## Why it is copied at all
 *
 * MapLibre 6 draws the map on the main thread and parses tiles in a module
 * worker, and it finds that worker beside itself:
 * `new URL("./maplibre-gl-worker.mjs", import.meta.url)`. Once the bundler has
 * folded `maplibre-gl.mjs` into one of Next's chunks, `import.meta.url` is no
 * longer an http URL next to that file, MapLibre gets an empty worker URL, and
 * the map never draws. The supported way out is `setWorkerUrl()`, which needs
 * a URL that serves the worker. This puts it at
 * `/vendor/maplibre/<version>/worker.js`, beside the one module it imports.
 *
 * ## Why the files are committed rather than copied at build
 *
 * A copy made by a build step depends on that step running wherever the
 * portal is built, and the failure if it does not is silent: the worker 404s
 * in production and the map falls back to "did not load" for everybody. A
 * committed copy cannot be skipped. What a committed copy can do is go stale
 * when `maplibre-gl` is upgraded, so `pnpm qa` runs `vendorProblems()` and
 * fails until this script has been run again.
 *
 * ## What changes in the copy
 *
 * The bytes are MapLibre's, with one edit: the worker's single import of
 * `./maplibre-gl-shared.mjs` points at `./shared.js`. Both are served as `.js`
 * so every host sends a JavaScript type for them, which a module worker
 * requires; not every static host knows `.mjs`.
 *
 * Run `node scripts/vendor-maplibre.mjs` after changing the version of
 * `maplibre-gl`. With `--check` it changes nothing and exits 1 on drift.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const require = createRequire(join(ROOT, "package.json"));

const SHARED_IMPORT = 'from"./maplibre-gl-shared.mjs"';
const SHARED_IMPORT_VENDORED = 'from"./shared.js"';

/** Where the vendored files for every version live. */
const VENDOR_ROOT = join(ROOT, "public", "vendor", "maplibre");

function installed() {
  const manifest = require.resolve("maplibre-gl/package.json");
  const { version } = JSON.parse(readFileSync(manifest, "utf8"));
  return { version, dist: join(dirname(manifest), "dist") };
}

/** The two files as they must be served, keyed by their published name. */
function expectedFiles() {
  const { version, dist } = installed();
  const worker = readFileSync(join(dist, "maplibre-gl-worker.mjs"), "utf8");
  const shared = readFileSync(join(dist, "maplibre-gl-shared.mjs"), "utf8");

  const imports = worker.split(SHARED_IMPORT).length - 1;
  if (imports !== 1) {
    throw new Error(
      `maplibre-gl ${version}: expected the worker to import ` +
        `./maplibre-gl-shared.mjs exactly once and found ${imports}. ` +
        `Read how this version loads its worker before vendoring it.`,
    );
  }
  return {
    version,
    files: {
      "worker.js": worker.replace(SHARED_IMPORT, SHARED_IMPORT_VENDORED),
      "shared.js": shared,
    },
  };
}

/**
 * Everything wrong with the committed copy, as sentences. Empty when it
 * matches the installed package byte for byte.
 */
export function vendorProblems() {
  const { version, files } = expectedFiles();
  const dir = join(VENDOR_ROOT, version);
  const problems = [];
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    if (!existsSync(path)) {
      problems.push(
        `${relative(ROOT, path)} is missing for maplibre-gl ${version}. ` +
          `Run node scripts/vendor-maplibre.mjs.`,
      );
    } else if (readFileSync(path, "utf8") !== content) {
      problems.push(
        `${relative(ROOT, path)} is not the worker maplibre-gl ${version} ` +
          `ships. Run node scripts/vendor-maplibre.mjs.`,
      );
    }
  }
  if (existsSync(VENDOR_ROOT)) {
    for (const other of readdirSync(VENDOR_ROOT)) {
      if (other !== version) {
        problems.push(
          `public/vendor/maplibre/${other} is left over from another ` +
            `version. Run node scripts/vendor-maplibre.mjs.`,
        );
      }
    }
  }
  return problems;
}

function write() {
  const { version, files } = expectedFiles();
  if (existsSync(VENDOR_ROOT)) {
    for (const other of readdirSync(VENDOR_ROOT)) {
      if (other !== version) {
        rmSync(join(VENDOR_ROOT, other), { recursive: true, force: true });
      }
    }
  }
  const dir = join(VENDOR_ROOT, version);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  console.log(`✓ maplibre-gl ${version} worker in ${relative(ROOT, dir)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const problems = vendorProblems();
    for (const p of problems) console.error(`✗ ${p}`);
    process.exit(problems.length ? 1 : 0);
  } else {
    write();
  }
}
