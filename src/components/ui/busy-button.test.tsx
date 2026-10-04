import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Button } from "./button";

/*
  A Button that can be pending (O04 A, approved 4 Oct 2026). It used to be
  `disabled` while its action ran, which faded the button just pressed to
  55% and dropped focus onto the page. These pin what replaced that: full
  colour, focusable, busy in words, a second tap refused by the button
  itself, and the words cross-fading to the working verb and back.
*/

function save(pending: boolean, onClick = vi.fn()) {
  return (
    <Button pending={pending} pendingLabel="Saving" onClick={onClick}>
      Set seats
    </Button>
  );
}

describe("a button that can be pending", () => {
  it("is an ordinary button while it is not working", () => {
    const onClick = vi.fn();
    render(save(false, onClick));
    const button = screen.getByRole("button", { name: "Set seats" });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button).not.toHaveAttribute("aria-disabled");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keeps its colour and its focus while it works, and says it is busy", () => {
    const { rerender } = render(save(false));
    const button = screen.getByRole("button", { name: "Set seats" });
    button.focus();

    rerender(save(true));
    const busy = screen.getByRole("button", { name: "Saving" });
    expect(busy).toBe(button);
    // Not `disabled`: that is what faded it and dropped focus onto the page.
    expect(busy).not.toBeDisabled();
    expect(busy).toHaveFocus();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).toHaveAttribute("aria-disabled", "true");
  });

  it("refuses a second tap itself, so its form is not sent twice", () => {
    const onSubmit = vi.fn((event: Event) => event.preventDefault());
    const onClick = vi.fn();
    render(
      <form onSubmit={(event) => onSubmit(event.nativeEvent)}>
        <input aria-label="Seats" defaultValue="8" />
        <Button type="submit" pending pendingLabel="Saving" onClick={onClick}>
          Set seats
        </Button>
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Saving" }));
    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the waiting ring only while it works, and hides it from a screen reader", () => {
    const { rerender, container } = render(save(false));
    expect(container.querySelector(".motion-busy-ring")).toBeNull();
    rerender(save(true));
    const ring = container.querySelector(".motion-busy-ring");
    expect(ring).not.toBeNull();
    expect(ring).toHaveAttribute("aria-hidden", "true");
    // It ships its own reduced version: held still, not deleted.
    expect(ring).toHaveAttribute("data-motion");
    rerender(save(false));
    expect(container.querySelector(".motion-busy-ring")).toBeNull();
  });

  it("does not animate the words it was first drawn with", () => {
    const { container } = render(save(false));
    expect(container.querySelector(".motion-in")).toBeNull();
    expect(container.querySelector(".motion-out")).toBeNull();
  });

  it("keeps a caller's own aria-disabled while it is not working", () => {
    render(
      <Button pending={false} aria-disabled="true">
        Send
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Send" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("goes busy without changing its words when it has no working verb", () => {
    const { container } = render(<Button pending>Download</Button>);
    expect(screen.getByRole("button", { name: "Download" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(container.querySelector(".motion-out")).toBeNull();
  });
});

describe("the words, as they change", () => {
  /*
    jsdom has no layout, so where the words sit is given on the prototype
    for this block: the idle words at 20px, the working ones at 34px (an
    inline button grows as its words do).
  */
  const saved: Record<string, PropertyDescriptor | undefined> = {};
  beforeEach(() => {
    for (const key of ["offsetLeft", "offsetTop"]) {
      saved[key] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key);
    }
    Object.defineProperties(HTMLElement.prototype, {
      offsetLeft: {
        configurable: true,
        get(this: HTMLElement) {
          return this.textContent === "Set seats" ? 20 : 34;
        },
      },
      offsetTop: {
        configurable: true,
        get() {
          return 18;
        },
      },
    });
  });
  afterEach(() => {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor)
        Object.defineProperty(HTMLElement.prototype, key, descriptor);
      else
        delete (HTMLElement.prototype as unknown as Record<string, unknown>)[
          key
        ];
    }
  });

  it("cross-fades to the working verb: the old words leave where they stood", () => {
    const { rerender, container } = render(save(false));
    rerender(save(true));

    const leaving = container.querySelector(".motion-out");
    expect(leaving).not.toBeNull();
    expect(leaving).toHaveAttribute("aria-hidden", "true");
    expect(leaving).toHaveTextContent("Set seats");
    // Drawn where the old words were, read before the commit moved them.
    const words = leaving!.firstElementChild as HTMLElement;
    expect(words.style.left).toBe("20px");
    expect(words.style.top).toBe("18px");

    const arriving = container.querySelector(".motion-in");
    expect(arriving).toHaveTextContent("Saving");
    // The button's name is the new words alone.
    expect(screen.getByRole("button")).toHaveAccessibleName("Saving");
  });

  it("lets the old words go once they have faded, and cross-fades back", () => {
    vi.useFakeTimers();
    const { rerender, container } = render(save(false));
    rerender(save(true));
    act(() => vi.advanceTimersByTime(150));
    // Still fading at 150ms: let go a breath after the fade has ended.
    expect(container.querySelector(".motion-out")).not.toBeNull();
    act(() => vi.advanceTimersByTime(50));
    expect(container.querySelector(".motion-out")).toBeNull();
    expect(container.querySelector(".motion-in")).toBeNull();
    vi.useRealTimers();

    rerender(save(false));
    const leaving = container.querySelector(".motion-out");
    expect(leaving).toHaveTextContent("Saving");
    expect((leaving!.firstElementChild as HTMLElement).style.left).toBe("34px");
    expect(container.querySelector(".motion-in")).toHaveTextContent(
      "Set seats",
    );
  });

  it("starts again from the new words when it changes twice inside a fade", () => {
    const { rerender, container } = render(save(false));
    rerender(save(true));
    rerender(save(false));
    const leaving = container.querySelectorAll(".motion-out");
    expect(leaving).toHaveLength(1);
    expect(leaving[0]).toHaveTextContent("Saving");
  });
});
