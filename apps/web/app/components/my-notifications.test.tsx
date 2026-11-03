import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter } from "../test/render";
import { MyNotifications } from "./my-notifications";
import { NotificationPreferences } from "./notification-preferences";

const mocks = vi.hoisted(() => ({
  getNotificationPreferences: vi.fn(),
  listNotifications: vi.fn(),
  markNotificationsRead: vi.fn(),
  setNotificationPreferences: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({ getPromenadisApiClient: () => mocks }));
const accessToken = async () => "seller";
const notice = (read: boolean) => ({
  createdAt: "2031-09-01T08:00:00Z",
  eventId: "01992026-1106-7200-8000-000000000001",
  eventTitle: "Spring market",
  id: "01992026-1106-7200-8000-000000000002",
  read,
  template: "seller_approved" as const,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MyNotifications", () => {
  it("lists notices with their event and marks them read", async () => {
    mocks.listNotifications.mockResolvedValue([notice(false)]);
    mocks.markNotificationsRead.mockResolvedValue([notice(true)]);
    await renderWithRouter(<MyNotifications accessToken={accessToken} locale="en" />);
    expect(await screen.findByRole("heading", { name: "Notices (1)" })).toBeVisible();
    expect(screen.getByText("You have a seller place")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Notices" })).toBeVisible());
  });
});

describe("NotificationPreferences", () => {
  it("keeps reminders off until the account opts in", async () => {
    mocks.getNotificationPreferences.mockResolvedValue({ eventReminders: false });
    mocks.setNotificationPreferences.mockResolvedValue({ eventReminders: true });
    await renderWithRouter(<NotificationPreferences accessToken={accessToken} locale="en" />);
    const checkbox = await screen.findByLabelText(/Remind me the day before/u);
    await waitFor(() => expect(checkbox).toBeEnabled());
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(mocks.setNotificationPreferences).toHaveBeenCalledWith("seller", true),
    );
    expect(await screen.findByText("Saved.")).toBeVisible();
  });
});
