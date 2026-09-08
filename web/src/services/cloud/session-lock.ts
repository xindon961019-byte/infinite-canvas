export const applicationLock = "infinite-canvas:application-data-v1";

export function requireSyncSupport() {
    if (!window.isSecureContext || !navigator.locks || !window.indexedDB) throw new Error("服务器同步需要 HTTPS（本机 localhost 也可）及支持 IndexedDB、Web Locks 的浏览器");
}

export async function withSyncLock<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    requireSyncSupport();
    signal?.throwIfAborted();
    return navigator.locks.request(applicationLock, { mode: "exclusive", ifAvailable: true }, async lock => {
        if (!lock) throw new Error("请先关闭其他正在打开本应用的标签页，再重试。当前页面不会自动关闭你的其他窗口。");
        return run();
    });
}

/** The business bundle and its auto-hydrating stores are imported only after this gate. */
export async function startWithApplicationLock(start: () => Promise<void>) {
    if (["/login", "/server-sync"].includes(window.location.pathname)) return start();
    if (!navigator.locks) return start(); // Local-only usage remains available in unsupported browsers.
    await navigator.locks.request(applicationLock, { mode: "shared" }, async () => {
        await start();
        await new Promise<void>(resolve => {
            window.addEventListener("pagehide", () => { document.documentElement.inert = true; resolve(); }, { once: true });
        });
    });
}

window.addEventListener("pageshow", event => {
    if (event.persisted) { document.documentElement.inert = true; window.location.reload(); }
});
