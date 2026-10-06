import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { lockScroll } from "./scroll-lock";

/*
  The page held still behind a sheet, counted (the stability audit, P2-6).
  Saved and put back per sheet, two sheets closing in the opposite order to
  the one they opened in left the page unable to scroll at all.
*/
afterEach(() => {
  document.body.style.overflow = "";
});

describe("holding the page still", () => {
  it("holds it while anything holds it, and gives it back as it was", () => {
    document.body.style.overflow = "clip";
    const first = lockScroll();
    const second = lockScroll();
    expect(document.body.style.overflow).toBe("hidden");

    first();
    expect(document.body.style.overflow).toBe("hidden");
    second();
    expect(document.body.style.overflow).toBe("clip");
  });

  it("gives it back whichever lets go first", () => {
    const first = lockScroll();
    const second = lockScroll();
    second();
    first();
    expect(document.body.style.overflow).toBe("");
  });

  it("counts a release once, however often it is called", () => {
    const first = lockScroll();
    const second = lockScroll();
    first();
    first();
    expect(document.body.style.overflow).toBe("hidden");
    second();
    expect(document.body.style.overflow).toBe("");
  });
});

const SRC = join(process.cwd(), "src");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory()
      ? walk(full)
      : /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)
        ? [full]
        : [];
  });
}

describe("the page under a sheet", () => {
  it("is held still only through the count", () => {
    const writers = walk(SRC).filter(
      (file) =>
        !file.endsWith("scroll-lock.ts") &&
        /body\.style\.overflow\s*=/.test(readFileSync(file, "utf8")),
    );
    expect(writers).toEqual([]);
  });

  it("keeps room for its scrollbar, so holding it still does not slide it sideways", () => {
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    const html = /@layer base \{\s*html \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(html).toMatch(/scrollbar-gutter:\s*stable;/);
  });
});
