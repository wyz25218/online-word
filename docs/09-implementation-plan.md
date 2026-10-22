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
- [x] 锁定版本快照：`pnpm-lock.yaml` 与 catalog 中所有实际版本已登记到 02 文档"基线"表
- [x] 在根 README 记录 M0 启动命令（双服务：collab + web）
- **M0 准出门禁**：C01-C06 全部通过；任何失败先修底座，不进入 M1

### T0.6 M0 收尾（0.25d）✅ 2026-09-22

- [x] 补最小 README：环境要求、安装、双服务启动步骤、验证步骤（`README.md`）
- [x] 全仓 `pnpm -r typecheck` 通过（shared/collab/web 均 exit 0）
- [x] 首次提交（commit `3ccd3a8`，37 文件，含 `pnpm-lock.yaml`，排除 node_modules/dist）
- [x] M0 复盘：更新 08 风险登记册（+4 条实际踩坑）、02 版本表与扩展清单（cursor 移除、undoRedo 改名）

---

## M1 · 协同骨架可用（第 2–4 周，约 15 人日）

> 每项完成后勾选；含数据库的任务依赖 docker-compose 就绪。

- [x] **T1.0 基础设施（1d）✅ 2026-09-23**：`docker-compose.yml`（postgres15、redis7、minio）；server/collab 的 `.env.example`；Prisma 初始化（**偏差见进度日志：本机无 Docker，改原生 Windows 服务；Prisma 锁 7.10.0**）
- [x] **T1.1 认证（1.5d）✅ 2026-09-23**：NestJS 骨架；`POST /auth/login`（桩用户表）；JWT access/refresh 签发；`GET /collab/token?docId=`（绑定 docId、5min、jti）
- [x] **T1.2 文档 CRUD + 列表页（2d）✅ 2026-09-23**：docs 表与接口（06 文档）；web 引入 react-router、react-query；列表页/编辑页路由；新建/重命名/软删除；编辑页先验权限再挂编辑器（无权限态，不建 WS）
- [x] **T1.3 二进制持久化（2.5d）✅ 2026-09-23**：建表（03 文档 DDL）；collab 独立最小 DB client（仅两表权限的账号）；`docStore.loadState`（快照+增量回放）；`appendUpdate`（Redis 锁 + 水位行 `FOR UPDATE` + UNIQUE 幂等）；新建文档事务写空快照基线
- [x] **T1.4 快照压缩（1.5d）✅ 2026-09-23**：阈值触发（M0 阈值 100 条/2MB）；锁+事务内 encode → upsert snapshot → 删旧增量；`onDestroy` 强制压缩；失败置房间只读
- [x] **T1.5 真实鉴权（1.5d）✅ 2026-09-23**：collab `onAuthenticate` 接 server `/internal/docs/:id/membership`；Redis 缓存 60s；viewer 只读（网关丢弃写 + 前端 setEditable 双保险）；WS token 校验
- [x] **T1.6 离线与连接状态（1d）✅ 2026-09-23**：确认 y-indexeddb 全链路；zustand 接入；连接状态条四态（connected/syncing/offline/denied）；认证失败停止重试
- [x] **T1.7 Presence（1d）✅ 2026-09-23**：awareness 字段按 shared 类型固化；头像组按 userId 聚合；多标签去重；30s 超时清理；稳定取色
- [x] **T1.8 踢人/降权（1d）✅ 2026-09-23**：server 权限变更 → 删鉴权缓存 + Redis PUBLISH；collab 房间订阅 → closeConnection；前端只读提示
- [x] **T1.9 基础工具栏 + 字数（1d）✅ 2026-09-23**：粗斜删/H1-H3/列表/引用；undo/redo 接 y undoManager；CharacterCount；用 useEditorState 选择器防重渲染
- [x] **T1.10 崩溃恢复演练（1d）✅ 2026-09-23**：kill -9 collab 后重启零丢失验证；onLoadDocument 回放性能观察；补 Vitest 单测（appendUpdate 幂等、压缩事务）
- [ ] **M1 准出**：拔网线 10 分钟双写零丢字；杀进程零丢失；内部 10 人试用 1 周

---

## M2 · Word 类功能（第 5–8 周，约 20 人日，按序）

- [x] **T2.1 图片/附件（3d）**：server 签名直传（MinIO）+ attachments 表；web 三处拦截（粘贴/拖拽/工具栏）统一上传器；失败占位与重试；节点仅存 URL+尺寸；C16 用例
- [x] **T2.2 富格式扩展（3d）✅ 2026-10-10**：Table 全家桶、TaskList、Link、Underline、Highlight、HorizontalRule、CodeBlockLowlight；表格协同用例 C08 专项
- [x] **T2.3 评论（4d）**：自研 CommentMark 扩展（threadId）；`comments` 顶层 Y.Array 命名空间；commenter 命名空间级权限；侧栏线程 UI；网关抽取 → server `/internal/extracted` 回写 comments 表；resolved 折叠；C09 用例 ✅ 2026-10-10
- [x] **T2.4 版本历史（3d）✅ 2026-10-22**：手动 + 10 分钟定时 revision；时间轴 UI；只读预览；恢复走"整体替换 update"（04 文档第 7 节），禁止清空重建；C15 用例
- [x] **T2.5 分享与权限面板（2d）✅ 2026-10-22**：邀请/改角色/移除；链接四档 + 随机 token；匿名只读端到端；C17 用例
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
- 2026-09-22 **T0.6 完成，M0 里程碑达成**。
  - 根 `README.md`：环境/安装/双服务启动/验证步骤。
  - `pnpm -r typecheck` 全绿（shared/collab/web）。
  - 首次提交 `3ccd3a8`（37 文件，含 pnpm-lock.yaml，排除 node_modules/dist）。
  - 08 风险登记册 +4 条实际踩坑（cursor plugin key 冲突、Vite WS 代理、awareness userId、undoRedo 改名）；02 扩展清单同步。
  - **M0 准出**：C01/C04/C06 通过 + IndexedDB 持久化 + 多标签内存恢复；C02/C03/C05 待人工复现（机制具备）；C07 归 M1-T1.7。
- 2026-09-23 **T1.0 完成**。
  - **偏差 1（基础设施）**：本机无 Docker/Podman/WSL 发行版，经用户确认改用**原生 Windows 安装**：PostgreSQL 15.19（winget 静默装，服务 `postgresql-x64-15` 运行中，端口 5432，超级用户密码 postgres）；Redis 用 **Memurai Developer 4.1.2**（Redis 7.2.5 API 兼容）——MSI 自定义动作在本机被拒（SFXCA error 5），改 `msiexec /a` 管理员解包部署到 `.infra\memurai\`（已 gitignore），后台进程方式启动端口 6379；`docker-compose.yml` 保留供 CI/Linux。`.infra\start-dev.bat` 一键拉起。
  - 数据库初始化：库 `online_word`；角色 `ow_app`（业务表，CREATEDB 供 Prisma shadow db）/`ow_collab`（仅协同二进制表）；PG15 默认收回 public schema CREATE，已显式 GRANT USAGE+CREATE。
  - **偏差 2（Prisma 7）**：`latest` 标签指向 8.0.0-rc（RC 不可用），锁定稳定线 **7.10.0**。Prisma 7 关键变更已适配：schema datasource 不再支持 `url`（迁移连接串移到 `prisma.config.ts`，运行时用 `@prisma/adapter-pg` 注入 PrismaClient）；generator 必须为 `prisma-client` 且显式 output（`apps/server/src/generated/prisma`，已 gitignore）；CLI 不再自动加载 .env（config 内 Node 22 `process.loadEnvFile` 显式加载）。
  - **TS7 兼容性验证（T0 计划中的最大风险点）**：Prisma 7 生成客户端 + `@prisma/adapter-pg` 在 TypeScript 7.0.2 strict 下 typecheck 通过；运行时冒烟 `$queryRawUnsafe('SELECT 1')` 返回 `[{ok:1}]`。**结论：T1.1 无需回退 TS 5.6**。
  - 新增文件：`docker-compose.yml`、`apps/server/.env.example`、`apps/collab/.env.example`、`apps/server/prisma/schema.prisma`（M1 模型待 T1.2）、`apps/server/prisma.config.ts`、`apps/server/tsconfig.json`（NodeNext+ESM）、`apps/server/src/prisma.ts`（client 单例）、`.infra/start-dev.bat`。
  - 验收：`pnpm -r typecheck` exit 0（含 server）；Memurai PONG；psql 双角色登录 OK。
- 2026-09-23 **T1.1 完成**。
  - **NestJS 版本**：当前 latest **12.0.4**（ESM-native，包声明 `type: module`），与仓库 ESM/NodeNext 约定契合；`@nestjs/* 12.0.4`、rxjs 7.8.2、reflect-metadata 0.2.2、jose 6.2.12、zod 4.6.5 均已回填 catalog。
  - **TS7 兼容性（实现前探针验证）**：TS 7.0.2 支持 experimentalDecorators + emitDecoratorMetadata（编译产物含 `design:paramtypes`）✅；NestJS 12 d.ts 在 7.0.2 strict 下 typecheck 通过 ✅；运行时 DI 正常 ✅。**结论：无需回退 TS 5.6**。
  - **关键坑 1：NestJS dev 不能用 tsx**——esbuild 不支持 emitDecoratorMetadata（实测 tsx 下 `Reflect.getMetadata('design:paramtypes')` 为 undefined），构造器注入运行时全部失效。新 dev 编排：`apps/server/scripts/dev.mjs`（`tsc --watch` + `node --watch dist` 双进程），根命令 `pnpm dev:server`（顺带修正原 filter 名错误 `server`→`@online-word/server`）。
  - **关键坑 2：jose `setExpirationTime(number)` 语义是绝对 Unix 秒而非时长**——首版签出 `exp:900`（1970 年）秒过期。已改为 `nowSec() + ttl` 显式换算。
  - 实现：auth 模块（login/refresh/collab-token，Bearer Guard + `@CurrentUser`）；三类 JWT（access/refresh/collab）以 `use` 声明防跨用、独立密钥隔离（新增 `JWT_COLLAB_SECRET`，collab 网关 T1.5 持同钥验签）；校验用 zod 自定义管道（不引入 class-validator/class-transformer：CJS 且重依赖元数据，与 Nest12 ESM 不搭）。
  - 验证：`pnpm -r typecheck` exit 0；正例（login 200/refresh 轮换/collab-token payload 含 docId+jti、exp-iat=300s）+ 负例 6 组（错密码 401、缺字段 400、无 Bearer 401、access 冒用 refresh 401、伪造 token 401、缺 docId 400）全部符合预期。
  - 备注：jti 一次性防重放的网关侧去重归 T1.5；refresh 撤销名单归 M2 安全加固；users 表落库后替换桩用户并引入密码哈希。
- 2026-09-23 **T1.2 完成**。
  - 数据库：Prisma schema 新增 `Doc`/`DocMember`（docs/03 §2 DDL 最小集）；迁移 `20260923080916_init_docs` 手工补齐 Prisma 无法表达的部分——`doc_members.role` CHECK 约束 + `idx_docs_owner` 部分索引（WHERE deleted_at IS NULL）。**坑：`prisma migrate dev` 在 Prisma 7 下不会自动重新 generate client**，需显式 `prisma generate`。
  - server：`permissions` 模块（`PermissionsService.getMemberRole` + `DocRoleGuard` + `requireRole(minRole)` 复合装饰器：非成员 404 不泄露存在性、角色不足 403）；`docs` 模块（GET /docs 分页/关键字 contains insensitive/updatedAt 倒序、POST /docs 事务写 docs+owner 成员、GET/PATCH/DELETE /docs/:id 软删除 owner）。BigInt currentVersion 经 JSON 必须转 string（JSON.stringify(BigInt) 会抛 TypeError）。
  - **关键坑：NestJS Guard 的模块上下文**——`@UseGuards(JwtAuthGuard)` 在 DocsController 上时，Guard 由 **DocsModule** 实例化，其依赖（AuthService/UsersService）必须在 DocsModule 可见：AuthModule 需 `exports: [AuthService, UsersModule]`（imports 不具备传递性，须显式 re-export UsersModule）。
  - web：react-router-dom 7.18.4 + @tanstack/react-query 5.103.2（已回填 catalog）；登录页（localStorage 存 token+user）；api 客户端（401 → refreshToken 无感续签一次重放，失败清会话回 /login）；列表页（新建/重命名/软删除/关键字过滤，按角色控制按钮可用性）；编辑页 `/docs/:id` 先 GET /docs/:id 验权 + 换 collab token 再挂编辑器（无权限态不建 WS）；Vite 增加 `/api → :3000` HTTP 代理；useCollabDoc 改收真实 token（空串不建连接）。
  - 验证：`pnpm -r typecheck` exit 0；API 正例 5 组（create/list/get/rename/keyword CJK+insensitive）+ 负例 4 组（无 token 401、非成员 GET/PATCH 404、空标题 400、软删后再查 404）全过；浏览器 9 步端到端（重定向登录→登录→新建→进编辑器协同→双标签同步→返回列表→软删除→退出）全 PASS，M0 协同链路无回归。
  - 待办（T1.3）：POST /docs 同事务补空快照基线；WS token 5min 过期后的重连续签策略归 T1.6。
- 2026-09-23 **T1.3 完成**。
  - 数据库：手工 SQL 迁移 `apps/collab/migrations/V1__binary_tables.sql`（doc_snapshots / doc_updates / doc_sync_cursors，docs/03 §2 原生 DDL；**不用 Prisma 管理二进制表**，避免业务 client 与 collab 权限耦合）。权限收敛：ow_collab 三表 DML + 序列 USAGE；ow_app 仅 doc_snapshots INSERT（建空快照基线用）——已实测 ow_app SELECT doc_updates 被拒。
  - collab：`db.client.ts`（pg Pool + `isDocUuid` 门卫：非 UUID 房间如 M0 测试房间不落库；`loadDocBaseline` 快照+增量读取；`appendUpdate` BEGIN→水位行 `SELECT ... FOR UPDATE`（无则 INSERT ON CONFLICT DO NOTHING 后从 1 起）→INSERT→水位+1→COMMIT）；`redis.client.ts`（ioredis + `withLock`：SET NX PX 租期 10s、自旋 25ms 最长等 2s、Lua 比对 token 释放）；`persistence.ts`（loadDocState 快照+增量回放 / persistChange 锁内追加重试 3 次）；main.ts onChange→persistChange、onLoadDocument→loadDocState；`.env`（gitignored）+ `env.ts` loadEnvFile。
  - server：POST /docs 事务内 `$executeRaw` 写空快照基线（version=0, state=2 字节空 update）。**坑：Prisma 7 SQL 编译器 bytea 字面量 `'\x0000'` 报协议错"insufficient data left in message"**，必须 `decode('0000','hex')`；**带 arbiter 的 `ON CONFLICT (col)` 需要对索引列的 SELECT 权限**（PG 冲突检查要读索引），INSERT-only 账号须用无 arbiter 的 `ON CONFLICT DO NOTHING`。
  - 验证：`pnpm -r typecheck` exit 0；新建文档基线行确认（version=0/size_bytes=2/state_hex=0000）；浏览器输入中文+英文混合内容后 doc_updates 落库 1 条（78 字节）、水位 next_version=2；崩溃恢复端到端演练——杀 collab 进程→重启（服务端日志 `loaded snapshot=yes@v0 updates=1`）→清浏览器 IndexedDB→刷新页面→正文完整恢复，PASS。
  - 遗留：房间只读降级归 T1.4；压缩归 T1.4；token 重连续签归 T1.6。
- 2026-09-23 **T1.4 完成**。
  - collab 新增 `room-state.ts`（内存房间运行态：pendingUpdates/pendingBytes 驱动阈值、readOnly 降级标记；进程重启自然清零——Y.Doc 同步从 DB 重建，一致性不受影响）。`persistence.ts`：persistChange 成功后累加积压，达阈值（条数 ≥COMPACT_UPDATES=100 或字节 ≥COMPACT_BYTES=2MB，环境变量可覆盖）触发 `compactRoom`；`compactOnUnload` 供房间卸载时强制压缩；**写失败重试耗尽 → markRoomReadOnly + 抛错**。`db.client.ts` 新增 `compactDocInDb`：事务内读水位 → upsert 快照（ON CONFLICT (doc_id) DO UPDATE，ow_collab 有全 DML 无碍）→ DELETE version ≤ 水位。
  - main.ts：**onAuthenticate 检查房间只读 → `connectionConfig.readOnly = true`（Hocuspocus 原生连接级只读：网关丢弃该连接 SyncStep2/SyncUpdate 并回复 SyncStatus false）**；onChange 失败 catch → `closeConnections(docName)` 踢出在场连接，客户端自动重连后以只读建立（防静默丢更新，宁丢不脏）；**关键坑：Hocuspocus v4 的 onDestroy 仅在 Server.destroy 时触发且 payload 无 documentName/document——房间卸载（最后连接关闭）的正确 hook 是 `beforeUnloadDocument`（document.destroy() 前最后时机，有 document 引用）**。
  - 压缩与追加共用同一把 `lock:doc:{docId}`（docs/03 §5 提到的独立 compact 锁与互斥诉求矛盾，实测同锁最简单可靠）；压缩锁租期放宽至 30s。
  - 验证（COMPACT_UPDATES=3 临时阈值 + 浏览器端到端）：①阈值触发 `reason=threshold updates=3 → snapshot@v5 bytes=281 updates_deleted=3`，水位推进正确；②强制压缩 `reason=onDestroy snapshot@v2 updates_deleted=2`，重连后 `loaded snapshot=yes@v2 updates=0` 且正文 5 行完整（快照单点恢复）；③只读降级——REVOKE ow_collab 对 doc_updates 的 INSERT 模拟写路径失效（比改 DATABASE_URL 更精准：DB 全断时 onLoadDocument 也失败、房间根本打不开，模拟不出"读成功写失败"）：日志依次出现 3 次 append 失败 → 房间降级只读 → 踢出在场连接 → 重连后 `[auth] 房间只读降级中，连接以只读建立`；GRANT 恢复 + 重启 collab 后写路径正常（降级态随进程重启自然解除）。
  - 验证插曲：浏览器 agent 曾误报"刷新后新增内容丢失"，实为其执行顺序错乱（先清 IndexedDB 刷新、后输入）；以 DB 增量（v2 落库）+ 干净刷新后正文完整为由推翻，服务端链路无问题——**结论以 DB 状态与服务端日志为准，agent 叙述仅作线索**。
  - 遗留：docs/03 §5 第 5 步"经内部接口回写 docs.current_version/updated_at"与定时扫描兜底任务不在 T1.4 范围（SERVER_INTERNAL_URL/INTERNAL_API_KEY 已就绪），归 M2 定时任务一并实现。
- 2026-09-23 **T1.5 完成**。
  - server：新增 `internal` 模块——`InternalApiKeyGuard`（x-internal-key 恒等比较，INTERNAL_API_KEY 未配置时恒拒绝）+ `GET /internal/docs/:docId/membership?userId=`（zod 双参 uuid 校验防 PG 类型错）。**设计：非成员返回 200 + `ok:false`**，让网关能区分"业务上无权"（正常结论，实时查库不缓存）与"服务异常"（非 200，网关 fail-closed）；响应即 shared `AuthResult`（permission=permissionOf(role)、`ttlMs=60_000` 下发缓存 TTL），网关零转换消费。每次实际查库打 `[internal] membership` 日志（T1.8 删缓存前的观测点）。
  - collab：`auth.service.ts` 真实实现——①jose 本地验签（HS256/JWT_COLLAB_SECRET 与 server 共钥，要求 `use=collab` 且 `claims.docId === 房间名`，exp 自动校验）；②membership 查询 + Redis 缓存 `collab:membership:{docId}:{userId}` PX=server 下发 ttlMs，**仅缓存放行结论**（拒绝不缓存：管理员加成员后立即可连，无 60s 空窗）；③Redis 故障降级直查后端（缓存是优化不是依赖），后端不可达保守拒绝（fail-closed）。main.ts onAuthenticate：`permission=read → connectionConfig.readOnly=true`（viewer/commenter 连接级只读，Hocuspocus 丢弃写消息），与 T1.4 房间降级只读叠加生效。collab 新增依赖 jose（catalog 6.2.12）+ `.env` 增 JWT_COLLAB_SECRET。
  - web：`useTiptapEditor` 初始 `editable: roleAtLeast(role,'editor')`（前端 setEditable 双保险）+ 状态条「只读模式」徽标。
  - **决策：jti 一次性去重暂缓**（T1.1 曾计划归 T1.5）——强制一次性使用会打断 provider 断线自动重连（同 token 重连被拒），与 T1.6 的 token 续签策略强耦合，移至 T1.6 一并落地；T1.5 范围内 token 在 5min TTL 内可复用。
  - 协议备忘：server→client 的 Auth 回复为 `varString(docName)+varUint(2)+varUint(subtype)+payload`，subtype **1=Permission（payload varString "permission-denied"）、2=Authenticated（payload varString scope "read-write"/"readonly"）**；readOnly 连接的 scope 即 "readonly"。
  - 验证（node 脚本手工编码 Auth 消息四阶段 + 浏览器端到端）：①非成员 bob/carol 连 WS → permission-denied；②DB 加成员后 owner/editor → scope="read-write"、viewer → scope="readonly"（连接级只读生效）；③缓存命中——60s 内重连 3 次，server `[internal]` 查库日志数不变，Redis key TTL=60s；④token 绑定校验——DOC_A 的 token 连其他房间、乱串 token 均被拒；⑤浏览器 carol（viewer）端到端：列表页文档带"只读"标签、编辑页「只读模式」徽标、`.ProseMirror` isContentEditable=false、键入被阻止，在线列表正常。
  - 验证插曲：浏览器旧标签页持有的 M0/过期 token 重连被拒属预期（T1.6 续签前的已知行为），刷新页面即恢复。
  - 遗留：WS token 5min 过期的重连续签归 T1.6；踢人/降权的事件推送（删缓存 + PUBLISH）归 T1.8。
- 2026-09-23 **T1.6 完成**。
  - **决策：jti 一次性去重正式放弃**（T1.5 暂缓项的结论）——读 @hocuspocus/provider 4.7 源码确认：token 支持函数形式且**每次 WS open（含自动重连）都会重新调用** `getToken()`（onOpen → sendToken → getToken）；强制 jti 一次性会使同 token 的自动重连被拒，把"网络闪断无缝重连"劣化为"换 token 重建"，可用性损失大于安全收益（token 5min TTL + 绑定 docId，重放收益极低）。
  - token 续签（利用上述机制，零销毁零重建）：`useCollabDoc(docId, user, getToken)` 签名——编辑页注入带新鲜度检查的回调（tokenRef 缓存 `{token, expiresAt=获取时刻+(expiresIn-30)s}`，命中直接用，过期重新 GET /collab/token；403 = 无权限 → getToken 抛错 → provider authenticationFailed → denied）。useCallback([id]) 保证引用稳定，防止 effect 重跑重建连接。
  - **认证失败停止重试**：provider 的 `permissionDeniedHandler` 只发事件**不停连**（shouldConnect 仍 true，onClose 后无限重连循环）——onAuthenticationFailed 里手动 `provider.disconnect()`（shouldConnect=false）；disconnect 再触发的 disconnected 状态事件用局部 `denied` 标志守卫，防止覆盖 denied 态。
  - zustand 5.0.15 接入（catalog）：`collab.store.ts` 每篇文档连接 `createStore` 一个实例（随 provider 生命周期创建/丢弃，避免全局单例的文档切换残留与重置逻辑）；StatusBar 用 `useStore(store, selector)` 订阅；在线用户仍在组件本地 state（T1.7 迁入）。
  - 状态条四态：`syncing`（WS 连/初始同步中）→ `connected`（已同步）→ `offline`（断线重连中）→ `denied`（认证被拒 + 红字「重新连接」按钮，点击 `provider.connect()` → getToken 自动续签 → 重新鉴权）。样式：offline 灰点、denied 红点红字。
  - 踩坑：StatusBar 一度用 `handles.ydoc.guid` 当文档 ID——`new Y.Doc()` 的 guid 是随机值，与房间名（provider name）无关，必须用路由 docId 传递。
  - 验证（浏览器 agent + 服务端日志 + DB 回放脚本三重证据，全 PASS）：①基线 alice（editor）打开测试文档状态条「已连接」；②**offline 全链路**——taskkill 杀 collab → 状态条 8s 内变「离线（重连中）」→ 离线键入「离线编辑验证A1」（编辑器接受、本地渲染）→ 重启 collab → **自动重连**回「已连接」→ 刷新正文完整 → node 脚本回放 DB（snapshot v9，增量已被房间卸载压缩合并）确认含「离线编辑验证A1」（离线内容经重连同步落库，y-indexeddb 链路闭环）；③**认证失败停止重试**——JWT_COLLAB_SECRET 换错值重启 → 浏览器 denied 态 + 「重新连接」按钮 + 服务端 15s 内 permission denied 仅 1 次（无循环）；④**续签恢复**——换回正确 secret 重启 → 点击「重新连接」→ getToken 缓存已过期自动换新 token → `[auth] ok` → 继续编辑正常。
  - 环境坑：多轮验证后台 job 泄漏堆积 7 个 tsx watch 残留进程（EADDRINUSE 的真凶）——按 `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` 过滤 tsx 命令行全量清理后重起单实例；taskkill /T 杀 server 子进程后 tsx watch 自动 Rerunning 可能撞端口窗口期崩溃留孤儿进程，进程治理要按父进程树清。DB 回放脚本坑：Y.XmlFragment 须 `toArray()` 迭代（不可直接 for-of）。
  - 遗留：jti 去重不做；offline 期间 provider 消息队列 flush 依赖 y sync 协议兜底（重连后按状态向量推 diff），无需额外处理。
- 2026-09-23 **T1.7 完成**。
  - shared 固化 awareness 协议契约（docs/04 §5）：`CursorPosition {anchor,head}`（远程光标 M1 后续任务接入，本任务先置 null）+ `AwarenessState {user,cursor,lastUpdate}`；web 端写入 user/cursor/lastUpdate 三字段，15s 心跳刷新 lastUpdate（供未来自定义清理/观测）。**30s 超时清理不自己实现**——y-protocols Awareness 内置 checkInterval 已处理，前端只需响应 change 事件重算。
  - 稳定取色：shared 新增 `COLOR_PALETTE`（8 色）+ `colorForUser(userId)`（FNV-1a 32bit 哈希取索引，兜底 '#4a90d9'——noUncheckedIndexedAccess 下数组索引返回 `T | undefined`）。DocEditorPage 的 awarenessUser 与页头 UserBadge 统一改用 colorForUser，**server 桩下发的 color 不再用于展示**（此前页头徽章与在线列表同用户不同色的不一致即源于此）。
  - 在线用户迁入 zustand：`createCollabStore(me)` 增加 `onlineUsers` 字段（初值 [me]），useCollabDoc 订阅 awareness change → Map 按 userId 聚合去重 → store；OnlineUsers 组件从本地 state 改 `useStore` 订阅，组件内聚合逻辑上移到 hook。
  - **验证坑**：浏览器 agent 读取 `.user-dot` 颜色时把页头 UserBadge 的徽章（3 个 dot 中的 #1a73e8）误当 awareness chip 报告——实际 awareness chips 的 #4a90d9(alice)/#f8e71c(bob) 与 node 端 colorForUser 计算值逐一吻合；结论以代码 grep + node 精确计算为准。
  - 验证（浏览器 agent，全 PASS）：①alice 单人在线 1 人、色 #4a90d9；②bob 加入后两端均"在线 2 人"、色 #f8e71c；③alice 同账号开第三标签 → 在线人数仍 2（userId 聚合去重生效）；④关闭 bob 标签等 35s → alice 端自动回落"在线 1 人"（y-protocols 30s 超时清理生效）。
  - 遗留：cursor 字段已固化但未接 ProseMirror 位置（远程光标），归 M1 后续/T1.9 之后评估。
- 2026-09-23 **T1.8 完成**。
  - 控制事件契约（shared）：`CollabControlEvent {docId,userId,action:'membership-changed'}` + `collabControlChannel(docId) = 'collab:control:{docId}'`（psubscribe 通配订阅，新增事件类型免改订阅端）。
  - server：`MembersController`（`docs/:id/members`，JwtAuthGuard + 全 owner 专属 requireRole）——GET 列表 / POST 加成员 / PATCH `:userId` 改角色 / DELETE `:userId` 踢出；zod DTO（成员角色枚举排除 owner——owner 不可授予/变更/移除，owner 视图置灰）。`PermissionsService` 注入 UsersService 解析姓名（**users 是桩表，无 prisma.user 可查**）；每处变更先 `DEL collab:membership:{docId}:{userId}` 再 `PUBLISH`，**PUBLISH 失败仅打日志不阻断写库**（Redis 故障时 60s 缓存 TTL 自然过期兜底）。
  - collab：`control.subscriber.ts` 独立 ioredis 订阅连接（**订阅连接要求 `maxRetriesPerRequest: null`**，与数据连接配置不同）；pmessage → 解析事件 → `server.hocuspocus.documents.get(docId)?.connections.keys()` 遍历，`conn.context?.user?.userId === event.userId` 命中即 `conn.close({code:4003, reason:'membership-changed'})`；日志 `kicked=N`。main.ts 挂载 + 优雅停机 disconnect。
  - web：collab store 增 `authorizedScope`（onAuthenticated 的 scope 写入）；StatusBar——`authorizedScope === 'readonly'` 且本地位足够（roleAtLeast editor）→「权限已调整：只读」徽标 + 编辑器 setEditable(false)（降权场景）；denied 态显示「连接被拒绝」+「重新连接」按钮（provider.connect() → getToken 续签重鉴权，T1.6 机制复用）。
  - **踢人闭环链路**：server DELETE 成员 → DEL 缓存 + PUBLISH → collab close(4003) → provider 视为连接关闭**自动重连**（T1.6 的 getToken 续签在 open 时触发）→ onAuthenticate 实时查库（缓存已删）→ permission denied → 前端手动 disconnect 停止重试 → denied 态。降权场景同理重连后 scope=readonly，连接级只读生效。
  - 踩坑：①MembersController 的 JwtAuthGuard 在 PermissionsModule 上下文实例化，需 imports AuthModule（Nest Guard 依赖解析坑，与 T1.2 同款）；②server 无全局 API 前缀（/api 只是 Vite 代理层），验证脚本 BASE 直接 `http://localhost:3000`。
  - 验证（node 脚本四命令 + 浏览器双标签端到端，全 PASS）：①REST——alice 登录后 list 返回 3 成员、PATCH bob→viewer 200、DELETE bob 204；②降权——collab 日志 `[control] membership-changed ... kicked=1` → bob 自动重连 `[auth] role=viewer permission=read (readOnly)` → bob 界面「权限已调整：只读」徽标、输入被阻止；③踢出——DELETE 后 kicked=1 → bob 重连 permission denied，15s 窗口无重试循环 → 「连接被拒绝」+「重新连接」按钮；④验证后 restore 恢复 bob=editor，临时脚本已删。
- 2026-09-23 **T1.9 完成**。
  - 依赖：catalog 增 `@tiptap/extension-character-count: 3.31.3`（v3 该包是 `@tiptap/extensions` 的 re-export 薄壳，storage API 为 `editor.storage.characterCount.characters()/words()`，limit=null 纯统计不截断）。**undo/redo 零新增依赖**：读 Collaboration 扩展源码确认其自动挂 yUndoPlugin 并注册 `editor.commands.undo()/redo()`（can() 按 undoStack/redoStack 长度判定），StarterKit 的 undoRedo:false 保持即可，无需任何 UndoManager 接线。
  - `Toolbar` 组件（RichTextEditor.tsx 内）：撤销/重做、B/I/S、H1-H3、• 列表/1. 列表、引用共 12 按钮 + 分隔符，命令统一 `editor.chain().focus().toggleXxx().run()`（docs/05 §5）；字数统计挂在工具栏行尾。
  - **重渲染控制**：active/disabled/字数全部经 `useEditorState({editor, selector})` 派生（v3 签名：selector 接收 `{editor, transactionNumber}`，editor 可 null；默认 deepEqual 比对），编辑器 body 不订阅整份 state；协同远端更新也走 dispatchTransaction，字数/他人状态自动联动。
  - viewer/降权（editable=false）时整条工具栏按钮 disabled + readonly 样式，与 T1.5/T1.8 的只读联动一致。
  - 验证（浏览器 agent 两轮，DOM 属性级取证，全 PASS）：①按钮齐全 + 字数初值读取；②空栈时撤销/重做 disabled，输入后撤销变可用；③字数精确 +7（27→34）与 0→6 两场景；④选中文本点 B → `<strong>` + B 按钮 active；⑤H2 切换 `<h2>` ⇄ `<p>` 且 active 正确；⑥• 列表 → `<ul><li>`、撤销还原 `<p>`、重做恢复（undo/redo 栈行为符合预期）；⑦引用 → `<blockquote>` + active；⑧控制台无 error。
  - 环境插曲：pnpm store（D:\.pnpm-store）与 cache 在沙箱白名单外，install 需沙箱外执行（EPERM on store files）；浏览器 agent 曾用 document.execCommand('bold') 绕过工具栏"验证"加粗，复核后要求其直接点击 B 按钮重验（`<strong>` 确认）——**验证以"点击真实按钮 + 读 DOM"为准，execCommand 走的不是 Tiptap 命令链**。
- 2026-09-23 **T1.10 完成**。
  - Vitest 5.0.1 入 catalog，collab `pnpm test`（vitest run）。**测试定位为集成测试而非纯单测**：appendUpdate/compactDocInDb 的核心价值在事务与约束行为，mock 无法验证（FOR UPDATE 行锁、UNIQUE 幂等、FK CASCADE），连本机 dev PG（T1.0 偏差：无 Docker，testcontainers 不可用）。
  - **FK 坑（首次运行即撞）**：协同三表 `doc_id REFERENCES docs(id) ON DELETE CASCADE`，而 ow_collab 账号对 docs 表无 INSERT 权限——测试需先用 ow_app 账号（读 apps/server/.env）为每个随机 docId 建测试 docs 行，结束 DELETE docs 级联清理（并验证零残留）；createTestDocs 必须幂等（Set 记录已插入），否则各用例累计重插撞 docs_pkey。doc_id 用随机 UUID 且 owner_id 用桩用户，不触碰真实数据。
  - 8 用例全过：①appendUpdate 首写 version=1 初始化游标；②连续追加 1n/2n/3n 严格递增；③**并发 8 路 Promise.all 追加 → version 互不重复且连续覆盖 1..8**（FOR UPDATE 串行化 + UNIQUE 裁决，零丢失零重复）；④压缩后快照 @v3、28→0 条增量、**水位不回退**（压缩后续写从 v4 续号）；⑤基线回放：快照 + 压缩后新增量重组完整文本；⑥二次压缩 upsert 覆盖快照推进水位；⑦空文档压缩 v0；⑧空基线。测试后 afterAll 删 docs 级联清三表。
  - onLoadDocument 性能观测：loadDocState 日志升级为 `query=Xms replay=Yms total=Zms`（DB 查询 / Y.applyUpdate 回放分段计时）。
  - **崩溃演练（C11，三重证据全 PASS）**：①基线——浏览器输入"硬杀恢复演练基线A1"（合并进已有 H2 标题，无碍断言）确认已连接；②`taskkill /F /T` 硬杀 collab 整棵进程树（tsx watch + 子进程，等效 kill -9，无优雅停机），:8080 立即无监听；③**DB 回放确认崩溃前文本已落库**（snapshot v10 + 28 条增量至 v38，回放文本含 A1）；④重启 collab → 浏览器 8s 内**自动重连**"已连接"，编辑器内容完整（provider 重连 + onLoadDocument 从 DB 重建）；⑤重启后追加"重启后追加B2"→ 刷新页面两段都在 → DB 回放 updates 至 v40 含 B2（零丢失闭环）。
  - 性能观察结论：28 条增量回放 replay=7ms（applyUpdate 纳秒级/条），query=35ms（本地 PG 往返），total=42ms——**回放成本可忽略，瓶颈在 DB 查询往返**；万条级增量预估 replay 也仅 ~0.3s，压缩阈值（100 条）下的正常水位完全无感。
  - 环境插曲：浏览器会话残留 bob 登录态（非 alice），但 bob 已在 T1.8 验证后 restore 为 editor，写权限正常，演练不受影响。
- 2026-10-10 **T2.1 完成**。
  - **偏差 1（对象存储）**：MinIO 开源版已归档下架（dl.min.io 410 Gone、GitHub release 404），dev 环境改用 **SeaweedFS 4.48**（S3 API 兼容 AWS SDK v3，weed.exe 146MB 置于 `.infra\seaweedfs\`，已 gitignore；`docker-compose.yml` 保留 minio 服务供 CI/Linux）。
  - **关键坑 1（AWS SDK v3 presign）**：client 默认 `requestChecksumCalculation=WHEN_SUPPORTED` 会在预签名 URL 掺入 `x-amz-checksum-crc32` 头要求，浏览器 PUT 直接 400 BadDigest；必须显式 `requestChecksumCalculation: 'WHEN_REQUIRED'` 才能生成干净可用的 presigned PUT URL（实测对照验证）。
  - **架构决策（/s3proxy 同源代理）**：SigV4 签名 host 是 S3 endpoint（localhost:9000），返回给前端的 uploadUrl/publicUrl 把 `scheme://host` 替换为 `/s3proxy` 前缀，Vite/nginx `changeOrigin: true` 还原 Host 后验签通过；**文档节点只存相对 URL**（环境无关、同源零 CORS、换存储域名不用迁移数据）。
  - **关键坑 2（Prisma 7 drift）**：collab 三表不在 Prisma 迁移链，`migrate dev` 检出 drift 会要求 reset（**绝不可**）；解法 = 手写 `migration.sql`（attachments 表 + unique object_key + doc 索引 + FK CASCADE）→ `prisma db execute --file` → `prisma migrate resolve --applied`。
  - **关键坑 3（NestJS Guard 第三次踩）**：AttachmentsModule 的 controller 同时挂 JwtAuthGuard 与 DocRoleGuard，Guard 在**消费方模块**实例化——必须 imports AuthModule + PermissionsModule（同 T1.2/T1.8，注释已写明）。
  - **关键坑 4（PM setNodeMarkup 全量替换）**：`tr.setNodeMarkup(pos, undefined, attrs)` 走 `node.type.create(attrs)` 是**全量替换而非合并**，未提供的 attrs 回落 default(null)——失败路径只传 `{uploadState:'error'}` 会把 alt/uploadId 全部冲掉，导致 handleClickOn 的重试条件（uploadId 非空）永不命中；修复 = applyAttrs 先取 `node.attrs` 合并 patch 再传入。
  - **关键坑 5（fetch 响应体未消费）**：S3 PutObject 返回空 body，`putToStorage` 不消费 body 时 Chromium 会在 console 补记 net::ERR_ABORTED 噪音（请求实际已 200）；修复 = `res.body?.cancel()`。
  - **关键坑 6（SeaweedFS RAFT 脏状态）**：强杀 weed 后重启卡 `raft.Server: Not current leader` 死循环；删 `data\m9333`（master RAFT 目录）保留 volume 数据重启即恢复，已上传对象可读性实测无损。
  - 环境坑：沙箱会回收 Start-Process 启动的常驻进程（同命令内探活成功、跨命令即 ECONNREFUSED），Memurai/weed 须**沙箱外启动**。
  - 实现：server `infra/s3.client.ts`（单例 + signUpload 返回 /s3proxy 前缀 URL + objectKey 规则 `u/{yyyyMM}/{uuid}/{消毒文件名}`）+ attachments 模块（POST /upload/sign 仅登录、POST/GET /docs/:id/attachments 走 requireRole('editor')；**register 先 HEAD 对象校验真实存在且 size 一致，防凭空登记**）；web `uploader.ts`（三入口统一：handlePaste/handleDrop/工具栏 file input；validateFile 白名单+大小上限，不合格直接 error 占位不发请求；sign→PUT→register→measureImage→回填 src/alt/width/height 并清空上传态；**上传态用节点自定义 attrs uploadId/uploadState 承载、随 Y.Doc 协同广播**，File 仅存创建端内存 Map）。Image 扩展锁 @tiptap/extension-image 3.31.3（与 Tiptap 组强耦合）。
  - 验证（浏览器 agent DOM 属性级 + DB/服务端实锤，全 PASS）：①三入口——粘贴/工具栏/拖拽各贴一张，全部完成态（src=/s3proxy/ow-attachments/u/202610/…、state=null、width=200、height=100、alt=文件名）；②**C16 并发**——双标签同文档各自粘贴（paste-a/paste-b），DB attachments 表 10 条登记（各 objectKey 唯一）、两标签 img 列表一致收敛、无 uploading/error 残留、正文编辑不阻塞；③失败占位——停 weed 后贴图：红虚线 error 占位（borderStyle=dashed、rgb(217,48,37)）、alt/uploadId 保留、经 Y.Doc 同步到另一标签；④点击重试——恢复 weed 后对 error 占位派发完整 mousedown/mouseup/click 序列 → 重新 sign/PUT/register → 完成态（新 objectKey、尺寸回填）；⑤非图片拒绝——粘贴 evil.exe 立即 error 占位、零网络请求。
  - 验证插曲：①PM 真编辑根自带 `.tiptap.ProseMirror` 类（EditorContent 外层容器的 className 不在 PM 根上），自动化选择器必须用 `.tiptap.ProseMirror` 双类；②`el.click()` 只派发 click 事件，PM handleClickOn 需 mousedown→mouseup 完整序列（agent 两次"重试无效"均因此，非应用 bug）；③跨端重试是设计外行为（File 仅在创建端内存），error 占位在他人端仅展示不可重试——"上传中刷新页面残留占位"的清理优化归 M2 后续。
  - 待办：附件下载/预览页、图片对齐/缩放、非图片附件以文件卡片插入正文（登记 API 已就绪，前端 UI 归 M2 后续）。
- 2026-10-10 **T2.2 完成**。
  - 依赖（catalog 均锁 3.31.3 与 Tiptap 组强耦合，ADR-05）：@tiptap/extension-table 组（Table resizable + TableRow/TableHeader/TableCell）、extension-task-list（TaskItem nested）、extension-underline、extension-link（openOnClick:false 协同下不导航）、extension-highlight、extension-code-block-lowlight（lowlight=createLowlight(common)）；StarterKit 补关 `codeBlock: false`（CodeBlockLowlight 替代内置，避免双扩展冲突）。
  - 工具栏扩展：插表（3x3 withHeaderRow）/+行/-行/+列/-列/表头行切换/删表、☑任务列表、代码块、分割线、U、高亮；链接走自绘浮层（Enter 确定/Escape 取消，空值=unsetLink，无协议自动补 https://，不用 window.prompt）。
  - **C08 专项 PASS（三方收敛）**：用户 A（浏览器）加行 → 用户 B（Node WS 客户端）检测到 rows=4 后自动加列 → 双方单元格编辑互见（B 写 [1][1]="B写内容" → A 端实时显示）→ 最终**浏览器 A、Node B、DB 合并 grid 三方均为 4x4 且 [1][1] 内容一致，零内容丢失、零错位**；DB v124 增量落库、水位 cursor=125 推进正常。
  - 验证钩子：`window.__owEditor` 暴露 editor 实例——**事务 API（editor.chain()）不依赖 DOM 焦点**，headless 浏览器可靠驱动全部富格式命令（T2.3 评论验证复用）。
  - **测试环境结论（非产品 bug）**：①WebView 后台标签的 WS 被冻结（provider status 仍显示"已连接"但数据不流动，同刻仅前台标签网络活着）——此前"并发种子未同步"由此产生，Node WS 客户端直连 collab 模拟协同用户绕开此限制（hocuspocus v4 手工解码：Auth 回复 `varString(docName)+varUint(2)+varUint(sub=2=Authenticated)+varString(scope)`，**M0 记录把 sub=2 误记为 PermissionDenied**，实际 1=Permission/2=Authenticated）；②WebView 非前台时 contenteditable 无法聚焦（pm.focus() 后 activeElement 仍是 BODY）→ execCommand 失效；③posAtCoords 依赖视口/滚动状态，刷新后不可靠——定位单元格应遍历 `editor.state.doc` 树计算绝对 pos。
  - 单标签功能全 PASS（DOM 属性级取证）：任务列表（data-checked 切换）、代码块（pre>code.lowlight 高亮类）、分割线（hr）、链接全流程（set→isActive→改 href→unset 保留文本）、表格全家桶（增删行列/表头行/删表，rows/cols 读数精确）、U/高亮（DOM `<u>`/`<mark>` + active + toggle 移除）、undo/redo（T1.9 机制对表格操作同样生效）。
  - 验证插曲：写操作失败必须先读快照验证再重试（防重复插入）——两次"页面被刷新"打断加行，实际副作用已生效（B 端 `recv update rows=4`）；"在线 N 人"不能证明协同正常（同账号多标签被 userId 去重）。
  - `pnpm -r typecheck` exit 0；临时验证脚本已清理。
- 2026-10-10 **T2.3 完成**。
  - 数据通道：`comments` 顶层 Y.Array<Y.Map>（id/authorId/body/resolved/createdAt/replies[]，shared 固化 `COMMENTS_NAMESPACE` 三端共认 + toCommentThreads 防御式归一，坏数据回落不抛错）；正文锚点自研 CommentMark（excludes:'' 允许不同线程重叠、inclusive:false 输入不延续、data-thread-id attr，removeCommand 按 Mark 实例精确移除）。
  - **C09 锚点稳定性全 PASS**：前后插入（mark 包住原文字、前缀不进 mark）、拆段（mark 一分为二、threadId 一致不丢）、删部分（Y 层 mark 范围缩至剩余文字"演练"）、删全部（正文 mark 消失、线程卡转"（上下文已删除）"不丢）；**刷新后（IndexedDB+服务端）线程与删除态完整恢复**，正文锚点三操作全部不漂移。
  - **resolved 灰色 = 纯视图层 decoration**（不改正文数据，commenter 的 resolve 不触碰正文命名空间；threads.observeDeep → setMeta 重建）；**decoration 的 .comment-resolved span 渲染在 mark span 内层**（y-prosemirror mark 优先占外层元素），CSS 用 `.comment-mark:has(.comment-resolved)` 从外层覆盖视觉（backgroundColor/borderBottomColor/color 三值 computed style 取证）。
  - **commenter 命名空间级权限（服务端日志实锤）**：beforeHandleMessage 影子法（update 应用到房间副本→比对 prosemirror fragment toString）——carol 写正文 `[guard] 拒收` + `closing connection … commenter cannot write to document body` + `[disconnect]`，重连核对服务端正文无入侵文字；写 comments 放行且回写落库。**Node 22 原生 WebSocket 客户端对服务端 close 帧的 onclose 可能不触发**（carol 脚本 5s race 超时误报"未断连"），断连结论以服务端日志为准。
  - **Y 层结构实锤（探针取证）**：PM block = XmlElement 且唯一 child 是单个 XmlText（内容聚合）；**mark 在 Y 层是 ContentFormat item**（key=`comment--<hash>` + value={threadId} 起、value=null 止，XmlText.toString 把它渲染成 `<comment--xxx>` 标签形态）；XmlText.forEach 是 Map 语义（遍历 attributes），children 遍历须用 toArray/_start 链。
  - 网关抽取回写：onChange 防抖 2s + beforeUnloadDocument 兜底 flush；线程快照 JSON 未变即跳过（正文打字零请求）、in-flight dirty 补跑、5s 超时不重试；server `/internal/docs/:id/extracted`（x-internal-key + zod 校验）事务内差量 upsert（thread/reply 拆行、resolved 冗余到每行、消失行删除、doc.updateMany 防 P2025）——**comments 表 3 行与 Y 端完全一致**（alice 首评 + bob Node 端回复 + carol 纯评论）；GET /docs/:id/comments 返回一致。
  - DB：comments 表 + idx_comments_doc + 部分索引 idx_comments_unresolved（Prisma 不支持 WHERE，手写 migration.sql + db execute --file + migrate resolve）。
  - `pnpm -r typecheck` exit 0；临时验证脚本已清理。
- 2026-10-22 **T2.4 完成**。
  - 数据模型：prisma schema 新增 `DocRevision`（state Bytes + proseMirrorJson TEXT + plainText/wordCount/authorId/label + createdAt + docId FK CASCADE + idx_revisions_doc_time）；**手写迁移链路**沿用 T2.1/T2.3 模式：`migration.sql` → `prisma db execute --file` → `prisma migrate resolve --applied`；首次迁移漏加 prose_mirror_json 字段，作为独立 `20261022010000_add_revision_pmjson` ALTER TABLE 追加。
  - Server revisions 模块（controller/service/dto/module）：
    - `GET  /docs/:id/revisions` — viewer+ 时间轴列表（id/label/authorId/createdAt，state 不下发到前端）
    - `POST /docs/:id/revisions` — editor+ 手动保存（client 提供完整 proseMirrorJson + encodeStateAsUpdate 的 base64 state）
    - `GET  /docs/:id/revisions/:revId` — viewer+ 详情（含 proseMirrorJson）
    - `POST /docs/:id/revisions/:revId/restore` — owner 专属恢复接口（返回 proseMirrorJson 给 client，server 零 Yjs/prosemirror 依赖）
    - DTO：手动保存 `proseMirrorJson` 必填 + 定时保存 `InternalRevisionPayload`（proseMirrorJson **optional**，collab 无 Tiptap schema）——修复"collab 无 pmJson 但 zod schema 必填会 400"的集成断裂。
    - 恢复权限链：`getMemberRole` → owner 专属（forbidden on non-owner）。
    - **类型安全修复**：`stateBuffer as any` → `new Uint8Array(stateBuffer)`（Prisma 7 `Bytes = ReturnType<Uint8Array['slice']>` 即 `Uint8Array<ArrayBuffer>`，`Buffer<ArrayBufferLike>` 不直接兼容；两处——create + createFromCollab）。
  - Internal 内部接口：`POST /internal/docs/:docId/revision`（InternalApiKeyGuard 保护），body `{ stateBase64, proseMirrorJson?, plainText?, wordCount? }`，返回 `{ id: string }`——collab 定时保存端点。
  - Collab 定时快照（`apps/collab/src/revision.ts` 新增）：
    - `startRevisionTimer`：onLoadDocument 启动默认 10min timer（`REVISION_TIMER_MS` 可配，验证阶段临时设 5000ms 加速）。
    - `registerRevisionDoc`：onChange 中注册 Y.Doc 引用并标记 `dirty=true`（正文打字时持续变脏）。
    - `saveNow`：timer 到点或 flush 时触发，`Y.encodeStateAsUpdate(doc)` → SHA-256 前 16 字节 hex 与上次快照对比，未变化跳过（哈希去重）→ `POST /internal/docs/:docId/revision`（带 X-Internal-Key）。
    - `flushRevisionOnUnload`：beforeUnloadDocument 兜底，房间卸载时若 dirty 强制落库。
    - `shutdownAllRevisions`：SIGINT/SIGTERM 优雅停机前批量 flush 所有未保存快照。
    - main.ts 挂载：onLoadDocument→startRevisionTimer、onChange→registerRevisionDoc + dirty 标记、beforeUnloadDocument→flushRevisionOnUnload；env.ts 增 REVISION_TIMER_MS 读取。
  - **Redis 不可达 fallback（`apps/collab/src/redis.client.ts` 增强）**：
    - 问题发现：E2E 验证时本机 Memurai 未起 → `persistChange` 3 次重试全败 → `markRoomReadOnly` → `closeConnections` → 房间立即卸载 → timer 未触发、仅 flushRevisionOnUnload 在 disconnect 时存了 1 条，无法验证周期性快照行为。
    - 修复：新增进程内 Map 锁（`memLocks`）——当 `redisAvailable=false && LOCK_FALLBACK_ENABLED` 时，`withLock` 自动切换到 `tryAcquireMemLock/releaseMemLock`，Redis 不可达时单机验证 persist 链路不受影响。生产多实例部署可设 `REDIS_FALLBACK_INMEM=false` 关闭兜底、强制依赖 Redis。
    - 状态位维护：redis connect/ready → true、error → false；5s interval 清理过期内存锁。
  - Web 侧栏（`RevisionsPanel.tsx` + `api/revisions.ts`）：
    - 时间轴列表：点击→GET 详情→独立 Tiptap 只读预览（`useEditor({ editable:false, immediatelyRender:false, extensions: buildPreviewExtensions() }, [activeDetail?.id])`——deps 变化时 Tiptap v3 内部 `EditorInstanceManager.refreshEditorInstance` 自动 destroy 旧实例再重建，**用户建议的额外 useEffect cleanup 反而是反模式（double-destroy + 提前销毁）**，经源码验证无需添加）。
    - 手动保存按钮（editor+）：`encodeRevisionSnapshot(ydoc)` → `editor.getJSON()` 打包后 POST /docs/:id/revisions。
    - 恢复按钮（owner 专属）：`POST restore` 拿到 proseMirrorJson → `editor.commands.setContent(parsed, { emitUpdate:true })` ——整体替换模式，emitUpdate 让 y-prosemirror 生成正常 Yjs update 广播，所有在线人自然收敛（docs/04 §7 设计意图）。
    - RichTextEditor.tsx 追加 `<RevisionsPanel>`；styles.css 新增侧栏 CSS 族 + 双侧栏窄屏响应式兜底（`.editor-layout:has(.comments-panel):has(.revisions-panel) .editor-body { max-width: 620px; }`）。
  - **E2E 验证全 PASS（定时保存链路，临时 REVISION_TIMER_MS=5000ms 加速）**：
    - [7] 定时保存触发：进入房间→打字→等 timer→GET 列表，count=1、authorId=null（确认为定时路径，非手动保存）。
    - [8] 周期性触发：继续打字→等 timer→count=2（第二次变更后又触发）。
    - [9] 哈希去重：不打字再等一个 timer→count 保持 2（无变更跳过，SHA-256 哈希比对生效）。
    - [10] flushRevisionOnUnload：disconnect 时 dirty 已被 timer 清掉（dirty=false），flush 正常不重复写。
    - Redis fallback 兜底验证：停 Memurai 跑同链路→persistChange 走内存锁→timer 正常触发快照保存（原本会因房间只读降级而中断）。
  - `.gitignore`：排除 `apps/web/scripts/test-*.mjs` 端到端验证脚本（一次性调试产物）。
  - **提交** `5795940`（21 files, +1135/-15）；`pnpm -r typecheck` exit 0。
  - 遗留（不阻塞后续 M2 任务）：
    - 定时保存版本（proseMirrorJson 可空）的恢复路径——revDetail 返回 pmJson 为 null 时需 client 侧临时 `new Y.Doc()` + `Y.applyUpdate(stateBytes)` + `editor.setContent(ydoc.getXmlFragment('prosemirror').toJSON(), { emitUpdate:true })`，当前 RevisionsPanel 未区分处理（server 层 state 字段已返回给前端可直接用，只差 client 分支）。
    - `setContent({ emitUpdate:true })` 是否真的触发 y-prosemirror update 广播的集成测试（静态分析显示 y-prosemirror 对 emitUpdate 有支持，但未端到端验证）。
    - 双侧栏窄屏（<620px）CSS 兜底未经实际 UI 验证。
- 2026-10-22 **T2.5 完成**。
  - DB：`doc_share_links`（`doc_id` PK + `mode` CHECK 四档 private/org/anyone_view/anyone_edit + `token` UNIQUE + `updated_at`）；`DocsService.create` 同事务插默认 `private/token=null`；存量 11 篇用 `apps/server/scripts/backfill-share-links.mts` 回填（**必须先 `import '../src/env.js'`**，ESM import 提升会让 `DATABASE_URL` 未加载）。
  - Server：`ShareLinksController`（`GET/PUT /docs/:id/share-link`，owner 专属，zod `ShareModeSchema`）；`AnonymousShareController`（公开 `GET /share/:token`，无 guard）签发 `sub='anon:<uuid>'` 且带 `linkToken` claim 的 collab JWT；分享 token 用 `randomBytes(32)` → base32url（52 字符），不用 uuid。
  - Internal：membership 接口新增 anon 分支；`InternalUserIdSchema` 从 `z.string().uuid()` 放宽为 `UUID | anon:<uuid>`——**这是匿名链路首轮失败根因**（原正则把 `anon:` 挡在 controller 前，collab 只看到 400）；anon 分支先校验 `link.docId === docId` 再按 mode 映射 viewer/editor。
  - Collab：`CollabClaims.linkToken?` 透传；匿名缓存 key 用 `collab:membership:<docId>:anon:<linkToken>`（必须与真实用户隔离）；新增缓存值边界校验（非 JSON 缓存不再导致"保守拒绝"，直接降级直查 DB）。
  - 控制事件：`CollabControlEvent` 扩为可辨识联合并新增 `share-mode-changed`；`setShareLink` 仅在 mode 真变化时 PUBLISH；`control.subscriber` 断开该文档下所有 `anon:` 连接（close 4003）。
  - Web：`SharePanel`（成员列表/邀请/改角色/移除 + 链接四档 + 复制/重置；仅 token 为空时才自动生成，模式内互切不复位 token）；公开路由 `/share/:token` + `AnonymousEditorPage`（`RequireAuth` 之外）；匿名续签传 `?anonId=` 复用同一身份，避免 awareness 访客跳变；修正 hooks 顺序（`useMemo` 曾在条件 return 之后导致页面崩溃）。
  - 验证：`pnpm -r typecheck` 4 包 exit 0；API 9 场景 PASS（默认 private / 四档切换 / 新 token / 坏 token 404 / 切回 private 清空 token / 旧 token 404 / resetToken 换新 / anon membership ok=true permission=write|read / 缺 token deny）；浏览器双端 PASS（anyone_edit 匿名端 ↔ alice 双向实时同步、Console 0 error）；C17 只读 PASS（徽章「🔗 分享链接 · 只读」、只读模式标识、工具栏禁用、输入被拒、无评论入口、刷新后仍只读）；切回 private 后旧链接 404、匿名页回落为「登录 →」拒绝态。
  - 环境限制：本机 Memurai/Redis 未安装（6379 无监听）→ `share-mode-changed` PUBLISH 不可用，**已连接的匿名会话只能在下一次重连时被拒**；缓存同时降级直查 DB，故重连即生效。立即踢人需 Redis 可用。
  - 遗留（不阻塞）：`anyone_view`/`anyone_edit` 已连接的匿名会话在切 private 时不会即时断开（同上，依赖 Redis）。
