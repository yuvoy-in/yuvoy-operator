import type { Metadata } from "next";
import { requireOperator } from "@/lib/auth/session";
import { listTeam } from "@/lib/team/fetch";
import { lastSeen, removability, splitTeam } from "@/lib/team/members";
import {
  canChangeRole,
  canHold,
  canManageAccess,
  canRestore,
  isHeld,
} from "@/lib/team/access";
import { now } from "@/lib/format/market-time";
import { Empty } from "@/components/ui/states";
import { InviteForm } from "./invite-form";
import { MemberRow } from "./member-row";
import { RoleGuide } from "./role-guide";
import { Screen } from "@/components/chrome/screen";
import { Panel } from "@/components/ui/panel";

export const metadata: Metadata = { title: "Team access" };

/*
  Never prerendered, never cached. This is the answer to "who can get into my
  business right now", and a cached one is a removed skipper still listed — or,
  worse, a removed skipper the owner believes is still listed after they
  removed them.
*/
export const dynamic = "force-dynamic";

/**
 * O5 — a dive shop is not one person.
 *
 * The skipper, the shop manager and the owner need different things, and the
 * reason the difference matters is physical: the crew phone goes out on the
 * boat and gets left on a bench. It should be able to tick people off a
 * manifest and nothing else.
 *
 * Two lists, not one. `GET /team` returns "active people and unaccepted
 * invitations, in one list", and on a pending row `id` is the **invitation**,
 * not a user: different thing, different verb, different consequences.
 *
 * ## Said once, or in Help (yuvoy-operator#88 s16, #80 t4)
 *
 * Each row carried a paragraph describing its role, and the screen closed on
 * four paragraphs under "Why the roles are different". The role is the chip
 * on each row now, what each role may do is one disclosure for the whole list
 * (`RoleGuide`), and the reasons are answers in Help. What removing somebody
 * does is also said in its own confirm, before the tap, which is where it
 * changes a decision.
 */
export default async function TeamPage() {
  const { token, me } = await requireOperator();
  const [team, at] = await Promise.all([listTeam(token), now()]);

  /*
    OWNER or ADMIN, never `canManage`.

    `canManage` is "OWNER, ADMIN or MANAGER" and gates capacity, closed dates,
    earnings and listing edits. Every write on this screen is "OWNER or ADMIN
    only", so gating it on `canManage` would offer a manager controls that fail —
    while teaching them, wrongly, that they may hand out access to somebody
    else's business.

    All four access endpoints and `POST /team` agree on that gate now;
    `DELETE /team/{id}` was the last to widen (yuvoy-api#109). An admin exists
    precisely because an owner may be off the island and cannot be the only
    person who can add somebody.
  */
  /*
    Inviting is refused while suspended; holding, restoring and removing are
    not (yuvoy-operator#50). A suspended business can still take somebody's
    access away and cannot hand new access out.
  */
  const canInvite = canManageAccess(me.roles) && !me.suspension;
  /*
    An admin who is not also an owner. One sentence in the role picker depends on
    it: "an ADMIN who makes somebody an owner cannot change that person's access
    afterwards." Somebody holding both roles keeps the owner's way back, so the
    warning would be false for them.
  */
  const iAmOnlyAdmin =
    me.roles.includes("ADMIN") && !me.roles.includes("OWNER");
  const { people, invitations } = splitTeam(team.people);

  return (
    <Screen nav={{ back: { href: "/account/settings", label: "settings" } }}>
      {/*
        One title (op#80 t2). The eyebrow and the line explaining the screen
        went; what each role may do is the disclosure below, said once.
      */}
      <h1 className="font-display tracking-display text-4xl leading-[1.05]">
        Team access
      </h1>

      {/*
        Said up front, not after a tap. Same call as the request queue, where
        staff are told they cannot answer it before they choose a reason:
        finding out at the end is worse than not being offered it.
      */}
      {/*
        Said up front, not after a tap. Same call as the request queue, where
        staff are told they cannot answer it before they choose a reason:
        finding out at the end is worse than not being offered it.

        "Owner or admin" rather than "the owner" — every one of the four access
        endpoints is OWNER or ADMIN now, and an admin reading "only the owner"
        on a screen full of controls they CAN use would be told something false
        about their own account.
      */}
      {!canInvite ? (
        <Panel className="mt-6 p-4 text-sm">
          Only an owner or an admin can change who is on this account.
        </Panel>
      ) : null}

      <RoleGuide />

      <section className="mt-6" aria-labelledby="people">
        <h2 id="people" className="label text-forest/75">
          {people.length === 1 ? "1 person" : `${people.length} people`}
        </h2>
        {people.length === 0 ? (
          <div className="mt-3">
            <Empty
              title="Nobody is listed"
              body="That should not be possible. An account always has an owner. Message us before you rely on this screen."
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {people.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                removability={removability(
                  member,
                  me.id,
                  me.roles,
                  team.people,
                )}
                lastSeenLabel={lastSeen(member.lastSeenAt, at)}
                held={isHeld(member)}
                canRole={canChangeRole(member, me.id, me.roles)}
                canHoldThem={canHold(member, me.id, me.roles, team.people)}
                canRestoreThem={canRestore(member, me.id, me.roles)}
                iAmOnlyAdmin={iAmOnlyAdmin}
                canSeeNotifications={canManageAccess(me.roles)}
              />
            ))}
          </ul>
        )}
      </section>

      {invitations.length > 0 ? (
        <section className="mt-10" aria-labelledby="invited">
          <h2 id="invited" className="label text-forest/75">
            Invited, not accepted
          </h2>
          {/*
            It said "A code on somebody's phone", and no code has ever reached
            a phone: there is no WhatsApp sender, and an invitation reaches
            anybody only by email, or by the link passed on by hand
            (yuvoy-operator#91). What is true of every row here is what an
            invitation is: a way in that grants nothing until it is used.
          */}
          <p className="text-forest/70 mt-2 text-sm">
            An invitation grants nothing until they accept it with their own
            number, and it expires after seven days.
          </p>
          <ul className="mt-3 space-y-3">
            {invitations.map((invite) => (
              <MemberRow
                key={invite.id}
                member={invite}
                removability={removability(
                  invite,
                  me.id,
                  me.roles,
                  team.people,
                )}
                lastSeenLabel={null}
                held={false}
                canRole={canChangeRole(invite, me.id, me.roles)}
                canHoldThem={canHold(invite, me.id, me.roles, team.people)}
                canRestoreThem={canRestore(invite, me.id, me.roles)}
                iAmOnlyAdmin={iAmOnlyAdmin}
                canSeeNotifications={canManageAccess(me.roles)}
                /*
                  The link, on the row somebody is actually chasing. `joinUrl`
                  is "present only for a caller who can invite", so the server
                  answers that question and this screen does not derive a
                  second opinion from roles.
                */
                joinUrl={team.joinUrl}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {canInvite ? (
        <section className="mt-10" aria-labelledby="invite">
          <h2 id="invite" className="label text-forest/75">
            Add somebody
          </h2>

          {/*
            No join link here any more (yuvoy-operator#25 §1). It sat
            permanently above this form, and the owner cut it: the link appears
            exactly twice now, on the invite receipt and on the pending row of
            whoever has not joined.

            The property that block was protecting is unchanged — an owner does
            NOT have to re-invite to see the link again, which would replace
            the code the invitee is holding. The pending row carries it, which
            is also where somebody chasing an invitation actually looks.
          */}
          <div className="mt-4">
            <InviteForm />
          </div>
        </section>
      ) : null}
    </Screen>
  );
}
