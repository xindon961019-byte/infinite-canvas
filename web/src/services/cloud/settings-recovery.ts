import { openDB } from "idb";

export type SettingsJournal = { id: string; before: [string, string | null][]; after: [string, string][] };
export const settingsJournalKey = "settings-journal";
export const settingsCommitKey = "settings-commit";

// localStorage and IndexedDB cannot share a transaction; the durable journal resolves interrupted commits.
export async function recoverSettings() {
    const db = await openDB("infinite-canvas");
    try {
        if (!db.objectStoreNames.contains("cloud_restore")) return;
        const journal = await db.get("cloud_restore", settingsJournalKey) as SettingsJournal | undefined;
        if (!journal) return;
        const committed = await db.get("cloud_restore", settingsCommitKey) === journal.id;
        for (const [key, value] of committed ? journal.after : journal.before) {
            if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
        }
        await db.delete("cloud_restore", settingsJournalKey);
    } finally { db.close(); }
}
