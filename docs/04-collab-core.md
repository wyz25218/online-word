# 04 · 协同核心链路（Yjs / Hocuspocus）

## 1. 客户端初始化顺序（顺序错误会出现空文档覆盖）

```
new Y.Doc()
 → IndexeddbPersistence(docId, ydoc)     // 先挂本地缓存：离线可编辑 + 秒开
 → new HocuspocusProvider({ document: ydoc, ... })  // 再连服务端
 → Tiptap 扩展 Collaboration.configure({ document: ydoc })
 → CollaborationCursor.configure({ provider, user })
 → useEditor(...)  // 最后创建编辑器
```
禁止在 sync 完成前用 `editor.commands.setContent()` 主动灌内容——本地与远端都可能已有内容，灌入即产生非预期 update。

---

## 2. Hocuspocus 网关骨架（apps/collab）

```ts
import { Server } from '@hocuspocus/server'
import { Redis } from '@hocuspocus/extension-redis'
import * as Y from 'yjs'
import { docStore } from './doc-store'          // 快照/增量/压缩（见 03 文档）
import { authService } from './auth'            // 调业务后端验权 + Redis 短 TTL 缓存
import { kickSubscriber } from './kick'         // 订阅 server 发来的踢人指令

const server = Server.configure({
  port: 8080,
  extensions: [new Redis({ host: process.env.REDIS_HOST })],

  async onAuthenticate({ token, documentName }) {
    const result = await authService.verify(token, documentName) // {permission,user}
    if (result.permission === 'none') throw new Error('FORBIDDEN')
    return { user: result.user, permission: result.permission }  // 进入 context
  },

  async onLoadDocument({ documentName, document }) {
    const state = await docStore.loadState(documentName) // 快照+增量合并
    if (state) Y.applyUpdate(document, state)
    await kickSubscriber.ensureRoom(documentName)
    return document
  },

  async onChange({ documentName, document, update, context }) {
    // 双保险：广播后、落库前再次确认权限
    if (context.permission !== 'write') return
    await docStore.appendUpdate(documentName, update, context)
  },

  async onStoreDocument({ documentName, document }) {
    await docStore.compactIfNeeded(documentName, document)
  },

  async onDestroy({ documentName, document }) {
    // 房间最后一人离开：强制压缩一次，防止停服窗口丢数据
    await docStore.forceCompact(documentName, document)
  },
})

server.listen()
```

`context.permission === 'read'` 时：Hocuspocus 配置 `requiresBroadcastAuthentication` 同类策略，并在 onChange 中丢弃写入；前端同步置 `editor.setEditable(false)`。

---

## 3. 鉴权链路

```
登录：server 签发短期 JWT（payload: userId/name/role 等，TTL 15min，配 refresh token）
打开文档：
  web → GET /collab/token?docId → server 校验业务权限 → 返回可用的 WS token
连接：wss://collab/collaboration/{docId}?token=xxx
网关 onAuthenticate：
  1) JWT 验签
  2) 查 Redis 缓存 auth:{docId}:{userId}（TTL 60s）
  3) 未命中 → 调 server 内部接口 GET /internal/docs/:id/membership
     返回 { permission, user } 并写缓存
  4) permission=none → 拒绝连接
```
- commenter 角色：文档只读，但允许写"评论通道"。评论作为独立的顶层 Y.XmlFragment/Y.Array 命名空间（见第 6 节），网关在 onChange 中按命名空间 + 角色做粒度判断。
- 权限缓存必须短 TTL，保证降权最长 60s + 主动踢人立即生效。

### 中途踢人
```
server 权限变更 → Redis PUBLISH collab:kick:{docId} { userId, newRole }
网关每个房间一个 subscriber：
  匹配到连接 → 发送 awareness/control 提示 → instance.closeConnection(socketId)
```

---

## 4. 多实例与分布式一致性

- `@hocuspocus/extension-redis` 负责跨实例 change/awareness 广播，网关自身可水平扩展、无状态（房间内存态可在不同实例重建）。
- 持久化竞争（两个实例同时持有同房间连接的极端情况）由 `doc_updates UNIQUE(doc_id,version)` + `SELECT ... FOR UPDATE` 水位表 + Redis 锁三重防护，见 [03-data-model.md](./03-data-model.md) 第 4 节。
- 推荐"房间亲和"：同一 docId 经负载均衡层（如按 room name 哈希的 sticky session / Redis 房间指派）尽量路由到同一实例，减少跨实例广播量；亲和失效不影响正确性。

---

## 5. Awareness（在线状态）协议

字段（`packages/shared` 中固化，三端共认）：
```ts
{
  user: AwarenessUser,          // userId/name/color/avatar/role
  cursor: { anchor: number, head: number } | null, // ProseMirror 可定位位置
  lastUpdate: number            // 时间戳，用于超时清理
}
```
规则：
- 颜色板按 `userId` 哈希稳定取色，同一用户在各文档颜色一致。
- 同一账号多标签页：clientID 不同会显示多个光标点——UI 层按 userId 聚合展示头像（光标可都保留，但"在线人数"按 userId 去重）。
- awareness 是瞬时消息，**不落库、不进 Y.Doc**；用户断线 30s 后由 y-protocols 的超时机制自动清除。
- 连接状态 UI 三态：`connected / disconnected（重连中）/ 权限失效`，由 provider 的 `onStatus/onSynced/onAuthenticationFailed/onDisconnect` 驱动 zustand。

---

## 6. 评论数据通道（随文档同步，位置不漂移）

- 文档内：自研 `CommentMark`（prosemirror mark，属性 `threadId`）包裹被评论文本。锚点是文档内容的一部分，随 CRDT 自动跟随移动，不存易失效的数字 offset。
- 线程数据：在同一 `Y.Doc` 中使用**独立命名的顶层类型**：
  ```ts
  const threads = ydoc.getArray<Y.Map<unknown>>('comments')
  ```
  线程对象含 id、authorId、body、resolved、createdAt、reply 列表。
- 业务冗余：网关 onChange/onStore 时把 threads 快照通过内部接口同步到 server 的 `comments` 表（server 做 upsert + 通知/未读数计算）。**写 comments 表的动作只能由 server 执行。**
- 权限：viewer 不可见评论入口；commenter 仅允许对 `comments` 命名空间产生 update，文档正文命名空间只读。
- 解决评论：标记 `resolved=true`，UI 折叠为灰色标记，不物理删除（保留审计与上下文）。

---

## 7. 版本恢复的正确姿势

错误做法：`ydoc.getXmlFragment('prosemirror').delete(0, length)` 后重建——其他在线客户端会先同步到"全删"再同步到"新内容"，闪烁且产生巨大更新。

正确做法：
```
1. 从 doc_revisions 取目标 state，在临时 Y.Doc 中 Y.applyUpdate
2. 转换为 ProseMirror Node（用共享 schema）
3. 在当前编辑器中以一次事务整体替换：
   editor.commands.setContent(node, { emitUpdate: true })
   —— 该事务经 y-prosemirror 映射为正常 Yjs update 广播
4. 所有人自然收敛；该次替换天然进入后续版本历史（可追溯"谁在何时恢复"）
```

---

## 8. 离线与撤销栈

- `y-indexeddb` 提供本地持久化；provider 重连后通过 sync 协议自动双向追平，业务无需手写冲突解决。
- 撤销：使用 `y-prosemirror` 内置 `undoManager`，默认按本地客户端 origin 过滤，`undo()` 只回滚自己的操作（含离线期间自己的操作），不会动他人内容。
- 长时间离线（跨小时/跨天）重连时的极端情况：若服务端文档已被压缩且本地 update 所引用的结构已被 GC 删除，依赖 Yjs 的删除墓碑容错（GC 不会破坏因果合并）；M3 压测需专门覆盖"离线 24h + 期间他人大量删除"用例。

---

## 9. 大文档策略

- 同步层：y 同步协议按状态向量只传差异；首屏 `onSynced` 前展示骨架屏，不要阻塞渲染等待"完整历史"。
- 图片：节点只存 URL，懒加载；粘贴/拖入统一走上传拦截器（见 [05-frontend-react.md](./05-frontend-react.md)）。
- 10 万字以上文档：M3 评估 ProseMirror 节点级渲染优化（分页/视口渲染的社区方案），不提前优化。
- 二进制大小纳入监控（见 [03 文档第 5 节](#5-快照压缩compaction)）。
