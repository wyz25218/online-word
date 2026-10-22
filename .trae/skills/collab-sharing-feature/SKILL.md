---
name: collab-sharing-feature
description: 在 online-word 这类 NestJS + Hocuspocus(collab) + React 的多服务协同项目里，新增"跨服务双向交互功能"（分享链接、评论协同、版本协同等）的标准落地流程。当任务涉及"新增一种文档访问权限/分享方式""跨 server 与 collab 两个进程的权限事件""新的公开匿名入口"时使用。
---

# 跨服务协同功能落地流程（online-word）

本 skill 固化 T2.5「分享与链接」实现中验证过的模式：**shared 契约 → DB → server API → internal 鉴权扩展 → collab 透传 → 控制事件 → 前端路由/面板 → 端到端验证**。

按顺序执行，每一步都可独立 typecheck，避免错误累积。

---

## 0. 先确认基础设施状态

```powershell
netstat -ano | findstr ":5173 :3000 :8080" | findstr LISTENING
```

- 3000 = server(NestJS)，8080 = collab(Hocuspocus)，5173 = web(Vite)
- 改完 shared 包的类型后，**必须** `pnpm --filter @online-word/shared build`，否则下游 tsc 读到的是旧 dist，类型报错会假阳性/假阴性
- Redis 不可用时 membership 缓存会自动降级直查 DB，不影响功能验证

---

## 1. shared 契约先行

在 `packages/shared/src/types.ts` 定义新概念的类型，再 build。

跨进程控制事件用**可辨识联合（discriminated union）**扩展，不要新增平行的接口：

```ts
export type CollabControlEvent =
  | { docId: string; userId: string; action: 'membership-changed' }
  | { docId: string; userId?: string; action: 'share-mode-changed' }
```

要点：
- 新增分支时必须保留旧分支的字段形状，否则 collab 侧 `JSON.parse` 后的窄化会失效
- 权限档位用字面量联合（`'private' | 'org' | 'anyone_view' | 'anyone_edit'`），前后端共用，不写字符串常量两份

---

## 2. DB：迁移 + Prisma + 建行事务 + 回填

1. 迁移目录 `apps/server/prisma/migrations/<timestamp>_<name>/migration.sql`，用 `CREATE TABLE IF NOT EXISTS`（避免重跑失败留下 failed 状态）
2. 表约束尽量落到 SQL：`CHECK (mode IN (...))`、`UNIQUE`、`REFERENCES ... ON DELETE CASCADE`
3. Prisma model：
   - 一对一关系用 `docId String @id @map("doc_id")`
   - `@updatedAt` + `@map` 对应 `updated_at`
   - 反向关系在 Doc 上加可空字段 `shareLink DocShareLink?`
4. **创建实体时在同一事务内插入默认行**（不要留给读取路径兜底）：

```ts
const doc = await prisma.$transaction(async (tx) => {
  const created = await tx.doc.create({ data: { title, ownerId } })
  await tx.docMember.create({ data: { docId: created.id, userId, role: 'owner' } })
  await tx.docShareLink.create({ data: { docId: created.id, mode: 'private', token: null } })
  return created
})
```

5. 存量数据回填脚本放 `apps/server/scripts/*.mts`，**必须先 import `../src/env.js`**（ESM import 提升，否则 `DATABASE_URL` 未加载）：

```ts
import '../src/env.js'
import { prisma } from '../src/prisma.js'
```

运行：`node "node_modules/.pnpm/tsx@<ver>/node_modules/tsx/dist/cli.mjs" apps/server/scripts/xxx.mts`

迁移失败处理（Prisma 会锁住后续 migrate）：`npx prisma migrate resolve --rolled-back "<name>"` 后修正 SQL，不要 `db push`。

---

## 3. Server：owner 专属 CRUD + 公开匿名入口

### 3.1 受保护资源

- 控制器路由 `@Controller('docs/:id/share-link')` + `@UseGuards(JwtAuthGuard)` + `@requireRole('owner')`
- 入参用 zod：`ShareModeSchema = z.enum([...])`，配合全局 `ZodValidationPipe`
- 不要用 `@Body() dto: any`；模式切换请求体允许 `resetToken?: boolean`

### 3.2 公开端点（无 guard）

- 路由 `@Controller('share')`，`GET /share/:token`
- **绝不**加 `JwtAuthGuard`；安全性完全由 token 本身承担
- token 生成：`randomBytes(32)` → base32url（52 字符），不要用 `uuid()`（熵不足、前缀可枚举）
- 响应必须只暴露必要字段：`docId / docTitle / mode / anonymousUser / collabToken / expiresIn`
- 错误语义：token 不存在 → 404；模式为 private/org → 403；文档已删 → 404

### 3.3 匿名 JWT

```ts
new SignJWT({ use: 'collab', docId, name, linkToken })
  .setSubject(`anon:${randomUUID()}`)
  .setExpirationTime(nowSec() + collabTtl)
```

- `sub` 用 `anon:` 前缀与真实用户 UUID 隔离
- 把 token（或等价的授权凭证）作为 **claim** 透传，而不是把权限写进 JWT——模式变更才能实时生效
- 续签端点接受可选 `?anonId=`，复用它签新 JWT，否则 awareness 里的访客会在续签时"变成另一个人"

---

## 4. internal 鉴权接口扩展（最易踩坑的一步）

`apps/server/src/internal/internal.controller.ts` 的 membership 接口是 collab 的鉴权唯一来源。新增身份类型时：

1. **放宽 DTO 正则**——这是最容易漏的坑。原 `InternalUserIdSchema = z.string().uuid()` 会直接把 `anon:xxx` 挡在 controller 之前，返回 400，collab 只看到 "membership 接口返回 400"：

```ts
export const InternalUserIdSchema = z.string().min(4).max(80)
  .refine((v) => UUID_REGEX.test(v) || ANON_USER_REGEX.test(v), { message: '...' })
```

2. 在 controller 里**先分支再查库**，不要让 anon 身份落到 `doc_members` 查询：

```ts
if (userId.startsWith('anon:')) return this.handleAnonymous(docId, userId, linkToken)
const role = await this.permissions.getMemberRole(docId, userId)
```

3. 匿名分支必须校验 **token 与 docId 的一致性**（`link.docId !== docId` → deny），防止拿 A 文档的 token 访问 B 文档
4. 返回体保持 `{ ok, permission, user: {userId,name,color,role}, ttlMs }` 不变，collab 侧零改动即可复用

---

## 5. collab 侧：透传 claim + 缓存键隔离

`apps/collab/src/auth.service.ts`：

- JWT claims 接口加可选字段（`linkToken?: string`），验签逻辑不动
- 查询参数用 `URLSearchParams` 拼接，并 `encodeURIComponent`
- **缓存键必须区分身份变体**，否则不同匿名凭证会互相命中错误权限：

```ts
const cacheKey = linkToken
  ? `collab:membership:${docId}:anon:${linkToken}`
  : `collab:membership:${docId}:${userId}`
```

---

## 6. 控制事件：变更即时生效

权限/模式变更后必须让已建立的连接失效，否则会出现"改成私有后匿名用户还能继续写"的安全缺口。

server 端（写库成功后）：

```ts
await redis.publish(collabControlChannel(docId), JSON.stringify({ docId, action: 'share-mode-changed' }))
```

collab 端 `control.subscriber.ts` 按 action 分支，遍历 `hooks.getConnections(docId)` 后 `conn.close({ code: 4003, reason })`。

要点：
- `close` 用自定义码 **4003**，前端可识别为"权限变更被断开"
- PUBLISH 用 try/catch 包住，失败只记日志不阻断写库（60s 缓存过期是兜底）
- 只在 `existing.mode !== mode` 时才发事件，避免无变更也踢人
- 事件是"广播到 docId 房间"，筛选条件写清楚（如 `uid.startsWith('anon:')`）

---

## 7. 前端：API 封装 → 组件 → 公开路由

### 7.1 api 层

- 受保护接口统一走 `apiFetch`（自带 401 续签重放）
- 公开接口（匿名分享）**不要**走 `apiFetch`，直接 `fetch`，不加 Authorization 头

### 7.2 分享面板类组件

- 用 `@tanstack/react-query` 的 `useQuery` + `useMutation`，成功后 `invalidateQueries`
- 模式下拉的 `onChange` 必须先判 `if (mode === share.mode) return`
- **只有 token 为空时才自动生成**；用户主动重置必须点独立按钮并二次确认，否则误操作会让已复制出去的链接立刻失效
- mutation 失败要渲染错误提示，不能静默
- 覆盖层加 `Escape` 关闭 + 点击遮罩关闭，面板本体 `stopPropagation`

### 7.3 公开路由

```tsx
<Route path="/share/:token" element={<AnonymousEditorPage />} />
```

必须在 `RequireAuth` 之外（同级，不是子路由）。

---

## 8. React Hooks 硬约束（本项目已踩过）

**所有 hooks（useQuery / useMemo / useCallback / useRef / useEffect）必须写在任何条件 `return` 之前。**

匿名页典型错误写法：

```tsx
if (query.isPending) return <Load />   // ❌ 提前 return
const user = useMemo(...)              // 后续渲染 hooks 数量变化 → 崩溃
```

正确做法：把依赖 `query.data` 的 `useMemo` 提前，内部 `if (!data) return null`，渲染处再判 `data` 非空。

---

## 9. 验证清单（必须实际跑，不能只靠 typecheck）

### 9.1 类型

```powershell
pnpm -r typecheck
```

4 个包全绿才继续。

### 9.2 API 冒烟（PowerShell，注意 curl 是 Invoke-WebRequest 别名，别用）

```powershell
$login = Invoke-RestMethod -Uri "http://localhost:3000/auth/login" -Method POST `
  -ContentType "application/json" -Body '{"username":"alice","password":"alice123"}'
$h = @{ authorization = "Bearer $($login.accessToken)" }
Invoke-RestMethod -Uri "http://localhost:3000/docs/$docId/share-link" -Headers $h
```

必须覆盖的用例：
1. 默认态为最严权限（private）
2. 切到开放态自动产出 token
3. 公开端点用有效 token → 200，且身份/权限正确
4. 无效 token → 404
5. 切回最严权限 → token 被清空
6. 用旧 token 访问 → 403
7. internal membership 用 `anon:<uuid>` + token → `ok:true`，permission 正确
8. internal membership 缺 token / 错 token → `ok:false`
9. resetToken 确实产生不同 token

internal 接口本地调试的 key：从 `apps/server/.env` 读 `INTERNAL_API_KEY`（当前 dev 值为 `dev-internal-key`），请求头 `x-internal-key`。

### 9.3 浏览器双端

用 browser_use 子代理，两个标签：匿名链接 + 登录态进同一文档，互相对打文字，确认双向同步且 Console 无红色 error。

若失败，先看 collab 日志里的 `membership 接口返回 4xx`——90% 是第 4 步的 DTO 正则没放宽。

---

## 10. 收尾

- 删除临时调试脚本（`debug-env.mts` 之类）
- 迁移文件保留一份（不要在 `prisma/migrations` 留失败目录）
- 回填脚本保留在 `apps/server/scripts/`，供其他环境复用
