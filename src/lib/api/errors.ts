/**
 * The operator API's error envelope, as a typed thing to branch on.
 *
 * Mirrors the traveller app's `YuvoyError` deliberately: same shape, same
 * rule that call sites branch on `code` and never on `message`. Copy in the
 * first release; `@yuvoy/api` when yuvoy-kit is extracted (D-101 names the
 * operator portal as the third consumer that triggers it).
 */

import { dedash, dedashReviver } from "@/lib/format/dedash";

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export function isErrorEnvelope(v: unknown): v is ErrorEnvelope {
  if (typeof v !== "object" || v === null) return false;
  const e = (v as { error?: unknown }).error;
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as { code?: unknown }).code === "string"
  );
}

export class OperatorApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(init: {
    code: string;
    message: string;
    status: number;
    details?: unknown;
    requestId?: string;
  }) {
    super(init.message);
    this.name = "OperatorApiError";
    this.code = init.code;
    this.status = init.status;
    this.details = init.details;
    this.requestId = init.requestId;
  }

  /**
   * The session is gone. The only error the shell handles globally, because
   * it is the only one whose answer is the same everywhere: sign in again.
   */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /**
   * Missing, or belonging to another operator.
   *
   * **These are one case, not two.** The contract is explicit: "a row
   * belonging to another operator answers 404, never 403. A 403 would confirm
   * the row exists, which is precisely what somebody probing ids wants to
   * learn. Do not write error handling that distinguishes them, because the
   * server does not." A client that rendered a different message for each
   * would rebuild the oracle the server refuses to be.
   */
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

export class OperatorNetworkError extends Error {
  constructor(cause?: unknown) {
    super("We could not reach Yuvoy. Check your signal and try again.");
    this.name = "OperatorNetworkError";
    this.cause = cause;
  }
}

/**
 * The error an API refusal becomes, its sentences made fit to print.
 *
 * `message` and every string in `details` are the API's own words, and the
 * copy rule (no long dash in anything an operator reads) cannot reach another
 * team's database. So they are stripped here, where every refusal enters,
 * rather than at each action that prints one: a dozen passed `err.message`
 * through untouched (the audit before release, O10). Punctuation only, and
 * call sites branch on `code`, never on the words.
 */
export function apiError(
  body: ErrorEnvelope,
  status: number,
  requestId?: string,
): OperatorApiError {
  return new OperatorApiError({
    code: body.error.code,
    message: dedash(
      typeof body.error.message === "string" ? body.error.message : "",
    ),
    status,
    details:
      body.error.details === undefined
        ? undefined
        : JSON.parse(JSON.stringify(body.error.details), dedashReviver),
    requestId: body.error.requestId ?? requestId,
  });
}
