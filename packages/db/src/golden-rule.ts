// The golden rule for data (08 section 1): no column name may look like a plaintext amount outside the
// allow list, whose two columns hold amounts that are already public onchain (ENGINEERING-RULES.md rule 4).
export const FORBIDDEN_COLUMN_NAME = /amount|salary|balance|budget|gross|tax|net/i;

export const ALLOWED_AMOUNT_COLUMNS: ReadonlySet<string> = new Set([
  "proof_records.threshold_base_units",
  "chain_activity.public_amount_base_units",
]);

/** `table.column` names that break the golden rule. */
export function forbiddenColumns(columns: Iterable<{ table: string; column: string }>): string[] {
  const found: string[] = [];
  for (const { table, column } of columns) {
    const name = `${table}.${column}`;
    if (FORBIDDEN_COLUMN_NAME.test(column) && !ALLOWED_AMOUNT_COLUMNS.has(name)) found.push(name);
  }
  return found.sort();
}

/**
 * Step 2.4 (F-14, AC-14.1): the keys of access log metadata that break the golden rule, at any depth:
 * the log records metadata only, never amounts.
 */
export function forbiddenMetadataKeys(metadata: unknown, path = ""): string[] {
  if (Array.isArray(metadata)) {
    return metadata.flatMap((item, index) => forbiddenMetadataKeys(item, `${path}[${index}]`));
  }
  if (typeof metadata !== "object" || metadata === null) return [];
  return Object.entries(metadata as Record<string, unknown>).flatMap(([key, value]) => {
    const name = path ? `${path}.${key}` : key;
    return [
      ...(FORBIDDEN_COLUMN_NAME.test(key) ? [name] : []),
      ...forbiddenMetadataKeys(value, name),
    ];
  });
}
