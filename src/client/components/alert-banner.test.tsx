// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AlertBanner } from "./alert-banner";
import type { Alert } from "@shared/types";

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 1,
    severity: "critical",
    code: "TEST_CODE",
    message: "Test message",
    details: null,
    resolution: null,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("AlertBanner", () => {
  it("renders nothing when no alerts", () => {
    const { container } = render(
      <AlertBanner alerts={[]} onDismiss={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders critical alert with message and resolution", () => {
    const alert = makeAlert({
      resolution: "Step 1\nStep 2",
    });

    render(<AlertBanner alerts={[alert]} onDismiss={() => {}} />);

    expect(screen.getByText(/TEST_CODE/)).toBeDefined();
    expect(screen.getByText(/Test message/)).toBeDefined();
    expect(screen.getByText(/Step 1/)).toBeDefined();
  });

  it("critical alerts cannot be dismissed", () => {
    const alert = makeAlert({ severity: "critical" });
    render(<AlertBanner alerts={[alert]} onDismiss={() => {}} />);

    expect(screen.queryByLabelText("Dismiss alert")).toBeNull();
  });

  it("warning alerts can be dismissed", async () => {
    const onDismiss = vi.fn();
    const alert = makeAlert({ severity: "warning", id: 42 });

    render(<AlertBanner alerts={[alert]} onDismiss={onDismiss} />);

    const dismissBtn = screen.getByLabelText("Dismiss alert");
    await userEvent.click(dismissBtn);
    expect(onDismiss).toHaveBeenCalledWith(42);
  });

  it("renders details when present", () => {
    const alert = makeAlert({ details: "Extra details here" });
    render(<AlertBanner alerts={[alert]} onDismiss={() => {}} />);

    expect(screen.getByText("Extra details here")).toBeDefined();
  });
});
