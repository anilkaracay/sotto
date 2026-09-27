// scripts/recover-balance.ts against a confidential balance that the spl-token CLI created on localnet
// (step 1.6, /app/recovery). Skipped unless SOTTO_LOCALNET_RPC_URL is set; scripts/ci-local.sh runs it
// in the localnet job, where the Solana tools are installed.
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RPC_URL = process.env.SOTTO_LOCALNET_RPC_URL;
const SCRIPT = fileURLToPath(new URL("../recover-balance.ts", import.meta.url));

/** A Solana keypair file (seed, then public key) for a fresh Ed25519 key. */
function keypairFile(dir: string, name: string): string {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify([...seed, ...pub]), { mode: 0o600 });
  return path;
}

describe.skipIf(!RPC_URL)("recover-balance on localnet", () => {
  it(
    "prints the exact pending and available balance of a CLI created account and sends nothing",
    { timeout: 240_000 },
    () => {
      const dir = mkdtempSync(join(tmpdir(), "sotto-recover-"));
      try {
        const keypair = keypairFile(dir, "owner.json");
        const config = join(dir, "cli.yml");
        writeFileSync(
          config,
          `---\njson_rpc_url: "${RPC_URL}"\nwebsocket_url: ""\nkeypair_path: ${keypair}\naddress_labels: {}\ncommitment: confirmed\n`,
        );
        const run = (command: string, args: string[]) =>
          execFileSync(command, args, { encoding: "utf8" });
        const spl = (...args: string[]) =>
          run("spl-token", ["-C", config, "--program-2022", ...args]);
        const recover = (key: string, ...extra: string[]) =>
          run(process.execPath, [SCRIPT, "--keypair", key, "--url", RPC_URL as string, ...extra]);
        const wallet = run("solana-keygen", ["pubkey", keypair]).trim();
        run("solana", ["-C", config, "airdrop", "5"]);

        const created = JSON.parse(
          spl(
            "--output",
            "json",
            "create-token",
            "--enable-confidential-transfers",
            "auto",
            "--decimals",
            "6",
          ),
        ) as { commandOutput: { address: string } };
        const mint = created.commandOutput.address;
        spl("create-account", mint);
        spl("configure-confidential-transfer-account", mint);
        spl("mint", mint, "100");
        spl("deposit-confidential-tokens", mint, "12.345678");

        const activity = () => {
          const signatures = run("solana", [
            "-C",
            config,
            "transaction-history",
            wallet,
            "--limit",
            "1000",
          ]);
          const balance = run("solana", ["-C", config, "balance", wallet, "--lamports"]);
          return `${signatures}\n${balance}`;
        };
        const before = activity();
        const pending = recover(keypair, "--mint", mint);
        expect(pending).toContain(`Wallet             ${wallet}`);
        expect(pending).toContain("(associated token account)");
        expect(pending).toContain("Available balance  0 (0 base units)");
        expect(pending).toContain(
          "Pending balance    12.345678 (12345678 base units, 1 pending credits)",
        );
        expect(pending).toContain(`spl-token apply-pending-balance ${mint}`);
        // The script sent nothing: no new signature for the wallet and no fee paid.
        expect(activity()).toBe(before);

        spl("apply-pending-balance", mint);
        const available = recover(keypair, "--mint", mint);
        expect(available).toContain("Available balance  12.345678 (12345678 base units)");
        expect(available).toContain("Pending balance    0 (0 base units, 0 pending credits)");
        const command = available.match(/spl-token withdraw-confidential-tokens .*/)?.[0] ?? "";
        expect(command).toBe(`spl-token withdraw-confidential-tokens ${mint} 12.345678`);

        // The printed command, run as is, moves exactly everything back to the public balance.
        spl(...command.split(" ").slice(1));
        expect(spl("balance", mint).trim()).toBe("100");
        expect(recover(keypair, "--mint", mint)).toContain(
          "Nothing to withdraw: the confidential balance is 0.",
        );

        // Another wallet's keypair is refused for this account.
        const account = spl("address", "--token", mint, "--verbose").match(
          /Associated token address: (\S+)/,
        )?.[1];
        expect(account).toBeTruthy();
        const other = keypairFile(dir, "other.json");
        expect(() =>
          execFileSync(
            process.execPath,
            [
              SCRIPT,
              "--keypair",
              other,
              "--url",
              RPC_URL as string,
              "--account",
              account as string,
            ],
            {
              encoding: "utf8",
              stdio: "pipe",
            },
          ),
        ).toThrow(/belongs to/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
