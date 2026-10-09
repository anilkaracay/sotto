// The demo company (step 4.6, D-32; founder, 2026-10-09): a visitor without a wallet reads one seeded
// organization on devnet as its owner, its accountant, one of its employees, or as an outsider. The
// server's part, all of it read only:
// - The configuration is a file on the server (DEMO_COMPANY_FILE): the organization's ID, the three
//   roles' wallets and their published viewing keys, and the payment the Compare views screen shows.
//   The keys are derived X25519 viewing keys. They open sealed records and nothing else; no wallet
//   signature and no key that signs is in the file, here or anywhere on the server.
// - It exists on the devnet configuration only, for the one organization the file names, whose owner,
//   accountant and recipient are the file's three wallets. Anything else is refused.
// - Every view reads through the functions the signed in app uses, as that role's user, inside a
//   PostgreSQL READ ONLY transaction: a write in any of them fails in the database itself.
// A demo visitor has no session. Requests of the demo carry the DEMO_HEADER, and the route wrapper
// refuses every route but the demo's own for such a request (api-route.ts).
import { readFileSync } from "node:fs";
import { memberships, orgs, proofRecords, users, viewerKeys, type Database } from "@sotto/db";
import type { AssetId } from "@sotto/sdk/cluster/assets";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { listActivity, type ActivityPaymentView } from "./activity.ts";
import { readBooks, type BooksView } from "./books.ts";
import { listChainActivity, type ChainActivityView } from "./chain-activity.ts";
import type { ServerCluster } from "./cluster.ts";
import { listDisclosures, type DisclosureItemView, type ManifestView } from "./disclosures.ts";
import {
  DEMO_BANNER,
  DEMO_KEY_ROLES,
  DEMO_ROLES,
  type DemoKeyRole,
  type DemoRole,
} from "../demo.ts";
import { DEMO_HEADER, demoErrors } from "./demo-guard.ts";
import { listGrants, type GrantView } from "./grants.ts";
import { readPay, type PayView } from "./pay.ts";
import type { Session } from "./session.ts";

export const DEMO_KEYS_LABEL =
  "Devnet demo keys of the demo company. They are derived viewing keys: they open the records sealed to these three demo wallets and cannot sign, spend, seal or revoke anything. The wallets are used for nothing else.";

export { DEMO_BANNER, DEMO_KEY_ROLES, DEMO_ROLES, type DemoKeyRole, type DemoRole };

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** A 32 byte key in base64. */
const KEY = /^[A-Za-z0-9+/]{43}=$/;
const roleSchema = z
  .object({ wallet: z.string().regex(BASE58), viewingKey: z.string().regex(KEY) })
  .strict();
const fileSchema = z
  .object({
    v: z.literal(1),
    cluster: z.literal("devnet"),
    orgId: z.uuid(),
    roles: z.object({ owner: roleSchema, accountant: roleSchema, employee: roleSchema }).strict(),
    /** The payment the Compare views screen shows from every role's side. */
    comparePaymentId: z.uuid(),
  })
  .strict();
export type DemoFile = z.infer<typeof fileSchema>;

export { DEMO_HEADER, demoErrors };

type Env = Record<string, string | undefined>;

/** The file's contents, or null when it is not configured, cannot be read or is not well formed. */
export function readDemoFile(env: Env = process.env): DemoFile | null {
  const path = env.DEMO_COMPANY_FILE?.trim();
  if (!path) return null;
  try {
    const parsed = fileSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type DemoRoleInfo = {
  userId: string;
  wallet: string;
  /** The viewing public key the role's wallet registered (I-8); the browser checks the key against it. */
  registeredKey: string;
};

export type DemoCompany = {
  file: DemoFile;
  org: { id: string; displayName: string; legalName: string; asset: AssetId };
  ownerWallet: string;
  roles: Record<DemoKeyRole, DemoRoleInfo>;
};

const MEMBERSHIP: Record<DemoKeyRole, "owner" | "accountant" | "recipient"> = {
  owner: "owner",
  accountant: "accountant",
  employee: "recipient",
};

type Reader = Pick<Database, "select">;

/**
 * The demo company, or null. It exists only where the configured cluster is devnet and the file
 * names an active organization whose owner, accountant and recipient are the file's wallets, each
 * with a registered viewing key. A file for another organization's people opens nothing.
 */
export async function loadDemoCompany(
  db: Reader,
  cluster: ServerCluster | null,
  env: Env = process.env,
): Promise<DemoCompany | null> {
  if (cluster?.config.name !== "devnet") return null;
  const file = readDemoFile(env);
  if (!file) return null;
  const [org] = await db
    .select({
      id: orgs.id,
      displayName: orgs.displayName,
      legalName: orgs.legalName,
      asset: orgs.asset,
      status: orgs.status,
      ownerWallet: users.wallet,
    })
    .from(orgs)
    .innerJoin(users, eq(users.id, orgs.ownerUserId))
    .where(eq(orgs.id, file.orgId))
    .limit(1);
  if (!org || org.status !== "active" || org.ownerWallet !== file.roles.owner.wallet) return null;
  const roles = {} as Record<DemoKeyRole, DemoRoleInfo>;
  for (const role of DEMO_KEY_ROLES) {
    const [member] = await db
      .select({ userId: users.id, wallet: users.wallet, key: viewerKeys.publicKey })
      .from(users)
      .innerJoin(
        memberships,
        and(
          eq(memberships.userId, users.id),
          eq(memberships.orgId, org.id),
          eq(memberships.role, MEMBERSHIP[role]),
          isNull(memberships.removedAt),
        ),
      )
      .innerJoin(viewerKeys, and(eq(viewerKeys.userId, users.id), eq(viewerKeys.status, "active")))
      .where(eq(users.wallet, file.roles[role].wallet))
      .limit(1);
    if (!member) return null;
    roles[role] = {
      userId: member.userId,
      wallet: member.wallet,
      registeredKey: Buffer.from(member.key).toString("base64"),
    };
  }
  return {
    file,
    org: { id: org.id, displayName: org.displayName, legalName: org.legalName, asset: org.asset },
    ownerWallet: org.ownerWallet,
    roles,
  };
}

/** What the role picker and the banner need: no key, no record. */
export type DemoSummary = {
  org: DemoCompany["org"];
  cluster: "devnet";
  roles: readonly DemoRole[];
};

export function demoSummary(demo: DemoCompany): DemoSummary {
  return { org: demo.org, cluster: "devnet", roles: DEMO_ROLES };
}

/** The published keys, with what they are and whose organization they open. */
export type DemoKeysView = {
  label: string;
  cluster: "devnet";
  org: { id: string; legalName: string };
  keys: Record<DemoKeyRole, { wallet: string; viewingKey: string; registeredKey: string }>;
};

export function demoKeys(demo: DemoCompany): DemoKeysView {
  const keys = {} as DemoKeysView["keys"];
  for (const role of DEMO_KEY_ROLES) {
    keys[role] = {
      wallet: demo.roles[role].wallet,
      viewingKey: demo.file.roles[role].viewingKey,
      registeredKey: demo.roles[role].registeredKey,
    };
  }
  return {
    label: DEMO_KEYS_LABEL,
    cluster: "devnet",
    org: { id: demo.org.id, legalName: demo.org.legalName },
    keys,
  };
}

/** Runs `read` in a READ ONLY transaction: any write inside it fails in PostgreSQL (SQLSTATE 25006). */
export function readOnly<T>(db: Database, read: (tx: Database) => Promise<T>): Promise<T> {
  return db.transaction((tx) => read(tx as unknown as Database), { accessMode: "read only" });
}

/** The role's user as the read functions expect it. It is no session: nothing stores or accepts it. */
function as(demo: DemoCompany, role: DemoKeyRole): Session {
  return { id: `demo:${role}`, userId: demo.roles[role].userId, wallet: demo.roles[role].wallet };
}

type Sealed = { items: DisclosureItemView[]; manifests: ManifestView[] };
type Common = {
  org: DemoCompany["org"];
  ownerWallet: string;
  /** The role's own user, whose items these are. */
  viewerUserId: string;
};

export type DemoProofView = {
  recordAddress: string;
  threshold: string;
  /** Who the proof was made for. It is not onchain, so the outsider's view leaves it out. */
  counterpartyLabel: string | null;
  expiry: string;
  createdAt: string;
};

async function proofsOf(db: Reader, orgId: string): Promise<DemoProofView[]> {
  const rows = await db
    .select()
    .from(proofRecords)
    .where(eq(proofRecords.orgId, orgId))
    .orderBy(desc(proofRecords.createdAt))
    .limit(20);
  return rows.map((row) => ({
    recordAddress: row.recordAddress,
    threshold: row.thresholdBaseUnits.toString(),
    counterpartyLabel: row.counterpartyLabel,
    expiry: row.expiry.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }));
}

export type DemoOwnerView = Common & {
  role: "owner";
  /** The owner's own records: payments, payroll lines and balance snapshots. */
  sealed: Sealed;
  payments: ActivityPaymentView[];
  grants: GrantView[];
  proofs: DemoProofView[];
  chain: ChainActivityView[];
};
export type DemoAccountantView = Common & { role: "accountant"; sealed: Sealed; books: BooksView };
export type DemoEmployeeView = Common & { role: "employee"; sealed: Sealed; pay: PayView };
export type DemoOutsiderView = {
  role: "outsider";
  org: DemoCompany["org"];
  ownerWallet: string;
  /** What anyone reads on the chain: who, to whom and when. No amount is in it. */
  chain: ChainActivityView[];
  proofs: DemoProofView[];
};
export type DemoRoleView = DemoOwnerView | DemoAccountantView | DemoEmployeeView | DemoOutsiderView;

export async function demoRoleView(
  db: Database,
  demo: DemoCompany,
  role: DemoRole,
  cluster: ServerCluster,
  now = new Date(),
): Promise<DemoRoleView> {
  const orgId = demo.org.id;
  return readOnly(db, async (tx): Promise<DemoRoleView> => {
    if (role === "outsider") {
      return {
        role,
        org: demo.org,
        ownerWallet: demo.ownerWallet,
        chain: await listChainActivity(tx, as(demo, "owner"), orgId, 50),
        proofs: (await proofsOf(tx, orgId)).map((proof) => ({ ...proof, counterpartyLabel: null })),
      };
    }
    const session = as(demo, role);
    const common: Common = {
      org: demo.org,
      ownerWallet: demo.ownerWallet,
      viewerUserId: session.userId,
    };
    const sealed = await listDisclosures(tx, session, orgId, {}, now, { touch: false });
    if (role === "owner") {
      const [activity, grantList, proofs, chain] = [
        await listActivity(tx, session, orgId, 50, now),
        await listGrants(tx, session, orgId, now),
        await proofsOf(tx, orgId),
        await listChainActivity(tx, session, orgId, 50),
      ];
      return {
        ...common,
        role,
        sealed,
        payments: activity.payments,
        grants: grantList.grants,
        proofs,
        chain,
      };
    }
    if (role === "accountant") {
      return { ...common, role, sealed, books: await readBooks(tx, session, orgId, now) };
    }
    return { ...common, role, sealed, pay: await readPay(tx, session, orgId, cluster, now) };
  });
}

/** One payment as each role's own view holds it (the Compare views screen). */
export type DemoCompareView = {
  org: DemoCompany["org"];
  ownerWallet: string;
  paymentId: string;
  /** The owner's record of the payment, from the owner's view; null if that view has none. */
  owner: { viewerUserId: string; item: DisclosureItemView | null; manifests: ManifestView[] };
  /** The accountant's copy under the grant, from the accountant's view. */
  accountant: {
    viewerUserId: string;
    item: DisclosureItemView | null;
    manifests: ManifestView[];
    grant: BooksView["grants"][number] | null;
  };
  /** The employee's view: whether it holds this payment at all, and how many records it does hold. */
  employee: {
    viewerUserId: string;
    item: DisclosureItemView | null;
    manifests: ManifestView[];
    records: number;
  };
  /** The transfer as the chain shows it; no amount. */
  outsider: {
    chain: ChainActivityView | null;
    signature: string | null;
    from: string | null;
    to: string | null;
    blockTime: string | null;
  };
  recipient: string | null;
};

export async function demoCompareView(
  db: Database,
  demo: DemoCompany,
  cluster: ServerCluster,
  now = new Date(),
): Promise<DemoCompareView> {
  const paymentId = demo.file.comparePaymentId;
  const [owner, accountant, employee, outsider] = [
    (await demoRoleView(db, demo, "owner", cluster, now)) as DemoOwnerView,
    (await demoRoleView(db, demo, "accountant", cluster, now)) as DemoAccountantView,
    (await demoRoleView(db, demo, "employee", cluster, now)) as DemoEmployeeView,
    (await demoRoleView(db, demo, "outsider", cluster, now)) as DemoOutsiderView,
  ];
  const pick = (sealed: Sealed) => {
    const item = sealed.items.find((entry) => entry.subject === paymentId) ?? null;
    return {
      item,
      manifests: item ? sealed.manifests.filter((entry) => entry.id === item.manifestId) : [],
    };
  };
  // The transfer's public side comes from the books' payment row and the chain rows, both without
  // an amount.
  const booked = accountant.books.payments.find((payment) => payment.id === paymentId) ?? null;
  const signature = booked?.chain?.signature ?? null;
  return {
    org: demo.org,
    ownerWallet: demo.ownerWallet,
    paymentId,
    owner: { viewerUserId: owner.viewerUserId, ...pick(owner.sealed) },
    accountant: {
      viewerUserId: accountant.viewerUserId,
      ...pick(accountant.sealed),
      grant: accountant.books.grants[0] ?? null,
    },
    employee: {
      viewerUserId: employee.viewerUserId,
      ...pick(employee.sealed),
      records: employee.sealed.items.length,
    },
    outsider: {
      chain: signature ? (outsider.chain.find((row) => row.signature === signature) ?? null) : null,
      signature,
      from: booked?.chain?.from ?? null,
      to: booked?.chain?.to ?? null,
      blockTime: booked?.chain?.blockTime ?? null,
    },
    recipient:
      owner.payments.find((payment) => payment.id === paymentId)?.recipient.displayName ?? null,
  };
}
