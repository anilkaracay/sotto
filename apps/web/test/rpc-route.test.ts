import { describe, expect, it } from "vitest";
import { POST } from "../app/api/rpc/route.ts";

describe("/api/rpc", () => {
  it("returns 501 until the allow list exists", async () => {
    const response = POST();
    expect(response.status).toBe(501);
    const body = (await response.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32601);
  });
});
