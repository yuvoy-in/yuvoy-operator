import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EASE } from "@/lib/motion";
import { watchMotion } from "@/lib/motion/testing";
import { useStillConfirm, type ConfirmLook } from "./use-still-confirm";

/*
  O06 B, "Still" (approved 4 Oct 2026; yuvoy/motion-lab,
  experiments/o06-named-confirm.js), the treatment every named confirm
  shares: the confirm fades in where the words were (150ms, enter); put away,
  it leaves as a held copy fading out (150ms, exit) while the words fade back;
  the receipt fades in; under reduced motion each fade takes 120ms.
*/

function Control({
  look,
  enter,
  attempt = 0,
}: {
  look: ConfirmLook;
  enter?: boolean;
  /** A remount of the same look, as a refused form is keyed. */
  attempt?: number;
}) {
  const { root, frame } = useStillConfirm(look, { enter });
  if (look === "none") return frame(null);
  if (look.startsWith("receipt")) {
    return frame(
      <p ref={root} role="status">
        Asha Menon removed
      </p>,
    );
  }
  if (look.startsWith("confirm")) {
    return frame(
      <form key={attempt} ref={root} aria-label={`Question ${look}`}>
        <p id="question">Remove Asha Menon?</p>
        <label>
          <input type="radio" name="why" value="left" defaultChecked /> Left
        </label>
        <button type="submit">Remove</button>
      </form>,
    );
  }
  return frame(
    <div ref={root} data-testid="words">
      <button type="button">Remove</button>
    </div>,
  );
}

function reduce(on: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: on && query === "(prefers-reduced-motion: reduce)",
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
  );
}

let motion: ReturnType<typeof watchMotion>;
beforeEach(() => {
  motion = watchMotion();
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal("innerWidth", 390);
});
afterEach(() => {
  motion.restore();
  vi.unstubAllGlobals();
});

describe("a named confirm, arriving and leaving still", () => {
  it("fades nothing on the first paint", () => {
    render(<Control look="text" />);
    expect(motion.played).toHaveLength(0);
  });

  it("fades the confirm in where the words were: 150ms on the interaction curve", () => {
    const { rerender } = render(<Control look="text" />);
    rerender(<Control look="confirm" />);
    const fade = motion.fadeOf(screen.getByRole("form"));
    expect(fade?.options).toMatchObject({
      duration: 150,
      delay: 0,
      easing: EASE.interaction,
      fill: "backwards",
    });
    // Opening leaves no copy of anything: the words simply go.
    expect(motion.copies()).toHaveLength(0);
  });

  it("puts the confirm away as a held copy fading out over the words that are back", () => {
    const { rerender } = render(<Control look="text" />);
    rerender(<Control look="confirm" />);
    rerender(<Control look="text" />);

    // The real change landed at once: the words are back, and fade in.
    expect(screen.queryByRole("form")).toBeNull();
    expect(motion.fadeOf(screen.getByTestId("words"))).toBeDefined();

    // The confirm as it was, as a picture only.
    const [copy] = motion.copies();
    expect(copy).toHaveTextContent("Remove Asha Menon?");
    expect(copy.inert).toBe(true);
    expect(copy.parentElement).toHaveAttribute("aria-hidden", "true");
    expect(copy.querySelectorAll("[id], [name]")).toHaveLength(0);
    expect(copy.querySelector("button")).toHaveAttribute("tabindex", "-1");
    expect((copy.querySelector("input") as HTMLInputElement).checked).toBe(
      true,
    );
    expect(motion.exitOf(copy)?.options).toMatchObject({
      duration: 150,
      easing: EASE.exit,
      fill: "forwards",
    });
  });

  it("lets a confirm end in its receipt with no copy: the receipt fades in", () => {
    const { rerender } = render(<Control look="text" />);
    rerender(<Control look="confirm" />);
    rerender(<Control look="receipt" />);
    expect(motion.fadeOf(screen.getByRole("status"))).toBeDefined();
    expect(motion.copies()).toHaveLength(0);
  });

  it("fades a second receipt in after the first", () => {
    const { rerender } = render(<Control look="receipt:paused" />);
    rerender(<Control look="receipt:resumed" />);
    expect(motion.fadeOf(screen.getByRole("status"))).toBeDefined();
  });

  it("cross-fades one confirm into another", () => {
    const { rerender } = render(<Control look="confirm:stop" />);
    rerender(<Control look="confirm:off" />);
    expect(
      motion.fadeOf(screen.getByRole("form", { name: "Question confirm:off" })),
    ).toBeDefined();
    expect(motion.copies()).toHaveLength(1);
  });

  it("does not fade a remount of the look it already shows", () => {
    const { rerender } = render(<Control look="confirm" />);
    rerender(<Control look="confirm" attempt={1} />);
    expect(motion.played).toHaveLength(0);
  });

  it("takes a copy still fading away when the confirm opens again", () => {
    const { rerender } = render(<Control look="confirm" />);
    rerender(<Control look="text" />);
    expect(motion.copies()).toHaveLength(1);
    rerender(<Control look="confirm" />);
    expect(motion.copies()).toHaveLength(0);
  });

  it("takes a copy still fading away when the control goes", () => {
    const { rerender, unmount } = render(<Control look="confirm" />);
    rerender(<Control look="text" />);
    expect(motion.copies()).toHaveLength(1);
    unmount();
    expect(motion.copies()).toHaveLength(0);
  });

  it("clips the copy to the sheet it was in when nothing took its place", () => {
    const { rerender } = render(
      <div style={{ overflowY: "auto" }}>
        <Control look="confirm" />
      </div>,
    );
    rerender(
      <div style={{ overflowY: "auto" }}>
        <Control look="none" />
      </div>,
    );
    const [copy] = motion.copies();
    expect(copy).toHaveTextContent("Remove Asha Menon?");
    // Above everything in a sheet; below the floating bar on a page.
    expect(copy.parentElement!.style.zIndex).toBe("60");
  });

  it("fades its first paint in when it was remounted in answer to a tap", () => {
    render(<Control look="text" enter />);
    expect(motion.fadeOf(screen.getByTestId("words"))).toBeDefined();
  });

  it("fades in and out in 120ms on a linear curve under reduced motion", () => {
    reduce(true);
    const { rerender } = render(<Control look="text" />);
    rerender(<Control look="confirm" />);
    expect(motion.fadeOf(screen.getByRole("form"))?.options).toMatchObject({
      duration: 120,
      easing: "linear",
    });
    rerender(<Control look="text" />);
    const [copy] = motion.copies();
    expect(motion.exitOf(copy)?.options).toMatchObject({
      duration: 120,
      easing: "linear",
    });
  });
});
