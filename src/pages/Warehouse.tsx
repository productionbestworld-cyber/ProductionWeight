import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Package, Plus, Truck, BarChart3, RefreshCw, Search, Printer, Download, X, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'
import * as XLSX from 'xlsx'

function fmt(n: number | null | undefined, d = 2) {
  if (n == null || isNaN(n as number)) return '0.00'
  return (n as number).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d })
}
function fmtDT(iso: string) {
  return new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function thaiDate(d = new Date()) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()+543}`
}

type Tab = 'stock' | 'so' | 'ship'
type SO = {
  id: string; so_no: string; customer: string; product_name: string
  target_kg: number; status: string; created_at: string; note: string
}
type Roll = {
  id: string; roll_no: number; weight: number; gross_weight: number; core_weight: number
  machine_no: string; lot_no: string; product_name: string; customer: string
  inspector: string; created_at: string; transferred_at: string
  so_id: string | null; shipped: boolean; shipped_at: string | null; shipped_by: string | null
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
${Object.entries(groups).map(([lot, items]) => {
  const subKg = items.reduce((s, r) => s + r.weight, 0)
  return `
  <div class="section-title">Lot: ${lot} — ${items[0]?.product_name ?? ''}</div>
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
export default function Warehouse() {
  const [tab, setTab] = useState<Tab>('stock')
  const [rolls, setRolls] = useState<Roll[]>([])
  const [sos, setSOs] = useState<SO[]>([])
  const [loading, setLoading] = useState(true)
  const [showSOModal, setShowSOModal] = useState(false)

  // stock filters
  const [fProduct, setFProduct] = useState('')
  const [fCustomer, setFCustomer] = useState('')
  const [fLot, setFLot] = useState('')
  const [search, setSearch] = useState('')
  const [expandedLots, setExpandedLots] = useState<Set<string>>(new Set())

  // shipment state
  const [selectedSO, setSelectedSO] = useState<SO | null>(null)
  const [selectedRolls, setSelectedRolls] = useState<Set<string>>(new Set())
  const [shipStaff, setShipStaff] = useState('')
  const [shipping, setShipping] = useState(false)

  async function loadAll() {
    setLoading(true)
    const [{ data: r }, { data: s }] = await Promise.all([
      supabase.from('production_rolls').select('*')
        .eq('transferred', true).order('created_at', { ascending: false }),
      supabase.from('sales_orders').select('*').order('created_at', { ascending: false }),
    ])
    setRolls((r ?? []) as Roll[])
    setSOs((s ?? []) as SO[])
    setLoading(false)
  }
  useEffect(() => { loadAll() }, [])

  // stock = transferred แต่ยังไม่ shipped
  const stock = useMemo(() => rolls.filter(r => !r.shipped), [rolls])
  const shipped = useMemo(() => rolls.filter(r => r.shipped), [rolls])

  // filter stock
  const filteredStock = useMemo(() => stock.filter(r =>
    (!fProduct  || r.product_name === fProduct) &&
    (!fCustomer || r.customer === fCustomer) &&
    (!fLot      || r.lot_no === fLot) &&
    (!search    || String(r.roll_no).includes(search) || (r.lot_no ?? '').toLowerCase().includes(search.toLowerCase()))
  ), [stock, fProduct, fCustomer, fLot, search])

  // group stock by lot
  const stockByLot = useMemo(() => {
    const map = new Map<string, { lot: string; product: string; customer: string; rolls: Roll[] }>()
    filteredStock.forEach(r => {
      const k = `${r.lot_no ?? '?'}__${r.product_name ?? '?'}`
      if (!map.has(k)) map.set(k, { lot: r.lot_no ?? '?', product: r.product_name ?? '?', customer: r.customer ?? '?', rolls: [] })
      map.get(k)!.rolls.push(r)
    })
    return Array.from(map.values()).sort((a, b) => a.lot.localeCompare(b.lot))
  }, [filteredStock])

  // dropdown options
  const products  = useMemo(() => Array.from(new Set(stock.map(r => r.product_name).filter(Boolean))).sort(), [stock])
  const customers = useMemo(() => Array.from(new Set(stock.map(r => r.customer).filter(Boolean))).sort(), [stock])
  const lots      = useMemo(() => Array.from(new Set(stock.map(r => r.lot_no).filter(Boolean))).sort(), [stock])

  // available stock for shipment (ยังไม่ผูก SO อื่น หรือผูกกับ SO นี้อยู่แล้ว)
  const availableForShip = useMemo(() =>
    stock.filter(r => !r.so_id || r.so_id === selectedSO?.id)
  , [stock, selectedSO])

  // SO KPIs
  const soStats = useMemo(() => sos.map(so => {
    const soRolls = shipped.filter(r => r.so_id === so.id)
    const shippedKg = soRolls.reduce((s, r) => s + (r.weight ?? 0), 0)
    const pct = so.target_kg ? Math.min((shippedKg / so.target_kg) * 100, 100) : 0
    return { ...so, shippedKg, shippedRolls: soRolls.length, pct }
  }), [sos, shipped])

  function toggleLot(key: string) {
    setExpandedLots(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })
  }
  function toggleRoll(id: string) {
    setSelectedRolls(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAllAvailable() {
    const ids = availableForShip.map(r => r.id)
    if (ids.every(id => selectedRolls.has(id))) setSelectedRolls(new Set())
    else setSelectedRolls(new Set(ids))
  }

  const pickedRolls = availableForShip.filter(r => selectedRolls.has(r.id))
  const pickedKg   = pickedRolls.reduce((s, r) => s + (r.weight ?? 0), 0)

  async function handleShip() {
    if (!selectedSO) { alert('เลือก SO ก่อน'); return }
    if (!shipStaff.trim()) { alert('กรุณากรอกชื่อผู้จัดส่ง'); return }
    if (selectedRolls.size === 0) { alert('เลือกม้วนที่จะส่งก่อน'); return }
    if (!confirm(`ยืนยันจัดส่ง ${selectedRolls.size} ม้วน · ${fmt(pickedKg)} Kgs. ?\nSO: ${selectedSO.so_no}`)) return

    setShipping(true)
    try {
      const now   = new Date().toISOString()
      const docNo = `DN-${Date.now().toString().slice(-8)}`
      const ids   = Array.from(selectedRolls)

      const { error } = await supabase.from('production_rolls').update({
        so_id:       selectedSO.id,
        shipped:     true,
        shipped_at:  now,
        shipped_by:  shipStaff,
      }).in('id', ids)
      if (error) throw error

      // update SO status
      const allSoRolls = [...shipped.filter(r => r.so_id === selectedSO.id), ...pickedRolls]
      const totalShipped = allSoRolls.reduce((s, r) => s + r.weight, 0)
      const newStatus = selectedSO.target_kg && totalShipped >= selectedSO.target_kg ? 'shipped' : 'partial'
      await supabase.from('sales_orders').update({ status: newStatus }).eq('id', selectedSO.id)

      printDelivery(pickedRolls, selectedSO, shipStaff, docNo)
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
      ['ลูกค้า :', customer, '',  'จำนวน :', `${groupRolls.length} ม้วน`,  'น้ำหนักรวม (สุทธิ) :', `${totalKg.toFixed(2)} Kgs.`],
      ['วันที่ Export :', new Date().toLocaleDateString('th-TH')],
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

  const statusBadge = (s: string) => {
    if (s === 'shipped')  return 'bg-green-500/20 text-green-300'
    if (s === 'partial')  return 'bg-amber-500/20 text-amber-300'
    return 'bg-slate-700 text-slate-300'
  }
  const statusLabel = (s: string) => s === 'shipped' ? 'ส่งครบ' : s === 'partial' ? 'ส่งบางส่วน' : 'รอส่ง'

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
              สต็อกคงเหลือ {stock.length} ม้วน · {fmt(stock.reduce((s,r)=>s+(r.weight??0),0),1)} Kgs.
            </p>
          </div>
          <button onClick={loadAll} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-xs bg-slate-800 px-3 py-1.5 rounded-lg">
            <RefreshCw size={12}/> รีเฟรช
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1 w-fit">
          {([
            { key:'stock', label:'สต็อกคงเหลือ', icon: BarChart3 },
            { key:'so',    label:`Sales Orders (${sos.length})`, icon: Package },
            { key:'ship',  label:'จัดส่ง', icon: Truck },
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

          {/* Filters */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-end gap-3 flex-wrap">
            {[
              { label:'สินค้า',  val:fProduct,  set:setFProduct,  opts:products },
              { label:'ลูกค้า',  val:fCustomer, set:setFCustomer, opts:customers },
              { label:'Lot',     val:fLot,       set:setFLot,      opts:lots },
            ].map(f => (
              <div key={f.label}>
                <label className="block text-[10px] text-slate-500 mb-1">{f.label}</label>
                <select value={f.val} onChange={e => f.set(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-brand-500 min-w-[140px]">
                  <option value="">ทั้งหมด</option>
                  {f.opts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            ))}
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">ค้นหา</label>
              <div className="relative">
                <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"/>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ม้วน, Lot..."
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
            : stockByLot.map(group => {
              const key = `${group.lot}__${group.product}`
              const isOpen = expandedLots.has(key)
              const totalKg = group.rolls.reduce((s,r) => s+(r.weight??0), 0)
              return (
                <div key={key} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                  {/* group header */}
                  <div className="flex items-center justify-between px-5 py-3.5">
                    <button onClick={() => toggleLot(key)} className="flex items-center gap-3 flex-1 text-left hover:opacity-80 transition-opacity">
                      {isOpen ? <ChevronDown size={16} className="text-slate-400"/> : <ChevronRight size={16} className="text-slate-400"/>}
                      <div>
                        <p className="text-white font-semibold text-sm">{group.product}</p>
                        <p className="text-slate-500 text-xs">Lot: <span className="text-slate-300 font-mono">{group.lot}</span> · ลูกค้า: {group.customer}</p>
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
                            {['ม้วนที่','เครื่อง','นน.เต็ม','นน.สุทธิ (Kgs.)','ผู้ตรวจ','วันผลิต','รับโอนเมื่อ'].map(h=>(
                              <th key={h} className="px-4 py-2 text-left font-semibold tracking-wider">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                          {group.rolls.map(r => (
                            <tr key={r.id} className="hover:bg-slate-800/30">
                              <td className="px-4 py-2.5 font-mono font-bold text-white">#{r.roll_no}</td>
                              <td className="px-4 py-2.5"><span className="text-[10px] bg-brand-500/20 text-brand-300 font-bold px-1.5 py-0.5 rounded">{r.machine_no||'—'}</span></td>
                              <td className="px-4 py-2.5 text-slate-300">{fmt((r.weight??0)+(r.core_weight??0))}</td>
                              <td className="px-4 py-2.5 text-green-300 font-black">{fmt(r.weight)}</td>
                              <td className="px-4 py-2.5 text-slate-400 text-xs">{r.inspector||'—'}</td>
                              <td className="px-4 py-2.5 text-slate-400 text-xs">{fmtDT(r.created_at)}</td>
                              <td className="px-4 py-2.5 text-slate-500 text-xs">{r.transferred_at ? fmtDT(r.transferred_at) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-slate-700 bg-slate-800/30">
                            <td colSpan={3} className="px-4 py-2 text-slate-400 text-xs font-semibold">รวม {group.rolls.length} ม้วน</td>
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
        </>)}

        {/* ══════════ TAB: SO ═════════════════════════════════════════════ */}
        {tab === 'so' && (<>
          <div className="flex justify-end">
            <button onClick={() => setShowSOModal(true)}
              className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white text-sm px-4 py-2 rounded-xl font-bold transition-colors">
              <Plus size={15}/> สร้าง SO ใหม่
            </button>
          </div>

          {showSOModal && <SOModal onClose={() => setShowSOModal(false)} onSaved={() => { setShowSOModal(false); loadAll() }}/>}

          <div className="space-y-3">
            {soStats.length === 0
              ? <div className="bg-slate-900 border border-slate-800 rounded-2xl py-16 text-center text-slate-500">ยังไม่มี SO</div>
              : soStats.map(so => (
              <div key={so.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-brand-300 font-mono font-bold text-lg">{so.so_no}</p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${statusBadge(so.status)}`}>{statusLabel(so.status)}</span>
                    </div>
                    <p className="text-white font-semibold">{so.customer}</p>
                    <p className="text-slate-400 text-sm">{so.product_name || '—'}</p>
                    {so.note && <p className="text-slate-500 text-xs mt-0.5">{so.note}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-slate-400 text-xs">{new Date(so.created_at).toLocaleDateString('th-TH')}</p>
                    <p className="text-white font-black text-xl mt-1">{fmt(so.shippedKg,1)} <span className="text-xs font-normal text-slate-400">Kgs. ส่งแล้ว</span></p>
                    {so.target_kg > 0 && <p className="text-slate-500 text-xs">เป้า {fmt(so.target_kg,1)} Kgs. · {so.shippedRolls} ม้วน</p>}
                  </div>
                </div>
                {so.target_kg > 0 && (
                  <div>
                    <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                      <span>ความคืบหน้า</span>
                      <span>{so.pct.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${so.pct >= 100 ? 'bg-green-500' : so.pct >= 50 ? 'bg-amber-500' : 'bg-brand-500'}`}
                        style={{ width: `${so.pct}%` }}/>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>)}

        {/* ══════════ TAB: SHIP ═══════════════════════════════════════════ */}
        {tab === 'ship' && (
          <div className="flex gap-4 items-start">

            {/* LEFT — SO selector + staff */}
            <div className="w-72 flex-shrink-0 space-y-3">

              {/* ชื่อผู้จัดส่ง */}
              <div className={`rounded-2xl border p-4 ${shipStaff.trim() ? 'border-green-500/40 bg-green-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
                <p className="text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                  <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-black ${shipStaff.trim() ? 'bg-green-500' : 'bg-amber-500'} text-white`}>1</span>
                  <span className={shipStaff.trim() ? 'text-green-400' : 'text-amber-400'}>ชื่อผู้จัดส่ง</span>
                </p>
                <input value={shipStaff} onChange={e => setShipStaff(e.target.value)}
                  placeholder="กรอกชื่อก่อนจัดส่ง..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-brand-500"/>
                {shipStaff.trim() && <p className="text-green-400 text-xs mt-1.5 flex items-center gap-1"><CheckCircle2 size={11}/> พร้อมจัดส่ง</p>}
              </div>

              {/* เลือก SO */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-black bg-brand-600 text-white">2</span>
                  เลือก SO ที่จะส่ง
                </p>
                <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
                  {sos.filter(s => s.status !== 'shipped').length === 0
                    ? <p className="text-slate-600 text-sm">ไม่มี SO ที่รอส่ง</p>
                    : sos.filter(s => s.status !== 'shipped').map(so => {
                      const isSel = selectedSO?.id === so.id
                      const stat = soStats.find(s => s.id === so.id)
                      return (
                        <button key={so.id} onClick={() => { setSelectedSO(so); setSelectedRolls(new Set()) }}
                          className={`w-full text-left p-3 rounded-xl border transition-all ${isSel ? 'border-brand-500 bg-brand-500/15' : 'border-slate-700 hover:border-slate-500 hover:bg-slate-800/50'}`}>
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-brand-300 font-mono font-bold text-xs">{so.so_no}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusBadge(so.status)}`}>{statusLabel(so.status)}</span>
                          </div>
                          <p className="text-white text-xs font-semibold truncate">{so.customer}</p>
                          <p className="text-slate-500 text-[10px] truncate">{so.product_name || '—'}</p>
                          {so.target_kg > 0 && stat && (
                            <div className="mt-1.5 h-1 bg-slate-700 rounded-full overflow-hidden">
                              <div className="h-full bg-brand-500 rounded-full" style={{ width: `${stat.pct}%` }}/>
                            </div>
                          )}
                          {so.target_kg > 0 && stat && (
                            <p className="text-slate-500 text-[10px] mt-0.5">ส่งแล้ว {fmt(stat.shippedKg,1)} / {fmt(so.target_kg,1)} Kgs.</p>
                          )}
                        </button>
                      )
                    })
                  }
                </div>
              </div>
            </div>

            {/* RIGHT — เลือกม้วน */}
            <div className="flex-1 space-y-3">

              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-black bg-brand-600 text-white">3</span>
                  เลือกม้วนที่จะส่ง
                  {selectedSO && <span className="text-brand-300 normal-case font-normal">— {selectedSO.so_no}</span>}
                </p>
              </div>

              {!selectedSO ? (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl py-20 text-center text-slate-500">
                  เลือก SO ทางซ้ายก่อน
                </div>
              ) : (<>

                {/* KPI strip */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-slate-800/40 border border-slate-700 rounded-xl px-4 py-2.5">
                    <p className="text-slate-500 text-[10px]">สต็อกพร้อมส่ง</p>
                    <p className="text-white font-black text-lg">{availableForShip.length} <span className="text-xs font-normal text-slate-400">ม้วน</span></p>
                    <p className="text-slate-400 text-[10px]">{fmt(availableForShip.reduce((s,r)=>s+(r.weight??0),0),1)} Kgs.</p>
                  </div>
                  <div className={`border rounded-xl px-4 py-2.5 transition-all ${selectedRolls.size > 0 ? 'bg-brand-500/15 border-brand-500/40' : 'bg-slate-800/40 border-slate-700'}`}>
                    <p className="text-slate-500 text-[10px]">เลือกแล้ว</p>
                    <p className="text-brand-300 font-black text-lg">{selectedRolls.size} <span className="text-xs font-normal text-slate-400">ม้วน</span></p>
                    <p className="text-brand-400 text-[10px]">{fmt(pickedKg,1)} Kgs.</p>
                  </div>
                  {selectedSO.target_kg > 0 && (
                    <div className="bg-slate-800/40 border border-slate-700 rounded-xl px-4 py-2.5">
                      <p className="text-slate-500 text-[10px]">เป้า SO</p>
                      <p className="text-amber-300 font-black text-lg">{fmt(selectedSO.target_kg,1)} <span className="text-xs font-normal text-slate-400">Kgs.</span></p>
                      <p className="text-slate-500 text-[10px]">คงเหลือ {fmt(Math.max(selectedSO.target_kg - (soStats.find(s=>s.id===selectedSO.id)?.shippedKg??0) - pickedKg, 0),1)} Kgs.</p>
                    </div>
                  )}
                </div>

                {/* Confirm bar */}
                {selectedRolls.size > 0 && (
                  <div className="rounded-2xl border border-brand-500/40 bg-brand-500/10 px-5 py-4 flex items-center justify-between">
                    <div>
                      <p className="text-white font-bold">จัดส่ง {selectedRolls.size} ม้วน · <span className="text-brand-300">{fmt(pickedKg)} Kgs.</span></p>
                      <p className="text-slate-400 text-xs mt-0.5">ผู้จัดส่ง: <b className={shipStaff.trim() ? 'text-white' : 'text-red-400'}>{shipStaff.trim() || '⚠ ยังไม่ได้กรอกชื่อ'}</b></p>
                    </div>
                    <button onClick={handleShip} disabled={shipping || !shipStaff.trim()}
                      className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm px-5 py-2.5 rounded-xl font-bold transition-colors">
                      <Truck size={15}/> {shipping ? 'กำลังส่ง...' : 'ยืนยันจัดส่ง + พิมพ์ใบ'}
                    </button>
                  </div>
                )}

                {/* Roll list grouped by lot */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-800/20 flex items-center justify-between">
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-300 select-none">
                      <input type="checkbox" onChange={toggleAllAvailable}
                        checked={availableForShip.length > 0 && availableForShip.every(r => selectedRolls.has(r.id))}
                        className="w-4 h-4 accent-brand-500"/>
                      เลือกทั้งหมด ({availableForShip.length} ม้วน)
                    </label>
                    <p className="text-slate-500 text-xs">{fmt(availableForShip.reduce((s,r)=>s+(r.weight??0),0))} Kgs.</p>
                  </div>

                  {availableForShip.length === 0
                    ? <div className="py-16 text-center text-slate-500 text-sm">ไม่มีม้วนในสต็อก</div>
                    : (
                    <div className="divide-y divide-slate-800/60">
                      {availableForShip.map(r => {
                        const isSel = selectedRolls.has(r.id)
                        return (
                          <div key={r.id} onClick={() => toggleRoll(r.id)}
                            className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${isSel ? 'bg-brand-500/12' : 'hover:bg-slate-800/50'}`}>
                            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${isSel ? 'bg-brand-500 border-brand-500' : 'border-slate-600'}`}>
                              {isSel && <span className="text-white text-[10px] font-black">✓</span>}
                            </div>
                            <span className="bg-brand-600 text-white font-black text-xs px-2 py-1 rounded-lg w-12 text-center flex-shrink-0">{r.machine_no||'?'}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline gap-2">
                                <span className="font-mono font-black text-white">ม้วน #{r.roll_no}</span>
                                <span className="text-slate-500 text-xs font-mono">Lot {r.lot_no}</span>
                              </div>
                              <p className="text-slate-500 text-xs truncate">{r.product_name||'—'}</p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="font-black text-lg text-brand-300 leading-none">{fmt(r.weight)}</p>
                              <p className="text-slate-600 text-[10px]">Kgs. สุทธิ</p>
                            </div>
                            <div className="text-right flex-shrink-0 w-14">
                              <p className="text-slate-400 text-xs">{fmtDT(r.created_at).slice(0,5)}</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </>)}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
