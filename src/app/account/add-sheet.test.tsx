import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
/*
  The reel sheet is the shipped uploader, tested where it lives. Here it only
  has to be the thing that opens, so it is a named dialog and nothing more.
*/
vi.mock("./add-reel-sheet", () => ({
  AddReelSheet: () => <div role="dialog" aria-label="Add a reel" />,
}));

const { AddSheet } = await import("./add-sheet");

afterEach(() => {
  push.mockReset();
  refresh.mockReset();
});

const LISTINGS = [{ id: "exp_1", title: "Dawn dive", status: "live" }];

/** The name contains the words on screen, from the start (WCAG 2.5.3). */
function expectLabelInName(button: HTMLElement) {
  const visible = (button.textContent ?? "").trim();
  expect(visible).toBe("Add");
  expect(button.getAttribute("aria-label")?.startsWith(visible)).toBe(true);
}

/*
  yuvoy-operator#109. The + that starts the most important thing an operator
  does was named "Add" and showed nothing but the icon.
*/
describe("the + on the business profile", () => {
  it("says Add, and is named for both choices behind it", () => {
    render(<AddSheet canManage listings={LISTINGS} />);

    const add = screen.getByRole("button", { name: "Add a listing or a reel" });
    expectLabelInName(add);
    expect(add).toHaveAttribute("aria-haspopup", "dialog");
    expect(add).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the two choices, named the same way, and closes on a second tap", () => {
    render(<AddSheet canManage listings={LISTINGS} />);
    const add = screen.getByRole("button", { name: "Add a listing or a reel" });

    fireEvent.click(add);
    expect(add).toHaveAttribute("aria-expanded", "true");
    const choices = screen.getByRole("dialog", {
      name: "Add a listing or a reel",
    });
    expect(choices).toHaveTextContent("Add a listing");
    expect(choices).toHaveTextContent("Add a reel");

    fireEvent.click(add);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("goes to the builder from Add a listing", () => {
    render(<AddSheet canManage listings={LISTINGS} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Add a listing or a reel" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Add a listing" }));

    expect(push).toHaveBeenCalledWith("/account/listings/new");
  });

  it("opens the reel sheet straight away for STAFF, who have one choice", () => {
    render(<AddSheet canManage={false} listings={LISTINGS} />);

    const add = screen.getByRole("button", { name: "Add a reel" });
    expectLabelInName(add);
    // No listing is offered, and there is no menu of one in between.
    expect(screen.queryByRole("button", { name: /listing/ })).toBeNull();
    expect(add).not.toHaveAttribute("aria-expanded");

    fireEvent.click(add);

    expect(screen.getByRole("dialog", { name: "Add a reel" })).toBeVisible();
    // One control by that name, not the trigger and a menu item side by side.
    expect(screen.getAllByRole("button", { name: "Add a reel" })).toHaveLength(
      1,
    );
  });
});
