// ดึงสินค้าทั้งหมดจาก Supabase → เซฟเป็น Excel บน Desktop
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

const url = 'https://belwjdajuaxbhaqtlhrj.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbHdqZGFqdWF4YmhhcXRsaHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzgzNzYsImV4cCI6MjA5NDM1NDM3Nn0.aM-DKa8v0OlQQW6MsDzmCrEFY0d8rEVgzuemZ8UKZJA'
const sb = createClient(url, key)

const { data, error } = await sb.from('products')
  .select('item_code, product_name, product_code, mat_code, core_weight, width_cm, width_unit, thick_mc, cust_code')
  .order('item_code')
if (error) { console.error(error); process.exit(1) }

const sizeOf = p => {
  const w = (p.width_cm ?? '').toString().trim()
  const t = (p.thick_mc ?? '').toString().trim()
  if (!w && !t) return ''
  return `${w || '—'} ${p.width_unit || 'cm'} × ${t || '—'} mc`
}
const rows = data.map(p => ({
  'Item Code':     p.item_code ?? '',
  'ขนาด (แยกแล้ว)': sizeOf(p),
  'ชื่อสินค้า (ไม่มีขนาด)': p.product_name ?? '',
  'Product Code':  p.product_code ?? '',
  'Mat Code':      p.mat_code ?? '',
  'นน.แกน':        p.core_weight ?? '',
  'รหัสลูกค้า':     p.cust_code ?? '',
}))

const ws = XLSX.utils.json_to_sheet(rows)
ws['!cols'] = [{wch:16},{wch:18},{wch:42},{wch:24},{wch:14},{wch:8},{wch:10}]
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, 'สินค้า_แยกขนาด')
const out = 'C:\\Users\\Meeting\\Desktop\\รายการสินค้า_แยกขนาด_BWP.xlsx'
XLSX.writeFile(wb, out)
console.log(`✓ ${rows.length} รายการ → ${out}`)
