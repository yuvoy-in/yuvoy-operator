import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/*
  Business details links to what is waiting instead of repeating it
  (yuvoy-operator#88 s13): "Both items then repeat word for word on Business
  details, so the operator meets the same two sentences twice ... Show each
  blocker in one place only, and link to it from the other."

  The page's reads are replaced (who is signed in, `/profile`, `/me`, the
  change requests); the page itself, and both forms on it, are real.
*/

const BLOCKING = [
  {
    code: "BUSINESS_DETAILS_INCOMPLETE",
    label: "We still need your registered business name and address",
    waitingOn: "operator",
    gates: false,
  },
  {
    code: "LOGO_MISSING",
    label: "We still need your logo: it appears on every reel and listing",
    waitingOn: "operator",
    gates: false,
  },
  {
    code: "AWAITING_REVIEW",
    label: "Everything is with us: we are reviewing your account",
    waitingOn: "yuvoy",
    gates: true,
  },
];

vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok", me: { canManage: true } }),
}));
vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({
    GET: async (path: string) =>
      path === "/me"
        ? {
            data: {
              account: {
                state: "LIVE",
                bookable: true,
                blocking: BLOCKING,
                credentials: [],
              },
            },
            error: undefined,
          }
        : { data: { legalName: "", missing: ["legalName"] }, error: undefined },
  }),
}));
vi.mock("@/lib/money/fetch", () => ({ getChangeRequests: async () => [] }));
vi.mock("./actions", () => ({
  saveDetails: vi.fn(),
  fileCredential: vi.fn(),
}));

const { default: ProfilePage } = await import("./page");

describe("Business details", () => {
  it("counts what is waiting on the operator and links to it, once", async () => {
    render(await ProfilePage());

    // Two are the operator's; the one with Yuvoy is not counted.
    expect(
      screen.getByRole("link", { name: /2 things waiting on you/ }),
    ).toHaveAttribute("href", "/account/verification");
    // And not one of the sentences is repeated here.
    for (const blocker of BLOCKING) {
      expect(screen.queryByText(blocker.label)).toBeNull();
    }
  });

  it("has one title: the form under it does not say it again", async () => {
    render(await ProfilePage());
    expect(
      screen.getAllByRole("heading", { name: "Business details" }),
    ).toHaveLength(1);
  });

  it("points at the documents where they now live", async () => {
    render(await ProfilePage());
    expect(
      screen.getByRole("link", {
        name: "Documents we hold, and when they run out",
      }),
    ).toHaveAttribute("href", "/account/verification");
  });
});
