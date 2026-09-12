import canonicalize from "canonicalize";
import { createSHA256 } from "hash-wasm";
import type { Manifest } from "./types";

export async function hashBlob(blob: Blob, signal?: AbortSignal) {
    const hash = await createSHA256(); const reader = blob.stream().getReader();
    try {
        for (;;) { signal?.throwIfAborted(); const chunk = await reader.read(); if (chunk.done) break; hash.update(chunk.value); }
        return hash.digest("hex");
    } finally { await reader.cancel(); reader.releaseLock(); }
}
export function hashManifest(manifest: Manifest, signal?: AbortSignal) { return hashBlob(new Blob([canonicalize(manifest)!]), signal); }
