import { cleanup, fireEvent, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithRouter } from "../test/render";
import { Welcome } from "./welcome";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.lang = "sv";
});

describe("Welcome", () => {
  it("renders Swedish by default and switches to English", async () => {
    await renderWithRouter(<Welcome />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Upptäck kvarteret till fots.",
    );

    fireEvent.click(screen.getByRole("button", { name: /English/u }));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Discover the neighbourhood on foot.",
    );
    expect(document.documentElement.lang).toBe("en");
    expect(window.localStorage.getItem("promenadis-locale")).toBe("en");
  });

  it("has no detectable automated accessibility violations", async () => {
    const { container } = await renderWithRouter(<Welcome />);
    const result = await axe.run(container, {
      rules: {
        "color-contrast": { enabled: false },
      },
    });

    expect(result.violations).toEqual([]);
  });
});
