import { App, ConfigProvider } from "antd";
import zhCN from "antd/es/locale/zh_CN";
import { Infinity as InfinityIcon, Moon, Sun } from "lucide-react";
import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { getAntThemeConfig } from "@/lib/app-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export default function CloudLayout() {
    const theme = useThemeStore(state => state.theme);
    const setTheme = useThemeStore(state => state.setTheme);
    useEffect(() => {
        document.documentElement.classList.toggle("dark", theme === "dark");
        document.documentElement.style.colorScheme = theme;
    }, [theme]);
    return (
        <ConfigProvider locale={zhCN} theme={getAntThemeConfig(theme === "dark")}>
            <App>
                <div className="min-h-dvh bg-background text-foreground">
                    <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-7 sm:px-10">
                        <div className="flex items-center gap-3"><InfinityIcon className="size-7" /><span className="text-sm font-semibold tracking-wide">Infinite Canvas</span><span className="ml-3 border-l border-border pl-4 text-xs text-muted-foreground">服务器同步</span></div>
                        <button type="button" aria-label={theme === "dark" ? "切换浅色主题" : "切换深色主题"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="p-2 text-muted-foreground hover:text-foreground">{theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}</button>
                    </header>
                    <Outlet />
                </div>
            </App>
        </ConfigProvider>
    );
}
