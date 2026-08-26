// ════════════════════════════════════════════════════════════════════════
//  ค้นหาม้วน (Smart Roll Search) — พิมพ์อะไรก็ได้ ระบบแยกคำให้เอง
//  เปิดผ่านเมนู "ค้นหาม้วน" หรือ  ?rollsearch=1  /  /rollsearch
//
//  พิมพ์รวมๆ ได้เลย เช่น
//    "BL08 120x150 หนัก 132 ม้วน 2"   → เจอม้วน + ใบโอน
//    "69BL10000306 WO147"             → ทุกม้วนของงานนั้น
//    "0204-SOV005"                    → ทุกม้วนของสินค้านั้น
//    "TR-59513378"                    → ทุกม้วนในใบโอนนั้น
//
//  ออกแบบไว้ให้ต่อ "แชทบอท AI (B)" ทีหลังได้ — แค่ให้ AI เติม object `f`
//  (เครื่อง/ขนาด/น้ำหนัก/ม้วน/lot/WO/item/ใบโอน/ข้อความ) แล้วเรียก runSearch(f)
// ════════════════════════════════════════════════════════════════════════
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { restoreReworkSource } from '../lib/rework'
import { reprintRollLabel, printRollsBatch } from './WeighStation'

const TZ = 'Asia/Bangkok'
const nf = (n: number, d = 2) => (n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtTime = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('th-TH', { timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '—'

const TYPE: Record<string, { label: string; cls: string }> = {
  good:        { label: 'ม้วนดี',  cls: 'bg-green-500/15 text-green-300' },
  bad:         { label: 'ม้วนกรอ', cls: 'bg-amber-500/15 text-amber-300' },
  scrap_clear: { label: 'เศษใส',   cls: 'bg-slate-500/15 text-slate-300' },
  scrap_color: { label: 'เศษสี',   cls: 'bg-slate-500/15 text-slate-300' },
  scrap_lump:  { label: 'เศษก้อน', cls: 'bg-slate-500/15 text-slate-300' },
}
const typeOf = (t: string | null) => TYPE[t ?? ''] ?? { label: t ?? '—', cls: 'bg-slate-700 text-slate-300' }

// ── ตัวกรองที่แยกออกมาจากข้อความ (AI ก็เติม object นี้ได้) ──────────────
type Filters = {
  machine?: string; lot?: string; item?: string
  width?: number; thick?: number; weight?: number; roll?: number
  wo?: string; woTail?: string; doc?: string; text?: string
}

type Roll = {
  id: string; roll_no: number | null; roll_type: string | null
  weight: number | null; gross_weight: number | null
  width_cm: number | null; thick_mc: number | null
  item_code: string | null; product_code: string | null; product_name: string | null
  lot_no: string | null; work_order: string | null; sale_order: string | null
  customer: string | null; machine_no: string | null
  transferred: boolean | null; transfer_doc_id: string | null; created_at: string | null
}

const COLS = 'id,roll_no,roll_type,weight,gross_weight,width_cm,thick_mc,item_code,product_code,product_name,lot_no,work_order,sale_order,customer,machine_no,transferred,transfer_doc_id,created_at'

// ── แยกคำจากข้อความค้นหา ────────────────────────────────────────────────
function parseQuery(raw: string): { f: Filters; chips: [string, string][] } {
  let s = ' ' + raw.trim() + ' '
  const f: Filters = {}
  const chips: [string, string][] = []
  const eat = (re: RegExp) => { const m = s.match(re); if (m) s = s.replace(m[0], ' '); return m }

  let m = eat(/TR-\d+/i)
  if (m) { f.doc = m[0].toUpperCase(); chips.push(['ใบโอน', f.doc]) }

  m = eat(/\b\d{2}[A-Za-z]{2}\d{6,8}\b/)               // lot เช่น 69BL10000306
  if (m) { f.lot = m[0].toUpperCase(); chips.push(['Lot', f.lot]) }

  m = eat(/\b\d{3,4}-[A-Za-z]{2,4}\d{2,3}\b/i)         // item/product code เช่น 0204-SOV005
  if (m) { f.item = m[0].toUpperCase(); chips.push(['สินค้า', f.item]) }

  m = eat(/(\d+(?:\.\d+)?)\s*[xX*×]\s*(\d+(?:\.\d+)?)/) // ขนาด เช่น 120x150
  if (m) { f.width = parseFloat(m[1]); f.thick = parseFloat(m[2]); chips.push(['ขนาด', `${m[1]}x${m[2]}`]) }

  m = eat(/\b\d{2}\/\d{2}\/\d{3}\b/)                    // WO เต็ม 69/06/147
  if (m) { f.wo = m[0]; chips.push(['WO', f.wo]) }
  else { m = eat(/(?:wo|งาน)\s*0*(\d{2,3})\b/i); if (m) { f.woTail = m[1]; chips.push(['WO', m[1]]) } }

  m = eat(/\b([A-Za-z]{2}\d{2})\b/)                     // เครื่อง เช่น BL08
  if (m) { f.machine = m[1].toUpperCase(); chips.push(['เครื่อง', f.machine]) }

  m = eat(/(?:ม้วน(?:ที่)?|#|roll)\s*0*(\d{1,3})\b/i)   // ม้วนที่ 2
  if (m) { f.roll = parseInt(m[1]); chips.push(['ม้วนที่', String(f.roll)]) }

  m = eat(/(?:หนัก|นน\.?|น้ำหนัก|kg)\s*(\d+(?:\.\d+)?)/i) // น้ำหนัก ระบุชัด
  if (m) { f.weight = parseFloat(m[1]); chips.push(['น้ำหนัก', String(f.weight)]) }
  else {                                                 // เลขลอยๆ ที่เหลือ → เดาว่าน้ำหนัก
    const nums = (s.match(/\b\d+(?:\.\d+)?\b/g) || []).map(parseFloat)
    const w = nums.find(n => n >= 5)
    if (w != null) { f.weight = w; chips.push(['น้ำหนัก', String(w)]); s = s.replace(new RegExp('\\b' + w + '\\b'), ' ') }
  }

  const text = s.trim().replace(/\s+/g, ' ')
  if (text) { f.text = text; chips.push(['ข้อความ', text]) }
  return { f, chips }
}

export default function RollSearch({ readOnly = false }: { readOnly?: boolean } = {}) {
  const [input, setInput] = useState('')
  const [chips, setChips] = useState<[string, string][]>([])
  const [rolls, setRolls] = useState<Roll[]>([])
  const [docMap, setDocMap] = useState<Record<string, { no: string; cust: string | null }>>({})
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [err, setErr] = useState('')
  // ── modal ดูข้อมูล + รีปริ้น ──
  const [detail, setDetail] = useState<any | null>(null)
  const [detailDoc, setDetailDoc] = useState<{ no: string; cust: string | null } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [printing, setPrinting] = useState(false)

  async function openDetail(id: string) {
    setDetailLoading(true); setDetail({}); setDetailDoc(null); setDelMode(false); setDelBy(''); setDelReason('')
    const { data } = await supabase.from('production_rolls').select('*').eq('id', id).single()
    if (data?.transfer_doc_id) {
      const { data: d } = await supabase.from('transfer_documents').select('doc_no,customer').eq('id', data.transfer_doc_id).single()
      if (d) setDetailDoc({ no: d.doc_no, cust: d.customer })
    }
    setDetail(data ?? null); setDetailLoading(false)
  }
  async function doReprint(size: 'long' | 'short') {
    if (!detail) return
    setPrinting(true)
    try { await reprintRollLabel(detail, size) }
    catch (e: any) { alert('รีปริ้นไม่สำเร็จ: ' + (e?.message ?? e)) }
    finally { setPrinting(false) }
  }

  // ── ลบม้วน (ชั่งผิด/งานผิด) — ใช้ RPC เดียวกับจอชั่ง + คืนม้วนต้นทางกรอ ──
  const [delMode, setDelMode] = useState(false)
  const [delBy, setDelBy] = useState('')
  const [delReason, setDelReason] = useState('')
  const [deleting, setDeleting] = useState(false)
  async function doDelete() {
    if (!detail) return
    if (!delBy.trim()) { alert('กรอกชื่อผู้ลบ'); return }
    if (!delReason.trim()) { alert('กรอกเหตุผล'); return }
    setDeleting(true)
    try {
      const { error } = await supabase.rpc('delete_roll_atomic', {
        p_roll_id: detail.id, p_deleted_by: delBy.trim(), p_reason: delReason.trim(),
        p_work_order: detail.work_order ?? null, p_sale_order: detail.sale_order ?? null,
      })
      if (error) throw error
      // ม้วนกรอ: คืนม้วนต้นทาง — มีงานกรอ active → กรอต่อในงานเดิม · ไม่มี → คืนเข้าคิวให้เลือกกรอใหม่
      let restoredTo: 'reworking' | 'queue' | null = null
      if (detail.rework_source_roll_id) {
        restoredTo = await restoreReworkSource(detail.rework_source_roll_id, `คืนสถานะ (ลบม้วนกรอ #${detail.roll_no}: ${delReason.trim()})`)
      }
      setRolls(prev => prev.filter(x => x.id !== detail.id))   // เอาออกจากผลค้นหา
      setDetail(null); setDelMode(false); setDelBy(''); setDelReason('')
      alert('✅ ลบม้วนแล้ว' + (restoredTo === 'queue' ? ' · คืนม้วนต้นทางกลับคิว "รับจากผลิต" แล้ว'
        : restoredTo === 'reworking' ? ' · คืนม้วนต้นทางให้กรอต่อในงานเดิมแล้ว' : ''))
    } catch (e: any) { alert('ลบไม่สำเร็จ: ' + (e?.message ?? e)) }
    finally { setDeleting(false) }
  }

  // ── รีปริ้นทั้งหมดตามผลค้นหา (ใบครบในเอกสารเดียว ปริ้นครั้งเดียว) ──
  const [batchPrinting, setBatchPrinting] = useState(false)
  async function reprintAll() {
    if (!rolls.length) return
    // เลี่ยงปริ้นเยอะเกิน (แนะนำกรองทีละเครื่อง)
    const ids = rolls.map(r => r.id)
    if (ids.length > 120 && !confirm(`จะปริ้น ${ids.length} ใบในครั้งเดียว (เยอะมาก) — แนะนำกรองทีละเครื่องก่อน\n\nยืนยันปริ้นทั้งหมด?`)) return
    setBatchPrinting(true)
    try {
      // ดึงข้อมูลเต็มทุกคอลัมน์ (ผลค้นหามีไม่ครบ เช่น mat_code/core_weight) แล้วปริ้นรวม
      const full: any[] = []
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await supabase.from('production_rolls').select('*').in('id', ids.slice(i, i + 200))
        full.push(...(data ?? []))
      }
      full.sort((a, b) => String(a.machine_no).localeCompare(String(b.machine_no)) || (a.roll_no ?? 0) - (b.roll_no ?? 0))
      await printRollsBatch(full, 'short')
    } catch (e: any) { alert('รีปริ้นรวมไม่สำเร็จ: ' + (e?.message ?? e)) }
    finally { setBatchPrinting(false) }
  }

  // ── ตัวค้นจริง (AI ก็เรียกตรงนี้ได้ในอนาคต) ─────────────────────────
  async function runSearch(f: Filters) {
    setLoading(true); setErr('')
    try {
      let rows: Roll[] = []
      if (f.doc) {
        // ค้นจากเลขใบโอน → หาเอกสาร → ดึงม้วนในใบ
        const { data: docs } = await supabase.from('transfer_documents').select('id,doc_no').ilike('doc_no', `%${f.doc}%`)
        const ids = (docs ?? []).map(d => d.id)
        if (ids.length) {
          const { data } = await supabase.from('production_rolls').select(COLS).in('transfer_doc_id', ids).order('roll_no')
          rows = (data ?? []) as Roll[]
        }
      } else {
        let q = supabase.from('production_rolls').select(COLS).order('created_at', { ascending: false }).limit(500)
        if (f.machine) q = q.eq('machine_no', f.machine)
        if (f.lot) q = q.eq('lot_no', f.lot)
        if (f.roll != null) q = q.eq('roll_no', f.roll)
        if (f.width != null) q = q.eq('width_cm', f.width)
        if (f.thick != null) q = q.eq('thick_mc', f.thick)
        if (f.weight != null) q = q.gte('weight', f.weight - 0.05).lte('weight', f.weight + 0.05)
        if (f.item) q = q.or(`item_code.eq.${f.item},product_code.eq.${f.item}`)
        if (f.wo) q = q.eq('work_order', f.wo)
        else if (f.woTail) q = q.ilike('work_order', `%/${f.woTail}`)
        if (f.text) q = q.or(`product_name.ilike.%${f.text}%,customer.ilike.%${f.text}%`)
        const { data, error } = await q
        if (error) throw error
        rows = (data ?? []) as Roll[]
      }
      // resolve ใบโอน
      const ids = Array.from(new Set(rows.map(r => r.transfer_doc_id).filter(Boolean))) as string[]
      const dm: Record<string, { no: string; cust: string | null }> = {}
      if (ids.length) {
        const { data: docs } = await supabase.from('transfer_documents').select('id,doc_no,customer').in('id', ids)
        for (const d of docs ?? []) dm[d.id] = { no: d.doc_no, cust: d.customer }
      }
      setDocMap(dm); setRolls(rows)
    } catch (e: any) {
      setErr(e?.message ?? 'ค้นหาไม่สำเร็จ'); setRolls([])
    } finally { setLoading(false); setSearched(true) }
  }

  function go() {
    if (!input.trim()) return
    const { f, chips } = parseQuery(input)
    setChips(chips)
    runSearch(f)
  }

  const examples = ['BL08 120x150 หนัก 132 ม้วน 2', '69BL10000306 WO147', '0204-SOV005', 'TR-59513378']
  const totNet = rolls.reduce((s, r) => s + (r.weight ?? 0), 0)

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-slate-200">
      <div className="sticky top-0 z-30 bg-[#0a0f1e]/95 backdrop-blur border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">🔎</span>
          <div>
            <h1 className="text-white font-black text-lg leading-tight">ค้นหาม้วน</h1>
            <p className="text-slate-500 text-[11px]">พิมพ์รวมๆ ได้เลย — เครื่อง / ขนาด / น้ำหนัก / ม้วนที่ / Lot / WO / สินค้า / เลขใบโอน · ระบบแยกคำให้เอง</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go() }}
            autoFocus placeholder="เช่น  BL08 120x150 หนัก 132 ม้วน 2"
            className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-brand-500" />
          <button onClick={go} disabled={loading}
            className="px-5 py-2.5 rounded-xl text-sm font-bold bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50">
            {loading ? 'กำลังค้น…' : 'ค้นหา'}
          </button>
        </div>
        {/* ตัวอย่างคำค้น */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-slate-600">ลอง:</span>
          {examples.map(ex => (
            <button key={ex} onClick={() => { setInput(ex); const { f, chips } = parseQuery(ex); setChips(chips); runSearch(f) }}
              className="text-[11px] bg-slate-800/70 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-full px-2.5 py-1">{ex}</button>
          ))}
        </div>
        {/* chip ว่าระบบเข้าใจว่าอะไร */}
        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-500">เข้าใจว่า:</span>
            {chips.map(([k, v], i) => (
              <span key={i} className="text-[11px] bg-brand-500/15 text-brand-200 border border-brand-500/30 rounded-md px-2 py-0.5">
                {k}: <b>{v}</b>
              </span>
            ))}
            {searched && <span className="text-[11px] text-slate-400 ml-1">· เจอ {nf(rolls.length, 0)} ม้วน · รวม <b className="text-green-300">{nf(totNet, 1)}</b> kg</span>}
          </div>
        )}
      </div>

      <div className="p-3">
        {err && <p className="text-center text-red-400 text-sm py-6">⚠ {err}</p>}
        {!searched && !loading && (
          <div className="text-center text-slate-600 py-20">
            <p className="text-4xl mb-3">🔎</p>
            <p className="text-sm">พิมพ์สิ่งที่อยากหา แล้วกด “ค้นหา” หรือ Enter</p>
            <p className="text-xs text-slate-700 mt-1">ผสมหลายเงื่อนไขในบรรทัดเดียวได้ — ระบบจะหาม้วนที่ตรงทั้งหมด พร้อมบอกว่าอยู่ใบโอนไหน</p>
          </div>
        )}
        {searched && !loading && !rolls.length && !err && (
          <p className="text-center text-slate-500 py-16">ไม่เจอม้วนที่ตรงเงื่อนไข — ลองตัดคำให้น้อยลง</p>
        )}
        {rolls.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-2 bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2">
            <span className="text-xs text-slate-400">รีปริ้นรวมตามผลค้นหา ({nf(rolls.length, 0)} ใบ):</span>
            <button onClick={reprintAll} disabled={batchPrinting}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-green-600 hover:bg-green-500 text-white disabled:opacity-50">
              {batchPrinting ? 'กำลังเตรียม…' : `🖨 รีปริ้นทั้งหมด (${nf(rolls.length, 0)} ใบ)`}
            </button>
            <span className="text-[11px] text-slate-500">· ปริ้นครั้งเดียวได้ครบ — แนะนำกรองทีละเครื่อง</span>
          </div>
        )}
        {rolls.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-xs">
              <thead className="bg-slate-900 text-slate-500">
                <tr>
                  {['เครื่อง', 'ม้วน', 'ชนิด', 'ขนาด', 'นน.', 'สินค้า', 'Lot', 'WO', 'ลูกค้า', 'ใบโอน', 'ผลิตเมื่อ', ''].map(h => (
                    <th key={h} className="text-left px-2.5 py-2 whitespace-nowrap font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rolls.slice(0, 500).map(r => {
                  const t = typeOf(r.roll_type)
                  const doc = r.transfer_doc_id ? docMap[r.transfer_doc_id] : null
                  return (
                    <tr key={r.id} className="border-t border-slate-800/70 hover:bg-slate-800/40">
                      <td className="px-2.5 py-1.5"><span className="text-brand-300 font-bold">{r.machine_no || '—'}</span></td>
                      <td className="px-2.5 py-1.5 text-white font-mono">{String(r.roll_type).startsWith('scrap') ? '—' : `#${r.roll_no}`}</td>
                      <td className="px-2.5 py-1.5"><span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${t.cls}`}>{t.label}</span></td>
                      <td className="px-2.5 py-1.5 text-slate-400 whitespace-nowrap">{r.width_cm ? `${r.width_cm}x${r.thick_mc}` : '—'}</td>
                      <td className="px-2.5 py-1.5 text-right text-green-300 font-bold">{nf(r.weight ?? 0)}</td>
                      <td className="px-2.5 py-1.5 text-slate-400 max-w-[150px] truncate" title={`${r.product_name ?? ''} ${r.item_code ?? ''}`}>{r.product_name || r.item_code || '—'}</td>
                      <td className="px-2.5 py-1.5 text-slate-500 font-mono">{r.lot_no || '—'}</td>
                      <td className="px-2.5 py-1.5 text-amber-300 whitespace-nowrap">{r.work_order || '—'}</td>
                      <td className="px-2.5 py-1.5 text-slate-300 max-w-[130px] truncate">{r.customer || '—'}</td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        {doc
                          ? <span className="text-green-300 font-semibold" title={doc.cust ?? ''}>{doc.no}</span>
                          : r.transferred
                            ? <span className="text-slate-500">โอนแล้ว</span>
                            : <span className="text-slate-600">ยังไม่โอน</span>}
                      </td>
                      <td className="px-2.5 py-1.5 text-slate-400 whitespace-nowrap">{fmtTime(r.created_at)}</td>
                      <td className="px-2.5 py-1.5">
                        <button onClick={() => openDetail(r.id)}
                          className="text-brand-300 hover:text-white text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md px-2 py-1">
                          ดู / รีปริ้น
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {rolls.length > 500 && <p className="text-center text-slate-500 text-xs py-3">แสดง 500 ม้วนแรก · ตัดคำให้แคบลงเพื่อดูตรงขึ้น</p>}
          </div>
        )}
      </div>

      {/* ── Modal: ดูข้อมูลม้วน + รีปริ้น ── */}
      {detail !== null && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4" onClick={() => setDetail(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md max-h-[88vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">🧾</span>
                <div>
                  <p className="text-white font-bold text-sm">ข้อมูลม้วน</p>
                  <p className="text-slate-500 text-[11px]">{detail.machine_no} · {String(detail.roll_type ?? '').startsWith('scrap') ? 'เศษ' : `ม้วนที่ ${detail.roll_no}`}</p>
                </div>
              </div>
              <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
            </div>

            {detailLoading ? (
              <div className="flex items-center justify-center py-16 text-slate-500">
                <div className="w-8 h-8 border-4 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
              </div>
            ) : (
              <div className="px-5 py-4 overflow-y-auto text-sm space-y-1.5">
                {([
                  ['ชนิด', typeOf(detail.roll_type).label],
                  ['เครื่อง', detail.machine_no],
                  ['ม้วนที่', String(detail.roll_type ?? '').startsWith('scrap') ? '—' : `#${detail.roll_no}`],
                  ['ขนาด', detail.width_cm ? `${detail.width_cm} ${detail.width_unit ?? 'cm'} x ${detail.thick_mc} mc` : '—'],
                  ['นน. เต็ม', `${nf(detail.gross_weight ?? 0)} kg`],
                  ['นน. แกน', `${nf(detail.core_weight ?? 0)} kg`],
                  ['นน. สุทธิ', `${nf(detail.weight ?? 0)} kg`],
                  ['สินค้า', detail.product_name],
                  ['item / product', `${detail.item_code ?? '—'} / ${detail.product_code ?? '—'}`],
                  ['mat code', detail.mat_code],
                  ['Lot', detail.lot_no],
                  ['WO / SO', `${detail.work_order ?? '—'} / ${detail.sale_order ?? '—'}`],
                  ['ลูกค้า', `${detail.customer ?? '—'}${detail.cust_branch ? ' · ' + detail.cust_branch : ''}`],
                  ['ผู้ตรวจ', detail.inspector],
                  ['ผลิตเมื่อ', fmtTime(detail.created_at)],
                  ['หมายเหตุ', detail.remark],
                ] as [string, any][]).map(([k, v]) => (
                  <div key={k} className="flex gap-3">
                    <span className="text-slate-500 w-28 shrink-0">{k}</span>
                    <span className="text-slate-200 flex-1 break-words">{v || '—'}</span>
                  </div>
                ))}
                <div className="flex gap-3 pt-1 mt-1 border-t border-slate-800">
                  <span className="text-slate-500 w-28 shrink-0">สถานะโอน</span>
                  <span className="flex-1">
                    {detailDoc
                      ? <span className="text-green-300 font-semibold">โอนแล้ว · ใบ {detailDoc.no}{detailDoc.cust ? ` (${detailDoc.cust})` : ''}</span>
                      : detail.transferred ? <span className="text-slate-400">โอนแล้ว</span> : <span className="text-amber-300">ยังไม่โอน</span>}
                  </span>
                </div>
              </div>
            )}

            <div className="px-5 py-3 border-t border-slate-800 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-slate-500">รีปริ้นใบปะหน้า (วันผลิต = วันชั่งจริง):</span>
              <button onClick={() => doReprint('short')} disabled={printing || detailLoading}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50">🖨 รีปริ้น</button>
              <a href={`/?roll=${detail.id}`} target="_blank" rel="noopener noreferrer"
                className="ml-auto text-[11px] text-brand-400 hover:text-brand-200 underline">เปิดหน้าเต็ม ↗</a>
            </div>

            {/* ── ลบม้วน (ชั่งผิด/งานผิด) ── */}
            <div className="px-5 py-3 border-t border-slate-800">
              {!delMode ? (
                <button hidden={readOnly} onClick={() => setDelMode(true)}
                  className="w-full text-red-300 hover:text-white text-xs font-bold bg-red-500/10 hover:bg-red-600 border border-red-500/40 rounded-lg py-2">
                  🗑 ลบม้วนนี้ (ชั่งผิด / งานผิด)
                </button>
              ) : (
                <div className="space-y-2 border border-red-500/40 rounded-lg p-2.5 bg-red-500/5">
                  <p className="text-red-300 text-xs font-bold">ยืนยันลบม้วน #{detail.roll_no} · {detail.lot_no}{detail.rework_source_roll_id ? ' (กรอ → จะคืนม้วนต้นทางกลับคิว)' : ''}</p>
                  <div className="flex gap-2">
                    <input value={delBy} onChange={e => setDelBy(e.target.value)} placeholder="ชื่อผู้ลบ *"
                      className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-red-500" />
                    <input value={delReason} onChange={e => setDelReason(e.target.value)} placeholder="เหตุผล * เช่น ชั่งผิดงาน"
                      className="flex-[2] bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-red-500" />
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={doDelete} disabled={deleting}
                      className="flex-1 bg-red-600 hover:bg-red-500 text-white text-xs font-black rounded-lg py-2 disabled:opacity-50">
                      {deleting ? 'กำลังลบ…' : '✓ ยืนยันลบถาวร'}
                    </button>
                    <button onClick={() => { setDelMode(false); setDelBy(''); setDelReason('') }}
                      className="px-4 py-2 text-xs text-slate-400 hover:text-white bg-slate-800 rounded-lg">ยกเลิก</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
