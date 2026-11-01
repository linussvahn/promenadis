import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecoverAccount } from "./recover-account";

const mocks = vi.hoisted(() => ({
  completeAccountRecovery: vi.fn(),
  confirmAccountRecoveryEmail: vi.fn(),
  initiateAccountRecovery: vi.fn(),
  readAccountRecoveryClaim: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({
  getPromenadisApiClient: () => mocks,
  hasLocalBackendConfiguration: () => true,
}));
vi.mock("../lib/locale", () => ({
  useStoredLocale: () => ({ locale: "en", setLocale: vi.fn() }),
}));
const id = "01992026-0909-7200-8000-000000000101";
const token = "x".repeat(43);
const verifiedReady = {
  id,
  emailVerified: true,
  initiatedAt: "2020-09-08T10:00:00Z",
  readyAt: "2020-09-09T10:00:00Z",
  expiresAt: "2099-09-15T10:00:00Z",
};
beforeEach(() => {
  mocks.readAccountRecoveryClaim.mockResolvedValue({ ...verifiedReady, emailVerified: false });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});
describe("RecoverAccount", () => {
  it("recognizes an emailed link opened in the already-mounted recovery page", async () => {
    render(<RecoverAccount />);
    window.location.hash = `claim=${id}&token=${token}`;
    await screen.findByRole("button", { name: "Verify replacement email" });
    expect(window.location.hash).toBe("");
    expect(mocks.confirmAccountRecoveryEmail).not.toHaveBeenCalled();
  });
  it("does not verify on page load and removes the token from the address bar", async () => {
    window.history.replaceState(null, "", `/recover-account#claim=${id}&token=${token}`);
    mocks.confirmAccountRecoveryEmail.mockResolvedValue({
      id,
      emailVerified: true,
      initiatedAt: "2030-09-09T10:00:00Z",
      readyAt: "2030-09-10T10:00:00Z",
      expiresAt: "2030-09-16T10:00:00Z",
    });
    render(<RecoverAccount />);
    const button = await screen.findByRole("button", { name: "Verify replacement email" });
    expect(window.location.hash).toBe("");
    expect(mocks.confirmAccountRecoveryEmail).not.toHaveBeenCalled();
    fireEvent.click(button);
    await screen.findByText("The replacement email address is verified.");
    expect(mocks.confirmAccountRecoveryEmail).toHaveBeenCalledWith(id, {
      verificationToken: token,
    });
    expect(screen.queryByRole("button", { name: "Finish recovery" })).not.toBeInTheDocument();
  });
  it("starts recovery and clears the code after successful local delivery", async () => {
    mocks.initiateAccountRecovery.mockResolvedValue({ delivery: "captured_locally" });
    render(<RecoverAccount />);
    fireEvent.change(screen.getByLabelText("Current email address"), {
      target: { value: "owner@example.invalid" },
    });
    fireEvent.change(screen.getByLabelText("Replacement email address"), {
      target: { value: "new@example.invalid" },
    });
    fireEvent.change(screen.getByLabelText("Recovery code"), {
      target: { value: "abcd-efgh-jklm-npqr-stuv" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start recovery" }));
    await screen.findByText("The verification message is now available in local Mailpit.");
    expect(mocks.initiateAccountRecovery).toHaveBeenCalledWith({
      currentEmail: "owner@example.invalid",
      newEmail: "new@example.invalid",
      recoveryCode: "ABCD-EFGH-JKLM-NPQR-STUV",
    });
    await waitFor(() => expect(screen.getByLabelText("Recovery code")).toHaveValue(""));
  });
  it("allows retry after verification fails and makes no completion promise", async () => {
    window.history.replaceState(null, "", `/recover-account#claim=${id}&token=${token}`);
    mocks.confirmAccountRecoveryEmail.mockRejectedValue(new Error("expired"));
    render(<RecoverAccount />);
    fireEvent.click(await screen.findByRole("button", { name: "Verify replacement email" }));
    await screen.findByText("The recovery link is invalid or has expired.");
    expect(screen.getByRole("button", { name: "Verify replacement email" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Finish recovery" })).not.toBeInTheDocument();
  });
  it("finishes a ready recovery only on explicit request and points to sign-in", async () => {
    window.history.replaceState(null, "", `/recover-account#claim=${id}&token=${token}`);
    mocks.confirmAccountRecoveryEmail.mockResolvedValue({
      id,
      emailVerified: true,
      initiatedAt: "2020-09-08T10:00:00Z",
      readyAt: "2020-09-09T10:00:00Z",
      expiresAt: "2099-09-15T10:00:00Z",
    });
    mocks.completeAccountRecovery.mockResolvedValue({ state: "completed" });
    render(<RecoverAccount />);
    fireEvent.click(await screen.findByRole("button", { name: "Verify replacement email" }));
    const finish = await screen.findByRole("button", { name: "Finish recovery" });
    expect(mocks.completeAccountRecovery).not.toHaveBeenCalled();
    fireEvent.click(finish);
    await screen.findByText(/Recovery is complete/u);
    expect(mocks.completeAccountRecovery).toHaveBeenCalledWith(id, { verificationToken: token });
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
  });
  it("reports an undecided or refused completion without claiming success", async () => {
    window.history.replaceState(null, "", `/recover-account#claim=${id}&token=${token}`);
    mocks.confirmAccountRecoveryEmail.mockResolvedValue({
      id,
      emailVerified: true,
      initiatedAt: "2020-09-08T10:00:00Z",
      readyAt: "2020-09-09T10:00:00Z",
      expiresAt: "2099-09-15T10:00:00Z",
    });
    mocks.completeAccountRecovery
      .mockResolvedValueOnce({ state: "finishing" })
      .mockRejectedValueOnce(new Error("unavailable"));
    render(<RecoverAccount />);
    fireEvent.click(await screen.findByRole("button", { name: "Verify replacement email" }));
    fireEvent.click(await screen.findByRole("button", { name: "Finish recovery" }));
    await screen.findByText(/Recovery is finishing/u);
    fireEvent.click(screen.getByRole("button", { name: "Finish recovery" }));
    await screen.findByText(/Recovery cannot be finished now/u);
    expect(screen.queryByText(/Recovery is complete/u)).not.toBeInTheDocument();
  });
  it("goes straight to the finish step when a verified link is reopened", async () => {
    window.history.replaceState(null, "", `/recover-account#claim=${id}&token=${token}`);
    mocks.readAccountRecoveryClaim.mockResolvedValue(verifiedReady);
    render(<RecoverAccount />);
    await screen.findByRole("button", { name: "Finish recovery" });
    expect(mocks.readAccountRecoveryClaim).toHaveBeenCalledWith(id, { verificationToken: token });
    expect(mocks.confirmAccountRecoveryEmail).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Verify replacement email" }),
    ).not.toBeInTheDocument();
  });
  it("shows the waiting step for a reopened verified link before the deadline", async () => {
    window.history.replaceState(null, "", `/recover-account#claim=${id}&token=${token}`);
    mocks.readAccountRecoveryClaim.mockResolvedValue({
      ...verifiedReady,
      readyAt: "2099-09-09T10:00:00Z",
    });
    render(<RecoverAccount />);
    await screen.findByText("Waiting period in progress");
    expect(screen.queryByRole("button", { name: "Finish recovery" })).not.toBeInTheDocument();
    expect(mocks.confirmAccountRecoveryEmail).not.toHaveBeenCalled();
  });
  it("has no detectable automated accessibility violations", async () => {
    const { container } = render(<RecoverAccount />);
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
