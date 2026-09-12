import { imageMetadata, audioMetadata, videoMetadata } from "@/lib/canvas/canvas-node-factory";
import { uploadImage } from "@/services/image-storage";
import { uploadMediaFile } from "@/services/file-storage";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeImage } from "@/types/canvas";

async function materializeCanvasMedia(projects: CanvasProject[]) {
    const cache = new Map<string, unknown>();
    const materializeImage = async (item: CanvasNodeImage) => {
        if (!item.content || item.storageKey) return item;
        const cached = cache.get(`image:${item.content}`) as ReturnType<typeof imageMetadata> | undefined;
        const uploaded = cached || await uploadImage(item.content);
        cache.set(`image:${item.content}`, uploaded);
        return { ...item, ...imageMetadata(uploaded) };
    };
    const nextProjects = await Promise.all(projects.map(async (project) => ({
        ...project,
        nodes: await Promise.all(project.nodes.map(async (node: CanvasNodeData) => {
            if (!node.metadata) return node;
            let metadata = node.metadata;
            if (node.type === CanvasNodeType.Image && metadata.content && !metadata.storageKey) {
                const cached = cache.get(`image:${metadata.content}`) as ReturnType<typeof imageMetadata> | undefined;
                const uploaded = cached || await uploadImage(metadata.content);
                cache.set(`image:${metadata.content}`, uploaded);
                metadata = { ...metadata, ...imageMetadata(uploaded) };
            } else if ((node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && metadata.content && !metadata.storageKey) {
                const kind = node.type === CanvasNodeType.Video ? "video" : "audio";
                const cached = cache.get(`${kind}:${metadata.content}`) as ReturnType<typeof videoMetadata> | ReturnType<typeof audioMetadata> | undefined;
                const uploaded = cached || await uploadMediaFile(metadata.content, kind);
                cache.set(`${kind}:${metadata.content}`, uploaded);
                metadata = { ...metadata, ...(node.type === CanvasNodeType.Video ? videoMetadata(uploaded) : audioMetadata(uploaded)) };
            }
            if (metadata.images?.length) metadata = { ...metadata, images: await Promise.all(metadata.images.map(materializeImage)) };
            return metadata === node.metadata ? node : { ...node, metadata };
        })),
    })));
    return nextProjects;
}

export async function leaveForCloud(path: string) {
    const [{ useCanvasStore, flushCanvasPersistence }, { useAssetStore }, { localForageStorage, flushLocalWrites }] = await Promise.all([
        import("@/stores/canvas/use-canvas-store"), import("@/stores/use-asset-store"), import("@/lib/localforage-storage"),
    ]);
    if (!useCanvasStore.getState().hydrated || !useAssetStore.getState().hydrated) throw new Error("本地数据尚未加载完成，请稍后重试");
    const state = useCanvasStore.getState();
    const projects = await materializeCanvasMedia(state.projects);
    if (projects !== state.projects) useCanvasStore.getState().replaceProjects(projects, state.deletedProjects);
    await flushCanvasPersistence();
    await localForageStorage.setItem("infinite-canvas:asset_store", JSON.stringify({ state: { assets: useAssetStore.getState().assets }, version: 0 }));
    await flushLocalWrites();
    const [{ flushSubjectWrites }, { flushWorkspaceWrites }] = await Promise.all([import("@/stores/use-subject-store"), import("@/pages/ai/use-workspace")]);
    await Promise.all([flushSubjectWrites(), flushWorkspaceWrites()]);
    window.location.assign(path);
}
