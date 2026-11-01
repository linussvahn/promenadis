import { PromenadisApiError } from "@promenadis/api-client";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TwoStep } from "./two-step";

const mocks = vi.hoisted(() => ({
  enrollTotp: vi.fn(),
  getMfaStatus: vi.fn(),
  removeTotp: vi.fn(),
  verifyTotp: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({
  getPromenadisApiClient: () => mocks,
  getBrowserAuthClient: () => ({ auth: { verifyTotp: mocks.verifyTotp } }),
}));

const factorId = "01992026-1101-7400-8000-000000000001";
const off = { assuranceLevel: "aal1", totpEnabled: false };
const renderTwoStep = () => render(<TwoStep accessToken={async () => "account"} locale="en" />);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TwoStep", () => {
  it("sets up TOTP only after a correct code from the app", async () => {
    mocks.getMfaStatus
      .mockResolvedValueOnce(off)
      .mockResolvedValueOnce({ assuranceLevel: "aal2", totpEnabled: true });
    mocks.enrollTotp.mockResolvedValue({
      factorId,
      qrCode: "data:image/svg+xml;base64,PHN2Zy8+",
      secret: "ABCDEFGHIJKLMNOP",
      uri: "otpauth://totp/Promenadis:owner",
    });
    mocks.verifyTotp
      .mockResolvedValueOnce({ error: { status: 400 } })
      .mockResolvedValueOnce({ error: null });
    renderTwoStep();
    fireEvent.click(await screen.findByRole("button", { name: "Turn on two-step verification" }));
    expect(
      await screen.findByRole("img", { name: "QR code for the authenticator app" }),
    ).toBeVisible();
    expect(screen.getByText("ABCDEFGHIJKLMNOP")).toBeVisible();
    const code = screen.getByLabelText("Six-digit code from the app");
    fireEvent.change(code, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and turn on" }));
    await screen.findByText(/did not match/u);
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and turn on" }));
    await screen.findByText("Two-step verification is on.");
    expect(mocks.verifyTotp).toHaveBeenLastCalledWith({ code: "123456", factorId });
  });

  it("asks for a fresh sign-in before turning TOTP off", async () => {
    mocks.getMfaStatus.mockResolvedValue({ assuranceLevel: "aal2", totpEnabled: true });
    mocks.removeTotp.mockRejectedValue(
      new PromenadisApiError("stale", 403, "recent_auth_required", null),
    );
    renderTwoStep();
    fireEvent.click(await screen.findByRole("button", { name: "Turn off two-step verification" }));
    await screen.findByText("Sign out and in again before changing two-step verification.");
  });

  it("has no detectable automated accessibility violations", async () => {
    mocks.getMfaStatus.mockResolvedValue(off);
    const { container } = renderTwoStep();
    await screen.findByRole("button", { name: "Turn on two-step verification" });
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
