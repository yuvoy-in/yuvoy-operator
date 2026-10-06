import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

let pathname = "/today";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const { default: ErrorScreen } = await import("./error");
const { default: NotFound } = await import("./not-found");
const { ChromeProvider } = await import("@/components/chrome/chrome-context");
const { TabBar } = await import("@/components/chrome/tab-bar");

afterEach(() => {
  pathname = "/today";
});

/*
  The stability audit, P3-6. The error screen wore a signed-out door's
  chassis on every route, and so did the missing page: on a tab root the
  strip swapped to the bare mark and lost the inbox, and the sheet left no
  room for the bar, which stays on a tab root and covered its foot. Each now
  wears the chassis of the screen it stands in for. They are drawn here with
  the bar beside them, as the app shell draws it.
*/
const STAND_INS: [string, () => ReactNode][] = [
  ["the error screen", () => <ErrorScreen reset={() => {}} />],
  ["the missing page", () => <NotFound />],
];

function draw(standIn: () => ReactNode) {
  return render(
    <ChromeProvider identity={{ businessName: "Reef Divers", canManage: true }}>
      {standIn()}
      <TabBar canManage />
    </ChromeProvider>,
  );
}

describe.each(STAND_INS)("%s", (_, standIn) => {
  it.each(["/today", "/bookings", "/calendar", "/earnings", "/account"])(
    "keeps a tab root's strip on %s, and leaves room for the bar",
    (path) => {
      pathname = path;
      const { container } = draw(standIn);
      expect(
        screen.getByRole("navigation", { name: "Primary" }),
      ).toBeInTheDocument();
      expect(container.querySelector(".tabbar-clearance")).not.toBeNull();
      const header = container.querySelector("header")!;
      expect(within(header).getByText("Reef Divers")).toBeInTheDocument();
      expect(
        within(header).getByRole("link", { name: "Messages" }),
      ).toBeInTheDocument();
    },
  );

  it("keeps the back disc's place and the inbox on a screen gone into", () => {
    pathname = "/bookings/bkg_1";
    const { container } = draw(standIn);
    expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
    expect(container.querySelector(".tabbar-clearance")).toBeNull();
    const header = container.querySelector("header")!;
    expect(within(header).queryByAltText("Yuvoy")).toBeNull();
    expect(
      header.querySelector('span[aria-hidden="true"].size-11'),
    ).not.toBeNull();
    // No link to a place it cannot know: the inbox is the one link.
    expect(within(header).getAllByRole("link")).toHaveLength(1);
    expect(
      within(header).getByRole("link", { name: "Messages" }),
    ).toBeInTheDocument();
  });

  it("draws the mark alone on a signed-out door", () => {
    pathname = "/sign-in";
    const { container } = draw(standIn);
    expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
    expect(container.querySelector(".tabbar-clearance")).toBeNull();
    const header = container.querySelector("header")!;
    expect(within(header).getByAltText("Yuvoy")).toBeInTheDocument();
    expect(within(header).queryByRole("link")).toBeNull();
  });
});
