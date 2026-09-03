import type { Metadata } from "next";
import { requireOperator } from "@/lib/auth/session";
import { listTeam } from "@/lib/team/fetch";
import { lastSeen, removability, splitTeam } from "@/lib/team/members";
import { now } from "@/lib/format/market-time";
import { Empty } from "@/components/ui/states";
import { InviteForm } from "./invite-form";
import { MemberRow } from "./member-row";
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
 * not a user — different thing, different verb, different consequences.
 */
export default async function TeamPage() {
  const { token, me } = await requireOperator();
  const [team, at] = await Promise.all([listTeam(token), now()]);

  /*
    OWNER, not `canManage`.

    `canManage` is "OWNER or MANAGER" and gates capacity, closed dates,
    earnings and listing edits. `POST /team` and `DELETE /team/{id}` are both
    403 "OWNER only", and gating this screen on `canManage` would offer a
    manager an invite form that fails — while teaching them, wrongly, that they
    are allowed to hand out access to somebody else's business.
  */
  const isOwner = me.roles.includes("OWNER");
  const { people, invitations } = splitTeam(team);

  return (
    <Screen
      nav={{ back: { href: "/account", label: "your business" } }}
      stageLabel="Team access"
    >
      <p className="eyebrow text-terra-deep">Your account</p>
      <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
        Team access
      </h1>
      <p className="text-forest/70 mt-3 text-base">
        Who can get into this business, and what each of them can do.
      </p>

      {/*
        Said up front, not after a tap. Same call as the request queue, where
        staff are told they cannot answer it before they choose a reason:
        finding out at the end is worse than not being offered it.
      */}
      {!isOwner ? (
        <Panel className="mt-6 p-4 text-sm">
          Only the owner can add or remove people. You can see who is on the
          account.
        </Panel>
      ) : null}

      <section className="mt-8" aria-labelledby="people">
        <h2 id="people" className="label text-forest/75">
          {people.length === 1 ? "1 person" : `${people.length} people`}
        </h2>
        {people.length === 0 ? (
          <div className="mt-3">
            <Empty
              title="Nobody is listed"
              body="That should not be possible — an account always has an owner. Message us before you rely on this screen."
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {people.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                removability={removability(member, me.id, team)}
                lastSeenLabel={lastSeen(member.lastSeenAt, at)}
                canRemove={isOwner}
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
          <p className="text-forest/70 mt-2 text-sm">
            A code on somebody&rsquo;s phone. It grants nothing until they use
            it, and it expires after seven days.
          </p>
          <ul className="mt-3 space-y-3">
            {invitations.map((invite) => (
              <MemberRow
                key={invite.id}
                member={invite}
                removability={removability(invite, me.id, team)}
                lastSeenLabel={null}
                canRemove={isOwner}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {isOwner ? (
        <section className="mt-10" aria-labelledby="invite">
          <h2 id="invite" className="label text-forest/75">
            Add somebody
          </h2>
          <div className="mt-4">
            <InviteForm />
          </div>
        </section>
      ) : null}

      <section className="mt-12" aria-labelledby="why">
        <h2 id="why" className="label text-forest/75">
          Why the roles are different
        </h2>
        <Panel className="mt-3">
          <p className="text-sm">
            The crew phone goes out on the boat and gets left on a bench. It
            should be able to tick people off a manifest and nothing else.
          </p>
          <p className="text-forest/80 mt-3 text-sm">
            Payout details and this list are the owner&rsquo;s alone. A stolen
            manager login plus one convincing phone call is otherwise enough to
            redirect a season&rsquo;s takings.
          </p>
          <p className="text-forest/80 mt-3 text-sm">
            Removing somebody ends their sessions immediately — on their next
            tap, not at their next sign-in. That is the difference between
            &ldquo;we removed them&rdquo; and &ldquo;we removed them a fortnight
            from now&rdquo;, and the reason somebody is removed in a hurry is
            usually that the fortnight matters.
          </p>
        </Panel>
      </section>
    </Screen>
  );
}
