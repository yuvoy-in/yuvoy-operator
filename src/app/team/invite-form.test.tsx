import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InviteState } from "./actions";
import { InviteForm } from "./invite-form";

/**
 * The invite form's receipt, and the list behind it: yuvoy-operator#91 f20
 * and #89 f16.
 *
 * The action is replaced with its answers, so what is under test is what the
 * screen does with each: lead with the link, say plainly whether anything was
 * sent, refresh the list once when an invitation was created, and hand a
 * refusal back with what was typed still in the fields.
 */
const inviteMember = vi.fn<
  (prev: InviteState, form: FormData) => Promise<InviteState>
>(async () => ({}));
vi.mock("./actions", () => ({
  inviteMember: (prev: InviteState, form: FormData) => inviteMember(prev, form),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const LINK = "https://operators.yuvoy.in/join/jn_reefdivers";
const NOT_SENT =
  "We could not send that invitation to them. Give them the join link and the code yourself, or add them again with an email address.";

function receipt(over: Partial<InviteState> = {}): InviteState {
  return {
    attempt: 1,
    sent: {
      name: "Ramesh Toppo",
      phone: "+919000000104",
      role: "STAFF",
      delivered: false,
    },
    joinUrl: LINK,
    ...over,
  };
}

async function submit(
  user: ReturnType<typeof userEvent.setup>,
  { email = "" }: { email?: string } = {},
) {
  await user.type(screen.getByLabelText("Their name"), "Ramesh Toppo");
  await user.type(screen.getByLabelText("Their phone number"), "+919000000104");
  if (email) await user.type(screen.getByLabelText(/Their email/), email);
  await user.click(screen.getByRole("button", { name: "Send the invitation" }));
}

beforeEach(() => {
  inviteMember.mockReset();
  refresh.mockReset();
});

describe("the receipt", () => {
  it("says plainly that nothing was sent, and what makes it go", async () => {
    inviteMember.mockResolvedValue(receipt({ note: NOT_SENT }));
    const user = userEvent.setup();
    render(<InviteForm />);
    await submit(user);

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Ramesh Toppo is invited as Staff");
    expect(
      screen.getByText(/Nothing was sent: we hold no email address for them/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Invite them again with their email address/),
    ).toBeInTheDocument();
    /*
      Not the API's note: it says to pass on "the code yourself", and this
      screen never has the code. And not the link: without the code, which
      goes only to an email address, the link is not a way in.
    */
    expect(screen.queryByText(NOT_SENT)).toBeNull();
    expect(screen.queryByText("Send them this link")).toBeNull();
    expect(screen.queryByText(/We also sent them/)).toBeNull();
  });

  it("says so when a message is carrying it", async () => {
    inviteMember.mockResolvedValue(
      receipt({
        sent: {
          name: "Ramesh Toppo",
          phone: "+919000000104",
          role: "STAFF",
          delivered: true,
        },
      }),
    );
    const user = userEvent.setup();
    render(<InviteForm />);
    await submit(user, { email: "ramesh@example.com" });

    expect(
      await screen.findByText(
        "We also sent them the invitation, with the link and their code.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/We could not send/)).toBeNull();
    // The link still leads: the person is usually standing right there.
    expect(screen.getByText("Send them this link")).toBeInTheDocument();
  });

  it("says nothing was sent in the same words when the API gave no note", async () => {
    inviteMember.mockResolvedValue(receipt());
    const user = userEvent.setup();
    render(<InviteForm />);
    await submit(user);

    expect(
      await screen.findByText(
        /Nothing was sent: we hold no email address for them/,
      ),
    ).toBeInTheDocument();
  });

  it("never promises a message to a phone", async () => {
    inviteMember.mockResolvedValue(receipt({ note: NOT_SENT }));
    const user = userEvent.setup();
    const { container } = render(<InviteForm />);
    await submit(user);
    await screen.findByRole("status");

    expect(container.textContent).not.toMatch(/We message them/);
    expect(container.textContent).not.toMatch(/WhatsApp/);
  });
});

describe("the pending list behind it (yuvoy-operator#89 f16)", () => {
  it("is refreshed once when an invitation was created", async () => {
    inviteMember.mockResolvedValue(receipt());
    const user = userEvent.setup();
    render(<InviteForm />);
    await submit(user);

    await screen.findByRole("status");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("is not refreshed after a refusal, which changed nothing", async () => {
    inviteMember.mockResolvedValue({
      attempt: 1,
      message: "We could not send that invitation.",
    });
    const user = userEvent.setup();
    render(<InviteForm />);
    await submit(user);

    await screen.findByRole("alert");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("a refusal", () => {
  it("lands on the email field and keeps everything that was typed", async () => {
    inviteMember.mockResolvedValue({
      attempt: 1,
      field: "email",
      message:
        "That does not look like an email address. Check it, or leave it out.",
      values: {
        name: "Ramesh Toppo",
        phone: "+919000000104",
        email: "ramesh@",
        role: "OWNER",
      },
    });
    const user = userEvent.setup();
    render(<InviteForm />);
    await submit(user, { email: "ramesh@" });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That does not look like an email address",
    );
    const email = screen.getByLabelText(/Their email/);
    expect(email).toHaveValue("ramesh@");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email.getAttribute("aria-describedby")).toContain("invite-error");
    expect(screen.getByLabelText("Their name")).toHaveValue("Ramesh Toppo");
    expect(screen.getByLabelText("Their phone number")).toHaveValue(
      "+919000000104",
    );
    // The role they chose, and the warning that goes with it.
    expect(screen.getByRole("radio", { name: /Owner/ })).toBeChecked();
    expect(
      screen.getByText("An owner can change where the business is paid."),
    ).toBeInTheDocument();
  });
});

describe("after an owner invitation", () => {
  it("resets to Staff, and takes the owner warning with it", async () => {
    /*
      The form is reset after a success, and the warning used to be state that
      outlived it: an Owner invitation left "An owner can change where the
      business is paid" on screen over a form that said Staff.
    */
    inviteMember.mockResolvedValue(
      receipt({
        sent: {
          name: "Ramesh Toppo",
          phone: "+919000000104",
          role: "OWNER",
          delivered: false,
        },
      }),
    );
    const user = userEvent.setup();
    render(<InviteForm />);
    await user.click(screen.getByRole("radio", { name: /Owner/ }));
    expect(
      screen.getByText("An owner can change where the business is paid."),
    ).toBeInTheDocument();
    await submit(user);

    await screen.findByRole("status");
    expect(screen.getByRole("radio", { name: /Staff/ })).toBeChecked();
    expect(
      screen.queryByText("An owner can change where the business is paid."),
    ).toBeNull();
    expect(screen.getByLabelText("Their name")).toHaveValue("");
  });
});
