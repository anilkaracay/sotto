// The sotto_proofs IDL and client (step 2.7, D-16): the committed JSON is what the hand written nodes
// of proofs-idl.ts produce; the generated client in packages/sdk/src/proofs/generated is what Codama
// renders from them now; and the IDL's errors, account sizes and instruction discriminators are the
// program's (programs/sotto_proofs/src/error.rs, state.rs, instruction.rs).
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { renderVisitor } from "@codama/renderers-js";
import { visit } from "@codama/visitors-core";
import { describe, expect, it } from "vitest";
import { IDL_PATH, idlJson, RENDER_OPTIONS } from "../generate-proofs-client.ts";
import { sottoProofsIdl } from "../proofs-idl.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PROGRAM = join(ROOT, "programs/sotto_proofs/src");
const GENERATED = join(ROOT, "packages/sdk/src/proofs/generated");

function files(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (path: string) => {
    for (const name of readdirSync(path)) {
      const full = join(path, name);
      if (statSync(full).isDirectory()) walk(full);
      else out[relative(dir, full)] = readFileSync(full, "utf8");
    }
  };
  walk(dir);
  return out;
}

describe("sotto_proofs IDL", () => {
  it("is the committed JSON", () => {
    expect(readFileSync(IDL_PATH, "utf8")).toBe(idlJson());
  });

  it("renders with the repository's Prettier settings", async () => {
    const specifier: string = "@sotto/config/prettier";
    const { default: config } = (await import(specifier)) as { default: unknown };
    expect(RENDER_OPTIONS.prettierOptions).toEqual(config);
  });

  it("renders to the committed client", async () => {
    const folder = mkdtempSync(join(tmpdir(), "sotto-proofs-client-"));
    await visit(sottoProofsIdl(), renderVisitor(folder, RENDER_OPTIONS));
    expect(files(join(folder, RENDER_OPTIONS.generatedFolder))).toEqual(files(GENERATED));
  }, 60_000);

  it("names the program's errors, account sizes and instruction discriminators", () => {
    const { errors = [], accounts = [], instructions = [] } = sottoProofsIdl().program;
    const rust = readFileSync(join(PROGRAM, "error.rs"), "utf8");
    const variants = [...rust.matchAll(/^\s+([A-Z][A-Za-z]+) = (\d+),$/gm)].map((match) => [
      (match[1] as string).charAt(0).toLowerCase() + (match[1] as string).slice(1),
      Number(match[2]),
    ]);
    expect(variants).toHaveLength(17);
    expect(errors.map((error) => [error.name, error.code])).toEqual(variants);

    const state = readFileSync(join(PROGRAM, "state.rs"), "utf8");
    const sizes = [...state.matchAll(/pub const LEN: usize = ([\d +]+);/g)].map((match) =>
      (match[1] as string).split("+").reduce((sum, part) => sum + Number(part.trim()), 0),
    );
    expect(accounts.map((account) => account.size)).toEqual(sizes);
    expect(sizes).toEqual([67, 194]);

    const instruction = readFileSync(join(PROGRAM, "instruction.rs"), "utf8");
    const tags = Object.fromEntries(
      [...instruction.matchAll(/^pub const ([A-Z_]+): u8 = (\d);$/gm)].map((match) => [
        (match[1] as string)
          .toLowerCase()
          .replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
        Number(match[2]),
      ]),
    );
    expect(
      Object.fromEntries(
        instructions.map((node) => {
          const discriminator = (node.arguments ?? []).find(
            (argument) => argument.name === "discriminator",
          );
          return [node.name, (discriminator?.defaultValue as { number: number }).number];
        }),
      ),
    ).toEqual(tags);
  });
});
