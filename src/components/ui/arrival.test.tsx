import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Arrival } from "./arrival";

/*
  A block the server draws once something has happened (the called-off
  banner, O06 B): faded in when it appears while the screen is open, simply
  there when the screen opens with it.
*/
describe("a block that arrives", () => {
  it("is simply there when the screen opens with it", () => {
    render(
      <Arrival when className="mt-6">
        <p>This departure is called off</p>
      </Arrival>,
    );
    const block = screen.getByText(
      "This departure is called off",
    ).parentElement!;
    expect(block).toHaveClass("mt-6");
    expect(block).not.toHaveClass("motion-in");
    expect(block).not.toHaveAttribute("data-motion");
  });

  it("fades in when it appears while the screen is open", () => {
    const { rerender } = render(
      <Arrival when={false} className="mt-6">
        <p>This departure is called off</p>
      </Arrival>,
    );
    expect(screen.queryByText("This departure is called off")).toBeNull();
    rerender(
      <Arrival when className="mt-6">
        <p>This departure is called off</p>
      </Arrival>,
    );
    const block = screen.getByText(
      "This departure is called off",
    ).parentElement!;
    expect(block).toHaveClass("mt-6", "motion-in");
    expect(block).toHaveAttribute("data-motion");
  });

  it("goes when it is no longer true", () => {
    const { rerender } = render(
      <Arrival when>
        <p>Off</p>
      </Arrival>,
    );
    rerender(
      <Arrival when={false}>
        <p>Off</p>
      </Arrival>,
    );
    expect(screen.queryByText("Off")).toBeNull();
  });
});
