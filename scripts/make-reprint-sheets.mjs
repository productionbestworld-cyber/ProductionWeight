// ───────────────────────────────────────────────────────────────────────────
//  สร้างไฟล์ "ใบสติกเกอร์รีปริ้น" ต่อเครื่อง (HTML พร้อมปริ้น) — ใบดี/กรอ
//  ใช้ layout จริงจาก DB (label_layouts) + QR (qrcode) → ฟอร์มตรงกับที่แอปพิมพ์
//    node scripts/make-reprint-sheets.mjs "<backup_rows.json>"
//  เศษ (waste) ไม่รวมในไฟล์นี้ (ใบคนละฟอร์ม) — ปริ้นจากแอปถ้าต้องการ
// ───────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import QRCode from 'qrcode'

const APP_URL = 'https://production-weight.vercel.app/'
const url = 'https://belwjdajuaxbhaqtlhrj.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbHdqZGFqdWF4YmhhcXRsaHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzgzNzYsImV4cCI6MjA5NDM1NDM3Nn0.aM-DKa8v0OlQQW6MsDzmCrEFY0d8rEVgzuemZ8UKZJA'
const sb = createClient(url, key)

const backupFile = process.argv[2] || 'D:/back upเครื่องชั่ง supabase/lot-fix_2026-07-01_0940/backup_rows.json'
const ids = JSON.parse(readFileSync(backupFile, 'utf8')).map(r => r.id)

// ── helpers (ตรงกับในแอป) ──
const fmt = (n, d = 2) => Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
function thaiDate(d) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d)
  const g = t => p.find(x => x.type === t)?.value ?? ''
  return `${g('day')}/${g('month')}/${parseInt(g('year')) + 543}`
}

// ── โหลด layout + machine_profiles + ม้วนปัจจุบัน ──
const layoutRows = await sb.from('label_layouts').select('id,layout').then(r => r.data ?? [])
const LAYOUT = Object.fromEntries(layoutRows.map(r => [r.id, r.layout]))
const mps = (await sb.from('machine_profiles').select('*').then(r => r.data ?? []))
const MP = Object.fromEntries(mps.map(m => [m.machine_no, m]))

const rolls = []
for (let i = 0; i < ids.length; i += 200) {
  const { data } = await sb.from('production_rolls').select('*').in('id', ids.slice(i, i + 200))
  rolls.push(...(data ?? []))
}

// ── renderer (คัดลอกจาก WeighStation) ──
function makeRenderer(dataMap, qr) {
  return f => {
    if (!f.visible) return ''
    if (f.type === 'separator') {
      if (f.h > f.w) return `<div style="position:absolute;left:${f.x}mm;top:${f.y}mm;width:0;height:${f.h}mm;border-left:1px solid #000;box-sizing:border-box"></div>`
      return `<div style="position:absolute;left:${f.x}mm;top:${f.y}mm;width:${f.w}mm;height:0;border-top:1px solid #000;box-sizing:border-box"></div>`
    }
    if (f.type === 'qr') {
      const px = Math.round(f.h * 3.78)
      return `<img src="${qr}" width="${px}" height="${px}" style="position:absolute;left:${f.x}mm;top:${f.y}mm;width:${f.w}mm;height:${f.h}mm;image-rendering:pixelated"/>`
    }
    const value = dataMap[f.id] ?? f.sampleValue ?? ''
    const border = f.border ? 'border:1px solid #000;' : ''
    const justify = f.align === 'center' ? 'justify-content:center;' : f.align === 'right' ? 'justify-content:flex-end;' : ''
    const italic = f.italic ? 'font-style:italic;' : ''
    if (f.type === 'weight') {
      return `<div style="position:absolute;left:${f.x}mm;top:${f.y}mm;width:${f.w}mm;height:${f.h}mm;${border}box-sizing:border-box;overflow:hidden;padding:0 1mm"><div style="font-size:7.5pt;font-weight:700;line-height:1.4">Net Weight</div><div style="font-size:${f.fontSize}pt;font-weight:900;line-height:1;color:#003087">${value}</div><div style="font-size:8pt;font-weight:700;line-height:1.3">Kgs.</div></div>`
    }
    return `<div style="position:absolute;left:${f.x}mm;top:${f.y}mm;width:${f.w}mm;height:${f.h}mm;font-size:${f.fontSize}pt;font-weight:${f.fontWeight};text-align:${f.align};${italic}${border}box-sizing:border-box;overflow:visible;display:flex;align-items:center;${justify}padding:0 0.5mm"><span style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.1;width:100%;word-break:break-word">${value}</span></div>`
  }
}

async function labelDiv(roll, mp, size) {
  const dec = Number.isFinite(mp?.decimal_places) ? mp.decimal_places : 2   // ทศนิยมตามที่ตั้งต่อเครื่อง (BL02/BL04 = 1)
  const base = new Date(roll.created_at)
  const mfgDate = thaiDate(base)
  const custCode = (roll.cust_code ?? '').trim()
  const showExp = custCode === '08'
  const expDate = (() => { const d = new Date(base); d.setMonth(d.getMonth() + 6); return thaiDate(d) })()
  const core = parseFloat(roll.core_weight) || 0
  const rt = roll.roll_type ?? 'good'
  const rollNo = roll.roll_no ?? 0
  const gross = roll.gross_weight ?? 0, net = roll.weight ?? 0
  const reason = roll.remark ?? ''
  const headerText = (mp?.header_text ?? '').trim() || 'บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด'
  const widthUnit = roll.width_unit ?? 'cm'
  const rtLabel = rt === 'bad' ? 'ม้วนกรอ' : ''
  const rollLabel = rt === 'bad' ? 'กรอ No.' : 'Roll No.'
  const qr = await QRCode.toDataURL(`${APP_URL}?roll=${roll.id}`, { width: 144, margin: 1, errorCorrectionLevel: 'M' })

  const isShort = size === 'short'
  const layout = LAYOUT[isShort ? 'short' : 'long']
  const dataMap = isShort ? {
    header: (rt === 'bad'
      ? `<span style="font-size:0.9em">SO <b>${roll.sale_order || '—'}</b> · WO <b>${roll.work_order || '—'}</b> · รหัส <b>${roll.item_code || '—'}</b></span>${rtLabel ? ` [${rtLabel}]` : ''}${reason ? ` <span style="color:#c00">เหตุผล: ${reason}</span>` : ''}`
      : (mp?.blank_header ? '' : headerText) + (rtLabel ? ` [${rtLabel}]` : '')),
    mat: `Mat&nbsp;&nbsp;<b>${roll.mat_code ?? ''}</b>`,
    mfg: `MFG&nbsp;&nbsp;<b>${mfgDate}</b>`,
    rollno: `${rt === 'bad' ? 'กรอ' : 'Roll'}&nbsp;<b>${rollNo === 0 ? '—' : rollNo}</b>`,
    prodname: roll.product_name ?? '', prodcode: roll.product_code || '—', itemcode: roll.item_code || '—',
    size: `${roll.width_cm ?? ''} ${widthUnit} × ${roll.thick_mc ?? ''} mc`,
    lotno: roll.lot_no ?? '', length: `${roll.length || '—'} M.${roll.pcs ? ` · ${roll.pcs} Pcs.` : ''}`,
    machine: `เครื่อง&nbsp;&nbsp;<b>${roll.machine_no ?? ''}</b>`,
    core: `Core&nbsp;&nbsp;<b>${fmt(core, dec)}</b>&nbsp;Kg`, net: fmt(net, dec),
    gross: `Gross ${fmt(gross, dec)} Kgs.`, inspector: `ผู้ตรวจ: <b>${roll.inspector || '—'}</b>`,
  } : {
    header: (rt === 'bad'
      ? `<span style="font-size:0.9em">SO <b>${roll.sale_order || '—'}</b>&nbsp;&nbsp;·&nbsp;&nbsp;WO <b>${roll.work_order || '—'}</b>&nbsp;&nbsp;·&nbsp;&nbsp;รหัสสินค้า <b>${roll.item_code || '—'}</b></span>${rtLabel ? `&nbsp;&nbsp;[${rtLabel}]` : ''}${reason ? `&nbsp;&nbsp;<span style="color:#c00">เหตุผล: ${reason}</span>` : ''}`
      : headerText + (rtLabel ? `&nbsp;&nbsp;[${rtLabel}]` : '')),
    mat: `Mat Code&nbsp;&nbsp;<b style="font-size:1.15em">${roll.mat_code ?? ''}</b>`,
    mfg: `MFG Date&nbsp;&nbsp;<b style="font-size:1.15em">${mfgDate}</b>${showExp ? `&nbsp;&nbsp;&nbsp;EXP&nbsp;&nbsp;<b style="font-size:1.15em">${expDate}</b>` : ''}`,
    rollno: `${rollLabel}&nbsp;&nbsp;<b style="font-size:1.15em">${rollNo === 0 ? '—' : rollNo}</b>`,
    prodcode: roll.product_code ? `<span style="font-weight:400">Product Code</span>&nbsp;&nbsp;<b>${roll.product_code}</b>` : '',
    prodname: `<span style="font-weight:400">Product Name</span>&nbsp;&nbsp;<b>${roll.product_name ?? ''}</b>`,
    machine: `เครื่อง&nbsp;&nbsp;<b>${roll.machine_no ?? ''}</b>`,
    core: `Core Weight&nbsp;&nbsp;<b>${fmt(core, dec)}</b>`,
    size: `Size&nbsp;&nbsp;<b style="font-size:1.2em">${roll.width_cm ?? ''}</b>&nbsp;${widthUnit}&nbsp;×&nbsp;<b style="font-size:1.2em">${roll.thick_mc ?? ''}</b>&nbsp;mc`,
    lotno: `Lot No&nbsp;&nbsp;<b>${roll.lot_no ?? ''}</b>`,
    length: `Length&nbsp;&nbsp;<b>${roll.length || '—'}</b>&nbsp;M.${roll.pcs ? `&nbsp;&nbsp;<b>${roll.pcs}</b>&nbsp;Pcs.` : ''}`,
    gross: `Gross Weight&nbsp;&nbsp;<b>${fmt(gross, dec)} Kgs.</b>`, net: fmt(net, dec),
    barcode_lbl: 'Barcode No.', inspector: `ผู้ตรวจสอบ&nbsp;&nbsp;<b>${roll.inspector || '—'}</b>`,
  }
  const render = makeRenderer(dataMap, qr)
  const inner = layout.fields.map(render).join('\n')
  return { html: `<div class="page"><div style="position:relative;width:${layout.labelW}mm;height:${layout.labelH}mm;border:1.5px solid #000;overflow:hidden">${inner}</div></div>`, W: layout.labelW, H: layout.labelH }
}

// ── สร้างต่อเครื่อง (เฉพาะ ดี/กรอ) ──
const outDir = dirname(backupFile) + '/ใบรีปริ้นต่อเครื่อง'
mkdirSync(outDir, { recursive: true })
const byM = {}
for (const r of rolls) if (r.roll_type === 'good' || r.roll_type === 'bad') (byM[r.machine_no] ??= []).push(r)

const summary = []
for (const m of Object.keys(byM).sort()) {
  const mp = MP[m]
  const size = (mp?.label_size === 'short') ? 'short' : 'long'
  const list = byM[m].sort((a, b) => String(a.roll_type).localeCompare(String(b.roll_type)) || (a.roll_no ?? 0) - (b.roll_no ?? 0))
  const built = []
  for (const r of list) built.push(await labelDiv(r, mp, size))
  const { W, H } = built[0]
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>ใบรีปริ้น ${m}</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800;900&display=swap');
*{box-sizing:border-box;margin:0;padding:0}html,body{font-family:'Sarabun','Arial',sans-serif;color:#000;background:#fff}
@page{size:${W}mm ${H}mm;margin:0}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
.page{width:${W}mm;height:${H}mm;overflow:hidden;page-break-after:always}</style></head><body>
${built.map(b => b.html).join('\n')}</body></html>`
  writeFileSync(`${outDir}/${m}_labels.html`, html, 'utf8')
  summary.push({ m, n: list.length, size })
}
console.log(`✅ สร้างใบรีปริ้นเสร็จ → ${outDir}`)
summary.forEach(s => console.log(`   ${s.m}_labels.html  (${s.n} ใบ · ${s.size === 'short' ? 'ใบสั้น' : 'ใบยาว'})`))
