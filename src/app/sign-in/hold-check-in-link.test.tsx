import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { takeHeldCheckInLink } from "@/lib/day/check-in-link";
import { HoldCheckInLink } from "./hold-check-in-link";

/*
  Sign-in keeps a check-in link's code for /check-in (yuvoy-operator#175) and
  takes it out of the address bar, with `null` for the state: Next's patched
  replaceState skips its own URL for a state that carries its `__NA` mark,
  and would write the code back on its next re-render.
*/

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("HoldCheckInLink", () => {
  it("holds a check-in link and clears it from the address with no state", () => {
    window.history.replaceState(
      { __NA: true },
      "",
      "/sign-in?next=%2Fcheck-in#YV-4K2M9P7Q.K7QM2XPA",
    );
    const replace = vi.spyOn(window.history, "replaceState");
    render(<HoldCheckInLink />);

    expect(replace).toHaveBeenCalledWith(null, "", "/sign-in?next=%2Fcheck-in");
    expect(window.location.hash).toBe("");
    expect(takeHeldCheckInLink()).toEqual({
      reference: "YV-4K2M9P7Q",
      code: "K7QM2XPA",
    });
  });

  it("leaves any other fragment where it is", () => {
    window.history.replaceState(null, "", "/sign-in#cash-owed");
    const replace = vi.spyOn(window.history, "replaceState");
    render(<HoldCheckInLink />);

    expect(replace).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#cash-owed");
    expect(takeHeldCheckInLink()).toBeNull();
  });
});
