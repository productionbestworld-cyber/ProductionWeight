import { useEffect, useState, useMemo, Fragment } from 'react'
import { supabase, fetchAll } from '../lib/supabase'
import { Package, Plus, Truck, BarChart3, RefreshCw, Search, Printer, Download, X, ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import * as XLSX from 'xlsx'

function fmt(n: number | null | undefined, d = 2) {
  if (n == null || isNaN(n as number)) return '0.00'
  return (n as number).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d })
}
function fmtDT(iso: string) {
  return new Date(iso).toLocaleString('th-TH', { timeZone:'Asia/Bangkok', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function thaiDate(d = new Date()) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()+543}`
}

type Tab = 'stock' | 'so' | 'ship' | 'scrap' | 'delivery' | 'history'
const SCRAP_LABEL: Record<string,string> = {
  scrap_clear: 'เศษใส', scrap_color: 'เศษสี', scrap_lump: 'เศษก้อน/ตะกอน',
}
type SO = {
  id: string; so_no: string; customer: string; product_name: string
  target_kg: number; status: string; created_at: string; note: string
}
type Roll = {
  id: string; roll_no: number; weight: number; gross_weight: number; core_weight: number
  machine_no: string; lot_no: string; product_name: string; customer: string
  inspector: string; created_at: string; transferred_at: string
  so_id: string | null; shipped: boolean; shipped_at: string | null; shipped_by: string | null
  width_cm?: string; thick_mc?: string; width_unit?: 'cm'|'mm'
}

// ── พิมพ์ใบจัดส่ง ─────────────────────────────────────────────────────────
function printDelivery(rolls: Roll[], so: SO, staff: string, docNo: string) {
  const totalKg = rolls.reduce((s, r) => s + (r.weight ?? 0), 0)
  const date = new Date()
  const groups: Record<string, Roll[]> = {}
  rolls.forEach(r => {
    const k = r.lot_no ?? '?'
    if (!groups[k]) groups[k] = []
    groups[k].push(r)
  })
  // เรียงในแต่ละ Lot: ม้วน #1 เป็นต้นไป (ให้ลูกค้าเช็คตามลำดับม้วน)
  Object.values(groups).forEach(items => items.sort((a, b) =>
    (a.roll_no ?? 0) - (b.roll_no ?? 0) || (a.created_at ?? '').localeCompare(b.created_at ?? '')))
  // เรียง Lot เก่า→ใหม่ ตามม้วนแรกที่ชั่งใน Lot (FIFO) แล้วค่อยชื่อ Lot
  const sortedGroups = Object.entries(groups).sort((a, b) => {
    const ea = Math.min(...a[1].map(r => new Date(r.created_at ?? 0).getTime()))
    const eb = Math.min(...b[1].map(r => new Date(r.created_at ?? 0).getTime()))
    return ea - eb || a[0].localeCompare(b[0])
  })
  const win = window.open('', '_blank', 'width=900,height=700')
  if (!win) return
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Sarabun','Tahoma',sans-serif;font-size:11pt;color:#000;background:#fff;padding:10mm}
.head{text-align:center;border-bottom:2px solid #000;padding-bottom:3mm;margin-bottom:4mm}
.head h1{font-size:13pt;font-weight:800}
.head h2{font-size:18pt;font-weight:900;margin-top:2mm}
.info{display:flex;justify-content:space-between;margin-bottom:4mm;font-size:10pt}
.info-row{margin-bottom:1mm}
.info-row b{display:inline-block;min-width:28mm}
.section-title{background:#003087;color:#fff;font-weight:700;padding:1.5mm 3mm;font-size:10pt}
table{width:100%;border-collapse:collapse;margin-bottom:4mm}
th,td{border:1px solid #aaa;padding:2mm 3mm;font-size:9.5pt}
th{background:#f5f5f5;font-weight:700;text-align:left}
.tot{background:#003087;color:#fff;font-weight:800}
.sign{display:flex;justify-content:space-around;margin-top:15mm}
.sign-box{flex:1;text-align:center}
.sign-line{border-top:1px solid #000;margin-top:18mm;padding-top:1mm;font-size:9pt}
@media print{@page{size:A4;margin:8mm}body{-webkit-print-color-adjust:exact}}
</style></head><body>
<div class="head">
  <h1>บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด</h1>
  <h2>ใบส่งสินค้า</h2>
  <p style="font-size:9pt;color:#555">DELIVERY NOTE</p>
</div>
<div class="info">
  <div>
    <div class="info-row"><b>เลขที่:</b> ${docNo}</div>
    <div class="info-row"><b>SO No.:</b> ${so.so_no}</div>
    <div class="info-row"><b>วันที่:</b> ${thaiDate(date)}</div>
  </div>
  <div>
    <div class="info-row"><b>ลูกค้า:</b> ${so.customer}</div>
    <div class="info-row"><b>สินค้า:</b> ${so.product_name}</div>
    <div class="info-row"><b>จัดส่งโดย:</b> ${staff}</div>
  </div>
  <div>
    <div class="info-row"><b>จำนวน:</b> ${rolls.length} ม้วน</div>
    <div class="info-row"><b>น้ำหนักรวม:</b> ${totalKg.toFixed(2)} Kgs.</div>
  </div>
</div>
${sortedGroups.map(([lot, items]) => {
  const subKg = items.reduce((s, r) => s + r.weight, 0)
  const lp = labelPosOf(items)
  return `
  <div class="section-title">Lot: ${lot} — ${items[0]?.product_name ?? ''}${lp ? `　·　ป้าย: ${lp.replace(/^[^ก-๙A-Za-z]+/, '')}` : ''}</div>
  <table>
    <thead><tr>
      <th style="width:5%">ลำดับ</th><th style="width:9%">ม้วนที่</th>
      <th style="width:9%">เครื่อง</th><th style="width:16%">นน.เต็ม</th>
      <th style="width:14%">นน.แกน</th><th style="width:18%">นน.สุทธิ (Kgs.)</th>
      <th style="width:14%">ผู้ตรวจ</th><th>เวลาชั่ง</th>
    </tr></thead>
    <tbody>
      ${items.map((r, i) => `<tr>
        <td style="text-align:center">${i+1}</td>
        <td style="text-align:center;font-weight:700">${r.roll_no}</td>
        <td style="text-align:center">${r.machine_no??'—'}</td>
        <td style="text-align:right">${fmt((r.weight??0)+(r.core_weight??0))}</td>
        <td style="text-align:right">${fmt(r.core_weight??0)}</td>
        <td style="text-align:right;font-weight:700">${fmt(r.weight??0)}</td>
        <td>${r.inspector??'—'}</td>
        <td>${fmtDT(r.created_at)}</td>
      </tr>`).join('')}
      <tr class="tot">
        <td colspan="5" style="text-align:right">รวม Lot ${lot}</td>
        <td style="text-align:right">${subKg.toFixed(2)}</td>
        <td>${items.length} ม้วน</td><td></td>
      </tr>
    </tbody>
  </table>`
}).join('')}
<table><tr class="tot" style="font-size:13pt">
  <td colspan="5" style="text-align:right;padding:3mm">รวมทั้งสิ้น</td>
  <td style="text-align:right;padding:3mm">${totalKg.toFixed(2)} Kgs.</td>
  <td style="text-align:center;padding:3mm">${rolls.length} ม้วน</td><td></td>
</tr></table>
<div class="sign">
  <div class="sign-box"><div class="sign-line"></div><div><b>${staff}</b></div><div style="font-size:9pt;color:#555">ผู้จัดส่ง</div></div>
  <div class="sign-box"><div class="sign-line"></div><div>...........................</div><div style="font-size:9pt;color:#555">ผู้รับสินค้า</div></div>
  <div class="sign-box"><div class="sign-line"></div><div>...........................</div><div style="font-size:9pt;color:#555">ผู้อนุมัติ</div></div>
</div>
<script>window.onload=()=>{setTimeout(()=>window.print(),400)}<\/script>
</body></html>`)
  win.document.close()
}

// ── ใบกำกับน้ำหนัก (เลือกม้วนอิสระจากคลัง) ────────────────────────────────
// พิมพ์อย่างเดียว — ไม่ตัดสต็อก ไม่แตะสถานะ shipped (เหมือน Export ใบกำกับน้ำหนักในแท็บจัดส่ง)
// อ่านตัวเลขที่ผู้ใช้พิมพ์ — ต้องทนลูกน้ำคั่นหลัก เพราะทั้งหน้าโชว์เลขแบบ "12,000.0" (toLocaleString)
// คนคลังจะพิมพ์ตามที่เห็น ถ้าใช้ parseFloat ตรง ๆ "12,000" จะกลายเป็น 12 → จัดของขาดไป 3 ตัวเลข
function numOf(s: string): number {
  const v = parseFloat(String(s ?? '').replace(/[,\s]/g, ''))
  return isFinite(v) ? v : 0
}
// เลข SO ที่พิมพ์ที่เครื่องเป็น free text — กัน "SO-1234" / "so 1234" แตกเป็นคนละใบ
function normSO(s: any): string {
  return String(s ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
}
function esc(s: any) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c] as string))
}
// จัดกลุ่มม้วนตาม สินค้า + Lot (เรียงสินค้า → Lot → เลขม้วน)
function groupForSlip(rolls: any[]) {
  const map = new Map<string, { product: string; lot: string; wo: string; customer: string; rolls: any[] }>()
  rolls.forEach(r => {
    const k = `${r.product_name ?? '?'}__${r.lot_no ?? '?'}__${(r.work_order ?? '').trim()}`
    if (!map.has(k)) map.set(k, { product: r.product_name ?? '—', lot: r.lot_no ?? '—',
      wo: (r.work_order ?? '').trim(), customer: r.customer ?? '—', rolls: [] })
    map.get(k)!.rolls.push(r)
  })
  const out = Array.from(map.values())
  out.forEach(g => g.rolls.sort((a, b) => (a.roll_no ?? 0) - (b.roll_no ?? 0) || (a.created_at ?? '').localeCompare(b.created_at ?? '')))
  return out.sort((a, b) => a.product.localeCompare(b.product) || a.lot.localeCompare(b.lot) || a.wo.localeCompare(b.wo))
}

function printWeightSlip(rolls: any[], staff: string, note: string) {
  if (!rolls.length) return
  const groups   = groupForSlip(rolls)
  const totalNet = rolls.reduce((s, r) => s + (r.weight ?? 0), 0)
  const totalCore= rolls.reduce((s, r) => s + (r.core_weight ?? 0), 0)
  const custs    = Array.from(new Set(rolls.map(r => r.customer).filter(Boolean)))
  const win = window.open('', '_blank', 'width=900,height=700')
  if (!win) { alert('เบราว์เซอร์บล็อกป็อปอัพ — อนุญาต popup ของเว็บนี้ก่อนแล้วลองใหม่'); return }
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>ใบกำกับน้ำหนัก</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Sarabun','Tahoma',sans-serif;font-size:11pt;color:#000;background:#fff;padding:10mm}
.head{text-align:center;border-bottom:2px solid #000;padding-bottom:3mm;margin-bottom:4mm}
.head h1{font-size:13pt;font-weight:800}
.head h2{font-size:18pt;font-weight:900;margin-top:2mm}
.info{display:flex;justify-content:space-between;margin-bottom:4mm;font-size:10pt;gap:6mm}
.info-row{margin-bottom:1mm}
.info-row b{display:inline-block;min-width:26mm}
.section-title{background:#003087;color:#fff;font-weight:700;padding:1.5mm 3mm;font-size:10pt}
table{width:100%;border-collapse:collapse;margin-bottom:4mm}
th,td{border:1px solid #aaa;padding:1.5mm 2.5mm;font-size:9.5pt}
th{background:#f5f5f5;font-weight:700;text-align:left}
.tot{background:#003087;color:#fff;font-weight:800}
.sign{display:flex;justify-content:space-around;margin-top:15mm}
.sign-box{flex:1;text-align:center}
.sign-line{border-top:1px solid #000;margin-top:18mm;padding-top:1mm;font-size:9pt}
tr{page-break-inside:avoid}
@media print{@page{size:A4;margin:8mm}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<div class="head">
  <h1>บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด</h1>
  <h2>ใบกำกับน้ำหนัก</h2>
  <p style="font-size:9pt;color:#555">WEIGHT LIST</p>
</div>
<div class="info">
  <div>
    <div class="info-row"><b>วันที่:</b> ${thaiDate()}</div>
    <div class="info-row"><b>ลูกค้า:</b> ${esc(custs.join(', ') || '—')}</div>
  </div>
  <div>
    <div class="info-row"><b>ผู้จัดของ:</b> ${esc(staff || '—')}</div>
    <div class="info-row"><b>หมายเหตุ:</b> ${esc(note || '—')}</div>
  </div>
  <div>
    <div class="info-row"><b>จำนวน:</b> ${rolls.length} ม้วน</div>
    <div class="info-row"><b>น้ำหนักสุทธิรวม:</b> ${totalNet.toFixed(2)} Kgs.</div>
  </div>
</div>
${groups.map(g => {
  const subNet = g.rolls.reduce((s, r) => s + (r.weight ?? 0), 0)
  const lp = labelPosOf(g.rolls)
  return `
  <div class="section-title">${esc(g.product)}　·　Lot: ${esc(g.lot)}${g.wo ? `　·　WO: ${esc(g.wo)}` : ''}${lp ? `　·　ป้าย: ${esc(lp.replace(/^[^ก-๙A-Za-z]+/, ''))}` : ''}</div>
  <table>
    <thead><tr>
      <th style="width:6%">ลำดับ</th><th style="width:9%">ม้วนที่</th><th style="width:9%">เครื่อง</th>
      <th style="width:14%">นน.เต็ม</th><th style="width:12%">นน.แกน</th><th style="width:16%">นน.สุทธิ (Kgs.)</th>
      <th style="width:13%">ผู้ตรวจ</th><th>วันผลิต</th>
    </tr></thead>
    <tbody>
      ${g.rolls.map((r, i) => `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td style="text-align:center;font-weight:700">${r.roll_no ?? '—'}</td>
        <td style="text-align:center">${esc(r.machine_no ?? '—')}</td>
        <td style="text-align:right">${fmt((r.weight ?? 0) + (r.core_weight ?? 0))}</td>
        <td style="text-align:right">${fmt(r.core_weight ?? 0)}</td>
        <td style="text-align:right;font-weight:700">${fmt(r.weight ?? 0)}</td>
        <td>${esc(r.inspector ?? '—')}</td>
        <td>${r.created_at ? fmtDT(r.created_at) : '—'}</td>
      </tr>`).join('')}
      <tr class="tot">
        <td colspan="5" style="text-align:right">รวม Lot ${esc(g.lot)}</td>
        <td style="text-align:right">${subNet.toFixed(2)}</td>
        <td colspan="2">${g.rolls.length} ม้วน</td>
      </tr>
    </tbody>
  </table>`
}).join('')}
<table><tr class="tot" style="font-size:12.5pt">
  <td colspan="4" style="text-align:right;padding:3mm">รวมทั้งสิ้น (แกน ${totalCore.toFixed(2)} Kgs.)</td>
  <td style="text-align:right;padding:3mm">${totalNet.toFixed(2)} Kgs.</td>
  <td style="text-align:center;padding:3mm;width:20%">${rolls.length} ม้วน</td>
</tr></table>
<div class="sign">
  <div class="sign-box"><div class="sign-line"></div><div><b>${esc(staff || '...........................')}</b></div><div style="font-size:9pt;color:#555">ผู้จัดของ / ผู้ชั่ง</div></div>
  <div class="sign-box"><div class="sign-line"></div><div>...........................</div><div style="font-size:9pt;color:#555">ผู้ตรวจสอบ</div></div>
  <div class="sign-box"><div class="sign-line"></div><div>...........................</div><div style="font-size:9pt;color:#555">ผู้รับ</div></div>
</div>
<script>window.onload=()=>{setTimeout(()=>window.print(),400)}<\/script>
</body></html>`)
  win.document.close()
}

// Export ใบกำกับน้ำหนักเป็น Excel — คอลัมน์ชุดเดียวกับใบพิมพ์
function exportWeightSlipExcel(rolls: any[], staff: string, note: string) {
  if (!rolls.length) return
  const groups   = groupForSlip(rolls)
  const totalNet = rolls.reduce((s, r) => s + (r.weight ?? 0), 0)
  const totalCore= rolls.reduce((s, r) => s + (r.core_weight ?? 0), 0)
  const custs    = Array.from(new Set(rolls.map(r => r.customer).filter(Boolean)))
  const aoa: any[][] = [
    ['บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด'],
    ['ใบกำกับน้ำหนัก'],
    [],
    ['วันที่ :', new Date().toLocaleDateString('th-TH', { timeZone:'Asia/Bangkok' }), '', 'ผู้จัดของ :', staff || '', '', 'หมายเหตุ :', note || ''],
    ['ลูกค้า :', custs.join(', '), '', 'จำนวน :', `${rolls.length} ม้วน`, '', 'นน.สุทธิรวม :', Number(totalNet.toFixed(2))],
    [],
  ]
  groups.forEach(g => {
    aoa.push([`${g.product} · Lot ${g.lot}${g.wo ? ` · WO ${g.wo}` : ''}`])
    aoa.push(['ลำดับ','ม้วนที่','เครื่อง','นน.เต็ม (kg)','นน.แกน (kg)','นน.สุทธิ (kg)','ผู้ตรวจ','วันผลิต'])
    g.rolls.forEach((r, i) => aoa.push([
      i + 1, r.roll_no ?? '', r.machine_no ?? '',
      Number(((r.weight ?? 0) + (r.core_weight ?? 0)).toFixed(2)),
      Number((r.core_weight ?? 0).toFixed(2)),
      Number((r.weight ?? 0).toFixed(2)),
      r.inspector ?? '', r.created_at ? fmtDT(r.created_at) : '',
    ]))
    const subNet = g.rolls.reduce((s, r) => s + (r.weight ?? 0), 0)
    aoa.push(['', `รวม ${g.rolls.length} ม้วน`, '', '', '', Number(subNet.toFixed(2)), '', ''])
    aoa.push([])
  })
  aoa.push(['', 'รวมทั้งสิ้น', `${rolls.length} ม้วน`, '', Number(totalCore.toFixed(2)), Number(totalNet.toFixed(2)), '', ''])

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{wch:7},{wch:9},{wch:9},{wch:14},{wch:14},{wch:16},{wch:13},{wch:18}]
  ws['!merges'] = [{ s:{r:0,c:0}, e:{r:0,c:7} }, { s:{r:1,c:0}, e:{r:1,c:7} }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'ใบกำกับน้ำหนัก')
  XLSX.writeFile(wb, `ใบกำกับน้ำหนัก_${new Date().toISOString().slice(0,10)}.xlsx`)
}

// ── Modal สร้าง SO ─────────────────────────────────────────────────────────
function SOModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ so_no: '', customer: '', product_name: '', target_kg: '', note: '' })
  const [saving, setSaving] = useState(false)
  async function save() {
    if (!form.so_no.trim() || !form.customer.trim()) { alert('กรุณากรอก SO No. และลูกค้า'); return }
    setSaving(true)
    const { error } = await supabase.from('sales_orders').insert({
      so_no: form.so_no.trim(),
      customer: form.customer.trim(),
      product_name: form.product_name.trim(),
      target_kg: parseFloat(form.target_kg) || 0,
      note: form.note.trim(),
      status: 'open',
    })
    setSaving(false)
    if (error) { alert('บันทึกไม่สำเร็จ: ' + error.message); return }
    onSaved()
  }
  const F = (label: string, key: keyof typeof form, ph = '', type = 'text') => (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <input type={type} value={form[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
        placeholder={ph}
        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-brand-500"/>
    </div>
  )
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <p className="text-white font-bold">สร้าง Sales Order ใหม่</p>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18}/></button>
        </div>
        <div className="p-5 space-y-3">
          {F('SO No. *', 'so_no', 'เช่น SO-2024-001')}
          {F('ลูกค้า *', 'customer', 'ชื่อลูกค้า')}
          {F('สินค้า', 'product_name', 'ชื่อสินค้า')}
          {F('จำนวนที่ต้องส่ง (Kgs.)', 'target_kg', '0.00', 'number')}
          {F('หมายเหตุ', 'note', 'หมายเหตุเพิ่มเติม')}
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-slate-800">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-700 text-slate-400 hover:text-white text-sm">ยกเลิก</button>
          <button onClick={save} disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white font-bold text-sm">
            {saving ? 'กำลังบันทึก...' : 'บันทึก SO'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────
const RETURN_TO_REWORK_TYPES = [
  { key:'qc_reject',        no:'1.4', label:'ตรวจไม่ผ่านก่อนโหลด',     emoji:'🚫' },
  { key:'warehouse_damage', no:'1.5', label:'เสียจากคลัง/เคลื่อนย้าย', emoji:'📦' },
] as const

// เลือกเฉพาะคอลัมน์ที่หน้านี้ใช้จริง (ลด Egress — เดิมดึง * ทุกคอลัมน์)
const RCOLS = 'id,roll_no,roll_type,weight,gross_weight,core_weight,machine_no,lot_no,product_name,product_code,item_code,mat_code,customer,cust_code,cust_branch,inspector,created_at,transferred_at,transferred,shipped,shipped_at,shipped_by,ship_doc_no,so_id,sale_order,work_order,section,width_cm,thick_mc,width_unit,length,pcs,inbound_type,remark,rework_source_lot,rework_source_roll_id,review_status,label_position,new_system,rework_remark'
const LABELPOS_TH: Record<string,string> = { head: '🔝 แปะหัว', side: '↔ แปะข้าง' }
// สรุปตำแหน่งแปะป้ายของกลุ่มม้วน: ตรงกันหมด → ค่านั้น, ต่างกัน → "หลายแบบ", ไม่มี → ''
function labelPosOf(rolls: any[]): string {
  const set = new Set(rolls.map(r => (r.label_position ?? '').trim()).filter(Boolean))
  if (set.size === 0) return ''
  if (set.size === 1) return LABELPOS_TH[[...set][0]] ?? [...set][0]
  return '⚠ หลายแบบ'
}
// สต็อกคงเหลือ = โอนแล้ว & ยังไม่ขาย
const stockQ = () => supabase.from('production_rolls').select(RCOLS)
  .eq('transferred', true).not('shipped', 'is', true)
  .order('created_at', { ascending: false }).order('id', { ascending: false })
// เขียนสถานะจัดส่ง — เขียนเฉพาะม้วนที่ "ยังไม่ถูกส่ง" เท่านั้น
//   กันเคสสองคนเปิดคลังพร้อมกัน หยิบม้วนเดียวกัน กดส่งทั้งคู่ → ม้วนเดียวไปโผล่สองใบ ยอดใบแรกผิดเงียบๆ
//   .select('id') คืนเฉพาะแถวที่อัปเดตสำเร็จจริง → เอามานับเทียบได้ว่าโดนตัดหน้าไปกี่ม้วน
//   เงื่อนไขต้องตรงกับนิยาม "ของที่อยู่ในคลัง" (stockQ + roll_type='good') ไม่ใช่แค่ยังไม่ถูกส่ง
//   ไม่งั้นม้วนที่เพิ่งถูกแจ้ง NC ออกไป (roll_type='bad', transferred=false, shipped ยังเป็น false)
//   ยังผ่านด่านนี้ได้ → ของเสียหลุดขึ้นใบส่งไปหาลูกค้า
function shipRolls(ids: string[], at: string, by: string, docNo: string) {
  return supabase.from('production_rolls')
    .update({ shipped: true, shipped_at: at, shipped_by: by, ship_doc_no: docNo })
    .in('id', ids)
    .not('shipped', 'is', true)
    .eq('transferred', true)
    .eq('roll_type', 'good')
    .select('id')
}
// เส้นแบ่ง "ใหม่/เก่า" = 7 วันล่าสุด (~4 พันม้วน ขึ้นหน้าได้ในไม่กี่วินาที)
// ที่เหลืออีก 3 หมื่นกว่าม้วนตามมาเบื้องหลัง
const RECENT_CUTOFF = new Date(Date.now() - 7 * 864e5).toISOString()

export default function Warehouse({ dept }: { dept?: 'blow'|'print'|'rewind' }) {
  const [tab, setTab] = useState<Tab>('stock')
  const [rolls, setRolls] = useState<Roll[]>([])
  const [scrapRolls, setScrapRolls] = useState<any[]>([])
  const [ncRolls, setNcRolls] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [olderLoading, setOlderLoading] = useState(false)   // สต็อกเก่ากว่า 7 วันกำลังโหลด
  const [olderLoaded, setOlderLoaded]   = useState(false)
  const [totalStockN, setTotalStockN]   = useState<number | null>(null)  // ยอดม้วนดีคงเหลือทั้งหมด (head count)
  const [scrapLoading, setScrapLoading] = useState(false)
  const [scrapLoaded, setScrapLoaded]   = useState(false)
  const [histRolls, setHistRolls]     = useState<any[]>([])   // ม้วนที่เบิก/ส่งออกแล้ว (ประวัติ)
  const [histLoading, setHistLoading] = useState(false)
  const [histLoaded, setHistLoaded]   = useState(false)
  const [replaceGroup, setReplaceGroup] = useState<any | null>(null)  // ใบเบิกที่กำลังหาม้วนมาแทน

  // stock filters
  // คลังเป็นข้อมูลร่วม — แสดง "ทั้งหมด" เป็นค่าเริ่มต้น (ไม่ filter ตาม dept)
  const [fSection, setFSection] = useState<''|'blow'|'print'|'rewind'>('')
  const [fProduct, setFProduct] = useState('')
  const [fCustomer, setFCustomer] = useState('')
  const [fLot, setFLot] = useState('')
  const [fSize, setFSize] = useState('')
  const [search, setSearch] = useState('')
  const [expandedLots, setExpandedLots] = useState<Set<string>>(new Set())
  const [stockCollapsedDays, setStockCollapsedDays] = useState<Set<string>>(new Set())   // วันโอนเข้าที่ยุบในสต็อก

  // ── ใบกำกับน้ำหนัก (แท็บสต็อก) — ติ๊กม้วนอิสระข้ามสินค้า/ข้าม Lot แล้วพิมพ์ ──
  //    พิมพ์อย่างเดียว ไม่ตัดสต็อก — ม้วนยังอยู่ในคลังจนกว่าจะไปกดจัดส่งจริง
  //   เก็บ "ตัวม้วน" ไม่ใช่แค่ id — เพราะ loadAll/รีเฟรช จะยุบ rolls เหลือ 7 วันล่าสุด
  //   ถ้าเก็บแค่ id แล้วไปหาใน stock ตอนพิมพ์ ม้วนเก่าที่ติ๊กไว้จะหายจากใบเงียบ ๆ ทั้งที่แถบยังนับให้
  const [wsSel,   setWsSel]   = useState<Map<string, Roll>>(new Map())
  const [wsStaff, setWsStaff] = useState('')
  const [wsNote,  setWsNote]  = useState('')

  // shipment state
  const [selSoNo, setSelSoNo] = useState<string | null>(null)     // SO ที่เลือกในแท็บจัดส่ง (เลขจากม้วน ไม่ใช่ตาราง sales_orders)
  const [selectedRolls, setSelectedRolls] = useState<Set<string>>(new Set())
  const [soTargetInput, setSoTargetInput] = useState('')          // เป้าจัดส่งรอบนี้ (เว้นว่าง = ยอดที่ยังค้างของ SO)
  const [soOpenWO, setSoOpenWO] = useState<Set<string>>(new Set())
  // เป้าจากแผน: WO → planned_qty (machine_profiles = งานบนเครื่องตอนนี้, job_summaries = งานที่ปิดแล้ว)
  const [woTarget, setWoTarget] = useState<Map<string, number>>(new Map())
  // SO → WO ที่ยังอยู่บนเครื่อง (ของยังไม่เข้าคลัง) เพื่อให้เป้าของ SO ครบทั้งใบ ไม่ใช่เฉพาะที่ผลิตเสร็จ
  const [soPlanWOs, setSoPlanWOs] = useState<Map<string, Set<string>>>(new Map())
  const [returnModal, setReturnModal] = useState<any | null>(null)
  const [expandedRoll, setExpandedRoll] = useState<string | null>(null)
  const [shipStaff, setShipStaff] = useState('')
  const [shipping, setShipping] = useState(false)

  // ── จัดส่งตาม Item (แท็บใหม่) ──────────────────────────────────────────────
  const [delItem,   setDelItem]   = useState<string | null>(null)   // item_code ที่เลือก
  const [delSel,    setDelSel]    = useState<Set<string>>(new Set()) // roll id ที่ติ๊กส่ง
  const [delTarget, setDelTarget] = useState('')                     // เป้า kg (พิมพ์เอง)
  const [delStaff,  setDelStaff]  = useState('')
  const [delShipping, setDelShipping] = useState(false)
  const [delSearch, setDelSearch] = useState('')
  const [delOpenWO, setDelOpenWO] = useState<Set<string>>(new Set())  // WO ที่กางดูม้วน

  async function loadAll() {
    const wasFull = olderLoaded   // ถ้าเคยโหลดสต็อกเก่าครบแล้ว → รีเฟรชเสร็จค่อยโหลดกลับให้ (ไม่ยุบเหลือ 7 วัน)
    setLoading(true)
    setScrapLoaded(false)
    setOlderLoaded(false)
    setHistLoaded(false)   // ต้องรีเซ็ตด้วย ไม่งั้นกดรีเฟรชแล้วประวัติ/ยอด "ส่งแล้ว" ของ SO ยังค้างของเก่า
                           // (เห็นชัดเมื่อคนอื่นจัดส่งจากอีกเครื่อง — ใบของเขาจะไม่โผล่จนกว่าจะรีโหลดหน้า)
    // จังหวะ 1 — โหลดเฉพาะสต็อก 7 วันล่าสุด (~ไม่กี่พันม้วน) ให้หน้าขึ้นทันที
    //   สต็อกเก่ากว่านั้นสะสม 3-4 หมื่นม้วนและแทบไม่เปลี่ยน — ไม่ดึงอัตโนมัติแล้ว
    //   นับ "ยอดรวมทั้งหมด" ด้วย head count (ไม่ดึงแถว) เพื่อโชว์เลขจริงโดยไม่กินแบนด์วิดท์
    const [rNew, nc, { count: totalN }] = await Promise.all([
      fetchAll(() => stockQ().gte('created_at', RECENT_CUTOFF)),
      // ม้วนที่ถูกแจ้ง NC ออกจากคลัง และ "ยังรอ ผจก ตัดสิน" เท่านั้น
      fetchAll(() => supabase.from('production_rolls').select(RCOLS)
        .eq('roll_type', 'bad')
        .eq('review_status', 'pending_review')
        .in('inbound_type', ['qc_reject','warehouse_damage'])
        .order('created_at', { ascending: false }).order('id', { ascending: false })),
      supabase.from('production_rolls').select('id', { count: 'exact', head: true })
        .eq('transferred', true).not('shipped', 'is', true).eq('roll_type', 'good'),
    ])
    setRolls((rNew ?? []) as Roll[])
    setNcRolls(nc ?? [])
    setTotalStockN(totalN ?? null)
    setLoading(false)

    loadPlanTargets()               // เป้าจากแผน (ตารางเล็ก โหลดพื้นหลังได้)
    if (wasFull) await loadOlderNow()  // คืนสภาพ "โหลดครบ" หลังรีเฟรช
  }

  // ดึงสต็อกเก่าจริง ๆ (ไม่มี guard) — แยกออกมาเพราะ loadOlder() ที่ loadAll ปิดทับไว้
  // ยังเห็น olderLoaded=true ของ render ก่อนรีเฟรช เลย return ทิ้งทันที ทำให้ "คืนสภาพโหลดครบ" ไม่เคยทำงาน
  async function loadOlderNow() {
    setOlderLoading(true)
    const rOld = await fetchAll(() => stockQ().lt('created_at', RECENT_CUTOFF))
    setRolls(prev => [...prev, ...(rOld ?? [])] as Roll[])
    setOlderLoaded(true)
    setOlderLoading(false)
  }

  // ── เป้าจากแผนการวางแผน — WO → planned_qty ────────────────────────────────
  //   job_summaries มีแถวซ้ำต่อ WO (งานเดิมถูกปิดหลายรอบ) → ห้ามบวกทบ ใช้ค่าต่อ WO ค่าเดียว
  //   งานที่ยังอยู่บนเครื่อง (machine_profiles) ถือว่าใหม่กว่า → ทับค่าจาก job_summaries
  async function loadPlanTargets() {
    const [{ data: mp }, js] = await Promise.all([
      supabase.from('machine_profiles').select('machine_no, work_order, sale_order, planned_qty'),
      // ต้อง .order() — fetchAll ยิงหลายหน้าพร้อมกันด้วย .range() ถ้าไม่เรียง Postgres ไม่รับประกันลำดับ
      // ผลคือบางแถวมาซ้ำ บางแถวหายไปเลย → WO นั้นจะกลายเป็น "ไม่มีเป้าในแผน" แบบสุ่มทุกครั้งที่โหลด
      fetchAll(() => supabase.from('job_summaries').select('work_order, planned_qty')
        .order('work_order', { ascending: true }).order('closed_at', { ascending: true })),
    ])
    const m = new Map<string, number>()
    const put = (wo: any, q: any, force = false) => {
      const k = String(wo ?? '').trim()
      const v = parseFloat(String(q ?? '')) || 0
      if (!k || v <= 0) return
      if (force || !m.has(k) || v > (m.get(k) ?? 0)) m.set(k, v)
    }
    ;(js ?? []).forEach((r: any) => put(r.work_order, r.planned_qty))
    ;(mp ?? []).forEach((r: any) => put(r.work_order, r.planned_qty, true))
    setWoTarget(m)

    // WO ของแต่ละ SO ที่ยัง "อยู่บนเครื่อง" — ของยังไม่เข้าคลังจึงไม่มีม้วนให้จับกลุ่ม
    // ถ้าไม่รวมตรงนี้ เป้าของ SO จะนับเฉพาะ WO ที่ผลิตเสร็จแล้ว → SO ขึ้น "ส่งครบ" ทั้งที่ยังผลิตไม่หมด
    const s2w = new Map<string, Set<string>>()
    ;(mp ?? []).forEach((r: any) => {
      const so = normSO(r.sale_order), wo = String(r.work_order ?? '').trim()
      if (!so || !wo) return
      if (!s2w.has(so)) s2w.set(so, new Set())
      s2w.get(so)!.add(wo)
    })
    setSoPlanWOs(s2w)
  }
  useEffect(() => { loadAll() }, [])

  // โหลดสต็อกเก่ากว่า 7 วัน — เรียกเมื่อผู้ใช้กดปุ่ม หรือเริ่มค้นหา/กรอง (ต้องเห็นครบ)
  async function loadOlder() {
    if (olderLoaded || olderLoading) return
    setOlderLoading(true)
    const rOld = await fetchAll(() => stockQ().lt('created_at', RECENT_CUTOFF))
    setRolls(prev => [...prev, ...(rOld ?? [])] as Roll[])
    setOlderLoaded(true)
    setOlderLoading(false)
  }
  // ค้นหา/กรอง หรือเข้าแท็บที่ต้องเห็นสต็อกครบ (SO/จัดส่ง) → ดึงส่วนเก่าให้อัตโนมัติ
  const hasFilter = !!(search || fProduct || fCustomer || fLot || fSize || fSection)
  const needFullStock = hasFilter || tab === 'so' || tab === 'ship' || tab === 'delivery'
  useEffect(() => {
    if (needFullStock && !olderLoaded && !olderLoading && !loading) loadOlder()
  }, [needFullStock, olderLoaded, olderLoading, loading])

  // เศษ — โหลดตอนเปิดแท็บเศษเท่านั้น (3 พันกว่าแถว ไม่ต้องรอตั้งแต่เปิดหน้า)
  useEffect(() => {
    if (tab !== 'scrap' || scrapLoaded || scrapLoading) return
    setScrapLoading(true)
    // ห้าม gate ผลลัพธ์ด้วยธง alive — ถ้าทิ้งผลเพราะสลับแท็บ scrapLoaded จะไม่ถูกตั้ง
    // แต่ effect รอบใหม่ถูกกันด้วย scrapLoading ที่ยัง true อยู่ → กลับมาแท็บนี้แล้วค้าง "กำลังโหลด" ถาวร
    // ข้อมูลชุดนี้ไม่ผูกกับแท็บ เก็บไว้เลยปลอดภัยกว่า
    fetchAll(() => supabase.from('production_rolls').select(RCOLS)
      .in('roll_type', ['scrap_clear','scrap_color','scrap_lump'])
      .order('created_at', { ascending: false }).order('id', { ascending: false }))
      .then(sc => { setScrapRolls(sc ?? []); setScrapLoaded(true) })
      .finally(() => setScrapLoading(false))
  }, [tab, scrapLoaded, scrapLoading])

  // ม้วนที่ส่งออกไปแล้ว — ใช้ทั้งแท็บประวัติ และคิดยอด "ส่งแล้ว" ของแต่ละ SO
  useEffect(() => {
    if (!['history','so','ship'].includes(tab) || histLoaded || histLoading) return
    setHistLoading(true)
    // เหตุผลเดียวกับแท็บเศษ — ห้ามทิ้งผลเมื่อสลับแท็บ ไม่งั้นค้าง "กำลังโหลด" ถาวร
    // และแท็บ SO/จัดส่งจะเห็น "ส่งไปแล้ว 0" ทั้งที่จริงมีส่งไปแล้ว → เป้าที่เหลือผิด ส่งเกิน
    fetchAll(() => supabase.from('production_rolls').select(RCOLS)
      .eq('shipped', true)
      .order('shipped_at', { ascending: false }).order('id', { ascending: false }))
      .then(h => { setHistRolls(h ?? []); setHistLoaded(true) })
      .finally(() => setHistLoading(false))
  }, [tab, histLoaded, histLoading])

  // จัดกลุ่มประวัติเป็น "ใบเบิก" — ตามเลขใบ (ship_doc_no) ถ้าไม่มีก็ตาม shipped_at+ผู้เบิก
  const shipmentHistory = useMemo(() => {
    const map = new Map<string, { key: string; docNo: string; at: string; by: string; customer: string; product: string; itemCode: string; soId: string | null; so: string; rolls: any[] }>()
    histRolls.forEach(r => {
      const doc = (r.ship_doc_no ?? '').trim()
      const k = doc || `${r.shipped_at ?? '?'}__${r.shipped_by ?? '?'}`
      if (!map.has(k)) map.set(k, { key: k, docNo: doc, at: r.shipped_at ?? '', by: r.shipped_by ?? '—',
        customer: r.customer ?? '—', product: r.product_name ?? '—', itemCode: (r as any).item_code ?? '', soId: r.so_id ?? null, so: ((r as any).sale_order ?? '').trim(), rolls: [] })
      const g = map.get(k)!
      if (r.shipped_at && (!g.at || r.shipped_at > g.at)) g.at = r.shipped_at
      g.rolls.push(r)
    })
    return Array.from(map.values()).sort((a, b) => (b.at || '').localeCompare(a.at || ''))
  }, [histRolls])
  const histTotalKg = useMemo(() => histRolls.reduce((s, r) => s + (r.weight ?? 0), 0), [histRolls])

  // stock = ม้วนดี (good) ที่ transferred แต่ยังไม่ shipped
  // กรอง roll_type='good' กันม้วนเศษ/กรอ (roll_no=0 หรือเลขซ้ำ) เล็ดลอดเข้าคลัง
  const goodRolls = useMemo(() => rolls.filter(r => ((r as any).roll_type ?? 'good') === 'good'), [rolls])
  const stock = useMemo(() => goodRolls.filter(r => !r.shipped), [goodRolls])

  // filter stock
  // helper: สร้าง size label จาก width_cm × thick_mc (รองรับหน่วย mm)
  function sizeLabel(r: Roll) {
    const u = ((r as any).width_unit ?? 'cm') as 'cm'|'mm'
    if (r.width_cm && r.thick_mc) return `${r.width_cm}${u}×${r.thick_mc}mc`
    return ''
  }

  const filteredStock = useMemo(() => stock.filter(r =>
    // section: รวมม้วนเก่าที่ section=null เข้ากับแผนกเป่า (default) เพื่อให้ History/Warehouse นับตรงกัน
    (!fSection  || (r as any).section === fSection || ((r as any).section == null && fSection === 'blow')) &&
    (!fProduct  || r.product_name === fProduct) &&
    (!fCustomer || r.customer === fCustomer) &&
    (!fLot      || r.lot_no === fLot) &&
    (!fSize     || sizeLabel(r) === fSize) &&
    (!search    || String(r.roll_no).includes(search) || (r.lot_no ?? '').toLowerCase().includes(search.toLowerCase())
      || ((r as any).work_order ?? '').toLowerCase().includes(search.toLowerCase())
      || ((r as any).sale_order ?? '').toLowerCase().includes(search.toLowerCase()))
  ), [stock, fSection, fProduct, fCustomer, fLot, fSize, search])

  // ม้วนกรอ (ผลผลิตจากแผนกกรอ) = ม้วนดีที่มี rework_source ติดมา
  const isReworkRoll = (r: any) => !!(r.rework_source_roll_id || r.rework_source_lot)

  // group stock by lot + WO (กัน 2 งานปน Lot เดียว) + เก็บ SO / วันเริ่ม-จบ
  // ม้วนกรอจะถูกจับเข้ากลุ่ม Lot เป่าเดิม (rework_source_lot) ให้อยู่กับม้วนดีของ WO นั้น
  const stockByLot = useMemo(() => {
    const map = new Map<string, { lot: string; product: string; customer: string; size: string; wo: string; so: string; start: string; end: string; xfer: string; rolls: Roll[]; goodN: number; reworkN: number }>()
    filteredStock.forEach(r => {
      const rew = isReworkRoll(r)
      const groupLot = (rew && ((r as any).rework_source_lot ?? '').trim()) ? ((r as any).rework_source_lot as string).trim() : (r.lot_no ?? '?')
      const wo = ((r as any).work_order ?? '').trim()
      const so = ((r as any).sale_order ?? '').trim()
      const k = `${groupLot}__${r.product_name ?? '?'}__${wo}`
      if (!map.has(k)) map.set(k, { lot: groupLot, product: r.product_name ?? '?', customer: r.customer ?? '?', size: sizeLabel(r), wo, so, start: r.created_at, end: r.created_at, xfer: r.transferred_at ?? '', rolls: [], goodN: 0, reworkN: 0 })
      const g = map.get(k)!
      if (r.created_at && (!g.start || r.created_at < g.start)) g.start = r.created_at
      if (r.created_at && (!g.end   || r.created_at > g.end))   g.end   = r.created_at
      if (r.transferred_at && (!g.xfer || r.transferred_at > g.xfer)) g.xfer = r.transferred_at   // วันโอนเข้าคลังล่าสุดของกลุ่ม
      if (!g.so && so) g.so = so
      g.rolls.push(r)
      rew ? g.reworkN++ : g.goodN++
    })
    // เรียงในกลุ่ม: ม้วนเป่าดีก่อน (ตามเลขม้วน) → ม้วนกรออยู่ท้าย
    for (const g of map.values()) {
      g.rolls.sort((a, b) => {
        const ra = isReworkRoll(a) ? 1 : 0, rb = isReworkRoll(b) ? 1 : 0
        if (ra !== rb) return ra - rb
        return (a.roll_no ?? 0) - (b.roll_no ?? 0) || (a.created_at || '').localeCompare(b.created_at || '')
      })
    }
    return Array.from(map.values()).sort((a, b) => a.lot.localeCompare(b.lot) || a.wo.localeCompare(b.wo))
  }, [filteredStock])

  // จัดกลุ่มสต็อกตาม "วันโอนเข้าคลัง" (ใหม่→เก่า) — สำหรับหัวข้อวันในหน้าคลัง
  const stockByDay = useMemo(() => {
    const dayKeyOf = (g: any) => g.xfer
      ? new Date(g.xfer).toLocaleDateString('th-TH', { timeZone:'Asia/Bangkok', weekday:'short', day:'2-digit', month:'short', year:'2-digit' })
      : '— ไม่ระบุวันโอน'
    const sorted = [...stockByLot].sort((a, b) => (b.xfer || '').localeCompare(a.xfer || ''))
    const out: { day: string; items: typeof stockByLot }[] = []
    for (const g of sorted) {
      const day = dayKeyOf(g)
      const last = out[out.length - 1]
      if (last && last.day === day) last.items.push(g); else out.push({ day, items: [g] })
    }
    return out
  }, [stockByLot])

  // ── ม้วนที่ติ๊กไว้ทำใบกำกับน้ำหนัก (อิงสต็อกทั้งหมด ไม่ใช่เฉพาะที่กรองอยู่ — เปลี่ยนตัวกรองแล้วของที่เลือกไม่หาย) ──
  const wsPicked   = useMemo(() => Array.from(wsSel.values()), [wsSel])
  const wsPickedKg = useMemo(() => wsPicked.reduce((s, r) => s + (r.weight ?? 0), 0), [wsPicked])
  function toggleWsRoll(r: Roll) {
    setWsSel(p => { const n = new Map(p); n.has(r.id) ? n.delete(r.id) : n.set(r.id, r); return n })
  }
  function toggleWsGroup(rolls: Roll[]) {
    setWsSel(p => {
      const n = new Map(p)
      rolls.every(r => n.has(r.id)) ? rolls.forEach(r => n.delete(r.id)) : rolls.forEach(r => n.set(r.id, r))
      return n
    })
  }

  // ── เศษ (scrap) — เชื่อมจากงานผลิต/กรอ จัดกลุ่มตาม Lot/งาน ──
  const scrapByLot = useMemo(() => {
    const map = new Map<string, { lot: string; product: string; customer: string; machine: string; wo: string; so: string; rolls: any[] }>()
    scrapRolls.forEach(r => {
      const wo = ((r as any).work_order ?? '').trim()
      const k = `${r.lot_no ?? '?'}__${r.product_name ?? '?'}__${wo}`
      if (!map.has(k)) map.set(k, { lot: r.lot_no ?? '(ไม่ระบุ Lot)', product: r.product_name ?? '—', customer: r.customer ?? '—', machine: r.machine_no ?? '—', wo, so: ((r as any).sale_order ?? '').trim(), rolls: [] })
      map.get(k)!.rolls.push(r)
    })
    return Array.from(map.values()).sort((a, b) => a.lot.localeCompare(b.lot) || a.wo.localeCompare(b.wo))
  }, [scrapRolls])
  // ── NC ที่ออกจากคลัง — จัดกลุ่มตาม Lot เพื่อแจ้งเตือนในแต่ละกลุ่มสต็อก ──
  const ncByLotKey = useMemo(() => {
    const map = new Map<string, any[]>()
    ncRolls.forEach(r => {
      const k = `${r.lot_no ?? '?'}__${r.product_name ?? '?'}`
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(r)
    })
    return map
  }, [ncRolls])

  const scrapKg = useMemo(() => scrapRolls.reduce((s,r)=>s+(r.weight??0),0), [scrapRolls])
  const scrapByType = useMemo(() => {
    const m: Record<string,{kg:number;n:number}> = {}
    scrapRolls.forEach(r => { const t = r.roll_type; if(!m[t]) m[t]={kg:0,n:0}; m[t].kg+=(r.weight??0); m[t].n++ })
    return m
  }, [scrapRolls])

  // dropdown options
  const products  = useMemo(() => Array.from(new Set(stock.map(r => r.product_name).filter(Boolean))).sort(), [stock])
  const customers = useMemo(() => Array.from(new Set(stock.map(r => r.customer).filter(Boolean))).sort(), [stock])
  const lots      = useMemo(() => Array.from(new Set(stock.map(r => r.lot_no).filter(Boolean))).sort(), [stock])
  const sizes     = useMemo(() => Array.from(new Set(stock.map(r => sizeLabel(r)).filter(Boolean))).sort(), [stock])

  // ── สรุปราย SO — อ่านเลข SO จากม้วนโดยตรง (ไม่ใช้ตาราง sales_orders ที่ต้องพิมพ์เอง) ──
  //   1 SO กินได้หลาย WO และหลาย item (ข้อมูลจริงยืนยัน) → รวมทุกม้วนที่ sale_order ตรงกัน
  //   เป้า = ผลรวม planned_qty ของ WO ที่อยู่ใน SO นั้น (นับ WO ไม่ซ้ำ)
  type SOGroup = {
    so: string; customer: string; customers: string[]; products: string[]; wos: string[]
    stockRolls: Roll[]; stockKg: number; shipN: number; shipKg: number
    targetKg: number; producedKg: number; pct: number; lastAt: string
  }
  const soGroups = useMemo<SOGroup[]>(() => {
    const m = new Map<string, {
      so: string; customers: Set<string>; products: Set<string>; wos: Set<string>
      stockRolls: Roll[]; stockKg: number; shipN: number; shipKg: number; lastAt: string
    }>()
    const touch = (r: any) => {
      const so = normSO(r.sale_order)
      if (!so) return null
      if (!m.has(so)) m.set(so, { so, customers: new Set(), products: new Set(), wos: new Set(),
        stockRolls: [], stockKg: 0, shipN: 0, shipKg: 0, lastAt: '' })
      const g = m.get(so)!
      if (r.customer) g.customers.add(r.customer)
      if (r.product_name) g.products.add(r.product_name)
      const wo = String(r.work_order ?? '').trim()
      if (wo) g.wos.add(wo)
      const at = r.created_at ?? ''
      if (at > g.lastAt) g.lastAt = at
      return g
    }
    stock.forEach(r => { const g = touch(r); if (g) { g.stockRolls.push(r); g.stockKg += r.weight ?? 0 } })
    histRolls.forEach(r => { const g = touch(r); if (g) { g.shipN++; g.shipKg += r.weight ?? 0 } })

    return Array.from(m.values()).map(g => {
      // เป้า = ผลรวม planned_qty ของ WO ที่มีของอยู่ในคลัง/ส่งไปแล้ว + WO ของ SO นี้ที่ยังเดินอยู่บนเครื่อง
      // (ถ้าไม่รวมของบนเครื่อง เป้าจะโตตามของที่ทยอยเข้าคลัง แล้ว SO จะขึ้น "ส่งครบ" ทั้งที่ยังผลิตไม่หมด)
      const allWOs = new Set(g.wos)
      ;(soPlanWOs.get(g.so) ?? new Set<string>()).forEach(wo => allWOs.add(wo))
      const targetKg  = Array.from(allWOs).reduce((s, wo) => s + (woTarget.get(wo) ?? 0), 0)
      const producedKg = g.stockKg + g.shipKg
      const customers = Array.from(g.customers).sort()
      return {
        so: g.so, customer: customers[0] ?? '—', customers,
        products: Array.from(g.products).sort(), wos: Array.from(allWOs).sort(),
        stockRolls: g.stockRolls, stockKg: g.stockKg, shipN: g.shipN, shipKg: g.shipKg,
        targetKg, producedKg, lastAt: g.lastAt,
        pct: targetKg > 0 ? Math.min((g.shipKg / targetKg) * 100, 100) : 0,
      }
    }).sort((a, b) => b.lastAt.localeCompare(a.lastAt) || a.so.localeCompare(b.so))
  }, [stock, histRolls, woTarget, soPlanWOs])

  const selSO = useMemo(() => soGroups.find(g => g.so === selSoNo) ?? null, [soGroups, selSoNo])

  // ม้วนของ SO ที่เลือก จัดกลุ่มตาม WO เรียง FIFO (WO เก่าก่อน)
  const soWOs = useMemo(() => {
    if (!selSO) return [] as { wo: string; rolls: Roll[]; kg: number; start: string; product: string }[]
    const m = new Map<string, Roll[]>()
    for (const r of selSO.stockRolls) {
      const wo = String((r as any).work_order ?? '').trim() || '(ไม่ระบุ WO)'
      ;(m.get(wo) ?? m.set(wo, []).get(wo)!).push(r)
    }
    return Array.from(m.entries()).map(([wo, rolls]) => {
      const sorted = [...rolls].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
      return { wo, rolls: sorted, kg: sorted.reduce((s, r) => s + (r.weight ?? 0), 0),
        start: sorted[0]?.created_at ?? '', product: sorted[0]?.product_name ?? '' }
    }).sort((a, b) => a.start.localeCompare(b.start))
  }, [selSO])

  function toggleLot(key: string) {
    setExpandedLots(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })
  }
  function toggleRoll(id: string) {
    setSelectedRolls(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const pickedRolls = useMemo(() => (selSO?.stockRolls ?? []).filter(r => selectedRolls.has(r.id)), [selSO, selectedRolls])
  const pickedKg    = pickedRolls.reduce((s, r) => s + (r.weight ?? 0), 0)
  // ยอดที่ SO นี้ยังค้างส่ง (เป้า − ที่ส่งไปแล้ว) — ใช้เป็นค่าตั้งต้นของช่องเป้ารอบนี้
  const soRemainKg  = selSO ? Math.max(selSO.targetKg - selSO.shipKg, 0) : 0
  const soTargetKg  = numOf(soTargetInput) || soRemainKg

  // จัดอัตโนมัติ: หยิบม้วนเรียง FIFO (WO เก่าก่อน) จนถึง/เกินเป้าเล็กน้อย
  function soAutoFill() {
    // ถ้ายอด "ส่งไปแล้ว" ยังมาไม่ครบ soRemainKg จะเท่ากับเป้าทั้งใบ → จัดของซ้ำกับที่ส่งไปแล้ว
    if (!histLoaded && !numOf(soTargetInput)) {
      alert('ยังโหลดยอดที่ส่งไปแล้วไม่เสร็จ — รอสักครู่ หรือใส่เป้าจัดส่ง (kg) เองก่อน'); return
    }
    if (soTargetKg <= 0) { alert('SO นี้ไม่มีเป้าจากแผน — ใส่เป้าจัดส่ง (kg) เองก่อน'); return }
    const flat = soWOs.flatMap(g => g.rolls)
    const sel = new Set<string>(); let sum = 0
    for (const r of flat) { if (sum >= soTargetKg) break; sel.add(r.id); sum += r.weight ?? 0 }
    setSelectedRolls(sel)
    setSoOpenWO(new Set(soWOs.filter(g => g.rolls.some(r => sel.has(r.id))).map(g => g.wo)))
  }

  async function handleShip() {
    if (!selSO) { alert('เลือก SO ก่อน'); return }
    if (!shipStaff.trim()) { alert('กรุณากรอกชื่อผู้จัดส่ง'); return }
    // ยิงเฉพาะม้วนที่ "จะพิมพ์ลงใบจริง" (pickedRolls) ไม่ใช่ทุก id ที่ค้างใน selectedRolls
    //   ระหว่างรีเฟรช rolls จะยุบเหลือ 7 วัน ทำให้ pickedRolls น้อยกว่า selectedRolls ชั่วคราว
    //   ถ้ายิงตาม id ทั้งหมด ของจะถูกตัดสต็อกมากกว่าที่พิมพ์ในใบ → ม้วนออกจากคลังโดยไม่มีเอกสาร
    if (pickedRolls.length === 0) { alert('เลือกม้วนที่จะส่งก่อน'); return }
    if (!confirm(`ยืนยันจัดส่ง ${pickedRolls.length} ม้วน · ${fmt(pickedKg)} Kgs. ?\nSO: ${selSO.so}\nลูกค้า: ${selSO.customer}`)) return

    setShipping(true)
    try {
      const now   = new Date().toISOString()
      const docNo = `DN-${Date.now().toString().slice(-8)}`
      const ids   = pickedRolls.map(r => r.id)

      const { data: done, error } = await shipRolls(ids, now, shipStaff.trim(), docNo)
      if (error) throw error
      const okIds = new Set((done ?? []).map((r: any) => r.id))
      if (okIds.size === 0) {
        alert('⚠ ม้วนที่เลือกถูกคนอื่นจัดส่งไปหมดแล้ว — ไม่ได้ออกใบ')
        setSelectedRolls(new Set())   // ต้องล้าง ไม่งั้นแถบขวายังนับม้วนค้าง ปุ่มส่งยังกดได้ ยิงซ้ำได้ไม่จบ
        await loadAll(); return
      }

      const sentRolls = pickedRolls.filter(r => okIds.has(r.id))
      if (okIds.size < ids.length) {
        alert(`⚠ มี ${ids.length - okIds.size} ม้วนถูกคนอื่นจัดส่งไปก่อนแล้ว\nใบนี้จะออกเฉพาะ ${okIds.size} ม้วนที่ส่งสำเร็จจริง`)
      }

      const soDoc = { id: '', so_no: selSO.so, customer: selSO.customer,
        product_name: selSO.products.join(', '), target_kg: selSO.targetKg,
        status: '', created_at: now, note: '' } as SO
      printDelivery(sentRolls, soDoc, shipStaff.trim(), docNo)
      setSelectedRolls(new Set())
      await loadAll()
    } catch (e: any) {
      alert('จัดส่งไม่สำเร็จ: ' + (e?.message ?? e))
    } finally {
      setShipping(false)
    }
  }

  function exportGroupExcel(groupRolls: Roll[], lot: string, product: string, customer: string) {
    if (!groupRolls.length) return
    const totalKg = groupRolls.reduce((s, r) => s + (r.weight ?? 0), 0)
    const dateStr = new Date().toISOString().slice(0, 10)

    // header rows
    const header: any[][] = [
      ['บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด'],
      ['รายงานสต็อกคลังสินค้า'],
      [],
      ['Lot :', lot,  '',  'สินค้า :', product],
      ['WO :', (groupRolls[0] as any)?.work_order ?? '', '', 'SO :', (groupRolls[0] as any)?.sale_order ?? ''],
      ['ลูกค้า :', customer, '',  'จำนวน :', `${groupRolls.length} ม้วน`,  'น้ำหนักรวม (สุทธิ) :', `${totalKg.toFixed(2)} Kgs.`],
      ['วันที่ Export :', new Date().toLocaleDateString('th-TH', { timeZone:'Asia/Bangkok' })],
      [],
      ['ลำดับ','ม้วนที่','นน.ม้วน (Kgs.)','นน.แกน (Kgs.)','นน.สุทธิ (Kgs.)','เครื่อง','ผู้ตรวจสอบ','วันผลิต','วันรับโอน'],
    ]

    const dataRows = groupRolls.map((r, i) => [
      i + 1,
      r.roll_no,
      Number(((r.weight??0)+(r.core_weight??0)).toFixed(2)),
      Number((r.core_weight??0).toFixed(2)),
      Number((r.weight??0).toFixed(2)),
      r.machine_no ?? '',
      r.inspector ?? '',
      fmtDT(r.created_at),
      r.transferred_at ? fmtDT(r.transferred_at) : '',
    ])
    // total row
    dataRows.push(['', `รวม ${groupRolls.length} ม้วน`, '', '', Number(totalKg.toFixed(2)), '', '', '', ''])

    const ws = XLSX.utils.aoa_to_sheet([...header, ...dataRows])
    ws['!cols'] = [
      {wch:6},{wch:8},{wch:16},{wch:14},{wch:16},
      {wch:8},{wch:12},{wch:18},{wch:18},
    ]
    ws['!merges'] = [
      { s:{r:0,c:0}, e:{r:0,c:8} },
      { s:{r:1,c:0}, e:{r:1,c:8} },
    ]
    const wb = XLSX.utils.book_new()
    const sheetName = lot.slice(-10)
    XLSX.utils.book_append_sheet(wb, ws, sheetName)
    XLSX.writeFile(wb, `stock_${lot}_${dateStr}.xlsx`)
  }


  // ── จัดส่งตาม Item ─────────────────────────────────────────────────────────
  // สต็อกพร้อมจัด = ม้วนดีในคลังที่ยังไม่ส่ง + ยังไม่ผูก SO อื่น
  const delAvailable = useMemo(() => stock.filter(r => !r.so_id), [stock])

  // จัดกลุ่มเป็นราย item (1 กรอบ = 1 สินค้า)
  const itemGroups = useMemo(() => {
    const m = new Map<string, { item_code: string; product_name: string; customer: string; size: string; rolls: Roll[]; wos: Set<string> }>()
    for (const r of delAvailable) {
      const ic = ((r as any).item_code ?? '').trim() || (r.product_name ?? '?')
      if (!m.has(ic)) m.set(ic, { item_code: ic, product_name: r.product_name ?? '?', customer: r.customer ?? '', size: sizeLabel(r), rolls: [], wos: new Set() })
      const g = m.get(ic)!
      g.rolls.push(r); g.wos.add(((r as any).work_order ?? '').trim())
    }
    let list = Array.from(m.values())
    if (delSearch.trim()) {
      const q = delSearch.toLowerCase()
      list = list.filter(g => [g.item_code, g.product_name, g.customer].some(x => String(x).toLowerCase().includes(q)))
    }
    return list.sort((a, b) => a.product_name.localeCompare(b.product_name))
  }, [delAvailable, delSearch])

  const selItemGroup = useMemo(() => itemGroups.find(g => g.item_code === delItem) ?? null, [itemGroups, delItem])

  // ม้วนของ item ที่เลือก เรียง FIFO (เก่า→ใหม่) + จัดกลุ่มตาม WO ไว้แสดง
  const delItemWOs = useMemo(() => {
    if (!selItemGroup) return [] as { wo: string; rolls: Roll[]; kg: number; start: string }[]
    const m = new Map<string, Roll[]>()
    for (const r of selItemGroup.rolls) {
      const wo = ((r as any).work_order ?? '').trim() || '(ไม่ระบุ WO)'
      ;(m.get(wo) ?? m.set(wo, []).get(wo)!).push(r)
    }
    return Array.from(m.entries()).map(([wo, rolls]) => {
      const sorted = [...rolls].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
      return { wo, rolls: sorted, kg: sorted.reduce((s, r) => s + (r.weight ?? 0), 0), start: sorted[0]?.created_at ?? '' }
    }).sort((a, b) => a.start.localeCompare(b.start)) // WO เก่าก่อน (FIFO)
  }, [selItemGroup])

  const delPicked   = useMemo(() => (selItemGroup?.rolls ?? []).filter(r => delSel.has(r.id)), [selItemGroup, delSel])
  const delPickedKg = useMemo(() => delPicked.reduce((s, r) => s + (r.weight ?? 0), 0), [delPicked])

  function toggleDelRoll(id: string) {
    setDelSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  // จัดอัตโนมัติ: หยิบม้วนเรียง FIFO (WO เก่าก่อน) จนถึง/เกินเป้าเล็กน้อย
  function delAutoFill() {
    const target = numOf(delTarget)   // ทนลูกน้ำ — "12,000" ต้องได้ 12000 ไม่ใช่ 12
    if (target <= 0) { alert('ใส่เป้าจัดส่ง (kg) ก่อน'); return }
    const flat = delItemWOs.flatMap(g => g.rolls) // เรียง WO เก่า→ใหม่ แล้วในแต่ละ WO เก่า→ใหม่
    const sel = new Set<string>(); let sum = 0
    for (const r of flat) { if (sum >= target) break; sel.add(r.id); sum += r.weight ?? 0 }
    setDelSel(sel)
    // กาง WO ที่ถูกหยิบ ให้เห็น/ปรับได้
    setDelOpenWO(new Set(delItemWOs.filter(g => g.rolls.some(r => sel.has(r.id))).map(g => g.wo)))
  }

  // Export ใบกำกับน้ำหนัก (ม้วนที่เลือกจะส่ง) เป็น Excel — ไปกำกับที่ลูกค้า
  function exportDelivery() {
    if (delPicked.length === 0) { alert('เลือกม้วนก่อน'); return }
    const rolls = [...delPicked].sort((a, b) =>
      String((a as any).work_order ?? '').localeCompare(String((b as any).work_order ?? '')) || (a.roll_no ?? 0) - (b.roll_no ?? 0))
    const dateStr = new Date().toISOString().slice(0, 10)
    const header: any[][] = [
      ['บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด'],
      ['ใบกำกับน้ำหนัก (จัดส่ง)'],
      [],
      ['สินค้า :', selItemGroup?.product_name ?? '', '', 'Item :', selItemGroup?.item_code ?? '', '', 'ขนาด :', selItemGroup?.size ?? ''],
      ['ลูกค้า :', selItemGroup?.customer ?? '', '', 'เป้าจัดส่ง :', `${delTarget || '—'} kg`, '', 'ผู้จัดส่ง :', delStaff || ''],
      ['จำนวน :', `${rolls.length} ม้วน`, '', 'น้ำหนักรวม (สุทธิ) :', `${delPickedKg.toFixed(2)} kg`, '', 'วันที่ :', new Date().toLocaleDateString('th-TH')],
      [],
      ['ลำดับที่', 'นน.เต็ม (kg)', 'นน.แกน (kg)', 'นน.สุทธิ (kg)', 'ม้วนที่', 'WO', 'Lot', 'ผู้ตรวจ', 'วันผลิต'],
    ]
    const sumNet   = rolls.reduce((s, r) => s + (r.weight ?? 0), 0)
    const sumCore  = rolls.reduce((s, r) => s + (r.core_weight ?? 0), 0)
    const sumGross = sumNet + sumCore
    const dataRows = rolls.map((r, i) => [
      i + 1,
      Number(((r.weight ?? 0) + (r.core_weight ?? 0)).toFixed(2)),  // เต็ม
      Number((r.core_weight ?? 0).toFixed(2)),                       // แกน
      Number((r.weight ?? 0).toFixed(2)),                            // สุทธิ
      r.roll_no, (r as any).work_order ?? '', r.lot_no ?? '', r.inspector ?? '', fmtDT(r.created_at),
    ])
    dataRows.push(['รวม', Number(sumGross.toFixed(2)), Number(sumCore.toFixed(2)), Number(sumNet.toFixed(2)), `${rolls.length} ม้วน`, '', '', '', ''])
    const ws = XLSX.utils.aoa_to_sheet([...header, ...dataRows])
    ws['!cols'] = [{ wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 18 }]
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 8 } }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'จัดส่ง')
    XLSX.writeFile(wb, `ใบกำกับน้ำหนัก_${(selItemGroup?.item_code ?? 'item')}_${dateStr}.xlsx`)
  }

  async function handleShipDelivery() {
    if (!delStaff.trim()) { alert('กรุณากรอกชื่อผู้จัดส่ง'); return }
    // เหตุผลเดียวกับ handleShip — ยิงเฉพาะม้วนที่จะพิมพ์ลงใบจริง
    if (delPicked.length === 0) { alert('เลือกม้วนที่จะส่งก่อน'); return }
    if (!confirm(`ยืนยันจัดส่ง ${delPicked.length} ม้วน · ${fmt(delPickedKg)} Kgs. ?\nสินค้า: ${selItemGroup?.product_name ?? ''}`)) return
    setDelShipping(true)
    try {
      const now = new Date().toISOString()
      const docNo = `DN-${Date.now().toString().slice(-8)}`
      const ids = delPicked.map(r => r.id)
      const { data: done, error } = await shipRolls(ids, now, delStaff.trim(), docNo)
      if (error) throw error
      const okIds = new Set((done ?? []).map((r: any) => r.id))
      if (okIds.size === 0) {
        alert('⚠ ม้วนที่เลือกถูกคนอื่นจัดส่งไปหมดแล้ว — ไม่ได้ออกใบ')
        setDelSel(new Set())
        await loadAll(); return
      }
      if (okIds.size < ids.length) {
        alert(`⚠ มี ${ids.length - okIds.size} ม้วนถูกคนอื่นจัดส่งไปก่อนแล้ว\nใบนี้จะออกเฉพาะ ${okIds.size} ม้วนที่ส่งสำเร็จจริง`)
      }
      const so = { id: '', so_no: `ดีล ${delTarget || fmt(delPickedKg, 0)} kg`, customer: selItemGroup?.customer ?? '',
        product_name: selItemGroup?.product_name ?? '', target_kg: numOf(delTarget), status: '', created_at: now, note: '' } as SO
      printDelivery(delPicked.filter(r => okIds.has(r.id)), so, delStaff.trim(), docNo)
      setDelSel(new Set())
      await loadAll()
    } catch (e: any) { alert('จัดส่งไม่สำเร็จ: ' + (e?.message ?? e)) }
    finally { setDelShipping(false) }
  }

  return (
    <div className="min-h-[calc(100vh-48px)] bg-[#0a0f1e] p-5">
      <div className="max-w-7xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-white font-bold text-xl flex items-center gap-2">
              <Package size={22} className="text-brand-400"/> คลังสินค้า
            </h1>
            <p className="text-slate-400 text-xs mt-0.5">
              สต็อกคงเหลือ {stock.length}{totalStockN != null && !olderLoaded ? ` / ${totalStockN}` : ''} ม้วน · {fmt(stock.reduce((s,r)=>s+(r.weight??0),0),1)} Kgs.
              {!olderLoaded && totalStockN != null && totalStockN > stock.length && (
                olderLoading
                  ? <span className="text-amber-400 ml-2">· กำลังโหลดสต็อกเก่า…</span>
                  : <button onClick={loadOlder} className="text-brand-400 hover:text-brand-300 underline ml-2">โหลดสต็อกเก่าทั้งหมด</button>
              )}
            </p>
          </div>
          <button onClick={loadAll} disabled={loading} className="flex items-center gap-1.5 text-slate-400 hover:text-white disabled:opacity-50 text-xs bg-slate-800 px-3 py-1.5 rounded-lg">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''}/> รีเฟรช
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1 w-fit">
          {([
            { key:'stock', label:'สต็อกคงเหลือ', icon: BarChart3 },
            { key:'delivery', label:'จัดส่งตาม Item', icon: Truck },
            { key:'so',    label: olderLoaded ? `Sales Orders (${soGroups.length})` : 'Sales Orders', icon: Package },
            { key:'ship',  label:'จัดส่ง (ตาม SO)', icon: Truck },
            { key:'scrap', label: scrapLoaded ? `เศษ (${scrapRolls.length})` : 'เศษ', icon: Trash2 },
            { key:'history', label:'ประวัติเบิก/จัดส่ง', icon: BarChart3 },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t.key ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white'
              }`}>
              <t.icon size={14}/> {t.label}
            </button>
          ))}
        </div>

        {/* ══════════ TAB: STOCK ══════════════════════════════════════════ */}
        {tab === 'stock' && (<>

          {/* ⚠ แจ้งเตือน: ม้วนที่ถูกแจ้ง NC ออกจากคลัง */}
          {ncRolls.length > 0 && (
            <div className="bg-rose-500/10 border border-rose-500/40 rounded-2xl p-4">
              <p className="text-rose-300 font-bold text-sm mb-2">⚠ มีม้วนถูกแจ้ง NC ออกจากคลัง {ncRolls.length} ม้วน · {fmt(ncRolls.reduce((s,r)=>s+(r.weight??0),0),2)} Kgs.</p>
              <div className="flex flex-wrap gap-2">
                {ncRolls.map((r:any) => (
                  <span key={r.id} className="inline-flex items-center gap-1.5 bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs px-2.5 py-1 rounded-lg">
                    <b>#{r.roll_no}</b>
                    <span className="text-rose-300/70 font-mono">{r.lot_no}</span>
                    <span className="text-rose-300/60">· {r.inbound_type==='qc_reject' ? '🚫 QC' : '📦 คลัง'} · {fmt(r.weight,2)}kg</span>
                    {r.remark && <span className="text-rose-300/50">· {r.remark}</span>}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-end gap-3 flex-wrap">
            {/* Section badge (locked when dept prop provided) */}
            {dept ? (
              <div className="self-end pb-0.5">
                <span className={`text-xs font-bold px-3 py-2 rounded-xl border ${
                  dept==='blow' ? 'bg-blue-500/15 text-blue-300 border-blue-500/30' : 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                }`}>
                  {dept==='blow' ? '🌬 ผลิต(เป่า)' : dept==='print' ? '🖨 ผลิต(พิมพ์)' : '🔁 กรอ(Rework)'}
                </span>
              </div>
            ) : (
              <div>
                <label className="block text-[10px] text-slate-500 mb-1">ฝั่งผลิต</label>
                <div className="flex gap-1">
                  {([{val:'',label:'📊 ทั้งหมด'},{val:'blow',label:'🌬 เป่า'},{val:'print',label:'🖨 พิมพ์'},{val:'rewind',label:'🔁 กรอ'}] as const).map(s=>(
                    <button key={s.val} onClick={() => setFSection(s.val)}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${fSection===s.val?'bg-brand-600 text-white border-brand-600':'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {[
              { label:'สินค้า',  val:fProduct,  set:setFProduct,  opts:products },
              { label:'ลูกค้า',  val:fCustomer, set:setFCustomer, opts:customers },
              { label:'ขนาด',    val:fSize,     set:setFSize,     opts:sizes },
              { label:'Lot',     val:fLot,       set:setFLot,      opts:lots },
            ].map(f => (
              <div key={f.label}>
                <label className="block text-[10px] text-slate-500 mb-1">{f.label}</label>
                {/* onFocus โหลดสต็อกเก่าก่อน — ไม่งั้นตัวเลือกมีแค่ของ 7 วันล่าสุด (ค่าที่มีแต่สต็อกเก่าจะหาย) */}
                <select value={f.val} onChange={e => f.set(e.target.value)} onFocus={() => loadOlder()}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-brand-500 min-w-[140px]">
                  <option value="">ทั้งหมด{!olderLoaded && (olderLoading ? ' (กำลังโหลดเก่า…)' : '')}</option>
                  {f.opts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            ))}
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">ค้นหา</label>
              <div className="relative">
                <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"/>
                <input value={search} onChange={e => setSearch(e.target.value)} onFocus={() => loadOlder()} placeholder="ม้วน, Lot..."
                  className="bg-slate-800 border border-slate-700 rounded-xl pl-7 pr-3 py-2 text-sm text-white outline-none focus:border-brand-500 w-36"/>
              </div>
            </div>
          </div>

          {/* KPI */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label:'สต็อกคงเหลือ', val:`${filteredStock.length} ม้วน`, sub:`${fmt(filteredStock.reduce((s,r)=>s+(r.weight??0),0),1)} Kgs.`, color:'text-brand-300', bg:'bg-brand-500/10 border-brand-500/20' },
              { label:'สินค้า (SKU)', val:`${new Set(filteredStock.map(r=>r.product_name)).size} รายการ`, sub:`${new Set(filteredStock.map(r=>r.customer)).size} ลูกค้า`, color:'text-amber-300', bg:'bg-amber-500/10 border-amber-500/20' },
              { label:'Lot ที่มีสต็อก', val:`${stockByLot.length} Lot`, sub:'', color:'text-purple-300', bg:'bg-purple-500/10 border-purple-500/20' },
            ].map(k => (
              <div key={k.label} className={`border rounded-xl px-5 py-3 ${k.bg}`}>
                <p className="text-slate-400 text-xs">{k.label}</p>
                <p className={`text-2xl font-black mt-0.5 ${k.color}`}>{k.val}</p>
                {k.sub && <p className="text-slate-500 text-xs mt-0.5">{k.sub}</p>}
              </div>
            ))}
          </div>

          {/* Stock grouped by lot */}
          <div className="space-y-2">
            {loading ? <div className="text-slate-500 text-sm py-8 text-center">กำลังโหลด...</div>
            : stockByLot.length === 0 ? <div className="bg-slate-900 border border-slate-800 rounded-2xl py-16 text-center text-slate-500">ไม่มีสต็อกคงเหลือ</div>
            : stockByDay.map(dg => {
              const dayCollapsed = stockCollapsedDays.has(dg.day)
              const dayKg = dg.items.reduce((s,g)=>s+g.rolls.reduce((ss,r)=>ss+(r.weight??0),0),0)
              const dayRolls = dg.items.reduce((s,g)=>s+g.rolls.length,0)
              return (
              <div key={dg.day} className="space-y-3">
                {/* หัวข้อวันโอนเข้า — กดยุบ/ขยาย + ยอดต่อวัน */}
                <button onClick={()=>setStockCollapsedDays(p=>{const n=new Set(p);n.has(dg.day)?n.delete(dg.day):n.add(dg.day);return n})}
                  className="sticky top-0 z-10 w-full bg-slate-800/95 backdrop-blur px-4 py-2 border-y border-slate-700 flex items-center justify-between hover:bg-slate-700/95 rounded-lg">
                  <span className="text-xs font-black text-slate-200 flex items-center gap-1.5"><span className={`text-[9px] text-slate-400 inline-block transition-transform ${dayCollapsed?'':'rotate-90'}`}>▶</span>📅 โอนเข้า {dg.day}</span>
                  <span className="text-[10px] text-slate-500">{dg.items.length} งาน · {dayRolls} ม้วน · {fmt(dayKg,1)} Kg</span>
                </button>
                {!dayCollapsed && dg.items.map(group => {
              const key = `${group.lot}__${group.product}__${group.wo}`
              const isOpen = expandedLots.has(key)
              const totalKg = group.rolls.reduce((s,r) => s+(r.weight??0), 0)
              const ncInLot = ncByLotKey.get(`${group.lot}__${group.product}`) ?? []
              const dtShort = (iso?: string) => iso ? new Date(iso).toLocaleDateString('th-TH',{timeZone:'Asia/Bangkok',day:'2-digit',month:'2-digit',year:'2-digit'})+' '+new Date(iso).toLocaleTimeString('th-TH',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit'}) : '—'
              return (
                <div key={key} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                  {ncInLot.length > 0 && (
                    <div className="bg-rose-500/10 border-b border-rose-500/30 px-5 py-1.5 text-[11px] text-rose-300">
                      ⚠ ม้วนที่แจ้ง NC ออกจาก Lot นี้: {ncInLot.map((r:any) => `#${r.roll_no}`).join(', ')} ({ncInLot.length} ม้วน · {fmt(ncInLot.reduce((s:number,r:any)=>s+(r.weight??0),0),2)}kg)
                    </div>
                  )}
                  {/* group header */}
                  <div className="flex items-center justify-between px-5 py-3.5">
                    {/* ติ๊กทั้งกลุ่ม → ใบกำกับน้ำหนัก */}
                    <div onClick={() => toggleWsGroup(group.rolls)}
                      title="เลือกทั้งกลุ่มเข้าใบกำกับน้ำหนัก"
                      className={`w-5 h-5 mr-3 rounded border-2 flex items-center justify-center flex-shrink-0 cursor-pointer transition-all ${
                        group.rolls.length > 0 && group.rolls.every(r => wsSel.has(r.id))
                          ? 'bg-brand-500 border-brand-500'
                          : group.rolls.some(r => wsSel.has(r.id)) ? 'bg-brand-500/30 border-brand-500' : 'border-slate-600 hover:border-slate-400'}`}>
                      {group.rolls.some(r => wsSel.has(r.id)) && <span className="text-white text-[10px] font-black">{group.rolls.every(r => wsSel.has(r.id)) ? '✓' : '–'}</span>}
                    </div>
                    <button onClick={() => toggleLot(key)} className="flex items-center gap-3 flex-1 text-left hover:opacity-80 transition-opacity">
                      {isOpen ? <ChevronDown size={16} className="text-slate-400"/> : <ChevronRight size={16} className="text-slate-400"/>}
                      <div>
                        <p className="text-white font-semibold text-sm flex items-center gap-1.5 flex-wrap">
                          {group.product}
                          {group.size && <span className="text-[11px] font-black bg-brand-500/20 text-brand-200 border border-brand-500/30 px-2 py-0.5 rounded">{group.size}</span>}
                        </p>
                        <p className="text-slate-500 text-xs flex items-center gap-1.5 flex-wrap mt-0.5">
                          {group.wo && <span className="text-[10px] font-bold bg-amber-500/15 text-amber-300 px-1.5 py-0.5 rounded">WO {group.wo}</span>}
                          {group.so && <span className="text-[10px] font-bold bg-blue-500/15 text-blue-300 px-1.5 py-0.5 rounded">SO {group.so}</span>}
                          <span>Lot: <span className="text-slate-300 font-mono">{group.lot}</span></span>
                          <span>· {group.customer}</span>
                        </p>
                        <p className="text-slate-600 text-[10px] mt-0.5 flex items-center gap-2 flex-wrap">
                          <span>🕐 เริ่ม {dtShort(group.start)} → จบ {dtShort(group.end)}</span>
                          <span className="text-green-400 font-bold">🌬 เป่าดี {group.goodN}</span>
                          {group.reworkN > 0 && <span className="text-amber-400 font-bold">🔄 กรอ {group.reworkN}</span>}
                        </p>
                      </div>
                    </button>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right">
                        <p className="text-brand-300 font-black text-lg">{group.rolls.length} <span className="text-xs font-normal text-slate-400">ม้วน</span></p>
                        <p className="text-slate-400 text-xs">{fmt(totalKg,1)} Kgs.</p>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); exportGroupExcel(group.rolls, group.lot, group.product, group.customer) }}
                        className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-xs px-3 py-1.5 rounded-lg transition-colors">
                        <Download size={11}/> Export
                      </button>
                    </div>
                  </div>
                  {/* roll list */}
                  {isOpen && (
                    <div className="border-t border-slate-800">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-800/30 text-[10px] text-slate-500 uppercase">
                            <th className="px-3 py-2 w-9"></th>
                            {['ลำดับ','ม้วนที่','เครื่อง','นน.เต็ม','นน.สุทธิ (Kgs.)','ผู้ตรวจ','วันผลิต','รับโอนเมื่อ'].map(h=>(
                              <th key={h} className="px-4 py-2 text-left font-semibold tracking-wider">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                          {[
                            ...group.rolls.map((r:any) => ({ r, nc:false })),
                            ...ncInLot.map((r:any) => ({ r, nc:true })),
                          ].sort((a,b) => {
                            // ม้วนเป่าดีก่อน → ม้วนกรออยู่ท้าย; ในแต่ละกลุ่มเรียงเลขม้วนน้อย→มาก
                            const ra = isReworkRoll(a.r) ? 1 : 0, rb = isReworkRoll(b.r) ? 1 : 0
                            if (ra !== rb) return ra - rb
                            return (a.r.roll_no??0) - (b.r.roll_no??0)
                          })
                          .map(({ r, nc }, idx) => {
                            // ── ม้วนที่แจ้ง NC ออกไปแล้ว — แทรกในตาราง ขีดคร่อม ──
                            if (nc) return (
                              <tr key={`nc_${r.id}`} className="bg-rose-500/5 text-rose-300/70 line-through">
                                <td className="px-3 py-2.5"></td>
                                <td className="px-4 py-2.5 text-xs">{idx + 1}</td>
                                <td className="px-4 py-2.5 font-mono font-bold">#{r.roll_no} <span className="no-underline inline-block ml-1 text-[9px] bg-rose-500/20 text-rose-300 px-1.5 py-0.5 rounded">⚠ NC</span></td>
                                <td className="px-4 py-2.5"><span className="text-[10px] bg-rose-500/15 text-rose-300 font-bold px-1.5 py-0.5 rounded no-underline">{r.machine_no||'—'}</span></td>
                                <td className="px-4 py-2.5">{fmt((r.weight??0)+(r.core_weight??0))}</td>
                                <td className="px-4 py-2.5 font-black">{fmt(r.weight)}</td>
                                <td className="px-4 py-2.5 text-xs no-underline" colSpan={3}>
                                  <span className="text-rose-300/90">{r.inbound_type==='qc_reject' ? '🚫 QC ตรวจไม่ผ่าน' : '📦 เสียจากคลัง'}</span>
                                  {r.remark && <span className="text-rose-300/50"> · {r.remark}</span>}
                                </td>
                              </tr>
                            )
                            const isOpen = expandedRoll === r.id
                            const rr = r as any
                            return (
                            <Fragment key={r.id}>
                            <tr onClick={() => setExpandedRoll(isOpen ? null : r.id)}
                              className={`cursor-pointer ${rr.new_system ? 'bg-emerald-500/10 border-l-4 border-emerald-400' : ''} ${wsSel.has(r.id) ? 'bg-brand-500/12' : isOpen ? 'bg-slate-800/40' : 'hover:bg-slate-800/30'}`}>
                              {/* ติ๊กม้วนเข้าใบกำกับน้ำหนัก — กดตรงนี้ไม่กางรายละเอียด */}
                              <td className="px-3 py-2.5" onClick={e => { e.stopPropagation(); toggleWsRoll(r) }}>
                                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center cursor-pointer transition-all ${
                                  wsSel.has(r.id) ? 'bg-brand-500 border-brand-500' : 'border-slate-600 hover:border-slate-400'}`}>
                                  {wsSel.has(r.id) && <span className="text-white text-[9px] font-black">✓</span>}
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-slate-500 text-xs">{idx + 1}</td>
                              <td className={`px-4 py-2.5 font-mono font-bold ${rr.new_system ? 'text-emerald-200' : 'text-white'}`}>{isOpen ? '▲' : '▼'} #{r.roll_no}
                                {rr.new_system && <span className="ml-1.5 text-[9px] bg-emerald-500/25 text-emerald-200 px-1.5 py-0.5 rounded font-black">✨ ใหม่</span>}
                                {isReworkRoll(r) && <span className="ml-1.5 text-[9px] bg-amber-500/25 text-amber-200 px-1.5 py-0.5 rounded font-bold" title={(r as any).rework_remark || `กรอจาก Lot ${(r as any).rework_source_lot||''}`}>🔄 กรอ</span>}
                                {((r as any).remark || '').includes('คืน NC') && <span className="ml-1.5 text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-bold" title={(r as any).remark}>↩ เคยถูก NC</span>}
                              </td>
                              <td className="px-4 py-2.5"><span className="text-[10px] bg-brand-500/20 text-brand-300 font-bold px-1.5 py-0.5 rounded">{r.machine_no||'—'}</span></td>
                              <td className="px-4 py-2.5 text-slate-300">{fmt((r.weight??0)+(r.core_weight??0))}</td>
                              <td className="px-4 py-2.5 text-green-300 font-black">{fmt(r.weight)}</td>
                              <td className="px-4 py-2.5 text-slate-400 text-xs">{r.inspector||'—'}</td>
                              <td className="px-4 py-2.5 text-slate-400 text-xs">{fmtDT(r.created_at)}</td>
                              <td className="px-4 py-2.5 text-slate-500 text-xs">{r.transferred_at ? fmtDT(r.transferred_at) : '—'}</td>
                            </tr>
                            {isOpen && (
                            <tr className="bg-slate-800/20">
                              <td colSpan={9} className="px-4 pb-4 pt-1">
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs mb-3">
                                  <div><span className="text-slate-500">สินค้า</span><p className="text-white font-semibold">{rr.product_name||'—'}</p></div>
                                  <div><span className="text-slate-500">รหัสสินค้า</span><p className="text-white font-semibold">{rr.product_code||'—'}</p></div>
                                  <div><span className="text-slate-500">ลูกค้า</span><p className="text-white font-semibold">{rr.customer||'—'}</p></div>
                                  <div><span className="text-slate-500">Lot</span><p className="text-white font-semibold font-mono">{rr.lot_no||'—'}</p></div>
                                  <div><span className="text-slate-500">นน.แกน</span><p className="text-white font-semibold">{fmt(rr.core_weight)} Kg</p></div>
                                  <div><span className="text-slate-500">นน.สุทธิ</span><p className="text-brand-300 font-bold">{fmt(rr.weight)} Kg</p></div>
                                  <div><span className="text-slate-500">กว้าง</span><p className="text-white font-semibold">{rr.width_cm||'—'} cm</p></div>
                                  <div><span className="text-slate-500">หนา</span><p className="text-white font-semibold">{rr.thick_mc||'—'}</p></div>
                                </div>
                                {((rr.remark || '').includes('คืน NC')) && (
                                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2 mb-3 text-xs text-amber-300">
                                    ↩ <b>ม้วนนี้เคยถูกแจ้ง NC แล้วคืนกลับคลัง</b> — {rr.remark}
                                  </div>
                                )}
                                <button onClick={(e) => { e.stopPropagation(); setReturnModal(r) }}
                                  className="text-sm bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-xl font-bold">
                                  ⚠ แจ้ง NC — ม้วนเสีย/มีปัญหาในคลัง (รอ ผจก ตัดสิน)
                                </button>
                              </td>
                            </tr>
                            )}
                            </Fragment>
                            )
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-slate-700 bg-slate-800/30">
                            <td colSpan={5} className="px-4 py-2 text-slate-400 text-xs font-semibold">รวม {group.rolls.length} ม้วน</td>
                            <td className="px-4 py-2 text-green-300 font-black">{fmt(totalKg)}</td>
                            <td colSpan={3}></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )
                })}
              </div>
              )
            })}
          </div>

          {/* ── แถบลอยล่าง: ม้วนที่ติ๊กไว้ → ออกใบกำกับน้ำหนัก (ไม่ตัดสต็อก) ── */}
          {wsSel.size > 0 && (<>
            <div className="h-24"/>{/* กันแถบลอยบังรายการล่างสุด */}
            <div className="fixed bottom-0 left-0 right-0 z-30 bg-slate-900/95 backdrop-blur border-t-2 border-brand-500 shadow-2xl">
              <div className="max-w-7xl mx-auto px-5 py-3 flex items-center gap-3 flex-wrap">
                <div className="flex-shrink-0">
                  <p className="text-[10px] text-slate-500">เลือกไว้ทำใบกำกับน้ำหนัก</p>
                  <p className="text-white font-bold text-sm">
                    <span className="text-brand-300 font-black text-lg">{wsSel.size}</span> ม้วน ·
                    <span className="text-brand-300 font-black text-lg"> {fmt(wsPickedKg,1)}</span> <span className="text-slate-400 text-xs">Kgs.</span>
                  </p>
                </div>
                <input value={wsStaff} onChange={e => setWsStaff(e.target.value)} placeholder="ชื่อผู้จัดของ"
                  className="w-40 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-brand-500"/>
                <input value={wsNote} onChange={e => setWsNote(e.target.value)} placeholder="หมายเหตุ (ถ้ามี)"
                  className="w-44 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-brand-500"/>
                <span className="text-[11px] text-amber-300/80">💡 พิมพ์อย่างเดียว — ม้วนยังอยู่ในคลัง ไม่ถูกตัดสต็อก</span>
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={() => setWsSel(new Map())}
                    className="text-slate-400 hover:text-white text-sm px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700">ล้าง</button>
                  <button onClick={() => exportWeightSlipExcel(wsPicked, wsStaff.trim(), wsNote.trim())}
                    className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-sm px-4 py-2 rounded-xl font-bold">
                    <Download size={14}/> Excel
                  </button>
                  <button onClick={() => printWeightSlip(wsPicked, wsStaff.trim(), wsNote.trim())}
                    className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-500 text-white text-sm px-5 py-2.5 rounded-xl font-bold">
                    <Printer size={15}/> ออกใบกำกับน้ำหนัก (A4)
                  </button>
                </div>
              </div>
            </div>
          </>)}
        </>)}

        {/* ══════════ TAB: จัดส่งตาม ITEM ═══════════════════════════════════ */}
        {tab === 'delivery' && (
          <div className="flex gap-4 items-start">

            {/* ── ซ้าย: รายการ item ── */}
            <div className="w-72 flex-shrink-0 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800">
                <p className="text-white font-semibold text-sm">📦 เลือกสินค้า (Item)</p>
                <div className="relative mt-2">
                  <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"/>
                  <input value={delSearch} onChange={e => setDelSearch(e.target.value)} placeholder="ค้นหาสินค้า/ลูกค้า..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-7 pr-3 py-1.5 text-xs text-white outline-none focus:border-brand-500"/>
                </div>
              </div>
              <div className="max-h-[72vh] overflow-y-auto divide-y divide-slate-800/50">
                {itemGroups.length === 0 ? <p className="text-slate-600 text-sm py-10 text-center">ไม่มีสต็อก</p>
                : itemGroups.map(g => {
                  const kg = g.rolls.reduce((s, r) => s + (r.weight ?? 0), 0)
                  const isSel = delItem === g.item_code
                  return (
                    <button key={g.item_code} onClick={() => { setDelItem(g.item_code); setDelSel(new Set()); setDelOpenWO(new Set()) }}
                      className={`w-full text-left px-4 py-3 transition-colors ${isSel ? 'bg-brand-600/20 border-l-4 border-brand-500' : 'hover:bg-slate-800/50 border-l-4 border-transparent'}`}>
                      <p className="text-white text-sm font-semibold leading-tight flex items-center gap-1.5 flex-wrap">
                        {g.product_name}
                        {g.size && <span className="text-[9px] font-black bg-brand-500/20 text-brand-200 px-1 py-0.5 rounded">{g.size}</span>}
                      </p>
                      <p className="text-slate-500 text-[10px] mt-0.5">{g.item_code} · {g.customer}</p>
                      <p className="text-[11px] mt-1"><span className="text-brand-300 font-black">{fmt(kg,1)}</span> <span className="text-slate-500">kg · {g.rolls.length} ม้วน · {g.wos.size} WO</span></p>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* ── กลาง: WO + ม้วน (ติ๊กเลือก) ── */}
            <div className="flex-1 min-w-0 space-y-3">
              {!selItemGroup ? (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl py-20 text-center text-slate-500">เลือกสินค้าทางซ้ายก่อน</div>
              ) : (<>
                {/* แถบเป้า + auto */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-end gap-3 flex-wrap">
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-1">เป้าจัดส่ง (kg)</label>
                    <input value={delTarget} onChange={e => setDelTarget(e.target.value)} placeholder="เช่น 2000" inputMode="decimal"
                      className="w-32 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-brand-500"/>
                  </div>
                  <button onClick={delAutoFill} className="bg-brand-600 hover:bg-brand-500 text-white text-sm font-bold px-4 py-2 rounded-lg">⚡ จัดอัตโนมัติ (FIFO)</button>
                  <button onClick={() => setDelSel(new Set())} className="text-slate-400 hover:text-white text-sm px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700">ล้าง</button>
                  <p className="text-[11px] text-slate-500 ml-auto">หยิบ WO เก่าก่อน · ถึง/เกินเป้าเล็กน้อยแล้วหยุด</p>
                </div>

                {/* WO list */}
                <div className="space-y-2 max-h-[64vh] overflow-y-auto pr-1">
                  {delItemWOs.map(g => {
                    const allSel = g.rolls.every(r => delSel.has(r.id))
                    const selN = g.rolls.filter(r => delSel.has(r.id)).length
                    const open = delOpenWO.has(g.wo)
                    return (
                      <div key={g.wo} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-2 bg-slate-800/30 border-b border-slate-800">
                          <button onClick={() => setDelOpenWO(p => { const n = new Set(p); n.has(g.wo) ? n.delete(g.wo) : n.add(g.wo); return n })}
                            className="flex items-center gap-2 text-left hover:opacity-80">
                            <span className="text-slate-500 text-xs">{open ? '▼' : '▶'}</span>
                            <span className="text-[11px] font-bold bg-amber-500/15 text-amber-300 px-2 py-0.5 rounded">WO {g.wo}</span>
                            <span className="text-slate-400 text-xs">{g.rolls.length} ม้วน · {fmt(g.kg,1)} kg</span>
                            {selN > 0 && <span className="text-[10px] font-bold bg-brand-500/20 text-brand-300 px-1.5 py-0.5 rounded">เลือก {selN}</span>}
                          </button>
                          <button onClick={() => setDelSel(p => { const n = new Set(p); g.rolls.forEach(r => allSel ? n.delete(r.id) : n.add(r.id)); return n })}
                            className="text-[11px] text-brand-300 hover:text-white">{allSel ? 'เอาออกทั้ง WO' : 'เลือกทั้ง WO'}</button>
                        </div>
                        {open && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 p-2">
                          {g.rolls.map(r => {
                            const on = delSel.has(r.id)
                            return (
                              <button key={r.id} onClick={() => toggleDelRoll(r.id)}
                                className={`flex items-center justify-between px-2.5 py-2 rounded-lg border text-xs transition-colors ${on ? 'bg-brand-500/20 border-brand-500/50' : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'}`}>
                                <span className="flex items-center gap-1.5">
                                  <span className={`w-4 h-4 rounded border flex items-center justify-center ${on ? 'bg-brand-500 border-brand-500' : 'border-slate-600'}`}>{on && <span className="text-white text-[9px] font-black">✓</span>}</span>
                                  <span className="text-slate-300 font-mono">#{r.roll_no}</span>
                                </span>
                                <span className={`font-black ${on ? 'text-brand-200' : 'text-slate-300'}`}>{fmt(r.weight,1)}</span>
                              </button>
                            )
                          })}
                        </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>)}
            </div>

            {/* ── ขวา: ที่เลือกไว้ + ยืนยัน ── */}
            {selItemGroup && (
              <div className="w-72 flex-shrink-0 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden sticky top-4">
                <div className="px-4 py-3 border-b border-slate-800 bg-brand-600/10">
                  <p className="text-white font-semibold text-sm">🚚 ม้วนที่จะส่ง</p>
                  <p className="text-[11px] mt-1">
                    <span className="text-brand-300 font-black text-lg">{fmt(delPickedKg,1)}</span>
                    <span className="text-slate-500"> / {delTarget || '—'} kg · {delSel.size} ม้วน</span>
                  </p>
                  {parseFloat(delTarget) > 0 && (
                    <p className={`text-[10px] ${delPickedKg >= parseFloat(delTarget) ? 'text-green-400' : 'text-amber-400'}`}>
                      {delPickedKg >= parseFloat(delTarget) ? `✓ ถึงเป้าแล้ว (เกิน ${fmt(delPickedKg - parseFloat(delTarget),1)} kg)` : `ขาดอีก ${fmt(parseFloat(delTarget) - delPickedKg,1)} kg`}
                    </p>
                  )}
                </div>
                <div className="max-h-[48vh] overflow-y-auto divide-y divide-slate-800/50">
                  {delPicked.length === 0 ? <p className="text-slate-600 text-xs py-8 text-center">ยังไม่ได้เลือกม้วน</p>
                  : delPicked.map(r => (
                    <div key={r.id} className="flex items-center justify-between px-4 py-1.5 text-xs">
                      <span className="text-slate-400">#{r.roll_no} <span className="text-slate-600">· WO {(r as any).work_order || '—'}</span></span>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-300 font-bold">{fmt(r.weight,1)}</span>
                        <button onClick={() => toggleDelRoll(r.id)} className="text-slate-600 hover:text-red-400">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-3 border-t border-slate-800 space-y-2">
                  <button onClick={exportDelivery} disabled={delSel.size === 0}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-sm px-4 py-2 rounded-xl font-bold">
                    <Download size={14}/> Export Excel (ใบกำกับน้ำหนัก)
                  </button>
                  <input value={delStaff} onChange={e => setDelStaff(e.target.value)} placeholder="ชื่อผู้จัดส่ง *"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-brand-500"/>
                  <button onClick={handleShipDelivery} disabled={delShipping || delSel.size === 0 || !delStaff.trim()}
                    className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm px-4 py-2.5 rounded-xl font-bold">
                    <Truck size={15}/> {delShipping ? 'กำลังส่ง...' : 'ยืนยันจัดส่ง + พิมพ์ใบ'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════ TAB: SO ═════════════════════════════════════════════ */}
        {tab === 'so' && (<>
          <div className="bg-slate-800/40 border border-slate-700 rounded-xl px-4 py-2.5 text-[11px] text-slate-400">
            💡 SO อ่านจากเลขที่ติดมากับม้วนตอนตั้งงานที่เครื่อง — ไม่ต้องพิมพ์เพิ่ม ·
            <b className="text-slate-300"> เป้า</b> ดึงจากแผน (planned_qty ของ WO ในสังกัด SO นั้น) ·
            SO ที่ยังไม่มีเป้าในแผนจะขึ้น <b className="text-slate-300">"ไม่มีเป้าในแผน"</b>
          </div>

          <div className="space-y-3">
            {(!olderLoaded || !histLoaded)
              ? <div className="text-slate-500 text-sm py-8 text-center">
                  {!olderLoaded ? 'กำลังโหลดสต็อกทั้งหมด…' : 'กำลังโหลดยอดที่ส่งไปแล้ว…'}
                  <p className="text-[11px] text-slate-600 mt-1">รอให้ครบก่อน ไม่งั้นยอด "ส่งไปแล้ว" กับ "ยังต้องส่งอีก" จะเพี้ยน</p>
                </div>
              : soGroups.length === 0
              ? <div className="bg-slate-900 border border-slate-800 rounded-2xl py-16 text-center text-slate-500">ไม่มี SO ที่มีของอยู่ในคลัง</div>
              : soGroups.map(g => {
              const remain = Math.max(g.targetKg - g.shipKg, 0)
              const done   = g.targetKg > 0 && g.shipKg >= g.targetKg
              return (
              <div key={g.so} className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                <div className="flex items-start justify-between mb-3 gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <p className="text-brand-300 font-mono font-bold text-lg">{g.so}</p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        done ? 'bg-green-500/20 text-green-300' : g.shipKg > 0 ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-700 text-slate-300'}`}>
                        {done ? 'ส่งครบ' : g.shipKg > 0 ? 'ส่งบางส่วน' : 'ยังไม่ส่ง'}
                      </span>
                      <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">{g.wos.length} WO</span>
                    </div>
                    <p className="text-white font-semibold">
                      {g.customer}
                      {g.customers.length > 1 && (
                        <span className="ml-2 text-[10px] font-bold bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded"
                          title={`SO เลขนี้มีม้วนของหลายลูกค้าปนกัน: ${g.customers.join(' / ')}`}>
                          ⚠ {g.customers.length} ลูกค้าปนกัน — เช็คเลข SO ที่หน้าเครื่อง
                        </span>
                      )}
                    </p>
                    <p className="text-slate-400 text-sm">{g.products.join(' · ') || '—'}</p>
                    <p className="text-slate-600 text-[10px] mt-1 font-mono">WO: {g.wos.join(', ') || '—'}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-slate-500 text-[10px]">เป้าจากแผน</p>
                    <p className="text-white font-black text-xl">
                      {g.targetKg > 0 ? <>{fmt(g.targetKg,1)} <span className="text-xs font-normal text-slate-400">Kgs.</span></>
                        : <span className="text-amber-400 text-sm font-bold">ไม่มีเป้าในแผน</span>}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="bg-brand-500/10 border border-brand-500/20 rounded-xl px-4 py-2">
                    <p className="text-slate-500 text-[10px]">คงเหลือในคลัง</p>
                    <p className="text-brand-300 font-black text-lg">{fmt(g.stockKg,1)} <span className="text-xs font-normal text-slate-400">Kgs.</span></p>
                    <p className="text-slate-500 text-[10px]">{g.stockRolls.length} ม้วน</p>
                  </div>
                  <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-2">
                    <p className="text-slate-500 text-[10px]">ส่งไปแล้ว</p>
                    <p className="text-green-300 font-black text-lg">{fmt(g.shipKg,1)} <span className="text-xs font-normal text-slate-400">Kgs.</span></p>
                    <p className="text-slate-500 text-[10px]">{g.shipN} ม้วน</p>
                  </div>
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-2">
                    <p className="text-slate-500 text-[10px]">{g.targetKg > 0 ? 'ยังต้องส่งอีก' : 'ผลิตเข้าคลังแล้ว'}</p>
                    <p className="text-amber-300 font-black text-lg">
                      {fmt(g.targetKg > 0 ? remain : g.producedKg,1)} <span className="text-xs font-normal text-slate-400">Kgs.</span>
                    </p>
                    {g.targetKg > 0 && remain > g.stockKg &&
                      <p className="text-rose-400 text-[10px]">⚠ ของในคลังไม่พอ ขาด {fmt(remain - g.stockKg,1)}</p>}
                  </div>
                </div>

                {g.targetKg > 0 && (
                  <div className="mb-3">
                    <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                      <span>ส่งแล้วเทียบเป้า</span>
                      <span>{g.pct.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${g.pct >= 100 ? 'bg-green-500' : g.pct >= 50 ? 'bg-amber-500' : 'bg-brand-500'}`}
                        style={{ width: `${g.pct}%` }}/>
                    </div>
                  </div>
                )}

                <button onClick={() => { setSelSoNo(g.so); setSelectedRolls(new Set()); setSoTargetInput(''); setSoOpenWO(new Set()); setTab('ship') }}
                  disabled={g.stockRolls.length === 0}
                  className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-sm px-4 py-2 rounded-xl font-bold">
                  <Truck size={15}/> จัดของ SO นี้
                </button>
              </div>
            )})}
          </div>
        </>)}

        {/* ══════════ TAB: SHIP (จัดส่งตาม SO) ═══════════════════════════ */}
        {tab === 'ship' && (
          <div className="flex gap-4 items-start">

            {/* ── ซ้าย: รายการ SO ที่มีของอยู่ในคลัง ── */}
            <div className="w-72 flex-shrink-0 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800">
                <p className="text-white font-semibold text-sm">📋 เลือก SO ที่จะจัดส่ง</p>
                <p className="text-[10px] text-slate-500 mt-0.5">เรียงงานใหม่สุดขึ้นก่อน</p>
              </div>
              <div className="max-h-[72vh] overflow-y-auto divide-y divide-slate-800/50">
                {(!olderLoaded || !histLoaded) ? <p className="text-slate-600 text-sm py-10 text-center">{!olderLoaded ? 'กำลังโหลดสต็อก…' : 'กำลังโหลดยอดที่ส่งไปแล้ว…'}</p>
                : soGroups.length === 0 ? <p className="text-slate-600 text-sm py-10 text-center">ไม่มี SO ที่มีของในคลัง</p>
                : soGroups.map(g => {
                  const isSel = selSoNo === g.so
                  const remain = Math.max(g.targetKg - g.shipKg, 0)
                  return (
                    <button key={g.so} onClick={() => { setSelSoNo(g.so); setSelectedRolls(new Set()); setSoTargetInput(''); setSoOpenWO(new Set()) }}
                      className={`w-full text-left px-4 py-3 transition-colors ${isSel ? 'bg-brand-600/20 border-l-4 border-brand-500' : 'hover:bg-slate-800/50 border-l-4 border-transparent'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-brand-300 font-mono font-bold text-xs">{g.so}</span>
                        <span className="text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">{g.wos.length} WO</span>
                      </div>
                      <p className="text-white text-xs font-semibold truncate mt-0.5">{g.customer}</p>
                      <p className="text-slate-500 text-[10px] truncate">{g.products.join(' · ') || '—'}</p>
                      <p className="text-[11px] mt-1">
                        <span className="text-brand-300 font-black">{fmt(g.stockKg,1)}</span>
                        <span className="text-slate-500"> kg ในคลัง · {g.stockRolls.length} ม้วน</span>
                      </p>
                      {g.targetKg > 0
                        ? <p className="text-[10px] text-amber-400">ยังต้องส่งอีก {fmt(remain,1)} / {fmt(g.targetKg,1)} kg</p>
                        : <p className="text-[10px] text-slate-600">ไม่มีเป้าในแผน</p>}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* ── กลาง: WO + ม้วนของ SO ที่เลือก ── */}
            <div className="flex-1 min-w-0 space-y-3">
              {!selSO ? (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl py-20 text-center text-slate-500">เลือก SO ทางซ้ายก่อน</div>
              ) : (<>
                {/* สรุป SO + เป้ารอบนี้ */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                  <div className="flex items-center gap-2 flex-wrap mb-3">
                    <span className="text-brand-300 font-mono font-bold text-base">{selSO.so}</span>
                    <span className="text-white text-sm">{selSO.customer}</span>
                    <span className="text-slate-500 text-xs">· {selSO.products.join(' · ')}</span>
                  </div>
                  <div className="flex items-end gap-3 flex-wrap">
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-1">
                        เป้าจัดส่งรอบนี้ (kg){selSO.targetKg > 0 && <span className="text-slate-600"> · ค้างอยู่ {fmt(soRemainKg,1)}</span>}
                      </label>
                      <input value={soTargetInput} onChange={e => setSoTargetInput(e.target.value)} inputMode="decimal"
                        placeholder={selSO.targetKg > 0 ? fmt(soRemainKg,1) : 'ใส่เป้าเอง'}
                        className="w-36 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-brand-500"/>
                    </div>
                    <button onClick={soAutoFill} className="bg-brand-600 hover:bg-brand-500 text-white text-sm font-bold px-4 py-2 rounded-lg">⚡ จัดอัตโนมัติ (FIFO)</button>
                    <button onClick={() => setSelectedRolls(new Set())} className="text-slate-400 hover:text-white text-sm px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700">ล้าง</button>
                    <p className="text-[11px] text-slate-500 ml-auto">หยิบ WO เก่าก่อน · ถึง/เกินเป้าเล็กน้อยแล้วหยุด</p>
                  </div>
                  {selSO.targetKg === 0 && (
                    <p className="text-[11px] text-amber-300/80 mt-2">⚠ SO นี้ไม่มี planned_qty ในแผน — ใส่เป้าเองก่อนกดจัดอัตโนมัติ หรือติ๊กม้วนเองได้</p>
                  )}
                </div>

                {/* WO list */}
                <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                  {soWOs.map(g => {
                    const allSel = g.rolls.every(r => selectedRolls.has(r.id))
                    const selN = g.rolls.filter(r => selectedRolls.has(r.id)).length
                    const open = soOpenWO.has(g.wo)
                    return (
                      <div key={g.wo} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-2 bg-slate-800/30 border-b border-slate-800">
                          <button onClick={() => setSoOpenWO(p => { const n = new Set(p); n.has(g.wo) ? n.delete(g.wo) : n.add(g.wo); return n })}
                            className="flex items-center gap-2 text-left hover:opacity-80 flex-wrap">
                            <span className="text-slate-500 text-xs">{open ? '▼' : '▶'}</span>
                            <span className="text-[11px] font-bold bg-amber-500/15 text-amber-300 px-2 py-0.5 rounded">WO {g.wo}</span>
                            <span className="text-slate-400 text-xs">{g.rolls.length} ม้วน · {fmt(g.kg,1)} kg</span>
                            <span className="text-slate-600 text-[10px]">{g.product}</span>
                            {selN > 0 && <span className="text-[10px] font-bold bg-brand-500/20 text-brand-300 px-1.5 py-0.5 rounded">เลือก {selN}</span>}
                          </button>
                          <button onClick={() => setSelectedRolls(p => { const n = new Set(p); g.rolls.forEach(r => allSel ? n.delete(r.id) : n.add(r.id)); return n })}
                            className="text-[11px] text-brand-300 hover:text-white whitespace-nowrap">{allSel ? 'เอาออกทั้ง WO' : 'เลือกทั้ง WO'}</button>
                        </div>
                        {open && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 p-2">
                          {g.rolls.map(r => {
                            const on = selectedRolls.has(r.id)
                            return (
                              <button key={r.id} onClick={() => toggleRoll(r.id)}
                                className={`flex items-center justify-between px-2.5 py-2 rounded-lg border text-xs transition-colors ${on ? 'bg-brand-500/20 border-brand-500/50' : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'}`}>
                                <span className="flex items-center gap-1.5">
                                  <span className={`w-4 h-4 rounded border flex items-center justify-center ${on ? 'bg-brand-500 border-brand-500' : 'border-slate-600'}`}>{on && <span className="text-white text-[9px] font-black">✓</span>}</span>
                                  <span className="text-slate-300 font-mono">#{r.roll_no}</span>
                                </span>
                                <span className={`font-black ${on ? 'text-brand-200' : 'text-slate-300'}`}>{fmt(r.weight,1)}</span>
                              </button>
                            )
                          })}
                        </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>)}
            </div>

            {/* ── ขวา: ที่เลือกไว้ + ยืนยัน ── */}
            {selSO && (
              <div className="w-72 flex-shrink-0 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden sticky top-4">
                <div className="px-4 py-3 border-b border-slate-800 bg-brand-600/10">
                  <p className="text-white font-semibold text-sm">🚚 ม้วนที่จะส่ง</p>
                  <p className="text-[11px] mt-1">
                    <span className="text-brand-300 font-black text-lg">{fmt(pickedKg,1)}</span>
                    <span className="text-slate-500"> / {soTargetKg > 0 ? fmt(soTargetKg,1) : '—'} kg · {selectedRolls.size} ม้วน</span>
                  </p>
                  {soTargetKg > 0 && (
                    <p className={`text-[10px] ${pickedKg >= soTargetKg ? 'text-green-400' : 'text-amber-400'}`}>
                      {pickedKg >= soTargetKg ? `✓ ถึงเป้าแล้ว (เกิน ${fmt(pickedKg - soTargetKg,1)} kg)` : `ขาดอีก ${fmt(soTargetKg - pickedKg,1)} kg`}
                    </p>
                  )}
                </div>
                <div className="max-h-[42vh] overflow-y-auto divide-y divide-slate-800/50">
                  {pickedRolls.length === 0 ? <p className="text-slate-600 text-xs py-8 text-center">ยังไม่ได้เลือกม้วน</p>
                  : pickedRolls.map(r => (
                    <div key={r.id} className="flex items-center justify-between px-4 py-1.5 text-xs">
                      <span className="text-slate-400">#{r.roll_no} <span className="text-slate-600">· WO {(r as any).work_order || '—'}</span></span>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-300 font-bold">{fmt(r.weight,1)}</span>
                        <button onClick={() => toggleRoll(r.id)} className="text-slate-600 hover:text-red-400">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-3 border-t border-slate-800 space-y-2">
                  <button onClick={() => printWeightSlip(pickedRolls, shipStaff.trim(), `SO ${selSO.so}`)} disabled={selectedRolls.size === 0}
                    className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white text-sm px-4 py-2 rounded-xl font-bold">
                    <Printer size={14}/> ใบกำกับน้ำหนัก (ยังไม่ตัดสต็อก)
                  </button>
                  <button onClick={() => exportWeightSlipExcel(pickedRolls, shipStaff.trim(), `SO ${selSO.so}`)} disabled={selectedRolls.size === 0}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-sm px-4 py-2 rounded-xl font-bold">
                    <Download size={14}/> Export Excel
                  </button>
                  <input value={shipStaff} onChange={e => setShipStaff(e.target.value)} placeholder="ชื่อผู้จัดส่ง *"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-brand-500"/>
                  <button onClick={handleShip} disabled={shipping || selectedRolls.size === 0 || !shipStaff.trim()}
                    className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm px-4 py-2.5 rounded-xl font-bold">
                    <Truck size={15}/> {shipping ? 'กำลังส่ง...' : 'ยืนยันจัดส่ง + พิมพ์ใบ'}
                  </button>
                  <p className="text-[10px] text-slate-500 text-center">กดแล้วม้วนจะถูกตัดออกจากคลังจริง</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════ TAB: SCRAP (เศษจากงาน) ══════════════════════════════ */}
        {tab === 'scrap' && (<>
          {/* สรุปยอดเศษ */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-slate-900 border border-red-700/40 rounded-2xl p-4">
              <p className="text-xs text-slate-400">🗑 เศษรวม</p>
              <p className="text-3xl font-black text-red-400 mt-1">{fmt(scrapKg,1)}<span className="text-base text-slate-500 font-normal"> kg</span></p>
              <p className="text-[11px] text-slate-500">{scrapRolls.length} ม้วน</p>
            </div>
            {(['scrap_clear','scrap_color','scrap_lump'] as const).map(t => (
              <div key={t} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <p className="text-xs text-slate-400">{SCRAP_LABEL[t]}</p>
                <p className="text-2xl font-black text-slate-200 mt-1">{fmt(scrapByType[t]?.kg ?? 0,1)}<span className="text-sm text-slate-500 font-normal"> kg</span></p>
                <p className="text-[11px] text-slate-500">{scrapByType[t]?.n ?? 0} ม้วน</p>
              </div>
            ))}
          </div>

          {loading || scrapLoading || !scrapLoaded ? <div className="text-slate-500 text-sm py-8 text-center">กำลังโหลด...</div>
          : scrapByLot.length === 0 ? <div className="bg-slate-900 border border-slate-800 rounded-2xl py-16 text-center text-slate-500">ยังไม่มีเศษจากงานผลิต/กรอ</div>
          : (
            <div className="space-y-2">
              {scrapByLot.map(group => {
                const key = `scrap__${group.lot}__${group.product}__${group.wo}`
                const isOpen = expandedLots.has(key)
                const subKg = group.rolls.reduce((s,r)=>s+(r.weight??0),0)
                return (
                  <div key={key} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                    <button onClick={() => setExpandedLots(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })}
                      className="w-full flex items-center gap-2 px-4 py-3 hover:bg-slate-800/50 text-left flex-wrap">
                      {isOpen ? <ChevronDown size={16} className="text-slate-500"/> : <ChevronRight size={16} className="text-slate-500"/>}
                      {group.wo && <span className="text-[10px] font-bold bg-amber-500/15 text-amber-300 px-1.5 py-0.5 rounded">WO {group.wo}</span>}
                      {group.so && <span className="text-[10px] font-bold bg-blue-500/15 text-blue-300 px-1.5 py-0.5 rounded">SO {group.so}</span>}
                      <span className="font-mono text-sm text-red-300">Lot {group.lot}</span>
                      <span className="text-sm text-slate-300">{group.product}</span>
                      <span className="text-xs text-slate-500">· {group.customer} · เครื่อง {group.machine}</span>
                      <span className="ml-auto text-sm font-bold text-red-400">{fmt(subKg,1)} kg</span>
                      <span className="text-xs text-slate-500">{group.rolls.length} ม้วน</span>
                    </button>
                    {isOpen && (
                      <div className="overflow-x-auto border-t border-slate-800">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-800/50 text-slate-400">
                            <tr>
                              <th className="px-3 py-2 text-left">ม้วนที่</th>
                              <th className="px-3 py-2 text-left">ประเภทเศษ</th>
                              <th className="px-3 py-2 text-right">นน.สุทธิ</th>
                              <th className="px-3 py-2 text-left">สาเหตุ/หมายเหตุ</th>
                              <th className="px-3 py-2 text-left">ผู้ตรวจ</th>
                              <th className="px-3 py-2 text-left">เวลา</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.rolls.map((r:any) => (
                              <tr key={r.id} className="border-t border-slate-800 text-slate-300">
                                <td className="px-3 py-1.5 font-bold">#{r.roll_no ?? '—'}</td>
                                <td className="px-3 py-1.5"><span className="px-2 py-0.5 rounded-full bg-red-500/15 text-red-300 text-[11px]">{SCRAP_LABEL[r.roll_type] ?? r.roll_type}</span></td>
                                <td className="px-3 py-1.5 text-right font-bold">{fmt(r.weight ?? 0,2)}</td>
                                <td className="px-3 py-1.5 text-amber-300">{r.remark || '—'}</td>
                                <td className="px-3 py-1.5">{r.inspector || '—'}</td>
                                <td className="px-3 py-1.5 text-slate-500">{r.created_at ? fmtDT(r.created_at) : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>)}

        {/* ── ประวัติเบิก/จัดส่ง ─────────────────────────────────────── */}
        {tab === 'history' && (<>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <p className="text-[11px] text-slate-500">จำนวนใบเบิก/จัดส่ง</p>
              <p className="text-3xl font-black text-brand-400 mt-1">{histLoaded ? shipmentHistory.length : '—'}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <p className="text-[11px] text-slate-500">ม้วนที่เบิกออกรวม</p>
              <p className="text-3xl font-black text-slate-200 mt-1">{histLoaded ? histRolls.length : '—'}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 col-span-2">
              <p className="text-[11px] text-slate-500">น้ำหนักเบิกออกรวม</p>
              <p className="text-3xl font-black text-emerald-400 mt-1">{fmt(histTotalKg,1)}<span className="text-base text-slate-500 font-normal"> kg</span></p>
            </div>
          </div>

          {histLoading || !histLoaded ? <div className="text-slate-500 text-sm py-8 text-center">กำลังโหลด...</div>
          : shipmentHistory.length === 0 ? <div className="bg-slate-900 border border-slate-800 rounded-2xl py-16 text-center text-slate-500">ยังไม่มีประวัติการเบิก/จัดส่ง</div>
          : (
            <div className="space-y-2">
              {shipmentHistory.map(g => {
                const key = `hist__${g.key}`
                const isOpen = expandedLots.has(key)
                const subKg = g.rolls.reduce((s:number,r:any)=>s+(r.weight??0),0)
                return (
                  <div key={key} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                    <div className="w-full flex items-center gap-2 px-4 py-3 hover:bg-slate-800/50 text-left flex-wrap">
                      <button onClick={() => setExpandedLots(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })} className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
                        {isOpen ? <ChevronDown size={16} className="text-slate-500"/> : <ChevronRight size={16} className="text-slate-500"/>}
                        {g.docNo
                          ? <span className="text-[11px] font-bold bg-emerald-500/15 text-emerald-300 px-1.5 py-0.5 rounded font-mono">{g.docNo}</span>
                          : <span className="text-[11px] font-bold bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">ไม่มีเลขใบ</span>}
                        {g.so && <span className="text-[10px] font-bold bg-blue-500/15 text-blue-300 px-1.5 py-0.5 rounded">SO {g.so}</span>}
                        <span className="text-sm text-slate-300">{g.product}</span>
                        {labelPosOf(g.rolls) && <span className="text-[11px] font-bold bg-cyan-500/15 text-cyan-300 px-1.5 py-0.5 rounded">{labelPosOf(g.rolls)}</span>}
                        <span className="text-xs text-slate-500">· {g.customer}</span>
                        <span className="text-xs text-slate-500">· {g.at ? fmtDT(g.at) : '—'}</span>
                        <span className="text-xs text-slate-400">· เบิกโดย {g.by}</span>
                      </button>
                      <span className="text-sm font-bold text-emerald-400">{fmt(subKg,1)} kg</span>
                      <span className="text-xs text-slate-500">{g.rolls.length} ม้วน</span>
                      <button onClick={() => {
                          const so = { id:'', so_no: g.docNo || `เบิก ${g.at ? fmtDT(g.at) : ''}`, customer: g.customer,
                            product_name: g.product, target_kg: 0, status:'', created_at: g.at, note:'' } as SO
                          printDelivery(g.rolls as Roll[], so, g.by, g.docNo || '—')
                        }}
                        className="flex items-center gap-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded">
                        <Printer size={12}/> พิมพ์ซ้ำ
                      </button>
                      <button onClick={() => {
                          const rev = `${g.docNo || 'DN'}-แก้ไข`
                          const so = { id:'', so_no: rev, customer: g.customer,
                            product_name: g.product, target_kg: 0, status:'', created_at: g.at, note:'' } as SO
                          printDelivery(g.rolls as Roll[], so, g.by, rev)
                        }}
                        className="flex items-center gap-1 text-[11px] bg-amber-600/80 hover:bg-amber-600 text-white px-2 py-1 rounded">
                        <Printer size={12}/> ออกใบส่งแก้ยอด
                      </button>
                      <button onClick={() => { loadOlder(); setReplaceGroup(g) }}
                        className="flex items-center gap-1 text-[11px] bg-brand-600/80 hover:bg-brand-600 text-white px-2 py-1 rounded">
                        <Plus size={12}/> เพิ่มม้วนแทน
                      </button>
                    </div>
                    {isOpen && (
                      <div className="overflow-x-auto border-t border-slate-800">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-800/50 text-slate-400">
                            <tr>
                              <th className="px-3 py-2 text-left">ม้วนที่</th>
                              <th className="px-3 py-2 text-left">Lot</th>
                              <th className="px-3 py-2 text-right">นน.สุทธิ</th>
                              <th className="px-3 py-2 text-left">เครื่อง</th>
                              <th className="px-3 py-2 text-left">เวลาเบิก</th>
                              <th className="px-3 py-2 text-right">รับคืน</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.rolls.map((r:any) => (
                              <tr key={r.id} className="border-t border-slate-800 text-slate-300">
                                <td className="px-3 py-1.5 font-bold">#{r.roll_no ?? '—'}</td>
                                <td className="px-3 py-1.5 font-mono text-slate-400">{r.lot_no ?? '—'}</td>
                                <td className="px-3 py-1.5 text-right font-bold">{fmt(r.weight ?? 0,2)}</td>
                                <td className="px-3 py-1.5">{r.machine_no ?? '—'}</td>
                                <td className="px-3 py-1.5 text-slate-500">{r.shipped_at ? fmtDT(r.shipped_at) : '—'}</td>
                                <td className="px-3 py-1.5 text-right">
                                  <button onClick={() => setReturnModal(r)}
                                    className="text-[11px] bg-amber-600/80 hover:bg-amber-600 text-white px-2 py-0.5 rounded">
                                    รับคืน/แจ้ง NC
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>)}

      </div>

      {/* ── Modal: ส่งกลับแผนกกรอ ───────────────────────────────────── */}
      {returnModal && (
        <ReturnToReworkModal
          roll={returnModal}
          onClose={() => setReturnModal(null)}
          onDone={async () => { setReturnModal(null); setHistLoaded(false); await loadAll() }}
        />
      )}

      {/* ── Modal: เพิ่มม้วนจากสต็อกมาแทนในใบเบิกเดิม ─────────────────── */}
      {replaceGroup && (
        <ReplaceRollModal
          group={replaceGroup}
          stock={stock}
          stockLoading={!olderLoaded || olderLoading}
          onClose={() => setReplaceGroup(null)}
          onDone={async () => { setReplaceGroup(null); setHistLoaded(false); await loadAll() }}
        />
      )}
    </div>
  )
}

// ─── หยิบม้วนจากสต็อกมาแทนม้วนที่รับคืน แล้วผูกเข้าใบเบิกเดิม (ship_doc_no เดียวกัน) ───
function ReplaceRollModal({ group, stock, stockLoading, onClose, onDone }:
  { group: any; stock: Roll[]; stockLoading?: boolean; onClose: () => void; onDone: () => void }) {
  const [sel, setSel]     = useState<Set<string>>(new Set())
  const [staff, setStaff] = useState<string>(group.by && group.by !== '—' ? group.by : '')
  const [sameOnly, setSameOnly] = useState(true)
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)

  // เรียงเก่าก่อน (FIFO) — วันชั่ง/สร้างเก่าสุดขึ้นก่อน เพื่อระบายสต็อกเก่าออกไปแทน
  const candidates = useMemo(() => stock.filter(r =>
    (!sameOnly || (group.itemCode ? (r as any).item_code === group.itemCode : r.product_name === group.product)) &&
    (!q || String(r.roll_no).includes(q) || (r.lot_no ?? '').toLowerCase().includes(q.toLowerCase()))
  ).sort((a,b) => (a.created_at ?? '').localeCompare(b.created_at ?? '')
    || (a.lot_no ?? '').localeCompare(b.lot_no ?? '') || (a.roll_no ?? 0) - (b.roll_no ?? 0)),
    [stock, sameOnly, q, group])

  // จัดกลุ่มตาม Lot (Lot เก่าขึ้นก่อน — เรียงตามม้วนแรกของ Lot) เพื่อใส่แถวคั่นในตาราง
  const candByLot = useMemo(() => {
    const m = new Map<string, { lot: string; rolls: Roll[] }>()
    candidates.forEach(r => {
      const lot = r.lot_no ?? '(ไม่ระบุ Lot)'
      if (!m.has(lot)) m.set(lot, { lot, rolls: [] })
      m.get(lot)!.rolls.push(r)
    })
    return Array.from(m.values())   // Map รักษาลำดับที่เจอ = FIFO ตาม candidates อยู่แล้ว
  }, [candidates])

  const picked = candidates.filter(r => sel.has(r.id))
  const pickedKg = picked.reduce((s,r) => s + (r.weight ?? 0), 0)
  function toggle(id: string) { setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n }) }

  async function save() {
    if (!staff.trim()) { alert('กรอกชื่อผู้จัดส่ง'); return }
    if (sel.size === 0) { alert('เลือกม้วนที่จะใส่แทนก่อน'); return }
    const docLabel = group.docNo || `ใบเบิก ${group.at ? fmtDT(group.at) : ''}`
    if (!confirm(`ยืนยันใส่ม้วนแทน ${sel.size} ม้วน · ${fmt(pickedKg)} Kgs. เข้า ${docLabel} ?`)) return
    setSaving(true)
    try {
      // ผูกม้วนแทนเข้า "กลุ่มใบเบิกเดิม" —
      //   ใบมีเลข DN → ใช้ ship_doc_no เดียวกัน
      //   ใบไม่มีเลข (ข้อมูลเก่า) → จับกลุ่มด้วย shipped_at+ผู้เบิก จึงต้อง stamp เวลา/ผู้เบิกให้ตรงกลุ่มเดิม
      const patch: any = { shipped: true, so_id: group.soId ?? null }
      if (group.docNo) {
        patch.ship_doc_no = group.docNo
        patch.shipped_at  = new Date().toISOString()
        patch.shipped_by  = staff.trim()
      } else {
        patch.shipped_at  = group.at || new Date().toISOString()   // เข้ากลุ่มเดิม (key = at+by)
        patch.shipped_by  = group.by && group.by !== '—' ? group.by : staff.trim()
      }
      // ด่านเดียวกับ shipRolls — รายการม้วนที่นี่มาจาก stock ในเครื่องซึ่งอาจเก่าหลายชั่วโมง
      // ถ้าไม่กัน จะไปทับม้วนที่เครื่องอื่นส่งออกไปแล้ว (ดึงม้วนหลุดจากใบเดิมที่พิมพ์ให้ลูกค้าไปแล้ว)
      const ids = Array.from(sel)
      const { data: done, error } = await supabase.from('production_rolls').update(patch)
        .in('id', ids)
        .not('shipped', 'is', true)
        .eq('transferred', true)
        .eq('roll_type', 'good')
        .select('id')
      if (error) throw error
      const okN = (done ?? []).length
      if (okN === 0) { alert('⚠ ม้วนที่เลือกถูกจัดส่ง/แจ้ง NC ไปแล้วทั้งหมด — ไม่ได้ใส่แทน'); onDone(); return }
      alert(`✓ ใส่ม้วนแทน ${okN} ม้วนเข้า ${docLabel} แล้ว${okN < ids.length ? `\n⚠ อีก ${ids.length - okN} ม้วนใส่ไม่ได้ (ถูกส่ง/แจ้ง NC ไปแล้ว)` : ''}\nอย่าลืมกด "ออกใบส่งแก้ยอด" เพื่อพิมพ์ใบที่ยอดถูกต้อง`)
      onDone()
    } catch (e: any) { alert('ไม่สำเร็จ: ' + (e?.message ?? e)) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-brand-600 rounded-2xl w-full max-w-4xl p-5 shadow-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-white font-bold text-base flex items-center gap-2"><Plus size={18} className="text-brand-400"/> เพิ่มม้วนแทน — {group.docNo || `ใบเบิก ${group.at ? fmtDT(group.at) : ''}`}</p>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18}/></button>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3 mb-3 text-xs flex flex-wrap gap-x-6 gap-y-0.5">
          <p className="text-slate-400">สินค้า: <b className="text-white">{group.product}</b></p>
          <p className="text-slate-400">ลูกค้า: <b className="text-white">{group.customer}</b></p>
          {group.so && <p className="text-slate-400">SO: <b className="text-blue-300">{group.so}</b></p>}
        </div>

        <div className="flex items-center gap-2 mb-2">
          <div className="flex-1 flex items-center gap-1.5 bg-slate-800 border border-slate-700 rounded-lg px-2.5">
            <Search size={13} className="text-slate-500"/>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นเลขม้วน / Lot"
              className="flex-1 bg-transparent py-2 text-sm text-white outline-none"/>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-300 whitespace-nowrap">
            <input type="checkbox" checked={sameOnly} onChange={e => setSameOnly(e.target.checked)}/> เฉพาะสินค้าเดียวกัน
          </label>
        </div>

        <p className="text-[11px] text-slate-500 mb-1.5">
          เรียงเก่าก่อน (FIFO) · พบ {candidates.length} ม้วน · {candByLot.length} Lot
          {stockLoading && <span className="text-amber-400 ml-2">· กำลังโหลดสต็อกเก่าเพิ่ม…</span>}
        </p>
        <div className="flex-1 overflow-y-auto border border-slate-800 rounded-lg">
          {candidates.length === 0
            ? <div className="text-slate-500 text-sm py-8 text-center">
                {stockLoading ? 'กำลังโหลดสต็อก… (ม้วนเก่ากำลังตามมา)' : `ไม่พบม้วนในสต็อก ${sameOnly ? '(ลองปิด "เฉพาะสินค้าเดียวกัน")' : ''}`}
              </div>
            : (
              <table className="w-full text-xs">
                <thead className="bg-slate-800/80 text-slate-400 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 w-8"></th>
                    <th className="px-3 py-2 text-left">ม้วนที่</th>
                    <th className="px-3 py-2 text-left">วันที่ (ชั่ง)</th>
                    <th className="px-3 py-2 text-left">Lot</th>
                    <th className="px-3 py-2 text-left">สินค้า</th>
                    <th className="px-3 py-2 text-left">เครื่อง</th>
                    <th className="px-3 py-2 text-right">นน.สุทธิ</th>
                  </tr>
                </thead>
                <tbody>
                  {candByLot.map(lg => {
                    const lotIds = lg.rolls.map(r => r.id)
                    const allSel = lotIds.every(id => sel.has(id))
                    const lotKg = lg.rolls.reduce((s,r)=>s+(r.weight??0),0)
                    return (
                      <Fragment key={lg.lot}>
                        <tr className="bg-slate-800/60 border-t-2 border-slate-700">
                          <td className="px-3 py-1.5 text-center">
                            <input type="checkbox" checked={allSel} onChange={() => setSel(p => {
                              const n = new Set(p); allSel ? lotIds.forEach(id => n.delete(id)) : lotIds.forEach(id => n.add(id)); return n
                            })}/>
                          </td>
                          <td colSpan={6} className="px-3 py-1.5">
                            <span className="font-mono font-bold text-amber-300">Lot {lg.lot}</span>
                            <span className="text-slate-500 ml-2">· {lg.rolls.length} ม้วน · {fmt(lotKg,1)} kg</span>
                            {labelPosOf(lg.rolls) && <span className="text-cyan-300 ml-2 font-semibold">· {labelPosOf(lg.rolls)}</span>}
                            <span className="text-slate-600 ml-2 text-[11px]">(ติ๊กหัวแถวเพื่อเลือกทั้ง Lot)</span>
                          </td>
                        </tr>
                        {lg.rolls.map(r => (
                          <tr key={r.id} onClick={() => toggle(r.id)}
                            className={`border-t border-slate-800 cursor-pointer ${sel.has(r.id) ? 'bg-brand-600/25' : 'hover:bg-slate-800/50'}`}>
                            <td className="px-3 py-1.5 text-center"><input type="checkbox" readOnly checked={sel.has(r.id)}/></td>
                            <td className="px-3 py-1.5 font-bold text-white">#{r.roll_no}</td>
                            <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap">{r.created_at ? fmtDT(r.created_at) : '—'}</td>
                            <td className="px-3 py-1.5 font-mono text-slate-500">{r.lot_no}</td>
                            <td className="px-3 py-1.5 text-slate-300 max-w-[220px] truncate">{r.product_name}</td>
                            <td className="px-3 py-1.5 text-slate-400">{r.machine_no ?? '—'}</td>
                            <td className="px-3 py-1.5 text-right font-bold text-brand-300">{fmt(r.weight ?? 0,2)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            )}
        </div>

        <label className="block text-xs text-slate-400 mt-3 mb-1">ชื่อผู้จัดส่ง *</label>
        <input value={staff} onChange={e => setStaff(e.target.value)}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-brand-500"/>

        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-slate-400">เลือก <b className="text-white">{picked.length}</b> ม้วน · <b className="text-brand-300">{fmt(pickedKg)}</b> kg</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-lg text-sm">ยกเลิก</button>
            <button onClick={save} disabled={saving || sel.size === 0} className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-bold">
              {saving ? 'บันทึก...' : 'ใส่แทนในใบนี้'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── ส่งม้วนดีจากคลังกลับไปกรอใหม่ ─────────────────────────────────
function ReturnToReworkModal({ roll, onClose, onDone }:
  { roll: any; onClose: () => void; onDone: () => void }) {
  const [inboundType, setInboundType] = useState<string>('qc_reject')
  const [reason, setReason] = useState('')
  const [by, setBy] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!reason.trim()) { alert('ระบุเหตุผลที่แจ้ง NC'); return }
    if (!by.trim())     { alert('กรอกชื่อผู้แจ้ง'); return }
    setSaving(true)

    const wasShipped = !!roll.shipped   // เคยเบิก/ส่งออกไปแล้ว → รับคืน

    // ── 1) บันทึก log (ม้วนออกจาก FG/คลัง → เข้า NC) ──
    const { error: logErr } = await supabase.from('roll_deletion_logs').insert({
      deleted_by:   by.trim(),
      reason:       `[${wasShipped ? 'รับคืนจากจัดส่ง → NC' : 'แจ้ง NC จากคลัง'}] ${reason.trim()}`,
      machine_no:   roll.machine_no, lot_no: roll.lot_no, roll_no: roll.roll_no,
      roll_type:    'good', weight: roll.weight, gross_weight: roll.gross_weight,
      core_weight:  roll.core_weight, length: roll.length,
      product_name: roll.product_name, product_code: roll.product_code,
      item_code:    roll.item_code, mat_code: roll.mat_code,
      cust_code:    roll.cust_code, cust_name: roll.customer,
      width_cm:     roll.width_cm, thick_mc: roll.thick_mc,
      inspector:    roll.inspector, started_at: roll.created_at,
      section:      roll.section ?? 'blow',
    })
    // log เป็นแค่ paper trail — ถ้า insert ไม่ได้ (เช่น column ยังไม่ครบ) ก็ไม่ขวางการแจ้ง NC
    if (logErr) console.warn('roll_deletion_logs insert failed (non-fatal):', logErr.message)

    // ── กัน roll_no ชน: เปลี่ยน good→bad แล้วเลขม้วนอาจซ้ำกับ "ม้วนกรอ" เดิมใน Lot/WO เดียวกัน
    //    (unique index = machine+lot+wo+roll_no+roll_type) → หาเลข bad ที่ว่างก่อน
    let ncRollNo = roll.roll_no
    const { data: existBad } = await supabase.from('production_rolls')
      .select('roll_no, work_order')
      .eq('machine_no', roll.machine_no).eq('lot_no', roll.lot_no).eq('roll_type', 'bad')
    const sameWoBad = (existBad ?? []).filter((x:any) => (x.work_order ?? '') === (roll.work_order ?? ''))
    const takenBad = new Set(sameWoBad.map((x:any) => x.roll_no))
    let ncNote = reason.trim()
    if (takenBad.has(ncRollNo)) {
      const maxBad = Math.max(0, ...sameWoBad.map((x:any) => x.roll_no ?? 0))
      const origNo = roll.roll_no
      ncRollNo = maxBad + 1
      ncNote = `${reason.trim()} (เดิมม้วนดี #${origNo})`
    }

    // ── 2) ม้วนเข้า NC = รอพิจารณา (ReviewQueue) ไม่เด้งเข้ากรอตรงๆ ──
    //     ผจก ตัดสินทีหลังว่าจะ ส่งกรอ / เศษ / เก็บไว้
    const { error: updErr } = await supabase.from('production_rolls').update({
      roll_type:       'bad',
      roll_no:         ncRollNo,
      remark:          wasShipped ? `${ncNote} (รับคืนจากใบ ${roll.ship_doc_no ?? '—'})` : ncNote,
      inbound_type:    inboundType,
      review_status:   'pending_review',
      review_action:   null,
      rework_status:   null,
      // ปลดออกจากคลัง — กักไว้ NC (ยังไม่ส่งกรอ)
      transferred:     false,
      transferred_by:  null,
      transferred_at:  null,
      transfer_doc_id: null,
      // ถ้าเคยเบิก/ส่งออกไปแล้ว → ล้างสถานะจัดส่งให้หลุดจากใบเดิม (ยอดใบจะแก้ตอนออกใบใหม่)
      ...(wasShipped ? { shipped: false, shipped_at: null, shipped_by: null, ship_doc_no: null, so_id: null } : {}),
    }).eq('id', roll.id)
    setSaving(false)
    if (updErr) { alert('บันทึกไม่สำเร็จ: ' + updErr.message); return }

    const sel = RETURN_TO_REWORK_TYPES.find(t => t.key === inboundType)
    alert(`✓ แจ้ง NC ม้วน #${roll.roll_no} (${fmt(roll.weight)} Kg) แล้ว\nประเภท: ${sel?.no} ${sel?.label}\nเหตุผล: ${reason}\n\nรอ ผจก ตัดสินที่หน้า "พิจารณาม้วน"`)
    onDone()
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-amber-600 rounded-2xl w-full max-w-md p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-white font-bold text-base flex items-center gap-2"><span className="text-xl">⚠</span> {roll.shipped ? 'รับคืน — ม้วนเสียหลังส่ง → NC' : 'แจ้ง NC — ม้วนเสียในคลัง'}</p>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18}/></button>
        </div>

        <div className="bg-slate-800/50 rounded-lg p-3 mb-3 text-xs space-y-0.5">
          <p className="text-slate-400">เครื่อง: <b className="text-white">{roll.machine_no}</b> · Lot: <b className="text-white font-mono">{roll.lot_no}</b></p>
          <p className="text-slate-400">ม้วน <b className="text-white">#{roll.roll_no}</b> · นน. <b className="text-brand-300">{fmt(roll.weight)} Kg</b></p>
          <p className="text-slate-400">สินค้า: <b className="text-white">{roll.product_name}</b></p>
          <p className="text-slate-400">ลูกค้า: <b className="text-white">{roll.customer}</b></p>
        </div>

        <label className="block text-xs text-slate-400 mb-1.5">ประเภท (Phase 1) *</label>
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          {RETURN_TO_REWORK_TYPES.map(t => (
            <button key={t.key} onClick={() => setInboundType(t.key)}
              className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                inboundType === t.key
                  ? 'bg-amber-600 border-amber-500 text-white'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600'
              }`}>
              <p className="font-bold">{t.emoji} {t.no} {t.label}</p>
            </button>
          ))}
        </div>

        <label className="block text-xs text-slate-400 mb-1">เหตุผลที่แจ้ง NC *</label>
        <input value={reason} onChange={e => setReason(e.target.value)}
          placeholder="เช่น แกนติด, ม้วนเป็นลอน, เสียระหว่างขนย้าย, ลูกค้าตีคืน..."
          autoFocus
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-amber-500 mb-3"/>

        <label className="block text-xs text-slate-400 mb-1">ชื่อผู้แจ้ง *</label>
        <input value={by} onChange={e => setBy(e.target.value)}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-amber-500"/>

        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 mt-3 text-xs text-amber-200">
          {roll.shipped
            ? <>💡 ม้วนนี้จะ<b>หลุดจากใบส่ง {roll.ship_doc_no ?? 'เดิม'}</b> → เข้า <b>NC (รอพิจารณา)</b> · อย่าลืมกด <b>"ออกใบส่งแก้ยอด"</b> ที่ประวัติเพื่อพิมพ์ใบใหม่ที่ยอดถูกต้อง</>
            : <>💡 ม้วนนี้จะออกจากคลัง → เข้า <b>NC (รอพิจารณา)</b> ที่หน้า "พิจารณาม้วน" → ผจก ตัดสินว่า <b>ส่งกรอ / เศษเสีย / เก็บไว้</b></>}
        </div>

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 rounded-lg text-sm">ยกเลิก</button>
          <button onClick={save} disabled={saving} className="flex-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-bold">
            {saving ? 'บันทึก...' : '⚠ แจ้ง NC'}
          </button>
        </div>
      </div>
    </div>
  )
}
