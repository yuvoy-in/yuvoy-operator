import { describe, it, expect } from "vitest";
import {
  ACCEPT_ATTRIBUTE,
  MAX_FILE_BYTES,
  documentCount,
  fileLine,
  fileProblem,
  takesFile,
  uploadFailure,
} from "./documents";

describe("how many required documents are verified", () => {
  it("says the count the API gave, not one it counted itself", () => {
    /*
      `requiredDocuments` exists "so a screen can say '5 of 6' rather than guess
      the 6", and the 6 is not guessable: it grows when a listing in a new
      category is approved. A portal counting its own rows would answer a
      different question.
    */
    expect(
      documentCount([
        { type: "insurance", satisfied: true },
        { type: "boat", satisfied: true },
        { type: "oxygen", satisfied: false },
      ]),
    ).toBe("2 of 3 required documents are verified");
  });

  it("says nothing at all when nothing is required", () => {
    // "0 of 0 verified" reads as a fault rather than as an absence.
    expect(documentCount([])).toBeNull();
  });
});

describe("the file behind a document", () => {
  it("is named when we hold one", () => {
    expect(fileLine({ hasFile: true, filename: "insurance-2026.pdf" })).toBe(
      "insurance-2026.pdf",
    );
  });

  it("says so plainly when we hold none", () => {
    expect(fileLine({ hasFile: false, filename: "" })).toBe("No file sent");
    expect(fileLine({})).toBe("No file sent");
  });

  it("trusts the flag over the name", () => {
    /*
      A name with no flag is a response disagreeing with itself, and showing the
      name would tell an operator we hold a file we may not.
    */
    expect(fileLine({ filename: "insurance-2026.pdf" })).toBe("No file sent");
    // And a flag with no name still says we hold something.
    expect(fileLine({ hasFile: true })).toBe("A file is on record");
  });

  it("is said from our side for a verified document we hold no file for", () => {
    /*
      yuvoy-operator#93. We verified it, so the gap is ours: "No file sent"
      would read as the operator's omission.
    */
    expect(fileLine({ state: "verified", hasFile: false })).toBe(
      "We hold no file for it",
    );
    // Pending with no file is still simply unsent, and an absent flag on a
    // verified row is not an accusation (an older API sends none).
    expect(fileLine({ state: "pending", hasFile: false })).toBe("No file sent");
    expect(fileLine({ state: "verified" })).toBe("No file sent");
  });

  it("is not offered on a verified document with none either, because the API refuses it", () => {
    /*
      The review asked for "Send the file" on a verified document with no file
      (#93). The pinned API answers the operator's upload with
      `409 document_locked` for any state but pending; only our staff attach a
      file to a verified document (D56). A control there would be one the API
      refuses, so the row asks for a copy by the route that can take it.
    */
    expect(takesFile("verified")).toBe(false);
  });

  it("is only offered on a document nobody has decided yet", () => {
    /*
      "Once somebody at Yuvoy has verified or rejected a document, a new file
      behind it would change the evidence under a decision nobody re-made."
      Withheld rather than offered and answered `409 document_locked`.
    */
    expect(takesFile("pending")).toBe(true);
    for (const state of ["verified", "rejected", "expired", undefined]) {
      expect(takesFile(state), String(state)).toBe(false);
    }
  });
});

describe("what may be sent, checked before anything is uploaded", () => {
  const pdf = { name: "a.pdf", size: 1_000, type: "application/pdf" };

  it("takes a PDF, a JPEG and a PNG", () => {
    expect(fileProblem(pdf)).toBeNull();
    expect(fileProblem({ ...pdf, type: "image/jpeg" })).toBeNull();
    expect(fileProblem({ ...pdf, type: "image/png" })).toBeNull();
  });

  it("refuses over 10 MB BEFORE the upload, not after it", () => {
    /*
      Not politeness. "The size and the kind are signed into the URL, so the
      bucket itself refuses a file of any other length" — so an oversized file
      is uploaded in full over an island connection and then turned away.
    */
    expect(fileProblem({ ...pdf, size: MAX_FILE_BYTES + 1 })).toMatch(
      /over 10 MB/,
    );
    expect(fileProblem({ ...pdf, size: MAX_FILE_BYTES })).toBeNull();
  });

  it("names the three kinds rather than saying 'unsupported'", () => {
    // An operator holding a HEIC from an iPhone can act on "send a PDF, a JPEG
    // or a PNG" and cannot act on "not a supported type".
    expect(fileProblem({ ...pdf, type: "image/heic" })).toBe(
      "Send a PDF, a JPEG or a PNG.",
    );
  });

  it("refuses an empty file, which is a picker mistake rather than a document", () => {
    expect(fileProblem({ ...pdf, size: 0 })).toMatch(/empty/);
  });

  it("offers the picker exactly those three", () => {
    expect(ACCEPT_ATTRIBUTE).toBe("application/pdf,image/jpeg,image/png");
  });
});

describe("when sending the file fails", () => {
  it("gives a different next step for each code", () => {
    /*
      Four codes, four different things to do: send it again, start again, file
      the document again, or nothing. One sentence for all of them would lose
      the only actionable part.
    */
    expect(uploadFailure("upload_not_arrived", "x")).toMatch(/Send it again/);
    expect(uploadFailure("upload_closed", "x")).toMatch(/start a new one/);
  });

  it("renders the server's own sentence where it knows more than we do", () => {
    // `document_locked` says whether it was verified or rejected, and
    // `document_refused` says which of three things was wrong with the file.
    expect(
      uploadFailure("document_locked", "This was verified on 3 Sep."),
    ).toBe("This was verified on 3 Sep.");
    expect(uploadFailure("document_refused", "That is not a PDF.")).toBe(
      "That is not a PDF.",
    );
  });

  it("never renders an empty message", () => {
    expect(uploadFailure("something_new", "")).toBe(
      "The file was not sent. Try again.",
    );
  });
});
