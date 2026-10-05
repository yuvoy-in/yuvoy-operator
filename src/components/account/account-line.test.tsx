import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccountLine } from "./account-line";

const LINE = "HDFC0001234 · account ending 4412";

describe("the account on file, as a line", () => {
  it("sets the IFSC as a reference and keeps the rest of the line", () => {
    const { container } = render(
      <p>
        <AccountLine line={LINE} ifsc="HDFC0001234" />
      </p>,
    );
    expect(screen.getByText("HDFC0001234")).toHaveClass(
      "tracking-ref",
      "slashed-zero",
      "tabular-nums",
    );
    expect(container).toHaveTextContent(LINE);
  });

  it("draws the API's own summary whole, with nothing set apart", () => {
    const { container } = render(
      <p>
        <AccountLine line="Account ending in four-four" ifsc={null} />
      </p>,
    );
    expect(container.querySelector("span")).toBeNull();
    expect(container).toHaveTextContent("Account ending in four-four");
  });

  it("never cuts up a line that does not open with the IFSC", () => {
    const { container } = render(
      <p>
        <AccountLine line="HDFC Bank ····4412" ifsc="HDFC0001234" />
      </p>,
    );
    expect(container.querySelector("span")).toBeNull();
    expect(container).toHaveTextContent("HDFC Bank ····4412");
  });
});
