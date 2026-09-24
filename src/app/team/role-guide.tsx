import Link from "next/link";
import { OPERATOR_ROLES, describeRole } from "@/lib/team/roles";
import { helpHref } from "@/lib/help";
import { ChevronRightIcon } from "@/components/ui/icons";
import { panelClass } from "@/components/ui/panel";

/**
 * What each role may do, said once for the whole list: yuvoy-operator#88 s16.
 *
 * "Each person carries a paragraph describing their role ... Put the role in
 * the chip that is already there and show the permission list once, under a
 * 'What each role can do' link." Closed until asked: an owner reads it the
 * first time they hand out a role, and scrolls past it every time after.
 *
 * The words are `describeRole`'s, the same ones the role picker shows beside
 * each choice, so the two can never disagree about what a manager may do.
 * Every claim there is taken from the contract.
 *
 * The screen closed on four paragraphs under "Why the roles are different".
 * Those are an answer in Help now (#80 t4), one tap from the guide rather than
 * scrolled past every time somebody opens this screen.
 */
export function RoleGuide() {
  return (
    <details className="group mt-4">
      <summary className="text-forest/80 hover:text-forest inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm underline underline-offset-4 [&::-webkit-details-marker]:hidden">
        What each role can do
        <ChevronRightIcon className="ease-interaction size-4 shrink-0 transition-transform duration-200 group-open:rotate-90" />
      </summary>
      <dl className={panelClass("raised", "mt-2 space-y-4 text-sm")}>
        {OPERATOR_ROLES.map((role) => {
          const described = describeRole(role);
          if (!described) return null;
          return (
            <div key={role}>
              <dt className="font-bold">{described.label}</dt>
              <dd className="text-forest/80 mt-1">
                {described.can}
                {described.cannot ? (
                  <span className="text-forest/70"> {described.cannot}</span>
                ) : null}
              </dd>
            </div>
          );
        })}
      </dl>
      <Link
        href={helpHref("why-roles-differ", "/team")}
        className="text-forest/80 hover:text-forest mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4"
      >
        Why the roles are different
      </Link>
    </details>
  );
}
