# 02 · 技术选型与工程规范

## 1. 选型总表

| 层 | 技术 | 版本基线（安装时精确锁定） | 用途 |
|---|---|---|---|
| 语言 | TypeScript | **7.0.2**（T0.1 锁定；M1 引入 NestJS/Prisma 时验证，不兼容则回退 5.6 最新） | web/server/collab/shared 同版本 |
| 运行时 | Node.js | **22.18.0 LTS**（T0.1 实际环境，`.nvmrc=22`；engines 要求 `>=20`） | server 与 collab 运行时 |
| 包管理 | pnpm | **9.15.9**（corepack 安装） | workspace + catalog，见第 3 节 |
| UI 框架 | React | **19.3.0**（T0.1 自基线 18.3.1 调整；Tiptap v3 peer 支持 ^19） | |
| 构建 | Vite | **8.3.0** | web 开发/构建 |
| 路由 | react-router | 6.26+ | |
| 服务端状态 | @tanstack/react-query | 5.x | 文档列表/权限/评论等 REST 数据 |
| 客户端状态 | zustand | 4.5+ | 编辑器 UI 状态、连接状态、当前用户 |
| 样式 | Tailwind CSS | 3.4（先不升 v4，避免配置体系变动） | |
| 编辑器 | Tiptap | **v3 全线 3.31.3**（`@tiptap/react|pm|core|starter-kit|extension-*` 同版本）；**cursor 包例外锁 3.0.0**（其 npm latest 标签仍是 v2 的 2.26.2，切勿裸装） | 见第 2 节扩展清单 |
| 协同内核 | yjs | 13.6.32 | CRDT |
| 协同协议 | y-protocols / y-prosemirror | 1.0.7 / 1.3.7 | awareness/sync；cursor@3.0.0 的 peer 仍为上游 y-prosemirror |
| v3 绑定 fork | @tiptap/y-tiptap | 3.0.9 | collaboration@3.31.3 自动依赖（v3 从 y-prosemirror fork） |
| 本地持久化 | y-indexeddb | 9.0.12 | 离线/秒开 |
| 协作服务 | @hocuspocus/server | **4.7.0** | WS 网关 |
| WS 客户端 | @hocuspocus/provider | 4.7.0 | |
| 多实例 | @hocuspocus/extension-redis | 与 server 同版本（M3 接入） | Pub/Sub |
| 业务后端 | NestJS | 10+ | |
| ORM | Prisma | 5.x | |
| 数据库 | PostgreSQL | 15+ | bytea / tsvector |
| 缓存/锁/广播 | Redis | 7+ | |
| 对象存储 | MinIO（dev）/ S3 兼容（prod） | — | 图片附件 |
| 测试 | Vitest + Playwright | 最新稳定线 | 单测/双浏览器协同 E2E |
| 代码规范 | ESLint flat config + Prettier | — | CI 门禁，见 08 文档 |

> 版本纪律：上表"基线"仅用于兼容性判断。**实际安装一律 `pnpm add -E`（exact）写入精确版本**，由 pnpm `catalog` 统一管理；禁止 `^`/`~`，尤其是 `@tiptap/*`、`yjs`、`y-prosemirror`、`@hocuspocus/*` 这几组强耦合包，必须版本互相兼容、一起升级。M0 搭建时把锁定结果回填本文件。

---

## 2. Tiptap 扩展引入清单（按阶段）

原则：**最小扩展集先行**，每阶段只引入当阶段需要的扩展，不一次性搬运全家桶。

| 阶段 | 扩展 | 说明 |
|---|---|---|
| M0 | `@tiptap/react` `@tiptap/pm` `@tiptap/starter-kit` `@tiptap/extension-placeholder` | 基础编辑 |
| M0 | `@tiptap/extension-collaboration` | 协同（y-tiptap fork）；StarterKit 必须 `undoRedo: false` |
| M0 | ~~`@tiptap/extension-collaboration-cursor`~~ | **M0 已移除**：cursor@3.0.0 依赖 y-prosemirror 的 `ySyncPluginKey`，与 collaboration@3.31.3 使用的 @tiptap/y-tiptap plugin key 冲突，导致 `createDecorations` 崩溃。M0 用 awareness 自实现在线用户列表；精确远程光标 M1 基于 @tiptap/y-tiptap 自实现 |
| M1 | `@tiptap/extension-character-count` | 字数统计 |
| M2 | `@tiptap/extension-image` `@tiptap/extension-link` `@tiptap/extension-table`（及其 row/cell/header）`@tiptap/extension-task-list`/`task-item` `@tiptap/extension-code-block-lowlight` `@tiptap/extension-mention` `@tiptap/extension-underline` `@tiptap/extension-highlight` `@tiptap/extension-horizontal-rule` | Word 类能力 |
| M2 | 自研 `CommentMark` 扩展 | 评论锚点随 Y.Doc 同步 |
| M4 | 自研 `TrackChanges` 系列 mark | 修订模式 |

注意：
- 协同模式下撤销/重做使用 y-prosemirror 的 `undoManager`（collaboration 扩展内置），**不要开启 StarterKit 自带 undoRedo**（Tiptap v3 中 `history` 改名为 `undoRedo`，设 `undoRedo: false`），否则会撤销他人内容。
- `@tiptap/y-tiptap` 的 `yUndoPlugin` 默认 `trackedOrigins=[ySyncPluginKey]`，仅追踪本地编辑事务，因此 undo 只回滚自己的字符（C06 验证通过）。
- 自定义命令必须声明专用 Options 接口（不要用 `Record<string, unknown>` 解构），以满足 strict 类型检查。

---

## 3. pnpm monorepo 规范

### 3.1 目录结构
```
online-word/
├─ pnpm-workspace.yaml
├─ package.json                 # 根：仅放公共 scripts，不放运行时依赖
├─ tsconfig.base.json           # 严格配置（strict + noUncheckedIndexedAccess）
├─ .nvmrc                       # 22
├─ docker-compose.yml           # postgres / redis / minio（M1 起使用）
├─ apps/
│  ├─ web/                      # React + Vite
│  ├─ server/                   # NestJS 业务后端
│  └─ collab/                   # Hocuspocus 协作网关
└─ packages/
   └─ shared/                   # 共享类型：角色枚举、AwarenessUser、DTO、WS 事件
```

### 3.2 pnpm-workspace.yaml（版本中枢）
```yaml
packages:
  - 'apps/*'
  - 'packages/*'

# 全仓版本统一在这里锁定；应用内写 "catalog:" 引用
catalog:
  typescript: 5.6.x   # 安装时替换为精确版本
  react: 18.3.1
  react-dom: 18.3.1
  # @tiptap/* 全部使用同一精确版本号
  yjs: 13.6.x
```
应用 package.json 中：
```json
{ "dependencies": { "react": "catalog:", "yjs": "catalog:" } }
```

### 3.3 根 package.json scripts（规划）
```json
{
  "scripts": {
    "dev:web": "pnpm --filter web dev",
    "dev:server": "pnpm --filter server start:dev",
    "dev:collab": "pnpm --filter collab dev",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test"
  }
}
```

### 3.4 Windows + pnpm 注意事项（来自既有项目教训）
1. **M0/M1 不引入 simple-git-hooks、husky 等依赖安装期钩子**：prepare 阶段钩子配置缺失会让所有成员 `pnpm install` 失败。需要提交门禁时，以独立任务接入并先在 Windows 与 CI 双端验证。
2. `pnpm-lock.yaml` 必须提交，保证 CI 与全员拿到完全一致的依赖树。
3. 脚本串联使用 `&&`（PowerShell 7+ 支持）；避免在 npm scripts 中使用 `rm`/`cp` 等 POSIX 命令，删除/拷贝用 Node 脚本（如 tsx 脚本）完成。
4. TypeScript 开启 `noUncheckedIndexedAccess` 后，数组/对象索引结果必须先取局部变量再做空值守卫，禁止用 `!` 非空断言压制。
5. 若使用 scoped 内部 registry，根目录提供 `.npmrc` 模板但不提交个人凭证。

---

## 4. 共享类型包 packages/shared（M1 建立）

```ts
// 角色与权限
export type DocRole = 'owner' | 'editor' | 'commenter' | 'viewer'
export type LinkShare = 'private' | 'org' | 'anyone_view' | 'anyone_edit'

// Awareness 在线用户字段（字段名即协议契约，改动需三端同步）
export interface AwarenessUser {
  userId: string
  name: string
  color: string        // 光标颜色，由 userId 哈希取色板
  avatar?: string
  role: DocRole
}

// 网关注入连接上下文
export interface CollabContext {
  user: AwarenessUser
  permission: 'read' | 'write'
}

// 网关 ↔ 业务后端验权响应
export interface AuthResult {
  ok: boolean
  permission: 'read' | 'write' | 'none'
  user: AwarenessUser
  ttlMs: number
}

// 版本恢复等内部 WS 指令
export type ServerSignal = { type: 'force-disconnect'; reason: string }
```
