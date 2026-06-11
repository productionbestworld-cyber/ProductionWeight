import { useEffect, useState, useMemo, useRef } from 'react'
import { Plus, Trash2, Search, Upload, Download, X, Edit3, RefreshCw, Building2, Boxes, ChevronRight, FileSpreadsheet } from 'lucide-react'
import { supabase } from '../lib/supabase'
import * as XLSX from 'xlsx'
import { exportToExcel } from '../lib/exportExcel'

// ─── Types ───────────────────────────────────────────────────────────────────
export interface Customer {
  id?:           number
  cust_code:     string
  cust_name:     string
  cust_address:  string
  note?:         string
}

export interface Product {
  id?:           number
  item_code:      string
  product_code:  string
  product_name:  string
  width_cm:      string
  width_unit?:   'cm' | 'mm'
  thick_mc:      string
  mat_code?:     string
  core_weight?:  string
  cust_code:     string
  // join-ed (จาก view products_with_customer)
  cust_name?:    string
  cust_address?: string
}

const EMPTY_CUST: Customer = { cust_code:'', cust_name:'', cust_address:'', note:'' }
const EMPTY_PROD: Product  = { item_code:'', product_code:'', product_name:'', width_cm:'', width_unit:'cm', thick_mc:'', cust_code:'' }

// ─── Exports สำหรับใช้ที่อื่น (autocomplete) ─────────────────────────────────
export async function fetchProducts(): Promise<Product[]> {
  const { data } = await supabase.from('products_with_customer').select('*').order('item_code')
  return (data ?? []) as Product[]
}
export async function fetchCustomers(): Promise<Customer[]> {
  const { data } = await supabase.from('customers').select('*').order('cust_name')
  return (data ?? []) as Customer[]
}

// ─── เพิ่มสินค้าใหม่เข้า master (ถ้ายังไม่มี item_code นี้) ───────────────────
export async function addProductIfMissing(p: {
  item_code: string; product_code?: string; product_name?: string
  width_cm?: string; width_unit?: string; thick_mc?: string
  cust_code?: string; mat_code?: string; core_weight?: string
}): Promise<{ ok: boolean; added: boolean; error?: string }> {
  const ic = (p.item_code ?? '').trim()
  if (!ic) return { ok: false, added: false, error: 'ไม่มี Item Code' }
  if (!(p.product_name ?? '').trim()) return { ok: false, added: false, error: 'ต้องมีชื่อสินค้า' }
  try {
    const { data: exist } = await supabase.from('products').select('id').eq('item_code', ic).limit(1)
    if (exist && exist.length) return { ok: true, added: false }   // มีแล้ว → ไม่ทำซ้ำ
    const { error } = await supabase.from('products').insert({
      item_code:    ic,
      product_code: (p.product_code ?? '').trim(),
      product_name: (p.product_name ?? '').trim(),
      width_cm:     (p.width_cm ?? '').trim(),
      width_unit:   p.width_unit ?? 'cm',
      thick_mc:     (p.thick_mc ?? '').trim(),
      cust_code:    (p.cust_code ?? '').trim(),
      // กัน mat code = item code (ค่าเสีย)
      mat_code:     ((p.mat_code ?? '').trim() === ic ? '' : (p.mat_code ?? '').trim()),
      core_weight:  (p.core_weight ?? '').trim(),
    })
    if (error) return { ok: false, added: false, error: error.message }
    return { ok: true, added: true }
  } catch (e: any) {
    return { ok: false, added: false, error: e?.message ?? String(e) }
  }
}

// ─── เติมกลับ (back-fill) Mat Code / น้ำหนักแกน เข้า master ──────────────────
// ใช้ตอนพนักงานกรอกค่าที่ master ยังไม่มี → ครั้งหน้าจะ auto-fill ให้เลย
// เงื่อนไข: เติม "เฉพาะช่องที่ว่างอยู่" เท่านั้น — ไม่ทับค่าที่มีอยู่แล้ว
export async function backfillProductMatCore(itemCode?: string, matCode?: string, coreWeight?: string, productName?: string, productCode?: string) {
  const ic = (itemCode ?? '').trim()
  if (!ic) return
  const mat = (matCode ?? '').trim()
  const core = (coreWeight ?? '').trim()
  const name = (productName ?? '').trim()
  const pcode = (productCode ?? '').trim()
  if (!mat && !core && !name && !pcode) return
  try {
    const { data } = await supabase.from('products')
      .select('id, mat_code, core_weight, product_name, product_code').eq('item_code', ic).limit(1)
    const p = data?.[0]
    if (!p) return  // ไม่มีสินค้านี้ใน master (เช่น item code ใหม่) → ไม่ทำอะไร
    const patch: Record<string, string> = {}
    // กัน: ห้ามเอา item code มาเป็น mat code (ค่าเสีย)
    if (mat && mat !== ic && !((p as any).mat_code ?? '').trim()) patch.mat_code = mat
    if (core && !((p as any).core_weight ?? '').trim()) patch.core_weight = core
    // จำชื่อสินค้าที่พิมพ์เอง — เฉพาะตอน master ยังว่าง (ไม่ทับชื่อที่มีอยู่)
    if (name && name !== ic && !((p as any).product_name ?? '').trim()) patch.product_name = name
    // จำ Product Code ที่พิมพ์เอง — เฉพาะตอน master ยังว่าง
    if (pcode && pcode !== ic && !((p as any).product_code ?? '').trim()) patch.product_code = pcode
    if (Object.keys(patch).length === 0) return  // master มีครบแล้ว → ไม่ทับ
    await supabase.from('products').update(patch).eq('id', (p as any).id)
  } catch (e) {
    console.warn('[backfillProductMatCore]', e)
  }
}

// จำลูกค้าที่พิมพ์เอง → เพิ่มเข้าคลังลูกค้าอัตโนมัติ (ถ้ายังไม่มีชื่อนี้)
// คืนค่า cust_code ที่ใช้ (ของเดิมถ้ามี / ที่เพิ่งสร้าง) เพื่อให้ผู้เรียกเก็บลงม้วนได้
export async function backfillCustomer(custName?: string, custCode?: string): Promise<string | null> {
  const name = (custName ?? '').trim()
  if (!name) return (custCode ?? '').trim() || null
  try {
    // มีอยู่แล้ว (เทียบชื่อแบบ trim) → คืนรหัสเดิม ไม่เพิ่มซ้ำ
    const { data: existing } = await supabase.from('customers').select('cust_code, cust_name')
    const hit = (existing ?? []).find(c => (c.cust_name ?? '').trim() === name)
    if (hit) return (hit.cust_code ?? '').trim() || null
    // รหัสถัดไป = max(เลข) + 1
    const nums = (existing ?? [])
      .map(c => (c.cust_code ?? '').trim())
      .filter(s => /^[0-9]+$/.test(s)).map(Number)
    const next = (nums.length ? Math.max(...nums) : 0) + 1
    const code = (custCode ?? '').trim() || String(next)
    const { error } = await supabase.from('customers')
      .insert({ cust_code: code, cust_name: name, note: 'เพิ่มอัตโนมัติจากการตั้งเครื่อง' })
    if (error) { console.warn('[backfillCustomer]', error.message); return code }
    return code
  } catch (e) {
    console.warn('[backfillCustomer]', e)
    return (custCode ?? '').trim() || null
  }
}

// ─── Main Page ───────────────────────────────────────────────────────────────
type Tab = 'customers' | 'products'

export default function ProductsPage() {
  const [tab, setTab] = useState<Tab>('customers')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products,  setProducts]  = useState<Product[]>([])
  const [loading,   setLoading]   = useState(true)
  const [selectedCust, setSelectedCust] = useState<Customer | null>(null)

  async function reload() {
    setLoading(true)
    const [cs, ps] = await Promise.all([fetchCustomers(), fetchProducts()])
    setCustomers(cs); setProducts(ps)
    setLoading(false)
  }
  useEffect(() => { reload() }, [])

  // นับจำนวน products ต่อลูกค้า
  const countByCust = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of products) m.set(p.cust_code, (m.get(p.cust_code) ?? 0) + 1)
    return m
  }, [products])

  return (
    <div className="p-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-white font-bold text-xl">📦 คลังข้อมูล</h1>
          <p className="text-slate-500 text-xs">ลูกค้า · Item Code · สินค้า</p>
        </div>
        <button onClick={reload} className="bg-slate-800 hover:bg-slate-700 text-white px-3 py-2 rounded-lg flex items-center gap-1.5 text-sm">
          <RefreshCw size={14}/> รีเฟรช
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-slate-900 p-1 rounded-xl w-fit">
        <button onClick={() => setTab('customers')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
            tab==='customers' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white'
          }`}>
          <Building2 size={14}/> ลูกค้า ({customers.length})
        </button>
        <button onClick={() => setTab('products')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
            tab==='products' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white'
          }`}>
          <Boxes size={14}/> Item Code ทั้งหมด ({products.length})
        </button>
      </div>

      {tab === 'customers' ? (
        <CustomersTab
          customers={customers}
          products={products}
          countByCust={countByCust}
          loading={loading}
          onSelect={c => setSelectedCust(c)}
          onChanged={reload}
        />
      ) : (
        <ProductsTab products={products} customers={customers} loading={loading} onChanged={reload}/>
      )}

      {selectedCust && (
        <CustomerDetailModal
          customer={selectedCust}
          products={products.filter(p => p.cust_code === selectedCust.cust_code)}
          customers={customers}
          onClose={() => { setSelectedCust(null); reload() }}
        />
      )}
    </div>
  )
}

// ─── Customers Tab ───────────────────────────────────────────────────────────
function CustomersTab({ customers, products, countByCust, loading, onSelect, onChanged }: {
  customers: Customer[]
  products: Product[]
  countByCust: Map<string, number>
  loading: boolean
  onSelect: (c: Customer) => void
  onChanged: () => void
}) {
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Customer | null>(null)

  const filtered = useMemo(() => {
    const v = q.trim().toLowerCase()
    const list = !v ? customers : customers.filter(c =>
      c.cust_code?.toLowerCase().includes(v) ||
      c.cust_name?.toLowerCase().includes(v) ||
      c.cust_address?.toLowerCase().includes(v)
    )
    // เรียงตามรหัส (ตัวเลขก่อน เรียงจากน้อยไปมาก)
    const numOf = (s: string) => { const n = parseInt((s || '').replace(/\D/g, ''), 10); return isNaN(n) ? Number.MAX_SAFE_INTEGER : n }
    return [...list].sort((a, b) => {
      const na = numOf(a.cust_code), nb = numOf(b.cust_code)
      if (na !== nb) return na - nb
      return (a.cust_code || '').localeCompare(b.cust_code || '')
    })
  }, [customers, q])

  function exportExcel() {
    const prodByCust = new Map<string, Product[]>()
    for (const p of products) {
      const arr = prodByCust.get(p.cust_code) ?? []
      arr.push(p); prodByCust.set(p.cust_code, arr)
    }

    // ชีต 1: รายชื่อลูกค้า (เรียงตามที่แสดง)
    const custRows = filtered.map((c, i) => ({
      'ลำดับ': i + 1,
      'รหัสลูกค้า': c.cust_code,
      'ชื่อลูกค้า': c.cust_name,
      'หมายเหตุ': (c as any).note ?? '',
      'ที่อยู่': c.cust_address ?? '',
      'จำนวน Item': countByCust.get(c.cust_code) ?? 0,
    }))

    // ชีต 2: Item ทั้งหมด (ทุกรายการ กระจายตามลูกค้า เรียงตามลูกค้าที่แสดง)
    const itemRows: any[] = []
    let no = 0
    for (const c of filtered) {
      const items = prodByCust.get(c.cust_code) ?? []
      if (items.length === 0) {
        itemRows.push({
          'ลำดับ': ++no, 'รหัสลูกค้า': c.cust_code, 'ชื่อลูกค้า': c.cust_name,
          'Item Code': '(ยังไม่มี item)', 'รหัสสินค้า': '', 'ชื่อสินค้า': '',
          'หน้ากว้าง': '', 'หน่วย': '', 'หนา (mc)': '', 'Mat Code': '', 'นน.แกน (kg)': '',
        })
      } else {
        for (const p of items) {
          itemRows.push({
            'ลำดับ': ++no, 'รหัสลูกค้า': c.cust_code, 'ชื่อลูกค้า': c.cust_name,
            'Item Code': p.item_code, 'รหัสสินค้า': p.product_code, 'ชื่อสินค้า': p.product_name,
            'หน้ากว้าง': p.width_cm, 'หน่วย': p.width_unit ?? '', 'หนา (mc)': p.thick_mc,
            'Mat Code': (p as any).mat_code ?? '', 'นน.แกน (kg)': (p as any).core_weight ?? '',
          })
        }
      }
    }

    const wb = XLSX.utils.book_new()
    const ws1 = XLSX.utils.json_to_sheet(custRows)
    ws1['!cols'] = [{ wch: 6 }, { wch: 10 }, { wch: 45 }, { wch: 22 }, { wch: 35 }, { wch: 10 }]
    XLSX.utils.book_append_sheet(wb, ws1, 'ลูกค้า')
    const ws2 = XLSX.utils.json_to_sheet(itemRows)
    ws2['!cols'] = [{ wch: 6 }, { wch: 10 }, { wch: 40 }, { wch: 16 }, { wch: 14 }, { wch: 40 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 16 }, { wch: 12 }]
    XLSX.utils.book_append_sheet(wb, ws2, 'Item ทั้งหมด')
    XLSX.writeFile(wb, `ลูกค้า+Item_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <>
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="ค้นหา รหัส, ชื่อ, ที่อยู่..."
            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-white text-sm outline-none focus:border-brand-500"/>
        </div>
        <button onClick={exportExcel}
          className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg flex items-center gap-1.5 text-sm font-bold whitespace-nowrap">
          📥 Export Excel
        </button>
        <button onClick={() => setEditing(EMPTY_CUST)}
          className="bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-lg flex items-center gap-1.5 text-sm font-bold whitespace-nowrap">
          <Plus size={14}/> เพิ่มลูกค้า
        </button>
      </div>

      {loading ? (
        <p className="text-center text-slate-500 py-12">กำลังโหลด...</p>
      ) : filtered.length === 0 ? (
        <p className="text-center text-slate-500 py-12">{q ? 'ไม่พบลูกค้า' : 'ยังไม่มีลูกค้า'}</p>
      ) : (
        <div className="border border-slate-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto max-h-[calc(100vh-220px)] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-slate-300 text-xs sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2.5 text-left font-bold w-14">#</th>
                  <th className="px-3 py-2.5 text-left font-bold w-24">รหัส</th>
                  <th className="px-3 py-2.5 text-left font-bold">ชื่อลูกค้า</th>
                  <th className="px-3 py-2.5 text-left font-bold w-44 hidden md:table-cell">หมายเหตุ</th>
                  <th className="px-3 py-2.5 text-center font-bold w-24">Item</th>
                  <th className="px-3 py-2.5 text-center font-bold w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filtered.map((c, i) => {
                  const count = countByCust.get(c.cust_code) ?? 0
                  return (
                    <tr key={c.id} onClick={() => onSelect(c)}
                      className="cursor-pointer hover:bg-slate-800/70 transition-colors">
                      <td className="px-3 py-2 text-slate-500 text-xs">{i + 1}</td>
                      <td className="px-3 py-2 font-mono font-bold text-brand-400">{c.cust_code}</td>
                      <td className="px-3 py-2 text-white">{c.cust_name}</td>
                      <td className="px-3 py-2 text-slate-400 text-xs hidden md:table-cell truncate max-w-[180px]">{(c as any).note || '—'}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${count ? 'bg-brand-500/15 text-brand-300' : 'bg-slate-800 text-slate-500'}`}>
                          📦 {count}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center"><ChevronRight size={15} className="text-slate-600 inline"/></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="bg-slate-800/50 px-3 py-2 text-xs text-slate-400 border-t border-slate-700">
            รวม {filtered.length} ราย {q && `(กรองจาก ${customers.length})`} · คลิกแถวเพื่อดู/แก้ไข
          </div>
        </div>
      )}

      {editing && (
        <CustomerEditModal customer={editing} onClose={() => { setEditing(null); onChanged() }}/>
      )}
    </>
  )
}

// ─── Customer Edit Modal ─────────────────────────────────────────────────────
function CustomerEditModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const [c, setC] = useState<Customer>(customer)
  const [saving, setSaving] = useState(false)
  const isNew = !customer.id

  async function save() {
    if (!c.cust_code.trim()) { alert('กรุณากรอกรหัสลูกค้า'); return }
    if (!c.cust_name.trim()) { alert('กรุณากรอกชื่อลูกค้า'); return }
    setSaving(true)
    const { id, ...payload } = c
    const { error } = isNew
      ? await supabase.from('customers').insert(payload)
      : await supabase.from('customers').update(payload).eq('id', id!)
    setSaving(false)
    if (error) { alert('บันทึกไม่สำเร็จ: ' + error.message); return }
    onClose()
  }

  async function remove() {
    if (!confirm(`ลบลูกค้า ${c.cust_name}?\n(สินค้าที่ผูกอยู่จะถูกตั้งเป็น "ไม่ระบุลูกค้า")`)) return
    await supabase.from('customers').delete().eq('id', customer.id!)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <p className="text-white font-bold">{isNew ? '➕ เพิ่มลูกค้า' : `✏ แก้ไข ${customer.cust_name}`}</p>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18}/></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <Field label="รหัสลูกค้า *" value={c.cust_code} onChange={v => setC({ ...c, cust_code: v })} ph="C-001"/>
          <Field label="ชื่อลูกค้า *"  value={c.cust_name} onChange={v => setC({ ...c, cust_name: v })} ph="บริษัท ไทยน้ำทิพย์ จำกัด"/>
          <Field label="หมายเหตุ"      value={c.note ?? ''} onChange={v => setC({ ...c, note: v })} ph=""/>
        </div>
        <div className="px-5 py-3 border-t border-slate-800 flex gap-2">
          {!isNew && (
            <button onClick={remove} className="text-red-400 hover:text-red-300 px-3 py-2 text-sm">ลบ</button>
          )}
          <button onClick={save} disabled={saving}
            className="flex-1 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white py-2.5 rounded-xl font-bold text-sm">
            {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Customer Detail Modal — แสดง items ของลูกค้า ─────────────────────────────
function CustomerDetailModal({ customer, products, customers, onClose }: {
  customer:  Customer
  products:  Product[]
  customers: Customer[]
  onClose:   () => void
}) {
  const [editProd, setEditProd] = useState<Product | null>(null)
  const [editCust, setEditCust] = useState(false)
  const [refresh, setRefresh]   = useState(0) // trigger re-fetch from parent

  async function removeProduct(p: Product) {
    if (!confirm(`ลบ ${p.item_code}?`)) return
    await supabase.from('products').delete().eq('id', p.id!)
    setRefresh(r => r + 1)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800">
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1 min-w-0">
              <p className="text-brand-400 text-xs font-mono font-bold">{customer.cust_code}</p>
              <p className="text-white font-bold text-lg">{customer.cust_name}</p>
            </div>
            <div className="flex items-center gap-2 ml-3">
              <button onClick={() => setEditCust(true)} className="text-slate-400 hover:text-brand-400 p-2">
                <Edit3 size={16}/>
              </button>
              <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18}/></button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <p className="text-white font-bold">📦 Item Code ({products.length})</p>
            <button onClick={() => setEditProd({ ...EMPTY_PROD, cust_code: customer.cust_code })}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 font-bold">
              <Plus size={12}/> เพิ่ม item
            </button>
          </div>

          {products.length === 0 ? (
            <p className="text-center text-slate-500 py-8 text-sm">ลูกค้านี้ยังไม่มี item</p>
          ) : (
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-800 text-slate-400 text-[11px] uppercase">
                  <tr>
                    <th className="text-left px-3 py-2">Item Code</th>
                    <th className="text-left px-3 py-2">ชื่อสินค้า</th>
                    <th className="text-left px-3 py-2">ขนาด</th>
                    <th className="text-right px-3 py-2">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map(p => (
                    <tr key={p.id} className="border-t border-slate-700/50 hover:bg-slate-700/30">
                      <td className="px-3 py-2 font-mono text-brand-400 font-bold">{p.item_code}</td>
                      <td className="px-3 py-2 text-white">{p.product_name || '—'}</td>
                      <td className="px-3 py-2 text-slate-300">{p.width_cm ? `${p.width_cm}${p.width_unit ?? 'cm'}×${p.thick_mc}mc` : '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => setEditProd(p)} className="text-slate-400 hover:text-brand-400 p-1.5">
                          <Edit3 size={13}/>
                        </button>
                        <button onClick={() => removeProduct(p)} className="text-slate-400 hover:text-red-400 p-1.5">
                          <Trash2 size={13}/>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {editProd && <ProductEditModal product={editProd} customers={customers} onClose={() => { setEditProd(null); onClose() }}/>}
      {editCust && <CustomerEditModal customer={customer} onClose={() => { setEditCust(false); onClose() }}/>}
    </div>
  )
}

// ─── Products Tab (item ทั้งหมด) ──────────────────────────────────────────────
function ProductsTab({ products, customers, loading, onChanged }: {
  products: Product[]
  customers: Customer[]
  loading: boolean
  onChanged: () => void
}) {
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Product | null>(null)
  const [showImport, setShowImport] = useState(false)

  const filtered = useMemo(() => {
    const v = q.trim().toLowerCase()
    if (!v) return products
    return products.filter(p =>
      p.item_code?.toLowerCase().includes(v) ||
      p.product_code?.toLowerCase().includes(v) ||
      p.product_name?.toLowerCase().includes(v) ||
      p.cust_name?.toLowerCase().includes(v) ||
      p.cust_code?.toLowerCase().includes(v)
    )
  }, [products, q])

  async function remove(p: Product) {
    if (!confirm(`ลบ ${p.item_code}?`)) return
    await supabase.from('products').delete().eq('id', p.id!)
    onChanged()
  }

  function exportCSV() {
    const sorted = [...products].sort((a, b) =>
      (a.cust_code || '').localeCompare(b.cust_code || '') || (a.item_code || '').localeCompare(b.item_code || ''))
    exportToExcel(sorted, [
      { header:'รหัสลูกค้า', value:'cust_code' },
      { header:'ชื่อลูกค้า', value: p => p.cust_name ?? '', width:30 },
      { header:'Item Code', value:'item_code', width:16 },
      { header:'รหัสสินค้า', value:'product_code', width:14 },
      { header:'ชื่อสินค้า', value:'product_name', width:40 },
      { header:'หน้ากว้าง', value:'width_cm' },
      { header:'หน่วย', value: p => p.width_unit ?? '' },
      { header:'หนา (mc)', value:'thick_mc' },
      { header:'Mat Code', value: p => p.mat_code ?? '', width:16 },
      { header:'นน.แกน (kg)', value: p => p.core_weight ?? '', width:12 },
    ], { fileName:'รายการสินค้า_ItemCode', sheetName:'สินค้า' })
  }

  return (
    <>
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="ค้นหา Item Code, ชื่อสินค้า, ลูกค้า..."
            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-white text-sm outline-none focus:border-brand-500"/>
        </div>
        <button onClick={exportCSV} className="bg-slate-800 hover:bg-slate-700 text-white px-3 py-2 rounded-lg flex items-center gap-1.5 text-sm">
          <Download size={14}/> Export
        </button>
        <button onClick={() => setShowImport(true)} className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded-lg flex items-center gap-1.5 text-sm font-bold">
          <Upload size={14}/> นำเข้า Excel
        </button>
        <button onClick={() => setEditing(EMPTY_PROD)} className="bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-lg flex items-center gap-1.5 text-sm font-bold">
          <Plus size={14}/> เพิ่ม Item
        </button>
      </div>
      <p className="text-slate-500 text-xs mb-3">{filtered.length} / {products.length} รายการ</p>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[800px]">
          <thead className="bg-slate-800/50 text-slate-400 text-[11px] uppercase">
            <tr>
              <th className="text-left px-3 py-2.5">Item Code</th>
              <th className="text-left px-3 py-2.5">รหัสสินค้า</th>
              <th className="text-left px-3 py-2.5">ชื่อสินค้า</th>
              <th className="text-left px-3 py-2.5">ขนาด</th>
              <th className="text-left px-3 py-2.5">Mat Code</th>
              <th className="text-right px-3 py-2.5">นน.แกน</th>
              <th className="text-left px-3 py-2.5">ลูกค้า</th>
              <th className="text-right px-3 py-2.5">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-8 text-slate-500">กำลังโหลด...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-8 text-slate-500">{q ? 'ไม่พบ' : 'ยังไม่มีข้อมูล'}</td></tr>
            ) : filtered.map(p => (
              <tr key={p.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                <td className="px-3 py-2 font-mono text-brand-400 font-bold whitespace-nowrap">{p.item_code}</td>
                <td className="px-3 py-2 font-mono text-slate-400 text-xs">{p.product_code || '—'}</td>
                <td className="px-3 py-2 text-white">{p.product_name || '—'}</td>
                <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{p.width_cm ? `${p.width_cm}${p.width_unit ?? 'cm'}×${p.thick_mc}mc` : '—'}</td>
                <td className="px-3 py-2 font-mono text-amber-300 text-xs whitespace-nowrap">{p.mat_code || '—'}</td>
                <td className="px-3 py-2 text-right text-cyan-300 whitespace-nowrap">{p.core_weight ? `${p.core_weight}` : '—'}</td>
                <td className="px-3 py-2 text-slate-300">
                  <span className="text-slate-500 text-xs">{p.cust_code} </span>
                  {p.cust_name || '—'}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={() => setEditing(p)} className="text-slate-400 hover:text-brand-400 p-1.5"><Edit3 size={14}/></button>
                  <button onClick={() => remove(p)} className="text-slate-400 hover:text-red-400 p-1.5"><Trash2 size={14}/></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing    && <ProductEditModal product={editing} customers={customers} onClose={() => { setEditing(null); onChanged() }}/>}
      {showImport && <ImportModal customers={customers} onClose={() => { setShowImport(false); onChanged() }}/>}
    </>
  )
}

// ─── Product Edit Modal ──────────────────────────────────────────────────────
function ProductEditModal({ product, customers, onClose }: { product: Product; customers: Customer[]; onClose: () => void }) {
  const [p, setP] = useState<Product>(product)
  const [saving, setSaving] = useState(false)
  const isNew = !product.id

  async function save() {
    if (!p.item_code.trim()) { alert('กรุณากรอก Item Code'); return }
    setSaving(true)
    // strip join-ed fields ก่อนส่ง
    const { id, cust_name, cust_address, ...payload } = p
    const { error } = isNew
      ? await supabase.from('products').insert(payload)
      : await supabase.from('products').update(payload).eq('id', id!)
    setSaving(false)
    if (error) { alert('บันทึกไม่สำเร็จ: ' + error.message); return }
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <p className="text-white font-bold">{isNew ? '➕ เพิ่ม Item' : `✏ แก้ไข ${product.item_code}`}</p>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18}/></button>
        </div>
        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Item Code *"     value={p.item_code}     onChange={v => setP({ ...p, item_code: v })} ph="60004224"/>
            {/* Product Code — removed */}
            <div className="col-span-2">
              <Field label="ชื่อสินค้า" value={p.product_name} onChange={v => setP({ ...p, product_name: v })} ph="PET 1.45L RED SHRINK"/>
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">กว้าง</label>
              <div className="flex gap-1">
                <input value={p.width_cm} onChange={e => setP({ ...p, width_cm: e.target.value })}
                  placeholder="57"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500" />
                {(['cm','mm'] as const).map(u => (
                  <button key={u} type="button"
                    onClick={() => {
                      const cur = p.width_unit ?? 'cm'
                      if (cur === u) { setP({ ...p, width_unit: u }); return }
                      const n = parseFloat(p.width_cm)
                      if (!Number.isFinite(n)) { setP({ ...p, width_unit: u }); return }
                      const v = cur === 'cm' && u === 'mm' ? n * 10 : cur === 'mm' && u === 'cm' ? n / 10 : n
                      setP({ ...p, width_cm: v.toString(), width_unit: u })
                    }}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-bold ${
                      (p.width_unit ?? 'cm') === u ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400'
                    }`}>{u}</button>
                ))}
              </div>
            </div>
            <Field label="หนา (mc)"       value={p.thick_mc}     onChange={v => setP({ ...p, thick_mc: v })} ph="80"/>
            <Field label="รหัสสินค้า"      value={p.product_code} onChange={v => setP({ ...p, product_code: v })} ph="(ถ้ามี)"/>
            <Field label="Mat Code"        value={p.mat_code ?? ''}    onChange={v => setP({ ...p, mat_code: v })} ph="60001585"/>
            <Field label="น้ำหนักแกน (kg)" value={p.core_weight ?? ''} onChange={v => setP({ ...p, core_weight: v })} ph="1.15"/>
          </div>
          <div>
            <label className="block text-[10px] text-slate-500 mb-1">ลูกค้า</label>
            <select value={p.cust_code} onChange={e => setP({ ...p, cust_code: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500">
              <option value="">— ไม่ระบุ —</option>
              {customers.map(c => (
                <option key={c.id} value={c.cust_code}>{c.cust_code} — {c.cust_name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-800">
          <button onClick={save} disabled={saving}
            className="w-full bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white py-2.5 rounded-xl font-bold text-sm">
            {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Import Modal (Excel / CSV paste — โครงสร้างลำดับชั้น) ───────────────────
type ImportRow = Product & { _cust_name?: string; _cust_address?: string }

function ImportModal({ customers, onClose }: { customers: Customer[]; onClose: () => void }) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<ImportRow[]>([])
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')

  function parse(raw: string): ImportRow[] {
    const lines = raw.split(/\r?\n/).filter(l => l.trim())
    if (lines.length === 0) return []
    const delim = lines[0].includes('\t') ? '\t' : ','
    const splitLine = (s: string) => {
      if (delim === '\t') return s.split('\t').map(x => x.trim())
      const out: string[] = []; let cur = '', inQ = false
      for (let i = 0; i < s.length; i++) {
        const c = s[i]
        if (c === '"' && s[i+1] === '"') { cur += '"'; i++ }
        else if (c === '"') inQ = !inQ
        else if (c === ',' && !inQ) { out.push(cur.trim()); cur = '' }
        else cur += c
      }
      out.push(cur.trim())
      return out
    }
    const rows = lines.map(splitLine)
    const header = rows[0].map(h => h.toLowerCase())
    const hasHeader = header.some(h => /cust|item|product|width|thick|ลูกค้า|สินค้า|กว้าง|หนา/.test(h))
    const dataRows = hasHeader ? rows.slice(1) : rows
    const cols = hasHeader ? header : ['cust_code','cust_name','cust_address','item_code','product_code','product_name','width_cm','thick_mc']

    type Key = 'cust_code'|'cust_name'|'cust_address'|'item_code'|'product_code'|'product_name'|'width_cm'|'thick_mc'
    const map: Record<string, Key> = {
      'cust_code':'cust_code','cust code':'cust_code','รหัสลูกค้า':'cust_code',
      'cust_name':'cust_name','cust name':'cust_name','ชื่อลูกค้า':'cust_name','customer':'cust_name','ลูกค้า':'cust_name',
      'cust_address':'cust_address','address':'cust_address','ที่อยู่':'cust_address',
      'item_code':'item_code','item code':'item_code','itemcode':'item_code',
      'product_code':'product_code','product code':'product_code','productcode':'product_code',
      'product_name':'product_name','product name':'product_name','productname':'product_name','ชื่อสินค้า':'product_name','สินค้า':'product_name',
      'width_cm':'width_cm','width':'width_cm','กว้าง':'width_cm',
      'thick_mc':'thick_mc','thick':'thick_mc','หนา':'thick_mc',
    }
    const colMap = cols.map(c => map[c.toLowerCase()] ?? null)

    // inheritance: ถ้า cust_code ว่าง → ใช้ของแถวก่อนหน้า
    let curCust = '', curName = '', curAddr = ''
    const out: ImportRow[] = []
    for (const row of dataRows) {
      const raw: any = {}
      row.forEach((v, i) => { if (colMap[i]) raw[colMap[i]!] = v })

      // ถ้าแถวนี้มี cust_code → อัปเดต current
      if (raw.cust_code) {
        curCust = raw.cust_code
        curName = raw.cust_name ?? curName
        curAddr = raw.cust_address ?? curAddr
      } else if (raw.cust_name) {
        curName = raw.cust_name
        curAddr = raw.cust_address ?? curAddr
      }

      // ต้องมี item_code ถึงจะ import เป็น row
      if (!raw.item_code) continue
      out.push({
        ...EMPTY_PROD,
        item_code:     raw.item_code,
        product_code:  raw.product_code  ?? '',
        product_name:  raw.product_name  ?? '',
        width_cm:      raw.width_cm      ?? '',
        thick_mc:      raw.thick_mc      ?? '',
        cust_code:     curCust,
        _cust_name:    curName,
        _cust_address: curAddr,
      })
    }
    return out
  }

  useEffect(() => { setPreview(parse(text)) }, [text])

  // นับลูกค้าใหม่ที่จะถูกสร้าง
  const newCustomersMap = (() => {
    const existing = new Set(customers.map(c => c.cust_code))
    const m = new Map<string, { cust_code: string, cust_name: string, cust_address: string }>()
    for (const p of preview) {
      if (!p.cust_code) continue
      if (existing.has(p.cust_code)) continue
      if (!m.has(p.cust_code)) {
        m.set(p.cust_code, {
          cust_code: p.cust_code,
          cust_name: p._cust_name || `(import) ${p.cust_code}`,
          cust_address: p._cust_address || '',
        })
      }
    }
    return m
  })()
  const newCustomers = [...newCustomersMap.values()]

  function downloadTemplate() {
    const data = [
      ['รหัสลูกค้า','ชื่อลูกค้า','ที่อยู่','Item Code','ชื่อสินค้า','กว้าง','หนา'],
      ['C-001','บริษัท ไทยน้ำทิพย์ จำกัด','123 ถนนรามคำแหง แขวงหัวหมาก เขตบางกะปิ กทม.','60001001','P001','PET 1.5L SHRINK FILM','57','80'],
      ['','','','60001002','P002','PET 600ml SHRINK FILM','45','60'],
      ['','','','60001003','P003','PET 330ml SHRINK FILM','38','55'],
      ['C-002','บริษัท เสริมสุข จำกัด (มหาชน)','456 ถนนสุขุมวิท แขวงคลองเตย กทม.','60002001','P101','PE BAG 50x70cm','50','75'],
      ['','','','60002002','P102','PE BAG 30x40cm','30','50'],
      ['C-003','บริษัท โอสถสภา จำกัด','789 ถนนพระราม 4 แขวงคลองเตย กทม.','60003001','P201','SHRINK SLEEVE 65mm','65','85'],
      ['','','','60003002','P202','SHRINK SLEEVE 70mm','70','85'],
      ['','','','60003003','P203','SHRINK SLEEVE 75mm','75','90'],
      ['','','','60003004','P204','SHRINK SLEEVE 80mm','80','95'],
    ]
    const ws = XLSX.utils.aoa_to_sheet(data)
    // ตั้งความกว้าง column
    ws['!cols'] = [{wch:12},{wch:30},{wch:40},{wch:12},{wch:12},{wch:25},{wch:8},{wch:8}]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'สินค้า')
    XLSX.writeFile(wb, 'ตัวอย่าง-นำเข้า-สินค้า.xlsx')
  }

  async function handleFileUpload(file: File) {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    // แปลงเป็น array of arrays
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    // แปลงกลับเป็น tab-separated text เพื่อให้ parser เดิมใช้ได้
    const txt = rows.map(r => r.map(c => String(c ?? '')).join('\t')).join('\n')
    setText(txt)
  }

  async function doImport() {
    if (preview.length === 0) return

    // ตรวจสอบแถวที่ไม่มี cust_code (FK constraint จะ fail)
    const orphans = preview.filter(p => !p.cust_code?.trim())
    const valid   = preview.filter(p =>  p.cust_code?.trim())
    if (orphans.length > 0) {
      const msg = `⚠ พบ ${orphans.length} แถวที่ไม่มี "รหัสลูกค้า" (Item Code: ${orphans.slice(0,5).map(o => o.item_code).join(', ')}${orphans.length > 5 ? '...' : ''})\n\n` +
                  `สาเหตุ: ใน Excel ของคุณ แถวสินค้าด้านบนยังไม่ได้กรอกรหัสลูกค้า\n` +
                  `วิธีแก้: ใส่รหัสลูกค้าในแถวแรกของแต่ละกลุ่ม\n\n` +
                  `ต้องการข้ามแถวเหล่านี้ แล้วนำเข้า ${valid.length} แถวที่เหลือหรือไม่?`
      if (!confirm(msg)) return
    }
    if (valid.length === 0) { alert('ไม่มีข้อมูลที่นำเข้าได้'); return }

    setImporting(true)

    // 1) สร้าง/อัปเดต customers
    if (newCustomers.length > 0) {
      const { error } = await supabase.from('customers').upsert(newCustomers, { onConflict: 'cust_code' })
      if (error) { alert('สร้างลูกค้าล้มเหลว: ' + error.message); setImporting(false); return }
    }
    // 2) อัปเดตข้อมูลลูกค้าที่มีอยู่แล้ว (ถ้าใน Excel มีชื่อ/ที่อยู่ใหม่)
    const updates = [...new Map(valid
      .filter(p => p.cust_code && p._cust_name)
      .map(p => [p.cust_code, { cust_code: p.cust_code, cust_name: p._cust_name!, cust_address: p._cust_address || '' }])
    ).values()]
    if (updates.length > 0) {
      await supabase.from('customers').upsert(updates, { onConflict: 'cust_code' })
    }

    // 3) Insert products (batch 100) — เฉพาะแถวที่มี cust_code
    for (let i = 0; i < valid.length; i += 100) {
      const batch = valid.slice(i, i + 100).map(({ _cust_name, _cust_address, cust_name, cust_address, id, ...p }) => p)
      const { error } = await supabase.from('products').upsert(batch, { onConflict: 'item_code' })
      if (error) { alert(`Error at row ${i}: ${error.message}`); setImporting(false); return }
    }
    setImporting(false)
    alert(`✓ นำเข้า ${valid.length} item · ลูกค้าใหม่ ${newCustomers.length} ราย${orphans.length > 0 ? ` · ข้าม ${orphans.length} แถว` : ''}`)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl shadow-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <p className="text-white font-bold">📥 นำเข้าจาก Excel</p>
          <div className="flex items-center gap-2">
            <button onClick={downloadTemplate}
              className="bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5">
              <Download size={12}/> ดาวน์โหลดตัวอย่าง
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18}/></button>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          {/* ── อัปโหลดไฟล์ Excel ตรงๆ ────────────────────────── */}
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) { setFileName(f.name); handleFileUpload(f) }
            }}/>
          <button onClick={() => fileRef.current?.click()}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 border-2 border-dashed border-emerald-400/50">
            <FileSpreadsheet size={20}/>
            {fileName ? `📄 ${fileName} — คลิกเพื่อเปลี่ยนไฟล์` : '📁 เลือกไฟล์ Excel (.xlsx, .csv)'}
          </button>

          <div className="text-center text-xs text-slate-500">— หรือ —</div>

          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs">
            <p className="font-bold text-amber-300 mb-1">💡 วิธี Copy-Paste:</p>
            <p className="text-slate-300">กดปุ่ม <span className="text-amber-300 font-bold">"ดาวน์โหลดตัวอย่าง"</span> มุมขวาบน → เปิดด้วย Excel → แก้ไขเป็นข้อมูลของคุณ → กด Ctrl+A เลือกทั้งหมด → Ctrl+C → กลับมาวาง (Ctrl+V) ในกล่องด้านล่าง</p>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-xs text-slate-300">
            <p className="font-bold text-brand-400 mb-2">📋 รูปแบบ Excel — ลูกค้าตัวใหญ่ ด้านล่างเป็น Item</p>
            <div className="bg-slate-900 rounded p-2 text-[10px] overflow-x-auto">
              <table className="border-collapse">
                <thead className="text-brand-300">
                  <tr>
                    <th className="border border-slate-700 px-2 py-1">รหัสลูกค้า</th>
                    <th className="border border-slate-700 px-2 py-1">ชื่อลูกค้า</th>
                    <th className="border border-slate-700 px-2 py-1">ที่อยู่</th>
                    <th className="border border-slate-700 px-2 py-1">Item Code</th>
                    <th className="border border-slate-700 px-2 py-1">ชื่อสินค้า</th>
                    <th className="border border-slate-700 px-2 py-1">กว้าง</th>
                    <th className="border border-slate-700 px-2 py-1">หนา</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  <tr>
                    <td className="border border-slate-700 px-2 py-1 bg-emerald-500/10 text-emerald-300 font-bold">C-001</td>
                    <td className="border border-slate-700 px-2 py-1 bg-emerald-500/10 text-emerald-300">บริษัท ก</td>
                    <td className="border border-slate-700 px-2 py-1 bg-emerald-500/10 text-emerald-300">ที่อยู่ ก</td>
                    <td className="border border-slate-700 px-2 py-1">001</td>
                    <td className="border border-slate-700 px-2 py-1">สินค้า 1</td>
                    <td className="border border-slate-700 px-2 py-1">50</td>
                    <td className="border border-slate-700 px-2 py-1">80</td>
                  </tr>
                  <tr>
                    <td className="border border-slate-700 px-2 py-1 text-slate-600 italic">(เว้นว่าง)</td>
                    <td className="border border-slate-700 px-2 py-1 text-slate-600">—</td>
                    <td className="border border-slate-700 px-2 py-1 text-slate-600">—</td>
                    <td className="border border-slate-700 px-2 py-1">002</td>
                    <td className="border border-slate-700 px-2 py-1">สินค้า 2</td>
                    <td className="border border-slate-700 px-2 py-1">60</td>
                    <td className="border border-slate-700 px-2 py-1">90</td>
                  </tr>
                  <tr>
                    <td className="border border-slate-700 px-2 py-1 text-slate-600 italic">(เว้นว่าง)</td>
                    <td className="border border-slate-700 px-2 py-1 text-slate-600">—</td>
                    <td className="border border-slate-700 px-2 py-1 text-slate-600">—</td>
                    <td className="border border-slate-700 px-2 py-1">003</td>
                    <td className="border border-slate-700 px-2 py-1">สินค้า 3</td>
                    <td className="border border-slate-700 px-2 py-1">70</td>
                    <td className="border border-slate-700 px-2 py-1">100</td>
                  </tr>
                  <tr>
                    <td className="border border-slate-700 px-2 py-1 bg-emerald-500/10 text-emerald-300 font-bold">C-002</td>
                    <td className="border border-slate-700 px-2 py-1 bg-emerald-500/10 text-emerald-300">บริษัท ข</td>
                    <td className="border border-slate-700 px-2 py-1 bg-emerald-500/10 text-emerald-300">ที่อยู่ ข</td>
                    <td className="border border-slate-700 px-2 py-1">004</td>
                    <td className="border border-slate-700 px-2 py-1">สินค้า 4</td>
                    <td className="border border-slate-700 px-2 py-1">55</td>
                    <td className="border border-slate-700 px-2 py-1">75</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-emerald-400">💡 ลูกค้ากรอกครั้งเดียวบนสุด — แถวล่างเว้นว่าง ระบบจะ inherit ให้</p>
            <p className="mt-1 text-slate-400">วิธี: copy cells ใน Excel แล้ว Ctrl+V ในกล่องด้านล่าง</p>
          </div>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={8}
            placeholder="วางข้อมูลจาก Excel ที่นี่..."
            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white text-xs font-mono outline-none focus:border-brand-500"/>
          {preview.length > 0 && (
            <div className="bg-slate-800/30 border border-slate-700 rounded-lg p-3">
              <p className="text-xs text-emerald-400 font-bold mb-2">
                ✓ พบ {preview.length} item · ลูกค้าใหม่ {newCustomers.length} ราย
              </p>
              <div className="max-h-48 overflow-y-auto text-xs">
                <table className="w-full">
                  <thead className="text-slate-400">
                    <tr>
                      <th className="text-left px-2 py-1">ลูกค้า</th>
                      <th className="text-left px-2 py-1">Item</th>
                      <th className="text-left px-2 py-1">ชื่อสินค้า</th>
                      <th className="text-left px-2 py-1">ขนาด</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 50).map((p, i) => (
                      <tr key={i} className="border-t border-slate-700/50">
                        <td className="px-2 py-1 text-slate-300 truncate max-w-[120px]">{p._cust_name || p.cust_code || '—'}</td>
                        <td className="px-2 py-1 font-mono text-brand-400">{p.item_code}</td>
                        <td className="px-2 py-1 text-white truncate max-w-[200px]">{p.product_name}</td>
                        <td className="px-2 py-1 text-slate-400">{p.width_cm && `${p.width_cm}${p.width_unit ?? 'cm'}×${p.thick_mc}mc`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.length > 50 && <p className="text-slate-500 text-center mt-2">... และอีก {preview.length - 50} item</p>}
              </div>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-800">
          <button onClick={doImport} disabled={importing || preview.length === 0}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white py-2.5 rounded-xl font-bold text-sm">
            {importing ? 'กำลังนำเข้า...' : `💾 นำเข้า ${preview.length} item + ลูกค้า ${newCustomers.length} ราย`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── helper ──────────────────────────────────────────────────────────────────
function Field({ label, value, onChange, ph, textarea }: {
  label: string; value: string; onChange: (v: string) => void; ph?: string; textarea?: boolean
}) {
  return (
    <div>
      <label className="block text-[10px] text-slate-500 mb-1">{label}</label>
      {textarea ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={ph} rows={2}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500"/>
      ) : (
        <input value={value} onChange={e => onChange(e.target.value)} placeholder={ph}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500"/>
      )}
    </div>
  )
}
