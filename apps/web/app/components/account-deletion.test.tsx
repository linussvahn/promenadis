import { PromenadisApiError } from "@promenadis/api-client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountDeletion } from "./account-deletion";

const mocks = vi.hoisted(() => ({
  cancelAccountDeletion: vi.fn(),
  getAccountDeletion: vi.fn(),
  navigate: vi.fn(),
  requestAccountDeletion: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  getPromenadisApiClient: () => mocks,
}));
vi.mock("react-router", async (original) => ({
  ...(await original<typeof import("react-router")>()),
  useNavigate: () => mocks.navigate,
}));

const idle = { blockers: [], eraseAfter: null, pending: false, requestedAt: null };
const eventId = "01992026-1101-7300-8000-000000000001";
const onCancelled = vi.fn(async () => {});

function renderDeletion() {
  return render(
    <MemoryRouter>
      <AccountDeletion accessToken={async () => "account"} locale="en" onCancelled={onCancelled} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AccountDeletion", () => {
  it("lists blockers instead of offering deletion", async () => {
    mocks.getAccountDeletion.mockResolvedValue({
      ...idle,
      blockers: [{ id: eventId, kind: "owned_event", state: "draft", title: "Spring walk" }],
    });
    renderDeletion();
    expect(await screen.findByRole("link", { name: "Spring walk" })).toHaveAttribute(
      "href",
      `/events/${eventId}`,
    );
    expect(screen.queryByRole("button", { name: "Delete account" })).not.toBeInTheDocument();
  });

  it("requires the account email and signs out after scheduling deletion", async () => {
    mocks.getAccountDeletion.mockResolvedValue(idle);
    mocks.requestAccountDeletion
      .mockRejectedValueOnce(new PromenadisApiError("mismatch", 400, "confirmation_mismatch", null))
      .mockResolvedValueOnce({ ...idle, pending: true });
    renderDeletion();
    const input = await screen.findByLabelText("Type the account email address to confirm");
    fireEvent.change(input, { target: { value: "wrong@example.invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    await screen.findByText("The email address does not match the account.");
    expect(mocks.navigate).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "owner@example.invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/sign-in", { replace: true }));
    expect(mocks.requestAccountDeletion).toHaveBeenLastCalledWith("account", {
      confirmationEmail: "owner@example.invalid",
    });
  });

  it("lets a disabled account undo a pending deletion", async () => {
    mocks.getAccountDeletion.mockResolvedValue({
      ...idle,
      eraseAfter: "2031-09-16T10:00:00Z",
      pending: true,
      requestedAt: "2031-09-09T10:00:00Z",
    });
    mocks.cancelAccountDeletion.mockResolvedValue(idle);
    renderDeletion();
    fireEvent.click(await screen.findByRole("button", { name: "Undo deletion" }));
    await screen.findByText("Deletion undone. The account is active again.");
    expect(onCancelled).toHaveBeenCalled();
  });

  it("has no detectable automated accessibility violations", async () => {
    mocks.getAccountDeletion.mockResolvedValue(idle);
    const { container } = renderDeletion();
    await screen.findByRole("button", { name: "Delete account" });
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
