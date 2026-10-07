import { describe, it, expect, vi, beforeEach } from "vitest";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { confirmUpload } from "./actions";

/**
 * Asking whether an upload is ready: yuvoy-operator#157.
 *
 * Since yuvoy-api#286 two answers are final. A clip the video host refused
 * answers `422 media_refused`, and an upload with nothing under it answers
 * `404`; "asking again gives the same answer". The refusal fell to "We could
 * not check the upload. Try again shortly", which sent an operator round a
 * retry that could never succeed, and neither answer let the uploader's slot
 * go, so the next clip could not go in.
 */
const post = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok_owner", me: { id: "usr_1" } }),
}));
vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ POST: post }),
}));

const REFUSED =
  "That clip was refused, so it will not be in your reels. Choose another.";

function refused(message = REFUSED) {
  return new OperatorApiError({
    status: 422,
    code: "media_refused",
    message,
    details: { reason: "malformed_video" },
  });
}

beforeEach(() => {
  post.mockReset();
});

describe("a clip the host refused", () => {
  it("is said in the API's sentence, and is final", async () => {
    post.mockRejectedValue(refused());
    expect(await confirmUpload("upi_1")).toEqual({
      message: REFUSED,
      final: true,
    });
  });

  it("is never told to try again", async () => {
    post.mockRejectedValue(refused());
    const state = await confirmUpload("upi_1");
    expect(state.message).not.toMatch(/try again/i);
  });

  it("is a sentence even when the API's is not", async () => {
    // Lower case, no stop and a long dash: `sentence` fixes all three.
    post.mockRejectedValue(
      refused("that clip was refused \u2014 choose another"),
    );
    expect((await confirmUpload("upi_1")).message).toBe(
      "That clip was refused. Choose another.",
    );
  });

  it("says so in our words when the API sends none", async () => {
    post.mockRejectedValue(refused(""));
    expect(await confirmUpload("upi_1")).toEqual({
      message: REFUSED,
      final: true,
    });
  });
});

describe("the other answers", () => {
  it("an upload that is gone is final too", async () => {
    post.mockRejectedValue(
      new OperatorApiError({
        status: 404,
        code: "not_found",
        message: "No such upload.",
      }),
    );
    expect(await confirmUpload("upi_1")).toEqual({
      message: "That upload is no longer here. Start again.",
      final: true,
    });
  });

  it("no signal is not final: the upload is safe", async () => {
    post.mockRejectedValue(new OperatorNetworkError());
    const state = await confirmUpload("upi_1");
    expect(state.final).toBeUndefined();
    expect(state.message).toBe(
      "No signal. The upload is safe. Try again shortly.",
    );
  });

  it("an answer it does not know is not final", async () => {
    post.mockRejectedValue(
      new OperatorApiError({
        status: 500,
        code: "internal",
        message: "Something went wrong.",
      }),
    );
    const state = await confirmUpload("upi_1");
    expect(state.final).toBeUndefined();
    expect(state.message).toBe(
      "We could not check the upload. Try again shortly.",
    );
  });

  it("still processing is not an error", async () => {
    post.mockResolvedValue({ data: { ready: false }, error: undefined });
    expect(await confirmUpload("upi_1")).toEqual({
      ready: false,
      mediaAssetId: undefined,
    });
  });

  it("ready names the clip", async () => {
    post.mockResolvedValue({
      data: { ready: true, mediaAssetId: "med_1" },
      error: undefined,
    });
    expect(await confirmUpload("upi_1")).toEqual({
      ready: true,
      mediaAssetId: "med_1",
    });
  });
});
