import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/main.ts";

describe("@sotto/worker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts and exits cleanly with a valid configuration", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main({ RPC_URL: "https://rpc.example.com/?api-key=sentinel-7f3a" })).toBe(0);
    expect(log).toHaveBeenCalledWith("sotto worker: started, no jobs configured, exiting");
    expect(JSON.stringify(log.mock.calls)).not.toContain("sentinel-7f3a");
  });

  it("stops with the name of a missing variable", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main({})).toBe(1);
    expect(error).toHaveBeenCalledWith("sotto worker: configuration error: RPC_URL is not set");
  });
});
