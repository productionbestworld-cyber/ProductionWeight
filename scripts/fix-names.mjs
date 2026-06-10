// แก้ชื่อให้ถูก: base = ชื่อเก่า (จาก mat) + suffix = คำต่อท้ายจากชื่อ "ดั้งเดิม" (backup ก่อนแก้)
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'

const url='https://belwjdajuaxbhaqtlhrj.supabase.co'
const key='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbHdqZGFqdWF4YmhhcXRsaHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzgzNzYsImV4cCI6MjA5NDM1NDM3Nn0.aM-DKa8v0OlQQW6MsDzmCrEFY0d8rEVgzuemZ8UKZJA'
const sb=createClient(url,key)
const APPLY=process.argv.includes('--apply')
const norm=s=>(s==null?'':String(s)).trim()

// ชื่อดั้งเดิม (ก่อน B) จาก backup แยกขนาด
const b3=XLSX.read(readFileSync('C:\\Users\\Meeting\\Desktop\\รายการสินค้า_แยกขนาด_BWP.xlsx'),{type:'buffer'})
const orig=new Map()
for(const r of XLSX.utils.sheet_to_json(b3.Sheets[b3.SheetNames[0]])){ const ic=norm(r['Item Code']).toUpperCase(); if(ic) orig.set(ic, norm(r['ชื่อสินค้า (ไม่มีขนาด)'])) }

// ชื่อเก่าจาก TBLPROD ตาม mat
const oldB=XLSX.read(readFileSync('C:\\Users\\Meeting\\Desktop\\OLD_สินค้า_TBLPROD.csv'),{type:'buffer'})
const oldByMat=new Map()
for(const r of XLSX.utils.sheet_to_json(oldB.Sheets.Sheet1)){ const c=norm(r['รหัส']).toUpperCase(); const n=norm(r['ชื่อสินค้า']); if(c&&n) oldByMat.set(c,n) }

// suffix = ส่วนหลังรูปแบบขนาด "NN cm x NN mc" ในชื่อดั้งเดิม
const sizeRe=/\d+(?:\.\d+)?\s*cm\.?\s*[x×]\s*\d+(?:\.\d+)?\s*mc\.?\s*/i
const suffixOf=name=>{ const m=norm(name).match(sizeRe); if(!m) return ''; return norm(norm(name).slice(m.index+m[0].length)) }

const {data:prods}=await sb.from('products').select('id,item_code,product_name,mat_code')
const changes=[]
for(const p of prods){
  const mat=norm(p.mat_code).toUpperCase()
  if(!mat||!oldByMat.has(mat)) continue
  const base=oldByMat.get(mat)
  const suf=suffixOf(orig.get(norm(p.item_code).toUpperCase()) ?? '')
  const want=suf?`${base} ${suf}`:base
  if(want!==norm(p.product_name)) changes.push({id:p.id,item:p.item_code,เดิม:norm(p.product_name),ใหม่:want})
}
const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(changes.map(({item,เดิม,ใหม่})=>({item,เดิม,ใหม่}))),'fix')
XLSX.writeFile(wb,'C:\\Users\\Meeting\\Desktop\\fix_names_BWP.xlsx')
console.log(`จะแก้ ${changes.length} ตัว → Desktop\\fix_names_BWP.xlsx`)
console.log(changes.slice(0,8).map(c=>`${c.item}: [${c.เดิม}] -> [${c.ใหม่}]`).join('\n'))
if(!APPLY){ console.log('** DRY RUN **'); process.exit(0) }
let ok=0; for(const c of changes){ const {error}=await sb.from('products').update({product_name:c.ใหม่}).eq('id',c.id); if(!error)ok++ }
console.log(`✓ แก้ ${ok}/${changes.length}`)
