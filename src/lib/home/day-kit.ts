/**
 * What the two day test files share (yuvoy-operator#178). Not a test file
 * itself: only `*.test.ts` files are collected.
 */
import type { Manifest } from "@/lib/day/types";

export function manifest(parties: Manifest["parties"]): Manifest {
  return { slotId: "slot_1", parties };
}
