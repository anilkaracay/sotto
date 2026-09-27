import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../app/dev/wallet-lab/wallet-lab", () => ({ WalletLab: () => null }));

const { default: WalletLabPage } = await import("../app/dev/wallet-lab/page");

function notFoundDigest(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as { digest?: string }).digest;
  }
  return undefined;
}

describe("/dev/wallet-lab", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a 404 in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(notFoundDigest(() => WalletLabPage())).toMatch(/404/);
  });

  it("is a 404 in any environment other than development", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(notFoundDigest(() => WalletLabPage())).toMatch(/404/);
  });

  it("renders in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(WalletLabPage()).toBeTruthy();
  });
});
