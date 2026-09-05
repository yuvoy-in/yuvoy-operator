import { z } from "zod";

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

export const signUpSchema = z.object({
  businessName: z
    .string()
    .trim()
    .min(2, "What is the business called? Travellers will see this.")
    .max(120, "That is longer than a name travellers would read. Shorten it."),
  name: z
    .string()
    .trim()
    .min(2, "Your name, so we know who we are talking to.")
    .max(120, "That is longer than a name we can use. Shorten it."),
  phone,
  /*
    Optional in the contract, and genuinely optional here: an operator on a
    jetty may not have an email and must not be stopped by one. An empty field
    is OMITTED from the body rather than sent as "" — the request body is
    `additionalProperties: false` and an empty string is a value, not an
    absence, so sending it would store a blank address that looks like a real
    one to whoever tries to use it later.
  */
  email: z
    .string()
    .trim()
    .email(
      "That does not look like an email address. Leave it blank if unsure.",
    )
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type SignUpInput = z.infer<typeof signUpSchema>;

/** The request body, with an absent email absent rather than empty. */
export function signUpBody(input: SignUpInput): {
  businessName: string;
  name: string;
  phone: string;
  email?: string;
} {
  return {
    businessName: input.businessName,
    name: input.name,
    phone: input.phone,
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
