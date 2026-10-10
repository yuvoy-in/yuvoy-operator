import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorApiError } from "@/lib/api/errors";

/*
  A message sent with its Idempotency-Key (yuvoy-api#282 item 4), and the
  key's own answers said in words an operator can act on.
*/

const post = vi.fn();

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ POST: post }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok", me: { canManage: true } }),
}));

const { sendMessage } = await import("./conversation-actions");

const KEY = "msg_0d2c5c1e-8a7b-4b8e-9c1d-2f3e4a5b6c7d";
const SENT = {
  id: "m9",
  from: "operator",
  senderName: "Priya Raut",
  text: "See you at nine",
  sentAt: "2026-10-10T03:00:00Z",
};

function refuse(code: string, status: number, message = code) {
  post.mockResolvedValue({
    data: undefined,
    error: new OperatorApiError({ code, message, status }),
  });
}

beforeEach(() => post.mockReset());

describe("sending a message with its key", () => {
  it("sends the key with the words", async () => {
    post.mockResolvedValue({ data: SENT, error: undefined });
    expect(await sendMessage("bkg_1", " See you at nine ", KEY)).toEqual({
      ok: true,
      message: SENT,
    });
    expect(post.mock.calls[0][1]).toEqual({
      params: { path: { id: "bkg_1" }, header: { "Idempotency-Key": KEY } },
      body: { text: "See you at nine" },
    });
  });

  it("sends a key it cannot vouch for as no key at all", async () => {
    post.mockResolvedValue({ data: SENT, error: undefined });
    await sendMessage("bkg_1", "See you at nine", "short");
    await sendMessage("bkg_1", "See you at nine");
    for (const call of post.mock.calls) {
      expect(call[1].params).toEqual({ path: { id: "bkg_1" } });
    }
  });

  it("asks for a moment while the first send is still being written", async () => {
    refuse("idempotency_in_progress", 409);
    expect(await sendMessage("bkg_1", "Hi", KEY)).toEqual({
      ok: false,
      message:
        "That message is still on its way. Give it a moment, then send it again. It will only arrive once.",
    });
  });

  it("says a message that went, and shows the conversation, when only its answer was lost", async () => {
    refuse("idempotency_response_lost", 409);
    expect(await sendMessage("bkg_1", "Hi", KEY)).toEqual({
      ok: false,
      message: "That message was sent. It is in the conversation below.",
      reload: true,
      sent: true,
    });
  });

  it("lets a key go that cannot be used again, never naming a header", async () => {
    refuse(
      "idempotency_key_reuse",
      409,
      "that Idempotency-Key was already used for a different request",
    );
    expect(await sendMessage("bkg_1", "Hi", KEY)).toEqual({
      ok: false,
      message: "That did not send. Send it again.",
      newKey: true,
    });
    refuse("idempotency_key_malformed", 400);
    expect(await sendMessage("bkg_1", "Hi", KEY)).toMatchObject({
      newKey: true,
    });
  });
});
