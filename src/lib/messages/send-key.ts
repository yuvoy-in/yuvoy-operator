/**
 * One Idempotency-Key per message, so a send whose answer was lost can be
 * sent again and still arrive once (yuvoy-api#282 item 4; the API has taken
 * the key on this write since B4).
 *
 * The key belongs to the WORDS, as the API fingerprints them: the trimmed
 * text. Tapping Send again on the same words sends the same key, so if the
 * first one did land the API answers with it rather than posting it twice.
 * Changed words are a different message and get a new key, which is also
 * what keeps the API from refusing a reused key. A key is let go once the
 * message is known to be posted, or when the API says this key cannot be
 * used again.
 *
 * Held by the composer for as long as it is open, and never stored: a key
 * matters only between a send and its retry.
 */
export interface SendKeys {
  /** The key for these words: the one held if they are the same words. */
  keyFor(text: string): string;
  /** Let the held key go. The next send gets a new one. */
  clear(): void;
}

export function createSendKeys(fresh: () => string = newKey): SendKeys {
  let held: { text: string; key: string } | null = null;
  return {
    keyFor(text) {
      const words = text.trim();
      if (held?.text !== words) held = { text: words, key: fresh() };
      return held.key;
    },
    clear() {
      held = null;
    },
  };
}

/** The API's own shape for a key: 16-128 of `A-Za-z0-9_.:-`. */
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{16,128}$/;

/**
 * `msg_` and 128 random bits. `crypto.randomUUID` needs a secure context,
 * which the portal always is (https, or localhost in tests), and the bytes
 * are the fallback for anything that lacks it.
 */
function newKey(): string {
  if (typeof crypto.randomUUID === "function") {
    return `msg_${crypto.randomUUID()}`;
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `msg_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
