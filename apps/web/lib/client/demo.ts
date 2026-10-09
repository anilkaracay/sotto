// The demo company in the browser (step 4.6, D-32). Read only by construction:
// - Every request is a GET of a demo route, carries the demo's header and sends no cookie, so the
//   server treats it as a demo request whatever session the browser holds.
// - The records open in a crypto worker of the demo's own, loaded with the role's published viewing
//   key. That worker opens sealed records and refuses everything else (crypto-worker/vault.ts).
// - Nothing here knows a wallet: no wallet library is imported by the demo's modules, so nothing can
//   ask for a signature or send a transaction (apps/web/test/demo-ui.test.tsx checks the imports).
import { DEMO_HEADER, type DemoKeyRole } from "../demo.ts";
import { CryptoWorkerClient } from "../crypto-worker/client.ts";
import type { DemoKeysView } from "../server/demo.ts";
import type { DisclosureItemView, ManifestView } from "../server/disclosures.ts";
import { openDisclosures, type OpenedDisclosure } from "./disclosures.ts";

export class DemoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoError";
  }
}

/** One read of a demo route. There is no other kind of request in the demo. */
export async function demoGet<T>(path: `/api/demo/${string}`): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "GET",
      headers: { [DEMO_HEADER]: "1" },
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    throw new DemoError("The demo company could not be reached. Check your connection.");
  }
  if (!response.ok) {
    throw new DemoError(
      response.status === 404
        ? "The demo company is not available here."
        : response.status === 429
          ? "Too many requests. Try again in a minute."
          : "The demo company could not be read.",
    );
  }
  return (await response.json()) as T;
}

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export type DemoReader = {
  /** Opens a sealed record with the role's key; resolves once the key is loaded. */
  open: (ciphertext: Uint8Array) => Promise<unknown>;
  close: () => void;
};

/**
 * A reader for one role: a worker loaded with that role's published viewing key. The key must be
 * the one the role's wallet registered (I-8): the worker answers the public key that follows from
 * the published secret key, and it is compared with the registered one before anything opens.
 */
export function createDemoReader(
  role: DemoKeyRole,
  keys: DemoKeysView,
  worker: CryptoWorkerClient = new CryptoWorkerClient(),
): DemoReader {
  const entry = keys.keys[role];
  const ready = worker.demoViewing(fromBase64(entry.viewingKey)).then((loaded) => {
    if (loaded.publicKey !== entry.registeredKey) {
      throw new DemoError("The published key is not the viewing key this wallet registered.");
    }
  });
  // A failure is reported by the first open, not as an unhandled rejection.
  ready.catch(() => {});
  return {
    open: async (ciphertext) => {
      await ready;
      return worker.openSealed(ciphertext);
    },
    close: () => worker.terminate(),
  };
}

export type DemoSealed = { items: DisclosureItemView[]; manifests: ManifestView[] };

/**
 * A role's records, opened the way the signed in app opens them (I-9): each manifest must name the
 * demo organization and carry its owner wallet's signature and list the item for this reader, and
 * only then is the item opened with the role's key.
 */
export async function openDemoRecords(input: {
  role: DemoKeyRole;
  keys: DemoKeysView;
  ownerWallet: string;
  viewerUserId: string;
  sealed: DemoSealed;
  reader?: DemoReader;
}): Promise<OpenedDisclosure[]> {
  const reader = input.reader ?? createDemoReader(input.role, input.keys);
  try {
    return await openDisclosures({
      orgId: input.keys.org.id,
      ownerWallet: input.ownerWallet,
      viewerUserId: input.viewerUserId,
      items: input.sealed.items,
      manifests: input.sealed.manifests,
      open: reader.open,
    });
  } finally {
    if (!input.reader) reader.close();
  }
}
