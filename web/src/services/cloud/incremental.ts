import { cloudAPI, type SyncEntry } from "@/services/api/cloud";
import { useCloudStore } from "@/stores/use-cloud-store";
import { assertManifest, captureLocal, hashBlob, hashManifest } from "./codec";
import { getSyncState, readLocalBlob, restoreLocalData, setSyncState } from "./local-data";
import { splitRecords } from "./records";
import { withSyncLock } from "./session-lock";
import type { Backup, Manifest, Progress } from "./types";

type State = { version: 1; cursor: string; records: Record<string, { revision: string; hash: string }> };
export type ResolveConflict = (label: string) => Promise<"local" | "server" | "cancel">;

async function remoteRecord(entry: SyncEntry, signal?: AbortSignal) {
    const backup = await cloudAPI.backup(entry.backupId, signal);
    if (backup.state !== "committed" || !backup.manifest || backup.missing.length) throw new Error("同步记录未完成或媒体缺失");
    assertManifest(backup.manifest);
    if (await hashManifest(backup.manifest, signal) !== backup.manifestSha256) throw new Error("同步记录摘要校验失败");
    const records = await splitRecords(backup.manifest);
    if (records.length !== 1 || records[0].key !== entry.key) throw new Error("服务器同步记录标识不匹配");
    return { backup, record: records[0] };
}

async function filesFor(backup: Backup, progress: Progress, signal?: AbortSignal) {
    const blobs = new Map<string, Blob>();
    for (const file of backup.manifest!.files) {
        signal?.throwIfAborted();
        let blob = await readLocalBlob(`${file.mimeType.split("/")[0]}:sync-${file.sha256}`);
        if (!blob || blob.size !== file.bytes || await hashBlob(blob, signal) !== file.sha256) {
            const media = backup.mediaBindings.find(item => item.sha256 === file.sha256 && item.bytes === file.bytes && item.mimeType === file.mimeType);
            if (!media) throw new Error("同步媒体映射不完整");
            progress("正在下载新增媒体");
            blob = await cloudAPI.media(media.mediaId, signal);
            if (blob.size !== file.bytes || await hashBlob(blob, signal) !== file.sha256) throw new Error("同步媒体内容校验失败");
        }
        blobs.set(file.fileKey, blob.slice(0, blob.size, file.mimeType));
    }
    return blobs;
}

export function synchronize(direction: "upload" | "download", progress: Progress, resolve: ResolveConflict, signal?: AbortSignal) {
    return withSyncLock(async () => {
        const session = useCloudStore.getState().session;
        const baseURL = useCloudStore.getState().baseUrl;
        const check = () => {
            signal?.throwIfAborted();
            if (!session || useCloudStore.getState().session?.accessToken !== session.accessToken || useCloudStore.getState().baseUrl !== baseURL) throw new Error("同步期间服务器账号已变化，请重新开始");
        };
        check();
        const status = await cloudAPI.status(signal);
        if (status.workspaceId !== session!.user.workspaceId || !status.capabilities?.incrementalSync) throw new Error("服务器尚未支持增量同步，请先更新后端并执行数据库迁移");
        const stateKey = `incremental:${status.serverId}:${status.workspaceId}`;
        const state: State = await getSyncState<State>(stateKey) || { version: 1, cursor: "0", records: {} };
        if (state.version !== 1) throw new Error("未知同步状态版本，原数据未修改");
        progress("正在整理本地变更");
        const captured = await captureLocal(status, progress, signal);
        const local = new Map((await splitRecords(captured.manifest)).map(record => [record.key, record]));
        const entries = new Map<string, SyncEntry>();
        let cursor = direction === "upload" ? "0" : state.cursor;
        for (;;) {
            check();
            const page = await cloudAPI.changes(cursor, signal);
            if (!page.items.length) break;
            for (const item of page.items) {
                if (!/^\d+$/.test(item.revision) || BigInt(item.revision) <= BigInt(cursor)) throw new Error("服务器同步游标无效");
                entries.set(item.key, item); cursor = item.revision;
            }
        }
        let changed = 0;
        if (direction === "upload") {
            for (const record of local.values()) {
                check();
                const baseline = state.records[record.key];
                if (baseline?.hash === record.hash) continue;
                const head = entries.get(record.key);
                if (head && head.revision !== baseline?.revision) {
                    const remote = await remoteRecord(head, signal);
                    if (remote.record.hash === record.hash) {
                        state.records[record.key] = { revision: head.revision, hash: record.hash };
                        await setSyncState(stateKey, state); continue;
                    }
                    const choice = await resolve(record.label);
                    if (choice === "cancel") throw new Error("同步已暂停，已完成记录保留，可再次同步");
                    if (choice === "server") continue;
                }
                progress(`正在上传变更 · ${record.label}`);
                const idempotency = await hashBlob(new Blob([`${record.key}:${record.hash}:${head?.revision || "0"}`]));
                const jobKey = `${stateKey}:pending:${idempotency}`;
                const pending = await getSyncState<Manifest>(jobKey) || record.manifest;
                await setSyncState(jobKey, pending);
                const backup = await cloudAPI.create(pending, idempotency, signal);
                for (const sha of backup.missing) {
                    check();
                    const file = record.manifest.files.find(item => item.sha256 === sha)!;
                    const blob = captured.blobs.get(file.fileKey);
                    if (!blob) throw new Error("本地同步媒体缺失");
                    const media = await cloudAPI.upload(blob, sha, signal);
                    if (media.sha256 !== sha || media.bytes !== file.bytes || media.mimeType !== file.mimeType) throw new Error("上传媒体校验失败");
                }
                check(); await cloudAPI.commit(backup.backupId, signal);
                check();
                const published = await cloudAPI.publish(record.key, backup.backupId, head?.revision || "0", signal);
                state.records[record.key] = { revision: published.revision, hash: record.hash };
                await setSyncState(stateKey, state); changed++;
            }
        } else {
            const incoming = [];
            for (const entry of entries.values()) {
                if (state.records[entry.key]?.revision === entry.revision) continue;
                incoming.push({ entry, ...await remoteRecord(entry, signal) });
            }
            // Channels must exist before their model scripts, regardless of server revision order.
            const priority = (record: typeof incoming[number]["record"]) => {
                const domain = record.manifest.domains[0];
                if (domain.name !== "settings") return domain.name === "ai-workbench" ? 3 : 0;
                const item = (domain.data.items as { store: string }[])[0];
                return item.store === "model" ? 2 : 1;
            };
            incoming.sort((a, b) => priority(a.record) - priority(b.record));
            for (const { entry, backup, record } of incoming) {
                check();
                const baseline = state.records[entry.key];
                const current = local.get(entry.key);
                if (baseline?.revision === entry.revision) continue;
                let apply = current?.hash !== record.hash;
                if (apply && current && current.hash !== baseline?.hash) {
                    const choice = await resolve(record.label);
                    if (choice === "cancel") throw new Error("同步已暂停，已完成记录保留，可再次同步");
                    apply = choice === "server";
                }
                const next = { ...state, records: { ...state.records, [entry.key]: { revision: entry.revision, hash: record.hash } } };
                if (apply) {
                    const blobs = await filesFor(backup, progress, signal);
                    check(); progress(`正在合并本地记录 · ${record.label}`);
                    await restoreLocalData(record.manifest, record.manifest.domains.map(domain => domain.name), blobs, backup.backupId, true, { key: stateKey, value: next });
                    changed++;
                } else await setSyncState(stateKey, next);
                state.records = next.records;
            }
            state.cursor = cursor;
            await setSyncState(stateKey, state);
        }
        return changed;
    }, signal);
}
