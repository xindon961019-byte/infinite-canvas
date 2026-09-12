import { openDB, type IDBPDatabase } from "idb";
import type { Domain, DomainName, Json, Manifest } from "./types";
import { MEDIA_MARKER } from "./media-urls";
import pointer from "jsonpointer";
import { readSettings, setting, settingsWrites, type Setting } from "./settings";
import { mergeDomains } from "./records";
import { recoverSettings, settingsCommitKey, settingsJournalKey, type SettingsJournal } from "./settings-recovery";

const dbName = "infinite-canvas";
const stores = ["app_state", "image_files", "media_files", "image_generation_logs", "video_generation_logs", "cloud_restore", "subjects", "ai_workspace", "prompt_cache"];
export const canvasKey = "infinite-canvas:canvas_store";
export const assetsKey = "infinite-canvas:asset_store";
export type LocalData = { subjects: Json[]; draft: Json; canvas: string | null; assets: string | null; imageLogs: { key: IDBValidKey; value: Json }[]; videoLogs: { key: IDBValidKey; value: Json }[]; settings: Setting[] };

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
        await recoverSettings();
        const tx = db.transaction(["app_state", "image_generation_logs", "video_generation_logs", "subjects", "ai_workspace"], "readonly");
        const [canvas, assets, imageKeys, imageValues, videoKeys, videoValues, subjects, draft] = await Promise.all([
            tx.objectStore("app_state").get(canvasKey), tx.objectStore("app_state").get(assetsKey),
            tx.objectStore("image_generation_logs").getAllKeys(), tx.objectStore("image_generation_logs").getAll(),
            tx.objectStore("video_generation_logs").getAllKeys(), tx.objectStore("video_generation_logs").getAll(),
            tx.objectStore("subjects").get("items"), tx.objectStore("ai_workspace").get("draft"),
        ]);
        await tx.done;
        const settings = readSettings();
        for (const store of ["app_state", "prompt_cache"]) {
            const tx = db.transaction(store, "readonly");
            const keys = await tx.store.getAllKeys();
            const values = await tx.store.getAll();
            await tx.done;
            keys.forEach((key, i) => { if (key !== canvasKey && key !== assetsKey) settings.push(setting(store, String(key), JSON.stringify(values[i]))); });
        }
        return { subjects: subjects ?? [], draft: draft ?? null, canvas: canvas ?? null, assets: assets ?? null, imageLogs: imageKeys.map((key, i) => ({ key, value: imageValues[i] })), videoLogs: videoKeys.map((key, i) => ({ key, value: videoValues[i] })), settings };
    } finally { db.close(); }
}

export function localDomains(data: LocalData): Domain[] {
    const canvas = data.canvas ? JSON.parse(data.canvas).state : { projects: [], deletedProjects: [] };
    const assets = data.assets ? JSON.parse(data.assets).state : { assets: [] };
    return [
        { name: "subjects", domainVersion: 1, data: { items: data.subjects }, mediaRefs: [] },
        { name: "ai-workbench", domainVersion: 1, data: { draft: data.draft }, mediaRefs: [] },
        { name: "canvas", domainVersion: 1, data: { projects: canvas.projects, deleted: canvas.deletedProjects }, mediaRefs: [] },
        { name: "assets", domainVersion: 1, data: { assets: assets.assets }, mediaRefs: [] },
        { name: "image-workbench", domainVersion: 1, data: { logs: data.imageLogs.map(record => record.value) }, mediaRefs: [] },
        { name: "video-workbench", domainVersion: 1, data: { logs: data.videoLogs.map(record => record.value) }, mediaRefs: [] },
        { name: "settings", domainVersion: 1, data: { items: data.settings }, mediaRefs: [] },
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
export async function restoreLocalData(manifest: Manifest, selected: DomainName[], blobs: Map<string, Blob>, backupId: string, merge = false, syncState?: { key: string; value: unknown }) {
    const before = await readLocalData();
    let domains = structuredClone(manifest.domains.filter(domain => selected.includes(domain.name)));
    const savedFiles = new Map<string, { key: string; blob: Blob }>();
    for (const domain of domains) for (const ref of domain.mediaRefs) {
        if (!savedFiles.has(ref.fileKey)) {
            const blob = blobs.get(ref.fileKey); if (!blob) throw new Error("恢复媒体尚未下载完整");
            const sha = manifest.files.find(file => file.fileKey === ref.fileKey)!.sha256;
            savedFiles.set(ref.fileKey, { blob, key: `${blob.type.startsWith("image/") ? "image" : blob.type.startsWith("audio/") ? "audio" : "video"}:${merge ? `sync-${sha}` : `cloud-${crypto.randomUUID()}`}` });
        }
        const file = savedFiles.get(ref.fileKey)!;
        pointer.set(domain.data, ref.pointer, ref.representation === "storage-key" ? file.key : MEDIA_MARKER + file.key);
    }
    pauseRestoredTasks(domains);
    if (merge) domains = mergeDomains(localDomains(before).filter(domain => selected.includes(domain.name)), domains);
    const settings = domains.find(domain => domain.name === "settings")?.data.items as Setting[] | undefined;
    const localWrites = settingsWrites(settings || []);
    const databaseSettings = (settings || []).filter(item => ["app_state", "prompt_cache"].includes(item.store)).map(item => {
        if (item.key === canvasKey || item.key === assetsKey) throw new Error("配置不得覆盖业务数据存储");
        return { ...item, parsed: JSON.parse(item.value) };
    });
    const previous = new Map([...localWrites.keys()].map(key => [key, localStorage.getItem(key)]));
    const db = await openLocalDB();
    try {
        const journal: SettingsJournal = { id: crypto.randomUUID(), before: [...previous], after: [...localWrites] };
        if (localWrites.size) await db.put("cloud_restore", journal, settingsJournalKey);
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
            } else if (domain.name === "subjects") {
                writes.push(tx.objectStore("subjects").put(domain.data.items, "items"));
            } else if (domain.name === "ai-workbench") {
                writes.push(domain.data.draft === null ? tx.objectStore("ai_workspace").delete("draft") : tx.objectStore("ai_workspace").put(domain.data.draft, "draft"));
            } else if (domain.name === "settings") {
                for (const item of databaseSettings) writes.push(tx.objectStore(item.store).put(item.parsed, item.key));
            } else {
                const store = tx.objectStore(domain.name === "image-workbench" ? "image_generation_logs" : "video_generation_logs");
                writes.push(store.clear());
                for (const log of domain.data.logs as Record<string, Json>[]) writes.push(store.put(log, log.id as string));
            }
        }
        writes.push(tx.objectStore("cloud_restore").put({ backupId, completedAt: new Date().toISOString(), domains: selected }, "last-download"));
        if (syncState) writes.push(tx.objectStore("cloud_restore").put(syncState.value, syncState.key));
        if (localWrites.size) writes.push(tx.objectStore("cloud_restore").put(journal.id, settingsCommitKey));
        try { for (const [key, value] of localWrites) localStorage.setItem(key, value); }
        catch (error) { tx.abort(); await Promise.allSettled([...writes, tx.done]); throw error; }
        // Observe transaction rejection too, so a failed request cannot produce an unhandled rejection.
        await Promise.all([...writes, tx.done]);
        if (localWrites.size) await db.delete("cloud_restore", settingsJournalKey);
    } catch (error) {
        await recoverSettings();
        throw error;
    } finally { db.close(); }
}
