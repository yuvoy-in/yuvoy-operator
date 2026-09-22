import type { Metadata } from "next";
import { requireOperator } from "@/lib/auth/session";
import { HELP } from "@/lib/help";
import { helpSections } from "@/lib/help/sections";
import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "@/lib/site/contact";
import { Screen } from "@/components/chrome/screen";
import { PhoneIcon } from "@/components/ui/icons";
import { panelClass } from "@/components/ui/panel";
import { HelpTopics } from "./help-topics";
import { OpenFromHash } from "./open-from-hash";

export const metadata: Metadata = { title: "Help" };
export const dynamic = "force-dynamic";

/**
 * Help, behind the gear: yuvoy-operator#80 t4.
 *
 * "Cut every sentence that explains what the screen is. Keep only the sentence
 * that changes a decision ... Move the rest into a single help entry under the
 * gear." This is that entry. Every explanation that came off a screen is a
 * question here, and a screen links to one only where the idea is genuinely not
 * obvious (`helpHref`), so the reason is one tap away instead of scrolled past
 * every morning.
 *
 * It reads nothing from the API, and still asks who is signed in: it sits
 * behind the session like every screen under Settings.
 */
export default async function HelpPage() {
  await requireOperator();
  const sections = helpSections(HELP);

  return (
    <Screen nav={{ back: { href: "/account/settings", label: "settings" } }}>
      <h1 className="font-display tracking-display text-4xl leading-[1.05]">
        Help
      </h1>

      <HelpTopics sections={sections} />
      <OpenFromHash />

      {/*
        The way out when the answer is not here. A telephone number, because
        the person reading this is on a jetty and a person is who they need.
      */}
      <a
        href={SUPPORT_PHONE_HREF}
        className={panelClass(
          "raised",
          "ease-interaction hover:bg-paper mt-10 flex items-center justify-between gap-3 px-4 py-3 transition-colors duration-200",
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          <PhoneIcon className="text-terra-deep size-5 shrink-0" />
          <span className="text-base font-bold">Call Yuvoy</span>
        </span>
        <span className="text-forest/80 text-sm whitespace-nowrap tabular-nums">
          {SUPPORT_PHONE}
        </span>
      </a>
    </Screen>
  );
}
