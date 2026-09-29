// My pay's endpoint (F-12, step 2.6) against a test database: a recipient gets the payments to them
// and no one else's, with their settlement times and the holders of readable grants that hold their
// records (AC-12.1), and the organization's transfers into their own wUSDC account as chain_activity
// shows them, never another account's (AC-12.2); no amount is in the answer; someone who is not a
// recipient of the organization gets nothing.
import { randomUUID } from "node:crypto";
import {
  chainActivity,
  disclosures,
  grants,
  invites,
  manifests,
  memberships,
  payments,
  recipients,
} from "@sotto/db";
import type { TestDatabase } from "@sotto/db/testing";
import { getClusterConfig, type AvailableClusterConfig } from "@sotto/sdk/cluster";
import { associatedTokenAccount } from "@sotto/sdk/confidential/public";
import { address, getBase58Decoder, type Address } from "@solana/kit";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as readPay } from "../app/api/orgs/[id]/pay/route.ts";
import {
  createKeyUser,
  createOrgWithStatus,
  errorOf,
  jsonRequest,
  setUpApiTest,
  tearDownApiTest,
} from "./helpers/api.ts";

let test: TestDatabase;

beforeAll(async () => {
  test = await setUpApiTest();
});

afterAll(async () => {
  await tearDownApiTest(test);
});

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const params = (values: Record<string, string>) => ({ params: Promise.resolve(values) });
const randomSignature = () => getBase58Decoder().decode(crypto.getRandomValues(new Uint8Array(64)));
const randomAddress = () => getBase58Decoder().decode(crypto.getRandomValues(new Uint8Array(32)));
const WRAPPED = (getClusterConfig("devnet") as AvailableClusterConfig).wrappedUsdcMint;
if (!WRAPPED) throw new Error("the devnet config has a wrapped mint");

describe("my pay endpoint (F-12)", () => {
  it("AC-12.1 AC-12.2 gives a recipient their own payments, their readers and the transfers into their account only", async () => {
    const owner = await createKeyUser(test);
    const orgId = await createOrgWithStatus(test, owner.userId, "active");
    const [maya, idris] = [await createKeyUser(test), await createKeyUser(test)];
    const recipientIds: string[] = [];
    for (const [person, name] of [
      [maya, "Maya Chen"],
      [idris, "Idris Kaya"],
    ] as const) {
      await test.db.insert(memberships).values({ orgId, userId: person.userId, role: "recipient" });
      const [row] = await test.db
        .insert(recipients)
        .values({ orgId, displayName: name, wallet: person.wallet, userId: person.userId })
        .returning({ id: recipients.id });
      recipientIds.push(row?.id ?? "");
    }
    const settle = async (recipientId: string) => {
      const [row] = await test.db
        .insert(payments)
        .values({
          orgId,
          kind: "single",
          recipientId,
          idempotencyKey: randomUUID(),
          createdBy: owner.userId,
          privateBlob: Buffer.alloc(96, 4),
          status: "settled",
          settledAt: new Date("2026-09-30T10:00:00Z"),
        })
        .returning({ id: payments.id });
      return row?.id ?? "";
    };
    const mine = await settle(recipientIds[0] ?? "");
    const theirs = await settle(recipientIds[1] ?? "");
    // A readable grant holding Maya's payment, and a revoked one that no longer counts.
    const [manifest] = await test.db
      .insert(manifests)
      .values({ orgId, signerWallet: owner.wallet, manifest: {}, signature: Buffer.alloc(64, 1) })
      .returning({ id: manifests.id });
    for (const [holder, status] of [
      ["Daniel Osei", "active"],
      ["Former Auditor", "revoked"],
    ] as const) {
      const token = randomUUID().replaceAll("-", "").padEnd(64, "0");
      await test.db.insert(invites).values({
        token,
        orgId,
        role: "accountant",
        createdBy: owner.userId,
        expiresAt: new Date(Date.now() + 1e9),
      });
      const viewer = await createKeyUser(test);
      const [grant] = await test.db
        .insert(grants)
        .values({
          orgId,
          inviteToken: token,
          viewerUserId: viewer.userId,
          scope: "all_payments",
          status,
          createdBy: owner.userId,
          holderName: holder,
        })
        .returning({ id: grants.id });
      await test.db.insert(disclosures).values({
        orgId,
        grantId: grant?.id ?? null,
        viewerUserId: viewer.userId,
        kind: "payment",
        subject: mine,
        ciphertext: Buffer.alloc(96, 9),
        manifestId: manifest?.id ?? "",
      });
    }
    // The org's transfers: one into Maya's account, one into Idris's.
    const orgAccount = randomAddress();
    const mayaAccount = await associatedTokenAccount(address(maya.wallet), WRAPPED as Address);
    const idrisAccount = await associatedTokenAccount(address(idris.wallet), WRAPPED as Address);
    const toMaya = randomSignature();
    for (const [signature, to] of [
      [toMaya, mayaAccount],
      [randomSignature(), idrisAccount],
    ] as const) {
      await test.db.insert(chainActivity).values({
        orgId,
        tokenAccount: orgAccount,
        signature,
        slot: 10n,
        blockTime: new Date("2026-09-30T10:00:05Z"),
        instructionIndex: 0,
        instructionType: "transfer_out",
        counterpartyAddress: to,
      });
    }

    const response = await readPay(
      jsonRequest(`/api/orgs/${orgId}/pay`, "GET", maya.cookie),
      params({ id: orgId }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      org: { id: orgId, displayName: expect.any(String) },
      ownerWallet: owner.wallet,
      recipient: { displayName: "Maya Chen", roleTitle: null, wallet: maya.wallet },
      tokenAccount: mayaAccount,
      payments: [
        {
          id: mine,
          kind: "single",
          status: "settled",
          settledAt: "2026-09-30T10:00:00.000Z",
          readers: ["Daniel Osei"],
        },
      ],
      chain: [
        {
          signature: toMaya,
          blockTime: "2026-09-30T10:00:05.000Z",
          from: orgAccount,
          to: mayaAccount,
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain(theirs);
    expect(JSON.stringify(body)).not.toMatch(/amount/i);
    // The owner and a stranger are not recipients here.
    for (const other of [owner, await createKeyUser(test)]) {
      expect(
        await errorOf(
          await readPay(
            jsonRequest(`/api/orgs/${orgId}/pay`, "GET", other.cookie),
            params({ id: orgId }),
          ),
        ),
      ).toMatchObject({ code: "forbidden" });
    }
  });
});
