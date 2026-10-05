import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useRef } from "react";
import { MeasureBefore } from "./measure-before";

/*
  The one moment a function component cannot reach: the page as it was,
  read after React has decided to change it and before it has. Proved here
  with the DOM itself: what `capture` reads is the OLD text, and `apply` runs
  once the NEW text is on the page.
*/
function Words({
  text,
  watch,
  seen,
  applied,
}: {
  text: string;
  watch: unknown;
  seen: (before: string, after: string) => void;
  applied?: () => void;
}) {
  const el = useRef<HTMLParagraphElement>(null);
  return (
    <MeasureBefore
      watch={watch}
      capture={() => el.current?.textContent ?? ""}
      apply={(before) => {
        applied?.();
        seen(before, el.current?.textContent ?? "");
      }}
    >
      <p ref={el}>{text}</p>
    </MeasureBefore>
  );
}

describe("reading the page before a commit changes it", () => {
  it("captures the old page and applies once the new one is drawn", () => {
    const seen = vi.fn();
    const { rerender } = render(<Words text="before" watch={1} seen={seen} />);
    expect(seen).not.toHaveBeenCalled();

    rerender(<Words text="after" watch={2} seen={seen} />);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith("before", "after");
  });

  it("does nothing on a commit that changes nothing it watches", () => {
    const seen = vi.fn();
    const { rerender } = render(<Words text="one" watch="same" seen={seen} />);
    rerender(<Words text="two" watch="same" seen={seen} />);
    expect(seen).not.toHaveBeenCalled();
  });

  it("never takes the screen down when a motion throws", () => {
    const seen = vi.fn();
    const { rerender, container } = render(
      <Words text="one" watch={1} seen={seen} />,
    );
    expect(() =>
      rerender(
        <Words
          text="two"
          watch={2}
          seen={seen}
          applied={() => {
            throw new Error("an engine without an API");
          }}
        />,
      ),
    ).not.toThrow();
    expect(container.textContent).toBe("two");
  });
});
