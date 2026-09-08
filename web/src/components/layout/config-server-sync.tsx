import { App, Button } from "antd";
import { ArrowDownToLine, ArrowUpFromLine, Cloud, LogIn, LogOut } from "lucide-react";
import { useState } from "react";
import { cloudAPI } from "@/services/api/cloud";
import { leaveForCloud } from "@/services/cloud/navigation";
import { requireSyncSupport } from "@/services/cloud/session-lock";
import { useCloudStore } from "@/stores/use-cloud-store";

export function ConfigServerSync() {
    const { message } = App.useApp();
    const session = useCloudStore(state => state.session);
    const baseUrl = useCloudStore(state => state.baseUrl);
    const [leaving, setLeaving] = useState(false);
    const go = async (direction?: "upload" | "download") => {
        setLeaving(true);
        try {
            if (direction) requireSyncSupport();
            const next = direction ? `/server-sync?direction=${direction}&operation=${crypto.randomUUID()}` : "/config?tab=server-sync";
            await leaveForCloud(session && direction ? next : `/login?next=${encodeURIComponent(next)}`);
        } catch (error) { message.error(error instanceof Error ? error.message : "无法打开同步页面"); setLeaving(false); }
    };
    const logout = async () => {
        try { await cloudAPI.logout(); useCloudStore.getState().signOut(); message.success("已退出服务器登录"); }
        catch (error) { message.error(error instanceof Error ? error.message : "退出失败"); }
    };
    return (
        <section className="py-3">
            <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
                <div><h3 className="flex items-center gap-2 text-base font-medium"><Cloud className="size-5" />服务器同步</h3><p className="mt-2 text-sm text-muted-foreground">保存画布、我的素材、生成记录及关联媒体。下载前可选择备份与恢复范围。</p></div>
                {session ? <Button type="text" size="small" icon={<LogOut className="size-3.5" />} onClick={() => void logout()} disabled={leaving}>退出登录</Button> : <Button type="text" icon={<LogIn className="size-4" />} onClick={() => void go()} disabled={leaving}>登录服务器</Button>}
            </div>
            <div className="mb-5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"><span>{session ? `已登录 · ${session.user.username} · ${session.user.role === "super_admin" ? "超管" : "用户"}` : "尚未登录服务器"}</span><span className="break-all">{baseUrl}</span></div>
            <div className="grid gap-2 border-y border-border py-4 sm:grid-cols-2">
                <Button type="text" className="!h-auto !justify-start !rounded-none !px-4 !py-5" disabled={leaving} onClick={() => void go("upload")}>
                    <ArrowUpFromLine className="mr-4 size-6 shrink-0" strokeWidth={1.5} /><span className="text-left"><span className="block text-sm font-medium">数据上传</span><span className="mt-1.5 block text-xs text-muted-foreground">本地数据保存至服务器</span></span>
                </Button>
                <Button type="text" className="!h-auto !justify-start !rounded-none !px-4 !py-5" disabled={leaving} onClick={() => void go("download")}>
                    <ArrowDownToLine className="mr-4 size-6 shrink-0" strokeWidth={1.5} /><span className="text-left"><span className="block text-sm font-medium">数据下载</span><span className="mt-1.5 block text-xs text-muted-foreground">把服务器数据下载至本地</span></span>
                </Button>
            </div>
            <p className="mt-4 text-xs leading-6 text-muted-foreground">同步将在独立页面完成，请先结束正在进行的生成任务。下载会替换所选范围的本地数据，操作前会再次确认。</p>
            {leaving ? <p role="status" className="mt-2 text-xs text-muted-foreground">正在保存当前页面并打开同步…</p> : null}
        </section>
    );
}
