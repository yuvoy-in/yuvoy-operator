import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInForm } from "./sign-in-form";
import { readSessionToken } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Sign in" };

/*
  Never cached and never prerendered: it reads a cookie to decide whether to
  redirect, and a cached sign-in page served to somebody already signed in is
  a dead end they have to work out for themselves.
*/
export const dynamic = "force-dynamic";

/** O2 — daily access for the person running the boat, one hand free. */
export default async function SignInPage() {
  if (await readSessionToken()) redirect("/today");

  return (
    <main className="bg-cream text-forest flex min-h-dvh flex-col">
      <div className="container-page mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-12">
        <p className="eyebrow text-terra-deep">Yuvoy for operators</p>
        <h1 className="font-display tracking-display mt-4 text-4xl leading-[1.05]">
          Sign in
        </h1>
        <p className="text-forest/70 mt-3 text-base">
          No password. We send a code to the number we already have for your
          business.
        </p>
        <SignInForm />
      </div>
    </main>
  );
}
