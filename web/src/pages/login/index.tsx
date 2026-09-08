import { Alert, Button, Form, Input } from "antd";
import { ArrowLeft, ArrowRight, Cloud, LockKeyhole, UserRound } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { cloudAPI, normalizeServerURL } from "@/services/api/cloud";
import { CLOUD_DEFAULT_BASE_URL, useCloudStore } from "@/stores/use-cloud-store";

export default function LoginPage() {
    const baseUrl = useCloudStore(state => state.baseUrl);
    const [params] = useSearchParams();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const login = async (values: { server: string; username: string; password: string }) => {
        setLoading(true); setError("");
        try {
            const server = normalizeServerURL(values.server);
            const session = await cloudAPI.login(server, values.username, values.password, AbortSignal.timeout(30_000));
            useCloudStore.getState().signIn(server, session);
            const next = params.get("next");
            window.location.assign(next?.startsWith("/server-sync?") ? next : "/config?tab=server-sync");
        } catch (cause) { setError(cause instanceof Error ? cause.message : "登录失败，请检查服务器地址与账号密码"); }
        finally { setLoading(false); }
    };
    return (
        <main className="mx-auto grid min-h-[calc(100dvh-100px)] max-w-6xl items-center gap-12 px-6 pb-16 sm:px-10 lg:grid-cols-[1.1fr_1fr] lg:gap-24">
            <section className="hidden self-stretch py-24 lg:flex lg:flex-col lg:justify-center">
                <span className="mb-7 text-xs tracking-[0.22em] text-muted-foreground">你的创作 · 你的服务器</span>
                <h1 className="text-5xl leading-[1.25] font-medium tracking-tight">把创作保存好，<br />在另一处继续。</h1>
                <p className="mt-6 max-w-sm text-sm leading-7 text-muted-foreground">将画布、素材与生成记录保存到自己的服务器。需要时，再下载到当前设备。</p>
                <div className="mt-14 flex items-center gap-5 border-t border-border pt-7 text-xs text-muted-foreground"><span>本地创作</span><span className="h-px w-14 bg-border" /><Cloud className="size-5" /><span className="h-px w-14 bg-border" /><span>服务器备份</span></div>
            </section>
            <section className="mx-auto w-full max-w-sm py-10">
                <Cloud className="mb-7 size-8" strokeWidth={1.5} />
                <h2 className="text-3xl font-medium tracking-tight">登录服务器</h2>
                <p className="mt-3 mb-8 text-sm leading-6 text-muted-foreground">登录后，即可上传和下载你的创作数据。</p>
                {error ? <Alert title={error} type="error" showIcon className="mb-5" /> : null}
                <Form layout="vertical" initialValues={{ server: baseUrl || CLOUD_DEFAULT_BASE_URL }} onFinish={login} requiredMark={false} disabled={loading} autoComplete="off">
                    <Form.Item name="server" label="服务器地址" rules={[{ required: true, message: "请输入服务器地址" }]} extra="默认连接云端后端，也可以填写其他兼容服务器地址。"><Input size="large" placeholder="https://canvas.example.com" autoComplete="url" /></Form.Item>
                    <Form.Item name="username" label="账号" rules={[{ required: true, message: "请输入账号" }]}><Input size="large" prefix={<UserRound className="mr-1 size-4 text-muted-foreground" />} autoComplete="off" placeholder="输入登录账号" /></Form.Item>
                    <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}><Input.Password size="large" prefix={<LockKeyhole className="mr-1 size-4 text-muted-foreground" />} autoComplete="new-password" placeholder="输入登录密码" /></Form.Item>
                    <Button htmlType="submit" type="primary" size="large" block loading={loading} icon={<ArrowRight className="size-4" />} iconPlacement="end" className="mt-2">登录</Button>
                </Form>
                <a href="/" className="mt-7 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" />返回本地工作台</a>
            </section>
        </main>
    );
}
