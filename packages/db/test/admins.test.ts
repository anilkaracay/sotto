import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseAdminWallets, removeAdmins, seedAdmins } from "../src/admins.ts";
import { admins } from "../src/schema.ts";
import { createTestDatabase, type TestDatabase } from "../src/testing.ts";

const A = "71GuHKz8HqEKvGbMwQQTiNpqQbMvEu89pSvUcv71QbLh";
const B = "6xosZg2PbZuneXX4riov7GmUCJmydQc3o5MGX6p5EU2";

describe("parseAdminWallets", () => {
  it("trims, drops empty entries and duplicates", () => {
    expect(parseAdminWallets(` ${A}, ${B},,${A} `)).toEqual([A, B]);
    expect(parseAdminWallets("")).toEqual([]);
    expect(parseAdminWallets(undefined)).toEqual([]);
  });

  it("rejects values that are not addresses without echoing them", () => {
    expect(() => parseAdminWallets(`${A},secret-looking-value`)).toThrow(
      "ADMIN_WALLETS holds 1 value(s) that are not Solana addresses",
    );
    try {
      parseAdminWallets("secret-looking-value");
    } catch (error) {
      expect((error as Error).message).not.toContain("secret-looking-value");
    }
  });
});

describe("seedAdmins", () => {
  let test: TestDatabase;
  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(async () => {
    await test?.drop();
  });

  it("inserts new admins and keeps existing rows", async () => {
    expect(await seedAdmins(test.db, [A])).toBe(1);
    expect(await seedAdmins(test.db, [A, B])).toBe(1);
    expect(await seedAdmins(test.db, [])).toBe(0);
    const rows = await test.db.select().from(admins);
    expect(rows.map((row) => row.wallet).sort()).toEqual([B, A].sort());
  });

  it("removes only the wallets it is given, for an admin added for one run (step 3.11)", async () => {
    expect(await removeAdmins(test.db, [B, "11111111111111111111111111111111"])).toBe(1);
    expect(await removeAdmins(test.db, [])).toBe(0);
    const rows = await test.db.select().from(admins);
    expect(rows.map((row) => row.wallet)).toEqual([A]);
  });
});
