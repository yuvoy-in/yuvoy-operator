"use client";

import { useActionState } from "react";
import { inviteMember, type InviteState } from "./actions";
import { INVITABLE_ROLES, describeRole, roleLabel } from "@/lib/team/roles";
import { Button } from "@/components/ui/button";
import { choiceClass, inputClass } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";

/**
 * Adding the new skipper before the 6am boat.
 *
 * Three fields and a role, because that is the whole of `POST /team`. The
 * work this form does beyond collecting them is explaining what each role
 * grants **at the moment of choosing**, rather than in a help page nobody
 * opens: the crew phone goes out on the boat and gets left on a bench, and the
 * owner deciding between Manager and Staff is deciding what a lost phone can
 * do.
 */
export function InviteForm() {
  const [state, act, pending] = useActionState<InviteState, FormData>(
    inviteMember,
    {},
  );

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
          With the country code. We message them a code — nothing is granted
          until they use it.
        </p>
      </div>

      <fieldset>
        <legend className="label text-forest/75">What they can do</legend>
        <div className="mt-2 space-y-2">
          {INVITABLE_ROLES.map((role, i) => {
            const described = describeRole(role)!;
            return (
              <label
                key={role}
                className={choiceClass(false, "items-start py-4")}
              >
                <input
                  type="radio"
                  name="role"
                  value={role}
                  required
                  defaultChecked={i === INVITABLE_ROLES.length - 1}
                  className="accent-terra-deep mt-0.5 size-5 shrink-0"
                />
                <span>
                  <span className="block text-sm font-bold">
                    {roleLabel(role)}
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
          The absence is the point, so it is stated. An owner looking for
          "Owner" in this list should find the reason rather than assume the
          form is incomplete and go looking for another screen.
        */}
        <p className="text-forest/70 mt-3 text-xs">
          There is no Owner option. The owner is whoever the payout account
          belongs to, and that is not something one login can hand to a phone
          number — Yuvoy sets it up. Staff is preselected: it is the safest of
          the two, and the one a boat phone should have.
        </p>
      </fieldset>

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
          <p className="text-base font-bold">Code sent to {state.sent.name}</p>
          {/*
            The number is echoed because the list cannot show it. `TeamMember`
            carries no phone, so once this re-renders the pending row is a name
            with nothing to check a typo against — and an invitation sent to a
            wrong number is an invitation a stranger can accept. Raised with
            the backend; until it lands, this is the only place to check.
          */}
          <p className="text-forest/80 mt-2 font-mono text-sm">
            {state.sent.phone}
          </p>
          <p className="text-forest/80 mt-2 text-sm">
            Check that number. If it is wrong, invite the right one — a new
            invitation to the same person replaces the old code rather than
            adding a second.
          </p>
          <p className="text-forest/70 mt-2 text-sm">
            They accept at{" "}
            <span className="font-bold">operators.yuvoy.in/join</span>, then
            sign in as usual. Nothing is granted until they do.
          </p>
          {state.devCode ? (
            <p className="rounded-card border-terra-deep text-terra-deep mt-3 border border-dashed p-3 text-sm">
              Development build — their code is{" "}
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
