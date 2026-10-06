import { describe, expect, it, vi } from "vitest";
import { useActionState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { redirect } from "next/navigation";
import { sendForm, type Typed } from "./send-form";

type State = { message?: string; saved?: boolean };

function formOf(entries: [string, string][]): FormData {
  const form = new FormData();
  for (const [name, value] of entries) form.append(name, value);
  return form;
}

const UNSENT = () => ({ message: "No signal. Nothing was saved. Try again." });

describe("sendForm", () => {
  it("hands a refusal back with what was typed, and counts it", async () => {
    const send = sendForm<State>(
      async () => ({ message: "Too short." }),
      UNSENT,
    );
    const form = formOf([
      ["title", "Try-dive"],
      ["times", "07:00"],
      ["times", "11:30"],
    ]);

    const first = await send({}, form);
    expect(first).toEqual({
      message: "Too short.",
      typed: { title: "Try-dive", times: "07:00" },
      attempt: 1,
    });
    expect((await send(first, form)).attempt).toBe(2);
  });

  it("never hands back a field it was told to forget", async () => {
    const send = sendForm<State>(
      async () => ({ message: "That code did not work. Ask for a new one." }),
      UNSENT,
      { forget: ["code"] },
    );
    const answer = await send(
      {},
      formOf([
        ["accountHolder", "Ravi Kumar"],
        ["code", "482913"],
      ]),
    );
    expect(answer.typed).toEqual({ accountHolder: "Ravi Kumar" });
  });

  it("leaves a success as it was: nothing typed, the same attempt", async () => {
    const send = sendForm<State>(async () => ({ saved: true }), UNSENT);
    const answer = await send(
      { message: "Too short.", typed: { title: "T" }, attempt: 3 },
      formOf([["title", "Try-dive"]]),
    );
    expect(answer).toEqual({ saved: true, attempt: 3 });
  });

  it("reads a refusal by `refused` when a message is not one", async () => {
    const send = sendForm<State>(
      async () => ({ saved: true, message: "Saved." }),
      UNSENT,
      { refused: (answer) => !answer.saved },
    );
    expect(await send({}, formOf([["title", "x"]]))).toEqual({
      saved: true,
      message: "Saved.",
      attempt: undefined,
    });
  });

  it("makes a dropped request the screen's refusal, typed values kept", async () => {
    const send = sendForm<State>(
      () => Promise.reject(new TypeError("Failed to fetch")),
      UNSENT,
    );
    expect(await send({}, formOf([["title", "Try-dive"]]))).toEqual({
      message: "No signal. Nothing was saved. Try again.",
      typed: { title: "Try-dive" },
      attempt: 1,
    });
  });

  it("keeps what was typed in the browser, out of the request", async () => {
    const action = vi.fn<(state: State, form: FormData) => Promise<State>>(
      async () => ({ saved: true }),
    );
    await sendForm<State>(action, UNSENT)(
      { message: "Too short.", typed: { title: "T" }, attempt: 2 },
      formOf([["title", "Try-dive"]]),
    );
    expect(action.mock.calls[0][0]).toEqual({ message: "Too short." });
  });

  it("gives a redirect back to Next", async () => {
    let moved: unknown;
    try {
      redirect("/account/listings/exp_1/edit?step=selling");
    } catch (error) {
      moved = error;
    }
    const send = sendForm<State>(() => Promise.reject(moved), UNSENT);
    await expect(send({}, formOf([]))).rejects.toBe(moved);
  });
});

/*
  The rule the helper's comment states, held against React itself: defaults
  that read `typed` bring a refused form back in place, and a select, or a
  number field sent from with Go, needs the attempt as its key.
*/
function Refusable({
  action,
}: {
  action: (s: State, f: FormData) => Promise<State>;
}) {
  const [state, act] = useActionState<Typed<State>, FormData>(
    sendForm(action, UNSENT),
    {},
  );
  const typed = state.typed;
  return (
    <form action={act}>
      <label>
        Name
        <input name="title" defaultValue={typed?.title ?? "Saved name"} />
      </label>
      <label>
        Notes
        <textarea name="notes" defaultValue={typed?.notes ?? ""} />
      </label>
      {["per_person", "per_group"].map((unit) => (
        <label key={unit}>
          <input
            type="radio"
            name="unit"
            value={unit}
            defaultChecked={(typed?.unit ?? "per_person") === unit}
          />
          {unit}
        </label>
      ))}
      <label>
        Activity
        <select
          key={state.attempt ?? 0}
          name="activity"
          defaultValue={typed?.activity ?? "snorkel"}
        >
          <option value="snorkel">Snorkel</option>
          <option value="scuba">Scuba</option>
        </select>
      </label>
      <label>
        Seats
        <input
          key={state.attempt ?? 0}
          type="number"
          name="seats"
          defaultValue={typed?.seats ?? "6"}
        />
      </label>
      {state.message ? <p role="alert">{state.message}</p> : null}
      <button type="submit">Save</button>
    </form>
  );
}

describe("a refused form, in React", () => {
  it("comes back as it was typed", async () => {
    render(<Refusable action={async () => ({ message: "Too short." })} />);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Try-dive" },
    });
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Bring a towel" },
    });
    fireEvent.click(screen.getByLabelText("per_group"));
    fireEvent.change(screen.getByLabelText("Activity"), {
      target: { value: "scuba" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Too short.");
    expect(screen.getByLabelText("Name")).toHaveValue("Try-dive");
    expect(screen.getByLabelText("Notes")).toHaveValue("Bring a towel");
    expect(screen.getByLabelText("per_group")).toBeChecked();
    expect(screen.getByLabelText("Activity")).toHaveValue("scuba");
  });

  it("brings back a number field the answer found still focused", async () => {
    render(<Refusable action={async () => ({ message: "Too many." })} />);
    const seats = screen.getByLabelText("Seats") as HTMLInputElement;
    fireEvent.change(seats, { target: { value: "14" } });
    seats.focus();
    await act(async () => {
      seats.form?.requestSubmit();
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many.");
    expect(screen.getByLabelText("Seats")).toHaveValue(14);
  });

  it("still resets after a success, as before", async () => {
    render(<Refusable action={async () => ({ saved: true })} />);
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Bring a towel" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(screen.getByLabelText("Notes")).toHaveValue("");
  });
});
