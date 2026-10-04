import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { EASE } from "@/lib/motion";
import {
  markAnswerSent,
  takeAnswersSent,
} from "@/components/requests/answered";

let pathname = "/today";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const { NavList } = await import("./nav-items");
const { InboxLink } = await import("./inbox-link");
const { StageIdentity } = await import("./stage-identity");
const { Screen } = await import("./screen");
const { ChromeProvider } = await import("./chrome-context");
const { TabBar } = await import("./tab-bar");

afterEach(() => {
  pathname = "/today";
});

/*
  The chrome every signed-in screen wears: yuvoy-operator#80 t1 and t6, #96.
*/
describe("the bar and the rail", () => {
  it("labels every stop, not only the current one", () => {
    /*
      "The tab bar labels only the tab you are already on." A ticket and a
      briefcase are not words anybody guesses as Bookings and Business.
    */
    render(<NavList orientation="bar" canManage />);
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual([
      "Today",
      "Bookings",
      "Calendar",
      "Money",
      "Business",
    ]);
    // Visible text, not a screen-reader span: the bar used to hide four.
    for (const link of links) {
      expect(within(link).getByText(link.textContent!)).not.toHaveClass(
        "sr-only",
      );
    }
  });

  it("draws no Money stop for a login that cannot manage, and moves nothing", () => {
    render(<NavList orientation="bar" canManage={false} />);
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Today",
      "Bookings",
      "Calendar",
      "Business",
    ]);
  });

  it("draws no Money stop when nobody said the login can manage", () => {
    render(<NavList orientation="rail" />);
    expect(screen.queryByRole("link", { name: "Money" })).toBeNull();
  });

  it("points Money at the earnings screen and lights it for the cash screen", () => {
    pathname = "/cash";
    render(<NavList orientation="bar" canManage />);
    const money = screen.getByRole("link", { name: "Money" });
    expect(money).toHaveAttribute("href", "/earnings");
    expect(money).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Business" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("says each count in the link's name, and draws none at zero or unknown", () => {
    render(
      <NavList
        orientation="bar"
        canManage
        badges={{ bookings: 3, business: 0 }}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Bookings, 3 waiting on your answer" }),
    ).toBeInTheDocument();
    // Zero is not news: the plain name, and no bubble.
    expect(screen.getByRole("link", { name: "Business" }).textContent).toBe(
      "Business",
    );
  });

  it("is a bar only where the bar belongs", () => {
    pathname = "/today/slot_1";
    const { container } = render(<TabBar canManage />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the inbox on the stage", () => {
  it("says the unread conversations in its name", () => {
    render(
      <ChromeProvider
        identity={{ businessName: null, canManage: true, unread: 2 }}
      >
        <InboxLink />
      </ChromeProvider>,
    );
    const inbox = screen.getByRole("link", {
      name: "Messages, 2 unread conversations",
    });
    expect(inbox).toHaveAttribute("href", "/messages");
    expect(inbox).toHaveTextContent("2");
  });

  it("says one conversation in the singular", () => {
    render(
      <ChromeProvider
        identity={{ businessName: null, canManage: true, unread: 1 }}
      >
        <InboxLink />
      </ChromeProvider>,
    );
    expect(
      screen.getByRole("link", { name: "Messages, 1 unread conversation" }),
    ).toBeInTheDocument();
  });

  it.each([
    ["nothing unread", 0],
    ["a count nobody could read", undefined],
  ])("draws no number for %s", (_, unread) => {
    render(
      <ChromeProvider
        identity={{
          businessName: null,
          canManage: true,
          ...(unread !== undefined ? { unread } : {}),
        }}
      >
        <InboxLink />
      </ChromeProvider>,
    );
    const inbox = screen.getByRole("link", { name: "Messages" });
    expect(inbox.textContent).toBe("");
  });

  it("is not drawn on the conversations list it would open", () => {
    pathname = "/messages";
    const { container } = render(
      <ChromeProvider identity={{ businessName: null, canManage: true }}>
        <InboxLink />
      </ChromeProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("whose portal it is", () => {
  it("puts the business's name beside the mark", () => {
    render(
      <ChromeProvider
        identity={{ businessName: "Reef Divers Havelock", canManage: true }}
      >
        <StageIdentity />
      </ChromeProvider>,
    );
    expect(screen.getByAltText("Yuvoy")).toHaveAttribute(
      "src",
      "/brand/yuvoy-mark-compact-on-dark.svg",
    );
    expect(screen.getByText("Reef Divers Havelock")).toBeInTheDocument();
  });

  it("draws the mark alone when the name is unknown, never a stand-in", () => {
    const { container } = render(<StageIdentity />);
    expect(screen.getByAltText("Yuvoy")).toBeInTheDocument();
    expect(container.textContent).toBe("");
  });
});

describe("the stage strip", () => {
  it("carries the inbox on a tab root and on a focused screen", () => {
    render(
      <ChromeProvider identity={{ businessName: "Reef", canManage: true }}>
        <Screen>
          <p>tab root</p>
        </Screen>
        <Screen nav={{ back: { href: "/today", label: "home" } }}>
          <p>focused</p>
        </Screen>
      </ChromeProvider>,
    );
    expect(screen.getAllByRole("link", { name: "Messages" })).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: "Back to home" }),
    ).toBeInTheDocument();
  });

  it("draws a focused screen's loading fallback in the focused header, not a door's", async () => {
    /*
      It wore the door's chassis: the wordmark where the back disc goes and no
      inbox, so every focused screen swapped its header when it arrived.
    */
    const { FocusedSkeleton } =
      await import("@/components/states/route-skeletons");
    const { container } = render(
      <ChromeProvider identity={{ businessName: "Reef", canManage: true }}>
        <FocusedSkeleton />
      </ChromeProvider>,
    );
    expect(screen.queryByAltText("Yuvoy")).toBeNull();
    expect(screen.getByRole("link", { name: "Messages" })).toBeInTheDocument();
    // The back disc's place is held, inert: no link to a place it cannot know.
    const header = container.querySelector("header")!;
    expect(
      header.querySelector('span[aria-hidden="true"].size-11'),
    ).not.toBeNull();
    expect(within(header).getAllByRole("link")).toHaveLength(1);
    // No tab bar clearance: a focused screen has no bar.
    expect(container.querySelector(".tabbar-clearance")).toBeNull();
  });

  it("carries no inbox on a signed-out door", () => {
    render(
      <Screen nav="none">
        <p>door</p>
      </Screen>,
    );
    expect(screen.queryByRole("link", { name: "Messages" })).toBeNull();
    // The mark, and no tagline lockup.
    expect(screen.getByAltText("Yuvoy")).toHaveAttribute(
      "src",
      "/brand/yuvoy-mark-compact-on-dark.svg",
    );
  });

  it("keeps a screen's own controls, before the inbox", () => {
    render(
      <Screen stageActions={<a href="/account/settings">Settings</a>}>
        <p>profile</p>
      </Screen>,
    );
    const links = screen.getAllByRole("link");
    const names = links.map(
      (a) => a.getAttribute("aria-label") ?? a.textContent,
    );
    expect(names.slice(-2)).toEqual(["Settings", "Messages"]);
  });
});

/*
  A count that changes. O01 A (approved 4 Oct 2026): one that changes under
  the operator cross-fades in place, so the change is seen without anything
  moving. O02 A: the Bookings count the operator's own answer lowers rolls
  down instead. Only the twin on screen draws (the bar on a phone, the rail
  on a desktop), and at zero the bubble fades away.
*/
describe("a count that changes", () => {
  type Played = {
    el: Element;
    frames: Keyframe[];
    options: KeyframeAnimationOptions;
  };
  let played: Played[] = [];

  function reduce(on: boolean) {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: on && query === "(prefers-reduced-motion: reduce)",
          addEventListener() {},
          removeEventListener() {},
        }) as unknown as MediaQueryList,
    );
  }

  beforeEach(() => {
    played = [];
    vi.useFakeTimers();
    Object.defineProperties(Element.prototype, {
      animate: {
        configurable: true,
        writable: true,
        value(
          this: Element,
          frames: Keyframe[],
          options: KeyframeAnimationOptions,
        ) {
          played.push({ el: this, frames, options });
          return {
            finished: new Promise(() => {}),
            cancel() {},
          } as unknown as Animation;
        },
      },
      // What is inside `data-off-screen` is not drawn, as a twin a
      // breakpoint hides is not.
      getClientRects: {
        configurable: true,
        writable: true,
        value(this: Element) {
          return this.closest("[data-off-screen]") ? [] : [{}];
        },
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get: () => 10,
    });
    reduce(false);
  });
  afterEach(() => {
    for (const key of ["animate", "getClientRects"]) {
      delete (Element.prototype as unknown as Record<string, unknown>)[key];
    }
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)
      .offsetHeight;
    vi.unstubAllGlobals();
    vi.useRealTimers();
    takeAnswersSent(Number.MAX_SAFE_INTEGER);
  });

  const bar = (bookings: number, business = 0) => (
    <NavList orientation="bar" canManage badges={{ bookings, business }} />
  );
  const figures = (link: HTMLElement) => ({
    now: link.querySelector("span[aria-hidden] > span:not([data-was])"),
    old: link.querySelector("[data-was]"),
  });
  const moves = (el: Element | null) =>
    played.filter((p) => p.el === el && p.frames.some((f) => "transform" in f));

  it("cross-fades in place, and draws the first number still", () => {
    const { rerender } = render(bar(2));
    const link = screen.getByRole("link", {
      name: "Bookings, 2 waiting on your answer",
    });
    expect(played).toHaveLength(0);

    rerender(bar(3));
    expect(link).toHaveAccessibleName("Bookings, 3 waiting on your answer");
    const { now, old } = figures(link);
    expect(now).toHaveTextContent("3");
    // Drawn from an attribute: the link's text is still the one number.
    expect(old).toHaveAttribute("data-was", "2");
    expect(link.textContent).toBe("3Bookings");
    const arrive = played.find((p) => p.el === now)!;
    expect(arrive.frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(arrive.options).toMatchObject({
      duration: 150,
      easing: EASE.interaction,
    });
    const leave = played.find((p) => p.el === old)!;
    expect(leave.frames).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(leave.options).toMatchObject({ duration: 150, easing: EASE.exit });

    act(() => vi.advanceTimersByTime(250));
    expect(link.querySelector("[data-was]")).toBeNull();
  });

  it("rolls the Bookings count down when the operator's answer lowers it", () => {
    const { rerender } = render(bar(3));
    markAnswerSent();
    rerender(bar(2));
    const { now, old } = figures(
      screen.getByRole("link", { name: /^Bookings/ }),
    );
    // Down from above as the old number leaves below.
    const [arrive] = moves(now);
    expect(arrive.frames[0]).toEqual({
      opacity: 0,
      transform: "translateY(-6px)",
    });
    expect(arrive.options).toMatchObject({
      duration: 200,
      easing: EASE.interaction,
    });
    const [leave] = moves(old);
    expect(leave.frames.at(-1)).toEqual({
      opacity: 0,
      transform: "translateY(6px)",
    });
    expect(leave.options).toMatchObject({ easing: EASE.exit });
  });

  it("cross-fades a fall nobody here answered, and a mark rolls one fall only", () => {
    const { rerender } = render(bar(4));
    rerender(bar(3));
    expect(played.some((p) => p.frames.some((f) => "transform" in f))).toBe(
      false,
    );

    markAnswerSent();
    rerender(bar(2));
    const link = screen.getByRole("link", { name: /^Bookings/ });
    expect(moves(figures(link).now)).toHaveLength(1);
    // The next fall is somebody else's.
    act(() => vi.advanceTimersByTime(250));
    rerender(bar(1));
    expect(moves(figures(link).now)).toHaveLength(0);
  });

  it("lets only the twin on screen take the mark", () => {
    const both = (bookings: number) => (
      <>
        <div data-off-screen>
          <NavList orientation="rail" canManage badges={{ bookings }} />
        </div>
        <NavList orientation="bar" canManage badges={{ bookings }} />
      </>
    );
    const { rerender } = render(both(3));
    markAnswerSent();
    rerender(both(2));
    const [rail, onScreen] = screen.getAllByRole("link", {
      name: /^Bookings/,
    });
    expect(played.filter((p) => rail.contains(p.el))).toHaveLength(0);
    expect(moves(figures(onScreen).now)).toHaveLength(1);
  });

  it("never rolls a count the operator's answers do not lower", () => {
    const { rerender } = render(bar(0, 3));
    markAnswerSent();
    rerender(bar(0, 2));
    expect(played.some((p) => p.frames.some((f) => "transform" in f))).toBe(
      false,
    );
    // And the mark is still there for the Bookings count.
    expect(takeAnswersSent(1)).toBe(true);
  });

  it("fades the bubble away at zero, then draws nothing", () => {
    const { rerender } = render(bar(1));
    const link = screen.getByRole("link", { name: /^Bookings/ });
    const bubble = link.querySelector("span[aria-hidden]")!;
    markAnswerSent();
    rerender(bar(0));
    expect(link).toHaveAccessibleName("Bookings");
    const fade = played.find((p) => p.el === bubble)!;
    expect(fade.frames.at(-1)).toEqual({ opacity: 0 });
    expect(fade.options).toMatchObject({
      duration: 150,
      easing: EASE.exit,
      fill: "forwards",
    });
    // The answer that emptied the queue took its mark.
    expect(takeAnswersSent(1)).toBe(false);
    act(() => vi.advanceTimersByTime(250));
    expect(link.querySelector("span[aria-hidden]")).toBeNull();
  });

  it("cross-fades every change in 120ms under reduced motion, answered or not", () => {
    reduce(true);
    const { rerender } = render(bar(3));
    markAnswerSent();
    rerender(bar(2));
    expect(played.length).toBeGreaterThan(0);
    expect(played.every((p) => p.options.duration === 120)).toBe(true);
    expect(played.some((p) => p.frames.some((f) => "transform" in f))).toBe(
      false,
    );
  });
});
