"use client";

import { useActionState, useState } from "react";
import { inviteMember, type InviteState } from "./actions";
import { INVITABLE_ROLES, describeRole, roleLabel } from "@/lib/team/roles";
import { Button } from "@/components/ui/button";
import { choiceClass, inputClass } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";

/**
 * Adding the new skipper before the 6am boat.
 *
 * Three fields and a role, because that is the whole of `POST /team`. The work
 * this form does beyond collecting them is explaining what each role grants **at
 * the moment of choosing**, rather than in a help page nobody opens: the crew
 * phone goes out on the boat and gets left on a bench, and somebody deciding
 * between Staff and Owner is deciding what a lost phone can do.
 *
 * ## The two roles, and why not four
 *
 * Staff or Owner (D15, yuvoy-operator#51 item 2). `POST /team` says "everybody
 * joins as `STAFF`, except an owner", and an invitation asking for ADMIN or
 * MANAGER is **sent rather than refused** — downgraded to STAFF, with a `note`
 * saying so. So offering those two would be a form that silently does something
 * other than what it says; they are given from the member's row once somebody
 * has joined.
 *
 * Owner is the heavier of the two by a long way: an invited owner can change
 * where the business is paid, and unlike a role change it is granted to a phone
 * number nobody has answered from yet. That is said beside the choice, not after
 * the send.
 */
export function InviteForm() {
  const [state, act, pending] = useActionState<InviteState, FormData>(
    inviteMember,
    {},
  );
  /**
   * Which role is selected, mirrored out of the form so the screen can say what
   * the Owner choice means before it is sent. Seeded to the preselected STAFF.
   */
  const [role, setRole] = useState<string>("STAFF");

  return (
    <form action={act} className="space-y-5">
      <div>
        <label htmlFor="invite-name" className="label text-forest/75">
          Their name
        </label>
        <input
          id="invite-name"
          name="name"
          type="text"
          autoComplete="off"
          required
          className={inputClass("mt-2")}
          aria-invalid={state.field === "name" || undefined}
          aria-describedby={state.field === "name" ? "invite-error" : undefined}
        />
      </div>

      <div>
        <label htmlFor="invite-phone" className="label text-forest/75">
          Their phone number
        </label>
        <input
          id="invite-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          required
          placeholder="+919000000101"
          className={inputClass("mt-2 font-mono")}
          aria-invalid={state.field === "phone" || undefined}
          /*
            Both, not one. Swapping the help text out for the error loses the
            "with the country code" hint at exactly the moment somebody has got
            the country code wrong.
          */
          aria-describedby={
            state.field === "phone"
              ? "invite-error invite-phone-help"
              : "invite-phone-help"
          }
        />
        <p id="invite-phone-help" className="text-forest/70 mt-1.5 text-xs">
          With the country code. We message them a code. Nothing is granted
          until they use it.
        </p>
      </div>

      <fieldset>
        <legend className="label text-forest/75">What they can do</legend>
        <div className="mt-2 space-y-2">
          {INVITABLE_ROLES.map((option) => {
            const described = describeRole(option)!;
            return (
              <label
                key={option}
                className={choiceClass(role === option, "items-start py-4")}
              >
                <input
                  type="radio"
                  name="role"
                  value={option}
                  required
                  /*
                    STAFF by name, not by position. It used to be "the last one
                    in the list", which was STAFF only because of how
                    `INVITABLE_ROLES` happened to be ordered — and that list has
                    just been rewritten once. Reordering it must not silently
                    preselect Owner.
                  */
                  defaultChecked={option === "STAFF"}
                  onChange={() => setRole(option)}
                  className="accent-terra-deep mt-0.5 size-5 shrink-0"
                />
                <span>
                  <span className="block text-sm font-bold">
                    {roleLabel(option)}
                  </span>
                  <span className="text-forest/80 block text-xs">
                    {described.can}
                  </span>
                  {described.cannot ? (
                    <span className="text-forest/70 block text-xs">
                      {described.cannot}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
        {/*
          Two things an owner acts on, and the second is the reason Owner is a
          choice here at all rather than the thing this paragraph used to
          apologise for. It read "there is no Owner option … Yuvoy sets it up",
          which was true until D15 and is now the opposite of the form above it.

          Manager and Admin are not missing by accident: `POST /team` says
          "everybody joins as STAFF, except an owner", and asking for either
          answers `role: STAFF` with a `note`. So the honest thing is to say
          where they come from instead.
        */}
        <p className="text-forest/70 mt-3 text-xs">
          Staff is preselected: it is the safer of the two, and the one a boat
          phone should have. Manager and Admin are given after somebody has
          joined, from their row on this list.
        </p>
      </fieldset>

      {/*
        The weight of the Owner choice, at the moment it is selected rather than
        after the invitation has gone.

        An invited owner "gains every owner power, including changing where the
        business is paid" — and unlike a role change, this one is granted to a
        phone number that has not answered yet. The person inviting should read
        that before they send it, not discover it from a bank change.
      */}
      {role === "OWNER" ? (
        <Panel tone="alert" className="p-4">
          <p className="text-sm font-bold">
            An owner can change where the business is paid.
          </p>
          <p className="text-forest/80 mt-1.5 text-sm">
            They get everything an owner can do, from the moment they accept.
            Check the number.
          </p>
        </Panel>
      ) : null}

      {state.message ? (
        <p
          id="invite-error"
          role="alert"
          className="text-terra-deep text-sm font-bold"
        >
          {state.message}
        </p>
      ) : null}

      {state.sent ? (
        <Panel tone="done" role="status" className="p-4">
          {/*
            "Invited", not "code sent". Nothing is delivered — there is no
            WhatsApp account yet (yuvoy-api#68) — so a screen that says a code
            went out is a screen the owner will believe, and then wait on.
          */}
          <p className="text-base font-bold">
            {state.sent.name} is invited as {roleLabel(state.sent.role)}
          </p>
          {/*
            The server's sentence about a role it did not grant as asked. This
            form only asks for OWNER or STAFF, so it should never arrive — which
            is why it is shown rather than dropped: if it does, this build and the
            API disagree about what an invitation grants, and the person handing
            a phone over is the one who needs to know.
          */}
          {state.note ? (
            <p className="text-terra-deep mt-2 text-sm font-bold">
              {state.note}
            </p>
          ) : null}
          {/*
            The whole number, echoed once, at the moment it matters most. The
            pending row now shows its last four digits (`phoneMasked`,
            yuvoy-api#62) — that catches a transposition a day later, when
            somebody looks at the list; this catches it a minute later, while
            the owner still remembers what they meant to type. Both stay.
          */}
          <p className="text-forest/80 mt-2 font-mono text-sm">
            {state.sent.phone}
          </p>
          <p className="text-forest/80 mt-2 text-sm">
            Check that number. If it is wrong, invite the right one. A new
            invitation to the same person replaces the old code rather than
            adding a second.
          </p>
          {/*
            The link, at the moment it is needed rather than only on the screen
            behind this panel. `POST /team` returns it precisely so the inviter
            can pass it on themselves, and this action used to drop it.

            It is the same URL `GET /team` shows, so somebody who closes this
            has not lost anything — which matters, because re-inviting to see
            it again would replace the code the invitee is holding.
          */}
          {state.joinUrl ? (
            <div className="mt-3">
              <p className="text-forest/80 text-sm">
                Send them this link. Nothing is granted until they open it and
                enter their own number.
              </p>
              <p className="rounded-control border-paper-line bg-paper text-forest mt-2 border p-3 font-mono text-sm break-all select-all">
                {state.joinUrl}
              </p>
            </div>
          ) : (
            <p className="text-forest/70 mt-2 text-sm">
              They accept at{" "}
              <span className="font-bold">operators.yuvoy.in/join</span>, then
              sign in as usual. Nothing is granted until they do.
            </p>
          )}
          {state.devCode ? (
            <p className="rounded-card border-terra-deep text-terra-deep mt-3 border border-dashed p-3 text-sm">
              Development build: their code is{" "}
              <strong className="font-mono">{state.devCode}</strong>.
            </p>
          ) : null}
        </Panel>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send the invitation"}
      </Button>
    </form>
  );
}
