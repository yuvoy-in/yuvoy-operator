import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

/*
  Verification (yuvoy-operator#88 s13): "The biggest, darkest button on a
  screen about outstanding paperwork is 'Go to today' ... Make the first
  outstanding item the primary action ('Add your logo'). Demote Go to today to
  a back link. Show each blocker in one place only."

  The page reads `GET /me` itself, so the session and the API client are
  replaced with the account under test; everything drawn is the real page.
*/

let account: unknown = null;

vi.mock("@/lib/auth/session", () => ({
  readSessionToken: async () => "tok",
  SIGN_IN_PATH: "/sign-in",
}));
vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({
    GET: async () => ({ data: { account }, error: undefined }),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ refresh: vi.fn() }),
  // The stage's inbox link reads it to know which screen it is on.
  usePathname: () => "/account/verification",
}));
// The document upload is a Server Action; the control only needs to render.
vi.mock("@/app/account/document-actions", () => ({
  startDocumentUpload: vi.fn(),
  completeDocumentUpload: vi.fn(),
}));

const { default: VerificationPage } = await import("./page");

/** Production's own business on the review's day, plus one missing document. */
const LIVE_OUTSTANDING = {
  state: "LIVE",
  bookable: true,
  blocking: [
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
      code: "CREDENTIAL_MISSING",
      label: "We still need your equipment record",
      waitingOn: "operator",
      gates: false,
    },
  ],
  credentials: [],
  requiredDocuments: [{ type: "equipment", satisfied: false }],
};

async function renderFor(standing: unknown) {
  account = standing;
  render(await VerificationPage());
}

describe("Verification", () => {
  it("makes the first thing waiting the one primary action", async () => {
    await renderFor(LIVE_OUTSTANDING);
    const waiting = screen.getByRole("region", { name: "Waiting on you" });
    const actions = within(waiting).getAllByRole("link");
    expect(actions.map((a) => a.textContent)).toEqual([
      "Complete your details",
      "Add your logo",
      "Send us the document",
    ]);
    // The forest fill is the primary; the rest are the raised pill.
    expect(actions[0].className).toContain("bg-forest");
    expect(actions[1].className).not.toContain("bg-forest");
    expect(actions[2].className).not.toContain("bg-forest");
  });

  it("offers Go to today as a plain link, not a button", async () => {
    await renderFor(LIVE_OUTSTANDING);
    const today = screen.getByRole("link", { name: "Go to today" });
    expect(today).toHaveAttribute("href", "/today");
    expect(today.className).not.toContain("bg-forest");
    expect(today.className).toContain("underline");
  });

  it("says each blocker once: a missing document is named, not repeated", async () => {
    await renderFor(LIVE_OUTSTANDING);
    // The blocker's sentence, once, under Waiting on you.
    expect(
      screen.getAllByText("We still need your equipment record"),
    ).toHaveLength(1);
    // The document, and that it is needed, under the documents.
    const documents = screen.getByRole("region", { name: "Your documents" });
    expect(
      within(documents).getByText("Equipment inspection"),
    ).toBeInTheDocument();
    expect(within(documents).getByText("Needed")).toBeInTheDocument();
    expect(
      within(documents).queryByText("We still need your equipment record"),
    ).toBeNull();
  });

  it("has one title, with nothing printed above it", async () => {
    await renderFor(LIVE_OUTSTANDING);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByText(/your account$/i)).toBeNull();
  });

  it("draws no primary when nothing waiting has a way out of its own", async () => {
    await renderFor({
      ...LIVE_OUTSTANDING,
      blocking: [
        {
          code: "OTHER",
          label: "Sign the updated terms with us",
          waitingOn: "operator",
          gates: false,
        },
      ],
      requiredDocuments: [],
    });
    const waiting = screen.getByRole("region", { name: "Waiting on you" });
    expect(within(waiting).queryAllByRole("link")).toHaveLength(0);
  });
});
