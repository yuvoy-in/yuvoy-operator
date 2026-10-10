import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorApiError } from "@/lib/api/errors";

/*
  The Questions step's save, refused field by field (yuvoy-api#282 item 5):
  a question or a choice holding a phone number, an email address or a link
  is marked where it is, with the API's reason beside it.
*/

const put = vi.fn();
const redirect = vi.fn();

vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ PUT: put }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok", me: { canManage: true } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirect(to),
}));

const { saveQuestions } = await import("./builder-actions");

const PHONE =
  "a question cannot include a phone number, an email address or a link, and this one looks like it has a phone number, from seven or more digits written close together. Write it another way";

function form(questions: unknown[]): FormData {
  const f = new FormData();
  f.set("id", "exp_1");
  f.set("questions", JSON.stringify(questions));
  return f;
}

const QUESTIONS = [
  {
    text: "Call 98765 43210 to confirm?",
    answerType: "yes_no",
    options: [],
    required: false,
  },
  {
    text: "Which boat?",
    answerType: "choice",
    options: ["Blue", "www.boat.in"],
    required: true,
  },
];

function refuse(details: unknown) {
  put.mockResolvedValue({
    data: undefined,
    error: new OperatorApiError({
      code: "invalid_input",
      message: "some of these questions need fixing",
      status: 400,
      details,
    }),
  });
}

beforeEach(() => {
  put.mockReset();
  redirect.mockReset();
});

describe("a question list the API would not save", () => {
  it("marks each refused question, with the API's reason beside it", async () => {
    refuse({
      "questions[0].text": PHONE,
      "questions[1].options":
        "an option cannot include a phone number, an email address or a link, and this one looks like it has a link. Write it another way",
    });
    expect(await saveQuestions({}, form(QUESTIONS))).toEqual({
      message: "Some of these questions need fixing.",
      fields: ["questions.0.text", "questions.1.options"],
      notes: {
        "questions.0.text":
          "A question cannot include a phone number, an email address or a link, and this one looks like it has a phone number, from seven or more digits written close together. Write it another way.",
        "questions.1.options":
          "An option cannot include a phone number, an email address or a link, and this one looks like it has a link. Write it another way.",
      },
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("tells a question the listing no longer asks on the question itself", async () => {
    refuse({
      "questions[0].id":
        "not a question this listing asks. Leave out the id to add it as a new question",
    });
    expect(await saveQuestions({}, form(QUESTIONS))).toMatchObject({
      fields: ["questions.0.text"],
      notes: {
        "questions.0.text":
          "Not a question this listing asks. Leave out the id to add it as a new question.",
      },
    });
  });

  it("words a refusal that names no question as it always did", async () => {
    refuse({ questions: "a listing can ask at most 10 questions" });
    expect(await saveQuestions({}, form(QUESTIONS))).toEqual({
      message: "some of these questions need fixing",
    });
  });
});
