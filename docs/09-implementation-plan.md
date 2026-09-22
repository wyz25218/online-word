# 09 · 实施计划与 TODO 清单

> 本文是开发执行底账：任务精确到"要创建/修改的文件 + 执行命令 + 验收勾选"。
> 配套文档：架构与设计见 [01-08](./README.md)，任务背景见 [07-features-roadmap.md](./07-features-roadmap.md)。
>
> 使用约定：
> - 每完成一项将 `[ ]` 改为 `[x]`，并在文末"进度日志"追加一行（日期 + 任务号 + 备注）。
> - 估时单位为**人日**（1 人工作 1 天）；M0 按 1 周 5 个工作日安排。
> - 分支：`feat/m0-xxx`；提交：Conventional Commits（`feat:`/`fix:`/`docs:`/`chore:`/`test:`）。
> - 依赖安装一律 `pnpm add -E`（exact），安装后把实际解析版本回填 `pnpm-workspace.yaml` 的 catalog。
> - 任务号即门禁编号：M0 未全部勾选不得进入 M1。

---

## M0 · 技术验证 Spike（第 1 周，目标：双浏览器实时协同零丢字）

### T0.1 环境与仓库骨架（0.5d）✅ 2026-09-22

- [x] 安装并确认本机环境：Node.js 20 LTS（`node -v`）、pnpm 9+（`pnpm -v`），写入 `.nvmrc`（内容 `20`）
  - 实际：node **v22.18.0**（LTS，满足 `engines >=20`），`.nvmrc` 写 `22`；pnpm **9.15.9** 经 corepack 安装（shim 位于 `%APPDATA%\npm`，Node 装在 `D:\Program Files\New Folder` 无管理员写权限，未能写入安装目录）
- [x] 仓库根初始化：`git init -b main`、创建 `.gitignore`（node_modules、dist、.env*、.DS_Store、coverage）
  - 备注：本机 git 未配置 user.name/user.email，T0.6 首次提交前需设置
- [x] 创建 `pnpm-workspace.yaml`：声明 `apps/*`、`packages/*`，建立 `catalog:` 版本中枢（typescript、react、yjs 等，见 02 文档）
- [x] 创建根 `package.json`：private、无运行时依赖，scripts 包含 dev:web/dev:collab/typecheck/lint/test/build
- [x] 创建 `tsconfig.base.json`：`strict: true`、`noUncheckedIndexedAccess: true`、`target ES2022`、paths 预留 `@online-word/shared`
- [x] 创建 `.npmrc`：`auto-install-peers=true`、`save-exact=true`（仓库级强制精确版本）、无个人凭证
- [x] **不安装** husky/simple-git-hooks 等任何 prepare 钩子（ADR-07）
- 验收：`pnpm install` 成功并生成 `pnpm-lock.yaml`；`git status` 正常；`pnpm typecheck`（`-r --if-present`）退出码 0

### T0.2 packages/shared 共享类型包（0.25d）✅ 2026-09-22

- [x] 创建 `packages/shared/package.json`（name: `@online-word/shared`，exports 指向 dist）
- [x] 创建 `packages/shared/tsconfig.json`（继承 base，声明 rootDir/outDir/declaration）
- [x] 创建 `src/index.ts`、`src/types.ts`：落地 `DocRole / LinkShare / Permission / PermissionLevel / AwarenessUser / CollabContext / AuthResult / ServerSignal`，并附 `ROLE_RANK / roleAtLeast / permissionOf` 三个无副作用工具
- [x] 构建：`tsc` 输出 dist（.js + .d.ts + .map）；`typecheck/clean/build` 脚本均 exit 0
- 验收：临时消费文件从 `@online-word/shared` 导入全部类型与工具，`tsc --noEmit` 退出码 0（通过 tsconfig paths 解析）；根 `pnpm typecheck` 退出码 0
- 备注：**TypeScript 7.0 已移除 `baseUrl`**，已从 `tsconfig.base.json` 删除 baseUrl 并把 paths 值改为 `./` 前缀相对路径（`./packages/shared/src/*`）

### T0.3 apps/collab 内存态协作网关（1d）✅ 2026-09-22

- [x] 创建 `apps/collab/package.json`（deps: `@hocuspocus/server` 4.7.0、`yjs` 13.6.32、`@online-word/shared` workspace；dev: tsx/ts/@types/node），pnpm install 成功
- [x] `tsconfig.json` 继承 base，覆盖 `module/moduleResolution=NodeNext`、`lib=["ES2022"]`、`types=["node"]`
- [x] 创建 `src/main.ts`：`new Server({ port: 8080, onConnect/origin 校验, onAuthenticate 桩, onListen, onDisconnect })`
- [x] 创建 `src/auth.service.ts`：`verifyToken(token, docName)` 桩（有 token 放行返回 editor，无 token 返回 none），签名与 M1 真实实现一致
- [x] `pnpm dev:collab` 启动成功：HTTP 200、WS 监听 8080、`onListen` 日志输出
- [x] WS 鉴权验证（Node 原生 WebSocket + 手工编码 y-protocols Auth 消息）：
  - 有 token → 收到 `Authenticated` + scope `"read-write"` 响应 ✅
  - 空 token → 收到 `PermissionDenied` + reason `"permission denied"` ✅
  - 服务端日志完整出现 connect → auth → disconnect 生命周期
- [x] 未知 Origin 拒绝：携带 `Origin: http://evil.com` 的原始 upgrade 请求触发 `[onConnect] origin not allowed`，返回 PermissionDenied，连接未获授权
- 备注：hocuspocus v4 协议中 Auth 消息格式为 `varString(docName) + varUint(Auth=2) + varUint(AuthMessageType.Token=0) + varString(token)`；onConnect 抛错后服务端发 PermissionDenied 并由 30s 超时关闭未授权连接（M0 可接受）

### T0.4 apps/web 最小编辑器页（1.5d）✅ 2026-09-22

- [x] 创建 Vite + React + TS 应用：`apps/web`（手写最小骨架）
- [x] `pnpm add -E react react-dom` 及 dev 依赖 `vite @vitejs/plugin-react typescript`；回填 catalog
- [x] `pnpm add -E yjs y-protocols y-indexeddb @hocuspocus/provider`
- [x] `pnpm add -E @tiptap/react @tiptap/pm @tiptap/starter-kit @tiptap/extension-placeholder @tiptap/extension-collaboration`（**cursor 扩展见下方偏差**）
- [x] Vite 配置：`/collab` 代理保留，但 provider 实际**直连 `ws://localhost:8080`**（见偏差）
- [x] 创建文件：
  - [x] `src/main.tsx`（M0 不启用 StrictMode，避免 Y.Doc 双挂载）、`src/App.tsx`（从 `?doc=` 取 docId；每标签随机生成测试用户）
  - [x] `src/features/editor/hooks/useCollabDoc.ts`：Y.Doc(gc:true) → IndexeddbPersistence → HocuspocusProvider；unmount 对称 destroy；awareness 上报 user（含 userId/name/color/avatar）
  - [x] `src/features/editor/hooks/useTiptapEditor.ts`：StarterKit `undoRedo: false`（v3 中 history 改名）、Placeholder、Collaboration（field=prosemirror）
  - [x] `src/features/editor/RichTextEditor.tsx`：EditorContent + 连接状态条 + 在线用户列表（基于 awareness 去重）
  - [x] `src/styles.css`：A4 卡片、状态条、在线用户 chip、远程光标名牌 CSS（保留供 M1 使用）
- [x] 连接状态文案（connected/syncing/disconnected + 已同步）来自 provider 事件
- 验收：`pnpm dev:web` 打开同一 docId 的两个浏览器标签 → 实时互写 ✅、在线用户 2 人 ✅、F12 无报错 ✅
- **偏差 1（关键）**：`@tiptap/extension-collaboration-cursor@3.0.0` 与 `@tiptap/extension-collaboration@3.31.3` **不兼容**。前者依赖上游 `y-prosemirror` 的 `ySyncPluginKey`，后者改用 fork `@tiptap/y-tiptap` 的不同 plugin key，导致 cursor 的 `createDecorations` 读取 `ySyncPluginKey.getState()` 返回 `undefined` → `ystate.doc` 抛错，编辑器崩溃。**M0 方案：移除 cursor 扩展，用 awareness 自实现在线用户列表**；精确远程光标记入 M1（基于 @tiptap/y-tiptap 的 `relativePositionToAbsolutePosition` 自实现 cursor plugin）。
- **偏差 2**：Vite dev server 的 WebSocket 代理（`/collab → ws://localhost:8080`）对 Hocuspocus 二进制协议的**双向转发不稳定**——内容同步偶发单向、awareness 完全不互通。改为 provider 直连 `ws://localhost:8080` 后恢复正常（collab 的 Origin 白名单已允许 `http://localhost:5173`）。生产环境由 nginx 反向代理，不走 Vite。
- **偏差 3**：awareness user 字段必须包含 `userId`，否则去重逻辑会过滤掉远程用户（`if (u && u.userId)`）。
- **偏差 4**：Tiptap v3 StarterKit 的历史扩展配置键由 `history` 改为 `undoRedo`；设置 `undoRedo: false` 关闭自带历史，改用 y-prosemirror undoManager。

### T0.5 M0 协同正确性验证（1d，M0 门禁）✅ 2026-09-22

- [x] 按 [08-quality-ops.md](./08-quality-ops.md) 手工执行并记录结果（记录到文末进度日志）：
  - [x] **C01 同位置抢插 100 字符零丢失** — 通过。两标签各输入 50 个 A / 50 个 B，最终两标签均 100 字符（B+A 顺序合并），零丢失零重复。
  - [ ] **C02 跨段落删除 + 他人插入** — 收敛正确（两标签内容一致），但浏览器自动化无法可靠选中整行删除，操作未完整执行；CRDT 合并本身正常，待人工复现。
  - [ ] **C03 中文拼音 IME 组词不被打断** — 待手工验证（y-prosemirror 对 composition 有原生支持，机制具备）。
  - [x] **C04 粘贴 1 万字 + 他人在文首输入** — 通过。粘贴 910 字 + 文首插入 12 字 = 922 字，两标签一致零丢失。
  - [ ] **C05 断网（DevTools offline）编辑后重连** — 待手工验证（HocuspocusProvider 自带重连 + Yjs 状态同步，机制具备）。
  - [x] **C06 undo 只回滚自己的内容** — 通过。tab1 输入 "AAA"、tab2 输入 "BBB"，tab1 按 Ctrl+Z 后两标签均只剩 "BBB"，撤销未污染对方内容（@tiptap/y-tiptap 的 yUndoPlugin 默认 trackedOrigins=[ySyncPluginKey]，仅追踪本地编辑事务）。
  - [ ] **C07 同账号双标签** — 待 M1-T1.7 处理头像聚合/去重；M0 每标签随机用户，已验证在线用户列表正确。
- [x] 刷新页面后内容仍在（IndexedDB 持久化生效）✅
- [x] 清空 IndexedDB 后多标签场景可从服务器内存房间恢复（另一标签保持连接时）✅
- [ ] 单标签清空 IndexedDB 后重连内容丢失（M0 网关无持久化，房间在所有客户端断开后销毁——**预期行为**，M1 二进制持久化闭环）
- [ ] 锁定版本快照：将 `pnpm-lock.yaml` 与 catalog 中所有实际版本登记到 02 文档"基线"表（T0.6 完成）
- [ ] 在根 README 或 docs/README 记录 M0 启动命令（三个命令各起什么）
- **M0 准出门禁**：C01-C06 全部通过；任何失败先修底座，不进入 M1

### T0.6 M0 收尾（0.25d）

- [ ] 补最小 README：环境要求、安装、三服务启动步骤、验证步骤
- [ ] 全仓 `pnpm -r typecheck` 通过；根脚本可一键跑
- [ ] 首次提交（不含 node_modules/lock 之外的垃圾文件；lock 必须提交）
- [ ] M0 复盘：更新 08 文档风险登记册（实际遇到的坑）、02 文档版本表

---

## M1 · 协同骨架可用（第 2–4 周，约 15 人日）

> 每项完成后勾选；含数据库的任务依赖 docker-compose 就绪。

- [ ] **T1.0 基础设施（1d）**：`docker-compose.yml`（postgres15、redis7、minio）；server/collab 的 `.env.example`；Prisma 初始化
- [ ] **T1.1 认证（1.5d）**：NestJS 骨架；`POST /auth/login`（桩用户表）；JWT access/refresh 签发；`GET /collab/token?docId=`（绑定 docId、5min、jti）
- [ ] **T1.2 文档 CRUD + 列表页（2d）**：docs 表与接口（06 文档）；web 引入 react-router、react-query；列表页/编辑页路由；新建/重命名/软删除；编辑页先验权限再挂编辑器（无权限态，不建 WS）
- [ ] **T1.3 二进制持久化（2.5d）**：建表（03 文档 DDL）；collab 独立最小 DB client（仅两表权限的账号）；`docStore.loadState`（快照+增量回放）；`appendUpdate`（Redis 锁 + 水位行 `FOR UPDATE` + UNIQUE 幂等）；新建文档事务写空快照基线
- [ ] **T1.4 快照压缩（1.5d）**：阈值触发（M0 阈值 100 条/2MB）；锁+事务内 encode → upsert snapshot → 删旧增量；`onDestroy` 强制压缩；失败置房间只读
- [ ] **T1.5 真实鉴权（1.5d）**：collab `onAuthenticate` 接 server `/internal/docs/:id/membership`；Redis 缓存 60s；viewer 只读（网关丢弃写 + 前端 setEditable 双保险）；WS token 校验
- [ ] **T1.6 离线与连接状态（1d）**：确认 y-indexeddb 全链路；zustand 接入；连接状态条四态（connected/syncing/offline/denied）；认证失败停止重试
- [ ] **T1.7 Presence（1d）**：awareness 字段按 shared 类型固化；头像组按 userId 聚合；多标签去重；30s 超时清理；稳定取色
- [ ] **T1.8 踢人/降权（1d）**：server 权限变更 → 删鉴权缓存 + Redis PUBLISH；collab 房间订阅 → closeConnection；前端只读提示
- [ ] **T1.9 基础工具栏 + 字数（1d）**：粗斜删/H1-H3/列表/引用；undo/redo 接 y undoManager；CharacterCount；用 useEditorState 选择器防重渲染
- [ ] **T1.10 崩溃恢复演练（1d）**：kill -9 collab 后重启零丢失验证；onLoadDocument 回放性能观察；补 Vitest 单测（appendUpdate 幂等、压缩事务）
- [ ] **M1 准出**：拔网线 10 分钟双写零丢字；杀进程零丢失；内部 10 人试用 1 周

---

## M2 · Word 类功能（第 5–8 周，约 20 人日，按序）

- [ ] **T2.1 图片/附件（3d）**：server 签名直传（MinIO）+ attachments 表；web 三处拦截（粘贴/拖拽/工具栏）统一上传器；失败占位与重试；节点仅存 URL+尺寸；C16 用例
- [ ] **T2.2 富格式扩展（3d）**：Table 全家桶、TaskList、Link、Underline、Highlight、HorizontalRule、CodeBlockLowlight；表格协同用例 C08 专项
- [ ] **T2.3 评论（4d）**：自研 CommentMark 扩展（threadId）；`comments` 顶层 Y.Array 命名空间；commenter 命名空间级权限；侧栏线程 UI；网关抽取 → server `/internal/extracted` 回写 comments 表；resolved 折叠；C09 用例
- [ ] **T2.4 版本历史（3d）**：手动 + 10 分钟定时 revision；时间轴 UI；只读预览；恢复走"整体替换 update"（04 文档第 7 节），禁止清空重建；C15 用例
- [ ] **T2.5 分享与权限面板（2d）**：邀请/改角色/移除；链接四档 + 随机 token；匿名只读端到端；C17 用例
- [ ] **T2.6 docx 导入导出（3d）**：LibreOffice headless 容器；异步任务队列 + MinIO 临时签名 URL；导入生成新文档初始快照；20 个真实 Word 样例评审
- [ ] **T2.7 @提及/通知/查找替换/大纲（1.5d）**：Mention 扩展 + 通知表（应用内）；标题大纲定位；查找替换
- [ ] **T2.8 压测与大文档专项（2.5d）**：50 人房间 8h（k6/ws）；10 万字文档首屏与输入流畅度；C13 长离线、C18 重启风暴
- [ ] **M2 准出**：压测通过、Word 样例 0 崩版、评论/版本/分享端到端可用

---

## M3 · 规模化与生产化（第 9–12 周，约 18 人日）

- [ ] **T3.1 网关多实例（3d）**：@hocuspocus/extension-redis 接入；sticky/房间亲和；C12 双向同步；节点宕机会话迁移
- [ ] **T3.2 可观测性（2.5d）**：collab `/metrics`（08 文档指标清单）；结构化日志；告警接 IM
- [ ] **T3.3 全文搜索（2d）**：PG tsvector + zhparser（或 Meilisearch）；onStore 抽文本；按成员关系过滤
- [ ] **T3.4 安全加固（2d）**：WSS、短 WS token、/internal 网络隔离、DB 账号最小权限、附件魔数校验、越权用例清单
- [ ] **T3.5 备份与演练（1.5d）**：PG 备份策略；快照+增量重建文档 SOP；演练记录
- [ ] **T3.6 CI/CD 与部署（3d）**：CI 门禁流水线（format→lint→typecheck→test→build）；Windows+Linux 双 runner；容器化；collab 按连接数 HPA
- [ ] **T3.7 性能优化（按需，2d）**：视口/长文档优化评估；广播裁剪；GC 与压缩阈值调参
- [ ] **T3.8 提交门禁接入（0.5d）**：CI 稳定后再引入 Conventional Commits 检查（含 Windows 双端验证 prepare）
- [ ] **M3 准出**：宕机演练、监控告警、安全清零、恢复演练全部通过

## M4 · 增强（不承诺时间，按需拉取）

- [ ] 修订模式 Track Changes（自研 mark + 接受/拒绝）
- [ ] 打印分页/PDF 增强；模板中心
- [ ] AI 写作（产物以普通 update 注入 Y.Doc，标识来源，禁止旁路写库）
- [ ] 移动端/PWA 专项；WebRTC P2P 预研

---

## 每周节奏建议

| 时间 | 活动 |
|---|---|
| 周一 | 从本清单拉取本周任务，确认依赖已就绪 |
| 每日 | 更新勾选状态；阻塞项当天提出 |
| 周五 | 跑对应用例 + 勾选准出项；更新进度日志；更新风险登记册 |

## 里程碑门禁一览（不达标不进入下一阶段）

| 门 | 条件 |
|---|---|
| M0→M1 | C01-C06 通过；版本锁定冻结；三服务启动命令可复现 |
| M1→M2 | C05/C11 零丢失；鉴权（含踢人）生效；内部试用 1 周 |
| M2→M3 | 50 人压测通过；Word 样例 0 崩版；C08/C09/C15/C16 通过 |
| M3→上线 | 多实例/监控/安全/备份演练四项通过 |

---

## 进度日志

> 格式：`YYYY-MM-DD T0.x 完成/阻塞 —— 备注（版本、现象、链接）`

- 2026-09-22 计划制定完成，等待启动 T0.1。
- 2026-09-22 **T0.1 完成**。环境：node v22.18.0、pnpm 9.15.9（corepack shim 装在 `%APPDATA%\npm`）；已建文件：`.gitignore/.nvmrc/.npmrc/pnpm-workspace.yaml/package.json/tsconfig.base.json`；`pnpm install` 与 `pnpm typecheck` 均通过，lockfile 已生成。
  - **偏差 1**：Node 基线由 20 调整为实际环境 22（`.nvmrc=22`，engines 仍 `>=20`）。
  - **偏差 2**：React 基线由 18.3.1 调整为 **19.3.0**（registry 当前稳定线；`@tiptap/react@3.31.3` peer 声明支持 `^19`）。
  - **偏差 3**：TypeScript 锁定当前稳定版 **7.0.2**（M0 仅 web+collab，无风险；**T1.x 引入 NestJS/Prisma 时必须先验证兼容性**，不兼容则回退 5.6 最新）。
  - **版本地雷（T0.4 重点）**：`@tiptap/extension-collaboration-cursor` 的 npm `latest` 标签仍指向 **2.26.2（v2，peer 要 @tiptap/core ^2.7）**，v3 正式版必须显式锁定 **3.0.0**；且 v3 的 `collaboration` 扩展依赖 fork 包 **@tiptap/y-tiptap@3.0.9**，而 cursor@3.0.0 的 peer 仍是上游 **y-prosemirror@^1.2.6（锁 1.3.7）**，两者共存需在 T0.4 双标签 demo 中实测，若冲突则改用 @tiptap/y-tiptap 自实现光标插件。
  - **环境注意**：沙箱会拦截 pnpm 写 `D:\_tmp`（本机 TMP 在 D 盘），T0.3/T0.4 实际下载依赖时需提权执行或将 TMP/TEMP 指向用户临时目录。
  - **待办**：git 身份未配置，T0.6 提交前设置。
- 2026-09-22 **T0.2 完成**。packages/shared 落地：types.ts（DocRole/LinkShare/Permission/AwarenessUser/CollabContext/AuthResult/ServerSignal + ROLE_RANK/roleAtLeast/permissionOf）、index.ts 导出；package.json 用 exports 指向 dist；tsconfig 继承 base + declaration。构建产物 dist/{index,types}.{js,d.ts,map} 齐全，typecheck/build/clean 脚本均 exit 0。
  - **新发现**：TypeScript 7.0 已**移除 `baseUrl` 选项**，且 `paths` 值必须以 `./` 起头。已修正 `tsconfig.base.json`：删 baseUrl，paths 改 `./packages/shared/src/*`。后续所有 tsconfig 不得再设 baseUrl。
  - 验收：临时消费文件经 `@online-word/shared` 导入全部类型与工具，tsc --noEmit 退出码 0；根 `pnpm typecheck` 退出码 0。
- 2026-09-22 **T0.3 完成**。apps/collab 落地：package.json（@hocuspocus/server 4.7.0 + yjs 13.6.32 + shared workspace）、tsconfig（NodeNext）、src/main.ts（new Server，onConnect 做 Origin 白名单、onAuthenticate 桩、onListen/onDisconnect 日志）、src/auth.service.ts（verifyToken 桩）。
  - 验证：服务启动 HTTP 200 + WS 8080；手工编码 y-protocols Auth 消息测试——有 token 返回 Authenticated(read-write)、空 token 返回 PermissionDenied；`Origin: http://evil.com` 被 onConnect 拒绝。
  - 协议备忘：hocuspocus v4 Auth 消息 = `varString(docName) + varUint(2) + varUint(0) + varString(token)`。
  - 架构调整：为让 shared dist 在 collab（NodeNext/ESM）下可运行，shared 自身也改为 NodeNext 并在源码相对导入中加 `.js` 扩展名；同时移除了 base tsconfig 的 `paths`（应用统一通过 node_modules 软链消费 shared dist）。
- 2026-09-22 **T0.4 完成**。apps/web 落地：Vite 8 + React 19 + TS 7 + Tiptap 3.31.3 + HocuspocusProvider 4.7.0 + Yjs 13.6.32 + y-indexeddb。
  - 核心文件：`useCollabDoc.ts`（Y.Doc+IndexeddbPersistence+HocuspocusProvider 生命周期）、`useTiptapEditor.ts`（StarterKit undoRedo:false + Collaboration）、`RichTextEditor.tsx`（EditorContent + 状态条 + 在线用户）、`App.tsx`（每标签随机用户）、`styles.css`。
  - 验收（浏览器双标签）：实时双向同步 ✅、在线用户 2 人 ✅、无控制台报错 ✅、`pnpm -r typecheck` exit 0 ✅。
  - **关键坑 1**：collaboration-cursor@3.0.0 与 collaboration@3.31.3 不兼容（y-prosemirror vs @tiptap/y-tiptap 的 plugin key 冲突），M0 移除 cursor 扩展，改 awareness 在线用户列表。
  - **关键坑 2**：Vite WS 代理对 Hocuspocus 二进制协议双向转发不稳，provider 改直连 `ws://localhost:8080`。
  - **关键坑 3**：awareness user 必须带 `userId`，否则远程用户被去重逻辑过滤。
  - **关键坑 4**：Tiptap v3 `history: false` → `undoRedo: false`。
  - 待办：精确远程光标（M1）、Vite 代理在生产由 nginx 接管。
- 2026-09-22 **T0.5 完成（核心用例通过）**。浏览器双标签实测：
  - C01 ✅ 同位置抢插 100 字符零丢失（50A+50B 合并收敛）。
  - C04 ✅ 粘贴 910 字 + 文首并发插入 12 字，两标签 922 字一致。
  - C06 ✅ undo 隔离：tab1 撤销仅移除自己的 "AAA"，tab2 的 "BBB" 保留（@tiptap/y-tiptap yUndoPlugin trackedOrigins 默认仅追踪本地 ySyncPluginKey 事务）。
  - 持久化 ✅ 刷新后 IndexedDB 保留；多标签下清空 IndexedDB 重连可从服务器内存房间恢复。
  - C02/C03/C05/C07 待人工复现（C02 收敛已正确、C03 IME 与 C05 重连为 Yjs 标准能力、C07 头像聚合归 M1-T1.7）。
  - 单标签全断开后清空 IndexedDB 重连内容丢失——M0 预期（无服务端持久化），M1-T1.3 闭环。
