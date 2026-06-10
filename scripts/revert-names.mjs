// ย้อนกลับการแก้ชื่อ/Product Code → คืนค่าจาก backup (รายการสินค้า_แยกขนาด_BWP.xlsx)
// คืน products.product_name + product_code ให้เป็นค่าก่อนแก้ B/C
// แล้ว re-sync machine_profiles + production_rolls (lot ปัจจุบัน) ตามค่าที่คืน
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'

const url='https://belwjdajuaxbhaqtlhrj.supabase.co'
const key='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbHdqZGFqdWF4YmhhcXRsaHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzgzNzYsImV4cCI6MjA5NDM1NDM3Nn0.aM-DKa8v0OlQQW6MsDzmCrEFY0d8rEVgzuemZ8UKZJA'
const sb=createClient(url,key)
const APPLY=process.argv.includes('--apply')
const norm=s=>(s==null?'':String(s)).trim()

const b=XLSX.read(readFileSync('C:\\Users\\Meeting\\Desktop\\รายการสินค้า_แยกขนาด_BWP.xlsx'),{type:'buffer'})
const bak=new Map()
for(const r of XLSX.utils.sheet_to_json(b.Sheets[b.SheetNames[0]])){
  const ic=norm(r['Item Code']).toUpperCase()
  if(ic) bak.set(ic,{name:norm(r['ชื่อสินค้า (ไม่มีขนาด)']), pcode:norm(r['Product Code'])})
}
const {data:prods}=await sb.from('products').select('id,item_code,product_name,product_code')
const ch=[]
for(const p of prods){
  const o=bak.get(norm(p.item_code).toUpperCase()); if(!o) continue
  if(norm(p.product_name)!==o.name)   // ⬅ คืนเฉพาะ "ชื่อ" (เก็บ product_code ไว้)
    ch.push({id:p.id,item:p.item_code,name:o.name})
}
console.log(`ย้อนชื่อ products: ${ch.length} ตัว (เก็บ product_code)`)
if(!APPLY){ console.log('** DRY RUN ** (ใส่ --apply เพื่อย้อนจริง)'); process.exit(0) }
let ok=0; for(const c of ch){ const {error}=await sb.from('products').update({product_name:c.name}).eq('id',c.id); if(!error)ok++ }
console.log(`✓ คืน products ${ok}/${ch.length}`)
console.log('ขั้นต่อไป: รัน SQL re-sync machine_profiles + production_rolls (อยู่ในไฟล์ revert_sync.sql)')
