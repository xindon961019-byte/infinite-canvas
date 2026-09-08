import localforage from "localforage";

export const MEDIA_MARKER = "cloud-media:";
const urls = new Map<string, string>();
const resolved = new Map<string, string>();
const images = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const media = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });

export function cloudMediaKey(value: string) { return value.startsWith(MEDIA_MARKER) ? value.slice(MEDIA_MARKER.length) : urls.get(value); }
export function rememberMediaURL(key: string, url: string) { urls.set(url, key); }
export function encodeCloudURLs<T>(value: T): T {
    return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "string" && urls.has(item) ? MEDIA_MARKER + urls.get(item) : item)) as T;
}

export async function reviveCloudURLs<T>(value: T): Promise<T> {
    if (typeof value === "string" && value.startsWith(MEDIA_MARKER)) {
        const key = value.slice(MEDIA_MARKER.length);
        let url = resolved.get(key);
        if (!url) {
            const blob = await (key.startsWith("image:") ? images : media).getItem<Blob>(key);
            if (!(blob instanceof Blob)) throw new Error(`本地媒体文件缺失：${key}`);
            url = URL.createObjectURL(blob); resolved.set(key, url); rememberMediaURL(key, url);
        }
        return url as T;
    }
    if (Array.isArray(value)) return await Promise.all(value.map(reviveCloudURLs)) as T;
    if (value && typeof value === "object") return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await reviveCloudURLs(item)]))) as T;
    return value;
}
