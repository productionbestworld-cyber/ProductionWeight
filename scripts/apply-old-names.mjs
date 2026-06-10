// B: เปลี่ยนชื่อสินค้าเป็นแบบเก่า (join Mat Code, คงคำต่อท้ายตัวแปร)
// C: ใส่ Product Code = Mat Code (เฉพาะที่ว่าง)
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'

const url='https://belwjdajuaxbhaqtlhrj.supabase.co'
const key='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbHdqZGFqdWF4YmhhcXRsaHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzgzNzYsImV4cCI6MjA5NDM1NDM3Nn0.aM-DKa8v0OlQQW6MsDzmCrEFY0d8rEVgzuemZ8UKZJA'
const sb=createClient(url,key)
const APPLY = process.argv.includes('--apply')

const norm = s => (s==null?'':String(s)).trim()
const buf = readFileSync('C:\\Users\\Meeting\\Desktop\\OLD_สินค้า_TBLPROD.csv')
const oldRows = XLSX.utils.sheet_to_json(XLSX.read(buf,{type:'buffer'}).Sheets.Sheet1)
const oldByMat = new Map()  // TGCODE(upper) -> TGNAME
for (const r of oldRows){ const c=norm(r['รหัส']).toUpperCase(); const n=norm(r['ชื่อสินค้า']); if(c && n) oldByMat.set(c, n) }

const { data: prods } = await sb.from('products').select('id, item_code, product_name, mat_code, product_code')

// suffix = ส่วนหลัง "mc" ในชื่อปัจจุบัน (สีแดง/GREEN/สูตร1/PCR...)
const suffixOf = name => { const m = norm(name).match(/mc\b\.?\s*(.+)$/i); return m ? m[1].trim() : '' }

const nameChanges = [], codeChanges = []
for (const p of prods){
  const mat = norm(p.mat_code).toUpperCase()
  // B — ชื่อ
  if (mat && oldByMat.has(mat)) {
    const oldName = oldByMat.get(mat)
    const suf = suffixOf(p.product_name)
    const newName = suf ? `${oldName} ${suf}` : oldName
    if (newName !== norm(p.product_name)) nameChanges.push({ id:p.id, item:p.item_code, ชื่อเดิม:norm(p.product_name), ชื่อใหม่:newName })
  }
  // C — product code = mat code (เฉพาะที่ว่าง)
  if (norm(p.product_code)==='' && norm(p.mat_code)!=='') codeChanges.push({ id:p.id, item:p.item_code, productCode:norm(p.mat_code) })
}

// preview excel
const wb=XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(nameChanges.map(({item,ชื่อเดิม,ชื่อใหม่})=>({item,ชื่อเดิม,ชื่อใหม่}))), 'B_เปลี่ยนชื่อ')
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(codeChanges.map(({item,productCode})=>({item,productCode}))), 'C_ใส่ProductCode')
XLSX.writeFile(wb, 'C:\\Users\\Meeting\\Desktop\\preview_BC_BWP.xlsx')
console.log(`B เปลี่ยนชื่อ: ${nameChanges.length} · C ใส่ Product Code: ${codeChanges.length}`)
console.log('preview → Desktop\\preview_BC_BWP.xlsx')

if (!APPLY){ console.log('** DRY RUN ** (ใส่ --apply เพื่อบันทึกจริง)'); process.exit(0) }

let ok=0
for (const c of nameChanges){ const {error}=await sb.from('products').update({product_name:c.ชื่อใหม่}).eq('id',c.id); if(!error)ok++ }
let ok2=0
for (const c of codeChanges){ const {error}=await sb.from('products').update({product_code:c.productCode}).eq('id',c.id); if(!error)ok2++ }
console.log(`✓ บันทึกชื่อ ${ok}/${nameChanges.length} · Product Code ${ok2}/${codeChanges.length}`)
