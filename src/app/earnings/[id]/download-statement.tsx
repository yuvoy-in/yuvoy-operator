"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { downloadStatement } from "./actions";

/**
 * The only control on the earnings screens (yuvoy-operator#47 item 7).
 *
 * The bytes come from a Server Action, because `/operator/v1` refuses CORS and
 * the session is an httpOnly cookie the browser cannot read. So the save is
 * assembled here from a string the server already fetched and verified.
 *
 * ## The object URL is revoked, and that is not tidiness
 *
 * A statement is a list of a business's bookings and what each paid. An
 * un-revoked blob URL keeps that in memory for the life of the document and
 * stays fetchable from the page, which on a shared back-office laptop is the
 * kind of thing that outlives the person who downloaded it.
 */
export function DownloadStatement({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);

  function save() {
    setFailure(null);
    start(async () => {
      const result = await downloadStatement(id);
      if (!result.ok) {
        setFailure(result.message);
        return;
      }

      /*
        `text/csv` with a BOM-free UTF-8 body, which is what the API sends. No
        BOM is added: the file's sha256 was verified against the server's on the
        way through, and prepending a byte would break the guarantee the header
        exists to provide.
      */
      const url = URL.createObjectURL(
        new Blob([result.csv], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <div className="mt-6">
      <Button variant="outline" disabled={pending} onClick={save}>
        {pending ? "Preparing…" : "Download statement"}
      </Button>
      {failure ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
