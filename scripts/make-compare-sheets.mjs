// ───────────────────────────────────────────────────────────────────────────
//  สร้าง "ใบเทียบเลขม้วน เก่า→ใหม่" แยกต่อเครื่อง (HTML พร้อมปริ้น)
//    อ่านของเดิมจาก backup + ของใหม่จาก DB → ออกไฟล์ BLxx.html ต่อเครื่อง
//    node scripts/make-compare-sheets.mjs "D:/back up.../lot-fix_2026-07-01_0940/backup_rows.json"
// ───────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const url = 'https://belwjdajuaxbhaqtlhrj.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbHdqZGFqdWF4YmhhcXRsaHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzgzNzYsImV4cCI6MjA5NDM1NDM3Nn0.aM-DKa8v0OlQQW6MsDzmCrEFY0d8rEVgzuemZ8UKZJA'
const sb = createClient(url, key)

const backupFile = process.argv[2] || 'D:/back upเครื่องชั่ง supabase/lot-fix_2026-07-01_0940/backup_rows.json'
const old = JSON.parse(readFileSync(backupFile, 'utf8'))          // ค่าเดิม (id → roll_no/lot_no เก่า)
const oldById = Object.fromEntries(old.map(r => [r.id, r]))
const ids = old.map(r => r.id)

// ดึงค่าใหม่จาก DB
const cur = []
for (let i = 0; i < ids.length; i += 200) {
  const { data } = await sb.from('production_rolls')
    .select('id,machine_no,work_order,roll_type,roll_no,lot_no,weight').in('id', ids.slice(i, i + 200))
  cur.push(...(data ?? []))
}

// รวม เก่า+ใหม่
const rows = cur.map(c => {
  const o = oldById[c.id] || {}
  return {
    machine: c.machine_no, wo: c.work_order, type: c.roll_type,
    oldRoll: o.roll_no, newRoll: c.roll_no, weight: c.weight,
    oldLot: o.lot_no, newLot: c.lot_no,
  }
})

const outDir = dirname(backupFile) + '/เทียบต่อเครื่อง'
mkdirSync(outDir, { recursive: true })

const byM = {}
for (const r of rows) (byM[r.machine] ??= []).push(r)

const typeTh = t => t === 'good' ? 'ดี' : t === 'bad' ? 'กรอ' : 'เศษ'
const links = []
for (const m of Object.keys(byM).sort()) {
  const list = byM[m].sort((a, b) =>
    String(a.type).localeCompare(String(b.type)) || (a.newRoll ?? 0) - (b.newRoll ?? 0))
  const newLot = list.find(x => x.newLot)?.newLot ?? ''
  const wo = [...new Set(list.map(x => x.wo))].join(', ')
  const tr = list.map((r, i) => `<tr>
    <td>${i + 1}</td><td>${typeTh(r.type)}</td>
    <td class="old">#${r.oldRoll}</td><td class="arw">→</td><td class="new">#${r.newRoll}</td>
    <td class="w">${r.weight ?? ''}</td></tr>`).join('\n')
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>เทียบ ${m}</title>
<style>
*{font-family:'Sarabun','Tahoma',sans-serif}
body{margin:12px;color:#000}
h1{font-size:20pt;margin:0 0 2px}
.sub{font-size:11pt;color:#333;margin-bottom:8px}
.sub b{color:#000}
table{border-collapse:collapse;width:100%;font-size:12pt}
th,td{border:1px solid #999;padding:3px 8px;text-align:center}
th{background:#003087;color:#fff}
.old{color:#b00;font-weight:700}.new{color:#060;font-weight:800;font-size:13pt}.arw{color:#999}
.w{text-align:right;color:#333}
tr:nth-child(even){background:#f4f6fb}
@media print{@page{size:A4;margin:8mm}body{margin:0}h1{font-size:18pt}}
</style></head><body>
<h1>เทียบเลขม้วน — เครื่อง ${m}</h1>
<div class="sub">WO <b>${wo}</b> · Lot ใหม่ <b>${newLot}</b> · รวม <b>${list.length}</b> ม้วน · เลขเก่า→เลขใหม่</div>
<table><thead><tr><th>ลำดับ</th><th>ชนิด</th><th>เลขเก่า</th><th></th><th>เลขใหม่</th><th>น้ำหนัก (kg)</th></tr></thead>
<tbody>${tr}</tbody></table>
<p style="margin-top:8px;font-size:9pt;color:#777">ใช้เทียบ: ดูใบเก่าบนม้วน (เลขเก่า+น้ำหนัก) → แปะใบใหม่ตามเลขใหม่ · สร้าง ${new Date().toLocaleString('th-TH')}</p>
</body></html>`
  const file = `${outDir}/${m}.html`
  writeFileSync(file, html, 'utf8')
  links.push({ m, n: list.length })
}

// index รวม
const idx = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>เทียบเลขม้วน ต่อเครื่อง</title>
<style>*{font-family:'Sarabun','Tahoma',sans-serif}body{margin:20px}a{display:block;font-size:16pt;margin:6px 0;color:#003087}</style>
</head><body><h1>เทียบเลขม้วน — เลือกเครื่อง</h1>
${links.map(l => `<a href="./${l.m}.html">${l.m} (${l.n} ม้วน)</a>`).join('\n')}
</body></html>`
writeFileSync(`${outDir}/_index.html`, idx, 'utf8')

console.log(`✅ สร้างเสร็จ ${links.length} เครื่อง → ${outDir}`)
links.forEach(l => console.log(`   ${l.m}.html  (${l.n} ม้วน)`))
console.log(`   _index.html (หน้ารวมลิงก์ทุกเครื่อง)`)
