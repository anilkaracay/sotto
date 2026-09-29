// The disclosure engine (07 sections 2 to 5; 07 section 9 tests that apply in Phase 1): canonical JSON,
// the version 1 payload, a sealed round trip for every kind, and signed manifests, including a
// tampered item, a wrong signer and a manifest replayed for another org (I-9).
import { createHash } from "node:crypto";
import { createKeyPairFromPrivateKeyBytes, getAddressFromPublicKey, signBytes } from "@solana/kit";
import sodium from "libsodium-wrappers-sumo";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildManifest,
  canonicalJson,
  CanonicalJsonError,
  DISCLOSURE_KINDS,
  DisclosureError,
  itemInManifest,
  manifestMessage,
  validateManifest,
  validatePayload,
  verifyManifest,
  type DisclosurePayloadV1,
  periodBounds,
  scopeCovers,
} from "../src/disclosure/index.ts";
import { openJson, openPayload, sealJson, sealPayload } from "../src/disclosure/seal.ts";

const ORG = "0b8f3c3e-5d53-4d4e-9d7f-0f3f2d1c0a11";
const OTHER_ORG = "7c2a9e41-1b2c-4f0e-8a77-3d5e6f708192";
const VIEWER = "3f1d2c4b-5a69-4786-9a0b-1c2d3e4f5a6b";
const SIGNATURE =
  "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";

function payload(kind: DisclosurePayloadV1["kind"]): DisclosurePayloadV1 {
  return {
    v: 1,
    org: ORG,
    kind,
    direction: "out",
    category: kind === "payroll_line" ? "payroll" : "supplier",
    subject: kind === "month_total" ? "2026-09" : "9b1e2c3d-4f5a-4b6c-8d7e-0f1a2b3c4d5e",
    amount: "1500000000",
    currency: "USDC",
    memo: "September",
    gross: kind === "payroll_line" ? "1800000000" : null,
    tax: kind === "payroll_line" ? "300000000" : null,
    counterparty: "Maya Chen",
    signatures: [SIGNATURE],
    created_at: "2026-09-27T12:00:00.000Z",
  };
}

async function viewerKeys(seed: number) {
  await sodium.ready;
  const pair = sodium.crypto_box_seed_keypair(new Uint8Array(32).fill(seed));
  return { publicKey: pair.publicKey, secretKey: pair.privateKey };
}

async function wallet(seedText: string) {
  const keys = await createKeyPairFromPrivateKeyBytes(
    new Uint8Array(createHash("sha256").update(seedText).digest()),
  );
  return {
    address: await getAddressFromPublicKey(keys.publicKey),
    sign: async (message: Uint8Array) => new Uint8Array(await signBytes(keys.privateKey, message)),
  };
}

describe("canonical JSON (07 section 2)", () => {
  it("sorts keys at every level, keeps arrays in order and adds no whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1, { f: "x", e: null }], c: true } })).toBe(
      '{"a":{"c":true,"d":[3,1,{"e":null,"f":"x"}]},"b":1}',
    );
    expect(canonicalJson({ z: "é", a: 'quote " and \\n' })).toBe(
      '{"a":"quote \\" and \\\\n","z":"é"}',
    );
    for (const bad of [{ a: 1.5 }, { a: Number.NaN }, { a: undefined }, { a: new Date(0) }]) {
      expect(() => canonicalJson(bad)).toThrow(CanonicalJsonError);
    }
  });
});

describe("payload version 1 (07 section 3)", () => {
  it("accepts every kind exactly and refuses extra, missing or malformed fields", () => {
    for (const kind of DISCLOSURE_KINDS)
      expect(validatePayload(payload(kind))).toEqual(payload(kind));
    const base = payload("payment") as unknown as Record<string, unknown>;
    const missing = Object.fromEntries(Object.entries(base).filter(([key]) => key !== "memo"));
    for (const bad of [
      { ...base, extra: 1 },
      missing,
      { ...base, v: 2 },
      { ...base, amount: "1.5" },
      { ...base, amount: "-1" },
      { ...base, currency: "USDT" },
      { ...base, kind: "totals" },
      { ...base, org: "not-a-uuid" },
      { ...base, created_at: "2026-09-27 12:00" },
      { ...base, signatures: ["short"] },
    ]) {
      expect(() => validatePayload(bad)).toThrow(DisclosureError);
    }
  });
});

describe("sealed boxes (07 section 2)", () => {
  it("round trips every kind for the viewer and opens for no one else", async () => {
    const viewer = await viewerKeys(1);
    const other = await viewerKeys(2);
    for (const kind of DISCLOSURE_KINDS) {
      const sealed = await sealPayload(payload(kind), viewer.publicKey);
      expect(await openPayload(sealed, viewer)).toEqual(payload(kind));
      await expect(openPayload(sealed, other)).rejects.toThrow(DisclosureError);
      const tampered = new Uint8Array(sealed);
      tampered[sealed.length - 1] = (tampered[sealed.length - 1] ?? 0) ^ 1;
      await expect(openPayload(tampered, viewer)).rejects.toThrow(DisclosureError);
    }
    // Any canonical JSON value, as the recipients' private blobs use.
    const blob = await sealJson(
      { v: 1, default_amount: "9400000000", notes: null },
      viewer.publicKey,
    );
    expect(await openJson(blob, viewer)).toEqual({
      v: 1,
      default_amount: "9400000000",
      notes: null,
    });
  });
});

describe("signed manifests (07 section 4, I-9)", () => {
  let owner: Awaited<ReturnType<typeof wallet>>;
  let stranger: Awaited<ReturnType<typeof wallet>>;
  let ciphertexts: Uint8Array[];

  beforeAll(async () => {
    owner = await wallet("sotto-manifest-owner/v1");
    stranger = await wallet("sotto-manifest-stranger/v1");
    const viewer = await viewerKeys(3);
    ciphertexts = await Promise.all(
      ["payment", "payroll_line"].map((kind) =>
        sealPayload(payload(kind as DisclosurePayloadV1["kind"]), viewer.publicKey),
      ),
    );
  });

  const items = () =>
    ciphertexts.map((ciphertext, index) => ({
      id: `aa1e2c3d-4f5a-4b6c-8d7e-0f1a2b3c4d5${index}`,
      viewer: VIEWER,
      ciphertext,
    }));

  it("verifies a manifest the owner signed and the items it lists", async () => {
    const manifest = await buildManifest({
      org: ORG,
      createdAt: "2026-09-27T12:00:00.000Z",
      items: items(),
    });
    const message = new TextDecoder().decode(await manifestMessage(manifest));
    expect(message).toMatch(/^sotto-disclosure-manifest\/v1\n[0-9a-f]{64}$/);
    const signature = await owner.sign(await manifestMessage(manifest));
    expect(
      await verifyManifest({ manifest, signature, ownerWallet: owner.address, org: ORG }),
    ).toEqual({ ok: true });
    for (const item of items()) expect(await itemInManifest(manifest, item)).toBe(true);
    // The manifest round trips through JSON (the database stores it as jsonb) and still verifies.
    const stored = validateManifest(JSON.parse(JSON.stringify(manifest)));
    expect(
      await verifyManifest({ manifest: stored, signature, ownerWallet: owner.address, org: ORG }),
    ).toEqual({ ok: true });
  });

  it("refuses a tampered item, a wrong signer, a changed manifest and a replay for another org", async () => {
    const manifest = await buildManifest({
      org: ORG,
      createdAt: "2026-09-27T12:00:00.000Z",
      items: items(),
    });
    const signature = await owner.sign(await manifestMessage(manifest));
    const [first] = items();
    if (!first) throw new Error("no item");
    const tampered = new Uint8Array(first.ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 1;
    expect(await itemInManifest(manifest, { ...first, ciphertext: tampered })).toBe(false);
    expect(await itemInManifest(manifest, { ...first, viewer: OTHER_ORG })).toBe(false);
    expect(
      await itemInManifest(manifest, { ...first, id: "bb1e2c3d-4f5a-4b6c-8d7e-0f1a2b3c4d50" }),
    ).toBe(false);

    const byStranger = await stranger.sign(await manifestMessage(manifest));
    expect(
      await verifyManifest({
        manifest,
        signature: byStranger,
        ownerWallet: owner.address,
        org: ORG,
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
    const changed = { ...manifest, created_at: "2026-09-28T12:00:00.000Z" };
    expect(
      await verifyManifest({ manifest: changed, signature, ownerWallet: owner.address, org: ORG }),
    ).toEqual({ ok: false, reason: "bad_signature" });
    expect(
      await verifyManifest({ manifest, signature, ownerWallet: owner.address, org: OTHER_ORG }),
    ).toEqual({ ok: false, reason: "wrong_org" });
    // A manifest signed for one org and relabeled for another fails the signature.
    const relabeled = { ...manifest, org: OTHER_ORG };
    expect(
      await verifyManifest({
        manifest: relabeled,
        signature,
        ownerWallet: owner.address,
        org: OTHER_ORG,
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses malformed manifests", () => {
    const good = {
      v: 1,
      org: ORG,
      items: [{ id: VIEWER, viewer: VIEWER, sha256_ciphertext: "a".repeat(64) }],
      created_at: "2026-09-27T12:00:00.000Z",
    };
    expect(validateManifest(good)).toEqual(good);
    for (const bad of [
      { ...good, extra: true },
      { ...good, v: 2 },
      { ...good, items: [] },
      { ...good, items: [{ ...good.items[0], sha256_ciphertext: "A".repeat(64) }] },
      { ...good, items: [good.items[0], good.items[0]] },
      { ...good, org: "x" },
    ]) {
      expect(() => validateManifest(bad)).toThrow(DisclosureError);
    }
  });
});

describe("grant scope evaluation (07 sections 6 and 9)", () => {
  const all = { scope: "all_payments" as const, periodFrom: null, periodTo: null };
  const payroll = { scope: "payroll_only" as const, periodFrom: null, periodTo: null };
  const own = { scope: "own_payslips" as const, periodFrom: null, periodTo: null };
  const q3 = { scope: "period" as const, periodFrom: "2026-07-01", periodTo: "2026-09-30" };
  const at = (iso: string) => new Date(iso);

  it("AC-10.1 covers each kind by scope", () => {
    const table: [typeof all | typeof payroll | typeof own, string, boolean][] = [
      [all, "payment", true],
      [all, "payroll_line", true],
      [all, "balance_snapshot", true],
      [all, "month_total", false],
      [payroll, "payment", false],
      [payroll, "payroll_line", true],
      [payroll, "balance_snapshot", false],
      [own, "payment", false],
    ];
    for (const [grant, kind, covered] of table) {
      expect(
        scopeCovers(grant, { kind: kind as never, settledAt: at("2026-08-01T00:00:00Z") }),
      ).toBe(covered);
    }
    // Own payslips: the viewer's own lines only.
    expect(scopeCovers(own, { kind: "payroll_line", settledAt: null, ownLine: true })).toBe(true);
    expect(scopeCovers(own, { kind: "payroll_line", settledAt: null, ownLine: false })).toBe(false);
  });

  it("AC-10.1 covers a period from its first day included to the day after its last excluded, in UTC", () => {
    const covers = (iso: string | null) =>
      scopeCovers(q3, { kind: "payment", settledAt: iso ? at(iso) : null });
    expect(covers("2026-06-30T23:59:59.999Z")).toBe(false);
    expect(covers("2026-07-01T00:00:00.000Z")).toBe(true);
    expect(covers("2026-09-30T23:59:59.999Z")).toBe(true);
    expect(covers("2026-10-01T00:00:00.000Z")).toBe(false);
    // Not settled: no period covers it.
    expect(covers(null)).toBe(false);
    expect(scopeCovers(q3, { kind: "month_total", settledAt: at("2026-08-01T00:00:00Z") })).toBe(
      false,
    );
    // One day periods, and bounds that are not a period.
    expect(periodBounds("2026-07-01", "2026-07-01")).toEqual({
      from: at("2026-07-01T00:00:00.000Z"),
      to: at("2026-07-02T00:00:00.000Z"),
    });
    expect(() => periodBounds("2026-07-02", "2026-07-01")).toThrow();
    expect(() => periodBounds("2026-7-1", "2026-07-01")).toThrow();
  });
});
