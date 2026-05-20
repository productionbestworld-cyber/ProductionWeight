import { useEffect, useState } from 'react'
import { Package, Search, CheckCircle2, ArrowRightFromLine, RefreshCw, Wind, Printer, FileText, Download } from 'lucide-react'
import { supabase } from '../lib/supabase'
import * as XLSX from 'xlsx'

// ── พิมพ์ใบโอนเข้าคลัง ─────────────────────────────────────────────────────────
function printTransferDoc(rolls: any[], staff: string, docNoIn?: string, dateIn?: Date) {
  if (!rolls.length) return
  const docNo = docNoIn ?? `TR-${Date.now().toString().slice(-8)}`
  const date  = dateIn ?? new Date()
  const dateStr = `${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}/${date.getFullYear()+543}`
  const timeStr = date.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})

  // group by machine
  const groups: Record<string, any[]> = {}
  rolls.forEach(r => {
    const k = `${r.machine_no??'?'}|${r.lot_no??'?'}`
    if (!groups[k]) groups[k] = []
    groups[k].push(r)
  })

  const totalKg = rolls.reduce((s,r)=>s+(r.weight??0),0)

  const win = window.open('', '_blank', 'width=900,height=700')
  if (!win) return
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Sarabun','Tahoma',sans-serif;font-size:11pt;color:#000;background:#fff;padding:10mm}
.head{text-align:center;border-bottom:2px solid #000;padding-bottom:3mm;margin-bottom:4mm}
.head h1{font-size:14pt;font-weight:800}
.head h2{font-size:18pt;font-weight:900;margin-top:2mm;letter-spacing:1px}
.head p{font-size:9pt;color:#555;margin-top:1mm}
.info{display:flex;justify-content:space-between;margin-bottom:4mm;font-size:10pt}
.info-row{display:flex;gap:2mm}
.info-row b{display:inline-block;min-width:25mm}
.section-title{background:#f0f0f0;font-weight:700;padding:1.5mm 3mm;font-size:10pt;border:1px solid #aaa;border-bottom:none}
table{width:100%;border-collapse:collapse;margin-bottom:4mm}
th,td{border:1px solid #aaa;padding:2mm 3mm;font-size:9.5pt}
th{background:#f5f5f5;font-weight:700;text-align:left}
.tot{background:#003087;color:#fff;font-weight:800;font-size:12pt}
.sign{display:flex;justify-content:space-around;margin-top:15mm;gap:10mm}
.sign-box{flex:1;text-align:center}
.sign-line{border-top:1px solid #000;margin-top:18mm;padding-top:1mm;font-size:9pt}
.sign-box .label{font-size:9pt;color:#555}
@media print{@page{size:A4;margin:8mm}body{-webkit-print-color-adjust:exact}}
</style></head><body>

<div class="head">
  <h1>บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด</h1>
  <h2>ใบโอนสินค้าเข้าคลัง</h2>
  <p>BWP TRANSFER NOTE</p>
</div>

<div class="info">
  <div>
    <div class="info-row"><b>เลขที่:</b> ${docNo}</div>
    <div class="info-row"><b>วันที่:</b> ${dateStr}</div>
    <div class="info-row"><b>เวลา:</b> ${timeStr}</div>
  </div>
  <div>
    <div class="info-row"><b>ผู้โอน:</b> ${staff}</div>
    <div class="info-row"><b>รวม:</b> ${rolls.length} ม้วน</div>
    <div class="info-row"><b>น้ำหนักรวม:</b> ${totalKg.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} Kgs.</div>
  </div>
</div>

${Object.entries(groups).map(([key, items]) => {
  const [machine, lot] = key.split('|')
  const sample = items[0]
  const subKg  = items.reduce((s,r)=>s+(r.weight??0),0)
  return `
    <div class="section-title">เครื่อง ${machine} · Lot ${lot} · ${sample?.product_name??''}${sample?.customer?' · '+sample.customer:''}</div>
    <table>
      <thead>
        <tr>
          <th style="width:6%">ลำดับ</th>
          <th style="width:10%">ม้วนที่</th>
          <th style="width:16%">นน.เต็ม (Kgs.)</th>
          <th style="width:14%">นน.แกน (Kgs.)</th>
          <th style="width:18%">นน.สุทธิ (Kgs.)</th>
          <th style="width:18%">ผู้ตรวจสอบ</th>
          <th>เวลาชั่ง</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((r,i) => `
          <tr>
            <td style="text-align:center">${i+1}</td>
            <td style="text-align:center;font-weight:700">${r.roll_no}</td>
            <td style="text-align:right">${((r.weight??0)+(r.core_weight??0)).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
            <td style="text-align:right">${(r.core_weight??0).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
            <td style="text-align:right;font-weight:700">${(r.weight??0).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
            <td>${r.inspector??'—'}</td>
            <td>${new Date(r.created_at).toLocaleString('th-TH',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
          </tr>
        `).join('')}
        <tr class="tot">
          <td colspan="4" style="text-align:right">รวมเครื่อง ${machine}</td>
          <td style="text-align:right">${subKg.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
          <td>${items.length} ม้วน</td>
          <td></td>
        </tr>
      </tbody>
    </table>
  `
}).join('')}

<table>
  <tr class="tot" style="font-size:13pt">
    <td colspan="4" style="text-align:right;padding:3mm">รวมทั้งสิ้น</td>
    <td style="text-align:right;padding:3mm">${totalKg.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} Kgs.</td>
    <td style="text-align:center;padding:3mm">${rolls.length} ม้วน</td>
    <td></td>
  </tr>
</table>

<div class="sign">
  <div class="sign-box">
    <div class="sign-line"></div>
    <div><b>${staff}</b></div>
    <div class="label">ผู้โอน · ${dateStr}</div>
  </div>
  <div class="sign-box">
    <div class="sign-line"></div>
    <div>...........................</div>
    <div class="label">ผู้รับ (เจ้าหน้าที่คลัง)</div>
  </div>
  <div class="sign-box">
    <div class="sign-line"></div>
    <div>...........................</div>
    <div class="label">ผู้อนุมัติ / หัวหน้างาน</div>
  </div>
</div>

<script>window.onload=()=>{setTimeout(()=>{window.print()},400)}<\/script>
</body></html>`)
  win.document.close()
}

// ── Excel helper ─────────────────────────────────────────────────────────────
function buildTransferSheet(
  rolls: any[],
  opts: { docNo: string; date: Date; staff: string; sheetName?: string }
) {
  const { docNo, date, staff, sheetName = 'Transfer' } = opts
  const totalKg  = rolls.reduce((s, r) => s + (r.weight ?? 0), 0)
  const machines = Array.from(new Set(rolls.map(r => r.machine_no).filter(Boolean))).join(', ')
  const lots     = Array.from(new Set(rolls.map(r => r.lot_no).filter(Boolean))).join(', ')
  const products = Array.from(new Set(rolls.map(r => r.product_name).filter(Boolean))).join(', ')
  const dateStr  = date.toLocaleDateString('th-TH', { day:'2-digit', month:'2-digit', year:'numeric' })
  const timeStr  = date.toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' })

  // header rows (AOA = array of arrays)
  const header: any[][] = [
    ['บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด'],
    ['ใบโอนสินค้าเข้าคลัง (BWP TRANSFER NOTE)'],
    [],
    ['เลขที่ใบโอน :', docNo,  '',  'วันที่ :', dateStr,  'เวลา :', timeStr],
    ['ผู้โอน :',      staff,  '',  'เครื่อง :', machines, 'Lot :', lots],
    ['สินค้า :',     products,'',  'จำนวน :', `${rolls.length} ม้วน`, 'น้ำหนักรวม (สุทธิ) :', `${totalKg.toFixed(2)} Kgs.`],
    [],
    // column headers — ลำดับ ม้วนที่ นนม้วน นนแกน นนสุทธิ แล้วรายละเอียดตาม
    ['ลำดับ','ม้วนที่','นน.ม้วน (Kgs.)','นน.แกน (Kgs.)','นน.สุทธิ (Kgs.)','เครื่อง','รหัสสินค้า','สินค้า','ลูกค้า','Lot','ผู้ตรวจสอบ','เวลาชั่ง','เวลาโอน','ผู้โอน'],
  ]

  const dataRows = rolls.map((r, i) => [
    i + 1,
    r.roll_no,
    Number(((r.weight??0)+(r.core_weight??0)).toFixed(2)),
    Number((r.core_weight??0).toFixed(2)),
    Number((r.weight??0).toFixed(2)),
    r.machine_no ?? '',
    r.product_code ?? '',
    r.product_name ?? '',
    r.customer ?? '',
    r.lot_no ?? '',
    r.inspector ?? '',
    new Date(r.created_at).toLocaleString('th-TH'),
    r.transferred_at ? new Date(r.transferred_at).toLocaleString('th-TH') : '',
    r.transferred_by ?? '',
  ])

  // total row
  dataRows.push(['', `รวม ${rolls.length} ม้วน`, '', '', Number(totalKg.toFixed(2)), '', '', '', '', '', '', '', '', ''])

  const ws = XLSX.utils.aoa_to_sheet([...header, ...dataRows])

  // column widths
  ws['!cols'] = [
    {wch:6},{wch:8},{wch:16},{wch:14},{wch:16},
    {wch:8},{wch:14},{wch:26},{wch:20},{wch:14},{wch:12},{wch:20},{wch:20},{wch:14},
  ]

  // merge title rows A1:N1 and A2:N2
  ws['!merges'] = [
    { s:{r:0,c:0}, e:{r:0,c:13} },
    { s:{r:1,c:0}, e:{r:1,c:13} },
  ]

  return ws
}

function exportExcel(rolls: any[], staff: string) {
  if (!rolls.length) return
  const now     = new Date()
  const docNo   = `TR-${now.getTime().toString().slice(-8)}`
  const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`

  const ws = buildTransferSheet(rolls, { docNo, date: now, staff })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Transfer')
  XLSX.writeFile(wb, `transfer_${dateStr}.xlsx`)
}

function fmt(n: number | null | undefined, d = 2) {
  if (n == null || isNaN(n as number)) return (0).toFixed(d)
  return (n as number).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d })
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
}

export default function Transfer({ dept }: { dept?: 'blow'|'print'|'rewind' }) {
  const [rolls,       setRolls]       = useState<any[]>([])
  const [docs,        setDocs]        = useState<any[]>([])
  const [tab,         setTab]         = useState<'transfer'|'history'>('transfer')
  const [selected,    setSelected]    = useState<Set<string>>(new Set())
  const [staff,       setStaff]       = useState('')
  const [machine,     setMachine]     = useState<string>('')
  const [lotNo,       setLotNo]       = useState<string>('')
  const [showDone,    setShowDone]    = useState(false)
  const [search,      setSearch]      = useState('')
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [selectedDoc, setSelectedDoc] = useState<any | null>(null)
  const [docRolls,    setDocRolls]    = useState<any[]>([])
  const [docLoading,  setDocLoading]  = useState(false)

  async function loadRolls() {
    setLoading(true)
    let q = supabase.from('production_rolls')
      .select('*').eq('roll_type','good')
      .order('created_at',{ ascending: false })
    if (dept) q = q.or(`section.eq.${dept},section.is.null`)
    const { data } = await q
    setRolls(data ?? [])
    setLoading(false)
  }
  async function loadDocs() {
    const { data } = await supabase.from('transfer_documents')
      .select('*').order('transferred_at',{ ascending: false }).limit(50)
    setDocs(data ?? [])
  }
  useEffect(() => { loadRolls(); loadDocs() }, [])

  // หา machine + lot ทั้งหมดที่มีในวันนี้
  const machines = Array.from(new Set(rolls.map(r => r.machine_no).filter(Boolean))).sort()
  const lots     = Array.from(new Set(rolls
    .filter(r => !machine || r.machine_no === machine)
    .map(r => r.lot_no).filter(Boolean))).sort()

  // จำนวน job ที่กำลังผลิตอยู่ (machine + lot ที่ยังไม่โอนหมด)
  const jobs = Array.from(new Set(
    rolls.map(r => `${r.machine_no}__${r.lot_no}`).filter(j => !j.includes('null'))
  )).map(key => {
    const [mNo, lot] = key.split('__')
    const jobRolls = rolls.filter(r => r.machine_no === mNo && r.lot_no === lot)
    const pending  = jobRolls.filter(r => !r.transferred).length
    const sample   = jobRolls[0]
    return { machine_no: mNo, lot_no: lot, product: sample?.product_name, customer: sample?.customer, total: jobRolls.length, pending }
  })

  const filtered = rolls.filter(r => {
    if (!showDone && r.transferred) return false
    if (machine && r.machine_no !== machine) return false
    if (lotNo && r.lot_no !== lotNo) return false
    if (search) {
      const q = search.toLowerCase()
      if (!String(r.roll_no).includes(q) && !(r.remark??'').toLowerCase().includes(q)) return false
    }
    return true
  })

  function toggleOne(id: string) {
    setSelected(p => {
      const n = new Set(p)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }
  function toggleAll() {
    const pendingIds = filtered.filter(r => !r.transferred).map(r => r.id)
    if (pendingIds.every(id => selected.has(id))) {
      setSelected(new Set())
    } else {
      setSelected(new Set(pendingIds))
    }
  }

  const selectedRolls = filtered.filter(r => selected.has(r.id))
  const totalKg       = selectedRolls.reduce((s,r) => s + (r.weight??0), 0)

  async function handleTransfer() {
    if (!staff.trim()) { alert('กรุณากรอกชื่อเจ้าหน้าที่'); return }
    if (selected.size === 0) return
    if (!confirm(`โอน ${selected.size} ม้วน รวม ${fmt(totalKg)} Kgs. เข้าคลัง?\n\n(จะพิมพ์ใบโอนให้อัตโนมัติ)`)) return
    setSaving(true)
    try {
      const transferTime = new Date().toISOString()
      const docNo        = `TR-${Date.now().toString().slice(-8)}`

      // 1. สร้าง transfer_document
      const { data: doc, error: docErr } = await supabase.from('transfer_documents').insert({
        doc_no:         docNo,
        transferred_by: staff,
        transferred_at: transferTime,
        total_kg:       parseFloat(totalKg.toFixed(2)),
        total_rolls:    selected.size,
      }).select().single()
      if (docErr) throw docErr

      // 2. อัพ rolls + ผูก doc_id
      const { error: rollErr } = await supabase.from('production_rolls')
        .update({
          transferred:     true,
          transferred_at:  transferTime,
          transferred_by:  staff,
          transfer_doc_id: doc.id,
        })
        .in('id', Array.from(selected))
      if (rollErr) throw rollErr

      const transferred = selectedRolls.map(r => ({
        ...r, transferred_at: transferTime, transferred_by: staff,
      }))

      setSelected(new Set())
      await Promise.all([loadRolls(), loadDocs()])

      printTransferDoc(transferred, staff, docNo, new Date(transferTime))
    } catch (e: any) {
      alert('โอนไม่สำเร็จ: ' + (e?.message ?? e))
    } finally {
      setSaving(false)
    }
  }

  // เปิดใบโอนเก่า → ดึง rolls ของ doc นั้นแล้วพิมพ์
  async function reprintDocById(doc: any) {
    const { data } = await supabase.from('production_rolls')
      .select('*').eq('transfer_doc_id', doc.id)
      .order('created_at', { ascending: true })
    if (!data?.length) { alert('ไม่พบข้อมูลม้วนของใบนี้'); return }
    printTransferDoc(data, doc.transferred_by, doc.doc_no, new Date(doc.transferred_at))
  }

  // เปิด drill-down ของใบโอน
  async function openDoc(doc: any) {
    setSelectedDoc(doc)
    setDocRolls([])
    setDocLoading(true)
    const { data } = await supabase.from('production_rolls')
      .select('*').eq('transfer_doc_id', doc.id)
      .order('created_at', { ascending: true })
    setDocRolls(data ?? [])
    setDocLoading(false)
  }

  function exportDocExcel(doc: any, rolls: any[]) {
    if (!rolls.length) return
    const docDate = new Date(doc.transferred_at)
    const dateStr = docDate.toISOString().slice(0,10).replace(/-/g,'')
    const ws = buildTransferSheet(rolls, {
      docNo: doc.doc_no,
      date:  docDate,
      staff: doc.transferred_by,
      sheetName: doc.doc_no,
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, doc.doc_no)
    XLSX.writeFile(wb, `${doc.doc_no}_${dateStr}.xlsx`)
  }

  async function undoTransfer(id: string) {
    if (!confirm('ยกเลิกการโอนม้วนนี้?')) return
    await supabase.from('production_rolls')
      .update({ transferred: false, transferred_at: null, transferred_by: null })
      .eq('id', id)
    await loadRolls()
  }

  const pendingCount = filtered.filter(r => !r.transferred).length
  const doneCount    = rolls.filter(r => r.transferred).length

  return (
    <div className="min-h-[calc(100vh-48px)] bg-[#0a0f1e] p-5">
      <div className="max-w-6xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-white font-bold text-xl flex items-center gap-2">
              <Package size={22} className="text-brand-400" /> โอนม้วนเข้าคลัง
            </h1>
            <p className="text-slate-400 text-xs mt-0.5">เจ้าหน้าที่เลือกม้วนที่ผลิตเสร็จแล้วโอนเข้าคลัง</p>
          </div>
          <button onClick={() => { loadRolls(); loadDocs() }} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg">
            <RefreshCw size={12}/> รีเฟรช
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1 w-fit">
          {([
            { key:'transfer', label:'โอนเข้าคลัง',    icon: ArrowRightFromLine },
            { key:'history',  label:`ประวัติการโอน (${docs.length})`, icon: FileText },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab===t.key ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white'
              }`}>
              <t.icon size={14}/> {t.label}
            </button>
          ))}
        </div>

        {tab === 'history' ? (
          <div className="flex gap-4">

            {/* ── รายการใบโอน (left panel) ── */}
            <div className={`bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex-shrink-0 ${selectedDoc ? 'w-80' : 'flex-1'}`}>
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <p className="text-white font-semibold text-sm">ใบโอน 50 รายการล่าสุด</p>
                <p className="text-slate-500 text-[10px]">{docs.length} ใบ · {fmt(docs.reduce((s,d)=>s+(d.total_kg??0),0))} Kgs.</p>
              </div>
              {docs.length === 0 ? (
                <div className="py-16 text-center text-slate-600 text-sm">ยังไม่มีการโอน</div>
              ) : (
                <div className="divide-y divide-slate-800/50 max-h-[70vh] overflow-y-auto">
                  {docs.map(d => {
                    const dt   = new Date(d.transferred_at)
                    const isSel = selectedDoc?.id === d.id
                    return (
                      <button key={d.id} onClick={() => openDoc(d)} className={`w-full text-left px-4 py-3 transition-colors ${isSel ? 'bg-brand-600/20 border-l-2 border-brand-500' : 'hover:bg-slate-800/50'}`}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-brand-300 font-mono font-bold text-xs">{d.doc_no}</span>
                          <span className="text-green-300 font-black text-sm">{fmt(d.total_kg)} Kgs.</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400 text-[10px]">{dt.toLocaleDateString('th-TH')} · {fmtTime(d.transferred_at)}</span>
                          <span className="text-slate-500 text-[10px]">{d.total_rolls} ม้วน</span>
                        </div>
                        <p className="text-slate-300 text-[10px] mt-0.5">โดย: <b>{d.transferred_by}</b></p>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ── Drill-down panel (right) ── */}
            {selectedDoc && (
              <div className="flex-1 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col">
                {/* panel header */}
                <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between bg-brand-600/10">
                  <div>
                    <p className="text-brand-300 font-mono font-bold">{selectedDoc.doc_no}</p>
                    <p className="text-slate-400 text-xs mt-0.5">
                      {new Date(selectedDoc.transferred_at).toLocaleDateString('th-TH')} · {fmtTime(selectedDoc.transferred_at)} · โดย <b className="text-white">{selectedDoc.transferred_by}</b>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => exportDocExcel(selectedDoc, docRolls)} disabled={docLoading || !docRolls.length}
                      className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs px-3 py-1.5 rounded-lg transition-colors">
                      <Download size={11}/> Export Excel
                    </button>
                    <button onClick={() => { if (docRolls.length) reprintDocById(selectedDoc) }} disabled={docLoading || !docRolls.length}
                      className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-xs px-3 py-1.5 rounded-lg transition-colors">
                      <Printer size={11}/> พิมพ์ใบโอน
                    </button>
                    <button onClick={() => setSelectedDoc(null)} className="text-slate-500 hover:text-white text-xs px-2 py-1.5 rounded-lg hover:bg-slate-800 transition-colors">✕</button>
                  </div>
                </div>

                {/* KPI bar */}
                {!docLoading && docRolls.length > 0 && (
                  <div className="grid grid-cols-3 gap-3 px-5 py-3 border-b border-slate-800 bg-slate-800/20">
                    {[
                      { label:'จำนวนม้วน', value: `${docRolls.length} ม้วน`, color:'text-brand-300' },
                      { label:'น้ำหนักรวม', value: `${fmt(docRolls.reduce((s,r)=>s+(r.weight??0),0))} Kgs.`, color:'text-green-300' },
                      { label:'เครื่องที่โอน', value: Array.from(new Set(docRolls.map(r=>r.machine_no).filter(Boolean))).join(', ') || '—', color:'text-amber-300' },
                    ].map(k => (
                      <div key={k.label}>
                        <p className="text-slate-500 text-[10px]">{k.label}</p>
                        <p className={`font-black text-sm ${k.color}`}>{k.value}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* rolls table */}
                {docLoading ? (
                  <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">กำลังโหลด...</div>
                ) : docRolls.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-slate-600 text-sm">ไม่พบข้อมูลม้วน</div>
                ) : (
                  <div className="overflow-auto flex-1">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0">
                        <tr className="border-b border-slate-800 bg-slate-900 text-[10px]">
                          {['ลำดับ','เครื่อง','ม้วนที่','สินค้า','Lot','นน.เต็ม','นน.สุทธิ','ผู้ตรวจ','เวลาชั่ง'].map(h=>(
                            <th key={h} className="px-3 py-2 text-left text-slate-500 font-semibold uppercase tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {docRolls.map((r, i) => (
                          <tr key={r.id} className="hover:bg-slate-800/30">
                            <td className="px-3 py-2.5 text-slate-600 text-xs">{i+1}</td>
                            <td className="px-3 py-2.5"><span className="text-[10px] bg-brand-500/20 text-brand-300 font-bold px-1.5 py-0.5 rounded">{r.machine_no||'?'}</span></td>
                            <td className="px-3 py-2.5 text-white font-mono font-bold">#{r.roll_no}</td>
                            <td className="px-3 py-2.5 text-slate-400 text-xs max-w-[160px] truncate">{r.product_name||'—'}</td>
                            <td className="px-3 py-2.5 text-slate-500 text-xs">{r.lot_no||'—'}</td>
                            <td className="px-3 py-2.5 text-slate-300">{fmt((r.weight??0)+(r.core_weight??0))}</td>
                            <td className="px-3 py-2.5 text-green-300 font-black">{fmt(r.weight)}</td>
                            <td className="px-3 py-2.5 text-slate-400 text-xs">{r.inspector||'—'}</td>
                            <td className="px-3 py-2.5 text-slate-500 text-xs">{new Date(r.created_at).toLocaleString('th-TH',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-slate-700 bg-green-500/5">
                          <td colSpan={5} className="px-3 py-3 text-slate-300 font-semibold text-xs">รวม {docRolls.length} ม้วน</td>
                          <td className="px-3 py-3 text-slate-300 font-black">{fmt(docRolls.reduce((s,r)=>s+(r.weight??0)+(r.core_weight??0),0))}</td>
                          <td className="px-3 py-3 text-green-300 font-black">{fmt(docRolls.reduce((s,r)=>s+(r.weight??0),0))}</td>
                          <td colSpan={2}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
        <div className="flex gap-5 items-start">

          {/* ══ LEFT COLUMN — Step 1 + 2 ══════════════════════════════════ */}
          <div className="w-72 flex-shrink-0 space-y-3">

            {/* Step 1 — ชื่อเจ้าหน้าที่ */}
            <div className={`rounded-2xl border p-4 transition-all ${staff.trim() ? 'border-green-500/40 bg-green-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
              <p className="text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-black ${staff.trim() ? 'bg-green-500 text-white' : 'bg-amber-500 text-white'}`}>1</span>
                <span className={staff.trim() ? 'text-green-400' : 'text-amber-400'}>ชื่อเจ้าหน้าที่</span>
              </p>
              <input value={staff} onChange={e => setStaff(e.target.value)}
                placeholder="กรอกชื่อก่อนโอน..."
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-brand-500 placeholder:text-slate-500" />
              {staff.trim() && <p className="text-green-400 text-xs mt-1.5 flex items-center gap-1"><CheckCircle2 size={11}/> พร้อมโอน</p>}
            </div>

            {/* Step 2 — เลือกงาน */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-black bg-brand-600 text-white">2</span>
                เลือกงาน / เครื่อง
              </p>
              {loading ? <p className="text-slate-600 text-xs">กำลังโหลด...</p> : jobs.length === 0 ? (
                <p className="text-slate-600 text-sm py-2">ยังไม่มีงานวันนี้</p>
              ) : (
                <div className="space-y-1.5">
                  {/* ทุกงาน */}
                  <button onClick={() => { setMachine(''); setLotNo('') }}
                    className={`w-full text-left p-3 rounded-xl border transition-all ${!machine ? 'border-brand-500 bg-brand-500/15' : 'border-slate-700 hover:border-slate-500 hover:bg-slate-800/50'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-white font-bold text-sm">ทุกงาน</span>
                      <span className="text-slate-400 text-xs">{rolls.filter(r=>!r.transferred).length} ม้วนรอ</span>
                    </div>
                  </button>
                  {/* แต่ละงาน */}
                  {jobs.map(j => {
                    const isSel = machine === j.machine_no && lotNo === j.lot_no
                    return (
                      <button key={`${j.machine_no}-${j.lot_no}`}
                        onClick={() => { setMachine(j.machine_no); setLotNo(j.lot_no); setSelected(new Set()) }}
                        className={`w-full text-left p-3 rounded-xl border transition-all ${isSel ? 'border-brand-500 bg-brand-500/15' : 'border-slate-700 hover:border-slate-500 hover:bg-slate-800/50'}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="bg-brand-600 text-white font-black text-xs px-2 py-0.5 rounded">เครื่อง {j.machine_no}</span>
                          {j.pending > 0
                            ? <span className="text-[10px] bg-amber-500/25 text-amber-300 px-2 py-0.5 rounded-full font-bold">รอโอน {j.pending}</span>
                            : <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">โอนครบ</span>
                          }
                        </div>
                        <p className="text-white text-xs font-semibold leading-tight truncate">{j.product || '—'}</p>
                        <p className="text-slate-500 text-[10px] mt-0.5 truncate">{j.customer || ''}</p>
                        <p className="text-slate-600 text-[10px]">Lot {String(j.lot_no).slice(-8)} · รวม {j.total} ม้วน</p>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

          </div>

          {/* ══ RIGHT COLUMN — Step 3 รายการม้วน ══════════════════════════ */}
          <div className="flex-1 space-y-3">

            {/* Step 3 header */}
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-black bg-brand-600 text-white">3</span>
                เลือกม้วนที่จะโอน
                {machine && <span className="text-brand-300 normal-case font-normal">— เครื่อง {machine}</span>}
              </p>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
                  <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} className="w-3.5 h-3.5 accent-brand-500"/>
                  แสดงที่โอนแล้ว
                </label>
                <div className="relative">
                  <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"/>
                  <input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="ค้นหาม้วน..."
                    className="bg-slate-800 border border-slate-700 rounded-lg pl-7 pr-3 py-1.5 text-xs text-white outline-none focus:border-brand-500 w-36"/>
                </div>
              </div>
            </div>

            {/* Summary strip */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-amber-400 text-[10px] uppercase tracking-wider">รอโอน</p>
                  <p className="text-xl font-black text-amber-300">{pendingCount} <span className="text-xs font-normal text-slate-400">ม้วน</span></p>
                </div>
                <Wind size={18} className="text-amber-500/40"/>
              </div>
              <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-green-400 text-[10px] uppercase tracking-wider">โอนแล้ว</p>
                  <p className="text-xl font-black text-green-300">{doneCount} <span className="text-xs font-normal text-slate-400">ม้วน</span></p>
                </div>
                <CheckCircle2 size={18} className="text-green-500/40"/>
              </div>
              <div className={`border rounded-xl px-4 py-2.5 flex items-center justify-between transition-all ${selected.size > 0 ? 'bg-brand-500/20 border-brand-500/50' : 'bg-slate-800/40 border-slate-700'}`}>
                <div>
                  <p className="text-brand-400 text-[10px] uppercase tracking-wider">เลือกอยู่</p>
                  <p className="text-xl font-black text-brand-300">{selected.size} <span className="text-xs font-normal text-slate-400">ม้วน</span></p>
                  {selected.size > 0 && <p className="text-brand-400 text-[10px]">{fmt(totalKg)} Kgs.</p>}
                </div>
                <Package size={18} className="text-brand-500/40"/>
              </div>
            </div>

            {/* Confirm bar — ปรากฏเมื่อเลือกแล้ว */}
            {selected.size > 0 && (
              <div className="rounded-2xl border border-brand-500/40 bg-brand-500/10 px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="text-white font-bold">โอน {selected.size} ม้วน · <span className="text-brand-300">{fmt(totalKg)} Kgs.</span></p>
                  <p className="text-slate-400 text-xs mt-0.5">ผู้โอน: <b className={staff.trim() ? 'text-white' : 'text-red-400'}>{ staff.trim() || '⚠ ยังไม่ได้กรอกชื่อ'}</b></p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setSelected(new Set())} className="text-slate-400 hover:text-white text-xs px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700">
                    ล้าง
                  </button>
                  <button onClick={() => exportExcel(selectedRolls, staff || 'ไม่ระบุ')}
                    className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-xs px-3 py-2 rounded-xl font-bold">
                    <Download size={12}/> Excel
                  </button>
                  <button onClick={handleTransfer} disabled={saving || !staff.trim()}
                    className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-sm px-5 py-2 rounded-xl font-bold transition-colors">
                    <ArrowRightFromLine size={14}/>
                    {saving ? 'กำลังโอน...' : 'ยืนยันโอนเข้าคลัง'}
                  </button>
                </div>
              </div>
            )}

            {/* Roll list */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">

              {/* Select all bar */}
              {filtered.some(r => !r.transferred) && (
                <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-800/20 flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-300 select-none">
                    <input type="checkbox"
                      checked={filtered.filter(r=>!r.transferred).length > 0 && filtered.filter(r=>!r.transferred).every(r=>selected.has(r.id))}
                      onChange={toggleAll}
                      className="w-4 h-4 accent-brand-500"/>
                    เลือกทั้งหมด ({filtered.filter(r=>!r.transferred).length} ม้วน)
                  </label>
                  <p className="text-slate-500 text-xs">
                    รวม {fmt(filtered.filter(r=>!r.transferred).reduce((s,r)=>s+(r.weight??0),0))} Kgs.
                  </p>
                </div>
              )}

              {loading ? (
                <div className="py-16 text-center text-slate-500 text-sm">กำลังโหลด...</div>
              ) : filtered.length === 0 ? (
                <div className="py-16 text-center">
                  <CheckCircle2 size={32} className="text-green-600 mx-auto mb-2"/>
                  <p className="text-slate-400 font-semibold">โอนครบแล้ว!</p>
                  <p className="text-slate-600 text-xs mt-1">ไม่มีม้วนรอโอนในงานนี้</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-800/60">
                  {filtered.map(r => {
                    const isSel  = selected.has(r.id)
                    const isDone = r.transferred
                    return (
                      <div key={r.id} onClick={() => !isDone && toggleOne(r.id)}
                        className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                          isDone  ? 'opacity-40 cursor-default' :
                          isSel   ? 'bg-brand-500/12 cursor-pointer' :
                                    'hover:bg-slate-800/50 cursor-pointer'
                        }`}>

                        {/* Checkbox */}
                        <div className="flex-shrink-0">
                          {isDone
                            ? <CheckCircle2 size={18} className="text-green-500"/>
                            : <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${isSel ? 'bg-brand-500 border-brand-500' : 'border-slate-600'}`}>
                                {isSel && <span className="text-white text-[10px] font-black">✓</span>}
                              </div>
                          }
                        </div>

                        {/* Machine badge */}
                        <span className={`text-xs font-black px-2 py-1 rounded-lg w-12 text-center flex-shrink-0 ${isDone ? 'bg-slate-800 text-slate-500' : 'bg-brand-600 text-white'}`}>
                          {r.machine_no || '?'}
                        </span>

                        {/* Roll info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className={`font-mono font-black text-base ${isDone ? 'text-slate-500' : 'text-white'}`}>ม้วน #{r.roll_no}</span>
                            {isDone && <span className="text-[10px] text-green-400">✓ โอนแล้ว {r.transferred_by && `· ${r.transferred_by}`}</span>}
                          </div>
                          <p className="text-slate-500 text-xs truncate">{r.product_name || '—'}{r.lot_no ? ` · Lot ${r.lot_no}` : ''}</p>
                        </div>

                        {/* Weight */}
                        <div className="text-right flex-shrink-0">
                          <p className={`font-black text-lg leading-none ${isDone ? 'text-slate-500' : 'text-brand-300'}`}>{fmt(r.weight)}</p>
                          <p className="text-slate-600 text-[10px]">Kgs. สุทธิ</p>
                        </div>

                        {/* Time */}
                        <div className="text-right flex-shrink-0 w-14">
                          <p className="text-slate-400 text-xs">{fmtTime(r.created_at)}</p>
                          <p className="text-slate-600 text-[10px]">{r.inspector || ''}</p>
                        </div>

                        {/* undo */}
                        {isDone && (
                          <button onClick={(e) => { e.stopPropagation(); undoTransfer(r.id) }}
                            className="text-[10px] text-slate-600 hover:text-red-400 px-2 py-1 rounded hover:bg-slate-800 transition-colors flex-shrink-0">
                            ↶
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

          </div>
        </div>
        )}
      </div>
    </div>
  )
}
