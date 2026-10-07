// PUT /api/orgs/:id/policy: the hackathon build keeps approval policies at 1 (D-04).
import { memberships, orgPolicy } from "@sotto/db";
import type { TestDatabase } from "@sotto/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PUT } from "../app/api/orgs/[id]/policy/route.ts";
import {
  APP_ORIGIN,
  apiRequest,
  createOrg,
  createUserWithSession,
  setUpApiTest,
  tearDownApiTest,
} from "./helpers/api.ts";

let test: TestDatabase;
let owner: { cookie: string; userId: string };
let accountant: { cookie: string; userId: string };
let outsider: { cookie: string };
let orgId: string;

beforeAll(async () => {
  test = await setUpApiTest();
  owner = await createUserWithSession(test);
  accountant = await createUserWithSession(test);
  outsider = await createUserWithSession(test);
  orgId = await createOrg(test, owner.userId);
  await test.db
    .insert(memberships)
    .values({ orgId, userId: accountant.userId, role: "accountant" });
});

afterAll(async () => {
  await tearDownApiTest(test);
});

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

function put(id: string, body: unknown, headers: Record<string, string> = {}) {
  const request = apiRequest(`/api/orgs/${id}/policy`, {
    method: "PUT",
    body: JSON.stringify(body),
    headers: {
      origin: APP_ORIGIN,
      "content-type": "application/json",
      cookie: owner.cookie,
      ...headers,
    },
  });
  return PUT(request, { params: Promise.resolve({ id }) });
}

async function errorOf(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string; message: string } };
  return `${response.status} ${body.error.code}: ${body.error.message}`;
}

async function storedPolicy() {
  const [row] = await test.db
    .select({ p: orgPolicy.paymentApprovalsRequired, r: orgPolicy.payrollApprovalsRequired })
    .from(orgPolicy)
    .where(eq(orgPolicy.orgId, orgId));
  return row;
}

describe("PUT /api/orgs/:id/policy", () => {
  it("lets the owner keep the policy at 1 approval", async () => {
    const response = await put(orgId, { paymentApprovalsRequired: 1, payrollApprovalsRequired: 1 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      paymentApprovalsRequired: 1,
      payrollApprovalsRequired: 1,
    });
    expect(await storedPolicy()).toEqual({ p: 1, r: 1 });
  });

  it("refuses approval policies above 1 with a clear error and stores nothing", async () => {
    for (const body of [
      { paymentApprovalsRequired: 2, payrollApprovalsRequired: 1 },
      { paymentApprovalsRequired: 1, payrollApprovalsRequired: 3 },
    ]) {
      expect(await errorOf(await put(orgId, body))).toBe(
        "422 approval_policy_not_available: Approval policies above 1 are not available in this build",
      );
    }
    expect(await storedPolicy()).toEqual({ p: 1, r: 1 });
  });

  it("refuses zero, fractions, missing and extra fields as invalid requests", async () => {
    for (const body of [
      { paymentApprovalsRequired: 0, payrollApprovalsRequired: 1 },
      { paymentApprovalsRequired: 1.5, payrollApprovalsRequired: 1 },
      { paymentApprovalsRequired: 1 },
      { paymentApprovalsRequired: 1, payrollApprovalsRequired: 1, approvers: ["x"] },
    ]) {
      expect((await put(orgId, body)).status).toBe(400);
    }
  });

  it("is forbidden to anyone but the owner, whatever the body", async () => {
    const body = { paymentApprovalsRequired: 2, payrollApprovalsRequired: 2 };
    expect(await errorOf(await put(orgId, body, { cookie: accountant.cookie }))).toMatch(
      /^403 forbidden:/,
    );
    expect(await errorOf(await put(orgId, body, { cookie: outsider.cookie }))).toMatch(
      /^403 forbidden:/,
    );
    expect(await errorOf(await put("not-a-uuid", body))).toMatch(/^403 forbidden:/);
    expect(await errorOf(await put(orgId, body, { cookie: "" }))).toMatch(/^401 unauthenticated:/);
    expect(await errorOf(await put(orgId, body, { origin: "https://evil.example" }))).toMatch(
      /^403 forbidden_origin:/,
    );
  });
});
