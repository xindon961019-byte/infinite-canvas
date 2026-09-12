import { useEffect, useState } from "react";
import localforage from "localforage";
import { App } from "antd";
import { encodeCloudURLs, reviveCloudURLs } from "@/services/cloud/media-urls";

import type { SubjectMedia } from "@/stores/use-subject-store";
export type Media = SubjectMedia;
export type Part = { text: string; id?: string; kind?: "subject" | "asset" };
export type Preference = { ratio: string; model: string; quality: string };
export type Workspace = { assets: Media[]; parts: Part[]; auto: boolean; kind: "image" | "video"; image: Preference; video: Preference };
const storage = localforage.createInstance({ name: "infinite-canvas", storeName: "ai_workspace" });
const initial: Workspace = { assets: [], parts: [], auto: true, kind: "image", image: { ratio: "智能", model: "", quality: "auto" }, video: { ratio: "智能", model: "", quality: "auto" } };
let writeQueue = Promise.resolve();
let writeError: unknown;
export async function flushWorkspaceWrites() { await writeQueue; if (writeError) throw new Error("工作台草稿尚未保存成功，请先处理本地存储问题"); }

export function useWorkspace() {
    const { message } = App.useApp();
    const [data, setData] = useState<Workspace>(initial);
    const [ready, setReady] = useState(false);
    useEffect(() => {
        let active = true;
        void writeQueue.then(() => storage.getItem<Workspace>("draft")).then(reviveCloudURLs).then((saved) => {
            if (active) { setData(saved || initial); setReady(true); }
        }).catch(() => { if (active) void message.error("无法读取工作台草稿，请刷新后重试"); });
        return () => { active = false; };
    }, [message]);
    useEffect(() => {
        if (!ready) return;
        writeQueue = writeQueue.then(() => storage.setItem("draft", encodeCloudURLs(data))).then(() => { writeError = undefined; }).catch((error) => { writeError = error; void message.error("工作台保存失败，请检查浏览器存储空间"); });
    }, [data, ready, message]);
    return { data, setData, ready };
}
