import { openDB, type IDBPDatabase } from "idb";
import type { Domain, DomainName, Json, Manifest } from "./types";
import { MEDIA_MARKER } from "./media-urls";
import pointer from "jsonpointer";

const dbName = "infinite-canvas";
const stores = ["app_state", "image_files", "media_files", "image_generation_logs", "video_generation_logs", "cloud_restore"];
export const canvasKey = "infinite-canvas:canvas_store";
export const assetsKey = "infinite-canvas:asset_store";
export type LocalData = { canvas: string | null; assets: string | null; imageLogs: { key: IDBValidKey; value: Json }[]; videoLogs: { key: IDBValidKey; value: Json }[] };

export async function openLocalDB(): Promise<IDBPDatabase> {
    let db = await openDB(dbName, undefined, { blocking: () => db.close() });
    if (stores.every(name => db.objectStoreNames.contains(name))) return db;
    const version = db.version + 1; db.close();
    db = await openDB(dbName, version, {
        upgrade(database) { for (const name of stores) if (!database.objectStoreNames.contains(name)) database.createObjectStore(name); },
        blocking: () => db.close(),
    });
    return db;
}

export async function readLocalData(): Promise<LocalData> {
    if (localStorage.getItem(canvasKey) || localStorage.getItem(assetsKey)) throw new Error("检测到 localStorage 中的业务数据副本。请先导出并确认本地存储状态，再执行服务器同步，避免遗漏数据。");
    const db = await openLocalDB();
    try {
        const tx = db.transaction(["app_state", "image_generation_logs", "video_generation_logs"], "readonly");
        const [canvas, assets, imageKeys, imageValues, videoKeys, videoValues] = await Promise.all([
            tx.objectStore("app_state").get(canvasKey), tx.objectStore("app_state").get(assetsKey),
            tx.objectStore("image_generation_logs").getAllKeys(), tx.objectStore("image_generation_logs").getAll(),
            tx.objectStore("video_generation_logs").getAllKeys(), tx.objectStore("video_generation_logs").getAll(),
        ]);
        await tx.done;
        return { canvas: canvas ?? null, assets: assets ?? null, imageLogs: imageKeys.map((key, i) => ({ key, value: imageValues[i] })), videoLogs: videoKeys.map((key, i) => ({ key, value: videoValues[i] })) };
    } finally { db.close(); }
}

export function localDomains(data: LocalData): Domain[] {
    const canvas = data.canvas ? JSON.parse(data.canvas).state : { projects: [], deletedProjects: [] };
    const assets = data.assets ? JSON.parse(data.assets).state : { assets: [] };
    return [
        { name: "canvas", domainVersion: 1, data: { projects: canvas.projects, deleted: canvas.deletedProjects }, mediaRefs: [] },
        { name: "assets", domainVersion: 1, data: { assets: assets.assets }, mediaRefs: [] },
        { name: "image-workbench", domainVersion: 1, data: { logs: data.imageLogs.map(record => record.value) }, mediaRefs: [] },
        { name: "video-workbench", domainVersion: 1, data: { logs: data.videoLogs.map(record => record.value) }, mediaRefs: [] },
    ];
}

export async function readLocalBlob(key: string) {
    const db = await openLocalDB();
    try { return await db.get(key.startsWith("image:") ? "image_files" : "media_files", key) as Blob | undefined; }
    finally { db.close(); }
}

export async function getSyncState<T>(key: string) {
    const db = await openLocalDB();
    try { return await db.get("cloud_restore", key) as T | undefined; } finally { db.close(); }
}
export async function setSyncState(key: string, value: unknown) {
    const db = await openLocalDB();
    try { await db.put("cloud_restore", value, key); } finally { db.close(); }
}

function pauseRestoredTasks(domains: Domain[]) {
    for (const domain of domains) {
        if (domain.name === "video-workbench") for (const raw of domain.data.logs as Record<string, Json>[]) {
            if (raw.status === "pending") { raw.status = "failed"; raw.error = "已从服务器恢复历史记录，未自动续跑生成任务"; }
        }
        if (domain.name === "canvas") for (const project of domain.data.projects as Record<string, Json>[]) for (const node of project.nodes as Record<string, Json>[]) {
            const metadata = node.metadata as Record<string, Json> | undefined;
            if (metadata?.status === "loading") { metadata.status = "idle"; delete metadata.videoTaskId; delete metadata.videoTaskProvider; }
        }
    }
}

/** Called only under the exclusive application lock, with all downloads already verified. */
export async function restoreLocalData(manifest: Manifest, selected: DomainName[], blobs: Map<string, Blob>, backupId: string) {
    const before = await readLocalData();
    const domains = structuredClone(manifest.domains.filter(domain => selected.includes(domain.name)));
    const savedFiles = new Map<string, { key: string; blob: Blob }>();
    for (const domain of domains) for (const ref of domain.mediaRefs) {
        if (!savedFiles.has(ref.fileKey)) {
            const blob = blobs.get(ref.fileKey); if (!blob) throw new Error("恢复媒体尚未下载完整");
            savedFiles.set(ref.fileKey, { blob, key: `${blob.type.startsWith("image/") ? "image" : blob.type.startsWith("audio/") ? "audio" : "video"}:cloud-${crypto.randomUUID()}` });
        }
        const file = savedFiles.get(ref.fileKey)!;
        pointer.set(domain.data, ref.pointer, ref.representation === "storage-key" ? file.key : MEDIA_MARKER + file.key);
    }
    pauseRestoredTasks(domains);
    const db = await openLocalDB();
    try {
        // All operations below belong to one native IndexedDB transaction: no network awaits.
        const tx = db.transaction(stores, "readwrite");
        const writes: Promise<unknown>[] = [];
        writes.push(tx.objectStore("cloud_restore").put({ version: 1, backupId, savedAt: new Date().toISOString(), domains: selected, before }, `before:${crypto.randomUUID()}`));
        for (const { key, blob } of savedFiles.values()) writes.push(tx.objectStore(key.startsWith("image:") ? "image_files" : "media_files").put(blob, key));
        for (const domain of domains) {
            if (domain.name === "canvas" || domain.name === "assets") {
                const original = domain.name === "canvas" ? before.canvas : before.assets;
                const envelope = original ? JSON.parse(original) : { state: {}, version: 0 };
                envelope.state = domain.name === "canvas" ? { projects: domain.data.projects, deletedProjects: domain.data.deleted } : { assets: domain.data.assets };
                writes.push(tx.objectStore("app_state").put(JSON.stringify(envelope), domain.name === "canvas" ? canvasKey : assetsKey));
            } else {
                const store = tx.objectStore(domain.name === "image-workbench" ? "image_generation_logs" : "video_generation_logs");
                writes.push(store.clear());
                for (const log of domain.data.logs as Record<string, Json>[]) writes.push(store.put(log, log.id as string));
            }
        }
        writes.push(tx.objectStore("cloud_restore").put({ backupId, completedAt: new Date().toISOString(), domains: selected }, "last-download"));
        // Observe transaction rejection too, so a failed request cannot produce an unhandled rejection.
        await Promise.all([...writes, tx.done]);
    } finally { db.close(); }
}
