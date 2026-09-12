import type { Subject, SubjectMedia } from "@/stores/use-subject-store";
import type { Workspace } from "@/pages/ai/use-workspace";

export type CreationRequest = {
    version: 1;
    id: string;
    mode: "agent";
    parts: Workspace["parts"];
    subjects: Subject[];
    media: { id: string; kind: "image" | "audio" | "video"; name: string; url: string; owners: { kind: "subject" | "asset"; id: string }[] }[];
    preferences: { auto: boolean; kind: "image" | "video"; ratio?: string; model?: string; quality?: string };
};

export function buildCreationRequest(workspace: Workspace, subjects: Subject[], model: string): CreationRequest {
    const selected = new Map<string, Subject>();
    const assets = new Map(workspace.assets.map((asset) => [asset.id, asset]));
    for (const part of workspace.parts) {
        if (!part.id) continue;
        if (part.kind === "subject") {
            const subject = subjects.find((item) => item.id === part.id);
            if (!subject || !subject.images.length) throw new Error(`主体引用已失效：${part.text}`);
            selected.set(subject.id, subject);
        } else if (part.kind !== "asset" || !assets.has(part.id)) throw new Error(`素材引用已失效：${part.text}`);
    }
    const media: CreationRequest["media"] = [];
    const append = (item: SubjectMedia, owner: CreationRequest["media"][number]["owners"][number]) => {
        if (!item.url) throw new Error(`参考文件缺失：${item.name}`);
        const kind = item.type.split("/")[0];
        if (kind !== "image" && kind !== "audio" && kind !== "video") throw new Error(`不支持的参考素材：${item.name}`);
        let existing = media.find((resource) => resource.url === item.url && resource.kind === kind);
        if (!existing) { existing = { id: item.id, kind, name: item.name, url: item.url, owners: [] }; media.push(existing); }
        if (!existing.owners.some((value) => value.kind === owner.kind && value.id === owner.id)) existing.owners.push(owner);
    };
    workspace.assets.forEach((item) => append(item, { kind: "asset", id: item.id }));
    for (const subject of selected.values()) {
        subject.images.forEach((item) => append(item, { kind: "subject", id: subject.id }));
        if (subject.voice) append(subject.voice, { kind: "subject", id: subject.id });
    }
    const preferences: CreationRequest["preferences"] = workspace.auto ? { auto: true, kind: workspace.kind } : { auto: false, kind: workspace.kind, ...workspace[workspace.kind], model };
    if (!workspace.auto && !model) throw new Error("请选择生成模型");
    return structuredClone({ version: 1, id: crypto.randomUUID(), mode: "agent", parts: workspace.parts, subjects: [...selected.values()], media, preferences });
}

/** Stable semantic labels; a channel script may translate these to its provider's reference syntax. */
export function creationPrompt(creation: CreationRequest) {
    const counters = { image: 0, video: 0, audio: 0 };
    const labels = creation.media.map((item) => `${{ image: "图片", video: "视频", audio: "音频" }[item.kind]}${++counters[item.kind]}`);
    const ownerLabels = (kind: "subject" | "asset", id: string) => creation.media.flatMap((item, index) => item.owners.some((owner) => owner.kind === kind && owner.id === id) ? [labels[index]] : []);
    const prompt = creation.parts.map((part) => part.id ? `【${part.kind === "subject" ? creation.subjects.find((subject) => subject.id === part.id)?.name || part.text : ownerLabels("asset", part.id).join("、")}】` : part.text).join("");
    const subjects = creation.subjects.map((subject) => `主体【${subject.name}】对应${ownerLabels("subject", subject.id).join("、")}。${subject.description}`);
    return [prompt, ...subjects].filter(Boolean).join("\n");
}
