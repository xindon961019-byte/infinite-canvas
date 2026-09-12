# AI 工作台逻辑

## 1. 开发目标与依据

AI 工作台沿用浏览器本地优先：主体、上传素材、编辑草稿及创作内容保存在本地；需要模型可访问的媒体链接、服务器备份与恢复时才使用同级 `infinite-canvas-cloud` 后端。模型调用沿用前端配置的渠道与调用脚本，不把用户模型 Key 上传到业务后端。

本文件先于本轮实现编写并复核。此前的前端 UI 已有主体库、结构化 `@` 引用和预览；本文补齐提交参数契约、媒体桥接与服务器同步。`sd2.5` 暂按 Seedance 2.5 研究，具体渠道与准确模型 ID 尚待用户提供，不根据简称自动选择协议。

代码事实：同级后端实际使用 Go、PostgreSQL 和磁盘媒体存储，不采用旧设计稿中的 Node.js 技术栈。后端已经提供登录、媒体去重上传、临时读取授权、快照创建与恢复所需接口；没有必要重新编写一套主体 CRUD 服务。

## 2. 三类模型如何传参数

### 2.1 MiniMax H3

官方创建接口为 `POST https://api.minimax.cn/v2/video_generation`，JSON 请求，Bearer 模型 Key。请求主体采用 `model + content[]`，文本项为 `type: text`；图片、视频、音频项分别为 `image_url / video_url / audio_url`，用 `role` 表达参考或首尾帧用途。分辨率、时长、比例为顶层 `resolution / duration / ratio`。创建返回 `task_id`，随后查询任务状态和结果。

H3 的首尾帧与全能参考不能混用；H3-Max 不具备 H3 的完整多模态参考能力。当前工作台的上传图及主体图片应按参考用途处理，不能根据图片数量自动改为首尾帧。精确约束以实际渠道为准。

来源：[MiniMax 官方创建视频任务](https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create)。

### 2.2 Seedance 2.5（sd2.5 的暂定解释）

BytePlus 官方文档入口与官方团队 MCP 的 2.5 工具能够确认该系列支持多模态参考输入。ModelArk 协议以 `content[]` 表达文本和媒体，媒体使用嵌套 URL 对象及 role，生成参数与 content 同层。官方团队工具的输入 `images/videos/audios` 是工具包装，不等于直接向模型发送的 JSON。

需要区分区域 Endpoint、实际模型 ID、第三方渠道封装与官方 HTTP 协议。不会把检索到的渠道型号写成用户的默认模型，也不会把 2.0 的数量或音频限制当作 2.5 的事实。

来源：[BytePlus 文档入口](https://docs.byteplus.com/en/docs/ModelArk/2607688)、[BytePlus 团队 2.5 工具文档](https://github.com/byteplus-sa/modelark-mcp/blob/main/docs/api-reference.md)、[ModelArk 请求实现](https://github.com/byteplus-sa/modelark-mcp/blob/main/src/modelark_mcp/providers/modelark/seedance.py)。官方文档页面正文部分依赖动态加载，字段映射同时参考官方团队实现；用户实际渠道仍需核实。

### 2.3 Wan 3.0

百炼原生创建接口为区域工作空间地址下的 `/api/v1/services/aigc/video-generation/video-synthesis`。请求头包含 Bearer Key 与 `X-DashScope-Async: enable`。请求体分为 `model`、`input`、`parameters`：文本在 `input.prompt`，媒体在 `input.media[]`，每项使用 `type` 和直接的 `url`；比例、分辨率、时长在 `parameters` 下。

`reference_image/reference_video/reference_audio` 用于参考；`first_frame/last_frame` 用于首尾帧，二者不能混用。创建返回异步任务信息，通过任务 ID 查询结果。图片可使用文档允许的 Data URL，但音视频通常需要服务可访问的 URL 或厂商上传地址。

来源：[阿里云 Wan 3.0 API](https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference)、[官方使用指南](https://help.aliyun.com/zh/model-studio/wan3-video-generation-guide)。

### 2.4 对项目的直接影响

| 项目 | H3 / ModelArk 类型 | Wan 3.0 原生 |
| --- | --- | --- |
| 输入结构 | content 数组 | input.prompt 与 input.media |
| 图片链接 | image_url 内嵌 url，并声明 role | media 项直接 url，type 表达用途 |
| 设置位置 | 顶层生成参数 | parameters 对象 |
| 异步状态 | 渠道任务 ID、状态、结果映射 | output.task_id 与百炼任务状态 |
| 是否可以传主体 ID | 不认识本地主体 ID，必须展开参考资源和语义 | 同样必须展开 |
| 是否可原样传浏览器 Blob URL | 不可以 | 不可以 |

模型官方的时长、分辨率、媒体数量与格式约束是外部能力事实，不直接变成项目新增的上传限制。本轮不新增默认超时、重试、并发、数量或文件大小边界。缺少 H3 必需的时长等参数时，应由已配置脚本或后续规划阶段明确提供，不静默猜值。

## 3. 两层参数包装

### 3.1 本地创作请求

页面先生成与供应商无关的结构化对象：

```ts
type CreationRequest = {
  version: 1;
  id: string;
  mode: 'agent';
  parts: { text: string; id?: string; kind?: 'subject' | 'asset' }[];
  subjects: Subject[]; // 本次引用主体的快照
  media: {
    id: string;
    kind: 'image' | 'audio' | 'video';
    name: string;
    url: string; // 本地媒体；不可直接作为厂商公网 URL
    owners: { kind: 'subject' | 'asset'; id: string }[];
  }[];
  preferences: { auto: boolean; kind: 'image' | 'video'; ratio?: string; model?: string; quality?: string };
};
```

规则：

1. 根据 `kind + id` 解析引用，拒绝失效主体或素材；不使用名称作为主键。
2. 主体快照保存名称、描述、图片和可选音色。后续主体编辑不改变已准备请求。
3. 普通上传素材全部纳入本次输入；引用主体展开成多图和音色，并保留归属。
4. 同一资源重复引用复用资源项，正文中的引用位置和重复次数保留。
5. 自动偏好只记录自动状态和页面类型，不偷用已隐藏的手动模型参数；自定义保留实际选择，不把“智能”写成固定比例。
6. 不包含模型 Key、服务器 Token、短期授权链接、UI DOM 或原始 HTML。

### 3.2 调用脚本边界

不在页面写三个模型分支。继续使用现有模型调用脚本；增加工作台 `creation` 上下文供脚本访问主体归属与结构化正文，以及按需 `cloud.mediaUrl` 工具。

已有 `prompt/images/videos/audios/params` 保留。适配器负责将内部引用转换为对应模型使用的图片 / 音频编号、标记和角色；同一个资源的编号必须与发送顺序一致。主体描述和多媒体对应说明加入提示词，不能只拼 `@主体名`。

处理顺序：结构化创作请求 → Agent 规划或明确参数 → 实际渠道脚本 → 创建任务 → 记录任务 ID → 查询结果 → 本地保存结果。当前阶段先实现包装、媒体工具和同步；在实际渠道确认前保留预览，不能以假响应代替真实生成。

## 4. 本地与后端职责

| 功能 | 本地实现 | 后端支持 |
| --- | --- | --- |
| 输入、偏好、引用编辑 | React 与本地草稿 | 不需要 |
| 主体创建 / 编辑 / 删除 / 搜索 | 共享主体 store、localforage | 不需要主体 CRUD |
| 参考图、参考音色、预览 | 浏览器资源和本地存储 | 不需要主动上传 |
| 主体出现在我的资产 | 共用主体数据 | 不需要 |
| 请求快照和提交参数包装 | 本地构造并校验 | 不需要 |
| 模型读取音视频等本地媒体 | 前端按需上传 | 复用私有媒体及临时授权接口 |
| 用户模型鉴权与生成调用 | 已有渠道配置和调用脚本 | 不新增模型代理 |
| 服务器同步 | 捕获、媒体编码、下载校验、恢复 | 扩展快照域 Schema 与能力声明 |
| 自动规划、无人值守任务、回调 | 本轮不伪装已实现 | 按选定 Agent 接入另行实现，当前不新增无消费者接口 |

## 5. 需要接通的后端接口

这些路径均已存在，优先接通，不重复造接口：

- `GET /api/cloud/v1/status`：确认服务身份、工作空间、支持的域版本和现有上传策略。
- `POST /api/cloud/v1/media/resolve`：按摘要及字节数查重。
- `POST /api/cloud/v1/media`：上传 Blob，purpose 使用 reference-image / reference-video / reference-audio。
- `POST /api/cloud/v1/media/{mediaId}/access-grants`：申请 purpose=model-reference 的临时访问链接。
- `GET /media-access/{token}`：模型读取媒体，无需发送业务登录 Token。
- 已有 `/backups` 创建、列表、详情、commit 及 `/media/{id}/content`：主体与工作台数据服务器备份 / 下载。

媒体工具继承当前取消信号，只接受本地 Blob、Data URL 或当前浏览器 Blob URL；不提供任意远程 URL 抓取代理。只有脚本确实调用工具时才上传，未登录服务器则提示登录。链接期限使用后端已配置值，不引入新 TTL。短期链接不保存在草稿、主体或快照。

## 6. 服务器同步设计

新增两个可选择恢复的业务域：

- `subjects`：`{ items: Subject[] }`，本地 `subjects/items`。
- `ai-workbench`：`{ draft: Workspace | null }`，本地 `ai_workspace/draft`。

主体与草稿内的图片、音频均通过现有媒体扫描器提取，上传清单只保留 null 占位和 `mediaRefs`，二进制文件按 SHA-256 去重。恢复后的媒体写入现有 image_files / media_files，本地记录保存 cloud-media 稳定引用，读取时恢复当前会话 URL。

日常服务器同步采用同账号按记录增量合并，上传与拉取都保留双方独有记录，不传播删除。同一记录双端修改时选择版本，服务端通过版本检查防止并发覆盖。历史完整备份仍通过单独恢复入口整体替换选中域。配置、密钥和脚本已纳入同步，完整协议及存储范围见[多设备增量同步](./多设备增量同步.md)。

历史快照恢复工作台时必须同时恢复主体。日常拉取按主体、渠道、模型、草稿的依赖顺序合并；页面继续提示失效主体引用，不静默使用同名主体。

同步切换前等待主体与草稿写入完成。恢复页不挂载业务 store，继续沿用应用 Web Lock 和独立 `/server-sync` 路由。服务器未声明两个新域时，上传前明确报版本不支持，不丢弃新域冒充同步成功。旧快照仍只能恢复它实际包含的域。

本轮范围为已有“服务器同步”。WebDAV 现有合并协议与普通资产包格式不冒充已包含主体，另列待办。

## 7. 开发清单与复核

文档完成后的复核结论：

- [x] 已对照代码确认后端是 Go，媒体授权和备份接口已存在。
- [x] 已区分官方模型协议、团队工具包装与用户实际渠道，未根据 sd2.5 简称硬编码模型 ID。
- [x] 已定义主体展开、重复引用、资源归属与自动参数语义。
- [x] 已覆盖同步捕获、Schema、媒体编码、恢复事务、读取 hydration 和工作台依赖主体。
- [x] 未新增经验性限制，未新增模型代理或强制云端主体 CRUD。
- [x] 实现统一创作请求快照，并在页面预览中展示主体、资源数量和引用关系。
- [x] 接入脚本 `creation` 上下文和按需 `cloud.mediaUrl` 媒体链接工具；脚本仍负责把快照转换为具体渠道协议。
- [x] 前后端同步扩展两个新域，上传前检查服务能力，恢复工作台时强制同时恢复主体。
- [x] 记录待测试步骤及实际接口联调限制。

未确定的真实渠道、自动规划、真实生成和外部模型效果不计作已完成。代码实现后的状态与实际验证结果在本文件末尾追加。

## 8. 实现后复核

- 工作台草稿写入 `ai_workspace/draft`，服务器快照域为 `ai-workbench`；主体写入 `subjects/items`，两者均使用 `localforage` / IndexedDB，不把业务列表放入 `localStorage`。
- `runModelPlugin` 将 `creation`、`cloud.mediaUrl` 和取消信号注入现有脚本环境，未改变既有 `prompt/images/videos/audios/params` 参数；临时媒体 URL 不进入草稿或快照。
- 服务器同步在上传前校验 `domainVersions`，恢复前校验清单摘要、文件摘要和媒体类型，并在同一 IndexedDB 事务中写入；工作台单独恢复会被拒绝，避免主体引用失效。
- 仍需用户使用实际渠道脚本验证 H3、Seedance 2.5 和 Wan 3.0 的字段映射、厂商媒体 URL 可读性及异步任务状态映射。当前代码没有假设具体模型 ID、区域 endpoint、超时、重试或并发上限。
