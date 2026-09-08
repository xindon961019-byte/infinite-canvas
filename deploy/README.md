# infinite-canvas 部署记录

## 当前部署

- 站点：`https://infinite.zemra.cn`
- 服务器：`103.47.83.171`，SSH 端口 `28778`
- 目标目录：`/var/www/infinite-canvas`
- 当前 release：`/var/www/infinite-canvas/releases/20260908-014204`
- 当前链接：`/var/www/infinite-canvas/current`
- Web 服务：Nginx
- Nginx 配置：`/etc/nginx/sites-available/infinite-canvas`
- 证书：`/etc/letsencrypt/live/infinite.zemra.cn/`
- 发布方式：本地 Vite 生产构建后上传静态文件，由 Nginx 提供 SPA 和 HTTPS

## 云端后端

- 站点：`https://infinite-backend.zemra.cn`
- 目标目录：`/opt/infinite-canvas-cloud`
- 当前 release：`/opt/infinite-canvas-cloud/releases/20260908-152504`
- Compose 项目：`/opt/infinite-canvas-cloud/current`
- 服务：Docker Compose `api`（回环 `127.0.0.1:8080`）与 `postgres`（回环 `127.0.0.1:5432`）
- Nginx 配置：`/etc/nginx/sites-available/infinite-canvas-cloud`
- 证书：`/etc/letsencrypt/live/infinite-backend.zemra.cn/`
- 数据：Docker volumes `infinite-canvas-cloud_postgres_data`、`infinite-canvas-cloud_media_data`
- 凭据：由服务器外部管理，未写入仓库或部署记录

## 验证结果

- `http://infinite.zemra.cn/` 返回 301 并跳转到 HTTPS。
- `https://infinite.zemra.cn/` 返回 HTTP 200。
- 首页引用的 JavaScript、CSS 和 `config.js` 路径可访问。
- `/assets/` 路由刷新返回 SPA 入口页面，避免与真实静态资源目录同名时触发 Nginx 403。
- `nginx -t` 通过；本次仅切换静态文件，无需 reload。
- Let's Encrypt 证书已签发，Certbot 已配置自动续期。

## 回滚

当前已知可用的上一版本为 `/var/www/infinite-canvas/releases/20260907-162603`。回滚时将 `current` 原子切换到该目录，执行 `nginx -t`，然后重新检查站点内网与公网地址。静态文件切换不需要重启 Nginx。

## 标准发布

1. 在 `web/` 中执行 `npm run build`。
2. 将 `web/dist/` 打包并上传到服务器 `/tmp/` 下的唯一文件名。
3. 校验压缩包 SHA-256 后，解压到 `/var/www/infinite-canvas/releases/<release-id>`。
4. 检查 `index.html` 和首页引用的静态文件，再将 `current` 原子切换到新 release。
5. 执行 `nginx -t`，并从服务器内网和公网检查 HTTP 跳转、HTTPS 首页、静态文件及 SPA 路由回退。

## 配置修复

2026-09-07：为 `/assets/` 添加精确 SPA 回退规则。该路径既是应用路由又是静态资源目录名，直接访问目录会被 Nginx 以 403 拒绝；精确规则现在将目录路径回退到 `index.html`，而具体资源文件继续由静态资源规则提供。

## 发布历史

### 2026-09-08 01:42 CST — 20260908-014204

- 状态：发布成功
- 功能摘要：将 fork 仓库同步后的 `v0.18.0` 前端更新上线，包含画布交互、模型脚本配置、本地代理及媒体尺寸处理等版本变更。
- 代码：`main`，提交 `d213a74`，版本 `v0.18.0`
- 构建产物：`infinite-canvas-20260908-014204.tgz`，SHA-256 `3f68bdb0bc73f7c713bd7dae57a4394f860cbbbf6bf50e187ca5fe2cddc1f4c4`
- 激活路径：`/var/www/infinite-canvas/releases/20260908-014204`
- 上一可用版本：`/var/www/infinite-canvas/releases/20260907-162603`
- 构建结果：Vite 生产构建成功；存在代码分包体积提示，无构建错误。
- 服务端验证：发布包校验一致，`nginx -t` 通过，HTTP 返回 301，HTTPS 返回 200。
- 公网验证：首页、新版 JavaScript、CSS、`config.js` 与 `/assets/` SPA 回退均返回 200。
- 问题：解压时 GNU tar 忽略 macOS provenance 扩展属性，不影响文件内容或站点运行。
- 后续：无。

### 2026-09-08 08:00 UTC — 20260908-152504

- 状态：发布成功
- 功能摘要：部署前端云端同步入口及同级 Go 云端后端，新增后端域名反向代理和 HTTPS。
- 前端构建产物：`infinite-canvas-20260908-152504.tgz`，SHA-256 `8fb9f23b4bb03e955203fb66cd47164bbfe4d48ab1d21edce9be666680a0abda`
- 前端激活路径：`/var/www/infinite-canvas/releases/20260908-152504`
- 后端激活路径：`/opt/infinite-canvas-cloud/releases/20260908-152504`
- 后端服务：Docker Compose API 和 PostgreSQL，数据卷未覆盖；数据库迁移成功，固定管理员登录接口验证成功。
- Nginx：`infinite-backend.zemra.cn` 的 `/api/cloud/v1/`、`/media-access/` 已代理到 `127.0.0.1:8080`；HTTP 自动跳转 HTTPS。
- 验证：前端公网首页和静态资源 200；后端 HTTPS 登录 200；CORS、证书和 `certbot renew --dry-run` 均通过。
- 问题：服务器无法访问 Docker Hub 和 `proxy.golang.org`；本次 release 构建临时使用服务器可访问的 Docker 镜像源及 `goproxy.cn`，不影响应用运行。
- 回滚：前端切回 `/var/www/infinite-canvas/releases/20260908-014204`；后端切回上一个 `/opt/infinite-canvas-cloud/releases/` 目录并保留现有数据卷。

## 凭据

服务器凭据由外部渠道管理，未写入仓库或部署记录。
