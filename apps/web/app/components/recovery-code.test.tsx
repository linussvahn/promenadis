import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter } from "../test/render";
import { RecoveryCode } from "./recovery-code";

const mocks = vi.hoisted(() => ({
  cancelAccountRecovery: vi.fn(),
  enrollRecoveryCode: vi.fn(),
  getAccountRecoveryStatus: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  getPromenadisApiClient: () => ({
    cancelAccountRecovery: mocks.cancelAccountRecovery,
    enrollRecoveryCode: mocks.enrollRecoveryCode,
    getAccountRecoveryStatus: mocks.getAccountRecoveryStatus,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RecoveryCode", () => {
  it("lets the signed-in owner cancel a pending recovery without revealing the email", async () => {
    mocks.getAccountRecoveryStatus.mockResolvedValue({
      active: false,
      issuedAt: null,
      rotatedAt: null,
      version: 1,
      pendingClaim: { id: "claim-id", emailVerified: true, newEmailMasked: "n***@example.invalid" },
    });
    mocks.cancelAccountRecovery.mockResolvedValue({
      active: false,
      issuedAt: null,
      rotatedAt: null,
      version: 1,
      pendingClaim: null,
    });
    await renderWithRouter(
      <RecoveryCode accessToken={async () => "synthetic-session"} locale="en" />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Cancel account recovery" }));
    await screen.findByText(/request was cancelled/u);
    expect(mocks.cancelAccountRecovery).toHaveBeenCalledWith("synthetic-session", "claim-id");
    expect(screen.queryByText("n***@example.invalid")).not.toBeInTheDocument();
  });
  it("shows a newly generated code once and sends optimistic version zero", async () => {
    mocks.getAccountRecoveryStatus.mockResolvedValue({
      active: false,
      issuedAt: null,
      rotatedAt: null,
      version: 0,
    });
    mocks.enrollRecoveryCode.mockResolvedValue({
      active: true,
      code: "ABCD-EFGH-JKLM-NPQR-STUV",
      issuedAt: "2030-09-09T10:00:00.000Z",
      rotatedAt: null,
      version: 1,
    });

    await renderWithRouter(
      <RecoveryCode accessToken={async () => "synthetic-session"} locale="en" />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Create recovery code" }));

    await waitFor(() =>
      expect(mocks.enrollRecoveryCode).toHaveBeenCalledWith("synthetic-session", {
        expectedVersion: 0,
      }),
    );
    expect(await screen.findByText("ABCD-EFGH-JKLM-NPQR-STUV")).toBeInTheDocument();
    expect(screen.getByText(/shown only this time/u)).toBeInTheDocument();
  });

  it("has no detectable automated accessibility violations", async () => {
    mocks.getAccountRecoveryStatus.mockResolvedValue({
      active: true,
      issuedAt: "2030-09-09T10:00:00.000Z",
      rotatedAt: null,
      version: 1,
    });
    const { container } = await renderWithRouter(
      <RecoveryCode accessToken={async () => "synthetic-session"} locale="en" />,
    );
    await screen.findByText("An active recovery code is saved.");
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
