// ─── Admin → ใบน้ำหนักลูกค้า ──────────────────────────────────────────────────
// ลูกค้าแต่ละเจ้าใช้ใบออกน้ำหนักคนละแบบแนบไปกับใบส่งของ
// หน้านี้ผูก "ลูกค้า → ฟอร์ม" + ค่าคงที่ที่ต้องพิมพ์ลงหัวใบ (MD%, ทรีท, Material Code ฯลฯ)
// ต้องรัน db/weight_slip_templates.sql ใน Supabase ก่อนใช้งาน
import { useEffect, useState } from 'react'
import { Plus, Save, Trash2, RefreshCw, FileSpreadsheet } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { TEMPLATE_LIST, TEMPLATES, SLIP_TPL_COLS, type SlipTemplateRow, type TemplateId, type SlipExtra } from '../lib/weightSlip'

type Row = SlipTemplateRow & { id?: number; _dirty?: boolean; _new?: boolean }

// ช่องค่าคงที่ที่แต่ละฟอร์มใช้จริง — ฟอร์มอื่นไม่ต้องโชว์ให้รก
const EXTRA_FIELDS: Record<TemplateId, { key: keyof SlipExtra; label: string; ph?: string }[]> = {
  cok: [
    { key: 'md_pct',     label: 'MD %',            ph: '0.9' },
    { key: 'td_pct',     label: 'TD %',            ph: '0.1' },
    { key: 'thick_spec', label: 'ต่อท้ายความหนา',  ph: '+/-5%' },
  ],
  sevenstar: [
    { key: 'treat',      label: 'ทรีท',            ph: 'ไม่ระเบิดผิว' },
    { key: 'std_weight', label: 'นน.มาตรฐาน/ม้วน', ph: '11.43' },
    { key: 'length_m',   label: 'ความยาว (ม./ม้วน)', ph: '1800' },
  ],
  tcp: [
    { key: 'material_code', label: 'Material Code', ph: '20000354' },
    { key: 'exp_months',    label: 'อายุสินค้า (เดือน)', ph: '24' },
  ],
  generic:  [{ key: 'exp_months', label: 'อายุสินค้า (เดือน)', ph: '24' }],
  osotspa:  [],
  haadthip: [],
}

const blank = (): Row => ({ cust_match: '', template: 'generic', extra: {}, sort_order: 100, active: true, _new: true, _dirty: true })

export default function SlipTemplateAdmin() {
  const [rows, setRows]     = useState<Row[]>([])
  const [custs, setCusts]   = useState<{ cust_code: string; cust_name: string }[]>([])
  const [loading, setLoad]  = useState(true)
  const [msg, setMsg]       = useState('')
  const [err, setErr]       = useState('')

  async function load() {
    setLoad(true); setErr('')
    const [{ data, error }, c] = await Promise.all([
      supabase.from('weight_slip_templates').select(SLIP_TPL_COLS).order('sort_order').order('cust_match'),
      supabase.from('customers').select('cust_code,cust_name').order('cust_name'),
    ])
    if (error) setErr(`โหลดไม่ได้: ${error.message} — รัน db/weight_slip_templates.sql ใน Supabase ก่อน`)
    setRows(((data ?? []) as Row[]).map(r => ({ ...r, extra: r.extra ?? {} })))
    setCusts((c.data ?? []) as any[])
    setLoad(false)
  }
  useEffect(() => { load() }, [])

  function patch(i: number, p: Partial<Row>) {
    setRows(rs => rs.map((r, k) => (k === i ? { ...r, ...p, _dirty: true } : r)))
  }
  function patchExtra(i: number, key: keyof SlipExtra, v: string) {
    setRows(rs => rs.map((r, k) => {
      if (k !== i) return r
      const extra = { ...(r.extra ?? {}) }
      if (v.trim()) extra[key] = v; else delete extra[key]
      return { ...r, extra, _dirty: true }
    }))
  }

  async function saveRow(i: number) {
    const r = rows[i]
    if (!r.cust_match.trim()) { setErr('ต้องใส่ "คำในชื่อลูกค้า" ก่อน'); return }
    setErr(''); setMsg('')
    const body = {
      cust_code: r.cust_code?.trim() || null,
      cust_match: r.cust_match.trim(),
      template: r.template,
      slip_title: r.slip_title?.trim() || null,
      extra: r.extra ?? {},
      sort_order: Number(r.sort_order ?? 100) || 100,
      active: r.active !== false,
    }
    const q = r.id
      ? supabase.from('weight_slip_templates').update(body).eq('id', r.id).select(SLIP_TPL_COLS).single()
      : supabase.from('weight_slip_templates').insert(body).select(SLIP_TPL_COLS).single()
    const { data, error } = await q
    if (error) { setErr(error.message); return }
    setRows(rs => rs.map((x, k) => (k === i ? { ...(data as Row), extra: (data as Row).extra ?? {} } : x)))
    setMsg(`✓ บันทึก "${body.cust_match}" แล้ว`); setTimeout(() => setMsg(''), 3000)
  }

  async function del(i: number) {
    const r = rows[i]
    if (!confirm(`ลบการตั้งค่าของ "${r.cust_match || 'แถวใหม่'}" ?`)) return
    if (r.id) {
      const { error } = await supabase.from('weight_slip_templates').delete().eq('id', r.id)
      if (error) { setErr(error.message); return }
    }
    setRows(rs => rs.filter((_, k) => k !== i))
  }

  return (
    <div className="p-5 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <FileSpreadsheet size={18} className="text-brand-400"/>
        <h2 className="text-white font-bold text-lg">ใบน้ำหนักลูกค้า</h2>
        <button onClick={load} className="text-slate-400 hover:text-white text-xs flex items-center gap-1 ml-2">
          <RefreshCw size={12}/> รีเฟรช
        </button>
        <button onClick={() => setRows(rs => [...rs, blank()])}
          className="ml-auto flex items-center gap-1.5 bg-brand-600 hover:bg-brand-500 text-white text-sm px-4 py-2 rounded-xl font-bold">
          <Plus size={14}/> เพิ่มลูกค้า
        </button>
      </div>
      <p className="text-slate-400 text-xs mb-4">
        ผูกว่าลูกค้าเจ้าไหนใช้ฟอร์มไหน — หน้าคลังจะเลือกให้อัตโนมัติตอนกด "ออกใบน้ำหนัก"
        (จับคู่ด้วยรหัสลูกค้าก่อน ถ้าไม่มีค่อยดูว่าชื่อลูกค้ามีคำที่ตั้งไว้หรือไม่ · ไม่เจอเจ้าไหนเลย = ใช้ฟอร์มกลาง)
      </p>

      {err && <div className="mb-3 bg-red-500/10 border border-red-500/40 text-red-300 text-sm rounded-xl px-4 py-2">{err}</div>}
      {msg && <div className="mb-3 bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 text-sm rounded-xl px-4 py-2">{msg}</div>}
      {loading && <p className="text-slate-500 text-sm">กำลังโหลด...</p>}

      <div className="space-y-3">
        {rows.map((r, i) => {
          const fields = EXTRA_FIELDS[r.template] ?? []
          const tpl = TEMPLATES[r.template]
          return (
            <div key={r.id ?? `new-${i}`}
              className={`rounded-2xl border p-4 ${r._dirty ? 'border-amber-500/50 bg-amber-500/5' : 'border-slate-800 bg-slate-900/60'}`}>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-[11px] text-slate-500 mb-1">คำในชื่อลูกค้า *</label>
                  <input value={r.cust_match} onChange={e => patch(i, { cust_match: e.target.value })}
                    list="slip-cust-names" placeholder="หาดทิพย์"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-brand-500"/>
                </div>
                <div className="w-40">
                  <label className="block text-[11px] text-slate-500 mb-1">รหัสลูกค้า (ถ้ามี)</label>
                  <input value={r.cust_code ?? ''} onChange={e => patch(i, { cust_code: e.target.value })}
                    list="slip-cust-codes" placeholder="—"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-brand-500"/>
                </div>
                <div className="w-56">
                  <label className="block text-[11px] text-slate-500 mb-1">ฟอร์ม</label>
                  <select value={r.template} onChange={e => patch(i, { template: e.target.value as TemplateId })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-sm text-white outline-none focus:border-brand-500">
                    {TEMPLATE_LIST.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </div>
                <div className="w-24">
                  <label className="block text-[11px] text-slate-500 mb-1">ลำดับจับคู่</label>
                  <input type="number" value={r.sort_order ?? 100} onChange={e => patch(i, { sort_order: Number(e.target.value) })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-brand-500"/>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-slate-300 pb-2.5">
                  <input type="checkbox" checked={r.active !== false} onChange={e => patch(i, { active: e.target.checked })}
                    className="accent-brand-500"/> ใช้งาน
                </label>
                <button onClick={() => saveRow(i)}
                  className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-sm px-4 py-2 rounded-xl font-bold">
                  <Save size={14}/> บันทึก
                </button>
                <button onClick={() => del(i)} className="text-slate-500 hover:text-red-400 p-2"><Trash2 size={16}/></button>
              </div>

              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[220px]">
                  <label className="block text-[11px] text-slate-500 mb-1">ชื่อหัวใบ (เว้นว่าง = {tpl?.title || tpl?.banner || 'ค่าเริ่มต้นของฟอร์ม'})</label>
                  <input value={r.slip_title ?? ''} onChange={e => patch(i, { slip_title: e.target.value })}
                    placeholder={tpl?.title || '—'}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-brand-500"/>
                </div>
                {fields.map(f => (
                  <div key={f.key} className="w-40">
                    <label className="block text-[11px] text-slate-500 mb-1">{f.label}</label>
                    <input value={(r.extra as any)?.[f.key] ?? ''} onChange={e => patchExtra(i, f.key, e.target.value)}
                      placeholder={f.ph}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-brand-500"/>
                  </div>
                ))}
                {!fields.length && <p className="text-[11px] text-slate-600 pb-2.5">ฟอร์มนี้ไม่มีค่าคงที่ต้องตั้ง</p>}
              </div>
            </div>
          )
        })}
        {!loading && !rows.length && (
          <p className="text-slate-600 text-sm text-center py-10">ยังไม่มีลูกค้าเจ้าไหนตั้งฟอร์มไว้ — ทุกใบจะใช้ฟอร์มกลาง</p>
        )}
      </div>

      <datalist id="slip-cust-names">{custs.map(c => <option key={c.cust_code} value={c.cust_name}/>)}</datalist>
      <datalist id="slip-cust-codes">{custs.map(c => <option key={c.cust_code} value={c.cust_code}>{c.cust_name}</option>)}</datalist>

      <div className="mt-6 text-[11px] text-slate-500 leading-relaxed">
        <b className="text-slate-400">ช่องที่เว้นว่างให้เขียนมือบนใบ:</b> Po. / เลขที่ PO · เลขที่บิลส่งสินค้า · เลขที่ใบกำกับภาษี · ทะเบียนรถ · เวลา
        <br/>ระบบยังไม่เก็บข้อมูลพวกนี้ ใบที่พิมพ์ออกมาจะตีเส้นประไว้ให้กรอกเอง
      </div>
    </div>
  )
}
