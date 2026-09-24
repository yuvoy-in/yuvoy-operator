"use client";

import { useActionState, useState } from "react";
import { saveStory, type StoryState } from "./actions";
import {
  ABOUT_MAX,
  aboutIssue,
  aboutSize,
  languagesIssue,
  parseLanguages,
} from "@/lib/story/story";
import { Button } from "@/components/ui/button";
import { inputClass, textareaClass } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";

/**
 * About and languages — the half of the story that is the operator's outright.
 *
 * ## The count is the API's count
 *
 * "Below forty the API returns 400; show the count live, as the demo does."
 * The number shown is `aboutSize`, which measures what the API measures.
 *
 * It used to measure BYTES, because the API did, and the screen carried a line
 * explaining that "some letters and symbols take up more room than one, so
 * this counts faster than you type". That line existed to excuse a rule that
 * was simply wrong: a business writing in Bengali got about 200 characters
 * rather than 600. The API counts characters now (yuvoy-operator#41), the
 * count matches the letters, and the excuse is gone with it.
 *
 * ## Controlled, on purpose
 *
 * A form action resets uncontrolled fields when it completes. A refusal that
 * emptied six hundred characters somebody had typed on a phone would be the
 * worst possible answer to a length rule, so both fields hold their own state.
 */
export function StoryForm({
  about,
  languages,
}: {
  about: string;
  languages: string[];
}) {
  /*
    Remounted after a save. `useActionState` keeps its last result for the
    life of the component, so the receipt would otherwise stand until the
    operator navigated away — and a fresh round starts from the saved values
    the page has just re-read.
  */
  const [round, setRound] = useState(0);
  return (
    <StoryRound
      key={round}
      about={about}
      languages={languages}
      onAgain={() => setRound((r) => r + 1)}
    />
  );
}

function StoryRound({
  about,
  languages,
  onAgain,
}: {
  about: string;
  languages: string[];
  onAgain: () => void;
}) {
  const [state, act, pending] = useActionState<StoryState, FormData>(
    saveStory,
    {},
  );
  const [text, setText] = useState(about);
  const [langs, setLangs] = useState(languages.join(", "));

  const size = aboutSize(text);
  const aboutProblem = aboutIssue(text);
  const langsProblem = languagesIssue(parseLanguages(langs));

  if (state.saved) {
    return (
      <Panel tone="done" role="status" className="mt-5">
        <p className="text-base font-bold">Saved</p>
        <p className="text-forest/80 mt-2 text-sm">
          {state.saved.about
            ? "Travellers see it on your page now."
            : "Your page shows no About section until you write one."}
        </p>
        <Button onClick={onAgain} variant="secondary" className="mt-4">
          Change it again
        </Button>
      </Panel>
    );
  }

  return (
    <form action={act} className="mt-5 space-y-6">
      <div>
        <label htmlFor="about" className="label text-forest/75">
          About your business
        </label>
        {/*
          The one helper line #88 s17 keeps, and the reason it keeps it: "the
          example for About genuinely shapes what people write". What a
          traveller does with it afterwards is in Help.
        */}
        <p id="about-hint" className="text-forest/70 mt-1.5 text-xs">
          Who you are, how long you have been at it, and what a first-timer
          should know.
        </p>
        <textarea
          id="about"
          name="about"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={textareaClass("mt-2")}
          aria-describedby="about-hint about-count"
          aria-invalid={state.field === "about" || undefined}
        />
        {/*
          The count, at every length including none.

          It used to give way to "Empty is fine. Nothing shows on your page
          until you write something" at zero, which is a third helper line for
          a field that is allowed to be empty and says so by letting Save
          through. "0 of 600" is the same fact without the sentence, and what
          saving an empty one does is on the receipt that follows it.
        */}
        <div id="about-count" className="mt-1.5 space-y-1 text-xs">
          <p className="text-forest/70 tabular-nums">
            {`${size} of ${ABOUT_MAX}`}
          </p>
          {aboutProblem ? (
            <p className="text-forest/80 font-bold">{aboutProblem}</p>
          ) : null}
        </div>
      </div>

      <div>
        <label htmlFor="languages" className="label text-forest/75">
          Languages your crew speaks
        </label>
        {/*
          The example is the placeholder now, not a line of helper text under
          the field (#88 s17). It says the one thing somebody needs before
          typing, which is that these are separated by commas, and it leaves
          when they start. The ceiling and why the languages matter at all are
          answers in Help; the ceiling is also said here the moment it is
          broken, which is the only moment it changes anything.
        */}
        <input
          id="languages"
          name="languages"
          value={langs}
          onChange={(e) => setLangs(e.target.value)}
          autoComplete="off"
          placeholder="English, Hindi, Bengali"
          className={inputClass("mt-2")}
          aria-describedby={langsProblem ? "languages-problem" : undefined}
          aria-invalid={
            state.field === "languages" || Boolean(langsProblem) || undefined
          }
        />
        {langsProblem ? (
          <p
            id="languages-problem"
            className="text-forest/80 mt-1.5 text-xs font-bold"
          >
            {langsProblem}
          </p>
        ) : null}
      </div>

      {state.message ? (
        <p role="alert" className="text-terra-deep text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      {/*
        Disabled while the text breaks a rule the API enforces, with the rule
        written beside the field that breaks it. Spending a request on a 400
        the screen could already see is a round trip on one bar of signal.
      */}
      <Button
        type="submit"
        disabled={pending || Boolean(aboutProblem) || Boolean(langsProblem)}
      >
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
