import { CONFIG_STORE_KEY, defaultConfig, defaultWebdavSyncConfig } from "@/stores/use-config-store";
import type { Json } from "./types";

export type Setting = { id: string; store: string; key: string; value: string };
export const isAppSetting = (key: string) => /^(infinite-canvas:|canvas-agent-|canvas-side-panel-|canvas-image-quick-tools-)/.test(key) && !["infinite-canvas:canvas_store", "infinite-canvas:asset_store", "infinite-canvas:cloud-session"].includes(key);
export const setting = (store: string, key: string, value: string): Setting => ({ id: JSON.stringify([store, key]), store, key, value });

export function readSettings(): Setting[] {
    const items: Setting[] = [];
    for (const key of Object.keys(localStorage).filter(isAppSetting)) {
        const raw = localStorage.getItem(key)!;
        if (key !== CONFIG_STORE_KEY) { items.push(setting("local", key, raw)); continue; }
        const { state } = JSON.parse(raw);
        for (const [field, value] of Object.entries(state.config || {})) {
            if (["channels", "models"].includes(field)) continue;
            items.push(setting("config", field, JSON.stringify(value)));
        }
        for (const channel of state.config?.channels || []) {
            const { models, ...info } = channel;
            items.push(setting("channel", channel.id, JSON.stringify(info)));
            for (const model of models || []) items.push(setting("model", JSON.stringify([channel.id, model.name]), JSON.stringify(model)));
        }
        for (const [field, value] of Object.entries(state.webdav || {})) items.push(setting("webdav", field, JSON.stringify(value)));
    }
    return items;
}

export function settingsWrites(items: Setting[]): Map<string, string> {
    const writes = new Map<string, string>();
    const raw = localStorage.getItem(CONFIG_STORE_KEY);
    const envelope = raw ? JSON.parse(raw) : { state: { config: { ...defaultConfig, channels: [] }, webdav: defaultWebdavSyncConfig }, version: 0 };
    const state = envelope.state;
    let configChanged = false;
    const ordered = [...items].sort((a, b) => Number(a.store === "model") - Number(b.store === "model"));
    for (const item of ordered) {
        if (item.store === "local") {
            if (!isAppSetting(item.key) || item.key === CONFIG_STORE_KEY) throw new Error("配置存储键不受支持");
            writes.set(item.key, item.value); continue;
        }
        if (["app_state", "prompt_cache"].includes(item.store)) continue;
        const value = JSON.parse(item.value) as Json;
        if (item.store === "config" || item.store === "webdav") {
            if (["__proto__", "constructor", "prototype", "channels", "models"].includes(item.key)) throw new Error("配置字段无效");
            state[item.store][item.key] = value;
        } else if (item.store === "channel") {
            const old = state.config.channels.find((channel: { id: string }) => channel.id === item.key);
            const next = { ...(value as object), models: old?.models || [] };
            state.config.channels = [...state.config.channels.filter((channel: { id: string }) => channel.id !== item.key), next];
        } else if (item.store === "model") {
            const [channelId, name] = JSON.parse(item.key);
            const channel = state.config.channels.find((channel: { id: string }) => channel.id === channelId);
            if (!channel) throw new Error("模型对应渠道缺失，请先同步渠道");
            channel.models = [...channel.models.filter((model: { name: string }) => model.name !== name), value];
        } else throw new Error("未知配置存储类型");
        configChanged = true;
    }
    if (configChanged) writes.set(CONFIG_STORE_KEY, JSON.stringify(envelope));
    return writes;
}
