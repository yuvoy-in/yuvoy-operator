import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/*
  Both notification screens, after yuvoy-operator#80 t2 and t4. Each opened
  with an eyebrow over its heading, repeated its title as a caption in the
  bar, and then said what the screen is: "Which messages about the business
  reach you", over a list where every switch carries the API's own description
  of what it covers.

  One sentence survives, on somebody else's screen, and it survives because
  this route lives under /team: "no switch exists that could silence a
  security warning", so what a switch does NOT do is worth saying before
  somebody turns one off expecting it to.
*/

const SETTINGS = {
  userId: "usr_staff_arun",
  name: "Arun Biswas",
  switches: [
    {
      group: "bookings_new",
      label: "New bookings",
      description: "When somebody books a seat.",
      on: true,
    },
  ],
  alwaysSent: "Some messages have no switch: a refund, or a suspension.",
};

// The switches redraw from the answer and re-read the list when somebody has
// left the team, so the list is a client component with a router in it.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: vi.fn(),
  // The stage's inbox link reads it to know which screen it is on.
  usePathname: () => "/notifications",
}));
vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({
    token: "tok",
    me: { id: "usr_owner", roles: ["OWNER"] },
  }),
}));
vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({
    GET: async () => ({ data: SETTINGS, error: undefined }),
  }),
}));
vi.mock("./actions", () => ({ setSwitch: vi.fn() }));

const { default: NotificationsPage } = await import("./page");
const { default: TeamNotificationsPage } =
  await import("@/app/team/[id]/notifications/page");

describe("my notifications", () => {
  it("leads with its title, and says nothing the switches already say", async () => {
    const { container } = render(await NotificationsPage());

    expect(
      screen.getByRole("heading", { level: 1, name: "Notifications" }),
    ).toBeInTheDocument();
    expect(container.querySelector(".eyebrow")).toBeNull();
    expect(container.querySelector("header p")).toBeNull();
    expect(
      screen.queryByText(/Which messages about the business reach you/),
    ).toBeNull();
    // The API's own words for what each switch covers are what is left.
    expect(screen.getByText("When somebody books a seat.")).toBeInTheDocument();
  });
});

describe("somebody else's notifications", () => {
  const params = Promise.resolve({ id: "usr_staff_arun" });

  it("is titled with the person, and not with the screen behind it", async () => {
    const { container } = render(await TeamNotificationsPage({ params }));

    expect(
      screen.getByRole("heading", { level: 1, name: "Arun Biswas" }),
    ).toBeInTheDocument();
    expect(container.querySelector(".eyebrow")).toBeNull();
    expect(container.querySelector("header p")).toBeNull();
    expect(
      screen.queryByText(/Which messages about the business reach them/),
    ).toBeNull();
  });

  it("keeps the half that changes a decision, because this sits under Team", async () => {
    render(await TeamNotificationsPage({ params }));

    expect(
      screen.getByText(
        "Changing a switch here does not change what they can do.",
      ),
    ).toBeInTheDocument();
  });
});
