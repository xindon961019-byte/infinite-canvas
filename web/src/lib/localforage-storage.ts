import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";
import { encodeCloudURLs, reviveCloudURLs } from "@/services/cloud/media-urls";

const pendingWrites = new Set<Promise<void>>();
export async function flushLocalWrites() { while (pendingWrites.size) await Promise.all([...pendingWrites]); }
const isBusinessKey = (name: string) => name === "infinite-canvas:canvas_store" || name === "infinite-canvas:asset_store";

localforage.config({
    name: "infinite-canvas",
    storeName: "app_state",
});

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        let value: string | null;
        try { value = (await localforage.getItem<string>(name)) || null; }
        catch { value = window.localStorage.getItem(name); }
        return value && isBusinessKey(name) ? JSON.stringify(await reviveCloudURLs(JSON.parse(value))) : value;
    },
    setItem: (name, value) => {
        if (typeof window === "undefined") return;
        const serialized = isBusinessKey(name) ? JSON.stringify(encodeCloudURLs(JSON.parse(value))) : value;
        const write = (async () => {
            try { await localforage.setItem(name, serialized); }
            catch { window.localStorage.setItem(name, serialized); }
        })();
        pendingWrites.add(write);
        void write.then(() => pendingWrites.delete(write), () => pendingWrites.delete(write));
        return write;
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        try {
            await localforage.removeItem(name);
        } catch {
            window.localStorage.removeItem(name);
        }
    },
};
