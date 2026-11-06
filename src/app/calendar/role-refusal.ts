/**
 * Said here, and said by the API. The page already hides the forms from
 * STAFF, but a Server Action is a public POST endpoint and roles change
 * between a render and a tap — `GET /me` is re-read on every action, so this
 * is the role at the moment of the tap. The contract's own 403 stays handled
 * below it, for the day the two disagree.
 */
/*
  ONE sentence for every refusal on this screen — yuvoy-operator#45 item 7.

  Three others were written inline beside it, each opening "Your role cannot
  …": a shape that tells the reader what they are rather than who to ask.
  Capacity, closed dates, reopening and closing a departure are one
  `canManage` gate as far as the API is concerned, so they are one sentence,
  and every one of them now uses this.

  Counter sales are NOT on that list, and this sentence used to say they were.
  The API has never role-gated recording one (`POST /slots/{id}/offline-sales`
  is plain `auth`, and its only 403 is a suspension), and taking one back is
  the same roles on purpose: "the person who mistypes the count is the person
  at the counter" (yuvoy-api#226). The owner confirmed it on 23 Sep 2026:
  everybody signed in may record a counter sale and take one back.
*/
export const ROLE_REFUSAL =
  "Only owners, admins and managers can change seats or close dates.";
