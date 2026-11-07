import type { Metadata } from "next";
import { claimBanner } from "@/lib/site/host-app";
import { ClaimScreen } from "./claim-screen";

export const metadata: Metadata = {
  title: "Claim a listing",
  itunes: claimBanner(null),
};

// Force-dynamic like every page here: see `app/join/(root)/page.tsx`.
export const dynamic = "force-dynamic";

/**
 * `/claim` with no listing in it: never a 404 (yuvoy-operator#171 case 5).
 * "There is no listing to claim here." and the stores, with nothing to open
 * in the app on any phone (yuvoy-operator#388).
 */
export default function ClaimWithoutSlugPage() {
  return <ClaimScreen slug={null} platform="other" />;
}
