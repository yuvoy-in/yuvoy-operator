import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Link from "next/link";
import { LinkRing, RowChevron } from "./link-pending";

/*
  A tap into a screen that keeps no loading boundary (the stability audit,
  P2-1): nothing is painted between the tap and the screen, so the link
  answers it itself, with the ring a busy button turns. These pin that the
  ring is drawn only while the link's navigation is pending, where the
  chevron was or after the words, hidden from a screen reader, and with its
  own reduced version. Which links carry it is `loading.test.ts`'s to say.
*/
const status = vi.hoisted(() => ({ pending: false }));
vi.mock("next/link", async (original) => ({
  ...(await original<typeof import("next/link")>()),
  useLinkStatus: () => status,
}));

afterEach(() => {
  status.pending = false;
});

function row() {
  return (
    <Link href="/bookings/bkg_1">
      <span>Reef dive</span>
      <RowChevron className="text-terra-deep size-5 shrink-0" />
    </Link>
  );
}

describe("a row's chevron", () => {
  it("is only a chevron while nothing is on its way", () => {
    const { container } = render(row());
    expect(container.querySelector(".motion-busy-ring")).toBeNull();
    const chevron = container.querySelector("svg");
    expect(chevron).not.toHaveClass("motion-busy-hide");
    expect(chevron).not.toHaveAttribute("data-motion");
  });

  it("gives way to the busy ring in its own place while the screen is on its way", () => {
    status.pending = true;
    const { container } = render(row());
    const ring = container.querySelector(".motion-busy-ring");
    const chevron = container.querySelector("svg");
    expect(ring).not.toBeNull();
    expect(ring).toHaveAttribute("aria-hidden", "true");
    // It ships its own reduced version, as the button's ring does.
    expect(ring).toHaveAttribute("data-motion");
    // The two share one box, so nothing in the row moves.
    expect(ring?.parentElement).toBe(chevron?.parentElement);
    expect(chevron).toHaveClass("motion-busy-hide", "size-5");
    expect(chevron).toHaveAttribute("data-motion");
    expect(screen.getByRole("link", { name: "Reef dive" })).toBeVisible();
  });
});

describe("the ring after a link's words", () => {
  it("draws nothing while nothing is on its way", () => {
    const { container } = render(
      <Link href="/today/slot_1">
        Who is booked
        <LinkRing />
      </Link>,
    );
    expect(container.querySelector(".motion-busy-ring")).toBeNull();
  });

  it("follows the words while the screen is on its way, hidden from a screen reader", () => {
    status.pending = true;
    render(
      <Link href="/today/slot_1">
        Who is booked
        <LinkRing />
      </Link>,
    );
    const link = screen.getByRole("link", { name: "Who is booked" });
    const ring = link.querySelector(".motion-busy-ring");
    expect(ring).toHaveAttribute("aria-hidden", "true");
    expect(ring).toHaveAttribute("data-motion");
    expect(link.lastElementChild).toBe(ring);
    // After words it brings its own space.
    expect(ring).toHaveClass("ml-1.5");
  });

  it("is spaced by the button's own gap in a link drawn as a button", () => {
    status.pending = true;
    const { container } = render(
      <Link href="/today/slot_1/boarding" className="inline-flex gap-2">
        Start boarding
        <LinkRing button />
      </Link>,
    );
    const ring = container.querySelector(".motion-busy-ring");
    expect(ring).not.toBeNull();
    expect(ring).not.toHaveClass("ml-1.5");
  });
});
