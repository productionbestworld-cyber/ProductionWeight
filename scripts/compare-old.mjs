// เทียบฐานข้อมูลเก่า (CSV จาก DB_ORG) กับระบบใหม่ (Supabase) → ไฟล์ Excel
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'

const url='https://belwjdajuaxbhaqtlhrj.supabase.co'
const key='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbHdqZGFqdWF4YmhhcXRsaHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzgzNzYsImV4cCI6MjA5NDM1NDM3Nn0.aM-DKa8v0OlQQW6MsDzmCrEFY0d8rEVgzuemZ8UKZJA'
const sb=createClient(url,key)

// อ่าน CSV (เก่า) ด้วย xlsx
const readCsv = p => XLSX.utils.sheet_to_json(XLSX.read(readFileSync(p),{type:'buffer'}).Sheets.Sheet1 || XLSX.read(readFileSync(p),{type:'buffer'}).Sheets[XLSX.read(readFileSync(p),{type:'buffer'}).SheetNames[0]])
const oldProd = readCsv('C:\\Users\\Meeting\\Desktop\\OLD_สินค้า_TBLPROD.csv')
const oldCust = readCsv('C:\\Users\\Meeting\\Desktop\\OLD_ลูกค้า_TBLCUST.csv')

const norm = s => (s==null?'':String(s)).trim()
const oldProdMap = new Map(), oldCustMap = new Map()
for (const r of oldProd){ const c=norm(r['รหัส']); if(c) oldProdMap.set(c.toUpperCase(), r) }
for (const r of oldCust){ const c=norm(r['รหัสลูกค้า']); if(c) oldCustMap.set(c, r) }

// ระบบใหม่
const { data: newProd } = await sb.from('products').select('item_code, product_name, mat_code, core_weight')
const { data: newCust } = await sb.from('customers').select('cust_code, cust_name')
const newProdMap = new Map(newProd.map(p=>[norm(p.item_code).toUpperCase(), p]))
const newCustMap = new Map(newCust.map(c=>[norm(c.cust_code), c]))

const wb = XLSX.utils.book_new()
const add = (name, rows) => { const ws=XLSX.utils.json_to_sheet(rows); XLSX.utils.book_append_sheet(wb, ws, name) }

// สินค้า: เก่ามี-ใหม่ไม่มี
add('Prod_เก่ามี_ใหม่ไม่มี', [...oldProdMap].filter(([c])=>!newProdMap.has(c)).map(([c,r])=>({รหัส:c, ชื่อเก่า:norm(r['ชื่อสินค้า']), แกน:norm(r['แกน'])})))
// สินค้า: ใหม่ชื่อว่าง-เก่ามีชื่อ
add('Prod_ใหม่ชื่อว่าง_เก่ามี', newProd.filter(p=>norm(p.product_name)==='' && oldProdMap.has(norm(p.item_code).toUpperCase())).map(p=>({รหัส:p.item_code, ชื่อจากเก่า:norm(oldProdMap.get(norm(p.item_code).toUpperCase())['ชื่อสินค้า'])})))
// สินค้า: ชื่อต่างกัน
add('Prod_ชื่อต่างกัน', newProd.filter(p=>{const o=oldProdMap.get(norm(p.item_code).toUpperCase()); return o && norm(p.product_name)!=='' && norm(o['ชื่อสินค้า'])!=='' && norm(p.product_name)!==norm(o['ชื่อสินค้า'])}).map(p=>{const o=oldProdMap.get(norm(p.item_code).toUpperCase()); return {รหัส:p.item_code, ชื่อใหม่:norm(p.product_name), ชื่อเก่า:norm(o['ชื่อสินค้า'])}}))
// สินค้า: ใหม่แกนว่าง-เก่ามี
add('Prod_ใหม่แกนว่าง_เก่ามี', newProd.filter(p=>{const o=oldProdMap.get(norm(p.item_code).toUpperCase()); return (norm(p.core_weight)===''||norm(p.core_weight)==='0') && o && norm(o['แกน'])!=='' && norm(o['แกน'])!=='0'}).map(p=>{const o=oldProdMap.get(norm(p.item_code).toUpperCase()); return {รหัส:p.item_code, แกนใหม่:norm(p.core_weight), แกนเก่า:norm(o['แกน'])}}))
// ลูกค้า: เก่ามี-ใหม่ไม่มี
add('Cust_เก่ามี_ใหม่ไม่มี', [...oldCustMap].filter(([c])=>!newCustMap.has(c)).map(([c,r])=>({รหัส:c, ชื่อ:norm(r['ชื่อลูกค้า'])})))
// ลูกค้า: ชื่อต่างกัน
add('Cust_ชื่อต่างกัน', newCust.filter(c=>{const o=oldCustMap.get(norm(c.cust_code)); return o && norm(o['ชื่อลูกค้า'])!=='' && norm(c.cust_name)!==norm(o['ชื่อลูกค้า'])}).map(c=>{const o=oldCustMap.get(norm(c.cust_code)); return {รหัส:c.cust_code, ชื่อใหม่:norm(c.cust_name), ชื่อเก่า:norm(o['ชื่อลูกค้า'])}}))

const out='C:\\Users\\Meeting\\Desktop\\เทียบ_เก่าvsใหม่_BWP.xlsx'
XLSX.writeFile(wb, out)
const cnt = n => wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n]).length : 0
for(const n of wb.SheetNames) console.log(`${n}: ${cnt(n)} แถว`)
console.log('→ '+out)
