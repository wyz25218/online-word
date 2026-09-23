import pg from 'pg'

/**
 * collab 专属最小 DB client（docs/03 §2）：
 * - 仅访问协同二进制三表 doc_snapshots / doc_updates / doc_sync_cursors
 * - 账号 ow_collab 只有这三张表的 DML 权限，与业务库（apps/server 的 Prisma）物理隔离
 * - 故意不引入 Prisma：网关热路径只要 3 条 SQL，避免 ORM 开销与误用业务表
 */

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/online_word'

export const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: Number(process.env.PG_POOL_MAX ?? 10),
})

export interface DocBaseline {
  /** 快照二进制（无快照为 null） */
  snapshot: Uint8Array | null
  /** 快照合并到的最新 update version（无快照为 0） */
  snapshotVersion: bigint
  /** version > snapshotVersion 的增量，按 version 升序 */
  updates: Uint8Array[]
}

/** UUID 校验：房间名必须为文档 UUID 才走持久化（M0 遗留的任意房间名仅内存态） */
export function isDocUuid(docId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(docId)
}

/** docs/03 §3 读取协议：快照 + 增量回放所需的全部数据（一次 round-trip 各一条查询） */
export async function loadDocBaseline(docId: string): Promise<DocBaseline> {
  const snap = await pool.query<{ state: Buffer; version: string }>(
    'SELECT state, version FROM doc_snapshots WHERE doc_id = $1',
    [docId],
  )
  const snapshotRow = snap.rows[0]
  const snapshotVersion = snapshotRow === undefined ? 0n : BigInt(snapshotRow.version)

  const ups = await pool.query<{ update: Buffer }>(
    'SELECT "update" FROM doc_updates WHERE doc_id = $1 AND version > $2 ORDER BY version ASC',
    [docId, snapshotVersion],
  )

  return {
    snapshot: snapshotRow === undefined ? null : new Uint8Array(snapshotRow.state),
    snapshotVersion,
    updates: ups.rows.map((r) => new Uint8Array(r.update)),
  }
}

/**
 * docs/03 §4 写入协议：事务内取水位行 FOR UPDATE → 追加增量 → 水位 +1。
 * UNIQUE(doc_id, version) 兜底幂等；调用方需持有 Redis 房间锁（见 persistence.ts）。
 * 返回写入的 version。
 */
export async function appendUpdate(docId: string, update: Uint8Array, clientId: number | null): Promise<bigint> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const cur = await client.query<{ next_version: string }>(
      'SELECT next_version FROM doc_sync_cursors WHERE doc_id = $1 FOR UPDATE',
      [docId],
    )
    let version: bigint
    if (cur.rows[0] === undefined) {
      // 首次写入：初始化游标（并发下 ON CONFLICT 兜底，两方均从 1 开始，UNIQUE 约束裁决）
      await client.query('INSERT INTO doc_sync_cursors(doc_id) VALUES ($1) ON CONFLICT DO NOTHING', [docId])
      version = 1n
    } else {
      version = BigInt(cur.rows[0].next_version)
    }
    await client.query(
      'INSERT INTO doc_updates(doc_id, version, "update", client_id) VALUES ($1, $2, $3, $4)',
      [docId, version, Buffer.from(update), clientId],
    )
    await client.query(
      'UPDATE doc_sync_cursors SET next_version = $2, updated_at = now() WHERE doc_id = $1',
      [docId, version + 1n],
    )
    await client.query('COMMIT')
    return version
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export interface CompactResult {
  /** 快照对应的最新增量 version（水位 = next_version - 1） */
  waterMark: bigint
  /** 被删除的旧增量条数 */
  deletedUpdates: number
  snapshotBytes: number
}

/**
 * docs/03 §5 压缩事务：upsert 快照（version = 当前水位）→ 删除水位前的全部增量。
 * 调用方需持有 Redis 房间锁（与 appendUpdate 同一把锁互斥），水位在事务内不会被并发推进。
 */
export async function compactDocInDb(docId: string, state: Uint8Array): Promise<CompactResult> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const cur = await client.query<{ next_version: string }>(
      'SELECT next_version FROM doc_sync_cursors WHERE doc_id = $1 FOR UPDATE',
      [docId],
    )
    const row = cur.rows[0]
    const waterMark = row === undefined ? 0n : BigInt(row.next_version) - 1n
    await client.query(
      `INSERT INTO doc_snapshots(doc_id, version, state, size_bytes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (doc_id) DO UPDATE
         SET version = EXCLUDED.version, state = EXCLUDED.state,
             size_bytes = EXCLUDED.size_bytes, created_at = now()`,
      [docId, waterMark, Buffer.from(state), state.byteLength],
    )
    const del = await client.query(
      'DELETE FROM doc_updates WHERE doc_id = $1 AND version <= $2',
      [docId, waterMark],
    )
    await client.query('COMMIT')
    return { waterMark, deletedUpdates: del.rowCount ?? 0, snapshotBytes: state.byteLength }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
