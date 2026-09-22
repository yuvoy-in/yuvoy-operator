"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { inviteMember, type InviteState } from "./actions";
import { JoinLink } from "./join-link";
import { INVITABLE_ROLES, describeRole, roleLabel } from "@/lib/team/roles";
import { EMAIL_MAX_LENGTH } from "@/lib/auth/email";
import { Button } from "@/components/ui/button";
import { choiceClass, inputClass } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";

/**
 * Adding the new skipper before the 6am boat.
 *
 * Three fields and a role, because that is the whole of `POST /team`: a name, a
 * number, and since yuvoy-operator#91 an optional email, which is where the
 * invitation goes while no phone channel can carry it. The work this form does
 * beyond collecting them is explaining what each role grants **at the moment of
 * choosing**, rather than in a help page nobody opens: the crew
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
  const router = useRouter();
  const [state, act, pending] = useActionState<InviteState, FormData>(
    async (prev, form) => {
      const next = await inviteMember(prev, form);
      /*
        The pending list, made current as the receipt lands (yuvoy-operator#89
        f16: "the new invitation did not appear until a reload").

        The action already revalidates `/team`, which re-renders the list in
        the same round trip, and on the live portal the list still stayed as it
        was. So the route is refreshed from here as well, the way
        `SendDocument` refreshes after its own revalidating action: one more
        read of the team, and the list no longer depends on one mechanism.
        The receipt survives it, because a refresh keeps client state and this
        form is not unmounted by the page re-rendering around it.

        Only on success. A refusal changed nothing on the server, and a refresh
        then would be a round trip on one bar of signal to redraw the same list.
      */
      if (next.sent) router.refresh();
      return next;
    },
    {},
  );
  return (
    /*
      Remounted per submission, so the uncontrolled fields re-read what was
      typed after a refusal and come up empty after a success, and the role
      mirror below resets with them. Without it a refusal about one character
      of an email emptied all three fields, and a successful Owner invitation
      left the Owner warning on screen over a form reset to Staff.
    */
    <form key={state.attempt ?? 0} action={act} className="space-y-5">
      <InviteFields state={state} />

      {state.message ? (
        <p
          id="invite-error"
          role="alert"
          className="text-terra-deep text-sm font-bold"
        >
          {state.message}
        </p>
      ) : null}

      {state.sent ? <Receipt state={state} /> : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send the invitation"}
      </Button>
    </form>
  );
}

/**
 * The fields, with the role mirrored out of the form.
 *
 * Its own component so it remounts with the form's `key`: the mirror is state,
 * and state that outlives the inputs it mirrors is how the Owner warning came
 * to sit over a form that had been reset to Staff.
 */
function InviteFields({ state }: { state: InviteState }) {
  const was = state.values;
  /**
   * Which role is selected, mirrored out of the form so the screen can say what
   * the Owner choice means before it is sent. Seeded from what was typed when a
   * refusal hands it back, and otherwise the preselected STAFF.
   */
  const [role, setRole] = useState<string>(
    was?.role && (INVITABLE_ROLES as readonly string[]).includes(was.role)
      ? was.role
      : "STAFF",
  );
  const describedBy = (field: InviteState["field"], help: string) =>
    state.field === field ? `invite-error ${help}` : help;

  return (
    <>
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
          defaultValue={was?.name ?? ""}
          autoFocus={state.field === "name"}
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
          defaultValue={was?.phone ?? ""}
          autoFocus={state.field === "phone"}
          className={inputClass("mt-2 font-mono")}
          aria-invalid={state.field === "phone" || undefined}
          /*
            Both, not one. Swapping the help text out for the error loses the
            "with the country code" hint at exactly the moment somebody has got
            the country code wrong.
          */
          aria-describedby={describedBy("phone", "invite-phone-help")}
        />
        {/*
          It said "We message them a code" (yuvoy-operator#91 f20), and nothing
          was ever messaged: the only channel was WhatsApp and there is no
          WhatsApp sender. What is true of the number is that it is the one
          they accept with, whatever carries the invitation.
        */}
        <p id="invite-phone-help" className="text-forest/70 mt-1.5 text-xs">
          With the country code. They accept with this number, and nothing is
          granted until they do.
        </p>
      </div>

      <div>
        <label htmlFor="invite-email" className="label text-forest/75">
          Their email address <span className="text-forest/70">(optional)</span>
        </label>
        <input
          id="invite-email"
          name="email"
          /*
            `text` with an email keyboard, NOT `type="email"`, the call
            `/signup` makes: native validation would answer a typo with a
            browser tooltip, and the sentence worth reading is ours, on the
            field, with what was typed still in it.
          */
          type="text"
          inputMode="email"
          autoComplete="off"
          maxLength={EMAIL_MAX_LENGTH}
          placeholder="ramesh@example.com"
          defaultValue={was?.email ?? ""}
          autoFocus={state.field === "email"}
          className={inputClass("mt-2")}
          aria-invalid={state.field === "email" || undefined}
          aria-describedby={describedBy("email", "invite-email-help")}
        />
        {/*
          What the field is FOR, said before it is left out. `POST /team`: it
          is "where the invitation goes when no phone channel can carry it,
          which today is always: there is no WhatsApp sender. Leave it out and
          the invitation is still created; `sent` is then `false`." So leaving
          it out is allowed and has a cost, and the owner should know the cost
          before the receipt tells them.
        */}
        <p id="invite-email-help" className="text-forest/70 mt-1.5 text-xs">
          We can only send an invitation by email for now. Leave it out and
          nothing is sent: you pass the link on yourself.
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
                    `INVITABLE_ROLES` happened to be ordered, and that list has
                    been rewritten once. Reordering it must not silently
                    preselect Owner. `role` is seeded to STAFF by name, or to
                    what a refusal handed back.
                  */
                  defaultChecked={option === role}
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
    </>
  );
}

/**
 * The receipt: who is invited, the link to hand over, and whether anything was
 * actually sent to them (yuvoy-operator#91 f20).
 *
 * ## The link leads
 *
 * When an invitation went, "Send them this link", with the copy control, is
 * the first thing under the name. The owner is usually standing next to the
 * person they are adding, and the email carries the same link and their code.
 *
 * ## Sent, or not, said plainly
 *
 * `sent` is read back from the queued message, not asserted. When it is true
 * a message is carrying the invitation, the link and their code to them, and
 * the receipt says so without naming a channel it has not been told.
 *
 * When it is false, or absent, NOTHING went, and the link is not offered: it
 * does not work without the code, and the code goes only to an email address.
 * The receipt says the one thing that works, inviting them again with their
 * address, in our words rather than the API's `note`, which tells the owner to
 * pass on a code this screen never shows.
 *
 * On a receipt that WAS delivered, `note` can only be the other thing the API
 * puts there, a role it did not grant as asked, and it is shown for the reason
 * `InviteState.note` gives.
 */
function Receipt({ state }: { state: InviteState }) {
  const sent = state.sent;
  if (!sent) return null;

  return (
    <Panel tone="done" role="status" className="p-4">
      {/*
        "Invited", not "code sent": the invitation exists either way, and
        whether anything reached them is the line below, not this one.
      */}
      <p className="text-base font-bold">
        {sent.name} is invited as {roleLabel(sent.role)}
      </p>

      {sent.delivered ? (
        <>
          {/*
            The link, at the moment it is needed rather than only on the list
            behind this receipt. It is the same URL `GET /team` shows, so
            somebody who closes this has not lost anything, which matters,
            because re-inviting to see it again would replace the code the
            invitee holds.
          */}
          <div className="mt-3">
            {state.joinUrl ? (
              <JoinLink url={state.joinUrl} />
            ) : (
              <p className="text-forest/80 text-sm">
                They accept at{" "}
                <span className="font-bold">operators.yuvoy.in/join</span>, then
                sign in as usual. Nothing is granted until they do.
              </p>
            )}
          </div>
          <p className="text-forest/80 mt-3 text-sm">
            We also sent them the invitation, with the link and their code.
          </p>
          {state.note ? (
            <p className="text-terra-deep mt-2 text-sm font-bold">
              {state.note}
            </p>
          ) : null}
        </>
      ) : (
        /*
          NOTHING WENT, and the link alone is not a way in. Accepting takes the
          invitation's code, and the code goes only to an email address: with
          none on the invitation, asking for it on the join page sends nothing
          (yuvoy-api at e7291e3, `RefreshJoinCode`). So the one thing that
          works is inviting them again with their address, and that is what
          this says, in our words.

          Not the API's `note`, which says "give them the join link and the
          code yourself": this screen never has the code (it is shown only in a
          development build), so that sentence sends the owner looking for
          something that does not exist. Raised on yuvoy-api.
        */
        <p className="text-terra-deep mt-3 text-sm font-bold">
          Nothing was sent: we hold no email address for them, so their code has
          nowhere to go. Invite them again with their email address and the
          invitation goes there.
        </p>
      )}

      {/*
        The whole number, echoed once, at the moment it matters most. The
        pending row shows its last four digits (`phoneMasked`, yuvoy-api#62):
        that catches a transposition a day later, when somebody looks at the
        list; this catches it a minute later, while the owner still remembers
        what they meant to type. Both stay.
      */}
      <p className="text-forest/80 mt-3 font-mono text-sm">{sent.phone}</p>
      <p className="text-forest/80 mt-2 text-sm">
        Check that number. If it is wrong, invite the right one. A new
        invitation to the same person replaces the old code rather than adding a
        second.
      </p>
      {state.devCode ? (
        <p className="rounded-card border-terra-deep text-terra-deep mt-3 border border-dashed p-3 text-sm">
          Development build: their code is{" "}
          <strong className="font-mono">{state.devCode}</strong>.
        </p>
      ) : null}
    </Panel>
  );
}
