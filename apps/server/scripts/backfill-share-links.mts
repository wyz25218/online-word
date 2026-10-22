// 一次性回填脚本：为存量文档补 doc_share_links 默认行
// 用法：从 workspace 根跑: node "D:\...\tsx\dist\cli.mjs" apps/server/scripts/backfill-share-links.mts
// ⚠️ ESM import 提升——env.ts 必须先 import 确保副作用先执行
import '../src/env.js'
import { prisma } from '../src/prisma.js'

async function main() {
  const docs = await prisma.doc.findMany({ where: { deletedAt: null }, select: { id: true } })
  const existing = await prisma.docShareLink.findMany({ select: { docId: true } })
  const existingIds = new Set(existing.map((e) => e.docId))
  const missing = docs.filter((d) => !existingIds.has(d.id))
  console.log(`docs=${docs.length} share_links=${existing.length} missing=${missing.length}`)
  if (missing.length > 0) {
    await prisma.docShareLink.createMany({
      data: missing.map((d) => ({ docId: d.id, mode: 'private', token: null })),
    })
    console.log(`backfilled ${missing.length} rows`)
  } else {
    console.log('no backfill needed')
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); prisma.$disconnect().finally(() => process.exit(1)) })
