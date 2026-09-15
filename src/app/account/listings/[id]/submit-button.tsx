"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { submitListing, type SubmitState } from "./actions";
import { Button } from "@/components/ui/button";

/**
 * Send for review, and Send again — yuvoy-operator#58 item 4.
 *
 * One action behind two labels. On a draft it is the first time anybody at
 * Yuvoy will see it; on a listing that was sent back it is the second, and the
 * operator already knows what was wrong with the first.
 */
export function SubmitButton({
  experienceId,
  label,
}: {
  experienceId: string;
  label: "Send for review" | "Send again";
}) {
  const [state, act, pending] = useActionState<SubmitState, FormData>(
    submitListing,
    {},
  );
  const router = useRouter();

  if (state.done) {
    return (
      <p role="status" className="text-forest/80 text-sm font-bold">
        Sent. Somebody at Yuvoy will look at it.
      </p>
    );
  }

  return (
    <form action={act}>
      <input type="hidden" name="experienceId" value={experienceId} />
      <Button type="submit" block={false} disabled={pending}>
        {pending ? "Sending…" : label}
      </Button>
      {state.message ? (
        <div className="mt-2">
          <p role="alert" className="text-terra-deep text-sm font-bold">
            {state.message}
          </p>
          {/*
            A refusal that names missing fields has one useful next step, and it
            is not reading the list again: it is the form that fills them in.
          */}
          {state.missing && state.missing.length > 0 ? (
            <Button
              variant="secondary"
              block={false}
              className="mt-2"
              onClick={() =>
                router.push(`/account/listings/${experienceId}/edit`)
              }
            >
              Fix it
            </Button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
