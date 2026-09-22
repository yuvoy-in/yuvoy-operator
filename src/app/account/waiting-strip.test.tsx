import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { WaitingStrip } from "./waiting-strip";

/*
  The strip on the business profile (yuvoy-operator#86 s9): "'2 things
  waiting on you' does not say what they are. Name the two things in the
  strip: 'Add your logo · Complete business details'."
*/
describe("what is waiting on you, on the profile", () => {
  const ITEMS = [
    { text: "Complete your details", href: "/profile" },
    { text: "Add your logo", href: "/logo" },
  ];

  it("counts them, and the count opens the list that explains them", () => {
    render(<WaitingStrip items={ITEMS} />);
    expect(
      screen.getByRole("link", { name: /2 things waiting on you/ }),
    ).toHaveAttribute("href", "/account/verification");
  });

  it("names each one, and each opens where it is fixed", () => {
    render(<WaitingStrip items={ITEMS} />);
    const rows = within(screen.getByRole("list")).getAllByRole("link");
    expect(rows.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Complete your details", "/profile"],
      ["Add your logo", "/logo"],
    ]);
  });

  it("says one thing, not one things", () => {
    render(<WaitingStrip items={[ITEMS[1]]} />);
    expect(
      screen.getByRole("link", { name: /^1 thing waiting on you/ }),
    ).toBeInTheDocument();
  });

  it("draws nothing when nothing is waiting", () => {
    const { container } = render(<WaitingStrip items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
