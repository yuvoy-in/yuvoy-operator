import { describe, it, expect } from "vitest";
import { formatPaise } from "./money";

/**
 * Money is integer paise. ₹4,500 is 450000.
 *
 * The one place this appears in the operator portal is the refund total shown
 * to somebody who has just cancelled fourteen people's day. A number off by a
 * factor of a hundred there is its own emergency.
 */
describe("formatPaise", () => {
  it("renders paise as rupees", () => {
    expect(formatPaise(450000)).toBe("₹4,500");
    expect(formatPaise(6300000)).toBe("₹63,000");
  });

  it("renders nothing as nothing, not as an empty string", () => {
    expect(formatPaise(0)).toBe("₹0");
  });

  it("groups in the Indian system, because the reader is in India", () => {
    // 12,34,567 rather than 1,234,567.
    expect(formatPaise(123456700)).toBe("₹12,34,567");
  });
});
