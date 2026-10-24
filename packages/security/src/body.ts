/**
 * Reads a request body, refusing (null) as soon as it passes `maxBytes` - by the declared
 * Content-Length or while streaming - so an oversized upload is never held in memory.
 */
export async function readBodyLimited(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  // Typed stream: Node's lib types a body chunk as `any`.
  const reader = (request.body as ReadableStream<Uint8Array> | null)?.getReader();
  for (let next = await reader?.read(); next && !next.done; next = await reader?.read()) {
    const chunk = next.value;
    size += chunk.byteLength;
    if (size > maxBytes) {
      await reader?.cancel();
      return null;
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
