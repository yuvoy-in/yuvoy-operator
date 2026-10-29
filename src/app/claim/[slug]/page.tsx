import type { Metadata } from "next";
import { ClaimScreen } from "../claim-screen";

export const metadata: Metadata = { title: "Claim a listing" };

// Force-dynamic like every page here: see `app/join/(root)/page.tsx`.
export const dynamic = "force-dynamic";

/** The claim link a phone without Yuvoy Host lands on (yuvoy-operator#171). */
export default async function ClaimPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ClaimScreen slug={slug} />;
}
