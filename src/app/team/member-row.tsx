"use client";

import { useActionState, useState } from "react";
import { removeMember, type RemoveState } from "./actions";
import { describeRole, roleLabel, strongestRole } from "@/lib/team/roles";
import type { Removability, TeamPerson } from "@/lib/team/members";

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
  canRemove,
}: {
  member: TeamPerson;
  removability: Removability;
  lastSeenLabel: string | null;
  /** Whether this login may remove anybody at all. OWNER only. */
  canRemove: boolean;
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
      <li className="rounded-edge border-forest bg-forest/5 border-2 p-5">
        <p className="text-base font-bold">
          {member.pending
            ? `Invitation to ${member.name} revoked`
            : `${member.name} removed`}
        </p>
        <p className="text-forest/80 mt-2 text-sm">
          {member.pending
            ? "The code we sent them no longer works."
            : "Signed out everywhere, now — not at their next sign-in. If their phone is open on this portal, the next thing they tap will ask them to sign in."}
        </p>
      </li>
    );
  }

  return (
    <li className="rounded-edge border-cream-line bg-cream-deep border p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-lg font-bold">{member.name}</p>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {/*
            Every role, not just the strongest. `roles` is plural in the
            contract and a member may hold two — collapsing them to one pill
            would quietly hide half of what somebody has been granted.
          */}
          {member.roles.map((role) => (
            <span
              key={role}
              className="rounded-edge border-cream-line bg-cream label text-forest/75 border px-2.5 py-1"
            >
              {roleLabel(role)}
            </span>
          ))}
          {member.roles.length === 0 ? (
            <span className="label text-forest/60">No role</span>
          ) : null}
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
              `state` is a bare string in the contract with no enum, so it is
              shown rather than interpreted. "active" is the ordinary case and
              says nothing worth the line.
            */}
            {member.state && member.state !== "active" ? (
              <span className="text-terra-deep font-bold">
                {" "}
                · {member.state}
              </span>
            ) : null}
          </>
        )}
      </p>

      {canRemove ? (
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
                  : "Their sessions end immediately — not at their next sign-in. You can invite them again afterwards."}
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-edge dock-target label border-terra-deep text-terra-deep flex-1 border-2 px-5 font-bold disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {pending ? "Removing…" : member.pending ? "Revoke" : "Remove"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={pending}
                  className="rounded-edge dock-target label border-cream-line bg-cream flex-1 border px-5"
                >
                  Back
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-edge dock-target label border-cream-line bg-cream text-forest mt-4 w-full border px-5"
            >
              {member.pending ? "Revoke invitation" : "Remove"}
            </button>
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
