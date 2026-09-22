import { describe, it, expect, vi, beforeEach } from "vitest";
import { OperatorApiError } from "@/lib/api/errors";
import {
  attachMedia,
  attestRights,
  setMediaRole,
  withdrawMedia,
} from "./actions";

/**
 * A suspended business, refused on the clip writes: yuvoy-operator#90 f13.
 *
 * Rights, withdraw and publish each declare one 403, `account_suspended`, and
 * none of them said so: they read "Nothing was recorded. Try again", "It was
 * not taken down. Try again" and "The clip was not attached. Try again",
 * sending the operator to retry something that can never succeed and hiding
 * the one fact that would let them act. Each now leads with the API's own
 * sentence.
 */
const post = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok_owner", me: { id: "usr_1" } }),
}));
vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ POST: post }),
}));

const SUSPENDED =
  "Your account has been suspended. Please reach out to admin for help.";
const CLOSED =
  "Your account has been closed. Please reach out to admin for help.";

function suspended(message = SUSPENDED) {
  return new OperatorApiError({
    status: 403,
    code: "account_suspended",
    message,
  });
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const RIGHTS = {
  mediaAssetId: "med_1",
  statementVersion: "1",
  statementSha256: "a".repeat(64),
  rightsType: "owned",
  peopleConsentConfirmed: "yes",
};
const PUBLISH = {
  mediaAssetId: "med_1",
  experienceId: "exp_1",
  role: "gallery",
};

beforeEach(() => {
  post.mockReset();
});

describe("a suspended business is told so, on every clip write", () => {
  it("on rights", async () => {
    post.mockRejectedValue(suspended());
    const state = await attestRights({}, form(RIGHTS));
    expect(state.message).toBe(SUSPENDED);
  });

  it("on taking a clip down", async () => {
    post.mockRejectedValue(suspended());
    const state = await withdrawMedia(
      {},
      form({ mediaAssetId: "med_1", reason: "operator_request" }),
    );
    expect(state.message).toBe(SUSPENDED);
  });

  it("on attaching to a listing", async () => {
    post.mockRejectedValue(suspended());
    const state = await attachMedia({}, form(PUBLISH));
    expect(state.message).toBe(SUSPENDED);
  });

  it("on moving between cover and gallery", async () => {
    post.mockRejectedValue(suspended());
    const state = await setMediaRole({}, form({ ...PUBLISH, role: "hero" }));
    expect(state.message).toBe(SUSPENDED);
  });

  it("in whichever of the three sentences the API sent", async () => {
    // Suspended, closed and disqualified are three statuses and three
    // sentences, and the portal writes none of them.
    post.mockRejectedValue(suspended(CLOSED));
    const state = await attachMedia({}, form(PUBLISH));
    expect(state.message).toBe(CLOSED);
  });

  it("and never with a 'try again' under it", async () => {
    post.mockRejectedValue(suspended());
    const results = [
      await attestRights({}, form(RIGHTS)),
      await withdrawMedia(
        {},
        form({ mediaAssetId: "med_1", reason: "operator_request" }),
      ),
      await attachMedia({}, form(PUBLISH)),
      await setMediaRole({}, form({ ...PUBLISH, role: "hero" })),
    ];
    for (const state of results) {
      expect(state.message).not.toMatch(/try again/i);
    }
  });
});
