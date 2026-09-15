import type { Metadata } from "next";
import Link from "next/link";
import { requireOperator } from "@/lib/auth/session";
import { Screen } from "@/components/chrome/screen";
import { SignOutButton } from "@/components/chrome/sign-out-button";
import {
  BankIcon,
  BellIcon,
  BriefcaseIcon,
  CheckIcon,
  ChevronRightIcon,
  CoinsIcon,
  ImageIcon,
  StoryIcon,
  UsersIcon,
} from "@/components/ui/icons";
import { panelClass } from "@/components/ui/panel";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

/**
 * Settings — yuvoy-operator#58 item 9.
 *
 * Everything that is set up once and rarely touched, behind the gear on the
 * business profile. One line per row: an icon, a label, a chevron.
 *
 * ## No sentence under any row
 *
 * The profile listed these as doors with a line of explanation each, which made
 * the Business tab a page of prose an operator scrolled past to reach the one
 * thing they came for. A label and a chevron is the whole of what a settings
 * row has ever needed to be.
 *
 * ## A group with nothing in it is not drawn
 *
 * "STAFF see no Money or Team heading." A heading over an empty space is a
 * screen telling somebody what they are not allowed to have, which is the
 * pattern yuvoy-operator#25 §4 removed everywhere else.
 */
export default async function SettingsPage() {
  const { me } = await requireOperator();

  return (
    <Screen
      nav={{ back: { href: "/account", label: "your business" } }}
      stageLabel="Settings"
    >
      <h1 className="font-display tracking-display text-4xl leading-[1.05]">
        Settings
      </h1>

      <Group title="Business">
        <Row href="/profile" icon={BriefcaseIcon} label="Business details" />
        <Row href="/logo" icon={ImageIcon} label="Logo" />
        <Row href="/story" icon={StoryIcon} label="Your story" />
      </Group>

      <Group title="Verification">
        <Row
          href="/account/verification"
          icon={CheckIcon}
          label="Verification"
        />
      </Group>

      <Group title="Notifications">
        {/*
          Not in the issue's table, because the screen did not exist when it was
          written (#46 shipped it). Left out, an operator who turned a switch off
          would have no way back to it: the only other door was the one this
          screen replaced.
        */}
        <Row href="/notifications" icon={BellIcon} label="Notifications" />
      </Group>

      {/*
        Money and Team are OWNER, ADMIN or MANAGER. Every screen behind them
        refuses a staff login, so offering the row would be offering a refusal.
      */}
      {me.canManage ? (
        <Group title="Money">
          <Row href="/earnings" icon={CoinsIcon} label="Earnings" />
          <Row href="/cash" icon={CoinsIcon} label="Cash you've collected" />
          <Row href="/payouts" icon={BankIcon} label="Payout details" />
        </Group>
      ) : null}

      {me.canManage ? (
        <Group title="Team">
          <Row href="/team" icon={UsersIcon} label="Team access" />
        </Group>
      ) : null}

      <Group title="Help">
        {/*
          A telephone number, because the person reading this is on a jetty and
          the answer they need is not on a screen.
        */}
        <Row
          href="tel:+918121657657"
          icon={BriefcaseIcon}
          label="Call Yuvoy"
          external
        />
        <div className="mt-2">
          <SignOutButton />
        </div>
      </Group>
    </Screen>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8" aria-labelledby={`group-${title}`}>
      <h2 id={`group-${title}`} className="label text-forest/75">
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
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  external?: boolean;
}) {
  const inside = (
    <>
      <span className="flex min-w-0 items-center gap-3">
        <Icon className="text-terra-deep size-5 shrink-0" />
        <span className="truncate text-base font-bold">{label}</span>
      </span>
      <ChevronRightIcon className="text-terra-deep size-5 shrink-0" />
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
