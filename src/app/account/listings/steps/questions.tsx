"use client";

import { useActionState, useState } from "react";
import { saveQuestions, type StepState } from "../builder-actions";
import { Button } from "@/components/ui/button";
import { fieldLabelClass, inputClass } from "@/components/ui/input";
import { panelClass } from "@/components/ui/panel";
import { StepShell } from "./step-shell";

/**
 * Step 5 — what a traveller is asked when booking.
 *
 * ## Health questions do not belong here
 *
 * Said on the step, because the mistake is natural and the cost is real:
 * answers here are stored unencrypted, shown to the operator's team on the
 * booking and the manifest, and shown to Yuvoy staff. A listing that needs to
 * know about a traveller's health asks through its screener, which records only
 * that the party declared themselves clear.
 *
 * ## Why an existing question keeps its id
 *
 * "A question sent back with its `id` and the same `text`, `answerType` and
 * `options` keeps that id and every answer to it." Rewording makes a new
 * question with a new id, and the traveller who answered the old wording keeps
 * that answer shown with the words they saw. So the id travels with the row
 * rather than being dropped and re-sent.
 */

type AnswerType = "short_text" | "choice" | "yes_no";

interface Row {
  id?: string;
  text: string;
  answerType: AnswerType;
  options: string[];
  required: boolean;
}

const MAX = 10;

export function QuestionsStep({
  id,
  questions,
  back,
}: {
  id: string;
  questions: Row[];
  back: string;
}) {
  const [state, act, pending] = useActionState<StepState, FormData>(
    saveQuestions,
    {},
  );
  const [rows, setRows] = useState<Row[]>(questions);

  function update(index: number, change: Partial<Row>) {
    setRows((was) =>
      was.map((row, i) => (i === index ? { ...row, ...change } : row)),
    );
  }

  const payload = JSON.stringify(
    rows
      .filter((row) => row.text.trim())
      .map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        text: row.text.trim(),
        answerType: row.answerType,
        ...(row.answerType === "choice"
          ? { options: row.options.map((o) => o.trim()).filter(Boolean) }
          : {}),
        required: row.required,
      })),
  );

  return (
    <StepShell
      title="Questions"
      blurb="You can leave this empty."
      action={act}
      pending={pending}
      message={state.message}
      back={back}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="questions" value={payload} />

      <p className="text-forest/70 text-xs">
        Do not ask about health here. Use the health check in Location and
        safety.
      </p>

      {rows.length === 0 ? (
        <p className="text-forest/70 text-sm">No questions yet.</p>
      ) : (
        <ul className="space-y-4">
          {rows.map((row, i) => (
            <li key={i} className={panelClass("outline", "p-4")}>
              <label htmlFor={`q-${i}`} className={fieldLabelClass()}>
                Question {i + 1}
              </label>
              <input
                id={`q-${i}`}
                maxLength={200}
                value={row.text}
                onChange={(e) => update(i, { text: e.target.value })}
                className={inputClass("mt-2")}
                aria-invalid={
                  state.fields?.includes(`questions.${i}.text`) || undefined
                }
              />

              <div className="mt-3 flex flex-wrap items-center gap-4">
                <label className="text-sm">
                  <span className={fieldLabelClass("mr-2")}>Answer</span>
                  <select
                    value={row.answerType}
                    onChange={(e) =>
                      update(i, { answerType: e.target.value as AnswerType })
                    }
                    className={inputClass("mt-1 inline-block w-auto")}
                  >
                    <option value="short_text">A short answer</option>
                    <option value="choice">One of a list</option>
                    <option value="yes_no">Yes or no</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={row.required}
                    onChange={(e) => update(i, { required: e.target.checked })}
                  />
                  They must answer it
                </label>
              </div>

              {row.answerType === "choice" ? (
                <div className="mt-3">
                  <label
                    htmlFor={`q-${i}-options`}
                    className={fieldLabelClass()}
                  >
                    The choices
                  </label>
                  <textarea
                    id={`q-${i}-options`}
                    rows={3}
                    value={row.options.join("\n")}
                    onChange={(e) =>
                      update(i, { options: e.target.value.split("\n") })
                    }
                    className={inputClass("mt-2 h-auto py-3")}
                    aria-invalid={
                      state.fields?.includes(`questions.${i}.options`) ||
                      undefined
                    }
                    aria-describedby={`q-${i}-options-help`}
                  />
                  <p
                    id={`q-${i}-options-help`}
                    className="text-forest/70 mt-1.5 text-xs"
                  >
                    One per line, between two and ten of them.
                  </p>
                </div>
              ) : null}

              <Button
                variant="secondary"
                size="sm"
                block={false}
                className="mt-3"
                onClick={() =>
                  setRows((was) => was.filter((_, at) => at !== i))
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {rows.length < MAX ? (
        <Button
          variant="secondary"
          size="md"
          block={false}
          onClick={() =>
            setRows((was) => [
              ...was,
              {
                text: "",
                answerType: "short_text",
                options: [],
                required: false,
              },
            ])
          }
        >
          Add a question
        </Button>
      ) : (
        <p className="text-forest/70 text-xs">
          Ten is the most a listing asks.
        </p>
      )}
    </StepShell>
  );
}
