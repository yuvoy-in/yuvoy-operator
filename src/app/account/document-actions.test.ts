import { describe, it, expect, vi, beforeEach } from "vitest";
import { OperatorApiError } from "@/lib/api/errors";
import { DOCUMENTS_SWITCHED_OFF } from "@/lib/account/documents";
import {
  completeDocumentUpload,
  startDocumentUpload,
} from "./document-actions";

/**
 * `documents_unavailable`, the two ways it arrives: yuvoy-operator#93.
 *
 * `503` is "no document store is configured on this service", which is what
 * production answers today, and it comes back flagged as a state so the
 * screen draws no retry. `502` is "the document store could not sign an upload
 * just now", which a retry can fix, and it stays a failure.
 */
const post = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok_owner", me: { id: "usr_1" } }),
}));
vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ POST: post }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function unavailable(status: 502 | 503) {
  return new OperatorApiError({
    status,
    code: "documents_unavailable",
    message:
      status === 503
        ? "we cannot take documents just yet"
        : "the document store could not take an upload just now. Try again",
  });
}

beforeEach(() => {
  post.mockReset();
});

describe("starting an upload", () => {
  it("reports a service with no store as a state, not a failure", async () => {
    post.mockRejectedValue(unavailable(503));
    expect(
      await startDocumentUpload("cred_1", "a.pdf", "application/pdf", 2048),
    ).toEqual({
      ok: false,
      unavailable: true,
      message: DOCUMENTS_SWITCHED_OFF,
    });
  });

  it("keeps a store that could not answer just now as a retry", async () => {
    post.mockRejectedValue(unavailable(502));
    const result = await startDocumentUpload(
      "cred_1",
      "a.pdf",
      "application/pdf",
      2048,
    );
    expect(result).toEqual({
      ok: false,
      message: "Could not send the file just now. Try again.",
    });
  });
});

describe("recording the file", () => {
  it("reports a service with no store the same way", async () => {
    post.mockRejectedValue(unavailable(503));
    expect(await completeDocumentUpload("cred_1", "int_1")).toEqual({
      ok: false,
      unavailable: true,
      message: DOCUMENTS_SWITCHED_OFF,
    });
  });
});
