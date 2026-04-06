// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
  afterEach(cleanup);

  it("renders nothing when no alerts", () => {
    const { container } = render(
      <AlertBanner alerts={[]} onDismiss={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders critical alert with message and resolution visible after expand", async () => {
    const alert = makeAlert({
      resolution: "Step 1\nStep 2",
    });

    render(<AlertBanner alerts={[alert]} onDismiss={() => {}} />);

    expect(screen.getByText(/TEST_CODE/)).toBeDefined();
    expect(screen.getByText(/Test message/)).toBeDefined();

    // Details are collapsed by default — expand to see resolution
    await userEvent.click(screen.getByLabelText("Expand details"));
    expect(screen.getByText(/Step 1/)).toBeDefined();
  });

  it("critical alerts cannot be dismissed", () => {
    const alert = makeAlert({ severity: "critical" });
    render(<AlertBanner alerts={[alert]} onDismiss={() => {}} />);

    expect(screen.queryByLabelText("Dismiss alert")).toBeNull();
  });

  it("renders details when expanded", async () => {
    const alert = makeAlert({ details: "Extra details here" });
    render(<AlertBanner alerts={[alert]} onDismiss={() => {}} />);

    // Details hidden by default
    expect(screen.queryByText("Extra details here")).toBeNull();

    // Expand to see details
    await userEvent.click(screen.getByLabelText("Expand details"));
    expect(screen.getByText("Extra details here")).toBeDefined();
  });

  it("renders AlertTriangle icon", () => {
    const alert = makeAlert();
    render(<AlertBanner alerts={[alert]} onDismiss={() => {}} />);

    // Lucide AlertTriangle renders as an SVG
    const svg = document.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("expand/collapse toggle works", async () => {
    const alert = makeAlert({ details: "Some details", resolution: "Fix it" });
    render(<AlertBanner alerts={[alert]} onDismiss={() => {}} />);

    // Initially collapsed
    expect(screen.queryByText("Some details")).toBeNull();

    // Expand
    await userEvent.click(screen.getByLabelText("Expand details"));
    expect(screen.getByText("Some details")).toBeDefined();
    expect(screen.getByText("Fix it")).toBeDefined();

    // Collapse
    await userEvent.click(screen.getByRole("button", { name: "Collapse details" }));
    expect(screen.queryByText("Some details")).toBeNull();
  });

  it("shows no expand button when no details, resolution, or kill switch data", () => {
    const alert = makeAlert({ details: null, resolution: null });
    render(<AlertBanner alerts={[alert]} onDismiss={() => {}} />);

    expect(screen.queryByLabelText("Expand details")).toBeNull();
  });

  it("formats kill switch detail when expanded", async () => {
    // Set up store with kill switch detail
    const { default: useStore } = await import("@client/store");
    useStore.setState((s) => ({
      modes: {
        ...s.modes,
        volumeMax: {
          ...s.modes.volumeMax,
          status: "kill-switch",
          killSwitchDetail: { positionsClosed: 3, lossAmount: 150000000 },
        },
      },
    }));

    const alert = makeAlert({
      code: "KILL_SWITCH_TRIGGERED",
      message: "Kill switch triggered",
      details: "Closed 3 positions",
      mode: "volumeMax",
    });

    render(<AlertBanner alerts={[alert]} onDismiss={() => {}} />);

    await userEvent.click(screen.getByLabelText("Expand details"));
    expect(screen.getByText(/Positions closed: 3/)).toBeDefined();
    expect(screen.getByText(/Loss: \$150\.00/)).toBeDefined();

    // Clean up store
    useStore.setState((s) => ({
      modes: {
        ...s.modes,
        volumeMax: {
          ...s.modes.volumeMax,
          status: "stopped",
          killSwitchDetail: null,
        },
      },
    }));
  });
});
