import type { Metadata } from "next";
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { requireOperator } from "@/lib/auth/session";
import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "@/lib/site/contact";
import { Screen } from "@/components/chrome/screen";
import { SignOutButton } from "@/components/chrome/sign-out-button";
import {
  BellIcon,
  BriefcaseIcon,
  CheckIcon,
  ChevronRightIcon,
  HelpIcon,
  ImageIcon,
  PhoneIcon,
  StoryIcon,
  UsersIcon,
} from "@/components/ui/icons";
import { panelClass } from "@/components/ui/panel";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

/**
 * Settings: yuvoy-operator#58 item 9, regrouped by #88 s12.
 *
 * Everything that is set up once and rarely touched, behind the gear on the
 * business profile. One line per row: an icon, a label, a chevron.
 *
 * ## A group only where there are two or more rows
 *
 * "Three groups exist to hold one row each, and the group heading repeats the
 * row: VERIFICATION → Verification, NOTIFICATIONS → Notifications, TEAM → Team
 * access. It doubles the length of the screen and makes the groups
 * meaningless." So Business keeps its heading over three rows, Help over
 * three, and Verification, Notifications and Team access are plain rows.
 *
 * ## Money is not here
 *
 * It is a tab of its own (yuvoy-operator#96): Earnings, Cash and Payout
 * details are reached from Money, and a second way in from here would be two
 * doors to one room.
 *
 * ## No sentence under any row
 *
 * The profile listed these as doors with a line of explanation each, which made
 * the Business tab a page of prose an operator scrolled past to reach the one
 * thing they came for. The explanations are in Help, one row down the list.
 */
export default async function SettingsPage() {
  const { me } = await requireOperator();

  return (
    <Screen nav={{ back: { href: "/account", label: "your business" } }}>
      <h1 className="font-display tracking-display text-4xl leading-[1.05]">
        Settings
      </h1>

      <Group title="Business">
        <Row href="/profile" icon={BriefcaseIcon} label="Business details" />
        <Row href="/logo" icon={ImageIcon} label="Logo" />
        <Row href="/story" icon={StoryIcon} label="Your story" />
      </Group>

      <div className="mt-8 space-y-2">
        <Row
          href="/account/verification"
          icon={CheckIcon}
          label="Verification"
        />
        <Row href="/notifications" icon={BellIcon} label="Notifications" />
        {/*
          OWNER, ADMIN or MANAGER, as it was. A staff login is not offered the
          team's controls; the screen would only tell them they cannot change
          it.
        */}
        {me.canManage ? (
          <Row href="/team" icon={UsersIcon} label="Team access" />
        ) : null}
      </div>

      <Group title="Help">
        <Row href="/account/help" icon={HelpIcon} label="Help" />
        {/*
          A telephone number, because the person reading this is on a jetty and
          the answer they need is not on a screen. The number itself stands
          where the chevron would: this row does not open a screen, it dials.
        */}
        <Row
          href={SUPPORT_PHONE_HREF}
          icon={PhoneIcon}
          label="Call Yuvoy"
          external
          trailing={
            <span className="text-forest/80 text-sm whitespace-nowrap tabular-nums">
              {SUPPORT_PHONE}
            </span>
          }
        />
        <div className="mt-2">
          <SignOutButton />
        </div>
      </Group>
    </Screen>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = `group-${title.toLowerCase()}`;
  return (
    <section className="mt-8" aria-labelledby={id}>
      <h2 id={id} className="label text-forest/75">
        {title}
      </h2>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

function Row({
  href,
  icon: Icon,
  label,
  external,
  trailing,
}: {
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  external?: boolean;
  /** What stands at the right edge instead of the chevron. */
  trailing?: ReactNode;
}) {
  const inside = (
    <>
      <span className="flex min-w-0 items-center gap-3">
        <Icon className="text-terra-deep size-5 shrink-0" />
        <span className="truncate text-base font-bold">{label}</span>
      </span>
      {trailing ?? (
        <ChevronRightIcon className="text-terra-deep size-5 shrink-0" />
      )}
    </>
  );
  const className = panelClass(
    "raised",
    "ease-interaction hover:bg-paper flex items-center justify-between gap-3 px-4 py-3 transition-colors duration-200",
  );

  /*
    A `tel:` is not a route, so it is an anchor rather than a `Link`: Next would
    try to prefetch it, and `pnpm qa` fails a `Link` to a path that is not a
    route in this app.
  */
  return external ? (
    <a href={href} className={className}>
      {inside}
    </a>
  ) : (
    <Link href={href} className={className}>
      {inside}
    </Link>
  );
}
