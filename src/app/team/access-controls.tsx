"use client";

import { useActionState, useEffect, useState } from "react";
import {
  holdMember,
  restoreMember,
  setMemberRole,
  type AccessState,
} from "./actions";
import { ASSIGNABLE_ROLES } from "@/lib/team/access";
import { describeRole, roleLabel } from "@/lib/team/roles";
import type { Allowed } from "@/lib/team/access";
import type { TeamPerson } from "@/lib/team/members";
import { Button } from "@/components/ui/button";
import { choiceClass } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";

/**
 * Changing somebody's access from the row they are on — yuvoy-operator#25 §3.
 *
 * ## The one thing every control here has to say
 *
 * **All three writes end that person's sessions**, a role change included. The
 * contract is explicit — "their sessions end, so the change is true
 * immediately rather than whenever a fourteen-day session happens to lapse" —
 * and somebody demoted mid-shift is signed out of the manifest they are
 * holding. So it is said BEFORE the tap, in the confirmation, rather than
 * discovered by the person it happens to.
 *
 * That is the copy §4 explicitly keeps: it changes what somebody does. A
 * skipper on a boat is demoted at the end of the trip, not during it.
 *
 * ## Why each of these is two taps
 *
 * The same asymmetry the Remove button already had. A wet thumb on a 56px
 * target at 6am costs nothing if it adds a seat and costs a skipper their
 * access if it does not. None of these is irreversible — a hold restores, a
 * role changes back — so it is not typed-confirmation territory; it is not one
 * tap either.
 */

/** Whichever access control this row currently has open. */
type Open = "role" | "hold" | "restore" | null;

/**
 * Close the form once the write has landed.
 *
 * Not cosmetic. Each of these revalidates, so the row re-renders with new
 * chips and a different set of controls — but the open form is client state
 * and outlives that, so an owner who paused somebody was left looking at the
 * pause form with "Give access back" unreachable behind it.
 *
 * A failure leaves the form open on purpose: the message belongs beside the
 * control that produced it, and closing would take the reason with it.
 */
function useCloseOnDone(state: AccessState, onClose: () => void) {
  useEffect(() => {
    if (state.done) onClose();
  }, [state.done, onClose]);
}

export function AccessControls({
  member,
  canRole,
  canHoldThem,
  canRestoreThem,
  iAmOnlyAdmin,
}: {
  member: TeamPerson;
  canRole: Allowed;
  canHoldThem: Allowed;
  canRestoreThem: Allowed;
  /**
   * The signed-in person is an ADMIN and not also an OWNER.
   *
   * It changes one sentence, and the sentence matters: `PUT /team/{id}/role`
   * says "an ADMIN who makes somebody an owner cannot change that person's
   * access afterwards." Handing the role on is a one-way door for an admin and
   * not for an owner, so only one of them is warned about it
   * (yuvoy-operator#51 item 3).
   */
  iAmOnlyAdmin: boolean;
}) {
  const [open, setOpen] = useState<Open>(null);

  const anyControl =
    canRole.allowed || canHoldThem.allowed || canRestoreThem.allowed;
  const reason = canHoldThem.reason ?? canRole.reason;

  if (!anyControl) {
    /*
      No controls. Usually nothing is said — "not offering it says so" — and
      the one exception is a reason that survived the §4 cut, which today is
      only "The last owner or admin."
    */
    return reason ? (
      <p className="border-paper-line text-forest/70 mt-4 border-t pt-3 text-xs">
        {reason}
      </p>
    ) : null;
  }

  return (
    <div className="mt-4">
      {open === null ? (
        <div className="flex flex-wrap gap-2">
          {canRole.allowed ? (
            <Button
              onClick={() => setOpen("role")}
              variant="secondary"
              block={false}
            >
              Change role
            </Button>
          ) : null}
          {canHoldThem.allowed ? (
            <Button
              onClick={() => setOpen("hold")}
              variant="secondary"
              block={false}
            >
              Pause access
            </Button>
          ) : null}
          {canRestoreThem.allowed ? (
            <Button
              onClick={() => setOpen("restore")}
              variant="secondary"
              block={false}
            >
              Give access back
            </Button>
          ) : null}
        </div>
      ) : null}

      {/*
        `onClose` is both the cancel and the close-on-success.

        The forms have to close themselves when the write lands: all three
        revalidate, so the row comes back with new chips and a different set of
        controls — but this `open` state is the client's and survives that
        re-render. An owner who paused somebody was left looking at the pause
        form again, with no way to reach "Give access back" without reloading.
      */}
      {open === "role" ? (
        <RoleForm
          member={member}
          iAmOnlyAdmin={iAmOnlyAdmin}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open === "hold" ? (
        <HoldForm member={member} onClose={() => setOpen(null)} />
      ) : null}
      {open === "restore" ? (
        <RestoreForm member={member} onClose={() => setOpen(null)} />
      ) : null}
    </div>
  );
}

/**
 * The role picker.
 *
 * `ASSIGNABLE_ROLES` rather than a hand-written list, so the radios, the
 * validator and the request body cannot disagree about which four roles exist.
 * Each option carries what it can and cannot do, because "Manager" alone is a
 * word, not a decision.
 *
 * OWNER is one of the four now (D31, yuvoy-operator#51 item 3): "an OWNER or an
 * ADMIN may make somebody already on the team an owner, rather than removing them
 * and inviting them back." It is the only option with a consequence panel, for
 * the reason the contract gives it one.
 *
 * **Replaced, not added to.** The picker's semantics are the API's, so there
 * is nothing to explain about what happens to a second role — there is never
 * a second role after this.
 */
function RoleForm({
  member,
  iAmOnlyAdmin,
  onClose,
}: {
  member: TeamPerson;
  iAmOnlyAdmin: boolean;
  onClose: () => void;
}) {
  const [state, act, pending] = useActionState<AccessState, FormData>(
    setMemberRole,
    {},
  );
  useCloseOnDone(state, onClose);
  const current = ASSIGNABLE_ROLES.find((r) => member.roles.includes(r));
  /*
    What is selected right now, so the Owner consequence can be shown while it is
    being chosen rather than after it is saved. Seeded to the role they hold, so
    the panel is not drawn for an owner who is already one and nothing is being
    changed.
  */
  const [chosen, setChosen] = useState<string | undefined>(current);

  return (
    <form action={act} className="border-paper-line border-t pt-4">
      <input type="hidden" name="id" value={member.id} />
      <fieldset>
        <legend className="text-sm font-bold">What {member.name} can do</legend>
        <div className="mt-3 space-y-2">
          {ASSIGNABLE_ROLES.map((role) => {
            const described = describeRole(role)!;
            return (
              <label
                key={role}
                className={choiceClass(role === chosen, "items-start py-4")}
              >
                <input
                  type="radio"
                  name="role"
                  value={role}
                  required
                  defaultChecked={role === current}
                  onChange={() => setChosen(role)}
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
      </fieldset>

      {/*
        What making somebody an owner actually hands over, said while it is being
        chosen (yuvoy-operator#51 item 3).

        "A new owner gains every owner power, including changing where the
        business is paid" — that is the one nobody guesses from the word "Owner",
        and it is the one that moves a season's takings. Drawn only when Owner is
        selected AND they are not one already, so it reads as a consequence of the
        choice rather than as a description of the row.

        The second sentence is for an ADMIN only: "an ADMIN who makes somebody an
        owner cannot change that person's access afterwards." For an admin this is
        a one-way door, and the API will refuse them the way back.
      */}
      {chosen === "OWNER" && !member.roles.includes("OWNER") ? (
        <Panel tone="alert" className="mt-3 p-4">
          <p className="text-sm font-bold">
            They will be able to change where the business is paid.
          </p>
          {iAmOnlyAdmin ? (
            <p className="text-forest/80 mt-1.5 text-sm">
              You will not be able to change their access afterwards.
            </p>
          ) : null}
        </Panel>
      ) : null}

      {/*
        Kept copy, by §4's own test: it changes what somebody does. Whoever is
        demoted is signed out the moment this is saved, so an owner doing it to
        a skipper mid-trip should know before, not after.
      */}
      <p className="text-forest/80 mt-3 text-sm">
        Saving signs {member.name} out everywhere. They sign back in with the
        new role.
      </p>

      <Actions
        pending={pending}
        submitLabel={pending ? "Saving…" : "Save role"}
        onClose={onClose}
      />
      <Failure state={state} />
    </form>
  );
}

/**
 * Pausing a login.
 *
 * The distinction from Remove is the whole reason this control exists, so it
 * is the thing the confirmation says: the person, the role and the history all
 * stay. That is not a rule being justified — it is the difference between the
 * two buttons, and getting it wrong costs somebody their history.
 */
function HoldForm({
  member,
  onClose,
}: {
  member: TeamPerson;
  onClose: () => void;
}) {
  const [state, act, pending] = useActionState<AccessState, FormData>(
    holdMember,
    {},
  );
  useCloseOnDone(state, onClose);

  return (
    <form action={act} className="border-paper-line border-t pt-4">
      <input type="hidden" name="id" value={member.id} />
      <p className="text-sm font-bold">Pause {member.name}&rsquo;s access?</p>
      <p className="text-forest/80 mt-1.5 text-sm">
        They stay on this list with the same role, and cannot sign in until you
        give it back. Their sessions end now.
      </p>
      <Actions
        pending={pending}
        submitLabel={pending ? "Pausing…" : "Pause access"}
        onClose={onClose}
      />
      <Failure state={state} />
    </form>
  );
}

/** Giving it back. One tap of consequence, and it is the reversible one. */
function RestoreForm({
  member,
  onClose,
}: {
  member: TeamPerson;
  onClose: () => void;
}) {
  const [state, act, pending] = useActionState<AccessState, FormData>(
    restoreMember,
    {},
  );
  useCloseOnDone(state, onClose);

  return (
    <form action={act} className="border-paper-line border-t pt-4">
      <input type="hidden" name="id" value={member.id} />
      <p className="text-sm font-bold">Give {member.name} access back?</p>
      <p className="text-forest/80 mt-1.5 text-sm">
        With the role they had. They sign in again as usual.
      </p>
      <Actions
        pending={pending}
        submitLabel={pending ? "Restoring…" : "Give access back"}
        onClose={onClose}
      />
      <Failure state={state} />
    </form>
  );
}

/** The same pair of buttons on all three, so none of them is the odd one. */
function Actions({
  pending,
  submitLabel,
  onClose,
}: {
  pending: boolean;
  submitLabel: string;
  onClose: () => void;
}) {
  return (
    <div className="mt-4 flex gap-2">
      <Button
        type="submit"
        disabled={pending}
        variant="primary"
        block={false}
        className="flex-1"
      >
        {submitLabel}
      </Button>
      <Button
        onClick={onClose}
        disabled={pending}
        variant="secondary"
        block={false}
        className="flex-1"
      >
        Not now
      </Button>
    </div>
  );
}

/**
 * A refusal, and only a refusal.
 *
 * There is no success message on any of these: all three revalidate, so the
 * row itself comes back with the new chips, the new state and a different set
 * of controls. That is a better confirmation than a sentence, and it is the
 * rule this repo settled on — revalidate only when the re-render shows more.
 */
function Failure({ state }: { state: AccessState }) {
  if (!state.message) return null;
  return (
    <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
      {state.message}
    </p>
  );
}
