# infinite-canvas 部署记录

## 当前部署

- 站点：`https://infinite.zemra.cn`
- 服务器：`103.47.83.171`，SSH 端口 `28778`，运维账号 `root`
- 目标目录：`/var/www/infinite-canvas`
- 当前 release：`/var/www/infinite-canvas/releases/20260911-0840`
- 当前链接：`/var/www/infinite-canvas/current`
- Web 服务：Nginx
- Nginx 配置：`/etc/nginx/sites-available/infinite-canvas`
- 证书：`/etc/letsencrypt/live/infinite.zemra.cn/`
- 发布方式：本地 Vite 生产构建后上传静态文件，由 Nginx 提供 SPA 和 HTTPS

## 云端后端

- 站点：`https://infinite-backend.zemra.cn`
- 目标目录：`/opt/infinite-canvas-cloud`
- 当前 release：`/opt/infinite-canvas-cloud/releases/20260911-0840`
- Compose 项目：`/opt/infinite-canvas-cloud/current`
- 服务：Docker Compose `api`（回环 `127.0.0.1:8080`）与 `postgres`（回环 `127.0.0.1:5432`）
- Nginx 配置：`/etc/nginx/sites-available/infinite-canvas-cloud`
- 证书：`/etc/letsencrypt/live/infinite-backend.zemra.cn/`
- 数据：Docker volumes `infinite-canvas-cloud_postgres_data`、`infinite-canvas-cloud_media_data`
- 凭据：由服务器外部管理，未写入仓库或部署记录
- 数据库 schema：`storage_version=3`；用户按账号、角色和工作空间隔离，新增 `sync_records` 增量索引。
- 当前镜像：`infinite-canvas-cloud-api:20260911-0840`；`compose.override.yaml` 固定该镜像，普通 `docker compose` 操作也会自动使用新版本。

## 验证结果

- `http://infinite.zemra.cn/` 返回 301 并跳转到 HTTPS。
- `https://infinite.zemra.cn/` 返回 HTTP 200。
- 首页引用的 JavaScript、CSS 和 `config.js` 路径可访问。
- `/assets/` 路由刷新返回 SPA 入口页面，避免与真实静态资源目录同名时触发 Nginx 403。
- `nginx -t` 通过；本次仅切换静态文件，无需 reload。
- Let's Encrypt 证书已签发，Certbot 已配置自动续期。
- 后端新账号登录返回 `200` 和 `super_admin` 角色；旧 `admin` 账号返回 `401`。
- PostgreSQL 与 API 均运行中，Compose 配置包含 `restart: unless-stopped`。

## 回滚

前端上一可用版本为 `/var/www/infinite-canvas/releases/20260908-175248`，可原子切回。后端上一版本为 `/opt/infinite-canvas-cloud/releases/20260908-181251`，镜像保留为 `infinite-canvas-cloud-api:rollback-20260911-071147`。旧后端只支持数据库 v2，不能直接对 v3 切换二进制；需按后端部署文档恢复到独立数据库并核验，再切换服务。成套回滚备份位于 `/www/backups/infinite-canvas-cloud/20260911-071147/`，恢复会影响备份之后的新写入，操作前需再次确认范围。

## 标准发布

1. 在 `web/` 中执行 `npm run build`。
2. 将 `web/dist/` 打包并上传到服务器 `/tmp/` 下的唯一文件名。
3. 校验压缩包 SHA-256 后，解压到 `/var/www/infinite-canvas/releases/<release-id>`。
4. 检查 `index.html` 和首页引用的静态文件，再将 `current` 原子切换到新 release。
5. 执行 `nginx -t`，并从服务器内网和公网检查 HTTP 跳转、HTTPS 首页、静态文件及 SPA 路由回退。

## 配置修复

2026-09-07：为 `/assets/` 添加精确 SPA 回退规则。该路径既是应用路由又是静态资源目录名，直接访问目录会被 Nginx 以 403 拒绝；精确规则现在将目录路径回退到 `index.html`，而具体资源文件继续由静态资源规则提供。

## 发布历史

### 2026-09-11 08:44 UTC — 20260911-0840

- 已部署前后端：主体音频发送前上传去重、长期音频 URL、视频脚本 audioUrls 与公网地址编写说明。
- Nginx 新增 `/reference-audio/` 转发；配置验证通过，HTTPS 首页及入口 JS/CSS 与本地构建逐字节一致。
- 新发布接口匿名请求 401，无效音频链接返回后端 404；API 和 PostgreSQL 运行正常。
- 本地 Vite 构建、Linux/amd64 Go 编译和 cloud 包测试通过；未进行真实账号音频上传及付费模型验收，不能视为三个渠道均已验证。
- 备份：`/www/backups/infinite-canvas-cloud/20260911-0840/`，包含可读的数据库 custom dump、完整媒体归档、Nginx 和 Compose override；未迁移数据库。
- 回滚：前后端 current 切回各自 releases/20260911-071147，后端运行 docker compose up -d --no-build api；Nginx 原配置在上述备份目录。数据库无需降级。
- 发布包 SHA-256：c7c2e44f6fd36364e5f740b76bcccb4aeb05691903ef5458513809601014ad3f；后端二进制 SHA-256：864ca0da80b0ede75f54cf51572c2e1a491241b01c2e0c3a45fd8f82902cda6f。
- 保留已有其他站点 Nginx 协议警告；tar 的 macOS provenance 属性提示不影响静态文件。凭据由外部管理。


### 2026-09-11 07:18 UTC — 20260911-071147

- 状态：发布成功。
- 功能：AI 工作台与主体界面、同账号记录级增量同步、配置密钥和渠道脚本同步、冲突选择及独立历史恢复入口。
- 前端：`infinite-web-20260911-071147.tgz`，SHA-256 `cff2baf34d2a348b0438979da015bb17031406ed4e6b8b05583ed29e92f69a07`。
- 后端及隔离测试包：`infinite-api-20260911-071147.tgz`，SHA-256 `4703a3f27176401fa9c4473e6744cba3cd6ec67b248ac15cef25c25678f4fedc`。测试二进制随后单独更新测试账号名，不影响生产二进制。
- 后端通过本地 Linux/amd64 交叉编译，复用原运行镜像中的证书和用户配置；没有在服务器下载新依赖，没有改动共享 `.env`。
- 备份：停写期间生成 custom 格式 `database.dump` 和完整 `media.tgz`，归档可读、权限为 0600。数据库摘要 `e1d7152682faa0e45c287d2d94b84fc12e64fcbf0ae281626b68c99389482b3b`；媒体摘要 `c09b71e9a35a542e48c7b4e0f087c97c01dfae936777988cc262f62f2f393eb7`。
- 迁移：v2 → v3 成功；原有 1 个用户、3 份备份、6 个媒体记录保持不变。
- 测试：在无公网端口、无生产数据卷的独立 PostgreSQL 容器运行全部 Go 测试，包含并发去重、增量发布、幂等、版本冲突与跨工作空间隔离，全部通过；测试容器已清理。
- 问题与解决：测试账号中的连字符不符合现有用户名规则，改为下划线后重跑通过。Vite 有分包体积提示；Nginx 存在其他站点的既有协议配置警告，校验成功，本次未改动这些站点。
- 验证：公网首页、`/ai`、`/server-sync`、`/assets/`、`config.js` 返回 200；首页与本地构建一致，入口 JS/CSS SHA-256 一致，静态资源使用 immutable 缓存；新 `/api/cloud/v1/sync` 未认证访问返回 401。其他原有容器保持运行。
- 回滚点：前端 `20260908-175248`、后端 `20260908-181251` 和上述成套备份。未进行真实用户数据上传或双设备人工验收。

### 2026-09-08 09:20 UTC — 20260908-171723

- 状态：发布成功
- 功能摘要：修复服务器登录页预填默认账号和登录请求发送到前端域名导致 405 的问题。
- 构建产物：`infinite-canvas-20260908-171723.tgz`，SHA-256 `295bb9ea626a170eae94ccc2bd9fdf50e303f83d1f854c2bc6c8ae666ca85e60`
- 激活路径：`/var/www/infinite-canvas/releases/20260908-171723`
- 验证：前端公网首页返回 200；后端 `https://infinite-backend.zemra.cn/api/cloud/v1/auth/login` 返回 200；线上构建产物不再预填 `admin`。
- 回滚：切回 `/var/www/infinite-canvas/releases/20260908-152504`。

### 2026-09-08 10:24 UTC — 20260908-175248 / 181251

- 状态：发布成功
- 功能摘要：增加用户表和 `super_admin`/`user` 角色字段；将旧固定 `admin` 账号迁移为 `dongxin` 超管，并按用户工作空间继续隔离云端数据。
- 前端构建产物：`infinite-canvas-20260908-175248.tgz`，SHA-256 `51ce086bdf2942dbcecaaf6b9f0d478470ccb6e33f8bfb67f4e787ada96f15f2`
- 前端激活路径：`/var/www/infinite-canvas/releases/20260908-175248`
- 后端激活路径：`/opt/infinite-canvas-cloud/releases/20260908-181251`
- 数据库迁移：已在生产执行 v1 到 v2 迁移；迁移前备份位于 `/www/backups/infinite-canvas-cloud/20260908-095600/`，原工作空间和媒体数据保留，旧会话已失效。
- 验证：数据库 `storage_version=2`；`dongxin` 登录和 `/auth/me` 返回 `200`、角色 `super_admin`；旧 `admin` 登录返回 `401`；前端首页和 `config.js` 返回 `200`；`nginx -t` 通过。
- 回滚：前端可切回 `/var/www/infinite-canvas/releases/20260908-171723`；后端代码可切回上一 release，但数据库 v2 迁移前必须先按备份恢复。

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
- 后端服务：Docker Compose API 和 PostgreSQL，均配置 `restart: unless-stopped`，数据卷未覆盖；数据库迁移成功，固定管理员登录接口验证成功。
- Nginx：`infinite-backend.zemra.cn` 的 `/api/cloud/v1/`、`/media-access/` 已代理到 `127.0.0.1:8080`；HTTP 自动跳转 HTTPS。
- 验证：前端公网首页和静态资源 200；后端 HTTPS 登录 200；CORS、证书和 `certbot renew --dry-run` 均通过。
- 问题：服务器无法访问 Docker Hub 和 `proxy.golang.org`；本次 release 构建临时使用服务器可访问的 Docker 镜像源及 `goproxy.cn`，不影响应用运行。
- 回滚：前端切回 `/var/www/infinite-canvas/releases/20260908-014204`；后端切回上一个 `/opt/infinite-canvas-cloud/releases/` 目录并保留现有数据卷。

## 凭据

服务器凭据由外部渠道管理，未写入仓库或部署记录。
