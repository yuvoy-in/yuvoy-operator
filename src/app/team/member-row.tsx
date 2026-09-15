"use client";

import { useActionState, useState } from "react";
import { removeMember, type RemoveState } from "./actions";
import { describeRole, roleLabel, strongestRole } from "@/lib/team/roles";
import type { Allowed } from "@/lib/team/access";
import type { Removability, TeamPerson } from "@/lib/team/members";
import { AccessControls } from "./access-controls";
import { JoinLink } from "./join-link";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { panelClass } from "@/components/ui/panel";

/**
 * One person, or one invitation nobody has accepted.
 *
 * Removing is two taps, not one. The asymmetry is the same one that makes
 * declining a request two taps: a wet thumb on a 56px target at 6am costs
 * nothing if it adds a seat and costs a skipper their access if it does not.
 * It is not typed-confirmation territory — calling off a departure is
 * irreversible and this is not, because they can be invited again — but it is
 * not one tap either.
 */
export function MemberRow({
  member,
  removability,
  lastSeenLabel,
  held,
  canRole,
  canHoldThem,
  canRestoreThem,
  iAmOnlyAdmin,
  joinUrl,
}: {
  member: TeamPerson;
  removability: Removability;
  lastSeenLabel: string | null;
  /** Their login is paused. The row must show it and offer the way back. */
  held: boolean;
  canRole: Allowed;
  canHoldThem: Allowed;
  canRestoreThem: Allowed;
  /** Passed through to the role picker, which warns an admin about one choice. */
  iAmOnlyAdmin: boolean;
  /**
   * The business's join link, on a PENDING row only.
   *
   * It used to sit permanently at the top of this screen as well, and the
   * owner cut that (yuvoy-operator#25 §1). It belongs here because this is
   * where somebody looks when an invitation has not been taken up — and it
   * must stay reachable somewhere other than the invite receipt, since
   * re-inviting to see it again replaces the code the invitee is holding.
   */
  joinUrl?: string;
}) {
  const [state, act, pending] = useActionState<RemoveState, FormData>(
    removeMember,
    {},
  );
  const [confirming, setConfirming] = useState(false);

  const strongest = strongestRole(member.roles);
  const described = strongest ? describeRole(strongest) : null;

  if (state.removed) {
    /*
      The row becomes its own confirmation rather than disappearing.

      This action deliberately does not `revalidatePath`. A vanished line
      answers "did it work" ambiguously and "when does their access end" not at
      all — and the second is the whole reason somebody is removed in a hurry.
    */
    return (
      <li className={panelClass("done")}>
        <p className="text-base font-bold">
          {member.pending
            ? `Invitation to ${member.name} revoked`
            : `${member.name} removed`}
        </p>
        <p className="text-forest/80 mt-2 text-sm">
          {member.pending
            ? "The code we sent them no longer works."
            : "Signed out everywhere, now. Not at their next sign-in. If their phone is open on this portal, the next thing they tap will ask them to sign in."}
        </p>
      </li>
    );
  }

  return (
    <li className={panelClass()}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-lg font-bold">{member.name}</p>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {/*
            Every role, not just the strongest. `roles` is plural in the
            contract and a member may hold two — collapsing them to one pill
            would quietly hide half of what somebody has been granted.
          */}
          {member.roles.map((role) => (
            <Chip key={role} className="label text-forest/75 bg-cream">
              {roleLabel(role)}
            </Chip>
          ))}
          {member.roles.length === 0 ? (
            <span className="label text-forest/70">No role</span>
          ) : null}
          {/*
            A hold "keeps the person, the role and the history" and only stops
            the login, so a held member stays in this list rather than
            vanishing — and must therefore LOOK different, beside the role they
            still hold. Accent rather than neutral: it is a state that needs
            answering, not a fact.
          */}
          {held ? <Chip tone="accent">Paused</Chip> : null}
        </div>
      </div>

      {described ? (
        <p className="text-forest/80 mt-2 text-sm">
          {described.can}
          {described.cannot ? (
            <span className="text-forest/70"> {described.cannot}</span>
          ) : null}
        </p>
      ) : (
        /*
          A role this build does not recognise. Said plainly rather than
          described with the nearest guess — telling an owner somebody has less
          access than they do is how a phone gets handed over.
        */
        <p className="text-forest/70 mt-2 text-sm">
          We cannot describe this role in this version of the portal. Ask us
          what it grants before you rely on it.
        </p>
      )}

      {member.phoneMasked ? (
        /*
          Four digits, masked by the API in SQL before they reach this portal.
          Enough to catch an invitation typed with two digits transposed at six
          in the morning; not enough to be a directory of an operator's staff.
          The invite confirmation still echoes the whole number once, at the
          moment of sending — that catches the typo a minute later; this
          catches it a day later, which is when somebody actually looks
          (yuvoy-api#62).
        */
        <p className="text-forest/80 mt-2 font-mono text-sm tracking-wider">
          {member.pending ? "Sent to " : "Signs in with "}
          {member.phoneMasked}
        </p>
      ) : null}

      <p className="text-forest/70 mt-2 text-xs">
        {member.pending ? (
          <>
            Invited. They have not signed in yet, so nothing is granted until
            they do.
          </>
        ) : (
          <>
            {/*
              Absent `lastSeenAt` is not "never signed in" — it is "we have no
              record", which is what somebody who accepted an invitation an hour
              ago looks like. Said as a statement about our record rather than
              about them, because the two are not the same claim.
            */}
            {lastSeenLabel ?? "No sign-in recorded"}
            {/*
              `state` is a bare string in the contract with no enum. One value
              is now interpreted — `suspended`, which becomes the Paused chip
              above (see `HELD_STATE`) — and every OTHER non-active value is
              still shown rather than read, because a state this build has
              never heard of is not one it should describe.
            */}
            {member.state && member.state !== "active" && !held ? (
              <span className="text-terra-deep font-bold">
                {" "}
                · {member.state}
              </span>
            ) : null}
          </>
        )}
      </p>

      {/*
        The link to hand over, on the row it is about.

        It sat permanently at the top of this screen as well, and the owner cut
        that (§1). Here it is attached to the invitation somebody is actually
        chasing — and as a copy control rather than a URL in the layout, since
        "a raw https://operators.yuvoy.in/join/l1F-… reads as debug output" and
        the person copying it never needs to read it.
      */}
      {member.pending && joinUrl ? (
        <div className="mt-4">
          <JoinLink url={joinUrl} compact />
        </div>
      ) : null}

      {/*
        Role, hold and restore. Rendered from what this login may actually do
        to THIS person, which the server states per endpoint and this screen
        does not re-argue after a 403.
      */}
      <AccessControls
        member={member}
        canRole={canRole}
        canHoldThem={canHoldThem}
        canRestoreThem={canRestoreThem}
        iAmOnlyAdmin={iAmOnlyAdmin}
      />

      {removability.removable || removability.reason ? (
        removability.removable ? (
          confirming ? (
            <form action={act} className="mt-4">
              <input type="hidden" name="id" value={member.id} />
              <p className="text-sm font-bold">
                {member.pending
                  ? `Revoke the invitation to ${member.name}?`
                  : `Remove ${member.name}?`}
              </p>
              <p className="text-forest/80 mt-1.5 text-sm">
                {member.pending
                  ? "The code we sent them stops working. You can invite them again."
                  : "Their sessions end immediately. Not at their next sign-in. You can invite them again afterwards."}
              </p>
              <div className="mt-4 flex gap-2">
                <Button
                  type="submit"
                  disabled={pending}
                  variant="danger"
                  block={false}
                  className="flex-1"
                >
                  {pending ? "Removing…" : member.pending ? "Revoke" : "Remove"}
                </Button>
                <Button
                  onClick={() => setConfirming(false)}
                  disabled={pending}
                  variant="secondary"
                  block={false}
                  className="flex-1"
                >
                  Back
                </Button>
              </div>
            </form>
          ) : (
            <Button
              onClick={() => setConfirming(true)}
              variant="secondary"
              className="mt-4"
            >
              {member.pending ? "Revoke invitation" : "Remove"}
            </Button>
          )
        ) : (
          /*
            Disabled with the reason beside it, rather than a control that
            answers 409. Same call as the grant ceiling in O9: the refusal is
            knowable from what is already on screen, so it is said here.
          */
          <p className="border-cream-line text-forest/70 mt-4 border-t pt-3 text-xs">
            {removability.reason}
          </p>
        )
      ) : null}

      {state.message ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          {state.message}
        </p>
      ) : null}
    </li>
  );
}
