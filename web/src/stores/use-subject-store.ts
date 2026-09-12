import { create } from "zustand";
import localforage from "localforage";
import { encodeCloudURLs, reviveCloudURLs } from "@/services/cloud/media-urls";

export type SubjectMedia = { id: string; name: string; url: string; type: string };
export type Subject = { id: string; name: string; description: string; images: SubjectMedia[]; voice?: SubjectMedia };
const storage = localforage.createInstance({ name: "infinite-canvas", storeName: "subjects" });
let loading: Promise<void> | undefined;
let writes = Promise.resolve();
export async function flushSubjectWrites() { await writes; }
type State = {
    subjects: Subject[];
    ready: boolean;
    load: () => Promise<void>;
    save: (subject: Subject) => Promise<void>;
    remove: (id: string) => Promise<void>;
};
export const useSubjectStore = create<State>((set, get) => {
    const update = (transform: (items: Subject[]) => Subject[]) => {
        const result = writes.then(async () => {
            await get().load();
            const subjects = transform(get().subjects);
            await storage.setItem("items", encodeCloudURLs(subjects));
            set({ subjects });
        });
        writes = result.catch(() => undefined);
        return result;
    };
    return {
        subjects: [], ready: false,
        load: () => {
            if (get().ready) return Promise.resolve();
            if (!loading) loading = storage.getItem<Subject[]>("items").then(reviveCloudURLs).then((subjects) => { set({ subjects: subjects || [], ready: true }); }).finally(() => { loading = undefined; });
            return loading;
        },
        save: (subject) => update((items) => [subject, ...items.filter((item) => item.id !== subject.id)]),
        remove: (id) => update((items) => items.filter((item) => item.id !== id)),
    };
});

export async function readSubjectMedia(files: FileList | File[] | null): Promise<SubjectMedia[]> {
    return Promise.all(Array.from(files || []).map((file) => new Promise<SubjectMedia>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ id: crypto.randomUUID(), name: file.name, type: file.type, url: String(reader.result) });
        reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
        reader.readAsDataURL(file);
    })));
}
