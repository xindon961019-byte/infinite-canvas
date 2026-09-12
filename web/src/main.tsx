import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "streamdown/styles.css";
import "./styles/globals.css";
import { RouterProvider } from "react-router-dom";

import { startWithApplicationLock } from "@/services/cloud/session-lock";
import { recoverSettings } from "@/services/cloud/settings-recovery";
import { initAnalytics } from "@/lib/analytics";


initAnalytics();

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

const container = document.getElementById("root")!;
container.textContent = "正在打开工作台，如其他页面正在同步，请等待其完成…";
void startWithApplicationLock(async () => {
    await recoverSettings();
    await import("@/i18n");
    const { router } = await import("@/router");
    createRoot(container).render(<React.StrictMode><RouterProvider router={router} /></React.StrictMode>);
}).catch(() => { container.textContent = "无法打开工作台，请刷新页面重试。"; });
