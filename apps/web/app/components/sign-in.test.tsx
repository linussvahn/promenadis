import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter } from "../test/render";
import { SignIn } from "./sign-in";

const mocks = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  getBrowserAuthClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithOtp: mocks.signInWithOtp,
      verifyOtp: mocks.verifyOtp,
    },
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
    await renderWithRouter(<SignIn />, { path: "/sign-in" });

    const input = await screen.findByRole("textbox", { name: "E-postadress" });
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
    await renderWithRouter(<SignIn />, { path: "/sign-in" });

    fireEvent.change(screen.getByRole("textbox", { name: "E-postadress" }), {
      target: { value: "tester@example.invalid" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Skicka kod" }));

    expect(
      await screen.findByText("Vänta minst 15 sekunder innan du ber om en ny kod."),
    ).toBeInTheDocument();
  });
});
