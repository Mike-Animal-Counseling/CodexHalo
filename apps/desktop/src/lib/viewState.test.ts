import { describe, expect, it } from "vitest";
import { emptyUsage, type ConnectionState, type DashboardStatus } from "../types";
import { dashboardViewState } from "./viewState";

function status(connection: ConnectionState, updatedAt?: number): DashboardStatus {
  return {
    connection,
    windows: [],
    tokens: emptyUsage,
    pricing: { value: 0, unavailableModels: [], version: "test" },
    updatedAt,
  };
}

describe("dashboardViewState", () => {
  it("keeps disabled, disconnected, connected zero-data, and real errors distinct", () => {
    expect(dashboardViewState(status("disabled"))).toBe("disabled");
    expect(dashboardViewState(status("disconnected"))).toBe("disconnected");
    expect(dashboardViewState(status("ready", Date.now()))).toBe("data");
    expect(dashboardViewState(status("error"))).toBe("error");
  });

  it("keeps cached offline data in the normal data view", () => {
    expect(dashboardViewState(status("offline", Date.now()))).toBe("data");
  });
});
