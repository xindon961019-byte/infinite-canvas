import { useCloudStore, type CloudSession } from "@/stores/use-cloud-store";
import type { Backup, BackupSummary, CloudStatus, Manifest, Media } from "@/services/cloud/types";

export class CloudError extends Error {
    constructor(message: string, public status: number, public code: string) { super(message); }
}

export function normalizeServerURL(value: string) {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("请输入完整的服务器源地址，例如 https://canvas.example.com，不要附加 API 路径");
    return url.origin;
}

async function request<T>(path: string, options: { method?: string; json?: unknown; body?: BodyInit; headers?: Record<string, string>; baseUrl?: string; anonymous?: boolean; binary?: boolean; signal?: AbortSignal } = {}): Promise<T> {
    const { baseUrl, session } = useCloudStore.getState();
    const headers = new Headers(options.headers);
    if (!options.anonymous) {
        if (!session) throw new CloudError("请先登录服务器", 401, "UNAUTHORIZED");
        headers.set("Authorization", `Bearer ${session.accessToken}`);
    }
    if (options.json !== undefined) headers.set("Content-Type", "application/json");
    const response = await fetch(`${options.baseUrl || baseUrl}/api/cloud/v1${path}`, {
        method: options.method || "GET", headers, body: options.json === undefined ? options.body : JSON.stringify(options.json),
        signal: options.signal, credentials: "omit", cache: "no-store", redirect: "error",
    });
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        if (response.status === 401 && !options.anonymous && useCloudStore.getState().session?.accessToken === session?.accessToken) useCloudStore.getState().signOut();
        throw new CloudError(payload?.error?.message || `服务器请求失败（${response.status}）`, response.status, payload?.error?.code || "HTTP_ERROR");
    }
    if (response.status === 204) return undefined as T;
    return (options.binary ? response.blob() : response.json()) as Promise<T>;
}

export const cloudAPI = {
    login: (baseUrl: string, username: string, password: string, signal?: AbortSignal) => request<CloudSession>("/auth/login", { method: "POST", json: { username, password }, baseUrl, anonymous: true, signal }),
    me: (signal?: AbortSignal) => request<{ username: string; role: CloudSession["user"]["role"]; workspaceId: string; expiresAt: string }>("/auth/me", { signal }),
    logout: () => request<void>("/auth/logout", { method: "POST" }),
    status: (signal?: AbortSignal) => request<CloudStatus>("/status", { signal }),
    list: (cursor?: string, signal?: AbortSignal) => request<{ items: BackupSummary[]; nextCursor: string | null }>(`/backups${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { signal }),
    backup: (id: string, signal?: AbortSignal) => request<Backup>(`/backups/${encodeURIComponent(id)}`, { signal }),
    create: (manifest: Manifest, key: string, signal?: AbortSignal) => request<Backup>("/backups", { method: "POST", json: { manifest }, headers: { "Idempotency-Key": key }, signal }),
    commit: (id: string, signal?: AbortSignal) => request<{ backupId: string; state: "committed" }>(`/backups/${encodeURIComponent(id)}/commit`, { method: "POST", signal }),
    upload: (blob: Blob, sha: string, signal?: AbortSignal) => {
        const form = new FormData(); form.set("sha256", sha); form.set("purpose", "backup"); form.set("file", blob, "media");
        return request<Media>("/media", { method: "POST", body: form, signal });
    },
    media: (id: string, signal?: AbortSignal) => request<Blob>(`/media/${encodeURIComponent(id)}/content`, { binary: true, signal }),
};

// External media never receives the Cloud bearer token or browser credentials.
export async function fetchCloudSource(url: string, signal?: AbortSignal) {
    if (!/^(https?:|data:|blob:)/.test(url)) throw new Error("不支持的媒体地址");
    const response = await fetch(url, { credentials: "omit", signal });
    if (!response.ok) throw new Error(`读取参考文件失败（${response.status}）`);
    return response.blob();
}
