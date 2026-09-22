import { z } from "zod";
import { EMAIL_MAX_LENGTH, looksLikeEmail } from "./email";

/**
 * Whether creating an account insists on an email address.
 *
 * OWNER RULING, 21 September 2026 (yuvoy-operator#91 f22): **required until
 * WhatsApp delivers.** The contract keeps `email` optional on
 * `POST /auth/signup` and that does not change; the requirement is this
 * portal's, for a reason that is about signing in rather than signing up.
 *
 * There is no WhatsApp sender (yuvoy-api#68), and since yuvoy-api 67e3213 every
 * sign-in code goes to the email address on the account. An account created
 * without one was an account its owner could not sign back into: the code for
 * their second visit had nowhere to go, and the only way in was a person at
 * Yuvoy reading one out. The review found exactly that (f22).
 *
 * One switch, here, so relaxing it is one line. The day a phone sender
 * delivers codes, set this to `false`: the schema goes back to taking a blank
 * address, and the form reads it to drop the `required` and the hint that says
 * codes are emailed. Both halves read this constant, so they cannot disagree.
 */
export const EMAIL_REQUIRED_AT_SIGNUP = true;

/**
 * O1 — what an operator types to create their own account.
 *
 * `POST /operator/v1/auth/signup` (yuvoy-api#81, D-029) creates the operator
 * and its first OWNER, and they can sign in immediately. Three things about
 * that endpoint decide everything this form and its copy may say:
 *
 * 1. **Signing in is not being sellable.** The account is created at
 *    `PROSPECT` and nobody can book it until an admin moves it to `LIVE`. An
 *    operator who thinks they are live and gets no bookings concludes we are
 *    broken — so the screen says it before they submit and again after.
 *
 * 2. **A number that already has an account gets the same `202`.** Deliberate:
 *    a different answer would turn a public endpoint into a checker for
 *    whether a phone belongs to a Yuvoy operator. So the success screen may
 *    not say "account created" — that sentence is false for half the people
 *    who will see it. It says what to do next, which is the same either way.
 *
 * 3. **Two businesses may share a name.** Nothing here may imply a name is
 *    claimed, reserved or checked.
 *
 * 4. **Owning it and running it are different accounts** (D15,
 *    yuvoy-operator#51 item 1). `relationship: "own"` makes the person signing
 *    up the business's OWNER; `"run"` makes them its ADMIN, and the business
 *    then has no owner at all until they invite one. That is not a label: an
 *    admin cannot change where the business is paid, so somebody who answers
 *    "I run it" and expects to add a bank account will be stopped, and the
 *    question is the only place we can say so before they find out.
 *
 * The schema lives apart from the action so it can be tested without a server
 * and without a network — the same split `rights.ts` uses.
 */

/** E.164, character-for-character the rule the sign-in form applies. */
const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .pipe(
    z
      .string()
      .regex(
        /^\+[1-9]\d{7,14}$/,
        "Enter the number with its country code, like +919000000101.",
      ),
  );

/**
 * The address, required or not.
 *
 * Required (the ruling above): an empty field is refused with the reason it is
 * needed, before anything is sent, and a malformed one with what to fix.
 *
 * Optional (once relaxed): an empty field is OMITTED from the body rather than
 * sent as "". The request body is `additionalProperties: false` and an empty
 * string is a value, not an absence, so sending it would store a blank address
 * that looks like a real one to whoever tries to use it later. A malformed one
 * is still refused: a typo stored is a code emailed to nobody.
 */
function emailField(required: boolean) {
  const shaped = z
    .string()
    .trim()
    .max(EMAIL_MAX_LENGTH, "That is longer than an email address can be.")
    .refine(
      looksLikeEmail,
      "That does not look like an email address. Check it and try again.",
    );
  const missing =
    "Add your email address. Your sign-in codes go there for now.";
  return required
    ? /*
        The same sentence for a field that is empty and one that never
        arrived: a hand-built POST without the key is as unanswered as a blank
        box, and zod's own "expected string" is not a sentence for anybody.
      */
      z.string({ message: missing }).trim().min(1, missing).pipe(shaped)
    : shaped.optional().or(z.literal("").transform(() => undefined));
}

/**
 * The form's schema, for either answer to `EMAIL_REQUIRED_AT_SIGNUP`.
 *
 * Built by a function so the relaxed form is tested today rather than
 * discovered the day somebody flips the switch.
 */
export function signUpSchemaFor({ emailRequired }: { emailRequired: boolean }) {
  return z.object({
    businessName: z
      .string()
      .trim()
      .min(2, "What is the business called? Travellers will see this.")
      .max(
        120,
        "That is longer than a name travellers would read. Shorten it.",
      ),
    name: z
      .string()
      .trim()
      .min(2, "Your name, so we know who we are talking to.")
      .max(120, "That is longer than a name we can use. Shorten it."),
    phone,
    /*
      REQUIRED here, and optional in the contract.

      "Absent means `own`, which is what every sign-up meant before the question
      was asked": a sensible default for an older client, and the wrong thing
      for a form that can simply ask. Defaulting silently would make somebody
      who runs a business for its owner into its owner, and the first they
      would hear of it is a bank change they are allowed to make. The issue
      asks for "a required choice with two options" and this is why.

      No `.default()` either: a default here would turn "they did not answer"
      into an answer, which is the same mistake by a shorter route.
    */
    relationship: z.enum(["own", "run"], {
      message: "Say whether you own this business or run it for the owner.",
    }),
    email: emailField(emailRequired),
  });
}

export const signUpSchema = signUpSchemaFor({
  emailRequired: EMAIL_REQUIRED_AT_SIGNUP,
});

export type SignUpInput = z.infer<typeof signUpSchema>;

/** The request body, with an absent email absent rather than empty. */
export function signUpBody(input: SignUpInput): {
  businessName: string;
  name: string;
  phone: string;
  relationship: "own" | "run";
  email?: string;
} {
  return {
    businessName: input.businessName,
    name: input.name,
    phone: input.phone,
    /*
      Always sent, never inferred. The endpoint treats an absent value as `own`,
      so omitting it on a "run" answer would quietly create an owner — the one
      outcome this field exists to prevent.
    */
    relationship: input.relationship,
    ...(input.email ? { email: input.email } : {}),
  };
}

/** Which field to point at, and what to say, for the first problem found. */
export function firstProblem(error: z.ZodError): {
  field: string;
  message: string;
} {
  const issue = error.issues[0];
  return {
    field: String(issue.path[0] ?? ""),
    message: issue.message,
  };
}
