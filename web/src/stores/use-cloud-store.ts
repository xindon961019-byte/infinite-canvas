import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type CloudSession = { accessToken: string; expiresAt: string; user: { username: string; workspaceId: string } };
type CloudState = {
    baseUrl: string;
    session: CloudSession | null;
    signIn: (baseUrl: string, session: CloudSession) => void;
    signOut: () => void;
};

export const useCloudStore = create<CloudState>()(
    persist(
        (set) => ({
            baseUrl: window.location.origin,
            session: null,
            signIn: (baseUrl, session) => set({ baseUrl, session }),
            signOut: () => set({ session: null }),
        }),
        { name: "infinite-canvas:cloud-session", storage: createJSONStorage(() => sessionStorage) },
    ),
);
