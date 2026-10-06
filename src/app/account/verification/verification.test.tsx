import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { redirect } from "next/navigation";
import { OperatorApiError } from "@/lib/api/errors";

/*
  Verification (yuvoy-operator#88 s13): "The biggest, darkest button on a
  screen about outstanding paperwork is 'Go to today' ... Make the first
  outstanding item the primary action ('Add your logo'). Demote Go to today to
  a back link. Show each blocker in one place only."

  The page reads `GET /me` through the session's own reader, so the cookie
  and the API client are replaced with the account under test; the reader and
  everything drawn are the real ones.
*/

let account: unknown = null;
let canManage = true;
/** What `GET /me` throws instead of answering, as the error middleware does. */
let failure: Error | null = null;

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  readSessionToken: async () => "tok",
}));
vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({
    GET: async () => {
      if (failure) throw failure;
      return { data: { account, canManage }, error: undefined };
    },
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

async function renderFor(standing: unknown, manage = true) {
  account = standing;
  canManage = manage;
  failure = null;
  render(await VerificationPage());
}

describe("Verification", () => {
  it("gives a staff login only the document it may send, and says who does the rest", async () => {
    /*
      The audit before release (M10): "Complete your details" was the primary
      button for a staff phone, on a screen that then said only an owner,
      admin or manager can. A document is anybody's to send.
    */
    await renderFor(LIVE_OUTSTANDING, false);
    const waiting = screen.getByRole("region", { name: "Waiting on you" });
    const actions = within(waiting).getAllByRole("link");
    expect(actions.map((a) => a.textContent)).toEqual(["Send us the document"]);
    expect(actions[0].className).toContain("bg-forest");
    expect(
      within(waiting).getAllByText("An owner, admin or manager can do this."),
    ).toHaveLength(2);
  });

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

  describe("when GET /me fails", () => {
    it("sends an expired session to sign in, not to a reload that cannot work", async () => {
      vi.mocked(redirect).mockClear();
      failure = new OperatorApiError({
        code: "unauthorized",
        message: "Sign in again.",
        status: 401,
      });
      await VerificationPage();
      expect(redirect).toHaveBeenCalledWith("/sign-in");
    });

    it("says it cannot tell when the API had a bad minute, and offers the reload", async () => {
      vi.mocked(redirect).mockClear();
      failure = new OperatorApiError({
        code: "internal_error",
        message: "Try again.",
        status: 503,
      });
      render(await VerificationPage());
      expect(redirect).not.toHaveBeenCalled();
      expect(
        screen.getByText("We cannot tell you where you stand"),
      ).toBeInTheDocument();
      expect(screen.getByText(/Reload the page/)).toBeInTheDocument();
    });
  });
});
