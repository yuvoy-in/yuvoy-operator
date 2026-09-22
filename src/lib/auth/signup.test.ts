import { describe, it, expect } from "vitest";
import {
  EMAIL_REQUIRED_AT_SIGNUP,
  firstProblem,
  signUpBody,
  signUpSchema,
  signUpSchemaFor,
} from "./signup";

const valid = {
  businessName: "Reef Divers Havelock",
  name: "Priya Raut",
  phone: "+919000000101",
  relationship: "own",
  email: "priya@reef.example",
};

describe("what an operator has to type", () => {
  it("takes a business, a person, a number and an answer about which they are", () => {
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

describe("the email, required until WhatsApp delivers (owner, 21 Sep 2026)", () => {
  /*
    yuvoy-operator#91 f22. Every sign-in code goes to the email address on the
    account while there is no WhatsApp sender, so an account created without
    one was an account its owner could not sign back into. The contract keeps
    the field optional; the requirement is the portal's, behind one switch.
  */
  it("is switched on", () => {
    // Relaxing it is a decision, made in one place, with this test changed on
    // purpose beside it. It must not happen by accident.
    expect(EMAIL_REQUIRED_AT_SIGNUP).toBe(true);
  });

  it("refuses a sign-up without one, and says why it is needed", () => {
    for (const email of [undefined, "", "   "]) {
      const parsed = signUpSchema.safeParse({ ...valid, email });
      expect(parsed.success, String(email)).toBe(false);
      if (!parsed.success) {
        const p = firstProblem(parsed.error);
        expect(p.field).toBe("email");
        expect(p.message).toBe(
          "Add your email address. Your sign-in codes go there for now.",
        );
      }
    }
  });

  it("is checked, so a typo is caught before it is stored", () => {
    for (const email of ["priya@", "priya", "priya@reef", "pri ya@reef.in"]) {
      const parsed = signUpSchema.safeParse({ ...valid, email });
      expect(parsed.success, email).toBe(false);
      if (!parsed.success) {
        const p = firstProblem(parsed.error);
        expect(p.field).toBe("email");
        expect(p.message).toMatch(/does not look like an email address/);
        // The old hint told them to leave it blank, which is now refused.
        expect(p.message).not.toMatch(/blank/);
      }
    }
  });

  it("takes what the API takes, and sends it trimmed", () => {
    // The API's own rule: a name, one @, and a domain with a dot in it.
    for (const email of ["priya@reef.example", "a.b+c@mail.co.in"]) {
      const parsed = signUpSchema.parse({ ...valid, email: `  ${email} ` });
      expect(signUpBody(parsed).email).toBe(email);
    }
  });

  it("refuses an address longer than any address can be", () => {
    const long = `${"a".repeat(250)}@b.in`;
    expect(signUpSchema.safeParse({ ...valid, email: long }).success).toBe(
      false,
    );
  });
});

describe("the email, once the switch is relaxed", () => {
  /*
    Tested now rather than discovered on the day. With the switch off the form
    goes back to what it was: an operator on a jetty with no address is not
    stopped by one, and a blank field is left out of the body.
  */
  const relaxed = signUpSchemaFor({ emailRequired: false });
  const withoutEmail = {
    businessName: valid.businessName,
    name: valid.name,
    phone: valid.phone,
    relationship: valid.relationship,
  };

  it("takes a sign-up with no email at all", () => {
    expect(relaxed.safeParse(withoutEmail).success).toBe(true);
    expect(relaxed.safeParse({ ...withoutEmail, email: "" }).success).toBe(
      true,
    );
  });

  it("omits a blank email from the body rather than sending it empty", () => {
    /*
      The request body is `additionalProperties: false` and an empty string is
      a value, not an absence. Sending "" would store a blank address that
      looks real to whoever tries to use it later.
    */
    const parsed = relaxed.parse({ ...withoutEmail, email: "" });
    expect(signUpBody(parsed)).not.toHaveProperty("email");
  });

  it("still refuses a typo", () => {
    const parsed = relaxed.safeParse({ ...withoutEmail, email: "priya@" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(firstProblem(parsed.error).field).toBe("email");
  });
});

describe("the body sent to the API", () => {
  it("carries exactly the fields the contract allows", () => {
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
      "relationship",
    ]);
  });

  it("trims what somebody pasted", () => {
    const body = signUpBody(
      signUpSchema.parse({
        businessName: "  Reef Divers  ",
        name: "  Priya  ",
        phone: "  +919000000101 ",
        relationship: "own",
        email: " priya@reef.example ",
      }),
    );
    expect(body.businessName).toBe("Reef Divers");
    expect(body.name).toBe("Priya");
    expect(body.phone).toBe("+919000000101");
  });
});

describe("owning it or running it (D15)", () => {
  it("refuses a sign-up that did not answer, rather than assuming owner", () => {
    /*
      The contract treats an absent `relationship` as `own`, which is right for a
      client built before the question existed and wrong for one that can ask.
      Assuming it would make somebody who runs a business for its owner into its
      owner, and the first they would hear of it is a bank change they are
      allowed to make.
    */
    const withoutAnswer = {
      businessName: valid.businessName,
      name: valid.name,
      phone: valid.phone,
      email: valid.email,
    };
    const parsed = signUpSchema.safeParse(withoutAnswer);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const p = firstProblem(parsed.error);
      expect(p.field).toBe("relationship");
      expect(p.message).toMatch(/own this business or run it/);
    }
  });

  it("refuses anything that is not one of the two", () => {
    // `enum: [own, run]`, and the endpoint refuses anything else with a 400
    // "before the number is looked at". No reason to spend that round trip.
    expect(
      signUpSchema.safeParse({ ...valid, relationship: "OWNER" }).success,
    ).toBe(false);
    expect(signUpSchema.safeParse({ ...valid, relationship: "" }).success).toBe(
      false,
    );
  });

  it("sends `run` as `run`, never as an absence", () => {
    const body = signUpBody(
      signUpSchema.parse({ ...valid, relationship: "run" }),
    );
    expect(body.relationship).toBe("run");
  });
});
