import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportForm } from "./report-form";

const mocks = vi.hoisted(() => ({ submitReport: vi.fn() }));
vi.mock("../lib/supabase", () => ({ getPromenadisApiClient: () => mocks }));

const eventId = "01992026-1103-7300-8000-000000000001";
const subjectId = "01992026-1103-7300-8000-000000000002";
const renderForm = (query = `?event=${eventId}&type=location&subject=${subjectId}`) =>
  render(
    <MemoryRouter initialEntries={[`/report${query}`]}>
      <ReportForm locale="en" />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReportForm", () => {
  it("sends an unauthorized-address report with relationship and confirmation", async () => {
    mocks.submitReport.mockResolvedValue({ received: true });
    renderForm();
    fireEvent.change(screen.getByLabelText("Your connection to the address"), {
      target: { value: "owner" },
    });
    fireEvent.click(screen.getByLabelText(/nobody entitled to decide/u));
    fireEvent.change(screen.getByLabelText("Describe what is wrong"), {
      target: { value: "This is my house and I never agreed." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    await waitFor(() =>
      expect(mocks.submitReport).toHaveBeenCalledWith({
        confirmsNoConsent: true,
        details: "This is my house and I never agreed.",
        eventId,
        reason: "unauthorized_address",
        relationship: "owner",
        reporterContact: "",
        subjectId,
        subjectType: "location",
        website: "",
      }),
    );
    expect(await screen.findByText(/reviewed by a person/u)).toBeVisible();
  });

  it("asks no address questions for other reasons", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("What is it about?"), {
      target: { value: "harassment" },
    });
    expect(screen.queryByLabelText("Your connection to the address")).not.toBeInTheDocument();
  });

  it("rejects an incomplete link", () => {
    renderForm("?event=x");
    expect(screen.getByText("The report link is incomplete.")).toBeVisible();
  });

  it("has no detectable automated accessibility violations", async () => {
    const { container } = renderForm();
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
