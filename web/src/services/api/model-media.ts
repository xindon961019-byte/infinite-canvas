import { fileTypeFromBlob } from "file-type";
import { cloudAPI, fetchCloudSource } from "./cloud";
import { hashBlob } from "@/services/cloud/codec";
import { useCloudStore } from "@/stores/use-cloud-store";

/** Only explicit model-script use uploads a local reference; credentials never enter the returned URL body. */
export async function modelMediaURL(input: Blob | string, kind: "image" | "video" | "audio", signal?: AbortSignal, persistent = false) {
    const { session, baseUrl } = useCloudStore.getState();
    const check = () => {
        signal?.throwIfAborted();
        const current = useCloudStore.getState();
        if (!session || current.session?.accessToken !== session.accessToken || current.baseUrl !== baseUrl) throw new Error("请先登录目标服务器，并在生成期间保持同一服务器会话");
    };
    check();
    if (typeof input === "string" && !/^(data:|blob:)/.test(input)) throw new Error("媒体链接工具只接受本地 Blob、Data URL 或当前浏览器 Blob URL");
    let blob = typeof input === "string" ? await fetchCloudSource(input, signal) : input;
    if (!(blob instanceof Blob) || !blob.size) throw new Error("参考媒体为空");
    const detected = await fileTypeFromBlob(blob);
    const mime = (detected?.mime || blob.type).replace("audio/x-wav", "audio/wav");
    if (!mime.startsWith(`${kind}/`)) throw new Error("参考媒体类型与声明用途不一致");
    blob = blob.slice(0, blob.size, mime);
    check();
    const status = await cloudAPI.status(signal);
    if (status.apiVersion !== 1 || status.workspaceId !== session!.user.workspaceId) throw new Error("服务器身份不一致，请重新登录");
    if (blob.size > status.policy.maxFileBytes) throw new Error("参考媒体超过服务器当前允许的文件大小");
    const sha256 = await hashBlob(blob, signal);
    check();
    const resolved = await cloudAPI.resolve([{ sha256, bytes: blob.size }], signal);
    check();
    const media = resolved.found.find((item) => item.sha256 === sha256) || await cloudAPI.upload(blob, sha256, signal, `reference-${kind}`);
    if (media.sha256 !== sha256 || media.bytes !== blob.size || media.mimeType !== mime) throw new Error("服务器媒体校验结果不一致");
    check();
    if (persistent) {
        if (kind !== "audio") throw new Error("长期地址仅支持参考音频");
        const published = await cloudAPI.persistentAudio(media.mediaId, signal);
        check();
        if (published.mediaId !== media.mediaId) throw new Error("服务器音频映射不一致");
        return { ...published, expiresAt: "", sha256, server: baseUrl, workspaceId: session!.user.workspaceId };
    }
    const grant = await cloudAPI.grant(media.mediaId, signal);
    check();
    if (grant.mediaId !== media.mediaId) throw new Error("服务器返回了不匹配的媒体授权");
    return { url: grant.url, expiresAt: grant.expiresAt };
}
