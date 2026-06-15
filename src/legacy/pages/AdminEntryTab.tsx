import { useState, useEffect } from 'react'
import { Plus, Trash2, Save, X, Edit2, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fmt, MACHINE_COLORS, BLS } from '../lib/utils'
import type { ProductionRecord } from '../lib/types'

const SHIFTS = ['A', 'B', 'C', 'unknown']

const EMPTY: Partial<ProductionRecord> = {
  production_date: '', machine: '', shift: 'A',
  customer: '', product_code: '', size: '', order_no: '', sales_order: '',
  planned_kg: undefined, planned_rolls: undefined,
  fg_kg: undefined, fg_rolls: undefined,
  scrap_kg: undefined, rework_kg: undefined,
  symptom: '', cause: '', action: '',
}

interface FormProps {
  initial: Partial<ProductionRecord>
  onSave: (rec: Partial<ProductionRecord>) => Promise<void>
  onCancel: () => void
  saving: boolean
  title: string
}

function RecordForm({ initial, onSave, onCancel, saving, title }: FormProps) {
  const [f, setF] = useState<Partial<ProductionRecord>>({ ...initial })
  const [showExtra, setShowExtra] = useState(false)

  function set(k: keyof ProductionRecord, v: any) {
    setF(prev => ({ ...prev, [k]: v }))
  }

  function num(k: keyof ProductionRecord, v: string) {
    set(k, v === '' ? undefined : parseFloat(v))
  }

  function Field({ label, k, type = 'text', ph, half }: {
    label: string; k: keyof ProductionRecord; type?: string; ph?: string; half?: boolean
  }) {
    const val = (f[k] ?? '') as string
    return (
      <div className={half ? '' : 'col-span-2'}>
        <label className="block text-xs text-gray-500 font-medium mb-1">{label}</label>
        <input type={type} value={val} placeholder={ph}
          onChange={e => type === 'number' ? num(k, e.target.value) : set(k, e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100" />
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!f.production_date || !f.machine) return
    await onSave(f)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="font-bold text-gray-800 text-base">{title}</p>

      {/* Required */}
      <div className="grid grid-cols-4 gap-3">
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 font-medium mb-1">วันที่ผลิต *</label>
          <input type="date" value={f.production_date ?? ''}
            onChange={e => set('production_date', e.target.value)} required
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 font-medium mb-1">เครื่องจักร *</label>
          <select value={f.machine ?? ''} onChange={e => set('machine', e.target.value)} required
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400 bg-white">
            <option value="">เลือก</option>
            {BLS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 font-medium mb-1">กะ</label>
          <select value={f.shift ?? 'A'} onChange={e => set('shift', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400 bg-white">
            {SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Production qty */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
        <p className="text-xs font-semibold text-blue-700 mb-3">📦 ปริมาณการผลิต</p>
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'FG (kg)', k: 'fg_kg' as keyof ProductionRecord },
            { label: 'FG (ม้วน)', k: 'fg_rolls' as keyof ProductionRecord },
            { label: 'เสีย (kg)', k: 'scrap_kg' as keyof ProductionRecord },
            { label: 'ซ่อม (kg)', k: 'rework_kg' as keyof ProductionRecord },
          ].map(({ label, k }) => (
            <div key={k}>
              <label className="block text-xs text-gray-500 font-medium mb-1">{label}</label>
              <input type="number" step="0.01" min="0" value={(f[k] as number) ?? ''}
                onChange={e => num(k, e.target.value)} placeholder="0"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400 bg-white" />
            </div>
          ))}
        </div>
      </div>

      {/* Customer / Product */}
      <div className="grid grid-cols-4 gap-3">
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 font-medium mb-1">ลูกค้า</label>
          <input value={f.customer ?? ''} onChange={e => set('customer', e.target.value)} placeholder="ชื่อลูกค้า"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 font-medium mb-1">รหัสสินค้า</label>
          <input value={f.product_code ?? ''} onChange={e => set('product_code', e.target.value)} placeholder="60004224"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 font-medium mb-1">ขนาด</label>
          <input value={f.size ?? ''} onChange={e => set('size', e.target.value)} placeholder="57x80"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400" />
        </div>
      </div>

      {/* Toggle extra fields */}
      <button type="button" onClick={() => setShowExtra(v => !v)}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">
        {showExtra ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {showExtra ? 'ซ่อนข้อมูลเพิ่มเติม' : 'แสดงข้อมูลเพิ่มเติม (ใบสั่ง, แผน, สาเหตุ)'}
      </button>

      {showExtra && (
        <div className="space-y-3 border-t border-gray-100 pt-3">
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 font-medium mb-1">Order No</label>
              <input value={f.order_no ?? ''} onChange={e => set('order_no', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 font-medium mb-1">Sales Order</label>
              <input value={f.sales_order ?? ''} onChange={e => set('sales_order', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 font-medium mb-1">แผน (kg)</label>
              <input type="number" step="0.01" min="0" value={(f.planned_kg as number) ?? ''}
                onChange={e => num('planned_kg', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 font-medium mb-1">แผน (ม้วน)</label>
              <input type="number" min="0" value={(f.planned_rolls as number) ?? ''}
                onChange={e => num('planned_rolls', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 font-medium mb-1">อาการ (Symptom)</label>
              <input value={f.symptom ?? ''} onChange={e => set('symptom', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 font-medium mb-1">สาเหตุ (Cause)</label>
              <input value={f.cause ?? ''} onChange={e => set('cause', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 font-medium mb-1">การแก้ไข (Action)</label>
              <input value={f.action ?? ''} onChange={e => set('action', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400" />
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel}
          className="px-5 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-semibold transition-colors">
          ยกเลิก
        </button>
        <button type="submit" disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-bold transition-colors">
          <Save size={14} />
          {saving ? 'กำลังบันทึก...' : 'บันทึก'}
        </button>
      </div>
    </form>
  )
}

export default function AdminEntryTab() {
  const [records, setRecords] = useState<ProductionRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [view, setView]       = useState<'list' | 'new' | 'edit'>('list')
  const [editRec, setEditRec] = useState<ProductionRecord | null>(null)
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg]         = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [filter, setFilter]   = useState<'today' | 'week' | 'all'>('today')

  useEffect(() => { fetchRecords() }, [filter])

  async function fetchRecords() {
    setLoading(true)
    let q = supabase.from('production_records').select('*').order('production_date', { ascending: false }).order('machine')
    if (filter === 'today') {
      const today = new Date().toISOString().slice(0, 10)
      q = q.eq('production_date', today)
    } else if (filter === 'week') {
      const d = new Date(); d.setDate(d.getDate() - 7)
      q = q.gte('production_date', d.toISOString().slice(0, 10))
    }
    const { data } = await q.limit(300)
    setRecords(data ?? [])
    setLoading(false)
  }

  function flash(type: 'ok' | 'err', text: string) {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 3000)
  }

  async function handleSave(rec: Partial<ProductionRecord>) {
    setSaving(true)
    try {
      if (editRec?.id) {
        await supabase.from('production_records').update(rec).eq('id', editRec.id)
        flash('ok', `อัพเดทข้อมูล ${rec.production_date} / ${rec.machine} สำเร็จ`)
      } else {
        if (!rec.row_key) {
          rec.row_key = `${rec.production_date}_${rec.machine}_${rec.order_no ?? ''}_${rec.shift ?? ''}_${Date.now()}`
        }
        await supabase.from('production_records').insert(rec)
        flash('ok', `เพิ่มข้อมูล ${rec.production_date} / ${rec.machine} สำเร็จ`)
      }
      setView('list')
      fetchRecords()
    } catch {
      flash('err', 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(r: ProductionRecord) {
    if (!confirm(`ลบข้อมูล ${r.production_date} / ${r.machine} ?`)) return
    await supabase.from('production_records').delete().eq('id', r.id!)
    flash('ok', 'ลบแล้ว')
    fetchRecords()
  }

  function openEdit(r: ProductionRecord) {
    setEditRec(r)
    setView('edit')
  }

  const totalFg = records.reduce((s, r) => s + (r.fg_kg ?? 0), 0)

  if (view === 'new' || view === 'edit') {
    return (
      <div className="bg-white rounded-xl shadow-sm p-6 max-w-3xl">
        <RecordForm
          title={view === 'new' ? '➕ เพิ่มข้อมูลการผลิต' : `✏️ แก้ไข: ${editRec?.production_date} / ${editRec?.machine}`}
          initial={view === 'edit' && editRec ? editRec : { ...EMPTY }}
          onSave={handleSave}
          onCancel={() => { setView('list'); setEditRec(null) }}
          saving={saving}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-gray-800 text-base">กรอกข้อมูลการผลิต</h2>
          <p className="text-xs text-gray-400 mt-0.5">เพิ่ม / แก้ไข / ลบข้อมูล production_records โดยตรง</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchRecords}
            className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => { setEditRec(null); setView('new') }}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors">
            <Plus size={15} /> เพิ่มข้อมูล
          </button>
        </div>
      </div>

      {/* Flash */}
      {msg && (
        <div className={`px-4 py-2.5 rounded-xl text-sm font-medium flex items-center justify-between ${
          msg.type === 'ok'
            ? 'bg-green-50 border border-green-200 text-green-700'
            : 'bg-red-50 border border-red-200 text-red-600'
        }`}>
          {msg.text}
          <button onClick={() => setMsg(null)}><X size={12} /></button>
        </div>
      )}

      {/* Filter + summary */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {(['today', 'week', 'all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                filter === f ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400 hover:text-gray-600'
              }`}>
              {f === 'today' ? 'วันนี้' : f === 'week' ? '7 วัน' : 'ทั้งหมด'}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400">
          {records.length} รายการ · FG รวม <span className="text-blue-600 font-bold">{fmt(totalFg, 1)} kg</span>
        </p>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              {['วันที่', 'เครื่อง', 'กะ', 'ลูกค้า', 'ขนาด', 'FG (kg)', 'FG (ม้วน)', 'เสีย (kg)', 'ซ่อม (kg)', 'อาการ', ''].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={11} className="py-10 text-center text-gray-400 text-sm">กำลังโหลด...</td></tr>
            ) : records.length === 0 ? (
              <tr><td colSpan={11} className="py-10 text-center text-gray-300">ไม่มีข้อมูล</td></tr>
            ) : records.map((r, i) => (
              <tr key={r.id ?? i} className="hover:bg-gray-50 group">
                <td className="px-3 py-2.5 font-medium text-gray-700 whitespace-nowrap">{r.production_date}</td>
                <td className="px-3 py-2.5 font-bold" style={{ color: MACHINE_COLORS[r.machine] ?? '#374151' }}>{r.machine}</td>
                <td className="px-3 py-2.5 text-gray-500">{r.shift ?? '-'}</td>
                <td className="px-3 py-2.5 text-gray-700">{r.customer ?? '-'}</td>
                <td className="px-3 py-2.5 text-gray-400 text-xs">{r.size ?? '-'}</td>
                <td className="px-3 py-2.5 text-right font-semibold text-blue-600">{r.fg_kg ? fmt(r.fg_kg) : '-'}</td>
                <td className="px-3 py-2.5 text-right text-gray-500">{r.fg_rolls ?? '-'}</td>
                <td className="px-3 py-2.5 text-right text-red-500">{r.scrap_kg ? fmt(r.scrap_kg) : '-'}</td>
                <td className="px-3 py-2.5 text-right text-orange-500">{r.rework_kg ? fmt(r.rework_kg) : '-'}</td>
                <td className="px-3 py-2.5 text-gray-400 text-xs max-w-28 truncate">{r.symptom ?? '-'}</td>
                <td className="px-3 py-2.5">
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(r)}
                      className="p-1.5 rounded-lg bg-gray-100 hover:bg-blue-100 hover:text-blue-600 text-gray-400 transition-colors">
                      <Edit2 size={11} />
                    </button>
                    <button onClick={() => handleDelete(r)}
                      className="p-1.5 rounded-lg bg-gray-100 hover:bg-red-100 hover:text-red-500 text-gray-400 transition-colors">
                      <Trash2 size={11} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          {records.length > 0 && (
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50">
                <td colSpan={5} className="px-3 py-2.5 text-xs font-semibold text-gray-500">รวม {records.length} แถว</td>
                <td className="px-3 py-2.5 text-right font-bold text-blue-600 text-sm">{fmt(totalFg, 1)}</td>
                <td colSpan={5}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
