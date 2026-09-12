import { createBrowserRouter, Outlet } from "react-router-dom";

// Keep the business stores out of login/sync pages until the application lock is acquired.
export const router = createBrowserRouter([
    {
        lazy: async () => {
            const [{ AppProviders }, { default: UserLayout }, { AnalyticsTracker }] = await Promise.all([
                import("@/components/layout/app-providers"), import("@/layouts/user-layout"), import("@/components/layout/analytics-tracker"),
            ]);
            return { Component: function UserRoot() { return <AppProviders><UserLayout><AnalyticsTracker /><Outlet /></UserLayout></AppProviders>; } };
        },
        children: [
            { path: "/", lazy: async () => ({ Component: (await import("@/pages/home")).default }) },
            { path: "/ai", lazy: async () => ({ Component: (await import("@/pages/ai")).default }) },
            { path: "/image", lazy: async () => ({ Component: (await import("@/pages/image")).default }) },
            { path: "/video", lazy: async () => ({ Component: (await import("@/pages/video")).default }) },
            { path: "/assets", lazy: async () => ({ Component: (await import("@/pages/assets")).default }) },
            { path: "/prompts", lazy: async () => ({ Component: (await import("@/pages/prompts")).default }) },
            { path: "/canvas", lazy: async () => ({ Component: (await import("@/pages/canvas")).default }) },
            { path: "/canvas/:id", lazy: async () => ({ Component: (await import("@/pages/canvas/project")).default }) },
            { path: "/config", lazy: async () => ({ Component: (await import("@/pages/config")).default }) },
        ],
    },
    {
        lazy: async () => ({ Component: (await import("@/layouts/cloud-layout")).default }),
        children: [
            { path: "/login", lazy: async () => ({ Component: (await import("@/pages/login")).default }) },
            { path: "/server-sync", lazy: async () => ({ Component: (await import("@/pages/server-sync")).default }) },
        ],
    },
    { path: "*", lazy: async () => ({ Component: (await import("@/pages/not-found")).default }) },
]);
