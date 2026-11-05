import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/*
  The email proof (yuvoy-operator#388): an address at the listing's website
  gets a code, the code is typed back, a refusal keeps what was typed, and a
  claim decided meanwhile reads the page again.
*/

const sendClaimCode = vi.fn();
const checkClaimCode = vi.fn();
const refresh = vi.fn();
vi.mock("@/app/claim/actions", () => ({
  createClaim: vi.fn(),
  sendClaimCode: (prev: unknown, form: FormData) => sendClaimCode(prev, form),
  checkClaimCode: (prev: unknown, form: FormData) => checkClaimCode(prev, form),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { EmailSteps } = await import("./email-steps");

afterEach(() => {
  sendClaimCode.mockReset();
  checkClaimCode.mockReset();
  refresh.mockReset();
});

const ID = "6f1c2b9e-0000-4000-8000-000000000001";
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("the email proof", () => {
  it("sends the address and never promises a code", async () => {
    sendClaimCode.mockResolvedValue({ done: true });
    render(<EmailSteps claimId={ID} websiteHost="claimtest.yuvoy.in" />);
    const send = screen.getByRole("button", { name: "Send code" });
    expect(send).toBeDisabled();
    type("Your address at claimtest.yuvoy.in", "priya@claimtest.yuvoy.in");
    await act(async () => fireEvent.click(send));
    const form = sendClaimCode.mock.calls[0][1] as FormData;
    expect(form.get("claimId")).toBe(ID);
    expect(form.get("email")).toBe("priya@claimtest.yuvoy.in");
    expect(
      await screen.findByText(
        "If that address is at your website, a code is on its way. It can take a few minutes.",
      ),
    ).toBeVisible();
  });

  it("keeps the address when it is refused", async () => {
    sendClaimCode.mockResolvedValue({
      message: "Use an address at the listing's website.",
      noWebsite: false,
      readAgain: false,
    });
    render(<EmailSteps claimId={ID} websiteHost="claimtest.yuvoy.in" />);
    type("Your address at claimtest.yuvoy.in", "priya@gmail.com");
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Send code" })),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Use an address at the listing's website.",
    );
    expect(
      screen.getByLabelText("Your address at claimtest.yuvoy.in"),
    ).toHaveValue("priya@gmail.com");
  });

  it("takes six digits only, and says when the code is checked", async () => {
    checkClaimCode.mockResolvedValue({ done: true });
    render(<EmailSteps claimId={ID} websiteHost="claimtest.yuvoy.in" />);
    const check = screen.getByRole("button", { name: "Check code" });
    type("Enter the six-digit code", "24 68a1");
    expect(screen.getByLabelText("Enter the six-digit code")).toHaveValue(
      "24681",
    );
    expect(check).toBeDisabled();
    type("Enter the six-digit code", "246810");
    await act(async () => fireEvent.click(check));
    expect((checkClaimCode.mock.calls[0][1] as FormData).get("code")).toBe(
      "246810",
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Email checked. A person at Yuvoy decides next.",
    );
  });

  it("keeps the code on a wrong one", async () => {
    checkClaimCode.mockResolvedValue({
      message: "That code did not work. Ask for a new one.",
      noWebsite: false,
      readAgain: false,
    });
    render(<EmailSteps claimId={ID} websiteHost="claimtest.yuvoy.in" />);
    type("Enter the six-digit code", "135791");
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Check code" })),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That code did not work. Ask for a new one.",
    );
    expect(screen.getByLabelText("Enter the six-digit code")).toHaveValue(
      "135791",
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reads the page again when the claim was decided meanwhile", async () => {
    checkClaimCode.mockResolvedValue({
      message: "This claim is decided already.",
      noWebsite: false,
      readAgain: true,
    });
    render(<EmailSteps claimId={ID} websiteHost="claimtest.yuvoy.in" />);
    type("Enter the six-digit code", "246810");
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Check code" })),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This claim is decided already.",
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("says no signal when the send never left", async () => {
    sendClaimCode.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<EmailSteps claimId={ID} websiteHost={null} />);
    type("Your address at the listing's website", "priya@claimtest.yuvoy.in");
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Send code" })),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No signal. No code was sent: send it again when you have one.",
    );
  });
});
