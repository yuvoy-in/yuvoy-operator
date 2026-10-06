import { callAction } from "./call-action";

/**
 * A form's answer, with what was in the form when it was refused.
 *
 * `typed` is every field as it was sent, by name (the first value of a name
 * that repeats, as `FormData.get` reads it). `attempt` counts the refusals, for
 * a form that has to remount to show them (see `sendForm`).
 */
export type Typed<S> = S & {
  typed?: Record<string, string>;
  attempt?: number;
};

/**
 * A form's Server Action, as `useActionState` should call it.
 *
 * Two promises, both found by the stability audit before release:
 *
 * **A dropped request is a refusal.** The send goes through `callAction`, so
 * a phone that lost its signal reads `unsent()`, the screen's own "No signal"
 * sentence, where it was rather than losing the screen to the error boundary.
 *
 * **A refusal keeps what was typed.** React runs a form's action in a
 * transition and resets the form when it resolves, refusals included, so
 * every uncontrolled field snapped back to what was on file: twelve fields of
 * a listing edit gone over one bad number, a bank change emptied by a wrong
 * code. A refusal now comes back with `typed`, and a form reads every
 * default as `state.typed?.name ?? saved`.
 *
 * That one rule is the whole fix for most forms, because React applies a
 * changed default BEFORE it resets: text, dates, radios and checkboxes come
 * back as typed, focus stays where it was, and nothing remounts. It does not
 * reach three kinds of field:
 *
 *   - a `<select>`, whose default React reads only when it mounts;
 *   - a CONTROLLED radio, checkbox or select, which the reset puts out of step
 *     with the state behind it (the box shows one choice, the screen another);
 *   - a `type="number"` field that still has the focus when the answer lands,
 *     which is every form sent with the keyboard's Go key from one. React
 *     leaves a focused number field's default alone, so the reset takes it
 *     back to what was on file.
 *
 * A form holding any of these is keyed on `state.attempt` as well, so a
 * refusal remounts it instead of resetting it, the way the sign-in and invite
 * forms have always been. A form that cannot remount (the meeting pin's map, a
 * confirm that owns its focus) keys those fields alone.
 *
 * Success is left exactly as it was: no `typed`, the same `attempt`, and so
 * the same reset (or the same receipt) as before.
 *
 * `forget` names fields never handed back. A one-time code is typed again
 * after a refusal, as it is at sign-in: the wrong code is usually WHY it was
 * refused.
 *
 * `unsent` is the screen's own sentence for a request that never came back,
 * handed what was sent and the answer before it, for a form with steps that
 * has to stay on the one it was on.
 *
 * A refusal is an answer with a `message`, unless `refused` says otherwise.
 */
export function sendForm<S extends { message?: string }>(
  action: (state: S, form: FormData) => Promise<S>,
  unsent: (form: FormData, state: S) => S,
  options: {
    forget?: readonly string[];
    refused?: (answer: S) => boolean;
  } = {},
): (state: Typed<S>, form: FormData) => Promise<Typed<S>> {
  const { forget = [], refused = (answer: S) => Boolean(answer.message) } =
    options;
  return async (state, form) => {
    const { attempt } = state;
    const previous = withoutTyped(state);
    const answer = await callAction(
      () => action(previous, form),
      () => unsent(form, previous),
    );
    if (!refused(answer)) return { ...answer, attempt };
    return {
      ...answer,
      typed: typedIn(form, forget),
      attempt: (attempt ?? 0) + 1,
    };
  };
}

/**
 * The previous answer as the action knows it. What was typed stays in the
 * browser: it is already there, and a Server Action's arguments are a request
 * body.
 */
function withoutTyped<S>(state: Typed<S>): S {
  const rest = { ...state };
  delete rest.typed;
  delete rest.attempt;
  return rest;
}

function typedIn(
  form: FormData,
  forget: readonly string[],
): Record<string, string> {
  const typed: Record<string, string> = {};
  for (const [name, value] of form) {
    if (typeof value !== "string" || forget.includes(name)) continue;
    typed[name] ??= value;
  }
  return typed;
}

/**
 * Named fields exactly as they were sent, each `""` when absent.
 *
 * For a form whose action hands its own `values` back with a refusal (the
 * sign-up and the invitation, which predate `typed`): a request that never
 * came back has to hand back the same, or the form remounts empty.
 */
export function fieldsOf<K extends string>(
  form: FormData,
  names: readonly K[],
): Record<K, string> {
  return Object.fromEntries(
    names.map((name) => [name, String(form.get(name) ?? "")]),
  ) as Record<K, string>;
}
