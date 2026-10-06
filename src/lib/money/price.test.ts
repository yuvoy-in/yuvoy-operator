import { describe, it, expect } from "vitest";
import { paiseToPriceText, priceToPaise } from "./price";

/**
 * yuvoy-operator#144. "Rs. 1500" was saved as 15 paise: the box was read by
 * deleting everything but digits and dots, and the dot after "Rs" stayed.
 */
describe("a price as it is typed", () => {
  it("reads the issue's examples as 150000 paise", () => {
    expect(priceToPaise("1500")).toBe(150_000);
    expect(priceToPaise("Rs. 1500")).toBe(150_000);
    expect(priceToPaise("₹1,500.00")).toBe(150_000);
  });

  it("refuses the issue's examples rather than reading another number", () => {
    for (const typed of ["1.005", "1500-2000", ""]) {
      expect(priceToPaise(typed), typed).toBeNull();
    }
  });

  it("takes each prefix, with or without a space, in any case", () => {
    for (const typed of [
      "Rs 1500",
      "Rs.1500",
      "rs. 1500",
      "RS1500",
      "INR 1500",
      "inr1500",
      "₹ 1500",
      "₹1500",
      "  Rs. 1500  ",
    ]) {
      expect(priceToPaise(typed), typed).toBe(150_000);
    }
  });

  it("reads Western and Indian grouping", () => {
    expect(priceToPaise("150,000")).toBe(15_000_000);
    expect(priceToPaise("1,50,000")).toBe(15_000_000);
    expect(priceToPaise("12,34,567")).toBe(123_456_700);
    expect(priceToPaise("1,234,567")).toBe(123_456_700);
    expect(priceToPaise("INR 2,000")).toBe(200_000);
  });

  it("reads up to two decimals exactly, never a paisa off", () => {
    expect(priceToPaise("1500.5")).toBe(150_050);
    expect(priceToPaise("1500.05")).toBe(150_005);
    expect(priceToPaise("1500.")).toBe(150_000);
    expect(priceToPaise("0.29")).toBe(29);
    expect(priceToPaise("1,234.56")).toBe(123_456);
  });

  it("refuses what is not one price above zero", () => {
    for (const typed of [
      "0",
      "0.00",
      "Rs.",
      "₹",
      ".50",
      "-1500",
      "+1500",
      "1e3",
      "15.00.5",
      "1.2.3",
      "1500 to 2000",
      "1500 2000",
      "Rs. 1500/-",
      "1500 Rs",
      "USD 1500",
      "abc",
      // Commas that do not group: "15,00" is 15 rupees with a decimal comma.
      "15,00",
      "1,5000",
      "1,5,00",
      "10,00,000,000",
      "1,500.505",
      // Fullwidth digits are not read as digits.
      "１５００",
      // Past the largest whole number of paise there is.
      "99999999999999999",
    ]) {
      expect(priceToPaise(typed), typed).toBeNull();
    }
  });
});

describe("the price box's starting text", () => {
  it("is whole rupees when there are no paise, and exact when there are", () => {
    expect(paiseToPriceText(450_000)).toBe("4500");
    expect(paiseToPriceText(150_050)).toBe("1500.50");
    expect(paiseToPriceText(150_005)).toBe("1500.05");
    expect(paiseToPriceText(15)).toBe("0.15");
  });

  it("is empty when there is no price", () => {
    for (const paise of [null, undefined, 0, -100, 1.5, Number.NaN]) {
      expect(paiseToPriceText(paise), String(paise)).toBe("");
    }
  });

  it("reads back as the same price, so saving untouched changes nothing", () => {
    for (const paise of [1, 15, 99, 100, 150_000, 150_050, 123_456_789]) {
      expect(priceToPaise(paiseToPriceText(paise)), String(paise)).toBe(paise);
    }
  });
});
