import { describe, it, expect, vi, beforeEach } from "vitest";
import { OperatorApiError } from "@/lib/api/errors";
import {
  addStoryPhoto,
  createPhotoIntent,
  removeStoryPhoto,
  saveStory,
} from "./actions";

/**
 * A suspended business, refused on the story writes: yuvoy-operator#90 f13.
 *
 * `PUT /story`, `POST /story/photos/upload-intents`, `POST /story/photos` and
 * `DELETE /story/photos/{id}` each declare `403 account_suspended`. The two
 * photograph calls already said so; saving the words and removing a photograph
 * read "It was not saved. Try again" and "It was not removed. Try again". Every
 * one of the four is pinned here, so the two that were right stay right.
 */
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok_owner", me: { id: "usr_1" } }),
}));
vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ POST: post, PUT: put, DELETE: del }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const SUSPENDED =
  "Your account has been suspended. Please reach out to admin for help.";

function suspended() {
  return new OperatorApiError({
    status: 403,
    code: "account_suspended",
    message: SUSPENDED,
  });
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  post.mockReset();
  put.mockReset();
  del.mockReset();
});

describe("a suspended business is told so, on every story write", () => {
  it("on saving the words", async () => {
    put.mockRejectedValue(suspended());
    const state = await saveStory({}, form({ about: "", languages: "" }));
    expect(state.message).toBe(SUSPENDED);
    expect(state.message).not.toMatch(/try again/i);
  });

  it("on removing a photograph", async () => {
    del.mockRejectedValue(suspended());
    const state = await removeStoryPhoto({}, form({ photoId: "pho_1" }));
    expect(state.message).toBe(SUSPENDED);
    expect(state.message).not.toMatch(/try again/i);
  });

  it("on starting a photograph", async () => {
    post.mockRejectedValue(suspended());
    expect((await createPhotoIntent()).message).toBe(SUSPENDED);
  });

  it("on adding a photograph", async () => {
    post.mockRejectedValue(suspended());
    expect((await addStoryPhoto("img_1")).message).toBe(SUSPENDED);
  });
});
