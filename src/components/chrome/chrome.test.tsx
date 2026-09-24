import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

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
