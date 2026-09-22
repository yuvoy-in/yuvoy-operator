import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DOCUMENTS_SWITCHED_OFF } from "@/lib/account/documents";
import type { CompleteResult, IntentResult } from "./document-actions";
import { SendDocument } from "./send-document";

/**
 * Sending the file behind a document, when the service cannot take one:
 * yuvoy-operator#93.
 *
 * Production has no documents bucket (an owner item), so every upload intent
 * answers `503 documents_unavailable`. That used to render as a failure, in
 * the alert style, with "Pick another file" under it: a retry that could not
 * work for as long as the bucket is missing. It is a plain state now, with
 * nothing to press. A real failure keeps its retry, and is the control here.
 */
const startDocumentUpload =
  vi.fn<(...args: unknown[]) => Promise<IntentResult>>();
const completeDocumentUpload =
  vi.fn<(...args: unknown[]) => Promise<CompleteResult>>();
vi.mock("./document-actions", () => ({
  startDocumentUpload: (...args: unknown[]) => startDocumentUpload(...args),
  completeDocumentUpload: (...args: unknown[]) =>
    completeDocumentUpload(...args),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const pdf = () =>
  new File([new Uint8Array(2048)], "registration.pdf", {
    type: "application/pdf",
  });

async function pick() {
  const user = userEvent.setup();
  render(<SendDocument credentialId="cred_1" label="Oxygen certificate" />);
  await user.upload(screen.getByLabelText(/^Send the file/), pdf());
}

beforeEach(() => {
  startDocumentUpload.mockReset();
  completeDocumentUpload.mockReset();
  refresh.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a service with nowhere to put the file", () => {
  it("says so as a state, with nothing to retry", async () => {
    startDocumentUpload.mockResolvedValue({
      ok: false,
      unavailable: true,
      message: DOCUMENTS_SWITCHED_OFF,
    });
    await pick();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Sending files is switched off for now. Nothing to do on your side.",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Pick another file" }),
    ).toBeNull();
    // And the picker is gone, because picking again cannot help.
    expect(screen.queryByLabelText(/^Send the file/)).toBeNull();
  });

  it("says the same when it is the check that finds no store", async () => {
    startDocumentUpload.mockResolvedValue({
      ok: true,
      intentId: "int_1",
      uploadUrl: "https://bucket.example/put",
      method: "PUT",
      headers: {},
      maxBytes: 10 * 1024 * 1024,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    completeDocumentUpload.mockResolvedValue({
      ok: false,
      unavailable: true,
      message: DOCUMENTS_SWITCHED_OFF,
    });
    await pick();

    expect(await screen.findByRole("status")).toHaveTextContent(
      DOCUMENTS_SWITCHED_OFF,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a failure that a retry can fix", () => {
  it("keeps its alert and its way to try again", async () => {
    startDocumentUpload.mockResolvedValue({
      ok: false,
      message: "Could not send the file just now. Try again.",
    });
    await pick();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not send the file just now. Try again.",
    );
    expect(
      screen.getByRole("button", { name: "Pick another file" }),
    ).toBeInTheDocument();
  });
});
