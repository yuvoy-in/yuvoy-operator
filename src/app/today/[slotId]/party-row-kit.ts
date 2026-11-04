/**
 * What the two party row test files share (yuvoy-operator#178). Not a test
 * file itself: only `*.test.tsx` files are collected. The mocks stay in each
 * test file, since `vi.mock` is per file.
 */

export const party = {
  bookingId: "bk_1",
  reference: "YV-4K2M9P7Q",
  name: "Asha Menon",
  guests: 2,
  state: "confirmed",
  arrived: false,
};

export const TZ = "Asia/Kolkata";
