# 06 · 业务后端（apps/server）与 API 清单

## 1. NestJS 模块划分

```
apps/server/src/
├─ auth/             # 登录、JWT 签发/刷新、WS token
├─ users/
├─ docs/             # 文档 CRUD、软删除、列表（含搜索）
├─ permissions/      # 成员、角色、链接分享、踢人（发 Redis 指令）
├─ comments/         # 评论冗余、未读数（数据源仍为 Y.Doc，这里只做查询/通知）
├─ revisions/        # 版本列表、恢复入口、定时版本任务
├─ attachments/      # 上传签名直传、元数据登记
├─ import-export/    # docx 导入导出（调度转换服务）
├─ collab-internal/  # 仅内网：网关验权、current_version 回写、评论抽取回写
└─ infra/            # Prisma、Redis、MinIO、消息通知
```

权限判定集中在 `permissions` 模块导出的 `requireRole(minRole)` Guard，角色优先级：
`owner > editor > commenter > viewer`。

| 能力 | owner | editor | commenter | viewer |
|---|---|---|---|---|
| 浏览 | ✅ | ✅ | ✅ | ✅ |
| 编辑正文 | ✅ | ✅ | ❌ | ❌ |
| 评论 | ✅ | ✅ | ✅ | ❌ |
| 管理成员/链接 | ✅ | ❌ | ❌ | ❌ |
| 恢复历史/删除 | ✅ | ❌ | ❌ | ❌ |

---

## 2. API 清单（REST，JSON 除上传/导出外）

### 认证
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /auth/login | 登录，返回 accessToken(15m) + refreshToken |
| POST | /auth/refresh | 刷新令牌 |
| GET | /collab/token?docId= | 打开文档前换取 WS 用 token（内含 docId 约束） |

### 文档
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /docs | 列表：分页、关键字（M3 走搜索）、排序 updatedAt |
| POST | /docs | 新建：事务内写 docs/doc_members(owner)，并初始化空快照记录（供网关读取基线） |
| GET | /docs/:id | 元数据 + 我的角色 + 在线与否标志（在线需查 Redis 房间） |
| PATCH | /docs/:id | 标题等（仅 owner/editor 可改标题） |
| DELETE | /docs/:id | 软删除（owner） |

### 权限与分享
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /docs/:id/members | 成员列表 |
| POST | /docs/:id/members | 邀请 `{userId/email, role}`（owner） |
| PATCH | /docs/:id/members/:userId | 修改角色（owner）；变更后发布踢人/降权 Redis 指令 |
| DELETE | /docs/:id/members/:userId | 移除（owner，不能移除 owner） |
| GET | /docs/:id/share-link | 查看链接分享模式/token |
| PUT | /docs/:id/share-link | `{mode}` 四档：private/org/anyone_view/anyone_edit |

### 版本
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /docs/:id/revisions | 版本列表（id、author、label、字数、时间） |
| POST | /docs/:id/revisions | 手动保存版本（服务端从网关取当前 state 生成） |
| GET | /docs/:id/revisions/:revId | 版本内容（只读渲染用 JSON/HTML，不直接回传二进制给前端） |
| POST | /docs/:id/revisions/:revId/restore | 恢复：校验 owner → 通知网关执行"整体替换更新"（见 04 文档第 7 节） |

### 评论（服务端视图，用于通知/未读/跨文档检索）
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /docs/:id/comments | 线程列表（支持 unresolvedOnly） |
| （写入无独立 API） | — | 创建/回复/解决在 Y.Doc 内完成，由网关抽取后经内部接口回写 |

### 附件
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /upload/sign | `{filename, contentType}` → `{uploadUrl, publicUrl, objectKey}` |
| POST | /docs/:id/attachments | 直传完成后登记 `{objectKey, size}` |
| GET | /docs/:id/attachments | 附件列表（owner 可管理） |

### 导入导出
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /docs/import | multipart 上传 .docx → 转换服务产出 Tiptap JSON → 创建新文档并写入初始 Y.Doc 快照 |
| GET | /docs/:id/export?format=docx\|pdf | 异步任务：快照 → HTML/Markdown → LibreOffice/Pandoc → 下载 URL（MinIO 临时签名链接） |

### 内部接口（仅集群内可访问，网络策略隔离 + 内部服务 token）
| 方法 | 路径 | 调用方 | 说明 |
|---|---|---|---|
| GET | /internal/docs/:id/membership?userId= | collab | 验权返回 `{permission,user,ttlMs}` |
| POST | /internal/docs/:id/sync-state | collab | 压缩完成后回写 current_version/updatedAt |
| POST | /internal/docs/:id/extracted | collab | 回写纯文本、评论线程快照、字数 |
| POST | /internal/docs/:id/force-replace | server→collab（经 Redis 或直连） | 版本恢复指令 `{revisionId, operatorId}` |

---

## 3. JWT 与 WS 鉴权细节

- 通用 accessToken：`{ sub: userId, name, exp }`，HTTPS only。
- WS token：绑定 `docId` 与一次性 jti，TTL 5 分钟，只用于建立一次连接；重连重新获取，避免长生命周期 URL token 泄漏。
- 网关验权结果缓存 key：`auth:{docId}:{userId}`，TTL 60s；成员/角色变更时由 permissions 模块**主动删除该 key**并发布 kick 指令。

---

## 4. Prisma 模型要点（节选）

```prisma
model Doc {
  id             String   @id @default(uuid()) @db.Uuid
  title          String   @default("未命名文档")
  ownerId        String   @map("owner_id") @db.Uuid
  currentVersion BigInt   @default(0) @map("current_version")
  members        DocMember[]
  snapshots      DocSnapshot?
  updates        DocUpdate[]
  revisions      DocRevision[]
  deletedAt      DateTime? @map("deleted_at") @db.Timestamptz(6)
  @@map("docs")
}

model DocUpdate {
  id       BigInt @id @generated
  docId    String @map("doc_id") @db.Uuid
  version  BigInt
  update   Bytes
  clientId BigInt? @map("client_id")
  @@unique([docId, version])
  @@index([docId, version])
  @@map("doc_updates")
}
```
- 业务 Prisma client 不迁移/不引用二进制表的写权限；建议拆成两个 schema 目录或两个数据源连接串（数据库账号级隔离）。
- `Bytes` 在 PostgreSQL 映射 `bytea`；不要走 JSON 序列化（会膨胀且破坏二进制）。

---

## 5. 导入导出服务方案（M2，分档）

| 档位 | 方案 | 覆盖 | 成本 |
|---|---|---|---|
| 轻量 | Mammoth（docx→HTML）+ html-to-docx | 纯文本、基础样式、简单表格 | 2~3 天，保真度低 |
| 中档 | Tiptap JSON ↔ OOXML 自研映射（约 20 种节点） | 标题/列表/图片/代码块/表格 | 2~4 周 |
| **推荐** | LibreOffice headless（docx 双向 + pdf）或 Pandoc 容器，server 以任务队列调度 | 公式、复杂表格、排版高保真 | 约 1 周接入 + 容器资源 |

- 导入产物必须落到一篇**新文档**（避免覆盖在线文档），转换完成后由 server 直接生成 Y.Doc 初始快照（离线一次性写入，不经过 WS）。
- 导出走异步任务 + 回调轮询，防止大文档 HTTP 超时；产物放 MinIO 临时目录，签名链接 10 分钟过期。

---

## 6. 通知（M2）

触发源：评论 @提及、被邀请加入文档、回复线程。
- 网关回写评论 → server 识别 mention → 写通知表 → 推送（M2 先做应用内消息 + 邮件占位；IM webhook 视部署环境后续接入）。
- 通知里只带 docId/评论 id，不带正文快照，避免权限回收后通知泄漏内容。
