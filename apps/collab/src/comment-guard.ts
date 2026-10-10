import * as Y from 'yjs'

/**
 * commenter 写权限网关（docs/04 §3/§6，T2.3）：
 * commenter 允许写 `comments` 命名空间，正文（`prosemirror` 命名空间）只读。
 *
 * 实现走 beforeHandleMessage：在 y update 应用到房间文档**之前**做影子判定——
 * 把 update 应用到房间文档的副本上，比较正文 fragment 的可见内容是否变化；
 * 变化即违规（诚实客户端 setEditable(false) + 评论只走 comments 通道，永不触发），
 * 抛错由 Hocuspocus 关闭该连接（等价于把恶意客户端视为攻击者踢出）。
 *
 * 说明：hocuspocus v4 的消息格式为 `varString(docName) + varUint(type) + payload`，
 * type 0=Sync（子 0=SyncStep1 / 1=SyncStep2 / 2=Update）、1=Awareness、2=Auth。
 * 只有 SyncStep2/Update 携带写入内容需要判定；SyncStep1（请求 diff）与 Awareness 直接放行。
 * 影子法每次全量 encode 房间文档，commenter 消息频率低（评论操作），开销可接受；
 * 大文档优化空间归 T2.8 压测专项。
 */

/** 最小 var 解码器（与 lib0 encoding 等价，免新增依赖） */
class Reader {
  pos = 0
  constructor(private readonly buf: Uint8Array) {}

  readVarUint(): number {
    let num = 0
    let mult = 1
    for (;;) {
      const r = this.buf[this.pos]
      this.pos += 1
      if (r === undefined) throw new Error('unexpected end of message')
      num += (r & 0b0111_1111) * mult
      mult *= 128
      if (r < 0b1000_0000) return num
    }
  }

  readVarString(): string {
    const len = this.readVarUint()
    const bytes = this.buf.subarray(this.pos, this.pos + len)
    this.pos += len
    return new TextDecoder().decode(bytes)
  }

  readVarUint8Array(): Uint8Array {
    const len = this.readVarUint()
    const bytes = this.buf.subarray(this.pos, this.pos + len)
    this.pos += len
    return new Uint8Array(bytes) // 复制，避免视图挂在原始消息上
  }
}

/**
 * 从原始 WS 消息中提取 y update payload；
 * 非 SyncStep2/Update 消息（awareness、sync-step1 等）返回 null。
 */
export function syncUpdateOf(raw: Uint8Array): Uint8Array | null {
  try {
    const reader = new Reader(raw)
    reader.readVarString() // docName（可能带 \0address 后缀，整体读掉）
    if (reader.readVarUint() !== 0) return null // 仅 Sync 命名空间
    const sub = reader.readVarUint()
    if (sub === 1 || sub === 2) return reader.readVarUint8Array() // SyncStep2 / Update
    return null
  } catch {
    return null // 消息不完整/畸形：交由后续正常处理路径报错
  }
}

/**
 * 影子判定：update 是否会改变正文（prosemirror 命名空间）的可见内容。
 * comments 命名空间（评论线程）的变化不影响返回值。
 */
export function affectsProsemirror(document: Y.Doc, update: Uint8Array): boolean {
  const shadow = new Y.Doc()
  try {
    Y.applyUpdate(shadow, Y.encodeStateAsUpdate(document))
    const before = shadow.getXmlFragment('prosemirror').toString()
    Y.applyUpdate(shadow, update)
    const after = shadow.getXmlFragment('prosemirror').toString()
    return before !== after
  } finally {
    shadow.destroy()
  }
}
