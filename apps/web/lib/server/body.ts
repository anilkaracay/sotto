// Request bodies: a byte limit enforced while reading, JSON only, validated with zod (08).
import type { z } from "zod";
import { apiErrors } from "./errors.ts";

export const DEFAULT_MAX_BODY_BYTES = 16_384;

export async function readBodyText(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw apiErrors.payloadTooLarge(maxBytes);
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw apiErrors.payloadTooLarge(maxBytes);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw apiErrors.invalidRequest("Request body is not valid UTF-8");
  }
}

/** Parses a JSON body; the error message names the first invalid field, never its value. */
export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<{ data: T; text: string }> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) throw apiErrors.unsupportedMediaType();
  const text = await readBodyText(request, maxBytes);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw apiErrors.invalidRequest("Request body is not valid JSON");
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue && issue.path.length > 0 ? issue.path.join(".") : "body";
    throw apiErrors.invalidRequest(`Invalid request: ${where}: ${issue?.message ?? "invalid"}`);
  }
  return { data: result.data, text };
}
