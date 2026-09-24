"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { removeMember, type RemoveState } from "./actions";
import { describeRole, roleLabel, strongestRole } from "@/lib/team/roles";
import type { Allowed } from "@/lib/team/access";
import type { Removability, TeamPerson } from "@/lib/team/members";
import { AccessControls } from "./access-controls";
import { JoinLink } from "./join-link";
import { Button } from "@/components/ui/button";
import { useConfirmFocus } from "@/components/ui/use-confirm-focus";
import { Chip } from "@/components/ui/chip";
import { panelClass } from "@/components/ui/panel";

/**
 * One person, or one invitation nobody has accepted.
 *
 * ## The role is the chip, and only the chip (yuvoy-operator#88 s16)
 *
 * "Each person carries a paragraph describing their role ... Three people
 * means three paragraphs of nearly identical text to read past." The chip
 * already named the role, so the row keeps the chip, and what each role may
 * do is said once, for the whole list, behind "What each role can do".
 *
 * ## Removing is quiet, and two taps (yuvoy-operator#81)
 *
 * "Remove somebody from the team is a full-width button with the same weight
 * as Change role." It is the one irreversible thing on the row, so it is the
 * warning-coloured words below the row's controls, never a pill beside them,
 * and it opens a confirm that names the person and what happens, whose button
 * carries the danger pill. The asymmetry is the one that makes declining a
 * request two taps: a wet thumb costs nothing if it adds a seat and costs a
 * skipper their access if it does not. Not typed-confirmation territory
 * (they can be invited again), but not one tap either.
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
  canSeeNotifications,
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
   * The signed-in person is an OWNER or an ADMIN.
   *
   * Its own prop rather than derived from the access controls: `PUT
   * /team/{id}/notifications` is OWNER-or-ADMIN and not `canManage`, so a
   * MANAGER meets a 403 here while being allowed plenty elsewhere.
   */
  canSeeNotifications: boolean;
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
  const { trigger, question } = useConfirmFocus(confirming);

  /*
    A role this build cannot describe is the one case the chip alone cannot
    cover: the chip shows the raw word, and the row says so.
  */
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
        {/*
          "The code we sent them" was the sentence here, and it claimed a send
          nothing had made: an invitation with no email is sent nowhere
          (`sent: false`, yuvoy-operator#91). What revoking does is true either
          way: the invitation, and the code that goes with it, stop working.
        */}
        <p className="text-forest/80 mt-2 text-sm">
          {member.pending
            ? "The invitation and its code no longer work."
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
            <Chip key={role} className="label text-forest/75 bg-paper">
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

      {described ? null : (
        /*
          A role this build does not recognise. Said plainly rather than
          described with the nearest guess: telling an owner somebody has less
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
          {/*
            "Invited on", not "Sent to". Nothing is sent to a phone: there is
            no WhatsApp sender, and an invitation goes by email or by hand
            (yuvoy-operator#91). The number is the one they accept with, which
            is the fact the four digits are here to check.
          */}
          {member.pending ? "Invited on " : "Signs in with "}
          {member.phoneMasked}
        </p>
      ) : null}

      <p className="text-forest/70 mt-2 text-xs">
        {member.pending ? (
          <>Invited. They have not signed in yet.</>
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
      {/*
        Their notification switches — yuvoy-operator#46 item 6.

        NOT on a pending row: "that `id` is an invitation, not a person", so the
        endpoint has nobody to answer for. And not for a MANAGER: this is OWNER
        or ADMIN only, which is narrower than every other control on this row,
        so it is gated on its own signal rather than on `canManage` or on
        whatever the access controls happen to allow.
      */}
      {canSeeNotifications && !member.pending ? (
        <Link
          href={`/team/${member.id}/notifications`}
          className="text-forest tap-target mt-4 block text-sm underline underline-offset-2"
        >
          Their notifications
        </Link>
      ) : null}

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
            <form action={act} className="border-paper-line mt-4 border-t pt-4">
              <input type="hidden" name="id" value={member.id} />
              <p
                ref={question}
                tabIndex={-1}
                className="text-sm font-bold outline-none"
              >
                {member.pending
                  ? `Revoke the invitation to ${member.name}?`
                  : `Remove ${member.name}?`}
              </p>
              <p className="text-forest/80 mt-1.5 text-sm">
                {member.pending
                  ? "The invitation and its code stop working. You can invite them again."
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
              ref={trigger}
              onClick={() => setConfirming(true)}
              variant="danger-quiet"
              size="md"
              block={false}
              aria-expanded={false}
              className="mt-3"
            >
              {/*
                Whose, for a screen reader: every row says "Remove", and a list
                of identical names is a list nobody can pick from (the audit,
                O15). The space belongs to the visible word, so no name
                computation can join the two.
              */}
              {member.pending ? "Revoke invitation" : "Remove"}{" "}
              <span className="sr-only">
                {member.pending ? `to ${member.name}` : member.name}
              </span>
            </Button>
          )
        ) : (
          /*
            Disabled with the reason beside it, rather than a control that
            answers 409. Same call as the grant ceiling in O9: the refusal is
            knowable from what is already on screen, so it is said here.
          */
          <p className="border-paper-line text-forest/70 mt-4 border-t pt-3 text-xs">
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
