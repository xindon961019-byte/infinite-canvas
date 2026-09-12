import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Spin } from "antd";
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useCloudStore } from "@/stores/use-cloud-store";
import { synchronize, type ResolveConflict } from "@/services/cloud/incremental";

export default function IncrementalPage() {
    const [params] = useSearchParams();
    const download = params.get("direction") === "download";
    const { modal } = App.useApp();
    const session = useCloudStore(state => state.session);
    const baseUrl = useCloudStore(state => state.baseUrl);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState("");
    const [error, setError] = useState("");
    const [count, setCount] = useState<number | null>(null);
    const controller = useRef<AbortController | null>(null);
    useEffect(() => {
        if (!session) window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }, [session]);
    useEffect(() => () => controller.current?.abort(), []);
    useEffect(() => {
        if (!busy) return;
        const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", guard);
        return () => window.removeEventListener("beforeunload", guard);
    }, [busy]);
    const run = async () => {
        if (controller.current) return;
        const abort = new AbortController(); controller.current = abort;
        setBusy(true); setError(""); setCount(null);
        const resolve: ResolveConflict = label => new Promise(done => {
            const finish = (choice: "local" | "server" | "cancel") => { abort.signal.removeEventListener("abort", cancel); dialog.destroy(); done(choice); };
            const cancel = () => finish("cancel");
            const dialog = modal.confirm({ title: "两台设备修改了同一条记录", content: <p className="break-all">{label}</p>, okText: "使用服务器版本", cancelText: "保留本地版本", closable: false, maskClosable: false, keyboard: false, onOk: () => finish("server"), onCancel: () => finish("local") });
            abort.signal.addEventListener("abort", cancel, { once: true });
            if (abort.signal.aborted) cancel();
        });
        try { setCount(await synchronize(download ? "download" : "upload", setProgress, resolve, abort.signal)); }
        catch (cause) { setError(abort.signal.aborted ? "同步已取消，已经完成的记录保留，可再次同步。" : cause instanceof Error ? cause.message : "同步失败"); }
        finally { controller.current = null; setBusy(false); }
    };
    return <main className="mx-auto max-w-2xl px-6 pt-10 pb-20 sm:pt-16">
        <div className="mb-8 flex items-center gap-4">{download ? <ArrowDownToLine size={30} /> : <ArrowUpFromLine size={30} />}<h1 className="text-2xl font-medium">{download ? "从服务器同步" : "同步到服务器"}</h1></div>
        <p className="mb-8 break-all text-sm text-muted-foreground">{session?.user.username} · {baseUrl}</p>
        {error && <Alert title={error} type="error" showIcon className="mb-6" />}
        <div className="divide-y divide-border border-y border-border text-sm">
            {["画布、素材与生成记录", "主体图片、音色与 AI 工作台", "渠道、API 密钥与模型脚本", "偏好、提示词来源、插件与 Agent 连接配置"].map(label => <div key={label} className="py-4">{label}</div>)}
        </div>
        {count !== null && <Alert className="mt-6" type="success" showIcon title={count ? `已同步 ${count} 条变更` : "没有需要同步的变更"} />}
        {busy && <div className="mt-6 flex items-center gap-3" role="status"><Spin size="small" /><span className="min-w-0 break-all text-sm">{progress}</span></div>}
        <div className="mt-8 flex flex-wrap gap-3">
            <Button type="primary" loading={busy} disabled={!session} onClick={() => void run()}>{download ? "拉取变更" : "上传变更"}</Button>
            {busy ? <Button onClick={() => controller.current?.abort()}>取消</Button> : <Button type="text" icon={<ArrowLeft size={16} />} onClick={() => window.location.assign("/config?tab=server-sync")}>返回设置</Button>}
            {!busy && <Button type="text" onClick={() => window.location.assign("/server-sync?direction=download&mode=restore")}>恢复历史备份</Button>}
        </div>
    </main>;
}
