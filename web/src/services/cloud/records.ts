import canonicalize from "canonicalize";
import { hashBlob } from "./hash";
import type { Domain, Json, Manifest } from "./types";

export type SyncRecord = { key: string; hash: string; label: string; manifest: Manifest };

// Each record is a valid, independently restorable manifest. Array positions are local to that record.
export async function splitRecords(manifest: Manifest): Promise<SyncRecord[]> {
    const records: SyncRecord[] = [];
    for (const domain of manifest.domains) {
        const slices: { field: string; id: string; value: Json; index?: number }[] = [];
        for (const [field, value] of Object.entries(domain.data)) {
            if (field === "deleted") continue;
            if (Array.isArray(value)) value.forEach((item, index) => slices.push({ field, id: String((item as Record<string, Json>).id), value: item, index }));
            else if (value !== null) slices.push({ field, id: "singleton", value });
        }
        for (const slice of slices) {
            if (!slice.id || slice.id === "undefined") throw new Error("同步记录缺少稳定 ID");
            const data: Domain["data"] = Object.fromEntries(Object.entries(domain.data).map(([key, value]) => [key, Array.isArray(value) ? [] : null]));
            data[slice.field] = slice.index === undefined ? slice.value : [slice.value];
            const prefix = `/${slice.field}${slice.index === undefined ? "" : `/${slice.index}`}`;
            const refs = domain.mediaRefs.filter(ref => ref.pointer === prefix || ref.pointer.startsWith(prefix + "/")).map(ref => ({ ...ref, pointer: `/${slice.field}${slice.index === undefined ? "" : "/0"}${ref.pointer.slice(prefix.length)}` }));
            refs.sort((a, b) => a.pointer.localeCompare(b.pointer));
            const files = manifest.files.filter(file => refs.some(ref => ref.fileKey === file.fileKey)).map(({ originalStorageKey: _, ...file }) => file).sort((a, b) => a.fileKey.localeCompare(b.fileKey));
            const part: Manifest = { ...manifest, clientId: "sync-record-v1", domains: [{ ...domain, data, mediaRefs: refs }], files };
            const key = await hashBlob(new Blob([JSON.stringify([domain.name, slice.field, slice.id])]));
            const hash = await hashBlob(new Blob([canonicalize({ domains: part.domains, files })!]));
            const label = typeof slice.value === "object" && slice.value && !Array.isArray(slice.value) ? String(slice.value.name || slice.value.title || slice.id) : slice.id;
            records.push({ key, hash, label: `${domain.name} · ${label}`, manifest: part });
        }
    }
    return records;
}

export function mergeDomains(local: Domain[], incoming: Domain[]): Domain[] {
    const result = structuredClone(local);
    for (const domain of incoming) {
        const existing = result.find(item => item.name === domain.name);
        if (!existing) { result.push(domain); continue; }
        for (const [field, value] of Object.entries(domain.data)) {
            if (field === "deleted") continue;
            if (Array.isArray(value)) {
                const items = new Map(((existing.data[field] || []) as Record<string, Json>[]).map(item => [item.id, item]));
                for (const item of value as Record<string, Json>[]) items.set(item.id, item);
                existing.data[field] = [...items.values()];
            } else if (value !== null) existing.data[field] = value;
        }
    }
    return result;
}
