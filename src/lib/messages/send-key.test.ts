import { describe, expect, it } from "vitest";
import { createSendKeys, IDEMPOTENCY_KEY } from "./send-key";

/*
  One Idempotency-Key per message (yuvoy-api#282 item 4): the same words
  sent again carry the same key, so a send whose answer was lost arrives
  once.
*/
describe("a message's key", () => {
  it("is the API's shape", () => {
    expect(createSendKeys().keyFor("Hello")).toMatch(IDEMPOTENCY_KEY);
  });

  it("stays the same for the same words, as the API reads them", () => {
    const keys = createSendKeys();
    const first = keys.keyFor("See you at the jetty");
    // The API fingerprints the trimmed text, so these are one message.
    expect(keys.keyFor("  See you at the jetty \n")).toBe(first);
  });

  it("is new for other words, and after it is let go", () => {
    let n = 0;
    const keys = createSendKeys(() => `msg_key_number_${++n}`);
    expect(keys.keyFor("Hello")).toBe("msg_key_number_1");
    expect(keys.keyFor("Hello there")).toBe("msg_key_number_2");
    keys.clear();
    expect(keys.keyFor("Hello there")).toBe("msg_key_number_3");
  });
});
