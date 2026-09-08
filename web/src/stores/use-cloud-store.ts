import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type CloudRole = "super_admin" | "user";
export type CloudSession = { accessToken: string; expiresAt: string; user: { username: string; role: CloudRole; workspaceId: string } };
export const CLOUD_DEFAULT_BASE_URL = "https://infinite-backend.zemra.cn";
type CloudState = {
    baseUrl: string;
    session: CloudSession | null;
    signIn: (baseUrl: string, session: CloudSession) => void;
    signOut: () => void;
};

export const useCloudStore = create<CloudState>()(
    persist(
        (set) => ({
            baseUrl: CLOUD_DEFAULT_BASE_URL,
            session: null,
            signIn: (baseUrl, session) => set({ baseUrl, session }),
            signOut: () => set({ session: null }),
        }),
        {
            name: "infinite-canvas:cloud-session",
            storage: createJSONStorage(() => sessionStorage),
            version: 2,
            migrate: (state) => {
                const saved = state as Partial<CloudState> | undefined;
                return { ...saved, baseUrl: saved?.baseUrl === window.location.origin ? CLOUD_DEFAULT_BASE_URL : saved?.baseUrl || CLOUD_DEFAULT_BASE_URL, session: null } as CloudState;
            },
        },
    ),
);
