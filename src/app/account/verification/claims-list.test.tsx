import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { OperatorApiError } from "@/lib/api/errors";
import type { ClaimLike } from "@/lib/claims/claims";

/*
  The claims list on Verification (yuvoy-operator#388): hidden with no
  claims, a failed read said with Try again, newest first, the code shown
  again, and the email steps for an owner only.
*/

let answer: () => Promise<unknown> = async () => ({ data: { items: [] } });
vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ GET: () => answer() }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/claim/actions", () => ({
  createClaim: vi.fn(),
  sendClaimCode: vi.fn(async () => ({})),
  checkClaimCode: vi.fn(async () => ({})),
}));

const { ClaimsList, readClaims } = await import("./claims-list");

const claim = (id: string, over: Partial<ClaimLike> = {}): ClaimLike => ({
  claimId: id,
  subjectName: "Example Reef Divers",
  state: "waiting",
  decisionCode: null,
  proofMethod: "documents",
  proofCode: null,
  proofEmailVerifiedAt: null,
  websiteHost: "claimtest.yuvoy.in",
  createdAt: "2026-10-21T09:00:00Z",
  ...over,
});

describe("reading the claims", () => {
  it("gives the items, or a read that failed", async () => {
    answer = async () => ({ data: { items: [claim("a")] } });
    expect(await readClaims("tok")).toEqual({ ok: true, items: [claim("a")] });
    answer = async () => {
      throw new OperatorApiError({
        code: "internal_error",
        message: "We could not read that just now. Try again.",
        status: 503,
      });
    };
    expect(await readClaims("tok")).toEqual({ ok: false });
  });
});

describe("the claims list", () => {
  it("is not drawn with no claims", () => {
    const { container } = render(
      <ClaimsList read={{ ok: true, items: [] }} canAct />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says a failed read, with Try again", () => {
    render(<ClaimsList read={{ ok: false }} canAct />);
    const section = screen.getByTestId("claims-error");
    expect(within(section).getByText("Listing claims")).toBeVisible();
    expect(
      within(section).getByText(
        "We could not read your listing claims just now.",
      ),
    ).toBeVisible();
    expect(
      within(section).getByRole("button", { name: "Try again" }),
    ).toBeVisible();
  });

  it("lists each claim with where it stands, the code again and the email steps", () => {
    render(
      <ClaimsList
        read={{
          ok: true,
          items: [
            claim("old", {
              state: "refused",
              decisionCode: "NOT_THE_BUSINESS",
              createdAt: "2026-10-01T09:00:00Z",
            }),
            claim("code", {
              proofMethod: "public_page_code",
              proofCode: "YUVOY-7KQ4MX",
              createdAt: "2026-10-21T09:30:00Z",
            }),
            claim("email", {
              proofMethod: "email_domain",
              createdAt: "2026-10-21T09:20:00Z",
            }),
            claim("checked", {
              proofMethod: "email_domain",
              proofEmailVerifiedAt: "2026-10-21T09:15:00Z",
              createdAt: "2026-10-21T09:10:00Z",
            }),
          ],
        }}
        canAct
      />,
    );
    const rows = screen
      .getAllByTestId(/^claim-row-(old|code|email|checked)$/)
      .map((r) => r.dataset.testid);
    expect(rows).toEqual([
      "claim-row-code",
      "claim-row-email",
      "claim-row-checked",
      "claim-row-old",
    ]);
    expect(screen.getByTestId("claim-row-state-old")).toHaveTextContent(
      "Not approved: this listing looks like a different business.",
    );
    expect(screen.getByTestId("claim-row-code-code")).toHaveTextContent(
      "YUVOY-7KQ4MX",
    );
    expect(screen.getByTestId("claim-row-checked-checked")).toHaveTextContent(
      "Email checked. A person at Yuvoy decides next.",
    );
    fireEvent.click(screen.getByTestId("claim-row-email-open-email"));
    expect(
      within(screen.getByTestId("claim-row-email-email")).getByLabelText(
        "Your address at claimtest.yuvoy.in",
      ),
    ).toBeVisible();
  });

  it("offers a manager no email steps", () => {
    render(
      <ClaimsList
        read={{
          ok: true,
          items: [claim("email", { proofMethod: "email_domain" })],
        }}
        canAct={false}
      />,
    );
    expect(screen.queryByTestId("claim-row-email-open-email")).toBeNull();
  });
});
