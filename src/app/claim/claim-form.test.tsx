import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ListingClaim } from "@/lib/claims/claims";

/*
  The claim itself (yuvoy-operator#388): the proofs for an owner, who can for
  the others, the email proof greyed with no website, one claim however fast
  "Ask to claim" is tapped, and what comes next by the proof chosen.
*/

const createClaim = vi.fn();
vi.mock("./actions", () => ({
  createClaim: (prev: unknown, form: FormData) => createClaim(prev, form),
  sendClaimCode: vi.fn(async () => ({})),
  checkClaimCode: vi.fn(async () => ({})),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { ClaimForm } = await import("./claim-form");

afterEach(() => createClaim.mockReset());

const LISTING = {
  name: "Example Reef Divers",
  websiteHost: "claimtest.yuvoy.in",
  claimable: true,
};

const made = (over: Partial<ListingClaim>): ListingClaim => ({
  claimId: "6f1c2b9e-0000-4000-8000-000000000001",
  subjectKind: "supplier",
  subjectId: "0b6c7a1e-0000-4000-8000-000000000001",
  subjectName: "Example Reef Divers",
  publicContact: null,
  claimantName: "Reef Divers Havelock",
  roleText: null,
  contactEmail: null,
  proofUrl: null,
  note: null,
  state: "waiting",
  decisionCode: null,
  proofMethod: "documents",
  proofCode: null,
  proofEmailVerifiedAt: null,
  websiteHost: "claimtest.yuvoy.in",
  createdAt: "2026-10-21T09:00:00Z",
  ...over,
});

const ask = () => screen.getByRole("button", { name: "Ask to claim" });
const choose = (name: RegExp) =>
  fireEvent.click(screen.getByRole("radio", { name }));

describe("the claim", () => {
  it("names the listing and offers the four proofs", () => {
    render(
      <ClaimForm
        slug="example-reef-divers"
        listing={LISTING}
        roleLine={null}
      />,
    );
    expect(screen.getByTestId("claim-listing-name")).toHaveTextContent(
      "Example Reef Divers",
    );
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(ask()).toBeDisabled();
    choose(/We call your business/);
    expect(ask()).toBeEnabled();
  });

  it("tells a manager who can claim, with no proofs", () => {
    render(
      <ClaimForm
        slug="example-reef-divers"
        listing={LISTING}
        roleLine="Only an owner or admin of Reef Divers Havelock can claim a listing. Send them this link."
      />,
    );
    expect(screen.getByTestId("claim-role-line")).toHaveTextContent(
      "Only an owner or admin of Reef Divers Havelock",
    );
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("says a claim is not open when the listing is taken", () => {
    render(
      <ClaimForm
        slug="example-busy-cove"
        listing={{ ...LISTING, claimable: false }}
        roleLine={null}
      />,
    );
    expect(screen.getByTestId("claim-not-open")).toHaveTextContent(
      "A claim on this listing is already with our team, or a business holds it already.",
    );
    expect(screen.queryByRole("button", { name: "Ask to claim" })).toBeNull();
  });

  it("greys the email proof when the listing has no website", () => {
    render(
      <ClaimForm
        slug="example-shore-cafe"
        listing={{ ...LISTING, websiteHost: null }}
        roleLine={null}
      />,
    );
    expect(
      screen.getByRole("radio", { name: /Get a code at your business email/ }),
    ).toBeDisabled();
    expect(screen.getByTestId("claim-no-website")).toHaveTextContent(
      "This listing has no website, so prove it another way.",
    );
  });

  it("greys it after a no_website refusal too, and keeps the form", async () => {
    createClaim.mockResolvedValue({
      message: "This listing has no website, so prove it another way.",
      noWebsite: true,
      readAgain: false,
    });
    render(
      <ClaimForm
        slug="example-reef-divers"
        listing={LISTING}
        roleLine={null}
      />,
    );
    choose(/Get a code at your business email/);
    await act(async () => fireEvent.click(ask()));
    expect(await screen.findByTestId("claim-error")).toHaveTextContent(
      "This listing has no website, so prove it another way.",
    );
    expect(
      screen.getByRole("radio", { name: /Get a code at your business email/ }),
    ).toBeDisabled();
    expect(ask()).toBeDisabled();
  });

  it("sends one claim however fast it is tapped", async () => {
    let answer: (s: unknown) => void = () => {};
    createClaim.mockImplementation(
      () => new Promise((resolve) => (answer = resolve)),
    );
    render(
      <ClaimForm
        slug="example-reef-divers"
        listing={LISTING}
        roleLine={null}
      />,
    );
    choose(/Send us your papers/);
    const form = ask().closest("form")!;
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(createClaim).toHaveBeenCalledTimes(1);
    const sent = createClaim.mock.calls[0][1] as FormData;
    expect(sent.get("slug")).toBe("example-reef-divers");
    expect(sent.get("proofMethod")).toBe("documents");
    await act(async () => answer({ claim: made({}) }));
  });

  it("shows the code to post after a public page claim", async () => {
    createClaim.mockResolvedValue({
      claim: made({
        proofMethod: "public_page_code",
        proofCode: "YUVOY-7KQ4MX",
      }),
    });
    render(
      <ClaimForm
        slug="example-reef-divers"
        listing={LISTING}
        roleLine={null}
      />,
    );
    choose(/Post a code on your own page/);
    await act(async () => fireEvent.click(ask()));
    expect(await screen.findByTestId("claim-proof-code")).toHaveTextContent(
      "YUVOY-7KQ4MX",
    );
    expect(screen.getByText("Post this code on your page")).toBeVisible();
    expect(screen.getByTestId("claim-decide")).toHaveTextContent(
      "We email the owner when we decide.",
    );
    expect(
      screen.getByRole("link", { name: "See your claims under Verification" }),
    ).toHaveAttribute("href", "/account/verification");
  });

  it("goes on to the email steps after an email claim", async () => {
    createClaim.mockResolvedValue({
      claim: made({ proofMethod: "email_domain" }),
    });
    render(
      <ClaimForm
        slug="example-reef-divers"
        listing={LISTING}
        roleLine={null}
      />,
    );
    choose(/Get a code at your business email/);
    await act(async () => fireEvent.click(ask()));
    expect(
      await screen.findByLabelText("Your address at claimtest.yuvoy.in"),
    ).toBeVisible();
    expect(screen.getByLabelText("Enter the six-digit code")).toBeVisible();
  });

  it("says what we do next after a call or papers claim", async () => {
    createClaim.mockResolvedValue({
      claim: made({ proofMethod: "call_to_published_number" }),
    });
    render(
      <ClaimForm
        slug="example-reef-divers"
        listing={LISTING}
        roleLine={null}
      />,
    );
    choose(/We call your business/);
    await act(async () => fireEvent.click(ask()));
    expect(await screen.findByTestId("claim-next")).toHaveTextContent(
      "We will call the number on your public page. Nothing more to do here.",
    );
  });
});
