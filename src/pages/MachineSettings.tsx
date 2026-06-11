import { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, Save, ChevronDown, ChevronUp, RefreshCw, X, Search } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchProducts, addProductIfMissing, backfillProductMatCore, backfillCustomer, type Product } from './Products'

// ── Display helpers ───────────────────────────────────────────────────────────
// แสดงขนาดให้ตรงกับหน่วยที่ผู้ใช้เลือก — ใช้ทุกหน้าทั่วระบบ
export function fmtSize(
  widthCm?: string | null,
  thickMc?: string | null,
  widthUnit?: 'cm' | 'mm' | null,
  opts?: { sep?: string; noUnit?: boolean }
): string {
  const w = (widthCm ?? '').toString().trim()
  const t = (thickMc ?? '').toString().trim()
  if (!w && !t) return ''
  const u = (widthUnit ?? 'cm') as 'cm' | 'mm'
  const sep = opts?.sep ?? '×'
  if (opts?.noUnit) return `${w}${sep}${t}`
  return `${w}${u}${sep}${t}mc`
}
// แปลงค่าเมื่อสลับหน่วย: cm↔mm
export function convertWidth(value: string, from: 'cm'|'mm', to: 'cm'|'mm'): string {
  if (from === to) return value
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return value
  const converted = from === 'cm' ? n * 10 : n / 10
  // ตัดทศนิยมท้าย .0
  return converted.toString()
}

// ── Full Machine Profile ──────────────────────────────────────────────────────
export interface MachineProfile {
  machine_no:  string
  // ลูกค้า
  custCode:    string
  custName:    string
  custBranch:  string
  custAddress: string
  decimal:     1 | 2
  // สินค้า
  itemCode:    string   // ใช้เลือกจากคลัง (lookup master)
  matCode:     string   // กรอกเองในแต่ละงาน
  productCode: string
  productName: string
  widthCm:     string
  widthUnit:   'cm' | 'mm'   // หน่วยกว้าง (ส่วนใหญ่ cm; บางงานสั่ง mm)
  thickMc:     string
  lotNo:       string
  length:      string
  pcs:         string
  // เครื่อง
  coreWeight:  string
  inspector:   string
  locked:      boolean
  // ยอดสั่งผลิต
  plannedQty:  string
  // ใบปะหน้า
  labelSize:   'long' | 'short'
  headerText:  string   // หัวกระดาษใบสั้น (กำหนดเอง)
  blankHeader: boolean  // ติ๊ก = เว้นหัวว่าง
  // แผนก
  section:     'blow' | 'print' | 'rewind'
  // Sale Order
  soNo:        string
  // เลขใบคำสั่งผลิต (Work Order)
  woNo:        string
  // วันที่ส่งของ
  deliveryDate: string  // YYYY-MM-DD
  // เริ่มนับม้วนใหม่ (SO เดียวคนละ WO ใน Lot เดียวกัน)
  freshStart?: boolean
}

const EMPTY_PROFILE: MachineProfile = {
  machine_no:'', custCode:'', custName:'', custBranch:'', custAddress:'', decimal:2,
  itemCode:'', matCode:'', productCode:'', productName:'', widthCm:'', widthUnit:'cm', thickMc:'',
  lotNo:'', length:'', pcs:'', coreWeight:'1.25', inspector:'', locked:false,
  plannedQty:'', labelSize:'long', headerText:'', blankHeader:false, section:'blow',
  soNo:'', woNo:'', deliveryDate:'',
}

function nextMachineNo(profiles: MachineProfile[], section: string = 'blow'): string {
  const prefix = section === 'print' ? 'PM' : section === 'rewind' ? 'S' : 'BL'
  const re = new RegExp(`^${prefix}[-\\s]?(\\d+)$`, 'i')
  const nums = profiles
    .map(p => p.machine_no.match(re))
    .filter(Boolean)
    .map(m => parseInt(m![1]))
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1
  return `${prefix}${String(next).padStart(2, '0')}`
}

// ── DB ↔ App type conversion ──────────────────────────────────────────────────
function dbToProfile(row: any): MachineProfile {
  return {
    machine_no:  row.machine_no,
    custCode:    row.cust_code    ?? '',
    custName:    row.cust_name    ?? '',
    custBranch:  row.cust_branch  ?? '',
    custAddress: row.cust_address ?? '',
    decimal:     (row.decimal_places ?? 2) as 1|2,
    itemCode:    row.item_code    ?? '',
    matCode:     row.mat_code     ?? '',
    productCode: row.product_code ?? '',
    productName: row.product_name ?? '',
    widthCm:     row.width_cm     ?? '',
    widthUnit:   (row.width_unit  ?? 'cm') as 'cm'|'mm',
    thickMc:     row.thick_mc     ?? '',
    lotNo:       row.lot_no       ?? '',
    length:      row.length       ?? '',
    pcs:         row.pcs          ?? '',
    coreWeight:  row.core_weight  ?? '1.25',
    inspector:   row.inspector    ?? '',
    locked:      row.locked       ?? true,
    plannedQty:  row.planned_qty  ?? '',
    labelSize:   (row.label_size  ?? 'long') as 'long'|'short',
    headerText:  row.header_text  ?? '',
    blankHeader: row.blank_header ?? false,
    section:     (row.section     ?? 'blow') as 'blow'|'print'|'rewind',
    soNo:        row.sale_order   ?? '',
    woNo:        row.work_order    ?? '',
    deliveryDate: row.delivery_date ?? '',
    freshStart:  row.fresh_start  ?? false,
  }
}
function profileToDb(p: MachineProfile) {
  return {
    machine_no:    p.machine_no,
    cust_code:     p.custCode,
    cust_name:     p.custName,
    cust_branch:   p.custBranch,
    cust_address:  p.custAddress,
    decimal_places: p.decimal,
    item_code:     p.itemCode,
    mat_code:      p.matCode,
    product_code:  p.productCode,
    product_name:  p.productName,
    width_cm:      p.widthCm,
    width_unit:    p.widthUnit ?? 'cm',
    thick_mc:      p.thickMc,
    lot_no:        p.lotNo,
    length:        p.length,
    pcs:           p.pcs,
    core_weight:   p.coreWeight,
    inspector:     p.inspector,
    locked:        p.locked,
    planned_qty:   p.plannedQty,
    label_size:    p.labelSize,
    header_text:   p.headerText,
    blank_header:  p.blankHeader,
    section:       p.section,
    sale_order:    p.soNo ?? '',
    work_order:    p.woNo ?? '',
    delivery_date: p.deliveryDate || null,
    fresh_start:   p.freshStart ?? false,
    updated_at:    new Date().toISOString(),
  }
}

// ── เผื่อ fallback localStorage ───────────────────────────────────────────────
const STORAGE_KEY = 'bwp_machine_profiles'
export function loadProfiles(): MachineProfile[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') } catch { return [] }
}
export function saveProfiles(p: MachineProfile[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
}

// ─── Compact Machine Card (grid view) ────────────────────────────────────────
function MachineCard({ p, onEdit }: { p: MachineProfile; onEdit: () => void }) {
  const ready = !!(p.machine_no && p.custName && p.productName && (p.itemCode || p.matCode) && p.lotNo)
  return (
    <button onClick={onEdit} className={`w-full text-left rounded-2xl border-2 transition-all hover:border-brand-500 overflow-hidden group ${
      ready ? 'bg-slate-900 border-slate-700' : 'bg-slate-900/60 border-amber-500/40 border-dashed'
    }`}>
      {/* top bar */}
      <div className={`flex items-center justify-between px-3 py-2 border-b ${
        ready ? 'bg-brand-600/15 border-brand-500/20' : 'bg-amber-500/10 border-amber-500/20'
      }`}>
        <span className={`font-black text-base tracking-wide ${ready ? 'text-brand-300' : 'text-amber-400'}`}>
          {p.machine_no}
        </span>
        <div className="flex items-center gap-1.5">
          {ready
            ? <span className="text-[10px] text-green-400 font-bold flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block"/>พร้อม</span>
            : <span className="text-[10px] text-amber-400 font-bold">⚠ ไม่ครบ</span>
          }
          <span className="text-slate-600 text-[10px] group-hover:text-slate-400 transition-colors">✎</span>
        </div>
      </div>
      {/* content */}
      <div className="px-3 py-2.5 space-y-1.5">
        {ready ? (<>
          <p className="text-white font-bold text-sm leading-tight line-clamp-1">{p.productName}</p>
          <p className="text-slate-400 text-xs truncate">{p.custName}</p>
          <div className="flex gap-1 flex-wrap">
            {p.soNo && <span className="text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/25 px-1.5 py-0.5 rounded font-bold">SO {p.soNo}</span>}
            <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono border border-slate-700">Lot {p.lotNo.slice(-8)}</span>
            {p.widthCm && <span className="text-[10px] bg-brand-500/15 text-brand-300 border border-brand-500/25 px-1.5 py-0.5 rounded font-bold">{p.widthCm}×{p.thickMc}mc</span>}
          </div>
          <div className="grid grid-cols-2 gap-x-2 text-[10px] text-slate-500 mt-0.5">
            <span>Item: <b className="text-slate-300">{p.itemCode || '—'}</b></span>
            <span>Mat: <b className="text-slate-300">{p.matCode || '—'}</b></span>
            <span>ผู้ตรวจ: <b className="text-slate-300">{p.inspector || '—'}</b></span>
            <span>เป้า: <b className="text-slate-300">{p.plannedQty ? Number(p.plannedQty).toLocaleString() + ' Kgs.' : '—'}</b></span>
            <span>Core: <b className="text-slate-300">{p.coreWeight} Kg</b></span>
          </div>
        </>) : (
          <p className="text-slate-500 text-xs py-2 text-center">คลิกเพื่อกรอกข้อมูลงาน</p>
        )}
      </div>
    </button>
  )
}

// ─── Item Code Autocomplete (ดึงจาก products table) ──────────────────────────
function ItemCodeAutocomplete({ value, products, onChange, onPick }: {
  value: string
  products: Product[]
  onChange: (v: string) => void
  onPick: (s: Product) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const filtered = (() => {
    const v = value.trim().toLowerCase()
    if (!v) return products.filter(s => s.item_code)  // โชว์ทั้งหมด
    return products.filter(s => {
      if (!s.item_code) return false
      const sizeStr = `${s.width_cm ?? ''}x${s.thick_mc ?? ''}`.toLowerCase()
      return (
        s.item_code.toLowerCase().includes(v) ||
        s.product_name?.toLowerCase().includes(v) ||
        s.cust_name?.toLowerCase().includes(v) ||
        (s.width_cm ?? '').toLowerCase().includes(v) ||
        (s.thick_mc ?? '').toLowerCase().includes(v) ||
        sizeStr.includes(v)
      )
    })
  })()

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"/>
        <input
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          placeholder="พิมพ์ค้นหา (item code / size / ลูกค้า) หรือคลิกเลือก..."
          className="w-full bg-slate-800 border-2 border-brand-500/40 hover:border-brand-500 focus:border-brand-500 rounded-lg pl-8 pr-8 py-2 text-white text-sm outline-none cursor-pointer"
        />
        <ChevronDown size={14} className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-brand-400 pointer-events-none transition-transform ${open?'rotate-180':''}`}/>
      </div>
      {open && (
        <div className="absolute z-10 mt-1 w-[200%] max-w-md bg-slate-800 border border-brand-500/40 rounded-lg shadow-2xl max-h-80 overflow-y-auto">
          <div className="sticky top-0 bg-slate-900 border-b border-slate-700 px-3 py-1.5 text-[10px] text-slate-400 flex justify-between">
            <span>พบ {filtered.length} รายการ {value.trim() && `(กรอง: "${value.trim()}")`}</span>
            <span className="text-brand-400">พิมพ์เพื่อกรอง / Enter เพื่อใช้ค่าที่พิมพ์</span>
          </div>
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-xs text-slate-400 text-center">
              <p>ไม่พบ Item Code ที่ตรงกัน</p>
              <p className="text-brand-400 mt-1">กด Enter เพื่อใช้ค่าที่พิมพ์ หรือเพิ่มที่เมนู "คลัง Item Code"</p>
            </div>
          ) : filtered.map((s, i) => (
            <button
              key={s.id ?? s.item_code + i}
              type="button"
              onMouseDown={e => { e.preventDefault(); onPick(s); setOpen(false) }}
              className="w-full text-left px-3 py-2 hover:bg-slate-700 border-b border-slate-700/50 last:border-0"
            >
              <div className="flex items-center gap-2">
                <span className="text-brand-400 font-mono font-bold text-xs">{s.item_code}</span>
                {s.width_cm && (
                  <span className="text-[10px] bg-brand-500/15 text-brand-300 px-1.5 py-0.5 rounded">
                    {s.width_cm}×{s.thick_mc}mc
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-300 mt-0.5 truncate">{s.product_name || '—'}</div>
              <div className="text-[10px] text-slate-500 truncate">👤 {s.cust_name || '—'}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────
function EditModal({ p, products, onChange, onAutoFill, onRemove, onClose, onProductAdded }: {
  p: MachineProfile
  products: Product[]
  onChange: (k: keyof MachineProfile, v: any) => void
  onAutoFill: (patch: Partial<MachineProfile>) => void
  onRemove: () => void
  onClose: () => void
  onProductAdded?: () => void
}) {
  // เติมรหัสลูกค้าอัตโนมัติ ถ้าโปรไฟล์มี Item Code แต่รหัสลูกค้าว่าง (ข้อมูลเก่าไม่ครบ)
  useEffect(() => {
    try {
      if ((p.custCode ?? '').trim()) return
      const ic = (p.itemCode ?? '').trim()
      if (!ic || !Array.isArray(products)) return
      const prod = products.find(x => x.item_code === ic)
      if (prod && (prod.cust_code ?? '').trim()) onChange('custCode', prod.cust_code)
    } catch (e) { console.warn('[fill custCode]', e) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, p.itemCode])

  const f = (label: string, k: keyof MachineProfile, ph = '', half = false) => (
    <div className={half ? '' : 'col-span-2'}>
      <label className="block text-[10px] text-slate-500 mb-1">{label}</label>
      <input value={(p[k] as string) ?? ''} placeholder={ph}
        onChange={e => {
          const val = e.target.value
          if (k === 'matCode') {
            // พิมพ์ Mat Code ตรงกับสินค้า → เด้งข้อมูลให้เลย
            const m = products.find(x => (x.mat_code ?? '').trim().toLowerCase() === val.trim().toLowerCase() && val.trim() !== '')
            if (m) {
              onAutoFill({
                matCode:     val,
                itemCode:    m.item_code,
                productCode: m.product_code,
                productName: m.product_name,
                widthCm:     m.width_cm,
                thickMc:     m.thick_mc,
                custCode:    m.cust_code,
                custName:    m.cust_name ?? '',
                custAddress: m.cust_address ?? '',
                coreWeight:  m.core_weight ?? '',
              })
              return
            }
          }
          onChange(k, val)
        }}
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500" />
    </div>
  )
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between shrink-0">
          <p className="text-white font-bold">⚙ เครื่อง {p.machine_no}</p>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18}/></button>
        </div>
        <div className="overflow-y-auto px-5 py-4 space-y-4">

          {/* ── 1) เครื่อง ─────────────────────────────────────── */}
          <p className="text-[10px] text-brand-400 font-bold uppercase tracking-wider">ขั้นที่ 1 — เครื่อง</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">แผนก *</label>
              <div className="flex gap-1">
                {([{key:'blow',label:'🌬 เป่า'},{key:'print',label:'🖨 พิมพ์'},{key:'rewind',label:'🔁 กรอ'}] as const).map(s => (
                  <button key={s.key} onMouseDown={e => { e.preventDefault(); onChange('section', s.key) }}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${p.section===s.key?'bg-brand-600 text-white':'bg-slate-800 text-slate-400 hover:text-white'}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            {f('หมายเลขเครื่อง *','machine_no','',true)}
          </div>

          {/* ── 2) งานครั้งนี้ + เลือก Item Code ───────────────── */}
          <p className="text-[10px] text-brand-400 font-bold uppercase tracking-wider mt-1">
            ขั้นที่ 2 — งานครั้งนี้ <span className="text-emerald-400 normal-case">(เลือก Item Code → เติมสินค้า+ลูกค้าให้อัตโนมัติ)</span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            {f('Sale Order (SO)','soNo','',true)}
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Item Code *</label>
              <ItemCodeAutocomplete
                value={p.itemCode}
                products={products}
                onChange={v => {
                  // หา product ที่ตรงกับ value
                  const match = products.find(x => x.item_code === v.trim())
                  if (match) {
                    // ตรงเป๊ะ → auto-fill (แกน+matcode จาก DB; ถ้าไม่มีเว้นว่างให้กรอกเอง)
                    onAutoFill({
                      itemCode:    match.item_code,
                      productCode: match.product_code,
                      productName: match.product_name,
                      widthCm:     match.width_cm,
                      thickMc:     match.thick_mc,
                      custCode:    match.cust_code,
                      custName:    match.cust_name ?? '',
                      custAddress: match.cust_address ?? '',
                      matCode:     match.mat_code ?? '',
                      coreWeight:  match.core_weight ?? '',
                    })
                  } else {
                    // ไม่ตรง → เก็บแค่ itemCode + ล้าง auto-fill ที่เหลือ
                    onAutoFill({
                      itemCode: v,
                      productCode:'', productName:'',
                      widthCm:'', thickMc:'',
                      custCode:'', custName:'', custAddress:'',
                      matCode:'', coreWeight:'',
                    })
                  }
                }}
                onPick={s => onAutoFill({
                  itemCode:    s.item_code,
                  productCode: s.product_code,
                  productName: s.product_name,
                  widthCm:     s.width_cm,
                  thickMc:     s.thick_mc,
                  custCode:    s.cust_code,
                  custName:    s.cust_name,
                  custAddress: s.cust_address,
                  matCode:     s.mat_code ?? '',
                  coreWeight:  s.core_weight ?? '',
                })}
              />
              {(p.itemCode ?? '').trim() && !products.some(x => x.item_code === (p.itemCode ?? '').trim()) && (
                <button type="button"
                  onClick={async () => {
                    if (!(p.productName ?? '').trim()) { alert('กรอกชื่อสินค้าก่อน จึงจะบันทึกเป็นสินค้าใหม่ได้'); return }
                    const r = await addProductIfMissing({
                      item_code: p.itemCode ?? '', product_code: p.productCode ?? '', product_name: p.productName ?? '',
                      width_cm: p.widthCm ?? '', width_unit: p.widthUnit ?? 'cm', thick_mc: p.thickMc ?? '',
                      cust_code: p.custCode ?? '', mat_code: p.matCode ?? '', core_weight: p.coreWeight ?? '',
                    })
                    if (r.ok) { alert(r.added ? `✓ เพิ่มสินค้า "${p.itemCode}" เข้าระบบแล้ว` : 'สินค้านี้มีอยู่แล้ว'); onProductAdded && onProductAdded() }
                    else alert('เพิ่มไม่สำเร็จ: ' + r.error)
                  }}
                  className="mt-1 w-full bg-emerald-600/90 hover:bg-emerald-500 text-white text-xs font-bold py-1.5 rounded-lg">
                  ➕ Item Code นี้ยังไม่มีในระบบ — บันทึกเป็นสินค้าใหม่
                </button>
              )}
            </div>
            {f('Mat Code','matCode','',true)}
            {/* Lot No — กดปุ๊ป auto-gen ทันที (ถ้าว่าง), แก้ได้ */}
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Lot No * <span className="text-emerald-400 normal-case">(คลิก → สร้างให้)</span></label>
              <input
                value={(p.lotNo as string) ?? ''}
                onChange={e => onChange('lotNo', e.target.value)}
                onFocus={() => {
                  if ((p.lotNo ?? '').trim()) return
                  const yy = String((new Date().getFullYear() + 543) % 100).padStart(2, '0')
                  const mm = String(new Date().getMonth() + 1).padStart(2, '0')
                  const mc = (p.machine_no ?? '').toUpperCase()
                  const cc = (p.custCode ?? '').replace(/\D/g, '').padStart(4, '0').slice(-4)
                  if (!mc || !cc || cc === '0000') return
                  onChange('lotNo', `${yy}${mc}${cc}${mm}`)
                }}
                placeholder="คลิกเพื่อสร้างอัตโนมัติ หรือพิมพ์เอง..."
                className="w-full bg-slate-800 border-2 border-brand-500/40 hover:border-brand-500 focus:border-brand-500 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none font-mono cursor-pointer" />
            </div>
            {f('Length (Ms.)','length','',true)}
            {f('Pcs.','pcs','',true)}
            {f('ยอดสั่งผลิต (kg) *','plannedQty','',true)}
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">ทศนิยม</label>
              <div className="flex gap-1">
                {([1,2] as const).map(d => (
                  <button key={d} onMouseDown={e => { e.preventDefault(); onChange('decimal', d) }}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold ${p.decimal===d?'bg-brand-600 text-white':'bg-slate-800 text-slate-400'}`}>
                    {d} ตำแหน่ง
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── 3) ข้อมูลสินค้า (auto-fill ได้, แก้ไขได้) ─────── */}
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">รายละเอียดสินค้า</p>
          <div className="grid grid-cols-2 gap-2">
            {f('Product Code','productCode','',true)}
            {f('ชื่อสินค้า (Product Name) *','productName','พิมพ์ชื่อสินค้าเองได้ ถ้าไม่มี')}
            {/* กว้าง + หน่วย cm/mm */}
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">กว้าง *</label>
              <div className="flex gap-1">
                <input value={(p.widthCm as string) ?? ''} onChange={e => onChange('widthCm', e.target.value)}
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500" />
                {(['cm','mm'] as const).map(u => (
                  <button key={u} type="button"
                    onMouseDown={e => {
                      e.preventDefault()
                      const cur = (p.widthUnit ?? 'cm') as 'cm'|'mm'
                      if (cur !== u) {
                        // แปลงค่าเมื่อสลับหน่วย
                        onChange('widthCm', convertWidth((p.widthCm as string) ?? '', cur, u))
                      }
                      onChange('widthUnit', u)
                    }}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-bold ${
                      (p.widthUnit ?? 'cm') === u ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}>{u}</button>
                ))}
              </div>
            </div>
            {f('หนา (mc)','thickMc','',true)}
          </div>

          {/* ── 4) ลูกค้า (auto-fill ได้) ──────────────────────── */}
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">ลูกค้า</p>
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-2">
              <label className="block text-[10px] text-slate-500 mb-1">รหัส</label>
              <input value={(p.custCode as string) ?? ''} onChange={e => {
                  const newCode = e.target.value.slice(0,3)
                  // เช็คก่อนว่า lot เดิมเป็น auto-gen ของ custCode เก่าหรือไม่
                  const yy = String((new Date().getFullYear() + 543) % 100).padStart(2,'0')
                  const mm = String(new Date().getMonth() + 1).padStart(2,'0')
                  const mc = (p.machine_no ?? '').toUpperCase()
                  const oldCc = (p.custCode ?? '').replace(/\D/g,'').padStart(4,'0').slice(-4)
                  const oldAuto = mc && oldCc !== '0000' ? `${yy}${mc}${oldCc}${mm}` : ''
                  onChange('custCode', newCode)
                  if (oldAuto && (p.lotNo ?? '') === oldAuto) {
                    const newCcDigits = newCode.replace(/\D/g,'').padStart(4,'0').slice(-4)
                    if (mc && newCcDigits !== '0000') {
                      onChange('lotNo', `${yy}${mc}${newCcDigits}${mm}`)
                    }
                  }
                }}
                maxLength={3}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500 font-mono"/>
            </div>
            <div className="col-span-7">
              <label className="block text-[10px] text-slate-500 mb-1">ชื่อลูกค้า *</label>
              <input value={(p.custName as string) ?? ''} onChange={e => onChange('custName', e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500"/>
            </div>
            <div className="col-span-3">
              <label className="block text-[10px] text-slate-500 mb-1">สาขา</label>
              <input value={(p.custBranch as string) ?? ''} onChange={e => onChange('custBranch', e.target.value)}
                placeholder="เช่น สำนักงานใหญ่"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500"/>
            </div>
          </div>

          {/* ── 5) ตั้งค่าการชั่ง + ใบปะหน้า ───────────────────── */}
          <p className="text-[10px] text-brand-400 font-bold uppercase tracking-wider mt-1">ขั้นที่ 3 — ตั้งค่าการชั่ง</p>
          <div className="grid grid-cols-2 gap-2">
            {f('Core Weight (kg)','coreWeight','',true)}
            {f('ผู้ตรวจสอบ','inspector','',true)}
            <div className="col-span-2">
              <label className="block text-[10px] text-slate-500 mb-1">ใบปะหน้า</label>
              <div className="flex gap-1">
                {(['long','short'] as const).map(s => (
                  <button key={s} onMouseDown={e => { e.preventDefault(); onChange('labelSize', s) }}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold ${p.labelSize===s?'bg-brand-600 text-white':'bg-slate-800 text-slate-400'}`}>
                    {s==='long'?'📄 ยาว 165×70':'🏷 สั้น 76×76'}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {p.labelSize==='short' && (
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 cursor-pointer select-none"
                onMouseDown={e => { e.preventDefault(); onChange('blankHeader', !p.blankHeader) }}>
                <input type="checkbox" readOnly checked={!!p.blankHeader} className="w-4 h-4 accent-brand-500 pointer-events-none"/>
                <span className="text-xs text-slate-300">เว้นหัวกระดาษว่าง</span>
              </label>
              {!p.blankHeader && (
                <input value={p.headerText??''} onChange={e => onChange('headerText', e.target.value)}
                  placeholder="ปล่อยว่าง = ใช้ชื่อบริษัท BWP"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500"/>
              )}
            </div>
          )}
          <button onClick={onRemove}
            className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-red-400 transition-colors">
            <Trash2 size={12}/> ลบเครื่องนี้
          </button>
        </div>
        <div className="px-5 py-3 border-t border-slate-800 shrink-0">
          <button onClick={onClose} className="w-full bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl font-bold text-sm">
            ✓ เสร็จสิ้น (บันทึกอัตโนมัติ)
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Settings Page ───────────────────────────────────────────────────────
export default function MachineSettings({ dept }: { dept?: 'blow'|'print'|'rewind' }) {
  const [profiles,     setProfiles]     = useState<MachineProfile[]>([])
  const [products,     setProducts]     = useState<Product[]>([])
  const [saved,        setSaved]        = useState(false)
  const [loading,      setLoading]      = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [newMachineNo, setNewMachineNo] = useState('')
  const [newSection,   setNewSection]   = useState<'blow'|'print'|'rewind'>(dept ?? 'blow')
  const [activeTab,    setActiveTab]    = useState<'blow'|'print'|'rewind'>(dept ?? 'blow')
  const [editIdx,      setEditIdx]      = useState<number|null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // ถ้า dept เปลี่ยน (เช่นสลับฝั่งแล้วกดตั้งค่า) → sync tab
  useEffect(() => { if (dept) { setActiveTab(dept); setNewSection(dept) } }, [dept])

  // โหลด products (คลัง Item Code) สำหรับ autocomplete
  useEffect(() => { fetchProducts().then(setProducts) }, [])

  // โหลดจาก Supabase เมื่อเปิดหน้า + sure ว่ามี BL01..BL11 ครบ
  useEffect(() => {
    supabase.from('machine_profiles').select('*').order('machine_no')
      .then(async ({ data }) => {
        const loaded: MachineProfile[] = (data && data.length > 0)
          ? data.map(dbToProfile)
          : loadProfiles()

        // ── ลบเครื่อง RW* เก่า (ถ้ามี) ก่อน seed S01-S04 ──
        const legacyRW = loaded.filter(p => /^RW\d+$/i.test(p.machine_no))
        if (legacyRW.length > 0) {
          for (const rw of legacyRW) {
            await supabase.from('machine_profiles').delete().eq('machine_no', rw.machine_no)
          }
          // เอาออกจาก list ในหน่วยความจำด้วย
          for (const rw of legacyRW) {
            const i = loaded.findIndex(p => p.machine_no === rw.machine_no)
            if (i >= 0) loaded.splice(i, 1)
          }
        }

        // seed BL01..BL11 + S01..S04 ถ้ายังไม่มี
        const blowDefaults   = Array.from({ length: 11 }, (_, i) => `BL${String(i + 1).padStart(2, '0')}`)
        const rewindDefaults = Array.from({ length: 4 },  (_, i) => `S${String(i + 1).padStart(2, '0')}`)
        const have = new Set(loaded.map(p => p.machine_no.toUpperCase()))
        const toSeed: { name: string; section: 'blow' | 'rewind' }[] = [
          ...blowDefaults.filter(n => !have.has(n)).map(n => ({ name: n, section: 'blow' as const })),
          ...rewindDefaults.filter(n => !have.has(n)).map(n => ({ name: n, section: 'rewind' as const })),
        ]
        if (toSeed.length > 0) {
          const newProfiles = toSeed.map(({ name, section }) => ({ ...EMPTY_PROFILE, machine_no: name, section }))
          loaded.push(...newProfiles)
          for (const np of newProfiles) {
            await supabase.from('machine_profiles').upsert(profileToDb(np), { onConflict: 'machine_no' })
          }
        }

        // เรียงตามชื่อ
        loaded.sort((a, b) => a.machine_no.localeCompare(b.machine_no))
        setProfiles(loaded)
        saveProfiles(loaded)
        setLoading(false)
      })
  }, [])

  function openAddModal(section: 'blow'|'print'|'rewind' = activeTab) {
    setNewSection(section)
    setNewMachineNo(nextMachineNo(profiles.filter(p => (p.section??'blow') === section), section))
    setShowAddModal(true)
    setTimeout(() => inputRef.current?.select(), 50)
  }
  function confirmAdd() {
    const name = newMachineNo.trim()
    if (!name) return
    if (profiles.some(p => p.machine_no === name)) {
      alert(`เครื่อง "${name}" มีอยู่แล้ว`); return
    }
    setProfiles(p => [...p, { ...EMPTY_PROFILE, machine_no: name, section: newSection }])
    setShowAddModal(false)
    setNewMachineNo('')
  }
  function remove(i: number) {
    if (!confirm('ลบเครื่องนี้?')) return
    const p = profiles[i]
    if (p.machine_no) supabase.from('machine_profiles').delete().eq('machine_no', p.machine_no)
    setProfiles(prev => prev.filter((_, idx) => idx !== i))
  }
  function update(i: number, k: keyof MachineProfile, v: any) {
    setProfiles(p => p.map((m, idx) => idx === i ? { ...m, [k]: v } : m))
  }
  function updateMany(i: number, patch: Partial<MachineProfile>) {
    setProfiles(p => p.map((m, idx) => idx === i ? { ...m, ...patch } : m))
  }
  async function handleSave() {
    const valid = profiles.filter(p => p.machine_no)
    for (const p of valid) {
      await supabase.from('machine_profiles')
        .upsert(profileToDb(p), { onConflict: 'machine_no' })
      // จำ Mat Code / แกน / ชื่อสินค้า ที่พิมพ์เอง กลับเข้า master (เฉพาะตอน master ว่าง)
      backfillProductMatCore(p.itemCode, p.matCode, p.coreWeight, p.productName, (p as any).productCode)
      // จำลูกค้าที่พิมพ์เอง → เพิ่มเข้าคลังลูกค้าอัตโนมัติ (ถ้ายังไม่มีชื่อนี้)
      backfillCustomer(p.custName, p.custCode)
    }
    saveProfiles(profiles)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const ready = profiles.filter(p => p.machine_no && p.custName && p.productName && (p.itemCode || p.matCode) && p.lotNo).length

  return (<>
    {/* Modal กำหนดชื่อเครื่อง */}
    {showAddModal && (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xs shadow-2xl">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
            <p className="text-white font-bold">เพิ่มเครื่องใหม่</p>
            <button onClick={() => setShowAddModal(false)} className="text-slate-500 hover:text-white"><X size={16}/></button>
          </div>
          <div className="px-5 py-4 space-y-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">แผนก</label>
              <div className="flex gap-2 mb-3">
                {([{key:'blow',label:'🌬 ผลิต(เป่า)'},{key:'print',label:'🖨 ผลิต(พิมพ์)'},{key:'rewind',label:'🔁 กรอ(Rework)'}] as const).map(s=>(
                  <button key={s.key} onClick={() => setNewSection(s.key)}
                    className={`flex-1 py-2 rounded-xl text-sm font-bold transition-colors ${newSection===s.key?'bg-brand-600 text-white':'bg-slate-800 text-slate-400 hover:text-white'}`}>
                    {s.label}
                  </button>
                ))}
              </div>
              <label className="block text-xs text-slate-400 mb-1.5">ชื่อ / หมายเลขเครื่อง</label>
              <input
                ref={inputRef}
                value={newMachineNo}
                onChange={e => setNewMachineNo(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmAdd() }}
                placeholder="เช่น BL05, PM01"
                autoFocus
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-lg font-bold text-center outline-none focus:border-brand-500 tracking-widest"
              />
              <p className="text-slate-600 text-[10px] mt-1.5 text-center">ใส่ชื่อแล้วกด Enter หรือกดยืนยัน</p>
            </div>
          </div>
          <div className="flex gap-2 px-5 py-4 border-t border-slate-800">
            <button onClick={() => setShowAddModal(false)}
              className="flex-1 py-2.5 rounded-xl border border-slate-700 text-slate-400 hover:text-white text-sm transition-colors">
              ยกเลิก
            </button>
            <button onClick={confirmAdd} disabled={!newMachineNo.trim()}
              className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white font-bold text-sm transition-colors">
              <Plus size={14} className="inline mr-1"/> สร้างเครื่อง
            </button>
          </div>
        </div>
      </div>
    )}
    {/* Edit Modal */}
    {editIdx !== null && profiles[editIdx] && (
      <EditModal
        p={profiles[editIdx]}
        products={products}
        onChange={(k, v) => update(editIdx, k, v)}
        onAutoFill={(patch) => updateMany(editIdx, patch)}
        onRemove={() => { remove(editIdx); setEditIdx(null) }}
        onClose={() => { handleSave(); setEditIdx(null) }}
        onProductAdded={() => fetchProducts().then(setProducts)}
      />
    )}

    <div className="p-6 max-w-7xl mx-auto space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white font-bold text-lg">ตั้งค่า Profile เครื่อง</h1>
          <p className="text-slate-400 text-xs mt-0.5">ตั้งค่าครั้งเดียว — พนักงานแค่แตะเครื่อง → ชั่งได้เลย
            <span className="ml-2 text-green-400 font-semibold">{ready}/{profiles.length} เครื่องพร้อม</span>
          </p>
        </div>
        <button onClick={handleSave}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
            saved ? 'bg-green-600 text-white' : 'bg-brand-600 hover:bg-brand-500 text-white'
          }`}>
          <Save size={14}/> {saved ? 'บันทึกแล้ว ✓' : 'บันทึกทั้งหมด'}
        </button>
      </div>

      {/* Tab switcher */}
      {(() => {
        const blowProfiles   = profiles.filter(p => (p.section ?? 'blow') === 'blow')
        const printProfiles  = profiles.filter(p => p.section === 'print')
        const rewindProfiles = profiles.filter(p => p.section === 'rewind')
        const rdy = (arr: typeof profiles) => arr.filter(p => p.machine_no && p.custName && p.productName && (p.itemCode || p.matCode) && p.lotNo).length
        const blowReady   = rdy(blowProfiles)
        const printReady  = rdy(printProfiles)
        const rewindReady = rdy(rewindProfiles)
        const sec         = activeTab
        const secProfiles = sec === 'blow' ? blowProfiles : sec === 'print' ? printProfiles : rewindProfiles

        return (<>
          {/* Tab buttons — ถ้า dept ถูก lock แสดงแค่ฝั่งเดียว */}
          <div className="flex gap-2">
            {([
              { key:'blow',   emoji:'🌬', label:'ผลิต(เป่า)',   count: blowProfiles.length,   ready: blowReady,   border:'border-blue-500',   bg:'bg-blue-500/10',   badge:'bg-blue-500/20 text-blue-300' },
              { key:'print',  emoji:'🖨', label:'ผลิต(พิมพ์)', count: printProfiles.length,  ready: printReady,  border:'border-purple-500', bg:'bg-purple-500/10', badge:'bg-purple-500/20 text-purple-300' },
              { key:'rewind', emoji:'🔁', label:'กรอ(Rework)', count: rewindProfiles.length, ready: rewindReady, border:'border-green-500',  bg:'bg-green-500/10',  badge:'bg-green-500/20 text-green-300' },
            ] as const).filter(t => !dept || t.key === dept).map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={`flex-1 flex items-center justify-between px-5 py-3.5 rounded-2xl border-2 transition-all ${
                  activeTab === t.key ? `${t.border} ${t.bg}` : 'border-slate-700 bg-slate-800/30 hover:border-slate-600'
                } cursor-pointer`}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{t.emoji}</span>
                  <div className="text-left">
                    <p className="font-bold text-base text-white">{t.label}</p>
                    <p className="text-slate-400 text-xs">{t.count} เครื่อง · <span className="text-green-400">{t.ready}/{t.count} พร้อม</span></p>
                  </div>
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${t.badge}`}>
                  {dept ? 'ฝั่งนี้' : 'เปิดอยู่'}
                </span>
              </button>
            ))}
          </div>

          {/* Machine list for active tab */}
          <div className="space-y-3">
            {secProfiles.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl py-12 text-center">
                <p className="text-slate-500 text-sm">ยังไม่มีเครื่อง{sec==='blow'?'เป่า':sec==='print'?'พิมพ์':'กรอ'}</p>
                <button onClick={() => openAddModal(sec)} className="mt-3 text-brand-400 text-xs hover:text-brand-300">+ เพิ่มเครื่องแรก</button>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                {secProfiles.map(p => {
                  const i = profiles.indexOf(p)
                  return <MachineCard key={p.machine_no} p={p} onEdit={() => setEditIdx(i)} />
                })}
              </div>
            )}
            <button onClick={() => openAddModal(sec)}
              className="w-full border-2 border-dashed border-slate-700 hover:border-brand-500 text-slate-500 hover:text-brand-400 py-3 rounded-2xl text-sm flex items-center justify-center gap-2 transition-colors">
              <Plus size={15}/> เพิ่มเครื่อง{sec === 'blow' ? 'เป่า' : sec === 'print' ? 'พิมพ์' : 'กรอ'}
            </button>
          </div>
        </>)
      })()}

      {loading && (
        <div className="text-center py-10 text-slate-500 flex items-center justify-center gap-2">
          <RefreshCw size={16} className="animate-spin" /> กำลังโหลดจาก Supabase...
        </div>
      )}
    </div>
  </>)
}

