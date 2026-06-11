import { useEffect, useState, Fragment } from 'react'
import { Package, Search, CheckCircle2, ArrowRightFromLine, RefreshCw, Wind, Printer, FileText, Download } from 'lucide-react'
import { supabase } from '../lib/supabase'
import * as XLSX from 'xlsx'

// ── พิมพ์ใบโอนเข้าคลัง ─────────────────────────────────────────────────────────
// เรียงม้วนน้อย→มาก (ม้วน #1 อยู่บนสุด); เศษ/ไม่มีเลข ใช้เวลาเป็นตัวรอง
function sortRollsAsc(arr: any[]): any[] {
  return [...arr].sort((a, b) => {
    const ra = a.roll_no ?? 0, rb = b.roll_no ?? 0
    if (ra !== rb) return ra - rb
    return new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime()
  })
}

function printTransferDoc(rollsIn: any[], staff: string, docNoIn?: string, dateIn?: Date) {
  if (!rollsIn.length) return
  const rolls = sortRollsAsc(rollsIn)
  const docNo = docNoIn ?? `TR-${Date.now().toString().slice(-8)}`
  const date  = dateIn ?? new Date()
  const dateStr = `${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}/${date.getFullYear()+543}`
  const timeStr = date.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})

  // ── จำแนกประเภท: ดูจาก roll_type ของม้วน (ม้วนทุกใบในใบเดียวกันเป็นประเภทเดียวกัน) ──
  const firstType = rolls[0]?.roll_type ?? 'good'
  const isBad     = firstType === 'bad'
  const isScrap   = String(firstType).startsWith('scrap')
  const docTitle  = isScrap ? 'ใบโอนเศษเสียเข้าคลัง' : isBad ? 'ใบโอนม้วนไปแผนกกรอ' : 'ใบโอนสินค้าเข้าคลัง'
  const docSub    = isScrap ? 'BWP SCRAP TRANSFER NOTE' : isBad ? 'BWP REWORK TRANSFER NOTE' : 'BWP TRANSFER NOTE'
  const headColor = isScrap ? '#c62828' : isBad ? '#ef6c00' : '#003087' // แดง/ส้ม/น้ำเงิน
  const unit      = isScrap ? 'ถุง' : 'ม้วน'
  const rollLabel = isScrap ? 'ถุงที่' : 'ม้วนที่'

  // WO + SO summary
  const woList = Array.from(new Set(rolls.map(r => r.work_order).filter(Boolean))).join(', ') || '—'
  const soList = Array.from(new Set(rolls.map(r => r.sale_order).filter(Boolean))).join(', ') || '—'
  const ddList = (() => {
    const dd = rolls.map(r => r.delivery_date).filter(Boolean)
    return dd.length ? new Date(dd[0]).toLocaleDateString('th-TH') : '—'
  })()

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
.tot{background:${headColor};color:#fff;font-weight:800;font-size:12pt}
.type-banner{display:inline-block;background:${headColor};color:#fff;font-weight:900;padding:2mm 6mm;font-size:13pt;letter-spacing:1px;border-radius:2mm;margin-top:2mm}
.sign{display:flex;justify-content:space-around;margin-top:15mm;gap:10mm}
.sign-box{flex:1;text-align:center}
.sign-line{border-top:1px solid #000;margin-top:18mm;padding-top:1mm;font-size:9pt}
.sign-box .label{font-size:9pt;color:#555}
@media print{@page{size:A4;margin:8mm}body{-webkit-print-color-adjust:exact}}
</style></head><body>

<div class="head">
  <h1>บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด</h1>
  <h2 style="color:${headColor}">${docTitle}</h2>
  <p>${docSub}</p>
  ${isBad || isScrap ? `<div class="type-banner">${isScrap ? '🗑 เศษเสีย — SCRAP' : '🔄 ม้วนกรอ — REWORK'}</div>` : ''}
</div>

<div class="info">
  <div>
    <div class="info-row"><b>เลขที่:</b> ${docNo}</div>
    <div class="info-row"><b>วันที่:</b> ${dateStr}</div>
    <div class="info-row"><b>เวลา:</b> ${timeStr}</div>
    <div class="info-row" style="margin-top:1mm;padding-top:1mm;border-top:1px dashed #aaa"><b>WO:</b> <span style="color:#d97706;font-weight:700">${woList}</span></div>
    <div class="info-row"><b>SO:</b> <span style="color:#2563eb;font-weight:700">${soList}</span></div>
    <div class="info-row"><b>วันที่ส่งของ:</b> ${ddList}</div>
  </div>
  <div>
    <div class="info-row"><b>ผู้โอน:</b> ${staff}</div>
    <div class="info-row"><b>รวม:</b> ${rolls.length} ${unit}</div>
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
          <th style="width:10%">${rollLabel}</th>
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
          <td>${items.length} ${unit}</td>
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
    <td style="text-align:center;padding:3mm">${rolls.length} ${unit}</td>
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
  rollsIn: any[],
  opts: { docNo: string; date: Date; staff: string; sheetName?: string }
) {
  const rolls = sortRollsAsc(rollsIn)
  const { docNo, date, staff, sheetName = 'Transfer' } = opts
  const totalKg  = rolls.reduce((s, r) => s + (r.weight ?? 0), 0)
  const machines  = Array.from(new Set(rolls.map(r => r.machine_no).filter(Boolean))).join(', ')
  const lots      = Array.from(new Set(rolls.map(r => r.lot_no).filter(Boolean))).join(', ')
  const products  = Array.from(new Set(rolls.map(r => r.product_name).filter(Boolean))).join(', ')
  const soNos     = Array.from(new Set(rolls.map(r => r.sale_order).filter(Boolean))).join(', ')
  const woNos     = Array.from(new Set(rolls.map(r => r.work_order).filter(Boolean))).join(', ')
  const delivDate = (() => {
    const dd = rolls.map(r => r.delivery_date).filter(Boolean)
    return dd.length ? new Date(dd[0]).toLocaleDateString('th-TH') : ''
  })()
  const dateStr   = date.toLocaleDateString('th-TH', { day:'2-digit', month:'2-digit', year:'numeric' })
  const timeStr   = date.toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' })

  // ── จำแนกประเภท ─────────────────────────────────────
  const firstType = rolls[0]?.roll_type ?? 'good'
  const isBad     = firstType === 'bad'
  const isScrap   = String(firstType).startsWith('scrap')
  const docTitle  = isScrap ? 'ใบโอนเศษเสียเข้าคลัง' : isBad ? 'ใบโอนม้วนไปแผนกกรอ' : 'ใบโอนสินค้าเข้าคลัง'
  const docSub    = isScrap ? 'BWP SCRAP TRANSFER NOTE' : isBad ? 'BWP REWORK TRANSFER NOTE' : 'BWP TRANSFER NOTE'
  const typeBanner= isScrap ? '⚠ ประเภท: เศษเสีย (SCRAP) — โอนออกเพื่อทำลาย/รีไซเคิล'
                  : isBad   ? '⚠ ประเภท: ม้วนกรอ (REWORK) — โอนออกเพื่อกรอใหม่'
                  :           'ประเภท: ม้วนดี (FG — Finished Goods)'
  const unit      = isScrap ? 'ถุง' : 'ม้วน'
  const rollColHd = isScrap ? 'ถุงที่' : 'ม้วนที่'

  const COLS = 18 // เพิ่ม WO column

  // header rows
  const header: any[][] = [
    ['บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด'],
    [`${docTitle} (${docSub})`],
    [typeBanner],
    [],
    ['เลขที่ใบโอน :', docNo,    '', 'วันที่ :', dateStr,  'เวลา :', timeStr],
    ['ผู้โอน :',      staff,    '', 'เครื่อง :', machines, 'Lot :', lots],
    ['สินค้า :',      products, '', 'จำนวน :', `${rolls.length} ${unit}`, 'น้ำหนักรวม (สุทธิ) :', `${totalKg.toFixed(2)} Kgs.`],
    ['ใบคำสั่งผลิต (WO) :', woNos || '—', '', 'Sale Order (SO) :', soNos || '—', 'วันที่ส่งของ :', delivDate || '—'],
    [],
    ['ลำดับ', rollColHd,'นน.ม้วน (Kgs.)','นน.แกน (Kgs.)','นน.สุทธิ (Kgs.)','เครื่อง','WO','SO','Item Code','Mat Code','สินค้า','ลูกค้า','Lot','ผู้ตรวจสอบ', isScrap ? 'เหตุผลเศษ' : isBad ? 'เหตุผลกรอ' : 'หมายเหตุ', 'เวลาชั่ง','เวลาโอน','ผู้โอน'],
  ]

  const dataRows = rolls.map((r, i) => [
    i + 1,
    isScrap ? `${i+1}` : r.roll_no, // เศษไม่มีเลขม้วนจริง ใช้ลำดับ
    Number(((r.weight??0)+(r.core_weight??0)).toFixed(2)),
    Number((r.core_weight??0).toFixed(2)),
    Number((r.weight??0).toFixed(2)),
    r.machine_no    ?? '',
    r.work_order    ?? '',
    r.sale_order    ?? '',
    r.item_code     ?? '',
    r.mat_code      ?? '',
    r.product_name  ?? '',
    r.customer      ?? '',
    r.lot_no        ?? '',
    r.inspector     ?? '',
    r.remark        ?? '',  // เหตุผลเศษ/กรอ
    new Date(r.created_at).toLocaleString('th-TH'),
    r.transferred_at ? new Date(r.transferred_at).toLocaleString('th-TH') : '',
    r.transferred_by ?? '',
  ])

  // total row
  dataRows.push(['', `รวม ${rolls.length} ${unit}`, '', '', Number(totalKg.toFixed(2)), '', '', '', '', '', '', '', '', '', '', '', '', ''])

  const ws = XLSX.utils.aoa_to_sheet([...header, ...dataRows])

  // column widths (18 cols: +1 column "เหตุผล")
  ws['!cols'] = [
    {wch:6},{wch:8},{wch:16},{wch:14},{wch:16},
    {wch:8},{wch:14},{wch:14},{wch:14},{wch:14},{wch:26},{wch:20},{wch:16},{wch:12},{wch:22},{wch:20},{wch:20},{wch:14},
  ]

  // merge title rows (3 บรรทัดบนสุด: ชื่อบริษัท / ประเภท / banner)
  ws['!merges'] = [
    { s:{r:0,c:0}, e:{r:0,c:COLS-1} },
    { s:{r:1,c:0}, e:{r:1,c:COLS-1} },
    { s:{r:2,c:0}, e:{r:2,c:COLS-1} },
  ]

  return ws
}

function exportExcel(rolls: any[], staff: string) {
  if (!rolls.length) return
  const now     = new Date()
  const docNo   = `TR-${now.getTime().toString().slice(-8)}`
  const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`

  // ตั้งชื่อ sheet ตามประเภท
  const ft = rolls[0]?.roll_type ?? 'good'
  const sheetName = String(ft).startsWith('scrap') ? 'Scrap' : ft === 'bad' ? 'Rework' : 'Transfer'

  const ws = buildTransferSheet(rolls, { docNo, date: now, staff, sheetName })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const prefix = sheetName === 'Scrap' ? 'scrap' : sheetName === 'Rework' ? 'rework' : 'transfer'
  XLSX.writeFile(wb, `${prefix}_${dateStr}.xlsx`)
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
  const [woFilter,    setWoFilter]    = useState<string>('')   // แยกงานตามใบสั่งผลิต (กัน 2 สินค้าปน Lot เดียว)
  const [showDone,    setShowDone]    = useState(false)
  const [search,      setSearch]      = useState('')
  const [docSearch,   setDocSearch]   = useState('')   // ค้นหาในประวัติการโอน
  const [docType,     setDocType]     = useState<'all'|'good'|'bad'|'scrap'>('all')  // กรองประเภทในประวัติ
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [selectedDoc, setSelectedDoc] = useState<any | null>(null)
  const [openGroups,  setOpenGroups]  = useState<Record<string, boolean>>({})
  const [docRolls,    setDocRolls]    = useState<any[]>([])
  const [docLoading,  setDocLoading]  = useState(false)
  const [machineProfiles, setMachineProfiles] = useState<Record<string,string>>({}) // machine_no → lot_no ปัจจุบัน
  const [typeFilter, setTypeFilter] = useState<'good'|'bad'|'scrap'>('good')
  const [pendingCounts, setPendingCounts] = useState<{ good: number; bad: number; scrap: number }>({ good: 0, bad: 0, scrap: 0 })

  // โหลดจำนวนม้วนคงค้างทุกประเภท
  // ⚠ ไม่นับม้วน review_status='pending_review' (รอ ผจก พิจารณา — ยังโอนไม่ได้)
  async function loadPendingCounts() {
    let q = supabase.from('production_rolls').select('roll_type').eq('transferred', false)
      .or('review_status.is.null,review_status.eq.approved_rework')
    if (dept) q = q.or(`section.eq.${dept},section.is.null`)
    const { data } = await q
    const c = { good: 0, bad: 0, scrap: 0 }
    for (const r of data ?? []) {
      const t = r.roll_type
      if (t === 'good') c.good += 1
      else if (t === 'bad') c.bad += 1
      else if (String(t).startsWith('scrap')) c.scrap += 1
    }
    setPendingCounts(c)
  }

  async function loadRolls() {
    setLoading(true)
    let q = supabase.from('production_rolls')
      .select('*')
      .order('created_at',{ ascending: false })
      // ⚠ ไม่แสดงม้วน review_status='pending_review' (รอ ผจก พิจารณา)
      .or('review_status.is.null,review_status.eq.approved_rework')
    // กรองตาม type ที่เลือก
    if (typeFilter === 'good')      q = q.eq('roll_type', 'good')
    else if (typeFilter === 'bad')  q = q.eq('roll_type', 'bad')
    else /* scrap */                q = q.like('roll_type', 'scrap%')
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
  useEffect(() => { loadRolls(); loadPendingCounts() }, [typeFilter])
  useEffect(() => {
    loadRolls()
    loadDocs()
    loadPendingCounts()
    // โหลด lot_no ปัจจุบันของแต่ละเครื่อง
    supabase.from('machine_profiles').select('machine_no, lot_no, work_order').then(({ data }) => {
      if (!data) return
      const map: Record<string,string> = {}
      data.forEach(p => { if (p.machine_no) map[p.machine_no] = `${p.lot_no ?? ''}__${p.work_order ?? ''}` })
      setMachineProfiles(map)
    })
  }, [])

  // หา machine + lot ทั้งหมดที่มีในวันนี้
  const machines = Array.from(new Set(rolls.map(r => r.machine_no).filter(Boolean))).sort()
  const lots     = Array.from(new Set(rolls
    .filter(r => !machine || r.machine_no === machine)
    .map(r => r.lot_no).filter(Boolean))).sort()

  // เฉพาะ job ที่ยังมีม้วนรอโอน (pending > 0) เท่านั้น
  const jobs = Array.from(new Set(
    rolls.map(r => `${r.machine_no}__${r.lot_no}__${r.work_order ?? ''}`).filter(j => !j.startsWith('null'))
  )).map(key => {
    const [mNo, lot, wo] = key.split('__')
    const jobRolls = rolls.filter(r => r.machine_no === mNo && r.lot_no === lot && (r.work_order ?? '') === wo)
    const pending  = jobRolls.filter(r => !r.transferred).length
    const sample   = jobRolls[0]
    const dates = jobRolls.map(r => r.created_at).filter(Boolean).sort()
    const size = sample?.width_cm && sample?.thick_mc ? `${sample.width_cm}${sample.width_unit ?? 'cm'}×${sample.thick_mc}mc` : ''
    return { machine_no: mNo, lot_no: lot, work_order: wo, so: sample?.sale_order ?? '', size,
             start: dates[0] ?? '', end: dates[dates.length-1] ?? '',
             product: sample?.product_name, customer: sample?.customer, total: jobRolls.length, pending }
  }).filter(j => j.pending > 0)  // ← ซ่อน job ที่โอนครบแล้ว
    // คนโอนยึด ขนาด → ลูกค้า → เครื่อง เป็นหลัก
    .sort((a, b) =>
      (a.size || '').localeCompare(b.size || '') ||
      (a.customer || '').localeCompare(b.customer || '') ||
      (a.machine_no || '').localeCompare(b.machine_no || ''))

  const filtered = rolls.filter(r => {
    if (!showDone && r.transferred) return false
    if (machine && machine !== '__ALL__' && r.machine_no !== machine) return false
    if (lotNo && r.lot_no !== lotNo) return false
    if (woFilter && (r.work_order ?? '') !== woFilter) return false
    if (search) {
      const q = search.toLowerCase()
      const w = (r.width_cm ?? '').toString().trim(), t = (r.thick_mc ?? '').toString().trim()
      const blob = `${r.roll_no} ${r.remark ?? ''} ${r.product_name ?? ''} ${r.customer ?? ''} ${r.work_order ?? ''} ${r.sale_order ?? ''} ${r.lot_no ?? ''} ${w}x${t} ${w}*${t} ${w} ${t}`.toLowerCase()
      if (!blob.includes(q)) return false
    }
    return true
  }).sort((a, b) => {
    // เรียงม้วนน้อย→มาก (ม้วน #1 บนสุด); ตัวรอง = เวลาชั่ง
    const ra = a.roll_no ?? 0, rb = b.roll_no ?? 0
    if (ra !== rb) return ra - rb
    return new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime()
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
    const unit = typeFilter === 'scrap' ? 'ถุง' : 'ม้วน'
    const typeLabel = typeFilter === 'good' ? 'ม้วนดี (FG)' : typeFilter === 'bad' ? 'ม้วนกรอ' : 'เศษเสีย'
    const destLabel = typeFilter === 'bad' ? 'ไปแผนกกรอ' : 'เข้าคลัง'
    if (!confirm(`โอน ${typeLabel} ${selected.size} ${unit} รวม ${fmt(totalKg)} Kgs. ${destLabel}?\n\n(จะพิมพ์ใบโอนให้อัตโนมัติ)`)) return
    setSaving(true)
    try {
      const transferTime = new Date().toISOString()
      const docNo        = `TR-${Date.now().toString().slice(-8)}`

      // รวบรวม machine_no / product_name / lot_no จากม้วนที่เลือก
      const machines    = [...new Set(selectedRolls.map(r => r.machine_no).filter(Boolean))]
      const products    = [...new Set(selectedRolls.map(r => r.product_name).filter(Boolean))]
      const lots        = [...new Set(selectedRolls.map(r => r.lot_no).filter(Boolean))]
      const wos         = [...new Set(selectedRolls.map(r => r.work_order).filter(Boolean))]
      const sos         = [...new Set(selectedRolls.map(r => r.sale_order).filter(Boolean))]
      const custs       = [...new Set(selectedRolls.map(r => r.customer).filter(Boolean))]
      const sz          = (() => { const s = selectedRolls[0]; return s?.width_cm && s?.thick_mc ? `${s.width_cm}${s.width_unit ?? 'cm'}×${s.thick_mc}mc` : '' })()

      // 1. สร้าง transfer_document
      const { data: doc, error: docErr } = await supabase.from('transfer_documents').insert({
        doc_no:         docNo,
        transferred_by: staff,
        transferred_at: transferTime,
        total_kg:       parseFloat(totalKg.toFixed(2)),
        total_rolls:    selected.size,
        machine_no:     machines.join(', '),
        product_name:   products.join(', '),
        lot_no:         lots.join(', '),
        work_order:     wos.join(', '),
        sale_order:     sos.join(', '),
        customer:       custs.join(', '),
        size:           sz,
        transfer_type:  typeFilter, // good | bad | scrap
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
      await Promise.all([loadRolls(), loadDocs(), loadPendingCounts()])

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
      .order('work_order', { ascending: true })
      .order('roll_no', { ascending: true })
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
    if (!confirm('ยกเลิกการโอนรายการนี้?')) return
    // เคลียร์ transfer_doc_id ด้วย — ป้องกัน reprint ใบเก่าแสดงม้วนที่ถูกยกเลิกแล้ว
    await supabase.from('production_rolls')
      .update({ transferred: false, transferred_at: null, transferred_by: null, transfer_doc_id: null })
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
              <Package size={22} className="text-brand-400" /> {typeFilter==='scrap'?'โอนเศษเสียเข้าคลัง':typeFilter==='bad'?'โอนม้วนกรอไปแผนกกรอ':'โอนม้วนเข้าคลัง'}
            </h1>
            <p className="text-slate-400 text-xs mt-0.5">{typeFilter==='bad'?'เจ้าหน้าที่เลือกม้วนกรอที่ผลิตเสร็จแล้ว โอนไปแผนกกรอ':`เจ้าหน้าที่เลือก${typeFilter==='scrap'?'ถุงเศษ':'ม้วน'}ที่ผลิตเสร็จแล้วโอนเข้าคลัง`}</p>
          </div>
          <button onClick={() => { loadRolls(); loadDocs() }} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg">
            <RefreshCw size={12}/> รีเฟรช
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-3 flex-wrap">
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

          {/* ── เลือกประเภทม้วนที่จะโอน — เฉพาะ tab transfer ── */}
          {tab === 'transfer' && (
            <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1 w-fit">
              {([
                { key:'good',  label:'✅ ม้วนดี (FG)', color:'bg-brand-600',  unit:'ม้วน' },
                { key:'bad',   label:'🔄 ม้วนกรอ',     color:'bg-orange-600', unit:'ม้วน' },
                { key:'scrap', label:'🗑 เศษเสีย',     color:'bg-red-600',    unit:'ถุง' },
              ] as const).map(t => {
                const n = pendingCounts[t.key]
                const isActive = typeFilter === t.key
                return (
                  <button key={t.key} onClick={() => { setTypeFilter(t.key); setSelected(new Set()) }}
                    className={`relative px-3.5 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                      isActive ? `${t.color} text-white` : 'text-slate-400 hover:text-white'
                    }`}>
                    <span>{t.label}</span>
                    {n > 0 && (
                      <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full animate-pulse ${
                        isActive ? 'bg-white/30 text-white' : 'bg-red-500 text-white'
                      }`} title={`มี ${n} ${t.unit}ที่ยังไม่โอน`}>
                        {n}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {tab === 'history' ? (
          <div className="flex gap-4">

            {/* ── รายการใบโอน — จัดกลุ่มตาม Machine + Lot ── */}
            <div className={`bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex-shrink-0 ${selectedDoc ? 'w-96' : 'flex-1'}`}>
              {(() => {
                const q = docSearch.trim().toLowerCase()
                const matchType = (d: any) => docType === 'all'
                  ? true
                  : docType === 'scrap' ? String(d.transfer_type ?? '').startsWith('scrap')
                  : (d.transfer_type ?? 'good') === docType
                const fdocs = docs.filter(d => matchType(d) && (!q ||
                  `${d.doc_no ?? ''} ${d.product_name ?? ''} ${d.customer ?? ''} ${d.size ?? ''} ${d.work_order ?? ''} ${d.sale_order ?? ''} ${d.lot_no ?? ''} ${d.machine_no ?? ''} ${d.transferred_by ?? ''} ${d.transfer_type ?? ''}`.toLowerCase().includes(q)))
                const cnt = (t: 'good'|'bad'|'scrap') => docs.filter(d => t==='scrap' ? String(d.transfer_type??'').startsWith('scrap') : (d.transfer_type??'good')===t).length
                return (<>
              <div className="px-4 py-3 border-b border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-white font-semibold text-sm">📦 ประวัติการโอน — จัดตามงาน</p>
                  <p className="text-slate-500 text-[10px]">{fdocs.length}{(q||docType!=='all') && `/${docs.length}`} ใบ · {fmt(fdocs.reduce((s,d)=>s+(d.total_kg??0),0))} Kgs.</p>
                </div>
                {/* กรองประเภท */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {([
                    ['all',`ทั้งหมด (${docs.length})`,'bg-slate-700 text-white'],
                    ['good',`✅ ม้วนดี (${cnt('good')})`,'bg-blue-500/25 text-blue-200'],
                    ['bad',`🔄 กรอ (${cnt('bad')})`,'bg-orange-500/25 text-orange-200'],
                    ['scrap',`🗑 เศษ (${cnt('scrap')})`,'bg-red-500/25 text-red-200'],
                  ] as const).map(([k,label,cls]) => (
                    <button key={k} onClick={()=>setDocType(k as any)}
                      className={`text-[11px] font-bold px-2.5 py-1 rounded-lg transition-all ${docType===k ? cls+' ring-1 ring-white/30' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"/>
                  <input value={docSearch} onChange={e => setDocSearch(e.target.value)}
                    placeholder="ค้นหา: เลขใบ / สินค้า / ลูกค้า / ขนาด / WO / SO / Lot / เครื่อง / ผู้โอน..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-8 py-1.5 text-xs text-white outline-none focus:border-brand-500"/>
                  {docSearch && <button onClick={()=>setDocSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-xs">✕</button>}
                </div>
              </div>
              {fdocs.length === 0 ? (
                <div className="py-16 text-center text-slate-600 text-sm">{(q||docType!=='all') ? 'ไม่พบใบโอนที่ตรงเงื่อนไข' : 'ยังไม่มีการโอน'}</div>
              ) : (
                <div className="max-h-[70vh] overflow-y-auto divide-y divide-slate-800/50">
                  {[...fdocs].sort((a,b)=>(b.transferred_at||'').localeCompare(a.transferred_at||'')).map(d => {
                    const isSel = selectedDoc?.id === d.id
                    const tt = d.transfer_type ?? 'good'
                    const typeBadge = tt==='bad'?'bg-orange-500/20 text-orange-300':tt==='scrap'?'bg-red-500/20 text-red-300':'bg-blue-500/20 text-blue-300'
                    const typeLbl = tt==='bad'?'🔄 กรอ':tt==='scrap'?'🗑 เศษ':'✅ FG'
                    const unit = tt==='scrap'?'ถุง':'ม้วน'
                    const dt = d.transferred_at ? new Date(d.transferred_at) : null
                    return (
                      <button key={d.id} onClick={()=>openDoc(d)}
                        className={`w-full text-left px-4 py-3 transition-colors border-l-4 ${isSel?'bg-brand-600/20 border-brand-500':'border-transparent hover:bg-slate-800/40'}`}>
                        {/* แถวบน: ขนาด (เด่นสุด) + ประเภท + น้ำหนัก */}
                        <div className="flex items-center gap-1.5 mb-1">
                          {d.size
                            ? <span className="text-sm font-black bg-brand-500/25 text-brand-100 px-2 py-0.5 rounded">{d.size}</span>
                            : <span className="text-[10px] text-slate-600">ไม่ระบุขนาด</span>}
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${typeBadge}`}>{typeLbl}</span>
                          <span className="ml-auto text-green-300 font-black text-sm">{fmt(d.total_kg)} <span className="text-[10px] text-slate-500 font-normal">Kg · {d.total_rolls} {unit}</span></span>
                        </div>
                        {/* ลูกค้า (เด่นรอง) */}
                        {d.customer && <p className="text-white text-xs font-bold truncate">👥 {d.customer}</p>}
                        <p className="text-slate-400 text-[10px] mt-0.5 truncate">{d.product_name||'—'}</p>
                        <div className="flex items-center gap-1.5 flex-wrap text-[10px] mt-1">
                          {d.work_order && <span className="bg-amber-500/15 text-amber-300 px-1.5 py-0.5 rounded font-bold">WO {d.work_order}</span>}
                          {d.sale_order && <span className="bg-blue-500/15 text-blue-300 px-1.5 py-0.5 rounded font-bold">SO {d.sale_order}</span>}
                          <span className="font-mono text-slate-500">Lot {d.lot_no}</span>
                        </div>
                        <p className="text-slate-600 text-[10px] mt-1">📄 {d.doc_no} · 🕐 {dt?dt.toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'})+' '+dt.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}):'—'} · โดย {d.transferred_by||'—'}</p>
                      </button>
                    )
                  })}
                </div>
              )}
                </>)
              })()}
            </div>

            {/* ── Drill-down panel (right) ── */}
            {selectedDoc && (
              <div className="flex-1 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col">
                {/* panel header */}
                <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between bg-brand-600/10">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      {selectedDoc.size && <span className="text-sm font-black bg-brand-500/25 text-brand-100 px-2 py-0.5 rounded">{selectedDoc.size}</span>}
                      {selectedDoc.customer && <span className="text-white font-bold text-sm truncate">👥 {selectedDoc.customer}</span>}
                    </div>
                    {selectedDoc.product_name && <p className="text-slate-300 text-xs truncate">{selectedDoc.product_name}</p>}
                    <p className="text-slate-500 text-[11px] mt-0.5">
                      📄 <span className="text-brand-300 font-mono">{selectedDoc.doc_no}</span> · {new Date(selectedDoc.transferred_at).toLocaleDateString('th-TH')} · {fmtTime(selectedDoc.transferred_at)} · โดย <b className="text-slate-300">{selectedDoc.transferred_by}</b>
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
                {!docLoading && docRolls.length > 0 && (() => { const u = selectedDoc?.transfer_type === 'scrap' ? 'ถุง' : 'ม้วน'; return (
                  <div className="grid grid-cols-3 gap-3 px-5 py-3 border-b border-slate-800 bg-slate-800/20">
                    {[
                      { label:`จำนวน${u}`, value: `${docRolls.length} ${u}`, color:'text-brand-300' },
                      { label:'น้ำหนักรวม', value: `${fmt(docRolls.reduce((s,r)=>s+(r.weight??0),0))} Kgs.`, color:'text-green-300' },
                      { label:'เครื่องที่โอน', value: Array.from(new Set(docRolls.map(r=>r.machine_no).filter(Boolean))).join(', ') || '—', color:'text-amber-300' },
                    ].map(k => (
                      <div key={k.label}>
                        <p className="text-slate-500 text-[10px]">{k.label}</p>
                        <p className={`font-black text-sm ${k.color}`}>{k.value}</p>
                      </div>
                    ))}
                  </div>
                ) })()}

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
                          {['ลำดับ','เครื่อง', selectedDoc?.transfer_type === 'scrap' ? 'ถุงที่' : 'ม้วนที่','สินค้า','Lot','นน.เต็ม','นน.สุทธิ','ผู้ตรวจ','เวลาชั่ง'].map(h=>(
                            <th key={h} className="px-3 py-2 text-left text-slate-500 font-semibold uppercase tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {docRolls.map((r, i) => {
                          const prevWo = i > 0 ? (docRolls[i-1].work_order ?? '') : null
                          const curWo = r.work_order ?? ''
                          const showWoHeader = curWo !== prevWo
                          const woRolls = docRolls.filter(x => (x.work_order ?? '') === curWo)
                          const ws = woRolls[0] ?? r
                          const woSize = ws.width_cm && ws.thick_mc ? `${ws.width_cm}${ws.width_unit ?? 'cm'}×${ws.thick_mc}mc` : ''
                          return (
                          <Fragment key={r.id}>
                          {showWoHeader && (
                            <tr className="bg-amber-500/10 border-y border-amber-500/20">
                              <td colSpan={9} className="px-3 py-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[11px] font-black bg-amber-500/25 text-amber-200 px-2 py-0.5 rounded">📋 WO {curWo || '(ไม่ระบุ)'}</span>
                                  {ws.sale_order && <span className="text-[11px] font-bold bg-blue-500/20 text-blue-200 px-2 py-0.5 rounded">SO {ws.sale_order}</span>}
                                  {woSize && <span className="text-[11px] font-black bg-brand-500/25 text-brand-100 px-2 py-0.5 rounded">{woSize}</span>}
                                  <span className="text-xs text-slate-200 font-semibold">{ws.customer || '—'}</span>
                                  <span className="text-slate-400 text-xs">· {ws.product_name || ''}</span>
                                  <span className="ml-auto text-[11px] text-slate-300">{woRolls.length} ม้วน · <b className="text-green-300">{fmt(woRolls.reduce((s,x)=>s+(x.weight??0),0))}</b> Kgs.</span>
                                </div>
                              </td>
                            </tr>
                          )}
                          <tr className="hover:bg-slate-800/30">
                            <td className="px-3 py-2.5 text-slate-600 text-xs">{i+1}</td>
                            <td className="px-3 py-2.5"><span className="text-[10px] bg-brand-500/20 text-brand-300 font-bold px-1.5 py-0.5 rounded">{r.machine_no||'?'}</span></td>
                            <td className="px-3 py-2.5 text-white font-mono font-bold">{String(r.roll_type).startsWith('scrap') ? 'ถุงเศษ' : `#${r.roll_no}`}</td>
                            <td className="px-3 py-2.5 text-slate-400 text-xs max-w-[160px] truncate">{r.product_name||'—'}</td>
                            <td className="px-3 py-2.5 text-slate-500 text-xs">{r.lot_no||'—'}</td>
                            <td className="px-3 py-2.5 text-slate-300">{fmt((r.weight??0)+(r.core_weight??0))}</td>
                            <td className="px-3 py-2.5 text-green-300 font-black">{fmt(r.weight)}</td>
                            <td className="px-3 py-2.5 text-slate-400 text-xs">{r.inspector||'—'}</td>
                            <td className="px-3 py-2.5 text-slate-500 text-xs">{new Date(r.created_at).toLocaleString('th-TH',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
                          </tr>
                          </Fragment>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-slate-700 bg-green-500/5">
                          <td colSpan={5} className="px-3 py-3 text-slate-300 font-semibold text-xs">รวม {docRolls.length} {selectedDoc?.transfer_type === 'scrap' ? 'ถุง' : 'ม้วน'}</td>
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
        <div className="space-y-4">

          {/* ══ Step 1 + 2 (เลือกงาน) — โชว์เป็นกริด คลิกเข้าดูรายละเอียด ══ */}
          <div className="space-y-3">

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

            {/* Step 2 — เลือกงาน (กริด · คลิกเข้าดูรายละเอียด) */}
            {!machine && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-black bg-brand-600 text-white">2</span>
                  เลือกงาน — คลิกเพื่อดูม้วน (เรียงตาม ขนาด · ลูกค้า · เครื่อง)
                </p>
                <button onClick={() => { setMachine('__ALL__'); setLotNo(''); setWoFilter(''); setSelected(new Set()) }}
                  className="text-xs font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 rounded-lg">
                  📋 ดูทุกงานรวม ({rolls.filter(r=>!r.transferred).length} {typeFilter==='scrap'?'ถุง':'ม้วน'})
                </button>
              </div>
              {loading ? <p className="text-slate-600 text-xs">กำลังโหลด...</p> : jobs.length === 0 ? (
                <p className="text-slate-600 text-sm py-2">ยังไม่มีงานวันนี้</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                  {/* แต่ละงาน */}
                  {jobs.map(j => {
                    const isSel      = machine === j.machine_no && lotNo === j.lot_no && woFilter === (j.work_order ?? '')
                    const curLot     = machineProfiles[j.machine_no] ?? ''
                    const isRunning  = curLot === `${j.lot_no}__${j.work_order ?? ''}`  // เครื่องยังเดินงานนี้ (Lot+WO) อยู่
                    return (
                      <button key={`${j.machine_no}-${j.lot_no}-${j.work_order}`}
                        onClick={() => { setMachine(j.machine_no); setLotNo(j.lot_no); setWoFilter(j.work_order ?? ''); setSelected(new Set()) }}
                        className={`w-full text-left p-3 rounded-xl border transition-all ${isSel ? 'border-brand-500 bg-brand-500/15' : 'border-slate-700 hover:border-slate-500 hover:bg-slate-800/50'}`}>
                        {/* แถวบน: ขนาด (เด่นสุด) + เครื่อง + สถานะ */}
                        <div className="flex items-center gap-1.5 mb-1">
                          {(j as any).size
                            ? <span className="text-sm font-black bg-brand-500/25 text-brand-100 px-2 py-0.5 rounded">{(j as any).size}</span>
                            : <span className="text-[10px] text-slate-600">ไม่ระบุขนาด</span>}
                          <span className="bg-brand-600 text-white font-black text-[10px] px-1.5 py-0.5 rounded">{j.machine_no}</span>
                          <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-bold ${
                            isRunning
                              ? 'bg-green-500/20 text-green-400 animate-pulse'
                              : 'bg-slate-700 text-slate-400'
                          }`}>
                            {isRunning ? '● เดิน' : '■ จบ'}
                          </span>
                        </div>
                        {/* ลูกค้า (เด่นรอง) */}
                        <p className="text-white text-xs font-bold leading-tight truncate">👥 {j.customer || '—'}</p>
                        <p className="text-slate-400 text-[10px] mt-0.5 truncate">{j.product || '—'}</p>
                        <div className="flex items-center gap-1 flex-wrap text-[9px] mt-0.5">
                          {j.work_order && <span className="bg-amber-500/15 text-amber-300 px-1 py-0.5 rounded font-bold">WO {j.work_order}</span>}
                          {(j as any).so && <span className="bg-blue-500/15 text-blue-300 px-1 py-0.5 rounded font-bold">SO {(j as any).so}</span>}
                          <span className="text-slate-600 font-mono">Lot {String(j.lot_no).slice(-8)}</span>
                        </div>
                        {(j as any).start && <p className="text-slate-600 text-[9px] mt-0.5">🕐 {new Date((j as any).start).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit'})} {new Date((j as any).start).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})} → {new Date((j as any).end).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit'})} {new Date((j as any).end).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})}</p>}
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-bold">รอโอน {j.pending} {typeFilter==='scrap'?'ถุง':'ม้วน'}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            )}

          </div>

          {/* ══ Step 3 รายการม้วน — โชว์เมื่อคลิกงานแล้ว ══════════════════ */}
          {machine && (
          <div className="space-y-3">

            {/* ปุ่มกลับ */}
            <button onClick={() => { setMachine(''); setLotNo(''); setWoFilter(''); setSelected(new Set()) }}
              className="flex items-center gap-1.5 text-sm font-bold text-brand-300 hover:text-brand-200 bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-xl">
              ← กลับไปเลือกงาน
            </button>

            {/* Step 3 header */}
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-black bg-brand-600 text-white">3</span>
                เลือก{typeFilter==='scrap'?'ถุงเศษ':'ม้วน'}ที่จะโอน
                {machine && machine !== '__ALL__'
                  ? <span className="text-brand-300 normal-case font-normal">— เครื่อง {machine}</span>
                  : <span className="text-brand-300 normal-case font-normal">— ทุกงานรวม</span>}
              </p>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
                  <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} className="w-3.5 h-3.5 accent-brand-500"/>
                  แสดงที่โอนแล้ว
                </label>
                <div className="relative">
                  <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"/>
                  <input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder={`ค้นหา${typeFilter==='scrap'?'ถุง':'ม้วน'}...`}
                    className="bg-slate-800 border border-slate-700 rounded-lg pl-7 pr-3 py-1.5 text-xs text-white outline-none focus:border-brand-500 w-36"/>
                </div>
              </div>
            </div>

            {/* Summary strip */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-amber-400 text-[10px] uppercase tracking-wider">รอโอน</p>
                  <p className="text-xl font-black text-amber-300">{pendingCount} <span className="text-xs font-normal text-slate-400">{typeFilter==='scrap'?'ถุง':'ม้วน'}</span></p>
                </div>
                <Wind size={18} className="text-amber-500/40"/>
              </div>
              <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-green-400 text-[10px] uppercase tracking-wider">โอนแล้ว</p>
                  <p className="text-xl font-black text-green-300">{doneCount} <span className="text-xs font-normal text-slate-400">{typeFilter==='scrap'?'ถุง':'ม้วน'}</span></p>
                </div>
                <CheckCircle2 size={18} className="text-green-500/40"/>
              </div>
              <div className={`border rounded-xl px-4 py-2.5 flex items-center justify-between transition-all ${selected.size > 0 ? 'bg-brand-500/20 border-brand-500/50' : 'bg-slate-800/40 border-slate-700'}`}>
                <div>
                  <p className="text-brand-400 text-[10px] uppercase tracking-wider">เลือกอยู่</p>
                  <p className="text-xl font-black text-brand-300">{selected.size} <span className="text-xs font-normal text-slate-400">{typeFilter==='scrap'?'ถุง':'ม้วน'}</span></p>
                  {selected.size > 0 && <p className="text-brand-400 text-[10px]">{fmt(totalKg)} Kgs.</p>}
                </div>
                <Package size={18} className="text-brand-500/40"/>
              </div>
            </div>

            {/* Confirm bar — ปรากฏเมื่อเลือกแล้ว */}
            {selected.size > 0 && (
              <div className="rounded-2xl border border-brand-500/40 bg-brand-500/10 px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="text-white font-bold">โอน {selected.size} {typeFilter==='scrap'?'ถุง':'ม้วน'} · <span className="text-brand-300">{fmt(totalKg)} Kgs.</span></p>
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
                    {saving ? 'กำลังโอน...' : typeFilter==='bad' ? 'ยืนยันโอนไปกรอ' : 'ยืนยันโอนเข้าคลัง'}
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
                    เลือกทั้งหมด ({filtered.filter(r=>!r.transferred).length} {typeFilter==='scrap'?'ถุง':'ม้วน'})
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
                  <p className="text-slate-600 text-xs mt-1">ไม่มี{typeFilter==='scrap'?'ถุงเศษ':'ม้วน'}รอโอนในงานนี้</p>
                </div>
              ) : (() => {
                // จัดกลุ่มม้วนตามงาน: เครื่อง + Lot + WO (กัน 2 งานปนกันในลิสต์เดียว)
                const gmap = new Map<string, any[]>()
                for (const r of filtered) {
                  const k = `${r.machine_no ?? '?'}__${r.lot_no ?? '?'}__${r.work_order ?? ''}`
                  if (!gmap.has(k)) gmap.set(k, [])
                  gmap.get(k)!.push(r)
                }
                const grps = [...gmap.entries()].map(([key, items]) => {
                  const s = items[0]
                  const dates = items.map(r => r.created_at).filter(Boolean).sort()
                  return {
                    key, items,
                    machine: s.machine_no, lot: s.lot_no, wo: s.work_order ?? '', so: s.sale_order ?? '',
                    product: items.find(x=>x.product_name)?.product_name ?? '—',
                    customer: items.find(x=>x.customer)?.customer ?? '',
                    size: s.width_cm && s.thick_mc ? `${s.width_cm}${s.width_unit ?? 'cm'}×${s.thick_mc}mc` : '',
                    start: dates[0] ?? '', end: dates[dates.length-1] ?? '',
                    pendingIds: items.filter(x=>!x.transferred).map(x=>x.id),
                    totalKg: items.reduce((a,x)=>a+(x.weight??0),0),
                  }
                }).sort((a,b)=>
                  (a.size||'').localeCompare(b.size||'') ||
                  (a.customer||'').localeCompare(b.customer||'') ||
                  (a.machine||'').localeCompare(b.machine||'') ||
                  (a.lot||'').localeCompare(b.lot||''))

                return (
                <div className="divide-y divide-slate-800/60">
                  {grps.map(g => {
                    const open = openGroups[g.key] ?? true
                    const allSel = g.pendingIds.length > 0 && g.pendingIds.every(id => selected.has(id))
                    return (
                    <div key={g.key} className="bg-slate-900">
                      {/* ── หัวงาน ── */}
                      <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-800/30 border-l-4 border-brand-500">
                        {g.pendingIds.length > 0 && (
                          <input type="checkbox" checked={allSel} title="เลือกทั้งงาน"
                            onChange={e => setSelected(prev => { const n = new Set(prev); g.pendingIds.forEach(id => e.target.checked ? n.add(id) : n.delete(id)); return n })}
                            className="w-4 h-4 accent-brand-500 shrink-0"/>
                        )}
                        {g.size
                          ? <span className="text-base font-black px-2.5 py-1 rounded-lg bg-brand-500/25 text-brand-100 shrink-0">{g.size}</span>
                          : <span className="text-[10px] px-2 py-1 rounded-lg bg-slate-800 text-slate-600 shrink-0">ไม่ระบุขนาด</span>}
                        <span className="text-xs font-black px-2 py-1 rounded-lg bg-brand-600 text-white shrink-0">{g.machine || '?'}</span>
                        <button onClick={() => setOpenGroups(p => ({ ...p, [g.key]: !open }))} className="flex-1 min-w-0 text-left">
                          <p className="text-white font-bold text-sm truncate flex items-center gap-1.5">
                            <span className="text-brand-400">{open ? '▼' : '▶'}</span>
                            👥 {g.customer || '—'}
                          </p>
                          <div className="flex items-center gap-1.5 flex-wrap text-[10px] mt-0.5 pl-4">
                            <span className="text-slate-400 truncate max-w-[180px]">{g.product}</span>
                            {g.wo && <span className="bg-amber-500/15 text-amber-300 px-1.5 py-0.5 rounded font-bold">WO {g.wo}</span>}
                            {g.so && <span className="bg-blue-500/15 text-blue-300 px-1.5 py-0.5 rounded font-bold">SO {g.so}</span>}
                            <span className="font-mono text-slate-500">Lot {g.lot}</span>
                            {g.start && <span className="text-slate-600">· 🕐 {fmtTime(g.start)}{g.end && g.end!==g.start ? `–${fmtTime(g.end)}` : ''}</span>}
                          </div>
                        </button>
                        <div className="text-right shrink-0">
                          <p className="text-brand-300 font-black text-sm leading-none">{fmt(g.totalKg)} <span className="text-[10px] text-slate-500 font-normal">Kg</span></p>
                          <p className="text-[10px] text-slate-500">{g.pendingIds.length} รอโอน / {g.items.length} ม้วน</p>
                        </div>
                      </div>

                      {/* ── ม้วนในงาน ── */}
                      {open && g.items.map(r => {
                    const isSel  = selected.has(r.id)
                    const isDone = r.transferred
                    return (
                      <div key={r.id} onClick={() => !isDone && toggleOne(r.id)}
                        className={`flex items-center gap-3 pl-8 pr-4 py-2.5 transition-colors ${
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

                        {/* Roll info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className={`font-mono font-black text-base ${isDone ? 'text-slate-500' : 'text-white'}`}>{String(r.roll_type).startsWith('scrap') ? 'ถุงเศษ' : `ม้วน #${r.roll_no}`}</span>
                            {isDone && <span className="text-[10px] text-green-400">✓ โอนแล้ว {r.transferred_by && `· ${r.transferred_by}`}</span>}
                          </div>
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
                    )
                  })}
                </div>
                )
              })()}
            </div>

          </div>
          )}
        </div>
        )}
      </div>
    </div>
  )
}
