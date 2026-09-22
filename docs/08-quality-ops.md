# 08 · 质量保障、测试与运维

## 1. 并发回归用例（M0 建立，CI/E2E 常驻）

每条用例包含：前置、步骤、预期结果。M0 先手工执行，M2 起用 Playwright 双浏览器自动化固化。

| # | 用例 | 步骤 | 预期 |
|---|---|---|---|
| C01 | 同位置抢插 | A、B 光标都置于段落末尾，交替快速输入 50 字符 | 双方最终字符数 100，无丢字、无重复，顺序按 CRDT 收敛一致 |
| C02 | 跨段落删除冲突 | A 选中跨 3 个段落删除，同时 B 在中间段落输入 | 删除生效且 B 的新字符不丢（落在合理位置），文档结构合法 |
| C03 | 中文 IME | A 用拼音组词未上屏时，B 在同位置插入字符 | 拼音不被拆散/不丢字母，上屏后内容位置正确 |
| C04 | 大段粘贴 | A 粘贴 1 万字，同时 B 在文首持续输入 | 双方收敛；A 的粘贴完整、B 输入保留；无明显卡死（< 3s 恢复输入） |
| C05 | 断网并发 | 双方断网 10 分钟各自大量编辑（含删除、改格式）后重连 | 零丢字，内容一致；冲突段落语义可接受 |
| C06 | undo 隔离 | A 输入后 B 输入，A 连按撤销 | 只撤销 A 自己的字符，B 的内容不受影响 |
| C07 | 多标签同账号 | 同一账号开两个标签页 | 头像组按 userId 显示 1 人；不产生重复广播/重复落库 |
| C08 | 表格并发 | 两人同时增删行列、跨单元格选区删除、单元格内输入 | 表格行列数一致、不错位、无内容丢失 |
| C09 | 评论锚点稳定性 | 对选中文本加评论后，他人在锚点前后/内部插入、拆分段落、删除部分文字 | 线程不丢失、锚点不漂移；锚点文本被全删时给出"上下文已删除"态 |
| C10 | 编辑中途降权 | A 正在编辑，owner 将 A 降为 viewer | A 连接被关闭/只读立即生效；断连前发出的 update 被网关二次校验拒绝；A 看到明确提示 |
| C11 | 进程崩溃恢复 | 编辑中 `kill -9` collab 进程 | 重启后从快照+增量完整恢复，零丢失；客户端自动重连 |
| C12 | 多实例双向同步 | A/B 连接到不同 collab 副本 | update 经 Redis 双向可达；`doc_updates` 无重复 version、无空洞 |
| C13 | 长离线 + 他人删除 | A 离线 24h，期间 B 删除大段并触发压缩，A 重连 | 合并收敛、无异常抛出（GC/墓碑容错验证） |
| C14 | 房间关闭落盘 | 最后一人关闭页面 | onDestroy 强制压缩成功；再次打开为最新内容 |
| C15 | 版本恢复一致性 | 在线多人时 owner 恢复历史版本 | 所有人一次性收敛到目标版本；无"先全删再重建"闪烁；恢复进入历史 |
| C16 | 图片上传并发 | 多人同时粘贴/拖入大图（各 5MB+） | 直传成功、占位正确；弱网失败有重试；正文编辑不被阻塞 |
| C17 | 权限-链接分享 | 匿名用户持 anyone_view 链接进入 | 只读且无评论入口；改 anyone_edit 后 60s 内或刷新后可编辑（缓存策略可解释） |
| C18 | 网关重启风暴 | 100 个房间同时重连同一重启后的网关 | onLoadDocument 批量回放不击穿 PG；无连接雪崩（必要时加随机退避） |

---

## 2. 测试分层

| 层 | 工具 | 范围 |
|---|---|---|
| 纯函数单测 | Vitest | doc-store 版本号/压缩算法、权限 Guard、shared 类型工具、自定义扩展命令 |
| 后端集成 | Vitest + 测试 PG（testcontainers） | 追加/压缩事务、验权缓存与失效、内部接口 |
| 前端组件 | Vitest + Testing Library | 锁定**结构与稳定落点**（如初始"已同步"状态），不要断言防抖中的瞬态文案 |
| 协同 E2E | Playwright（两个 browser context 模拟两个用户） | C01-C17 自动化，CI 中以 WebKit/Chromium 双内核跑核心子集 |
| 压测 | k6/ws 脚本 + 真实 Yjs client 模拟 | 50 人房间 8h；100 房间重连风暴；10 万字文档首屏 |

注意：
- 测试中创建的 Y.Doc/Provider 必须显式 destroy，避免 Vitest watch 下句柄泄漏。
- E2E 断言"协同结果"时以双方最终文档文本相等为准，不依赖操作时序（时序是 CRDT 实现细节）。

---

## 3. CI 门禁顺序（沿用经验中的稳定顺序）

```
format:check (Prettier)
 → lint (ESLint flat config)
 → typecheck (tsc -b，strict + noUncheckedIndexedAccess)
 → test (vitest)
 → build (pnpm -r build)
 → e2e（仅主干/PR 标签触发，控制时长）
```
- 任一步失败即停，先修前置层（格式/类型）再看测试，避免重复返工。
- CI 环境：Windows runner 与 Linux runner 各跑一遍 install+typecheck（本项目开发机为 Windows，脚本兼容性必须双端验证）。
- 提交规范：Conventional Commits（feat/fix/docs/chore…）；**commit hook 在 M3 前不进仓库**，先由 CI 门禁把关，避免重蹈 prepare 阻断安装的问题。

---

## 4. 可观测性

### 指标（Prometheus 格式，由 collab 暴露 /metrics）
- `collab_connections_total` / `collab_rooms_active`
- `collab_onchange_lag_ms`（编辑到落库延迟）、`collab_append_fail_total`
- `collab_compact_duration_ms`、`collab_updates_behind_threshold`
- `collab_doc_state_bytes`（直方图，观察文档膨胀）
- `collab_auth_denied_total`、`collab_kick_total`
- server：常规 HTTP RED 指标 + 导入导出任务队列深度/耗时

### 日志（结构化 JSON）
- 每次压缩：docId、前后增量条数、字节数、耗时。
- 追加失败/锁等待超时：docId、version、clientId、错误栈；连续失败自动置房间只读并告警。
- 鉴权拒绝：docId、userId、原因（不记录文档内容）。

### 告警阈值（初版）
- 落库延迟 p95 > 1s；追加失败 5 分钟内 > 0
- 单文档快照 > 5MB；单房间积压 > 1000 条
- 网关连接数达到容量 70%（扩容量）
- 导入导出失败率 > 5%

---

## 5. 部署方案

### 本地开发
```
docker-compose up -d postgres redis minio
pnpm install
pnpm dev:server    # :3000
pnpm dev:collab    # :8080
pnpm dev:web       # :5173，Vite 代理 /api → 3000，/collab → 8080
```

### 生产（容器化）
- web：静态产物 + CDN，history 路由回退。
- server：无状态多副本，滚动发布。
- collab：无状态多副本；按连接数 HPA（基线连接数 60%）；配合 sticky/房间亲和降低广播成本。
- PostgreSQL：主从 + 定时物理备份；Redis：持久化 AOF（锁/缓存可丢失，Pub/Sub 不需要持久化，但建议开启防重启抖动）。
- MinIO/S3：独立生命周期策略，临时导出文件 24h 自动清理。
- 转换服务：独立容器（LibreOffice headless 内存占用大），按队列长度扩缩。
- 发布顺序：shared → server/collab（协议字段向后兼容，先服务端后前端）→ web。

---

## 6. 安全清单

- 全链路 HTTPS/WSS；WS token 短 TTL 且绑定 docId + 一次性 jti。
- 内部接口（/internal/*）仅集群网络可达 + 服务间 token；数据库账号按表收敛权限（collab 账号只能访问两张二进制表）。
- 越权用例：非成员直连 WS、viewer 构造 update、修改 URL 中 docId、链接 token 枚举（token 使用足够随机长度）。
- 附件：白名单 MIME + 魔数校验、大小限制、下载走签名 URL（不公开 bucket）；图片域防 XSS（不直接内联 SVG 用户文件）。
- 评论/正文内容展示走 ProseMirror 的 DOM 渲染（默认转义），禁止 `dangerouslySetInnerHTML` 渲染用户 HTML。
- 通知与搜索结果必须带权限过滤，防止"能搜到但打不开"之外的更严重情形——搜索接口按成员关系预过滤。
- JWT 密钥、S3 凭证走环境变量/密钥管理，不进仓库。

---

## 7. 风险登记册

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| 自研文档模型误用 Y.Map 替换 XmlFragment，官方绑定失效 | 中 | 致命 | 架构铁律 + 代码评审检查项；M0 demo 即验证光标/选区 |
| 定时全量覆盖写导致并发丢字 | 中 | 致命 | 只允许增量追加；code review 禁止出现"读全量→改→写回"链路 |
| 双服务直写业务库产生竞争 | 中 | 高 | 单一写入口；collab 数据库账号物理隔离权限 |
| 图片/大对象误写入 Y.Doc，文档膨胀 | 中 | 高 | 上传统一拦截 + 文档大小监控告警 |
| Tiptap/yjs/hocuspocus 版本错配 | 中 | 高 | pnpm catalog 统一 exact 版本；升级必须整组并跑 C01-C08 |
| **collaboration-cursor 与 collaboration 的 plugin key 冲突**（M0 已踩） | 高 | 高 | cursor@3.0.0 用 y-prosemirror 的 `ySyncPluginKey`，collaboration@3.31.3 用 @tiptap/y-tiptap 的不同 key，混用必崩。M0 移除 cursor 扩展，M1 基于 @tiptap/y-tiptap 自实现光标插件 |
| **Vite WS 代理对 Hocuspocus 二进制协议双向转发不稳**（M0 已踩） | 高 | 高 | dev 环境 provider 直连 `ws://localhost:8080`（网关 Origin 白名单放行）；生产由 nginx 反向代理，不走 Vite |
| **awareness user 缺 userId 导致远程用户被过滤**（M0 已踩） | 中 | 中 | awareness 的 user 字段必须包含 `userId`；在线列表按 userId 去重 |
| **Tiptap v3 history 改名 undoRedo**（M0 已踩） | 中 | 中 | StarterKit 协同配置用 `undoRedo: false`，非 `history: false` |
| IME 兼容问题 | 中 | 高 | M0 即专项验证；锁版本后禁止单包上浮 |
| 超长文档内存/广播压力 | 中 | 中 | GC + 压缩 + 监控；M2 压测、M3 视口优化 |
| prepare hook 阻断 Windows 安装 | 中 | 中 | M3 前不引入 git hooks；CI 双 OS 验证安装 |
| 历史恢复误清空在线文档 | 低 | 高 | 禁止清空重建，只允许整体替换 update；C15 回归 |
| 权限缓存窗口导致越权写入 | 低 | 高 | 60s 短 TTL + 主动踢人 + onChange 二次校验三重防护 |
| 转换服务保真度不达预期 | 中 | 中 | M2 用 20 个真实样例做准入评审；保留轻量 Mammoth 兜底 |

---

## 8. 评审检查项（每次涉及协同链路的 PR 必看）

1. 是否新增了对 Y.Doc 结构的自定义改造（除约定的 `prosemirror` 与 `comments` 命名空间外）？
2. 是否出现任何"定时/防抖后全量写文档"的代码？
3. collab 是否写了业务表、server 是否写了二进制表？
4. Y.Doc/Provider 是否有对称 destroy？
5. `@tiptap/*`、`yjs`、`@hocuspocus/*` 版本是否仍全部来自 catalog 且同组兼容？
6. 新增 update 消费点是否处理了 `permission !== 'write'`？
7. 新增文件字段是否只存引用 URL？
8. 是否补充/更新了对应用例（C01-C18）？
