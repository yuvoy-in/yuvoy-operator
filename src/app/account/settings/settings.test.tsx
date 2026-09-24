import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

/*
  Settings, regrouped (yuvoy-operator#88 s12): "Three groups exist to hold one
  row each, and the group heading repeats the row ... Group only where there
  are two or more rows." And Money left it for a tab of its own (#96).

  The page is a server component with one read, who is signed in, so that is
  the one thing replaced; the rows and headings are the real ones.
*/

const me = { canManage: true };

vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok", me }),
}));
// Signing out is a Server Action; the button only needs to render here.
vi.mock("@/app/sign-in/actions", () => ({ signOut: vi.fn() }));

const { default: SettingsPage } = await import("./page");

async function renderSettings(canManage: boolean) {
  me.canManage = canManage;
  render(await SettingsPage());
}

describe("Settings", () => {
  it("keeps a heading only over a group of two or more rows", async () => {
    await renderSettings(true);

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual(["Business", "Support"]);

    const business = screen.getByRole("region", { name: "Business" });
    expect(
      within(business)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual(["Business details", "Logo", "Your story"]);

    // The one-row groups are plain rows now, not headings repeating them.
    for (const row of ["Verification", "Notifications", "Team access"]) {
      expect(screen.getByRole("link", { name: row })).toBeInTheDocument();
    }
  });

  it("has no way into Money: it is a tab of its own", async () => {
    await renderSettings(true);
    for (const row of [/Earnings/, /Cash you.ve collected/, /Payout details/]) {
      expect(screen.queryByRole("link", { name: row })).toBeNull();
    }
  });

  it("opens Help from Support, beside the call, with signing out apart", async () => {
    await renderSettings(true);
    // "Support", not "Help": a heading that repeats its row is what #88 s12 cut.
    expect(screen.queryByRole("region", { name: "Help" })).toBeNull();
    const support = screen.getByRole("region", { name: "Support" });
    expect(within(support).getByRole("link", { name: "Help" })).toHaveAttribute(
      "href",
      "/account/help",
    );
    expect(
      within(support).getByRole("link", { name: /Call Yuvoy/ }),
    ).toHaveAttribute("href", "tel:+918121657657");
    // Leaving is not support.
    expect(
      within(support).queryByRole("button", { name: "Sign out" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
  });

  it("offers a staff login no team row, and no heading over nothing", async () => {
    await renderSettings(false);
    expect(screen.queryByRole("link", { name: "Team access" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Team" })).toBeNull();
    // Everything every role may open is still there.
    expect(
      screen.getByRole("link", { name: "Verification" }),
    ).toBeInTheDocument();
  });
});
