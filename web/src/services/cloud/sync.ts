import { cloudAPI } from "@/services/api/cloud";
import { useCloudStore } from "@/stores/use-cloud-store";
import { assertManifest, captureLocal, hashBlob, hashManifest } from "./codec";
import { getSyncState, restoreLocalData, setSyncState } from "./local-data";
import { withSyncLock } from "./session-lock";
import { domainLabels, type DomainName, type Manifest, type Progress } from "./types";

type UploadJob = { version: 1; serverId: string; workspaceId: string; key: string; manifest: Manifest; blobs: Map<string, Blob>; complete: boolean };

async function identity(signal?: AbortSignal) {
    const status = await cloudAPI.status(signal);
    if (status.apiVersion !== 1 || status.workspaceId !== useCloudStore.getState().session?.user.workspaceId) throw new Error("服务器身份与登录会话不一致，请重新登录");
    return status;
}

export function uploadLocal(operationId: string, progress: Progress, signal?: AbortSignal) {
    return withSyncLock(async () => {
        const status = await identity(signal);
        for (const name of ["subjects", "ai-workbench", "settings"] as const) {
            if (!status.domainVersions?.[name]?.includes(1)) throw new Error(`服务器尚不支持${domainLabels[name]}同步，请更新后端后再上传。`);
        }
        let job = await getSyncState<UploadJob>(`upload:${operationId}`);
        if (job && job.version !== 1) throw new Error("发现未知版本的上传记录，请保留本地数据并检查版本");
        if (!job || job.complete || job.serverId !== status.serverId || job.workspaceId !== status.workspaceId) {
            progress("正在读取本地画布、素材与生成记录");
            const captured = await captureLocal(status, progress, signal);
            job = { version: 1, serverId: status.serverId, workspaceId: status.workspaceId, key: crypto.randomUUID(), ...captured, complete: false };
            await setSyncState(`upload:${operationId}`, job);
        }
        progress("正在创建服务器备份");
        const backup = await cloudAPI.create(job.manifest, job.key, signal);
        if (!["draft", "committed"].includes(backup.state)) throw new Error("这次上传的服务器备份已被删除，请先保留并处理本地上传记录");
        if (backup.state === "draft") {
            let done = 0;
            for (const sha of backup.missing) {
                const file = job.manifest.files.find(file => file.sha256 === sha);
                const blob = file && job.blobs.get(file.fileKey);
                if (!file || !blob) throw new Error("本地上传暂存文件不完整");
                progress(`正在上传媒体 ${++done} / ${backup.missing.length}`);
                const uploaded = await cloudAPI.upload(blob, sha, signal);
                if (uploaded.sha256 !== sha || uploaded.bytes !== file.bytes || uploaded.mimeType !== file.mimeType) throw new Error("服务器识别的文件类型或摘要与本地快照不一致，备份尚未提交");
            }
            progress("正在校验并保存服务器备份");
            await cloudAPI.commit(backup.backupId, signal);
        }
        await setSyncState(`upload:${operationId}`, { ...job, complete: true });
        await setSyncState("last-upload", { backupId: backup.backupId, completedAt: new Date().toISOString() });
        return backup.backupId;
    }, signal);
}

export function downloadToLocal(backupId: string, selected: DomainName[], progress: Progress, signal?: AbortSignal) {
    return withSyncLock(async () => {
        await identity(signal);
        const backup = await cloudAPI.backup(backupId, signal);
        if (backup.state !== "committed" || !backup.manifest || backup.missing.length) throw new Error("服务器备份未完成或文件缺失，不能恢复");
        assertManifest(backup.manifest);
        if (await hashManifest(backup.manifest, signal) !== backup.manifestSha256) throw new Error("服务器备份清单校验失败");
        if (!selected.length || new Set(selected).size !== selected.length || selected.some(name => !backup.manifest!.domains.some(d => d.name === name))) throw new Error("请选择该备份中包含的数据范围");
        if (selected.includes("ai-workbench") && !selected.includes("subjects")) throw new Error("恢复 AI 工作台时，请同时选择主体，保持引用关系一致");
        const keys = new Set(backup.manifest.domains.filter(d => selected.includes(d.name)).flatMap(d => d.mediaRefs.map(ref => ref.fileKey)));
        const files = new Map<string, Blob>(); const bySHA = new Map<string, Blob>();
        for (const file of backup.manifest.files.filter(file => keys.has(file.fileKey))) {
            signal?.throwIfAborted();
            progress(`正在下载并校验媒体 ${files.size + 1} / ${keys.size}`);
            const binding = backup.mediaBindings.find(media => media.sha256 === file.sha256);
            if (!binding || binding.bytes !== file.bytes || binding.mimeType !== file.mimeType) throw new Error("备份媒体映射不完整");
            let blob = bySHA.get(file.sha256);
            if (!blob) {
                blob = await cloudAPI.media(binding.mediaId, signal);
                if (blob.size !== file.bytes || await hashBlob(blob, signal) !== file.sha256) throw new Error("下载文件校验失败，本地业务数据未被覆盖");
                blob = blob.slice(0, blob.size, file.mimeType); bySHA.set(file.sha256, blob);
            }
            files.set(file.fileKey, blob);
        }
        const current = await cloudAPI.backup(backupId, signal);
        if (current.state !== "committed" || current.manifestSha256 !== backup.manifestSha256) throw new Error("下载期间备份状态已变化，本地数据未被覆盖");
        signal?.throwIfAborted();
        progress("正在保存本地副本并恢复数据，请勿关闭页面");
        await restoreLocalData(backup.manifest, selected, files, backupId);
        return backupId;
    }, signal);
}
