"use client";

import { useState } from "react";
import type { OnFile } from "@/lib/account/bank";
import { Button } from "@/components/ui/button";
import { panelClass } from "@/components/ui/panel";
import { BankForm } from "./bank-form";

/**
 * What is on file, as text, with one Change button: yuvoy-operator#87 s14.
 *
 * "The form arrives half filled: IFSC shows HDFC0001234, the account number
 * is empty ... A half-filled form leaves an operator unsure whether their
 * details are saved." So the account is shown as what it is, a fact, and the
 * form exists only after Change, empty. With nothing on file there is nothing
 * to show first, and the form is drawn straight away.
 *
 * `refusal` is decided on the server from who is asking and what is in flight,
 * and it is said INSTEAD of the button: a Change that would be refused is not
 * offered (only an owner may raise one, not while suspended, and never a
 * second while one is open).
 */
export function PayoutDetails({
  onFile,
  refusal,
}: {
  onFile: OnFile | null;
  refusal: string | null;
}) {
  const [changing, setChanging] = useState(false);
  /*
    Closing the form unmounts the field that had focus. Focus goes back to the
    Change button it came from, rather than to the top of the page, so a
    screen reader and a keyboard both land where they started. Only after a
    close: on arrival nothing is focused, and no keyboard opens by itself.
  */
  const [closed, setClosed] = useState(false);

  if (!onFile) {
    return (
      <div className="mt-8">
        {refusal ? (
          <p className="text-forest/80 text-sm">{refusal}</p>
        ) : (
          <BankForm />
        )}
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div
        className={panelClass(
          "raised",
          "flex flex-wrap items-center justify-between gap-x-4 gap-y-3",
        )}
      >
        <div className="min-w-0">
          <p className="label text-forest/75">Account on file</p>
          <p className="mt-1.5 text-base font-bold wrap-break-word">
            {onFile.line}
          </p>
          {onFile.bankName ? (
            <p className="text-forest/70 mt-0.5 text-sm">{onFile.bankName}</p>
          ) : null}
        </div>
        {!refusal && !changing ? (
          <Button
            autoFocus={closed}
            variant="secondary"
            size="md"
            block={false}
            onClick={() => setChanging(true)}
          >
            Change
          </Button>
        ) : null}
      </div>

      {refusal ? (
        <p className="text-forest/80 mt-3 text-sm">{refusal}</p>
      ) : changing ? (
        <div className="mt-6">
          <BankForm
            autoFocus
            onCancel={() => {
              setClosed(true);
              setChanging(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
