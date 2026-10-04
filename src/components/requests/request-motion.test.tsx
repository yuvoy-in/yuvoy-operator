import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RequestView } from "@/lib/day/request-view";
import type { Answer } from "./answer-store";

vi.mock("@/app/bookings/actions", () => ({
  acceptRequest: vi.fn(),
  declineRequest: vi.fn(),
}));

const { RequestItem } = await import("./request-item");
const { HeldRow, GrantedReceipt } = await import("./answer-rows");

/*
  Answering a request (O02 A, approved 4 Oct 2026): the five seconds drawn
  as a bar, each swap landing in place while what follows slides, and the
  receipt's tick drawing itself.
*/
const VIEW: RequestView = {
  id: "req_1",
  name: "Asha Menon",
  firstName: "Asha",
  guests: 2,
  title: "Asha Menon, 2 people",
  trip: "Try-dive at Nemo Reef · Tomorrow at 07:00",
  asked: "Asked 2 h ago · Answer by 08:04",
  clock: "24 min left",
  urgent: true,
  seats: "3 seats you can still give",
  short: false,
  preset: null,
  timezone: "Asia/Kolkata",
};

type Played = {
  el: Element;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
};
let played: Played[] = [];
const saved: Record<string, PropertyDescriptor | undefined> = {};

/*
  jsdom has no layout: a card is 200px tall, a held row 90px, anything else
  60px, and each element of a list sits under the ones before it.
*/
function heightOf(el: Element): number {
  if (el.getAttribute("aria-label")?.startsWith("Seat request")) return 200;
  if (el.querySelector(".motion-drain")) return 90;
  return 60;
}

beforeEach(() => {
  played = [];
  for (const key of ["getBoundingClientRect", "getClientRects", "animate"]) {
    saved[key] = Object.getOwnPropertyDescriptor(Element.prototype, key);
  }
  Object.defineProperties(Element.prototype, {
    getBoundingClientRect: {
      configurable: true,
      value(this: Element) {
        let top = 0;
        for (
          let n = this.previousElementSibling;
          n;
          n = n.previousElementSibling
        ) {
          top += heightOf(n);
        }
        return { top, left: 0, width: 360, height: heightOf(this) } as DOMRect;
      },
    },
    getClientRects: { configurable: true, value: () => [{}] },
    animate: {
      configurable: true,
      value(
        this: Element,
        frames: Keyframe[],
        options: KeyframeAnimationOptions,
      ) {
        played.push({ el: this, frames, options });
        return {
          finished: Promise.resolve(),
          cancel() {},
        } as unknown as Animation;
      },
    },
  });
  vi.stubGlobal("innerHeight", 800);
});

afterEach(() => {
  for (const [key, descriptor] of Object.entries(saved)) {
    if (descriptor) Object.defineProperty(Element.prototype, key, descriptor);
    else delete (Element.prototype as unknown as Record<string, unknown>)[key];
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function item(answer?: Answer) {
  return (
    <ul>
      <RequestItem
        view={VIEW}
        answer={answer}
        present
        canAnswer
        canAccept
        onAccept={() => {}}
        onDecline={() => {}}
        onUndo={() => {}}
      />
      <li>Coming up</li>
    </ul>
  );
}

describe("the five seconds, drawn", () => {
  it("is a bar under the held row, the words' aria-hidden twin, from where the window is", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T07:40:00Z"));
    const until = Date.now() + 3200;
    const { container } = render(
      <ul>
        <HeldRow
          answer={{ view: VIEW, kind: "accept", phase: "holding", until }}
          onUndo={() => {}}
        />
      </ul>,
    );
    const bar = container.querySelector(".motion-drain") as HTMLElement;
    expect(bar).toHaveAttribute("aria-hidden", "true");
    // Kept running under reduced motion, where it steps once a second.
    expect(bar).toHaveAttribute("data-motion");
    expect(bar.style.getPropertyValue("--window")).toBe("5000ms");
    expect(bar.style.getPropertyValue("--window-steps")).toBe("5");
    // 1.8s of the five already gone: it starts from what is left.
    expect(bar.style.getPropertyValue("--window-delay")).toBe("-1800ms");
    // The words stay for anyone who reads.
    expect(screen.getByText(/Sending in/)).toHaveTextContent(
      "Sending in 4 seconds",
    );
  });

  it("goes once the answer is on its way, and the words say so as they arrive", () => {
    const { container } = render(
      <ul>
        <HeldRow
          answer={{ view: VIEW, kind: "accept", phase: "sending" }}
          onUndo={() => {}}
        />
      </ul>,
    );
    expect(container.querySelector(".motion-drain")).toBeNull();
    expect(screen.getByText("Sending…")).toHaveClass("motion-in");
  });
});

describe("each step of an answer", () => {
  it("lands in place, and what follows slides up from where it was", () => {
    const { rerender } = render(item());
    const below = screen.getByText("Coming up");
    rerender(
      item({
        view: VIEW,
        kind: "accept",
        phase: "holding",
        until: Date.now() + 5000,
      }),
    );
    const held = screen.getByText(/Accepting Asha Menon/).closest("li")!;
    // The new row fades in where the card stood.
    expect(played.some((p) => p.el === held && p.frames[0].opacity === 0)).toBe(
      true,
    );
    // The card was 200px and the row is 90: the row below starts 110px down.
    const slide = played.find((p) => p.el === below);
    expect(slide?.frames).toEqual([
      { transform: "translateY(110px)" },
      { transform: "none" },
    ]);
    expect(slide?.options).toMatchObject({ duration: 200 });
  });

  it("does nothing on its first paint", () => {
    render(item());
    expect(played).toHaveLength(0);
  });

  it("slides nothing under reduced motion, and still fades the row in", () => {
    vi.stubGlobal(
      "matchMedia",
      () =>
        ({
          matches: true,
          addEventListener() {},
          removeEventListener() {},
        }) as unknown as MediaQueryList,
    );
    const { rerender } = render(item());
    rerender(
      item({
        view: VIEW,
        kind: "accept",
        phase: "holding",
        until: Date.now() + 5000,
      }),
    );
    expect(
      played.find((p) => p.el === screen.getByText("Coming up")),
    ).toBeUndefined();
    expect(played.some((p) => p.options.duration === 120)).toBe(true);
  });
});

describe("the receipt", () => {
  it("draws its tick as it arrives", () => {
    const { container } = render(
      <ul>
        <GrantedReceipt
          receipt={{ id: "req_1", contactName: "Asha Menon", guests: 2 }}
        />
      </ul>,
    );
    expect(container.querySelector("svg.motion-tick path")).toHaveAttribute(
      "pathLength",
      "1",
    );
    // O02's own breath before the tick draws: an answer's receipt, 80ms.
    expect(container.querySelector("svg.motion-tick")).toHaveClass(
      "motion-tick-receipt",
    );
  });
});
