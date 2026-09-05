import { describe, it, expect } from "vitest";
import { firstProblem, signUpBody, signUpSchema } from "./signup";

const valid = {
  businessName: "Reef Divers Havelock",
  name: "Priya Raut",
  phone: "+919000000101",
};

describe("what an operator has to type", () => {
  it("takes a business, a person and a number", () => {
    const parsed = signUpSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("accepts the number the way somebody actually writes it", () => {
    // The same normalisation the sign-in form does, so a number that works
    // there works here. Spaces, brackets and dashes come out.
    const parsed = signUpSchema.safeParse({
      ...valid,
      phone: "+91 90000 (00101)",
    });
    expect(parsed.success && parsed.data.phone).toBe("+919000000101");
  });

  it("refuses a number with no country code, and says which", () => {
    const parsed = signUpSchema.safeParse({ ...valid, phone: "9000000101" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const p = firstProblem(parsed.error);
      expect(p.field).toBe("phone");
      expect(p.message).toMatch(/country code/);
    }
  });

  it("names the field that is wrong, not just that something is", () => {
    const parsed = signUpSchema.safeParse({ ...valid, businessName: "" });
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(firstProblem(parsed.error).field).toBe("businessName");
  });
});

describe("the optional email", () => {
  it("is genuinely optional — an operator on a jetty may not have one", () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true);
    expect(signUpSchema.safeParse({ ...valid, email: "" }).success).toBe(true);
  });

  it("is omitted from the body rather than sent empty", () => {
    /*
      The request body is `additionalProperties: false` and an empty string is
      a value, not an absence. Sending "" would store a blank address that
      looks real to whoever tries to use it later.
    */
    const parsed = signUpSchema.parse({ ...valid, email: "" });
    expect(signUpBody(parsed)).not.toHaveProperty("email");
    expect(signUpBody(parsed)).toEqual({
      businessName: valid.businessName,
      name: valid.name,
      phone: valid.phone,
    });
  });

  it("is checked when it is given, so a typo is caught before it is stored", () => {
    const parsed = signUpSchema.safeParse({ ...valid, email: "priya@" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(firstProblem(parsed.error).field).toBe("email");
  });

  it("is sent when it is real", () => {
    const parsed = signUpSchema.parse({
      ...valid,
      email: "priya@reef.example",
    });
    expect(signUpBody(parsed).email).toBe("priya@reef.example");
  });
});

describe("the body sent to the API", () => {
  it("carries exactly the four fields the contract allows", () => {
    // `additionalProperties: false` — anything extra is a 400, and the schema
    // is what stops a form field from becoming one by accident.
    const body = signUpBody(
      signUpSchema.parse({ ...valid, email: "a@b.example" }),
    );
    expect(Object.keys(body).sort()).toEqual([
      "businessName",
      "email",
      "name",
      "phone",
    ]);
  });

  it("trims what somebody pasted", () => {
    const body = signUpBody(
      signUpSchema.parse({
        businessName: "  Reef Divers  ",
        name: "  Priya  ",
        phone: "  +919000000101 ",
      }),
    );
    expect(body.businessName).toBe("Reef Divers");
    expect(body.name).toBe("Priya");
    expect(body.phone).toBe("+919000000101");
  });
});
