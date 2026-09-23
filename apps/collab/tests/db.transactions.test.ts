import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import * as Y from 'yjs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * T1.10 集成测试（docs/08 §后端集成）：appendUpdate 幂等/并发 + 压缩事务 + 基线回放。
 * 连接本机 dev PG（无 Docker，testcontainers 不可用——T1.0 已记录偏差）。
 * FK 约束：协同三表 doc_id REFERENCES docs(id) ON DELETE CASCADE——
 * 因此先用 ow_app 账号（server 的 .env）创建测试 docs 行，测试结束 DELETE docs 级联清理，
 * 不触碰真实文档数据。
 */

function loadEnv(relPath: string): void {
  const envFile = readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8')
  for (const line of envFile.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m !== null && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}
loadEnv('../.env') // collab：DATABASE_URL（ow_collab）等
// 提取 ow_app 连接串（不覆盖已加载的 collab env）
const serverEnv = readFileSync(fileURLToPath(new URL('../../../apps/server/.env', import.meta.url)), 'utf8')
const appUrlMatch = serverEnv.match(/^DATABASE_URL=(.*)$/m)
if (appUrlMatch === null) throw new Error('apps/server/.env 缺少 DATABASE_URL')
const appDbUrl = appUrlMatch[1].trim()

// db.client 在模块加载时即创建 Pool 并读取 DATABASE_URL，必须先注入 env 再动态 import
const { appendUpdate, compactDocInDb, loadDocBaseline, pool } = await import('../src/db.client.js')
const appPool = new pg.Pool({ connectionString: appDbUrl, max: 2 })

const testDocIds: string[] = []
function newTestDocId(): string {
  const id = randomUUID()
  testDocIds.push(id)
  return id
}

/** 生成一段追加文本的 y update */
function makeAppendUpdate(doc: Y.Doc, text: string): Uint8Array {
  doc.getText('t').insert(doc.getText('t').length, text)
  return Y.encodeStateAsUpdate(doc)
}

const insertedDocIds = new Set<string>()
async function createTestDocs(): Promise<void> {
  // 幂等：每个用例先 newTestDocId 再调本函数，已插入的跳过
  // owner_id 是桩用户 ID（T1.1 桩表，无 users 表 FK）
  const ownerId = '11111111-1111-4111-8111-111111111111'
  for (const id of testDocIds) {
    if (insertedDocIds.has(id)) continue
    await appPool.query('INSERT INTO docs(id, title, owner_id) VALUES ($1, $2, $3)', [id, `__test_${id.slice(0, 8)}`, ownerId])
    insertedDocIds.add(id)
  }
}

beforeAll(async () => {
  await createTestDocs()
})

afterAll(async () => {
  // docs 删除即级联清理三表协同数据
  if (testDocIds.length > 0) {
    await appPool.query('DELETE FROM docs WHERE id = ANY($1)', [testDocIds])
  }
  await appPool.end()
  await pool.end()
})

describe('appendUpdate：水位与幂等（docs/03 §4）', () => {
  it('首次写入 version=1 并初始化游标', async () => {
    const docId = newTestDocId()
    await createTestDocs()
    const v = await appendUpdate(docId, makeAppendUpdate(new Y.Doc(), 'a'), null)
    expect(v).toBe(1n)

    const cur = await pool.query('SELECT next_version FROM doc_sync_cursors WHERE doc_id = $1', [docId])
    expect(BigInt(cur.rows[0].next_version)).toBe(2n)
  })

  it('连续追加 version 严格递增', async () => {
    const docId = newTestDocId()
    await createTestDocs()
    const doc = new Y.Doc()
    const versions: bigint[] = []
    for (const text of ['a', 'b', 'c']) {
      versions.push(await appendUpdate(docId, makeAppendUpdate(doc, text), null))
    }
    expect(versions).toEqual([1n, 2n, 3n])
    expect(doc.getText('t').toString()).toBe('abc')
  })

  it('并发 8 路追加：version 互不重复且连续（FOR UPDATE + UNIQUE 裁决）', async () => {
    const docId = newTestDocId()
    await createTestDocs()
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => appendUpdate(docId, makeAppendUpdate(new Y.Doc(), `u${i}`), null)),
    )
    const sorted = [...results].sort((a, b) => (a < b ? -1 : 1))
    expect(sorted).toEqual([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n])

    const rows = await pool.query('SELECT version FROM doc_updates WHERE doc_id = $1 ORDER BY version', [docId])
    expect(rows.rowCount).toBe(8)
  })
})

describe('compactDocInDb：压缩事务（docs/03 §5）', () => {
  it('压缩后：快照落 @水位、旧增量全删、游标水位不回退', async () => {
    const docId = newTestDocId()
    await createTestDocs()
    const doc = new Y.Doc()
    for (const text of ['hello', 'world', '!']) {
      await appendUpdate(docId, makeAppendUpdate(doc, text), null)
    }
    expect(doc.getText('t').toString()).toBe('helloworld!')

    const result = await compactDocInDb(docId, Y.encodeStateAsUpdate(doc))
    expect(result.waterMark).toBe(3n)
    expect(result.deletedUpdates).toBe(3)
    expect(result.snapshotBytes).toBeGreaterThan(0)

    const snap = await pool.query('SELECT version FROM doc_snapshots WHERE doc_id = $1', [docId])
    expect(snap.rowCount).toBe(1)
    expect(BigInt(snap.rows[0].version)).toBe(3n)
    const ups = await pool.query('SELECT version FROM doc_updates WHERE doc_id = $1', [docId])
    expect(ups.rowCount).toBe(0)

    // 水位不回退：压缩后继续追加从 4 续号（游标从未被删除/重置）
    const v = await appendUpdate(docId, makeAppendUpdate(doc, 'more'), null)
    expect(v).toBe(4n)
  })

  it('基线回放：快照 + 压缩后新增量重组完整文本', async () => {
    const docId = newTestDocId()
    await createTestDocs()
    const doc = new Y.Doc()
    for (const text of ['first', 'second']) {
      await appendUpdate(docId, makeAppendUpdate(doc, text), null)
    }
    await compactDocInDb(docId, Y.encodeStateAsUpdate(doc))
    await appendUpdate(docId, makeAppendUpdate(doc, 'third'), null)

    const baseline = await loadDocBaseline(docId)
    expect(baseline.snapshot).not.toBeNull()
    expect(baseline.snapshotVersion).toBe(2n)
    expect(baseline.updates.length).toBe(1)

    const replayed = new Y.Doc()
    replayed.transact(() => {
      if (baseline.snapshot !== null) Y.applyUpdate(replayed, baseline.snapshot)
      for (const u of baseline.updates) Y.applyUpdate(replayed, u)
    })
    expect(replayed.getText('t').toString()).toBe('firstsecondthird')
  })

  it('二次压缩：upsert 覆盖旧快照推进水位', async () => {
    const docId = newTestDocId()
    await createTestDocs()
    const doc = new Y.Doc()
    await appendUpdate(docId, makeAppendUpdate(doc, 'v1'), null)
    await compactDocInDb(docId, Y.encodeStateAsUpdate(doc))
    await appendUpdate(docId, makeAppendUpdate(doc, 'v2'), null)
    const second = await compactDocInDb(docId, Y.encodeStateAsUpdate(doc))

    expect(second.waterMark).toBe(2n)
    expect(second.deletedUpdates).toBe(1)

    const snap = await pool.query('SELECT version FROM doc_snapshots WHERE doc_id = $1', [docId])
    expect(snap.rowCount).toBe(1)
    expect(BigInt(snap.rows[0].version)).toBe(2n)
  })

  it('空文档压缩：水位 0，快照以 v0 落库', async () => {
    const docId = newTestDocId()
    await createTestDocs()
    const result = await compactDocInDb(docId, Y.encodeStateAsUpdate(new Y.Doc()))
    expect(result.waterMark).toBe(0n)
    expect(result.deletedUpdates).toBe(0)
  })
})

describe('loadDocBaseline：空文档基线', () => {
  it('无快照无增量时返回空基线', async () => {
    const docId = newTestDocId()
    await createTestDocs()
    const baseline = await loadDocBaseline(docId)
    expect(baseline.snapshot).toBeNull()
    expect(baseline.snapshotVersion).toBe(0n)
    expect(baseline.updates).toEqual([])
  })
})
