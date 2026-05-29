import { useEffect, useState } from 'react'
import { Check, X, Search, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fmtSize } from './MachineSettings'

type Roll = {
  id: string
  machine_no: string
  lot_no: string
  roll_no: number
  weight: number
  gross_weight: number
  remark: string | null
  inspector: string | null
  product_name: string | null
  customer: string | null
  width_cm: string | null
  width_unit: 'cm'|'mm' | null
  thick_mc: string | null
  item_code: string | null
  section: string | null
  created_at: string
  review_status: 'pending_review' | 'approved_rework' | 'other' | null
  review_action: 'rework' | 'keep' | 'scrap' | null
  review_action_reason: string | null
  review_decision_by: string | null
  review_decision_at: string | null
}

function fmt(n: number, d = 2) { return Number(n ?? 0).toFixed(d) }

export default function ReviewQueue() {
  const [rolls, setRolls] = useState<Roll[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'pending'|'decided'>('pending')
  const [search, setSearch] = useState('')
  const [decideRoll, setDecideRoll] = useState<Roll | null>(null)

  async function load() {
    setLoading(true)
    // ดึงม้วนที่ผ่าน review (pending + decided ทั้งหมด เพื่อสลับ tab)
    const { data } = await supabase.from('production_rolls')
      .select('*')
      .in('review_status', ['pending_review','approved_rework','other'])
      .order('created_at', { ascending: false })
    setRolls((data ?? []) as Roll[])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const pending  = rolls.filter(r => r.review_status === 'pending_review')
  const decided  = rolls.filter(r => r.review_status === 'approved_rework' || r.review_status === 'other')
  const shown    = (tab === 'pending' ? pending : decided).filter(r => {
    if (!search.trim()) return true
    const s = search.toLowerCase()
    return [r.machine_no, r.lot_no, r.product_name, r.customer, r.remark, String(r.roll_no)]
      .filter(Boolean).some(x => String(x).toLowerCase().includes(s))
  })

  const totalKgPending = pending.reduce((s,r) => s + (r.weight ?? 0), 0)

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-black text-slate-800">🔍 พิจารณาม้วนกรอ</h1>
            <p className="text-slate-500 text-sm mt-0.5">ม้วนที่ผลิตประเมินว่ากรอไม่ได้ — รอ ผจก ตัดสินใจ</p>
          </div>
          <button onClick={load}
            className="bg-white hover:bg-slate-50 border border-slate-300 px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5">
            <RefreshCw size={14}/> รีเฟรช
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-white border-2 border-amber-300 rounded-2xl p-4 shadow-sm">
            <p className="text-amber-600 text-xs font-bold uppercase tracking-wider">⏳ รอพิจารณา</p>
            <p className="text-3xl font-black text-amber-700 mt-1">{pending.length}</p>
            <p className="text-amber-600 text-xs mt-1">{fmt(totalKgPending,2)} Kgs.</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <p className="text-emerald-600 text-xs font-bold uppercase tracking-wider">✓ อนุมัติให้กรอ</p>
            <p className="text-3xl font-black text-emerald-700 mt-1">{decided.filter(r => r.review_action === 'rework').length}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <p className="text-slate-600 text-xs font-bold uppercase tracking-wider">🔄 ทำอย่างอื่น</p>
            <p className="text-3xl font-black text-slate-700 mt-1">{decided.filter(r => r.review_action !== 'rework').length}</p>
          </div>
        </div>

        {/* Tabs + search */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1">
            <button onClick={() => setTab('pending')}
              className={`px-4 py-1.5 rounded-lg text-sm font-bold ${tab==='pending'?'bg-amber-500 text-white':'text-slate-600 hover:bg-slate-100'}`}>
              ⏳ รอพิจารณา ({pending.length})
            </button>
            <button onClick={() => setTab('decided')}
              className={`px-4 py-1.5 rounded-lg text-sm font-bold ${tab==='decided'?'bg-slate-700 text-white':'text-slate-600 hover:bg-slate-100'}`}>
              ✓ ตัดสินแล้ว ({decided.length})
            </button>
          </div>
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="ค้นหา (เครื่อง / lot / ลูกค้า / เหตุผล)..."
              className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm outline-none focus:border-amber-500"/>
          </div>
        </div>

        {/* List */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          {loading ? (
            <p className="text-center py-10 text-slate-400">กำลังโหลด...</p>
          ) : shown.length === 0 ? (
            <p className="text-center py-12 text-slate-400">
              {tab === 'pending' ? '✓ ไม่มีม้วนรอพิจารณา' : 'ยังไม่มีม้วนที่ตัดสินแล้ว'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">เครื่อง · Lot · ม้วน</th>
                  <th className="px-3 py-2 text-left font-semibold">สินค้า / ลูกค้า / ขนาด</th>
                  <th className="px-3 py-2 text-right font-semibold">น้ำหนัก</th>
                  <th className="px-3 py-2 text-left font-semibold">เหตุผลจากผลิต</th>
                  <th className="px-3 py-2 text-left font-semibold">{tab==='pending' ? 'การกระทำ' : 'ผจก ตัดสิน'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5">
                      <p className="font-bold text-slate-800">{r.machine_no} · #{r.roll_no}</p>
                      <p className="text-xs text-slate-500 font-mono">{r.lot_no}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="text-slate-700 text-xs">{r.product_name || '—'}</p>
                      <p className="text-xs text-slate-500">{r.customer || '—'}</p>
                      <p className="text-[10px] text-slate-400">{fmtSize(r.width_cm, r.thick_mc, r.width_unit) || '—'}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <p className="font-bold text-amber-700">{fmt(r.weight,2)} Kg</p>
                      <p className="text-[10px] text-slate-400">{r.inspector || '—'}</p>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600 max-w-[200px]">
                      {r.remark || '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      {tab === 'pending' ? (
                        <button onClick={() => setDecideRoll(r)}
                          className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold">
                          ตัดสิน →
                        </button>
                      ) : (
                        <div className="text-xs">
                          {r.review_action === 'rework' && <span className="text-emerald-700 font-bold">✓ ส่งกรอ</span>}
                          {r.review_action === 'keep'   && <span className="text-slate-700 font-bold">📦 เก็บไว้</span>}
                          {r.review_action === 'scrap'  && <span className="text-red-700 font-bold">🗑 เศษเสีย</span>}
                          <p className="text-slate-500 mt-0.5">{r.review_action_reason || '—'}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">โดย {r.review_decision_by || '—'}</p>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {decideRoll && <DecideModal roll={decideRoll} onClose={() => setDecideRoll(null)} onDone={() => { setDecideRoll(null); load() }} />}
    </div>
  )
}

// ─── Decide Modal ─────────────────────────────────────────────────────────────
function DecideModal({ roll, onClose, onDone }: { roll: Roll; onClose: () => void; onDone: () => void }) {
  const [action, setAction] = useState<'rework'|'keep'|'scrap'>('rework')
  const [reason, setReason] = useState('')
  const [by, setBy] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!by.trim()) { alert('กรอกชื่อผู้พิจารณา'); return }
    if (!reason.trim()) { alert('กรอกเหตุผล/หมายเหตุการตัดสิน'); return }
    setSaving(true)

    const newStatus = action === 'rework' ? 'approved_rework' : 'other'
    const patch: any = {
      review_status:        newStatus,
      review_action:        action,
      review_action_reason: reason.trim(),
      review_decision_by:   by.trim(),
      review_decision_at:   new Date().toISOString(),
    }
    // ถ้าตัดสินเป็น scrap → แปลง roll_type → scrap_lump (รวมในยอด scrap)
    if (action === 'scrap') {
      patch.roll_type = 'scrap_lump'
      patch.remark = `[ผจก: ${reason.trim()}] ` + (roll.remark || '')
    }

    const { error } = await supabase.from('production_rolls').update(patch).eq('id', roll.id)
    setSaving(false)
    if (error) { alert('บันทึกไม่สำเร็จ: ' + error.message); return }
    onDone()
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-slate-800 font-bold text-base">🔍 ตัดสินม้วน #{roll.roll_no}</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={18}/></button>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3 text-xs text-slate-700 space-y-0.5">
          <p><b>เครื่อง:</b> {roll.machine_no} · <b>Lot:</b> <span className="font-mono">{roll.lot_no}</span></p>
          <p><b>สินค้า:</b> {roll.product_name} · {roll.customer}</p>
          <p><b>น้ำหนัก:</b> <span className="text-amber-700 font-bold">{fmt(roll.weight,2)} Kg</span></p>
          <p className="text-amber-700"><b>ผลิตว่า:</b> {roll.remark || '—'}</p>
        </div>

        <label className="block text-xs text-slate-600 font-bold mb-1.5">การตัดสิน *</label>
        <div className="grid grid-cols-3 gap-1.5 mb-3">
          <button type="button" onClick={() => setAction('rework')}
            className={`py-2 rounded-xl text-xs font-bold border-2 ${action==='rework'?'bg-emerald-600 border-emerald-500 text-white':'bg-white border-slate-200 text-slate-500'}`}>
            ✓ ส่งกรอ
          </button>
          <button type="button" onClick={() => setAction('keep')}
            className={`py-2 rounded-xl text-xs font-bold border-2 ${action==='keep'?'bg-slate-700 border-slate-700 text-white':'bg-white border-slate-200 text-slate-500'}`}>
            📦 เก็บไว้
          </button>
          <button type="button" onClick={() => setAction('scrap')}
            className={`py-2 rounded-xl text-xs font-bold border-2 ${action==='scrap'?'bg-red-600 border-red-500 text-white':'bg-white border-slate-200 text-slate-500'}`}>
            🗑 เศษเสีย
          </button>
        </div>

        <label className="block text-xs text-slate-600 mb-1">เหตุผล / สิ่งที่จะทำ *</label>
        <input value={reason} onChange={e => setReason(e.target.value)}
          placeholder={action==='rework'?'เช่น กรอใหม่ที่ S01':action==='keep'?'เช่น เก็บไว้ใช้กับงานอื่น':'เช่น สีเพี้ยน ใช้ไม่ได้'}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:border-amber-500 mb-3"/>

        <label className="block text-xs text-slate-600 mb-1">ผู้พิจารณา (ผจก) *</label>
        <input value={by} onChange={e => setBy(e.target.value)}
          placeholder="ชื่อ ผจก"
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:border-amber-500"/>

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2.5 rounded-xl text-sm font-semibold">ยกเลิก</button>
          <button onClick={save} disabled={saving}
            className="flex-[2] bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5">
            {saving ? 'บันทึก...' : <><Check size={14}/> ยืนยันการตัดสิน</>}
          </button>
        </div>
      </div>
    </div>
  )
}
