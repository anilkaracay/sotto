// The viewer's check of what GET /api/orgs/:id/disclosures returns (I-9, 07 section 4; step 1.10):
// an item opens only when its manifest names the org, the owner wallet signed it and it lists the
// item for this viewer with the hash of its exact ciphertext; the payload must be for this org.
import { createHash } from "node:crypto";
import { buildManifest, manifestMessage, type DisclosurePayloadV1 } from "@sotto/sdk/disclosure";
import { openJson, sealPayload } from "@sotto/sdk/disclosure/seal";
import { deriveViewingKey, viewKeyMessage } from "@sotto/sdk/keys";
import {
  createKeyPairFromPrivateKeyBytes,
  getAddressFromPublicKey,
  signBytes,
  type Address,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import { openDisclosures } from "../lib/client/disclosures.ts";
import type { DisclosureItemView, ManifestView } from "../lib/server/disclosures.ts";

const ORG = "3f1b6a2e-5c4d-4e8f-9a0b-1c2d3e4f5a6b";
const OTHER_ORG = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";
const VIEWER = "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d";
const OTHER_VIEWER = "0f1e2d3c-4b5a-4968-8776-655443322110";
const PAYMENT = "8e7d6c5b-4a39-4281-9f0e-d1c2b3a49586";
const SIGNATURE = "5".repeat(88);
const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

async function wallet(seed: string) {
  const keys = await createKeyPairFromPrivateKeyBytes(
    new Uint8Array(createHash("sha256").update(seed).digest()),
  );
  const address = await getAddressFromPublicKey(keys.publicKey);
  return {
    address,
    sign: async (message: Uint8Array) => new Uint8Array(await signBytes(keys.privateKey, message)),
  };
}

async function viewingKey(seed: string) {
  const owner = await wallet(seed);
  return deriveViewingKey(
    owner.address as Address,
    await owner.sign(viewKeyMessage(owner.address)),
  );
}

function payload(org = ORG): DisclosurePayloadV1 {
  return {
    v: 1,
    org,
    kind: "payment",
    direction: "out",
    category: "supplier",
    subject: PAYMENT,
    amount: "1000000",
    currency: "USDC",
    memo: "Invoice 7",
    gross: null,
    tax: null,
    counterparty: "Maya Chen",
    signatures: [SIGNATURE],
    created_at: "2026-09-28T12:00:00.000Z",
  };
}

/** One batch as the API returns it: the items and their manifest signed by `signer`. */
async function batch(input: {
  signer: Awaited<ReturnType<typeof wallet>>;
  entries: { id: string; viewer: string; ciphertext: Uint8Array }[];
  org?: string;
}): Promise<{ items: DisclosureItemView[]; manifests: ManifestView[] }> {
  const manifest = await buildManifest({
    org: input.org ?? ORG,
    createdAt: "2026-09-28T12:00:00.000Z",
    items: input.entries,
  });
  const signature = await input.signer.sign(await manifestMessage(manifest));
  const manifestId = crypto.randomUUID();
  return {
    items: input.entries.map((entry) => ({
      id: entry.id,
      grantId: null,
      kind: "payment",
      subject: PAYMENT,
      ciphertext: toBase64(entry.ciphertext),
      manifestId,
      createdAt: "2026-09-28T12:00:01.000Z",
    })),
    manifests: [
      {
        id: manifestId,
        signerWallet: input.signer.address,
        manifest,
        signature: toBase64(signature),
        createdAt: "2026-09-28T12:00:01.000Z",
      },
    ],
  };
}

describe("opening disclosures in the browser (I-9)", () => {
  it("opens an item the owner's manifest lists for this viewer, and refuses a tampered item, another signer and another viewer", async () => {
    const owner = await wallet("owner");
    const stranger = await wallet("stranger");
    const viewer = await viewingKey("viewer");
    const open = (ciphertext: Uint8Array) => openJson(ciphertext, viewer);
    const sealed = await sealPayload(payload(), viewer.publicKey);
    const good = await batch({
      signer: owner,
      entries: [{ id: crypto.randomUUID(), viewer: VIEWER, ciphertext: sealed }],
    });
    const common = { orgId: ORG, ownerWallet: owner.address, viewerUserId: VIEWER, open };

    const [opened] = await openDisclosures({ ...common, ...good });
    expect(opened?.state).toBe("opened");
    expect(opened?.state === "opened" ? opened.payload : null).toEqual(payload());

    // The server swaps in another ciphertext: its hash is not the one the owner signed.
    const other = await sealPayload({ ...payload(), amount: "999000000" }, viewer.publicKey);
    const tampered = {
      ...good,
      items: good.items.map((item) => ({ ...item, ciphertext: toBase64(other) })),
    };
    expect((await openDisclosures({ ...common, ...tampered }))[0]?.state).toBe("unverified");

    // A manifest another wallet signed, a manifest for another org, and an item for another viewer.
    const forged = await batch({
      signer: stranger,
      entries: [{ id: crypto.randomUUID(), viewer: VIEWER, ciphertext: sealed }],
    });
    expect((await openDisclosures({ ...common, ...forged }))[0]?.state).toBe("unverified");
    const replayed = await batch({
      signer: owner,
      org: OTHER_ORG,
      entries: [{ id: crypto.randomUUID(), viewer: VIEWER, ciphertext: sealed }],
    });
    expect((await openDisclosures({ ...common, ...replayed }))[0]?.state).toBe("unverified");
    const elsewhere = await batch({
      signer: owner,
      entries: [{ id: crypto.randomUUID(), viewer: OTHER_VIEWER, ciphertext: sealed }],
    });
    expect((await openDisclosures({ ...common, ...elsewhere }))[0]?.state).toBe("unverified");

    // A missing manifest.
    expect((await openDisclosures({ ...common, items: good.items, manifests: [] }))[0]?.state).toBe(
      "unverified",
    );
  });

  it("marks a verified item unreadable when it does not open with this key or names another org", async () => {
    const owner = await wallet("owner");
    const viewer = await viewingKey("viewer");
    const someoneElse = await viewingKey("someone else");
    const open = (ciphertext: Uint8Array) => openJson(ciphertext, viewer);
    const common = { orgId: ORG, ownerWallet: owner.address, viewerUserId: VIEWER, open };
    const notMine = await batch({
      signer: owner,
      entries: [
        {
          id: crypto.randomUUID(),
          viewer: VIEWER,
          ciphertext: await sealPayload(payload(), someoneElse.publicKey),
        },
      ],
    });
    expect((await openDisclosures({ ...common, ...notMine }))[0]?.state).toBe("unreadable");
    const otherOrg = await batch({
      signer: owner,
      entries: [
        {
          id: crypto.randomUUID(),
          viewer: VIEWER,
          ciphertext: await sealPayload(payload(OTHER_ORG), viewer.publicKey),
        },
      ],
    });
    expect((await openDisclosures({ ...common, ...otherOrg }))[0]?.state).toBe("unreadable");
  });
});
