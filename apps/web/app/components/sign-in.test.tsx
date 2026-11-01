import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignIn } from "./sign-in";

const mocks = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  getBrowserAuthClient: () => ({
    auth: { signInWithOtp: mocks.signInWithOtp, verifyOtp: mocks.verifyOtp },
  }),
  hasLocalBackendConfiguration: () => true,
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("SignIn", () => {
  it("submits the actual form value when a browser autofills without an input event", async () => {
    mocks.signInWithOtp.mockResolvedValue({ error: null });
    render(
      <MemoryRouter>
        <SignIn />
      </MemoryRouter>,
    );

    const input = screen.getByRole("textbox", { name: "E-postadress" });
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(input, "autofilled@example.invalid");
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    await waitFor(() =>
      expect(mocks.signInWithOtp).toHaveBeenCalledWith(
        expect.objectContaining({ email: "autofilled@example.invalid" }),
      ),
    );
  });

  it("explains the local email cooldown", async () => {
    mocks.signInWithOtp.mockResolvedValue({
      error: { code: "over_email_send_rate_limit", status: 429 },
    });
    render(
      <MemoryRouter>
        <SignIn />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "E-postadress" }), {
      target: { value: "tester@example.invalid" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Skicka kod" }));

    expect(
      await screen.findByText("Vänta minst 15 sekunder innan du ber om en ny kod."),
    ).toBeInTheDocument();
  });
});
