import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { fileTypeFromBlob } from "file-type";
import pointer from "jsonpointer";
import schema from "./manifest.schema.json";
import { fetchCloudSource } from "@/services/api/cloud";
import { localDomains, readLocalBlob, readLocalData } from "./local-data";
import { MEDIA_MARKER } from "./media-urls";
import type { CloudStatus, Domain, Json, Manifest, Progress } from "./types";
import { hashBlob } from "./hash";
export { hashBlob, hashManifest } from "./hash";

const ajv = new Ajv({ allErrors: false, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
const storagePattern = /^(image|video|audio|file|video-reference|audio-reference):/;
type MediaEntry = { pointer: string; value: Json; storageKey?: string; isStorageKey: boolean };
const escape = (value: string) => value.replaceAll("~", "~0").replaceAll("/", "~1");

export function mediaEntries(data: Json): MediaEntry[] {
    const entries: MediaEntry[] = [];
    function walk(value: Json, path: string, mediaNode = false) {
        if (Array.isArray(value)) {
            value.forEach((item, index) => {
                const next = `${path}/${index}`;
                if ((path.endsWith("/references") || path.endsWith("/thumbnails")) && (item === null || typeof item === "string")) entries.push({ pointer: next, value: item, isStorageKey: typeof item === "string" && storagePattern.test(item) });
                else walk(item, next, mediaNode);
            });
        } else if (value && typeof value === "object") {
            if (typeof value.type === "string") mediaNode = ["image", "video", "audio"].includes(value.type);
            for (const [key, item] of Object.entries(value)) {
                if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("数据包含不支持的字段");
                const next = `${path}/${escape(key)}`;
                const isMedia = ["storageKey", "url", "dataUrl", "coverUrl"].includes(key) || (key === "content" && (mediaNode || "naturalWidth" in value));
                if (isMedia) entries.push({ pointer: next, value: item, storageKey: typeof value.storageKey === "string" ? value.storageKey : undefined, isStorageKey: key === "storageKey" });
                else walk(item, next, mediaNode);
            }
        }
    }
    walk(data, ""); return entries;
}

export function assertManifest(value: unknown): asserts value is Manifest {
    if (!validate(value)) throw new Error(`快照数据格式不符合当前版本：${ajv.errorsText(validate.errors, { separator: "；" })}`);
    const manifest = value as Manifest;
    if (new Set(manifest.domains.map(d => d.name)).size !== manifest.domains.length) throw new Error("快照业务域重复");
    const files = new Map(manifest.files.map(file => [file.fileKey, file])); const used = new Set<string>();
    if (files.size !== manifest.files.length) throw new Error("快照文件标识重复");
    for (const domain of manifest.domains) {
        const entries = new Map((domain.name === "settings" ? [] : mediaEntries(domain.data)).map(entry => [entry.pointer, entry])); const pointers = new Set<string>();
        for (const ref of domain.mediaRefs) {
            if (pointers.has(ref.pointer) || !entries.has(ref.pointer) || pointer.get(domain.data, ref.pointer) !== null || !files.has(ref.fileKey)) throw new Error("快照媒体引用无效");
            pointers.add(ref.pointer); used.add(ref.fileKey);
        }
        for (const entry of entries.values()) if (entry.value !== "" && !pointers.has(entry.pointer)) throw new Error(`媒体文件尚未编码：${domain.name}${entry.pointer}`);
    }
    if (used.size !== files.size) throw new Error("快照中存在未引用的文件");
}

export async function captureLocal(status: CloudStatus, progress: Progress, signal?: AbortSignal) {
    const local = await readLocalData();
    const domains = localDomains(local);
    const manifest: Manifest = { app: "infinite-canvas", manifestVersion: 1, clientId: crypto.randomUUID(), capturedAt: new Date().toISOString(), domains, files: [] };
    const blobs = new Map<string, Blob>();
    const bySource = new Map<string, string>();
    const aliases = new Map<string, string>();
    for (const domain of domains.filter(domain => domain.name !== "settings")) for (const entry of mediaEntries(domain.data)) if (entry.storageKey && typeof entry.value === "string" && entry.value) aliases.set(entry.value, entry.storageKey);
    let completed = 0;
    for (const domain of domains) {
        const entries = domain.name === "settings" ? [] : mediaEntries(domain.data);
        for (const entry of entries) {
            signal?.throwIfAborted();
            if (entry.value === "") continue;
            if (typeof entry.value !== "string") throw new Error(`本地媒体字段不完整：${domain.name}${entry.pointer}`);
            const source = entry.value;
            const key = source.startsWith(MEDIA_MARKER) ? source.slice(MEDIA_MARKER.length) : storagePattern.test(source) ? source : entry.storageKey || aliases.get(source);
            const sourceID = key || source;
            let fileKey = bySource.get(sourceID);
            if (!fileKey) {
                progress(`正在读取${domain.name === "canvas" ? "画布" : "本地"}媒体 · ${++completed}`);
                let blob = key ? await readLocalBlob(key) : undefined;
                if (!blob && !storagePattern.test(source) && !source.startsWith(MEDIA_MARKER)) blob = await fetchCloudSource(source, signal).catch(() => undefined);
                if (!(blob instanceof Blob) || !blob.size) throw new Error(`媒体文件不可读取：${domain.name}${entry.pointer}。请修复该文件后再上传。`);
                if (blob.size > status.policy.maxFileBytes) throw new Error("媒体文件超过服务器允许的上传大小");
                const detected = await fileTypeFromBlob(blob);
                let mime = detected?.mime || blob.type;
                if (mime === "audio/x-wav") mime = "audio/wav";
                if (!/^(image|audio|video)\//.test(mime)) throw new Error(`无法识别媒体类型：${domain.name}${entry.pointer}`);
                blob = blob.slice(0, blob.size, mime);
                const sha = await hashBlob(blob, signal); fileKey = `file_${sha}`;
                if (!blobs.has(fileKey)) {
                    blobs.set(fileKey, blob);
                    manifest.files.push({ fileKey, sha256: sha, bytes: blob.size, mimeType: mime, ...(key ? { originalStorageKey: key } : {}) });
                }
                bySource.set(sourceID, fileKey);
            }
            pointer.set(domain.data, entry.pointer, null);
            domain.mediaRefs.push({ pointer: entry.pointer, fileKey, representation: entry.isStorageKey ? "storage-key" : "blob-url" });
        }
    }
    assertManifest(manifest);
    if (new Blob([JSON.stringify({ manifest })]).size > status.policy.maxJSONBytes) throw new Error("快照清单超过服务器允许大小，尚未上传任何数据");
    return { manifest, blobs };
}

export function domainCounts(domains: Domain[]) {
    return domains.map(domain => ({ name: domain.name, records: domain.name === "ai-workbench" ? (domain.data.draft ? 1 : 0) : Object.values(domain.data).reduce<number>((count, value) => count + (Array.isArray(value) ? value.length : 0), 0) }));
}
