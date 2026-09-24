import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { helpSections } from "@/lib/help/sections";
import { HelpTopics } from "./help-topics";
import { OpenFromHash, fragmentId } from "./open-from-hash";

/*
  The help page: every explanation cut from a screen, one question per row,
  and a link from a screen landing on its answer already open
  (yuvoy-operator#80 t4).

  The page is a server component. What is under test here is the half that can
  go wrong without anybody seeing it on a fast laptop: the answers must render
  closed on the server and on the client's first pass alike, and only THEN open
  the one the fragment names. A `<details>` open on one side of hydration and
  closed on the other is a hydration mismatch, the class of failure this repo
  has shipped before.
*/

const SECTIONS = helpSections([
  {
    id: "held-cash",
    area: "Money",
    question: "What does held mean?",
    answer: ["Cash you took for a trip that has not run yet."],
  },
  {
    id: "team-roles",
    area: "Team",
    question: "What can each role do?",
    answer: ["An owner can do everything."],
  },
]);

function Page() {
  return (
    <>
      <HelpTopics sections={SECTIONS} />
      <OpenFromHash />
    </>
  );
}

let root: Root | null = null;
let container: HTMLElement | null = null;

async function hydrateAt(hash: string) {
  /*
    The markup is rendered with NO fragment, because that is all a server
    ever sees: the part after `#` is never sent. Only then does the browser
    have one, as it would on arrival.
  */
  window.history.replaceState(null, "", window.location.pathname);
  container = document.createElement("div");
  container.innerHTML = renderToString(<Page />);
  document.body.appendChild(container);
  if (hash) window.history.replaceState(null, "", hash);
  const recoverable = vi.fn();
  await act(async () => {
    root = hydrateRoot(container!, <Page />, {
      onRecoverableError: recoverable,
    });
  });
  return { recoverable, container };
}

const details = (id: string) =>
  container!.querySelector<HTMLDetailsElement>(`#${id}`)!;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  window.history.replaceState(null, "", window.location.pathname);
  vi.restoreAllMocks();
});

describe("the help page", () => {
  it("renders every answer closed on the server, each on its own anchor", () => {
    const html = renderToString(<Page />);
    expect(html).toContain('id="held-cash"');
    expect(html).toContain('id="team-roles"');
    // Nothing is open before the client has read the fragment.
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    // Grouped under the area it belongs to.
    expect(html).toContain(">Money</h2>");
    expect(html).toContain(">Team</h2>");
  });

  it("opens the answer the link named, after hydrating without a mismatch", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { recoverable } = await hydrateAt("#held-cash");

    expect(recoverable).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(details("held-cash").open).toBe(true);
    // Only that one.
    expect(details("team-roles").open).toBe(false);
  });

  it("opens nothing when the link named no answer", async () => {
    await hydrateAt("");
    expect(details("held-cash").open).toBe(false);
    expect(details("team-roles").open).toBe(false);
  });

  it("ignores a fragment that names something other than an answer", async () => {
    // The Money heading has an id too; it is not a question to open.
    await hydrateAt("#help-area-money");
    expect(details("held-cash").open).toBe(false);
  });

  it("opens an answer when the fragment changes on a page already open", async () => {
    await hydrateAt("");
    window.history.replaceState(null, "", "#team-roles");
    act(() => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(details("team-roles").open).toBe(true);
  });
});

describe("reading the fragment", () => {
  it("names the answer without its hash", () => {
    expect(fragmentId("#held-cash")).toBe("held-cash");
    // After a hard load the router appends the first fragment to the next.
    expect(fragmentId("#cash-owed#settling-cash")).toBe("settling-cash");
    expect(fragmentId("held-cash")).toBe("held-cash");
    expect(fragmentId("")).toBe("");
  });

  it("names nothing when the fragment will not decode", () => {
    // A stray percent sign from a mangled link must not throw on the page.
    expect(fragmentId("#%E0%A4%A")).toBe("");
  });
});
