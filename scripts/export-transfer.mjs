// Export ใบโอนเป็น Excel (ดึงน้ำหนักล่าสุดจาก production_rolls — ตรงหลังแก้ข้อมูล)
//   ตั้ง DOC_NO แล้วรัน:  node scripts/export-transfer.mjs
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

const url = 'https://belwjdajuaxbhaqtlhrj.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbHdqZGFqdWF4YmhhcXRsaHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzgzNzYsImV4cCI6MjA5NDM1NDM3Nn0.aM-DKa8v0OlQQW6MsDzmCrEFY0d8rEVgzuemZ8UKZJA'

const DOC_NO = 'TR-12285210'   // ← เลขใบโอนที่จะ export
const OUT_DIR = 'C:/Users/Meeting/Desktop'

const sb = createClient(url, key)
const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dt = (iso) => iso ? new Date(iso).toLocaleString('th-TH') : ''

const { data: doc } = await sb.from('transfer_documents').select('*').eq('doc_no', DOC_NO).single()
if (!doc) { console.error('ไม่พบใบโอน ' + DOC_NO); process.exit(1) }

const { data: rolls } = await sb.from('production_rolls').select('*')
  .eq('transfer_doc_id', doc.id)
  .order('roll_no', { ascending: true }).order('created_at', { ascending: true })

const totalNet = rolls.reduce((s, r) => s + (r.weight ?? 0), 0)
const s0 = rolls[0] ?? {}

const header = [
  ['บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด'],
  ['ใบโอนสินค้าเข้าคลัง (BWP TRANSFER NOTE)'],
  [],
  ['เลขที่ใบโอน :', doc.doc_no, '', 'วันที่ :', dt(doc.transferred_at), '', 'ผู้โอน :', doc.transferred_by],
  ['เครื่อง :', doc.machine_no, '', 'Lot :', doc.lot_no, '', 'สินค้า :', s0.product_name ?? ''],
  ['WO :', doc.work_order, '', 'SO :', doc.sale_order, '', 'ลูกค้า :', s0.customer ?? ''],
  ['จำนวน :', `${rolls.length} ม้วน`, '', 'น้ำหนักรวม (สุทธิ) :', `${fmt(totalNet)} Kgs.`],
  [],
  ['ลำดับ', 'ม้วนที่', 'นน.เต็ม (Kgs.)', 'นน.แกน (Kgs.)', 'นน.สุทธิ (Kgs.)', 'เครื่อง', 'WO', 'SO', 'Item Code', 'Mat Code', 'สินค้า', 'ลูกค้า', 'Lot', 'ผู้ตรวจสอบ', 'เวลาชั่ง'],
]
const rows = rolls.map((r, i) => [
  i + 1, r.roll_no,
  Number(((r.weight ?? 0) + (r.core_weight ?? 0)).toFixed(2)),
  Number((r.core_weight ?? 0).toFixed(2)),
  Number((r.weight ?? 0).toFixed(2)),
  r.machine_no ?? '', r.work_order ?? '', r.sale_order ?? '', r.item_code ?? '', r.mat_code ?? '',
  r.product_name ?? '', r.customer ?? '', r.lot_no ?? '', r.inspector ?? '', dt(r.created_at),
])
rows.push(['', `รวม ${rolls.length} ม้วน`, '', '', Number(totalNet.toFixed(2)), '', '', '', '', '', '', '', '', '', ''])

const ws = XLSX.utils.aoa_to_sheet([...header, ...rows])
ws['!cols'] = [{ wch: 6 }, { wch: 8 }, { wch: 14 }, { wch: 13 }, { wch: 14 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 26 }, { wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 20 }]
ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 14 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 14 } }]

const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, DOC_NO)
const file = `${OUT_DIR}/ใบโอน_${DOC_NO}_แก้ไขแล้ว.xlsx`
XLSX.writeFile(wb, file)
console.log(`✓ ${rolls.length} ม้วน · รวมสุทธิ ${fmt(totalNet)} Kgs.`)
console.log(`📄 ${file}`)
