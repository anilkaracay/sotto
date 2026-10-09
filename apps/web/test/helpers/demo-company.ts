// A demo company in a test database (step 4.6, D-32): what the Northwind seed leaves on devnet, written
// straight into the tables, for the demo's API tests and its browser spec. Three people with real
// keypairs (the owner, an accountant with a grant for the month, an employee paid in a payroll run),
// a supplier, four settled payments with their chain rows, the owner's balance snapshot, a proof
// record, and every record sealed to its reader's viewing key under manifests the owner's wallet
// signs. It returns the demo file's contents: the roles' wallets and their derived viewing keys.
import { createHash, randomUUID } from "node:crypto";
import {
  chainActivity,
  disclosures,
  grants,
  invites,
  manifests,
  memberships,
  orgs,
  paymentAttempts,
  payments,
  payrollRuns,
  proofRecords,
  recipients,
  users,
  viewerKeys,
  type Database,
} from "@sotto/db";
import { buildManifest, manifestMessage, type DisclosurePayloadV1 } from "@sotto/sdk/disclosure";
import { sealPayload } from "@sotto/sdk/disclosure/seal";
import { deriveViewingKey, viewKeyMessage } from "@sotto/sdk/keys";
import { viewKeyRegistrationMessage } from "@sotto/sdk/keys/public";
import {
  createKeyPairFromPrivateKeyBytes,
  getAddressFromPublicKey,
  getBase58Decoder,
  signBytes,
} from "@solana/kit";

const DEVUSD = 1_000_000n;
const base58 = (seed: string, length: 32 | 64) =>
  getBase58Decoder().decode(
    length === 32
      ? createHash("sha256").update(seed).digest()
      : createHash("sha512").update(seed).digest(),
  );

async function person(seed: string) {
  const keys = await createKeyPairFromPrivateKeyBytes(
    new Uint8Array(createHash("sha256").update(`sotto-demo-fixture/${seed}`).digest()),
  );
  const wallet = await getAddressFromPublicKey(keys.publicKey);
  const sign = async (message: Uint8Array) =>
    new Uint8Array(await signBytes(keys.privateKey, message));
  const viewing = await deriveViewingKey(wallet, await sign(viewKeyMessage(wallet)));
  return { wallet, sign, viewing };
}

export type DemoFixture = Awaited<ReturnType<typeof seedDemoCompany>>;

/** Writes the demo company and returns its ids, its people's keys and the demo file's contents. */
export async function seedDemoCompany(db: Database, tag = "a") {
  const [elif, daniel, maya, jonas] = await Promise.all([
    person(`${tag}/elif`),
    person(`${tag}/daniel`),
    person(`${tag}/maya`),
    person(`${tag}/jonas`),
  ]);
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const day = (n: number) => `${month}-${String(n).padStart(2, "0")}`;
  const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();

  const insertUser = async (wallet: string) => {
    const [row] = await db.insert(users).values({ wallet }).returning({ id: users.id });
    if (!row) throw new Error("user not inserted");
    return row.id;
  };
  const ids = {
    elif: await insertUser(elif.wallet),
    daniel: await insertUser(daniel.wallet),
    maya: await insertUser(maya.wallet),
    jonas: await insertUser(jonas.wallet),
  };
  for (const [who, userId] of [
    [elif, ids.elif],
    [daniel, ids.daniel],
    [maya, ids.maya],
    [jonas, ids.jonas],
  ] as const) {
    await db.insert(viewerKeys).values({
      userId,
      publicKey: Buffer.from(who.viewing.publicKey),
      registrationSignature: Buffer.from(
        await who.sign(viewKeyRegistrationMessage(who.viewing.publicKey)),
      ),
    });
  }

  const [org] = await db
    .insert(orgs)
    .values({
      displayName: "Northwind Labs",
      legalName: "Northwind Labs Demo Ltd",
      country: "GB",
      registrationNo: "NW 0001",
      website: "https://northwind.example",
      contactEmail: "finance@northwind.example",
      ownerUserId: ids.elif,
      status: "active",
      asset: "devusd",
      reviewedAt: now,
    })
    .returning({ id: orgs.id });
  if (!org) throw new Error("org not inserted");
  const orgId = org.id;
  await db.insert(memberships).values([
    { orgId, userId: ids.elif, role: "owner" },
    { orgId, userId: ids.daniel, role: "accountant" },
    { orgId, userId: ids.maya, role: "recipient" },
    { orgId, userId: ids.jonas, role: "recipient" },
  ]);

  const addRecipient = async (values: {
    displayName: string;
    roleTitle?: string;
    wallet: string;
    userId?: string;
  }) => {
    const [row] = await db
      .insert(recipients)
      .values({ orgId, ...values })
      .returning({ id: recipients.id });
    if (!row) throw new Error("recipient not inserted");
    return row.id;
  };
  const people = {
    maya: await addRecipient({
      displayName: "Maya Chen",
      roleTitle: "Design lead",
      wallet: maya.wallet,
      userId: ids.maya,
    }),
    jonas: await addRecipient({
      displayName: "Jonas Weber",
      roleTitle: "Engineer",
      wallet: jonas.wallet,
      userId: ids.jonas,
    }),
    atlas: await addRecipient({
      displayName: "Atlas Freight",
      wallet: base58(`${tag}/atlas`, 32),
    }),
    halden: await addRecipient({ displayName: "Halden OTC", wallet: base58(`${tag}/halden`, 32) }),
  };

  const [run] = await db
    .insert(payrollRuns)
    .values({
      orgId,
      title: "Monthly payroll",
      period: month,
      idempotencyKey: randomUUID(),
      lineCount: 2,
      createdBy: ids.elif,
      status: "settled",
    })
    .returning({ id: payrollRuns.id });
  if (!run) throw new Error("run not inserted");

  const orgAccount = base58(`${tag}/org-account`, 32);
  let slot = 420_000_000n;
  let lineNo = 0;
  type Paid = {
    id: string;
    signature: string;
    settledAt: string;
    to: string;
    payload: Omit<DisclosurePayloadV1, "v" | "org" | "subject" | "signatures" | "created_at">;
  };
  const settle = async (input: {
    kind: "single" | "payroll_line";
    recipientId: string;
    settledAt: string;
    payload: Paid["payload"];
  }): Promise<Paid> => {
    const [row] = await db
      .insert(payments)
      .values({
        orgId,
        kind: input.kind,
        runId: input.kind === "payroll_line" ? run.id : null,
        lineNo: input.kind === "payroll_line" ? (lineNo += 1) : null,
        recipientId: input.recipientId,
        idempotencyKey: randomUUID(),
        createdBy: ids.elif,
        status: "settled",
        settledAt: new Date(input.settledAt),
      })
      .returning({ id: payments.id });
    if (!row) throw new Error("payment not inserted");
    const signature = base58(`${tag}/signature/${row.id}`, 64);
    const to = base58(`${tag}/account/${input.recipientId}`, 32);
    await db.insert(paymentAttempts).values({
      paymentId: row.id,
      attemptNo: 1,
      signatures: [signature],
      status: "finalized",
      transferSignature: signature,
    });
    slot += 1_000n;
    await db.insert(chainActivity).values({
      orgId,
      tokenAccount: orgAccount,
      signature,
      slot,
      blockTime: new Date(input.settledAt),
      instructionIndex: 0,
      instructionType: "transfer_out",
      counterpartyAddress: to,
    });
    return { id: row.id, signature, settledAt: input.settledAt, to, payload: input.payload };
  };
  const line = (counterparty: string, net: bigint, gross: bigint): Paid["payload"] => ({
    kind: "payroll_line",
    direction: "out",
    category: "payroll",
    amount: (net * DEVUSD).toString(),
    currency: "devUSD",
    memo: "Monthly salary",
    gross: (gross * DEVUSD).toString(),
    tax: ((gross - net) * DEVUSD).toString(),
    counterparty,
  });
  const single = (counterparty: string, whole: bigint, memo: string): Paid["payload"] => ({
    kind: "payment",
    direction: "out",
    category: "supplier",
    amount: (whole * DEVUSD).toString(),
    currency: "devUSD",
    memo,
    gross: null,
    tax: null,
    counterparty,
  });
  const paid = {
    mayaLine: await settle({
      kind: "payroll_line",
      recipientId: people.maya,
      settledAt: `${day(2)}T09:00:00.000Z`,
      payload: line("Maya Chen", 9_400n, 12_400n),
    }),
    jonasLine: await settle({
      kind: "payroll_line",
      recipientId: people.jonas,
      settledAt: `${day(2)}T09:00:00.000Z`,
      payload: line("Jonas Weber", 7_150n, 9_600n),
    }),
    atlas: await settle({
      kind: "single",
      recipientId: people.atlas,
      settledAt: `${day(3)}T14:30:00.000Z`,
      payload: single("Atlas Freight", 48_200n, "Freight, invoice 2291"),
    }),
    halden: await settle({
      kind: "single",
      recipientId: people.halden,
      settledAt: `${day(4)}T11:15:00.000Z`,
      payload: single("Halden OTC", 12_750n, "Desk fee"),
    }),
  };
  // The funding: a confidential deposit, whose amount is public onchain.
  slot += 1_000n;
  const depositSignature = base58(`${tag}/deposit`, 64);
  await db.insert(chainActivity).values({
    orgId,
    tokenAccount: orgAccount,
    signature: depositSignature,
    slot: 419_000_000n,
    blockTime: new Date(`${day(1)}T08:00:00.000Z`),
    instructionIndex: 0,
    instructionType: "deposit",
    publicAmountBaseUnits: 1_500_000n * DEVUSD,
  });

  /** An accepted invite, which every grant comes from (07 section 7). */
  const invite = async (
    role: "accountant" | "recipient",
    acceptedBy: string,
    recipientId: string | null,
  ) => {
    const token = createHash("sha256").update(randomUUID()).digest("hex");
    await db.insert(invites).values({
      token,
      orgId,
      role,
      createdBy: ids.elif,
      expiresAt: new Date(now.getTime() + 7 * 24 * 3600 * 1000),
      acceptedBy,
      acceptedAt: now,
      recipientId,
    });
    return token;
  };
  const [grant] = await db
    .insert(grants)
    .values({
      orgId,
      viewerUserId: ids.daniel,
      inviteToken: await invite("accountant", ids.daniel, null),
      scope: "period",
      periodFrom: day(1),
      periodTo: day(lastDay),
      status: "active",
      createdBy: ids.elif,
      holderName: "Daniel Osei",
      holderTitle: "Accountant, external",
      activatedAt: now,
    })
    .returning({ id: grants.id });
  if (!grant) throw new Error("grant not inserted");
  for (const [userId, recipientId] of [
    [ids.maya, people.maya],
    [ids.jonas, people.jonas],
  ] as const) {
    await db.insert(grants).values({
      orgId,
      viewerUserId: userId,
      inviteToken: await invite("recipient", userId, recipientId),
      scope: "own_payslips",
      status: "active",
      createdBy: ids.elif,
      activatedAt: now,
    });
  }

  /** Records under one manifest the owner's wallet signs, each sealed to its reader's viewing key. */
  type Entry = {
    viewerUserId: string;
    publicKey: Uint8Array;
    grantId: string | null;
    payload: DisclosurePayloadV1;
  };
  const store = async (entries: Entry[]) => {
    const items = await Promise.all(
      entries.map(async (entry) => ({
        id: randomUUID(),
        entry,
        ciphertext: await sealPayload(entry.payload, entry.publicKey),
      })),
    );
    const manifest = await buildManifest({
      org: orgId,
      createdAt: now.toISOString(),
      items: items.map((item) => ({
        id: item.id,
        viewer: item.entry.viewerUserId,
        ciphertext: item.ciphertext,
      })),
    });
    const [stored] = await db
      .insert(manifests)
      .values({
        orgId,
        signerWallet: elif.wallet,
        manifest,
        signature: Buffer.from(await elif.sign(await manifestMessage(manifest))),
      })
      .returning({ id: manifests.id });
    if (!stored) throw new Error("manifest not inserted");
    await db.insert(disclosures).values(
      items.map((item) => ({
        id: item.id,
        orgId,
        grantId: item.entry.grantId,
        viewerUserId: item.entry.viewerUserId,
        kind: item.entry.payload.kind,
        subject: item.entry.payload.subject,
        ciphertext: Buffer.from(item.ciphertext),
        manifestId: stored.id,
      })),
    );
  };
  const payloadOf = (entry: Paid): DisclosurePayloadV1 => ({
    v: 1,
    org: orgId,
    subject: entry.id,
    signatures: [entry.signature],
    created_at: entry.settledAt,
    ...entry.payload,
  });
  const all = Object.values(paid);
  const available = (1_500_000n - 9_400n - 7_150n - 48_200n - 12_750n) * DEVUSD;
  const snapshot: DisclosurePayloadV1 = {
    v: 1,
    org: orgId,
    kind: "balance_snapshot",
    direction: "in",
    category: "other",
    subject: now.toISOString().slice(0, 10),
    amount: available.toString(),
    currency: "devUSD",
    memo: null,
    gross: null,
    tax: null,
    counterparty: null,
    signatures: [],
    created_at: now.toISOString(),
    pending: "0",
  };
  const to = (
    reader: { viewing: { publicKey: Uint8Array } },
    viewerUserId: string,
    grantId: string | null,
    payload: DisclosurePayloadV1,
  ): Entry => ({ viewerUserId, publicKey: reader.viewing.publicKey, grantId, payload });
  // The owner's own records, the accountant's copies under the grant, and each employee's payslip.
  await store([
    ...all.map((entry) => to(elif, ids.elif, null, payloadOf(entry))),
    to(elif, ids.elif, null, snapshot),
  ]);
  await store(all.map((entry) => to(daniel, ids.daniel, grant.id, payloadOf(entry))));
  await store([
    to(maya, ids.maya, null, payloadOf(paid.mayaLine)),
    to(jonas, ids.jonas, null, payloadOf(paid.jonasLine)),
  ]);

  const proofRecord = base58(`${tag}/proof-record`, 32);
  await db.insert(proofRecords).values({
    orgId,
    cluster: "devnet",
    recordAddress: proofRecord,
    thresholdBaseUnits: 250_000n * DEVUSD,
    counterpartyLabel: "Atlas Freight",
    counterpartySalt: Buffer.alloc(16, 7),
    expiry: new Date(now.getTime() + 180 * 24 * 3600 * 1000),
  });

  const key = (who: { viewing: { secretKey: Uint8Array } }) =>
    Buffer.from(who.viewing.secretKey).toString("base64");
  return {
    orgId,
    ids,
    wallets: { elif: elif.wallet, daniel: daniel.wallet, maya: maya.wallet, jonas: jonas.wallet },
    /** The people's signing functions and derived keys, for what a test checks against them. */
    keys: { elif, daniel, maya, jonas },
    grantId: grant.id,
    paid,
    orgAccount,
    depositSignature,
    proofRecord,
    snapshot: { available: available.toString(), day: snapshot.subject },
    /** The demo file's contents (DEMO_COMPANY_FILE): the roles' wallets and published viewing keys. */
    file: {
      v: 1 as const,
      cluster: "devnet" as const,
      orgId,
      roles: {
        owner: { wallet: elif.wallet, viewingKey: key(elif) },
        accountant: { wallet: daniel.wallet, viewingKey: key(daniel) },
        employee: { wallet: maya.wallet, viewingKey: key(maya) },
      },
      comparePaymentId: paid.atlas.id,
    },
  };
}
