import type { Metadata } from "next";
import { claimBanner } from "@/lib/site/host-app";
import { visitorPlatform } from "@/lib/site/visitor-platform";
import { ClaimScreen } from "../claim-screen";

// Force-dynamic like every page here: see `app/join/(root)/page.tsx`.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

/** The Smart App Banner hands Yuvoy Host this listing's claim link. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: "Claim a listing", itunes: claimBanner(slug) };
}

/** The claim link a phone without Yuvoy Host lands on (yuvoy-operator#171). */
export default async function ClaimPage({ params }: Props) {
  const { slug } = await params;
  const platform = await visitorPlatform();
  return <ClaimScreen slug={slug} platform={platform} />;
}
