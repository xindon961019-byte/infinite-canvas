import { Alert, App, Button, Checkbox, Empty, Select, Spin } from "antd";
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Check, Cloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { cloudAPI } from "@/services/api/cloud";
import { useCloudStore } from "@/stores/use-cloud-store";
import { domainLabels, type BackupSummary, type DomainName } from "@/services/cloud/types";
import { downloadToLocal, uploadLocal } from "@/services/cloud/sync";
import { domainCounts } from "@/services/cloud/codec";
import { localDomains, readLocalData } from "@/services/cloud/local-data";
import { withSyncLock } from "@/services/cloud/session-lock";

export default function ServerSyncPage() {
    const { modal } = App.useApp();
    const [params] = useSearchParams();
    const download = params.get("direction") === "download";
    const [operation] = useState(() => params.get("operation") || crypto.randomUUID());
    const session = useCloudStore(state => state.session);
    const baseUrl = useCloudStore(state => state.baseUrl);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [progress, setProgress] = useState("");
    const [complete, setComplete] = useState(false);
    const [backups, setBackups] = useState<BackupSummary[]>([]);
    const [cursor, setCursor] = useState<string | null>(null);
    const [backupId, setBackupId] = useState("");
    const [domains, setDomains] = useState<DomainName[]>([]);
    const [localCounts, setLocalCounts] = useState<{ name: DomainName; records: number }[]>([]);
    const controller = useRef<AbortController | null>(null);
    const selected = backups.find(backup => backup.backupId === backupId);

    useEffect(() => {
        if (!session) { window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`); return; }
        const abort = new AbortController();
        void (async () => {
            try {
                await cloudAPI.me(abort.signal);
                if (download) {
                    const page = await cloudAPI.list(undefined, abort.signal);
                    if (abort.signal.aborted) return;
                    setBackups(page.items); setCursor(page.nextCursor);
                    if (page.items[0]) { setBackupId(page.items[0].backupId); setDomains(page.items[0].domains.map(d => d.name)); }
                }
                const counts = await withSyncLock(async () => domainCounts(localDomains(await readLocalData())), abort.signal);
                if (!abort.signal.aborted) setLocalCounts(counts);
            } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "读取同步信息失败"); }
            finally { if (!abort.signal.aborted) setLoading(false); }
        })();
        return () => abort.abort();
    }, [download, session]);

    useEffect(() => {
        if (!busy) return;
        const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", beforeUnload);
        return () => window.removeEventListener("beforeunload", beforeUnload);
    }, [busy]);

    const run = async () => {
        if (busy) return;
        const abort = new AbortController(); controller.current = abort;
        setBusy(true); setError(""); setProgress("正在连接服务器");
        try {
            if (download) await downloadToLocal(backupId, domains, setProgress, abort.signal);
            else await uploadLocal(operation, setProgress, abort.signal);
            setComplete(true); setProgress(download ? "服务器数据已保存到本地" : "本地数据已保存到服务器");
        } catch (cause) { setError(abort.signal.aborted ? "操作已取消。可重试继续本次上传；下载尚未提交时不会覆盖本地数据。" : cause instanceof Error ? cause.message : "同步失败，请重试"); }
        finally { setBusy(false); controller.current = null; }
    };

    const confirmDownload = async () => {
        try {
            const counts = await withSyncLock(async () => domainCounts(localDomains(await readLocalData())));
            setLocalCounts(counts);
            modal.confirm({
                title: "将服务器数据下载并替换本地？", okText: "下载并替换", cancelText: "取消", okButtonProps: { danger: true },
                content: <div className="py-2 text-sm leading-7"><p>所选范围会整体替换，未选择的数据保留。恢复前的本地副本将一并保存。</p>{domains.map(name => <div key={name}>{domainLabels[name]}：本地 {counts.find(d => d.name === name)?.records || 0} 条 → 服务器 {selected?.domains.find(d => d.name === name)?.records || 0} 条</div>)}<p className="mt-2 text-xs text-muted-foreground">服务器为空的数据范围也会清空本地对应内容。历史生成任务不会自动续跑。</p></div>,
                onOk: run,
            });
        } catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取本地数据"); }
    };
    const more = async () => {
        if (!cursor) return; setLoading(true);
        try { const page = await cloudAPI.list(cursor); setBackups(current => [...current, ...page.items]); setCursor(page.nextCursor); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "读取备份失败"); }
        finally { setLoading(false); }
    };

    return (
        <main className="mx-auto max-w-2xl px-6 pt-10 pb-20 sm:pt-16">
            <div className="mb-8 flex items-center gap-4"><span className="text-muted-foreground">{complete ? <Check className="size-8" /> : download ? <ArrowDownToLine className="size-8" strokeWidth={1.5} /> : <ArrowUpFromLine className="size-8" strokeWidth={1.5} />}</span><div><h1 className="text-2xl font-medium">{complete ? "同步完成" : download ? "数据下载" : "数据上传"}</h1><p className="mt-2 text-sm text-muted-foreground">{download ? "把服务器数据下载至当前设备" : "将本地画布、素材与生成记录保存至服务器"}</p></div></div>
            <div className="mb-8 flex items-center gap-2 text-xs text-muted-foreground"><Cloud className="size-4 shrink-0" /><span className="break-all">{baseUrl}</span><span className="ml-auto">{session?.user.username}</span></div>
            {error ? <Alert title={error} type="error" showIcon className="mb-6" /> : null}
            {loading ? <div className="py-12 text-center"><Spin /><p className="mt-4 text-sm text-muted-foreground">正在读取同步信息…</p></div> : !complete ? <>
                {download ? backups.length ? <div className="space-y-6">
                    <div><label className="mb-2 block text-sm" htmlFor="server-backup">选择服务器备份</label><Select id="server-backup" className="w-full" value={backupId} disabled={busy} onChange={id => { setBackupId(id); setDomains(backups.find(b => b.backupId === id)!.domains.map(d => d.name)); }} options={backups.map(backup => ({ value: backup.backupId, label: `${new Date(backup.createdAt).toLocaleString("zh-CN")} · ${backup.domains.reduce((n, d) => n + d.records, 0)} 条记录` }))} />{cursor ? <Button type="link" size="small" className="mt-2 !px-0" disabled={busy} onClick={() => void more()}>加载更早的备份</Button> : null}</div>
                    <div><p className="mb-3 text-sm">恢复范围</p><Checkbox.Group value={domains} disabled={busy} onChange={values => setDomains(values as DomainName[])} options={selected?.domains.map(d => ({ label: `${domainLabels[d.name]} · ${d.records} 条`, value: d.name }))} className="!flex !flex-col gap-3" /></div>
                </div> : <Empty description="服务器还没有已完成的备份" /> : <div className="divide-y divide-border border-y border-border">{localCounts.map(d => <div key={d.name} className="flex justify-between py-4 text-sm"><span>{domainLabels[d.name]}</span><span className="text-muted-foreground">{d.records} 条</span></div>)}<p className="py-4 text-xs leading-6 text-muted-foreground">上传会创建一份新的服务器备份。请关闭其他编辑标签页，避免捕获到正在变化的数据。</p></div>}
            </> : <div className="border-y border-border py-8"><p className="text-base">{progress}</p><p className="mt-3 text-sm leading-6 text-muted-foreground">{download ? "返回工作台后即可使用恢复的数据。所选范围已整体更新，其余本地数据保持原样。" : "备份已完成文件校验，可以在数据下载中选择并恢复。"}</p></div>}
            {busy ? <div className="mt-7 flex items-center gap-3" role="status" aria-live="polite"><Spin size="small" /><span className="text-sm text-muted-foreground">{progress}</span></div> : null}
            <div className="mt-9 flex flex-wrap items-center gap-3">
                {!complete ? <Button type="primary" loading={busy} disabled={loading || (download && (!backupId || !domains.length))} onClick={() => download ? void confirmDownload() : void run()}>{download ? "下载到本地" : "开始上传"}</Button> : null}
                {busy ? <Button disabled={progress.includes("恢复数据")} onClick={() => controller.current?.abort()}>取消</Button> : <Button type="text" icon={<ArrowLeft className="size-4" />} onClick={() => window.location.assign("/config?tab=server-sync")}>{complete ? "返回工作台" : "返回设置"}</Button>}
            </div>
        </main>
    );
}
