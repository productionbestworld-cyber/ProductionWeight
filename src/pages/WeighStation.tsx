import { useState, useEffect, useRef } from 'react'
import { Save, Printer, RefreshCw, CheckCircle2, ArrowLeft, Wind, X, Settings } from 'lucide-react'
import QRCode from 'react-qr-code'
import QRCodeLib from 'qrcode'
import { supabase } from '../lib/supabase'
import { loadProfiles, saveProfiles, fmtSize, convertWidth, type MachineProfile } from './MachineSettings'
import ReworkJobList from './ReworkJobList'
import { loadLongLayout, loadShortLayout, loadWasteLayout, type FieldConfig } from './LabelDesigner'
import { fetchProducts, backfillProductMatCore, backfillCustomer, addProductIfMissing, type Product } from './Products'
import { fetchFlag } from './Admin'
import ReworkInbox from './ReworkInbox'
import ExportButton from '../components/ExportButton'

function fmt(n: number | null | undefined, d: 1|2 = 2) {
  if (n === null || n === undefined || isNaN(n as number)) return (0).toFixed(d)
  return (n as number).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d })
}
function thaiDate() {
  const d = new Date()
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()+543}`
}
function barcodeUrl(text: string, h = 10) {
  return `https://bwipjs-api.metafloor.com/?bcid=code128&text=${encodeURIComponent(text||'0')}&scale=2&height=${h}&includetext`
}

// ── Print Label ───────────────────────────────────────────────────────────────
async function printLabel(p: MachineProfile, rollNo: number, gross: number, net: number, size: 'long'|'short' = 'long', rollType: string = 'good', reason = '', rollId?: string) {
  const dec     = p.decimal
  const mfgDate = thaiDate()
  // EXP date — เฉพาะลูกค้าหาดทิพย์ (cust_code 08): MFG + 6 เดือน
  const showExp = (p.custCode ?? '').trim() === '08'
  const expDate = (() => {
    const d = new Date(); d.setMonth(d.getMonth() + 6)
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()+543}`
  })()
  const core    = parseFloat(p.coreWeight) || 0
  // QR encode แค่ roll ID → URL สั้น → generate เป็น data URL ฝังใน HTML ทันที
  const appUrl    = window.location.origin
  const detailUrl = rollId ? `${appUrl}/?roll=${rollId}` : `${appUrl}/`

  // generate QR เป็น PNG data URL (ไม่ต้องพึ่ง internet)
  const makeQR = async (px: number) => {
    try {
      return await QRCodeLib.toDataURL(detailUrl, { width: px, margin: 1, errorCorrectionLevel: 'M' })
    } catch { return '' }
  }
  const [qr72, qr56] = await Promise.all([makeQR(144), makeQR(112)])
  const qrUrl = (s: 72|56) => s === 72 ? qr72 : qr56

  // ═══════════════════════════════════════════════════════
  // ใบยาว — สร้างจาก LabelDesigner layout (หรือ fallback default)
  // ═══════════════════════════════════════════════════════
  const savedLayout = await loadLongLayout()
  const rollTypeLabelLong =
    rollType === 'bad'         ? 'ม้วนกรอ' :
    rollType === 'scrap_clear' ? 'เศษเสีย (ใส)' :
    rollType === 'scrap_color' ? 'เศษเสีย (สี)' :
    rollType === 'scrap_lump'  ? 'เศษก้อน' : ''

  // ค่าจริงของแต่ละ field id → map จาก MachineProfile + น้ำหนัก
  const rollLabel = rollType.startsWith('scrap') ? 'ถุงเศษ' : rollType === 'bad' ? 'กรอ No.' : 'Roll No.'
  const longFieldData: Record<string, string> = {
    header:      (rollType === 'bad')
                 ? `<span style="font-size:0.9em">SO <b>${p.soNo || '—'}</b>&nbsp;&nbsp;·&nbsp;&nbsp;WO <b>${p.woNo || '—'}</b>&nbsp;&nbsp;·&nbsp;&nbsp;รหัสสินค้า <b>${p.itemCode || '—'}</b></span>` +
                   (rollTypeLabelLong ? `&nbsp;&nbsp;[${rollTypeLabelLong}]` : '') +
                   (rollType === 'bad' && reason ? `&nbsp;&nbsp;<span style="color:#c00">เหตุผล: ${reason}</span>` : '')
                 : (p.headerText?.trim() || 'บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด') +
                   (rollTypeLabelLong ? `&nbsp;&nbsp;[${rollTypeLabelLong}]` : ''),
    // 3-column header
    mat:         `Mat Code&nbsp;&nbsp;<b style="font-size:1.15em">${p.matCode}</b>`,
    mfg:         `MFG Date&nbsp;&nbsp;<b style="font-size:1.15em">${mfgDate}</b>${showExp ? `&nbsp;&nbsp;&nbsp;EXP&nbsp;&nbsp;<b style="font-size:1.15em">${expDate}</b>` : ''}`,
    rollno:      `${rollLabel}&nbsp;&nbsp;<b style="font-size:1.15em">${rollNo === 0 ? '—' : rollNo}</b>`,
    // left column
    prodcode:    p.productCode ? `<span style="font-weight:400">Product Code</span>&nbsp;&nbsp;<b>${p.productCode}</b>` : '',
    prodname:    `<span style="font-weight:400">Product Name</span>&nbsp;&nbsp;<b>${p.productName}</b>`,
    machine:     `เครื่อง&nbsp;&nbsp;<b>${p.machine_no}</b>`,
    core:        `Core Weight&nbsp;&nbsp;<b>${fmt(core, dec)}</b>`,
    size:        `Size&nbsp;&nbsp;<b style="font-size:1.2em">${p.widthCm}</b>&nbsp;${p.widthUnit ?? 'cm'}&nbsp;×&nbsp;<b style="font-size:1.2em">${p.thickMc}</b>&nbsp;mc`,
    // right column
    lotno:       `Lot No&nbsp;&nbsp;<b>${p.lotNo}</b>`,
    length:      `Length&nbsp;&nbsp;<b>${p.length || '—'}</b>&nbsp;M.${p.pcs ? `&nbsp;&nbsp;<b>${p.pcs}</b>&nbsp;Pcs.` : ''}`,
    gross:       `Gross Weight&nbsp;&nbsp;<b>${fmt(gross, dec)} Kgs.</b>`,
    net:         fmt(net, dec),
    barcode_lbl: 'Barcode No.',
    inspector:   `ผู้ตรวจสอบ&nbsp;&nbsp;<b>${p.inspector || '—'}</b>`,
    // old compat keys
    meta:        `Mat&nbsp;<b>${p.matCode}</b>&nbsp;&nbsp;&nbsp;MFG&nbsp;<b>${mfgDate}</b>&nbsp;&nbsp;&nbsp;Roll&nbsp;<b>${rollNo === 0 ? '—' : rollNo}</b>`,
  }

  // factory: สร้าง renderer จาก data map + qr size — ใช้ได้ทั้งใบยาว/ใบสั้น
  function makeFieldRenderer(dataMap: Record<string, string>, qrSize: 72|56) {
    return function renderField(f: FieldConfig): string {
      if (!f.visible) return ''

      // separator: ถ้า h > w → เส้นตั้ง, ถ้า h ≈ 0 → เส้นนอน
      if (f.type === 'separator') {
        if (f.h > f.w) {
          return `<div style="position:absolute;left:${f.x}mm;top:${f.y}mm;width:0;height:${f.h}mm;border-left:1px solid #000;box-sizing:border-box"></div>`
        }
        return `<div style="position:absolute;left:${f.x}mm;top:${f.y}mm;width:${f.w}mm;height:0;border-top:1px solid #000;box-sizing:border-box"></div>`
      }

      if (f.type === 'qr') {
        const px = Math.round(f.h * 3.78)
        return `<img src="${qrUrl(qrSize)}" width="${px}" height="${px}" style="position:absolute;left:${f.x}mm;top:${f.y}mm;width:${f.w}mm;height:${f.h}mm;image-rendering:pixelated"/>`
      }

      const value   = dataMap[f.id] ?? f.sampleValue
      const border  = f.border ? 'border:1px solid #000;' : ''
      const justify = f.align === 'center' ? 'justify-content:center;' : f.align === 'right' ? 'justify-content:flex-end;' : ''
      const italic  = f.italic ? 'font-style:italic;' : ''

      if (f.type === 'weight') {
        return `<div style="position:absolute;left:${f.x}mm;top:${f.y}mm;width:${f.w}mm;height:${f.h}mm;${border}box-sizing:border-box;overflow:hidden;padding:0 1mm">
          <div style="font-size:7.5pt;font-weight:700;line-height:1.4">Net Weight</div>
          <div style="font-size:${f.fontSize}pt;font-weight:900;line-height:1;color:#003087">${value}</div>
          <div style="font-size:8pt;font-weight:700;line-height:1.3">Kgs.</div>
        </div>`
      }

      // ข้อความยาวเกิน → ขึ้นบรรทัดที่ 2 (clamp 2 บรรทัด)
      return `<div style="position:absolute;left:${f.x}mm;top:${f.y}mm;width:${f.w}mm;height:${f.h}mm;font-size:${f.fontSize}pt;font-weight:${f.fontWeight};text-align:${f.align};${italic}${border}box-sizing:border-box;overflow:visible;display:flex;align-items:center;${justify}padding:0 0.5mm"><span style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.1;width:100%;word-break:break-word">${value}</span></div>`
    }
  }

  const renderLongField = makeFieldRenderer(longFieldData, 72)

  const longHtmlFromLayout = `
<style>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800;900&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
html,body{font-family:'Sarabun','Arial',sans-serif;color:#000;background:#fff;width:${savedLayout.labelW}mm;height:${savedLayout.labelH}mm}
@media print{@page{size:${savedLayout.labelW}mm ${savedLayout.labelH}mm;margin:0}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
<div style="position:relative;width:${savedLayout.labelW}mm;height:${savedLayout.labelH}mm;border:1.5px solid #000;overflow:hidden">
${savedLayout.fields.map(renderLongField).join('\n')}
</div>`

  // ═══════════════════════════════════════════════════════
  // ใบสั้น — สร้างจาก LabelDesigner layout (เหมือนใบยาว → ปริ้น=หน้าแก้ไข, แก้ไขได้)
  // ═══════════════════════════════════════════════════════
  const shortLayout  = await loadShortLayout()
  const shortHeader  = p.blankHeader ? '' : ((p.headerText || '').trim() || 'บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด')
  const rollWord     = rollType.startsWith('scrap') ? 'ถุง' : rollType === 'bad' ? 'กรอ' : 'Roll'
  const shortFieldData: Record<string, string> = {
    header:    (rollType === 'bad')
               ? `<span style="font-size:0.9em">SO <b>${p.soNo || '—'}</b> · WO <b>${p.woNo || '—'}</b> · รหัส <b>${p.itemCode || '—'}</b></span>${rollTypeLabelLong ? ` [${rollTypeLabelLong}]` : ''}${rollType === 'bad' && reason ? ` <span style="color:#c00">เหตุผล: ${reason}</span>` : ''}`
               : shortHeader + (rollTypeLabelLong ? `${shortHeader ? '&nbsp;' : ''}[${rollTypeLabelLong}]` : ''),
    mat:       `Mat&nbsp;&nbsp;<b>${p.matCode}</b>`,
    mfg:       `MFG&nbsp;&nbsp;<b>${mfgDate}</b>${showExp ? `&nbsp;&nbsp;EXP&nbsp;<b>${expDate}</b>` : ''}`,
    rollno:    `${rollWord}&nbsp;<b>${rollNo === 0 ? '—' : rollNo}</b>`,
    prodname:  p.productName,
    prodcode:  p.productCode || '—',
    itemcode:  p.itemCode || '—',
    size:      `${p.widthCm} ${p.widthUnit ?? 'cm'} × ${p.thickMc} mc`,
    lotno:     p.lotNo,
    length:    `${p.length || '—'} M.${p.pcs ? ` · ${p.pcs} Pcs.` : ''}`,
    machine:   `เครื่อง&nbsp;&nbsp;<b>${p.machine_no}</b>`,
    core:      `Core&nbsp;&nbsp;<b>${fmt(core, dec)}</b>&nbsp;Kg`,
    net:       fmt(net, dec),
    gross:     `Gross ${fmt(gross, dec)} Kgs.`,
    inspector: `ผู้ตรวจ: <b>${p.inspector || '—'}</b>`,
  }
  const renderShortField = makeFieldRenderer(shortFieldData, 56)
  const shortHtmlFromLayout = `
<style>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800;900&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
html,body{font-family:'Sarabun','Arial',sans-serif;color:#000;background:#fff;width:${shortLayout.labelW}mm;height:${shortLayout.labelH}mm}
@media print{@page{size:${shortLayout.labelW}mm ${shortLayout.labelH}mm;margin:0}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
<div style="position:relative;width:${shortLayout.labelW}mm;height:${shortLayout.labelH}mm;border:1.5px solid #000;overflow:hidden">
${shortLayout.fields.map(renderShortField).join('\n')}
</div>`


  // ═══════════════════════════════════════════════════════
  // ใบยาว 165 × 70 mm (fallback default — ไม่ถูกใช้แล้ว เก็บไว้เผื่อ)
  // ═══════════════════════════════════════════════════════
  const longHtml = `
<style>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
html,body{font-family:'Sarabun','Arial',sans-serif;color:#000;background:#fff;width:165mm;height:70mm}
.wrap{width:165mm;height:70mm;padding:.8mm 2mm;display:flex;flex-direction:column;border:2px solid #000;overflow:hidden}

/* ── Row 1: หัวกระดาษ ── */
.title{text-align:center;font-size:11pt;font-weight:700;border-bottom:2px solid #000;padding-bottom:.5mm;margin-bottom:.5mm;line-height:1.25;letter-spacing:.2px}

/* ── Row 2: Mat / MFG / Roll ── */
.hdr{display:flex;border-bottom:1px solid #000;padding-bottom:.4mm;margin-bottom:.4mm;align-items:center}
.hc{flex:1;font-size:7pt;color:#444}
.hc b{font-size:9.5pt;font-weight:700;color:#000;margin-left:.5mm}
.hc.mid{text-align:center;border-left:1px solid #bbb;border-right:1px solid #bbb;padding:0 2mm}
.hc.right{text-align:right}

/* ── Row 3: Product name + Size + Lot ── */
.prod-row{display:flex;align-items:baseline;border-bottom:1px solid #ddd;padding-bottom:.4mm;margin-bottom:.4mm;gap:1.5mm;flex-wrap:nowrap;overflow:hidden}
.pname{font-size:11pt;font-weight:800;white-space:nowrap;flex-shrink:0}
.pdot{color:#bbb;font-size:9pt;flex-shrink:0}
.psize{font-size:8.5pt;font-weight:700;white-space:nowrap;flex-shrink:0}
.plot{margin-left:auto;font-size:7.5pt;font-weight:700;white-space:nowrap;flex-shrink:0;color:#333}

/* ── Row 4-5: info rows ── */
.irow{display:flex;justify-content:space-between;font-size:7.5pt;padding:.25mm 0;border-bottom:.5px solid #eee}
.il{color:#444}
.il b{color:#000;font-weight:700}
.ir{color:#444;text-align:right}
.ir b{color:#000;font-weight:700}

/* ── Row 6: Weight + QR ── */
.wsec{flex:1;display:flex;border-top:2px solid #000;margin-top:.3mm;min-height:0;overflow:hidden}
.wleft{flex:1;display:flex;flex-direction:column;padding-right:1.5mm;padding-top:.3mm;overflow:hidden}
.wlbl{font-size:6pt;font-weight:600;color:#555;letter-spacing:.3px;text-transform:uppercase;line-height:1.2}
.wnum{font-size:17pt;font-weight:800;line-height:1;color:#001a5c;letter-spacing:-1px}
.wunit{font-size:7.5pt;font-weight:700;margin-top:.1mm;line-height:1.2}
.wgross{font-size:7pt;font-weight:600;color:#333;margin-top:.3mm;border-top:.5px solid #ccc;padding-top:.2mm;line-height:1.2}
.wbc{margin-top:auto}
.wbclbl{font-size:6pt;color:#666;margin-bottom:.2mm;line-height:1.2}
.wbcline{border-bottom:1px solid #000;width:24mm;height:2mm}
.winsp{font-size:8pt;font-weight:700;margin-top:.8mm}
.qrbox{width:22mm;display:flex;align-items:center;justify-content:center;border-left:1px solid #ddd;padding-left:1.5mm;flex-shrink:0}

@media print{@page{size:165mm 70mm;margin:0}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>

<div class="wrap">

  <!-- Row 1: หัวกระดาษ -->
  <div class="title">
    ${p.blankHeader ? '' : (p.headerText?.trim() || 'บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด')}
    ${rollType !== 'good' ? `<span style="font-size:8pt;font-weight:700;margin-left:3mm">[${rollTypeLabelLong}]</span>` : ''}
  </div>
  ${reason ? `<div style="font-size:7pt;color:#c00;text-align:center;line-height:1.2;margin-bottom:.3mm">เหตุผล: ${reason}</div>` : ''}

  <!-- Row 2: Mat / MFG / Roll -->
  <div class="hdr">
    <div class="hc"><span>Mat</span><b>${p.matCode}</b></div>
    <div class="hc mid"><span>MFG</span><b>${mfgDate}</b></div>
    <div class="hc right"><span>${rollType.startsWith('scrap') ? 'ถุง' : rollType==='bad' ? 'กรอ' : 'Roll'}</span><b>${rollNo===0?'—':rollNo}</b></div>
  </div>

  <!-- Row 3: Product + Size + Lot -->
  <div class="prod-row">
    <span class="pname">${p.productName}</span>
    <span class="pdot">·</span>
    <span class="psize">${p.widthCm} ${p.widthUnit ?? 'cm'} × ${p.thickMc} mc</span>
    <span class="plot">Lot: ${p.lotNo}</span>
  </div>

  <!-- Row 4: Code + Length -->
  <div class="irow">
    <span class="il">Item&nbsp;<b>${p.itemCode || '—'}</b></span>
    <span class="ir">Length&nbsp;<b>${p.length||'—'} M.</b>${p.pcs ? `&nbsp;&nbsp;Pcs.&nbsp;<b>${p.pcs}</b>` : ''}</span>
  </div>

  <!-- Row 5: Machine + Core -->
  <div class="irow" style="border-bottom:none">
    <span class="il">เครื่อง&nbsp;<b>${p.machine_no}</b></span>
    <span class="ir">Core&nbsp;<b>${fmt(core,dec)} Kg</b></span>
  </div>

  <!-- Row 6: Weight + QR -->
  <div class="wsec">
    <div class="wleft">
      <div class="wlbl">Net Weight</div>
      <div class="wnum">${fmt(net,dec)}</div>
      <div class="wunit">Kgs.</div>
      <div class="wgross">Gross&nbsp;&nbsp;${fmt(gross,dec)} Kgs.</div>
      <div class="wbc">
        <div class="wbclbl">Barcode No.</div>
        <div class="wbcline"></div>
        <div class="winsp">ผู้ตรวจสอบ&nbsp;&nbsp;${p.inspector||'—'}</div>
      </div>
    </div>
    <div class="qrbox">
      <img src="${qrUrl(72)}" width="76" height="76" style="image-rendering:pixelated;display:block"/>
    </div>
  </div>

</div>`

  // ═══════════════════════════════════════════════════════
  // ใบสั้น 76.2 × 76.2 mm (square) — รายละเอียดครบเหมือนใบยาว
  // หัวกระดาษ: ใช้ p.headerText (ว่าง = เว้น)
  // ═══════════════════════════════════════════════════════
  const hdr = p.blankHeader ? '' : ((p.headerText || '').trim() || 'บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด')
  const rollTypeLabel = rollType === 'bad' ? 'กรอ' : rollType === 'scrap_clear' ? 'เศษใส' : rollType === 'scrap_color' ? 'เศษสี' : rollType === 'scrap_lump' ? 'เศษก้อน' : ''
  const shortHtml = `
<style>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800;900&display=swap');
/* 203 DPI thermal */
*{box-sizing:border-box;margin:0;padding:0}
html,body{font-family:'Sarabun','Arial',sans-serif;color:#000;background:#fff;width:76.2mm;height:76.2mm}
.page{width:76.2mm;height:76.2mm;display:flex;flex-direction:column;border:2px solid #000;overflow:hidden}
.hdr{text-align:center;font-size:10.5pt;font-weight:900;padding:.7mm 2mm;border-bottom:2px solid #000;letter-spacing:.3px;line-height:1.2}
.meta{display:flex;justify-content:space-between;border-bottom:2px solid #000;padding:.5mm 2mm;font-size:8pt;font-weight:700}
.meta b{font-size:9.5pt;font-weight:900}
.body{flex:1;padding:.3mm 2mm;display:flex;flex-direction:column;overflow:hidden}
.r{display:flex;justify-content:space-between;align-items:baseline;font-size:8.5pt;font-weight:700;line-height:1.35}
.r .k{flex-shrink:0;min-width:16mm}
.r .v{font-weight:900;text-align:right;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.r .v.xl{font-size:10pt;font-weight:900}
.sep{border-top:2px solid #000;margin:.2mm 0}
.wrow{display:flex;justify-content:space-between;align-items:center;border-top:2px solid #000;border-bottom:2px solid #000;padding:.7mm 2mm;flex-shrink:0}
.wlbl{font-size:7.5pt;font-weight:800}
.wval{font-size:24pt;font-weight:900;line-height:1}
.wunit{font-size:8.5pt;font-weight:900}
.wgross{font-size:7pt;font-weight:700;margin-top:.1mm}
.foot{padding:.6mm 2mm;border-top:2px solid #000;flex-shrink:0}
.inspector{font-size:9pt;font-weight:900}
@media print{@page{size:76.2mm 76.2mm;margin:0}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
<div class="page">

  <div class="hdr">${hdr}${rollTypeLabel ? (hdr ? ' · ' : '') + rollTypeLabel : ''}&nbsp;</div>

  <div class="meta">
    <span>Mat&nbsp;<b>${p.matCode}</b></span>
    <span>MFG&nbsp;<b>${mfgDate}</b></span>
    <span>${rollType.startsWith('scrap') ? 'ถุง' : rollType==='bad' ? 'กรอ' : 'Roll'}&nbsp;<b>${rollNo === 0 ? '—' : rollNo}</b></span>
  </div>

  <div class="body">
    <div class="r"><span class="k">Product</span><span class="v xl">${p.productName}</span></div>
    <div class="r"><span class="k">Item Code</span><span class="v">${p.itemCode || '—'}</span></div>
    <div class="r"><span class="k">Size</span><span class="v">${p.widthCm} ${p.widthUnit ?? 'cm'} × ${p.thickMc} mc</span></div>
    <div class="r"><span class="k">Lot No</span><span class="v">${p.lotNo}</span></div>
    <div class="r"><span class="k">Length</span><span class="v">${p.length || '—'} M.${p.pcs ? ' · '+p.pcs+' Pcs.' : ''}</span></div>
    <div class="sep"></div>
    <div class="r">
      <span class="k">เครื่อง</span><span class="v">${p.machine_no}</span>
      <span style="margin:0 2mm;color:#ccc">|</span>
      <span class="k" style="min-width:0">Core</span><span class="v">${fmt(core,dec)} Kg</span>
    </div>

    <div class="wrow">
      <div>
        <div class="wlbl">Net Weight</div>
        <div class="wval">${fmt(net,dec)}</div>
        <div class="wunit">Kgs.</div>
        <div class="wgross">Gross ${fmt(gross,dec)} Kgs.</div>
      </div>
      <img src="${qrUrl(56)}" width="56" height="56" style="image-rendering:pixelated"/>
    </div>
  </div>

  <div class="foot">
    <span class="inspector">ผู้ตรวจ: ${p.inspector || '—'}</span>
  </div>

</div>`

  // ═══════════════════════════════════════════════════════
  // Waste Label — 100×100 mm (ใบปะหน้าเศษเสีย/สิ่งปฏิกูล)
  // หน้าตาตาม DF Waste Label — ไม่มีสี พิมพ์ขาวดำ
  // ═══════════════════════════════════════════════════════
  const isScrapRoll = rollType.startsWith('scrap')
  const wasteName = rollType === 'scrap_clear' ? 'เศษพลาสติก (ใส)' : rollType === 'scrap_color' ? 'เศษพลาสติก (สี)' : rollType === 'scrap_lump' ? 'เศษพลาสติก (ก้อน)' : 'เศษพลาสติก'
  const wasteHtml = `
<style>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800;900&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
html,body{font-family:'Sarabun','Arial',sans-serif;color:#000;background:#fff;width:100mm;height:100mm}
.page{width:100mm;height:100mm;border:1.5px solid #000;display:flex;flex-direction:column;overflow:hidden}

/* ── หัว ── */
.co{text-align:center;font-size:11pt;font-weight:900;padding:1.5mm 2mm 1mm;border-bottom:1.5px solid #000;line-height:1.2}
.wl-tag{display:flex;align-items:center;justify-content:space-between;padding:.8mm 2mm;border-bottom:1.5px solid #000;font-size:7.5pt;font-weight:700}
.wl-badge{background:#000;color:#fff;font-size:7.5pt;font-weight:900;padding:.3mm 1.5mm;letter-spacing:.5px}
.wl-roll{font-size:8pt;font-weight:700}
.wl-rollval{font-size:8pt;font-weight:900}

/* ── ตาราง 2 คอลัมน์ ── */
.grid2{display:grid;grid-template-columns:1fr 1fr;border-bottom:1.5px solid #000}
.cell{padding:.8mm 1.5mm;border-right:1px solid #000}
.cell:last-child{border-right:none}
.cell-lbl{font-size:6.5pt;font-weight:700;color:#333;margin-bottom:.2mm}
.cell-val{font-size:10pt;font-weight:900;line-height:1.1}

/* ── แถวเดี่ยว ── */
.row1{display:flex;align-items:center;gap:2mm;padding:.8mm 1.5mm;border-bottom:1.5px solid #000}
.row1-lbl{font-size:6.5pt;font-weight:700;color:#333;min-width:18mm}
.row1-val{font-size:8pt;font-weight:700;flex:1;border-bottom:1px solid #000;padding-bottom:.2mm}

/* ── นน + QR ── */
.wt-row{display:flex;gap:2mm;padding:.8mm 1.5mm;border-bottom:1.5px solid #000;min-height:22mm}
.wt-left{flex:1}
.wt-lbl{font-size:7pt;font-weight:700;color:#333;margin-bottom:.2mm}
.wt-num{font-size:22pt;font-weight:900;line-height:1}
.wt-unit{font-size:8.5pt;font-weight:900}
.wt-gross{font-size:6.5pt;font-weight:700;margin-top:.5mm}
.wt-right{width:22mm;display:flex;flex-direction:column;align-items:center;justify-content:flex-start}
.wt-qrlbl{font-size:6pt;font-weight:700;text-align:center;margin-bottom:.5mm;border:1px solid #000;width:100%;text-align:center;padding:.2mm}
.wt-qr img{width:20mm;height:20mm;image-rendering:pixelated}

/* ── footer ── */
.ft{display:flex;border-bottom:1.5px solid #000;min-height:6mm}
.ft-cell{flex:1;padding:.5mm 1.5mm;border-right:1px solid #000}
.ft-cell:last-child{border-right:none}
.ft-lbl{font-size:6pt;font-weight:700;color:#333}
.ft-line{border-bottom:1px solid #000;margin-top:1mm;min-height:3mm}
.note{font-size:6pt;font-weight:700;padding:.5mm 1.5mm;text-align:center;line-height:1.4}

@media print{@page{size:100mm 100mm;margin:0}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
<div class="page">
  <div class="co">บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด</div>
  <div class="wl-tag">
    <span><span class="wl-badge">WASTE LABEL</span>&nbsp;&nbsp;ใบปะหน้า สิ่งปฏิกูล / ของเสียอุตสาหกรรม</span>
    <span class="wl-roll">Roll #&nbsp;<span class="wl-rollval">${rollNo === 0 ? '—' : rollNo}</span></span>
  </div>
  <div class="grid2">
    <div class="cell">
      <div class="cell-lbl">ชื่อสิ่งปฏิกูล</div>
      <div class="cell-val">${wasteName}</div>
    </div>
    <div class="cell">
      <div class="cell-lbl">Lot No</div>
      <div class="cell-val" style="font-size:8.5pt">${p.lotNo}</div>
    </div>
  </div>
  <div class="grid2">
    <div class="cell" style="border-bottom:1.5px solid #000">
      <div class="cell-lbl">เครื่อง / แผนก</div>
      <div class="cell-val" style="font-size:9pt">${p.machine_no}</div>
    </div>
    <div class="cell" style="border-bottom:1.5px solid #000">
      <div class="cell-lbl">ผู้ตรวจสอบ</div>
      <div class="cell-val" style="font-size:9pt">${p.inspector || '—'}</div>
    </div>
  </div>
  <div class="row1">
    <span class="row1-lbl">เหตุผล</span>
    <span class="row1-val" style="font-weight:900">${(p as any).scrapReason || reason || '—'}</span>
  </div>
  <div class="row1">
    <span class="row1-lbl">วันที่จัดเก็บ</span>
    <span class="row1-val">${new Date().toLocaleDateString('th-TH', { day:'2-digit', month:'2-digit', year:'numeric' })}</span>
  </div>
  <div class="wt-row">
    <div class="wt-left">
      <div class="wt-lbl">น้ำหนักสุทธิ (Net Weight)</div>
      <div class="wt-num">${fmt(gross, dec)}</div>
      <div class="wt-unit">Kg.</div>
      <div class="wt-gross">น้ำหนักรวม (Gross Weight) ${fmt(gross, dec)} Kg.</div>
    </div>
    <div class="wt-right">
      <div class="wt-qrlbl">QR CODE</div>
      <div class="wt-qr"><img src="${qrUrl(56)}" width="72" height="72"/></div>
    </div>
  </div>
  <div class="ft">
    <div class="ft-cell" style="flex:1.5">
      <div class="ft-lbl">แผนกต้นกำเนิด</div>
      <div class="ft-line"></div>
    </div>
    <div class="ft-cell">
      <div class="ft-lbl">วันที่</div>
      <div class="ft-line"></div>
    </div>
  </div>
  <div class="note">หมายเหตุ : ห้ามผสมของเสียต่างประเภทกัน และห้ามนำของเสียออกนอกพื้นที่โดยไม่ได้รับอนุญาต</div>
</div>`

  // ── Waste layout — โหลดจาก LabelDesigner (แก้ไขได้) ──
  const wasteLayout = await loadWasteLayout()
  // 4 ค่าคงที่ → อ่านจาก layout ที่แก้ไขใน designer (sampleValue คือค่าจริง)
  const getWasteConst = (id: string) => wasteLayout.fields.find(f => f.id === id)?.sampleValue ?? ''
  const sectionLabel = (p as any).section === 'rewind' ? 'แผนกกรอ' : (p as any).section === 'print' ? 'แผนกพิมพ์' : 'แผนกเป่า'
  const wasteDate    = new Date().toLocaleDateString('th-TH', { day:'2-digit', month:'2-digit', year:'numeric' })
  const wasteFieldData: Record<string, string> = {
    header:         p.blankHeader ? '' : ((p.headerText || '').trim() || 'บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด'),
    waste_tag:      'WASTE LABEL  ใบปะหน้า สิ่งปฏิกูล / ของเสียอุตสาหกรรม',
    rollno:         `Roll #${rollNo === 0 ? '—' : rollNo}`,
    // ── ข้อมูลจากการชั่ง ──
    waste_name_lbl: 'ชื่อสิ่งปฏิกูล',
    wastename:      rollType === 'scrap_clear' ? 'เศษพลาสติก (ใส)' : rollType === 'scrap_color' ? 'เศษพลาสติก (สี)' : rollType === 'scrap_lump' ? 'เศษพลาสติก (ก้อน)' : 'เศษพลาสติก',
    // ── ค่าคงที่ (อ่านจาก layout → แก้ใน designer) ──
    waste_code_lbl:     'รหัสสิ่งปฏิกูล',
    waste_code:         getWasteConst('waste_code'),
    // ── ข้อมูลจากงาน ──
    date:     `วันที่จัดเก็บ:  ${wasteDate}`,
    reason:   `เหตุผล: ${reason || '—'}`,
    net:      fmt(gross, dec),
    origin:   `แผนกต้นกำเนิด: ${sectionLabel}   เครื่อง: ${p.machine_no}`,
    inspector:`ผู้ตรวจสอบ: ${p.inspector || '—'}   วันที่: ${wasteDate}`,
    footer:   getWasteConst('footer') || 'หมายเหตุ : ห้ามผสมของเสียต่างประเภทกัน และห้ามนำของเสียออกนอกพื้นที่โดยไม่ได้รับอนุญาต',
  }
  const renderWasteField = makeFieldRenderer(wasteFieldData, 72)  // 72px QR
  const wasteHtmlFromLayout = `
<style>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800;900&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
html,body{font-family:'Sarabun','Arial',sans-serif;color:#000;background:#fff;width:${wasteLayout.labelW}mm;height:${wasteLayout.labelH}mm}
@media print{@page{size:${wasteLayout.labelW}mm ${wasteLayout.labelH}mm;margin:0}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
<div style="position:relative;width:${wasteLayout.labelW}mm;height:${wasteLayout.labelH}mm;border:1.5px solid #000;overflow:hidden">
${wasteLayout.fields.map(renderWasteField).join('\n')}
</div>`

  const W = isScrapRoll ? wasteLayout.labelW : size === 'long' ? savedLayout.labelW : shortLayout.labelW
  const H = isScrapRoll ? wasteLayout.labelH : size === 'long' ? savedLayout.labelH : shortLayout.labelH
  const win = window.open('', '_blank', `width=${Math.round(W*3.78)},height=${Math.round(H*3.78)},menubar=no,toolbar=no`)
  if (!win) {
    // popup ถูก browser block — แจ้งผู้ใช้ + แนะนำให้ allow popup
    console.warn('printLabel: popup blocked')
    alert('⚠ Browser block popup — กรุณาอนุญาต popup ของเว็บนี้\n(ไอคอนล็อค/ขวาบนช่อง URL)\n\nม้วนถูกบันทึกแล้ว สามารถพิมพ์ใหม่ได้จากหน้า History')
    return
  }

  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/>
  ${isScrapRoll ? wasteHtmlFromLayout : size === 'long' ? longHtmlFromLayout : shortHtmlFromLayout}
  </head><body><script>
    var imgs=document.images,n=0
    function doPrint(){
      if(document.fonts && document.fonts.ready){
        document.fonts.ready.then(function(){setTimeout(function(){window.print();window.close()},300)})
      } else {
        setTimeout(function(){window.print();window.close()},600)
      }
    }
    function ok(){n++;if(n>=imgs.length)doPrint()}
    if(!imgs.length){doPrint()}
    else{for(var i=0;i<imgs.length;i++){if(imgs[i].complete)ok();else{imgs[i].onload=ok;imgs[i].onerror=ok}}}
  <\/script></body></html>`)
  win.document.close()
}

// ── Machine Picker ────────────────────────────────────────────────────────────
function MachinePicker({ profiles, onSelect, onProfileUpdated, dept }: {
  profiles: MachineProfile[]
  onSelect: (p: MachineProfile) => void
  onProfileUpdated: () => void
  dept?: 'blow' | 'print' | 'rewind'
}) {
  const [editing, setEditing]   = useState<MachineProfile | null>(null)
  const [progress, setProgress] = useState<Record<string, { done: number; rolls: number; badKg: number; badRolls: number }>>({})
  const [parked,   setParked]   = useState<Record<string, any[]>>({}) // machine_no → list ของ parked
  const [showResumeClosed, setShowResumeClosed] = useState(false)
  const [parkedPickerMachine, setParkedPickerMachine] = useState<string | null>(null)

  // โหลด parked jobs — group ตาม machine_no
  async function loadParked() {
    const { data } = await supabase.from('parked_jobs').select('*').order('parked_at', { ascending: false })
    if (!data) return
    const map: Record<string, any[]> = {}
    data.forEach(r => {
      if (!map[r.machine_no]) map[r.machine_no] = []
      map[r.machine_no].push(r)
    })
    setParked(map)
  }

  // คืนงานที่จอด — ถ้ามีหลายงาน ให้เปิด picker ก่อน
  async function clickRestore(machineNo: string) {
    const jobs = parked[machineNo] ?? []
    if (jobs.length === 0) return
    if (jobs.length === 1) {
      await doRestore(jobs[0])
    } else {
      setParkedPickerMachine(machineNo)
    }
  }

  async function doRestore(job: any) {
    if (!confirm(`คืนงาน "${job.profile_snapshot?.productName}" ให้เครื่อง ${job.machine_no}?\nงานที่รันอยู่ตอนนี้จะถูกแทนที่ (ถ้ามี — อย่าลืมพักไว้ก่อน)`)) return
    const snap = job.profile_snapshot as MachineProfile
    await supabase.from('machine_profiles').upsert({
      machine_no: job.machine_no,
      cust_code: snap.custCode, cust_name: snap.custName, cust_branch: snap.custBranch, cust_address: snap.custAddress,
      decimal_places: snap.decimal, item_code: snap.itemCode, mat_code: snap.matCode, product_code: snap.productCode,
      product_name: snap.productName, width_cm: snap.widthCm, width_unit: snap.widthUnit ?? 'cm', thick_mc: snap.thickMc,
      lot_no: snap.lotNo, length: snap.length, pcs: snap.pcs, core_weight: snap.coreWeight,
      inspector: snap.inspector, locked: snap.locked, planned_qty: snap.plannedQty,
      label_size: snap.labelSize, header_text: snap.headerText ?? '',
      blank_header: snap.blankHeader ?? false, section: snap.section ?? 'blow',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'machine_no' })
    await supabase.from('parked_jobs').delete().eq('id', job.id)
    setParkedPickerMachine(null)
    await loadParked()
    onProfileUpdated()
  }

  async function deleteParked(job: any) {
    if (!confirm(`ลบงานจอด "${job.profile_snapshot?.productName}" (Lot ${job.lot_no}) ทิ้ง?\n\nม้วนที่ชั่งไว้ยังอยู่ใน DB — แค่ลบ snapshot profile ทิ้ง`)) return
    await supabase.from('parked_jobs').delete().eq('id', job.id)
    await loadParked()
  }

  useEffect(() => { loadParked() }, [])

  // โหลดยอดผลิตต่อเครื่อง — ดึงตาม machine_no + lot_no ปัจจุบัน
  useEffect(() => {
    if (profiles.length === 0) return
    const machineNos = profiles.map(p => p.machine_no).filter(Boolean)
    if (machineNos.length === 0) return

    // ดึงทีละหน้า (page ละ 1000) จนครบ — กันเพดาน 1000 แถวของ Supabase ตัดข้อมูลเงียบ ๆ
    // (ก่อนหน้านี้ดึงครั้งเดียวไม่ใส่ limit/order → พอม้วนรวมเกิน 1000 ยอด "ดี" จะหายบางส่วน)
    ;(async () => {
      const all: any[] = []
      const PAGE = 1000
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase.from('production_rolls')
          .select('machine_no, lot_no, work_order, weight, roll_type')
          .in('roll_type', ['good', 'bad'])
          .in('machine_no', machineNos)
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1)
        if (error || !data) break
        all.push(...data)
        if (data.length < PAGE) break
      }
      {
        const data = all
        // สร้าง map lot_no / work_order / fresh_start ปัจจุบันต่อเครื่อง
        const lotMap: Record<string, string> = {}
        const woMap:  Record<string, string> = {}
        const freshMap: Record<string, boolean> = {}
        profiles.forEach(p => {
          if (!p.machine_no) return
          if (p.lotNo) lotMap[p.machine_no] = p.lotNo
          woMap[p.machine_no] = p.woNo ?? ''
          freshMap[p.machine_no] = !!(p as any).freshStart
        })

        const map: Record<string, { done: number; rolls: number; badKg: number; badRolls: number }> = {}
        data.forEach(r => {
          const key = r.machine_no ?? ''
          const curLot = lotMap[key]
          // ถ้ามี lot ปัจจุบัน ให้นับเฉพาะ lot นั้น
          if (curLot && r.lot_no !== curLot) return
          // เครื่องที่เปิด "เริ่มนับม้วนใหม่" (fresh_start) → นับเฉพาะ WO ปัจจุบัน (ให้ตรงกับหน้าชั่ง)
          if (freshMap[key] && (r.work_order ?? '') !== (woMap[key] ?? '')) return
          if (!map[key]) map[key] = { done: 0, rolls: 0, badKg: 0, badRolls: 0 }
          if (r.roll_type === 'good') { map[key].done += r.weight ?? 0; map[key].rolls += 1 }
          else if (r.roll_type === 'bad') { map[key].badKg += r.weight ?? 0; map[key].badRolls += 1 }
        })
        setProgress(map)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles.length, profiles.map(p=>p.machine_no+p.lotNo+p.woNo+((p as any).freshStart?'1':'0')).join(',')])

  const sorted = [...profiles].sort((a,b) => (a.machine_no||'').localeCompare(b.machine_no||'', undefined, { numeric: true }))

  function isReady(p: MachineProfile) {
    return !!(p.machine_no && p.custName && p.productName && (p.itemCode || p.matCode) && p.lotNo)
  }

  return (
    <div className="min-h-[calc(100vh-48px)] bg-[#0a0f1e] p-3 flex flex-col overflow-auto">
      {/* ── ม้วนรอกรอ (เฉพาะแผนกกรอ) ──────────────────────── */}
      {dept === 'rewind' && (
        <div className="mb-3">
          <ReworkInbox onJumpToMachine={async (machine) => {
            // ดึง machine_profile แล้วเปิดหน้าชั่งของเครื่องนั้น
            const { data } = await supabase.from('machine_profiles').select('*').eq('machine_no', machine).maybeSingle()
            if (data) {
              const prof: MachineProfile = {
                machine_no: data.machine_no,
                custCode: data.cust_code ?? '', custName: data.cust_name ?? '', custBranch: data.cust_branch ?? '', custAddress: data.cust_address ?? '',
                decimal: (data.decimal_places ?? 2) as 1|2,
                itemCode: data.item_code ?? '', matCode: data.mat_code ?? '', productCode: data.product_code ?? '',
                productName: data.product_name ?? '', widthCm: data.width_cm ?? '', widthUnit: (data.width_unit ?? 'cm') as 'cm'|'mm', thickMc: data.thick_mc ?? '',
                lotNo: data.lot_no ?? '', length: data.length ?? '', pcs: data.pcs ?? '',
                coreWeight: data.core_weight ?? '1.25', inspector: data.inspector ?? '', locked: data.locked ?? false,
                plannedQty: data.planned_qty ?? '',
                labelSize: (data.label_size ?? 'long') as 'long'|'short',
                headerText: data.header_text ?? '', blankHeader: data.blank_header ?? false,
                section: (data.section ?? 'blow') as 'blow'|'print'|'rewind',
                soNo: data.sale_order ?? '', woNo: data.work_order ?? '', deliveryDate: data.delivery_date ?? '',
              }
              onSelect(prof)
            }
          }}/>
        </div>
      )}

      <div className="flex-1 flex flex-col min-h-0">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h1 className="text-white font-bold text-xl flex items-center gap-2">
              <Wind size={20} className="text-brand-400" />
              เลือกเครื่อง
              {dept && (
                <span className={`text-sm font-bold px-3 py-1 rounded-full ${
                  dept==='blow'   ? 'bg-blue-500/20 text-blue-300' :
                  dept==='print'  ? 'bg-purple-500/20 text-purple-300' :
                                    'bg-green-500/20 text-green-300'
                }`}>
                  {dept==='blow' ? '🌬 ผลิต(เป่า)' : dept==='print' ? '🖨 ผลิต(พิมพ์)' : '🔁 กรอ(Rework)'}
                </span>
              )}
            </h1>
            <p className="text-slate-400 text-sm mt-1">เครื่องว่าง → คลิกเพื่อกรอกข้อมูลงาน · เครื่องพร้อม → คลิกเพื่อเริ่มชั่ง</p>
          </div>
          <button onClick={() => setShowResumeClosed(true)}
            className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5">
            📂 ดึงงานเก่า
          </button>
        </div>

        {/* Grid — แสดงทุกเครื่อง, size เท่ากันหมด */}
        <div className="grid grid-cols-3 2xl:grid-cols-4 gap-2 flex-1 overflow-hidden" style={{gridTemplateRows:'repeat(3, 1fr)'}}>
          {sorted.map((p, i) => {
            const ready    = isReady(p)
            const prog     = progress[p.machine_no] ?? { done: 0, rolls: 0, badKg: 0, badRolls: 0 }
            const planned  = parseFloat(p.plannedQty) || 0
            const pct      = planned > 0 ? Math.min((prog.done / planned) * 100, 100) : 0
            const remaining = Math.max(planned - prog.done, 0)
            return (
              <div key={i} className={`rounded-2xl text-left transition-all group flex flex-col relative overflow-hidden ${
                ready
                  ? 'bg-slate-900 border border-slate-700 hover:border-brand-500'
                  : 'bg-slate-900/40 border-2 border-dashed border-slate-700 hover:border-brand-500'
              }`}>
                {/* คลิกทั้ง card เพื่อชั่ง/กรอก */}
                <button className="absolute inset-0 z-0" onClick={() => ready ? onSelect(p) : setEditing(p)}/>

                {/* ปุ่ม ⚙ */}
                <button onClick={e => { e.stopPropagation(); setEditing(p) }}
                  className="absolute top-2 right-2 z-10 w-6 h-6 rounded-lg bg-slate-700/80 hover:bg-slate-600 text-slate-400 hover:text-white flex items-center justify-center transition-all opacity-0 group-hover:opacity-100">
                  <Settings size={11}/>
                </button>

                <div className="flex flex-col h-full relative z-0 pointer-events-none overflow-hidden">

                  {/* ── Top bar: machine badge + status ── */}
                  <div className={`flex items-center justify-between px-3 py-2.5 ${ready ? 'bg-brand-600/20 border-b border-brand-500/20' : 'bg-slate-800/40 border-b border-slate-700/40'}`}>
                    <span className={`font-black text-lg tracking-wide ${ready ? 'text-brand-300' : 'text-slate-500'}`}>{p.machine_no}</span>
                    <div className="flex items-center gap-1.5">
                      {parked[p.machine_no] && parked[p.machine_no].length > 0 && (
                        <button className="pointer-events-auto z-10 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/40 transition-colors"
                          onClick={e => { e.stopPropagation(); clickRestore(p.machine_no) }}>
                          🅿 จอด {parked[p.machine_no].length} งาน ↩
                        </button>
                      )}
                      {ready
                        ? <span className="text-xs text-green-400 font-semibold flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block animate-pulse"/>พร้อม</span>
                        : <span className="text-xs text-slate-500 font-semibold">ว่าง</span>}
                    </div>
                  </div>

                  {/* ── Content ── */}
                  {ready ? (
                    <div className="flex-1 px-3 py-2 flex flex-col gap-1.5 overflow-hidden">

                      {/* สินค้า + ลูกค้า */}
                      <div>
                        <p className="text-white font-bold text-sm leading-tight line-clamp-1">{p.productName}</p>
                        <p className="text-slate-400 text-xs truncate mt-0.5">{p.custName}</p>
                      </div>

                      {/* WO + SO + Lot + Size */}
                      <div className="flex gap-1.5 flex-wrap">
                        {p.woNo && <span className="text-[10px] bg-orange-500/15 text-orange-300 border border-orange-500/25 px-2 py-0.5 rounded font-bold">WO {p.woNo}</span>}
                        {p.soNo && <span className="text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/25 px-2 py-0.5 rounded font-bold">SO {p.soNo}</span>}
                        <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono border border-slate-700">Lot {p.lotNo.slice(-8)}</span>
                        {p.widthCm && <span className="text-[10px] bg-brand-500/15 text-brand-300 border border-brand-500/25 px-2 py-0.5 rounded font-bold">{fmtSize(p.widthCm, p.thickMc, p.widthUnit)}</span>}
                      </div>

                      {/* Mat + Inspector */}
                      <div className="grid grid-cols-2 gap-x-2 text-xs bg-slate-800/40 rounded-lg px-2 py-1.5">
                        <span className="text-slate-500">Mat</span><span className="text-slate-200 font-mono text-right">{p.matCode}</span>
                        <span className="text-slate-500">ผู้ตรวจ</span><span className="text-slate-200 font-semibold text-right truncate">{p.inspector || '—'}</span>
                      </div>

                      {/* Progress — แสดงเสมอ */}
                      <div className="mt-auto">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-green-400 font-bold">
                            {prog.rolls} ม้วน · {prog.done.toFixed(p.decimal ?? 2)} Kgs.
                          </span>
                          {planned > 0 && (
                            <span className={remaining <= 0 ? 'text-green-400 font-bold' : 'text-amber-400 font-bold'}>
                              {remaining <= 0 ? '✓ ครบแล้ว' : `เหลือ ${remaining.toFixed(0)} Kgs.`}
                            </span>
                          )}
                        </div>
                        {planned > 0 && (() => {
                          const fgW  = Math.min(100, (prog.done / planned) * 100)
                          const badW = Math.min(100 - fgW, (prog.badKg / planned) * 100)
                          return (
                          <>
                            {/* แถบเดียว 2 สี — น้ำเงิน=ดี, เหลือง=กรอ */}
                            <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden flex"
                                 title={`ม้วนดี ${prog.done.toFixed(p.decimal ?? 2)} + กรอ ${prog.badKg.toFixed(p.decimal ?? 2)} = รวม ${(prog.done + prog.badKg).toFixed(p.decimal ?? 2)} Kgs.`}>
                              <div className={`h-full transition-all ${pct >= 100 ? 'bg-green-500' : 'bg-brand-500'}`} style={{ width: `${fgW}%` }}
                                   title={`ม้วนดี ${prog.done.toFixed(p.decimal ?? 2)} Kgs. (${prog.rolls} ม้วน)`}/>
                              <div className="h-full bg-amber-400 transition-all" style={{ width: `${badW}%` }}
                                   title={`กรอ ${prog.badKg.toFixed(p.decimal ?? 2)} Kgs. (${prog.badRolls} ม้วน)`}/>
                            </div>
                            <div className="flex justify-between text-[10px] mt-0.5">
                              <span className="text-slate-500">
                                <span className="text-brand-400">■</span> ดี {prog.done.toFixed(p.decimal ?? 2)}
                                {prog.badRolls > 0 && <> · <span className="text-amber-400">■</span> กรอ {prog.badKg.toFixed(p.decimal ?? 2)}</>}
                              </span>
                              <span className="text-slate-500">เป้า {planned.toLocaleString()} ({pct.toFixed(0)}%)</span>
                            </div>
                          </>
                          )
                        })()}
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center px-3 py-4">
                      {parked[p.machine_no] && parked[p.machine_no].length > 0 ? (
                        <>
                          <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center mb-2">
                            <span className="text-amber-400 text-base">🅿</span>
                          </div>
                          <p className="text-amber-300 text-xs font-bold">มีงานจอด {parked[p.machine_no].length} งาน</p>
                          <p className="text-amber-400/70 text-[10px] mt-0.5 truncate max-w-full px-2">
                            {parked[p.machine_no].length === 1
                              ? parked[p.machine_no][0]?.profile_snapshot?.productName
                              : parked[p.machine_no].map(j => j.profile_snapshot?.productName).filter(Boolean).slice(0,2).join(', ')
                            }
                          </p>
                          <button className="pointer-events-auto z-10 mt-2 text-xs font-bold px-3 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/40 transition-colors"
                            onClick={e => { e.stopPropagation(); clickRestore(p.machine_no) }}>
                            ↩ {parked[p.machine_no].length > 1 ? 'เลือกคืน' : 'คืนงานนี้'}
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="w-8 h-8 rounded-full border-2 border-dashed border-slate-700 flex items-center justify-center mb-2">
                            <span className="text-slate-600 text-lg">+</span>
                          </div>
                          <p className="text-slate-500 text-xs font-medium">เครื่องว่าง</p>
                          <p className="text-slate-600 text-[10px] mt-0.5">คลิกเพื่อกรอกข้อมูลงาน</p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {sorted.length === 0 && (
            <div className="col-span-full text-center py-16 bg-slate-900 border border-slate-800 rounded-2xl">
              <Wind size={40} className="text-slate-700 mx-auto mb-3" />
              <p className="text-slate-400 font-semibold">ยังไม่มีเครื่อง</p>
              <p className="text-slate-600 text-sm mt-1">ไปตั้งค่าเพิ่มเครื่องที่ Tab "ตั้งค่าเครื่อง"</p>
            </div>
          )}
        </div>
      </div>
      {/* Quick edit modal */}
      {editing && (
        <QuickEditModal profile={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onProfileUpdated(); loadParked() }}
          onParked={() => { setEditing(null); onProfileUpdated(); loadParked() }} />
      )}
      {/* Resume closed-job modal */}
      {showResumeClosed && (
        <ResumeClosedJobModal
          dept={dept}
          machines={sorted}
          onClose={() => setShowResumeClosed(false)}
          onResumed={() => { setShowResumeClosed(false); onProfileUpdated() }} />
      )}
      {/* Parked picker — เลือกงานจอดที่จะคืน (กรณี > 1) */}
      {parkedPickerMachine && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setParkedPickerMachine(null)}>
          <div className="bg-slate-900 border border-amber-500/40 rounded-2xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <p className="text-white font-bold">🅿 งานจอดที่เครื่อง {parkedPickerMachine}</p>
              <button onClick={() => setParkedPickerMachine(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <div className="px-3 py-3 max-h-[60vh] overflow-y-auto space-y-2">
              {(parked[parkedPickerMachine] ?? []).map(job => {
                const snap = job.profile_snapshot ?? {}
                const parkedAt = job.parked_at ? new Date(job.parked_at).toLocaleString('th-TH', { dateStyle:'short', timeStyle:'short' }) : '—'
                return (
                  <div key={job.id} className="bg-slate-800 border border-slate-700 rounded-xl p-3">
                    <p className="text-white font-bold text-sm">{snap.productName || '—'}</p>
                    <p className="text-slate-400 text-xs">{snap.custName || '—'}</p>
                    <p className="text-amber-300 text-xs font-mono mt-0.5">Lot {job.lot_no || snap.lotNo || '—'}</p>
                    <p className="text-slate-500 text-[10px] mt-1">พักโดย <b className="text-slate-300">{job.parked_by || '—'}</b> · {parkedAt}</p>
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => doRestore(job)}
                        className="flex-1 bg-amber-600 hover:bg-amber-500 text-white py-1.5 rounded-lg text-xs font-bold">
                        ↩ คืนงานนี้
                      </button>
                      <button onClick={() => deleteParked(job)}
                        className="px-3 bg-slate-800 hover:bg-red-900/40 border border-slate-700 hover:border-red-500/40 text-slate-400 hover:text-red-300 py-1.5 rounded-lg text-xs">
                        🗑
                      </button>
                    </div>
                  </div>
                )
              })}
              {(parked[parkedPickerMachine] ?? []).length === 0 && (
                <p className="text-slate-500 text-center py-6 text-sm">ไม่มีงานจอดแล้ว</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Suggestion store (จำค่าที่เคยกรอก ใน localStorage) ───────────────────────
const SUG_KEY = 'bwp_field_suggestions'
function loadSuggestions(field: string): string[] {
  try {
    const all = JSON.parse(localStorage.getItem(SUG_KEY) ?? '{}') as Record<string,string[]>
    return all[field] ?? []
  } catch { return [] }
}
function saveSuggestion(field: string, value: string) {
  if (!value || !value.trim()) return
  try {
    const all = JSON.parse(localStorage.getItem(SUG_KEY) ?? '{}') as Record<string,string[]>
    const list = all[field] ?? []
    const filtered = list.filter(v => v !== value.trim())
    all[field] = [value.trim(), ...filtered].slice(0, 20) // เก็บ 20 อันล่าสุด
    localStorage.setItem(SUG_KEY, JSON.stringify(all))
  } catch {}
}
function saveAllSuggestions(p: MachineProfile) {
  const fields: (keyof MachineProfile)[] = [
    'custCode','custName','custBranch','custAddress','matCode','productCode','productName',
    'widthCm','thickMc','length','pcs','coreWeight','inspector','plannedQty','headerText'
  ]
  fields.forEach(k => saveSuggestion(k, (p[k] as string) ?? ''))
}

// ── Item Code Picker (dropdown ดึงจาก products table) ────────────────────────
function ItemCodePicker({ value, products, onChange, onPick }: {
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
    if (!v) return products.filter(s => s.item_code)  // ว่าง → โชว์ทั้งหมด
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
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        placeholder="พิมพ์ค้นหา (item code / size / ลูกค้า) หรือคลิกเลือก..."
        className="w-full bg-slate-800 border-2 border-brand-500/40 hover:border-brand-500 focus:border-brand-500 rounded-lg px-2.5 py-2 text-white text-sm outline-none cursor-pointer"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-slate-800 border border-brand-500/40 rounded-lg shadow-2xl max-h-80 overflow-y-auto">
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
            <button key={s.id ?? s.item_code + i} type="button"
              onMouseDown={e => { e.preventDefault(); onPick(s); setOpen(false) }}
              className="w-full text-left px-3 py-2 hover:bg-slate-700 border-b border-slate-700/50 last:border-0">
              <div className="flex items-center gap-2">
                <span className="text-brand-400 font-mono font-bold text-xs">{s.item_code}</span>
                {s.width_cm && (
                  <span className="text-[10px] bg-brand-500/15 text-brand-300 px-1.5 py-0.5 rounded">
                    {s.width_cm}cm×{s.thick_mc}mc
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

// ── Resume Closed Job Modal — ดึงงานที่ปิดไปแล้วกลับมาทำต่อ ──────────────────
function ResumeClosedJobModal({ dept, machines, onClose, onResumed }: {
  dept?: 'blow' | 'print' | 'rewind'
  machines: MachineProfile[]
  onClose: () => void
  onResumed: () => void
}) {
  const [rows, setRows]   = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all'|'closed'|'open'>('all')
  const [restoring, setRestoring] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      setLoading(true)
      const machineNos = machines.map(m => m.machine_no).filter(Boolean)

      // 1) ดึง job_summaries (งานที่ปิดถาวรแล้ว)
      let qs = supabase.from('job_summaries').select('*').order('closed_at', { ascending: false }).limit(300)
      if (machineNos.length) qs = qs.in('machine_no', machineNos)
      const { data: summaries } = await qs

      // 2) ดึง production_rolls — รวบทุก (machine, lot) ที่มีม้วน (รวมงานที่ยังไม่ปิด/ปิดไม่สรุป)
      let qr = supabase.from('production_rolls')
        .select('machine_no, lot_no, product_name, customer, item_code, mat_code, sale_order, work_order, weight, roll_type, width_cm, width_unit, thick_mc, product_code, cust_code, cust_branch, inspector, section, created_at')
        .order('created_at', { ascending: false })
        .limit(3000)
      if (machineNos.length) qr = qr.in('machine_no', machineNos)
      const { data: rolls } = await qr

      // รวมข้อมูล — key = machine_no + '|' + lot_no + '|' + work_order (แยกตามใบสั่งผลิต)
      const map = new Map<string, any>()

      // ใส่ summaries ก่อน (มี planned_qty + closed info)
      for (const s of summaries ?? []) {
        if (!s.machine_no || !s.lot_no) continue
        const k = `${s.machine_no}|${s.lot_no}|${s.work_order ?? ''}`
        map.set(k, {
          id:           s.id,
          machine_no:   s.machine_no,
          lot_no:       s.lot_no,
          product_name: s.product_name,
          customer:     s.customer,
          item_code:    s.item_code,
          mat_code:     s.mat_code,
          sale_order:   s.sale_order,
          work_order:   s.work_order,
          planned_qty:  s.planned_qty,
          good_kg:      s.good_kg,
          inspector:    s.inspector,
          closed_at:    s.closed_at,
          source:       'closed',
        })
      }

      // เพิ่มจาก rolls (สำหรับ lot ที่ไม่อยู่ใน summaries หรือเสริมข้อมูล)
      const aggKg: Record<string, number> = {}
      const aggCount: Record<string, number> = {}
      const latest: Record<string, string> = {}
      for (const r of rolls ?? []) {
        if (!r.machine_no || !r.lot_no) continue
        const k = `${r.machine_no}|${r.lot_no}|${r.work_order ?? ''}`
        if (r.roll_type === 'good') {
          aggKg[k]    = (aggKg[k] ?? 0) + (r.weight ?? 0)
          aggCount[k] = (aggCount[k] ?? 0) + 1
        }
        if (!latest[k] || r.created_at > latest[k]) latest[k] = r.created_at
        if (!map.has(k)) {
          map.set(k, {
            id:           `roll:${k}`,
            machine_no:   r.machine_no,
            lot_no:       r.lot_no,
            product_name: r.product_name,
            customer:     r.customer,
            item_code:    r.item_code,
            mat_code:     r.mat_code,
            sale_order:   r.sale_order,
            work_order:   r.work_order,
            inspector:    r.inspector,
            section:      r.section,
            closed_at:    null,   // ยังไม่ปิดถาวร
            source:       'open',
          })
        }
      }

      // ใส่ aggregate kg + count + latest activity เข้าทุก row
      const enriched = Array.from(map.values()).map(row => {
        const k = `${row.machine_no}|${row.lot_no}|${row.work_order ?? ''}`
        return {
          ...row,
          good_kg:    row.good_kg    ?? aggKg[k]    ?? 0,
          good_rolls: aggCount[k]    ?? 0,
          last_active: latest[k] ?? row.closed_at ?? null,
        }
      })
      // เรียงตามล่าสุด
      enriched.sort((a:any, b:any) => (b.last_active || '').localeCompare(a.last_active || ''))

      setRows(enriched)
      setLoading(false)
    })()
  }, [])

  const filtered = rows.filter(r => {
    if (statusFilter !== 'all' && r.source !== statusFilter) return false
    if (!search.trim()) return true
    const s = search.toLowerCase()
    return [r.machine_no, r.lot_no, r.product_name, r.customer, r.work_order, r.sale_order]
      .filter(Boolean).some(x => String(x).toLowerCase().includes(s))
  })

  async function resume(r: any) {
    if (!confirm(
      `ดึงงานนี้กลับ?\n\n` +
      `เครื่อง ${r.machine_no} · Lot ${r.lot_no}\n` +
      `${r.product_name} · ${r.customer}\n\n` +
      `⚠ จะ overwrite profile ของเครื่อง ${r.machine_no} (ถ้ามีงานรันอยู่ตอนนี้)`
    )) return
    setRestoring(r.id)
    try {
      // ดึงม้วนจริงจาก production_rolls เพื่อเอา width_unit/width_cm/thick_mc ล่าสุด (เฉพาะ WO นี้)
      const { data: sample } = await supabase.from('production_rolls')
        .select('*').eq('machine_no', r.machine_no).eq('lot_no', r.lot_no)
        .eq('work_order', r.work_order ?? '').limit(1).maybeSingle()

      await supabase.from('machine_profiles').upsert({
        machine_no:    r.machine_no,
        lot_no:        r.lot_no,
        sale_order:    r.sale_order  ?? '',
        work_order:    r.work_order  ?? '',
        delivery_date: r.delivery_date ?? null,
        product_name:  r.product_name ?? '',
        cust_name:     r.customer    ?? '',
        item_code:     r.item_code   ?? '',
        mat_code:      r.mat_code    ?? '',
        planned_qty:   r.planned_qty != null ? String(r.planned_qty) : '',
        inspector:     r.inspector   ?? '',
        section:       sample?.section ?? dept ?? 'blow',
        // ดึง dimension + ค่าที่เคยกรอก (เมตร/จำนวนชิ้น/แกน) จากม้วนจริง (ถ้ามี)
        width_cm:      sample?.width_cm   ?? '',
        width_unit:    sample?.width_unit ?? 'cm',
        thick_mc:      sample?.thick_mc   ?? '',
        length:        sample?.length     ?? '',
        pcs:           sample?.pcs        ?? '',
        core_weight:   sample?.core_weight != null ? String(sample.core_weight) : '',
        product_code:  sample?.product_code ?? '',
        cust_code:     sample?.cust_code    ?? '',
        cust_branch:   sample?.cust_branch  ?? '',
        // นับเฉพาะม้วนของ WO นี้ (Lot เดียวกันคนละ WO ไม่ปน) — ดึงงานเดิม/ใบสั่งผลิตเดิมเท่านั้น
        fresh_start:   true,
        updated_at:    new Date().toISOString(),
      }, { onConflict: 'machine_no' })

      alert(`✓ ดึงงาน "${r.product_name}" (WO ${r.work_order || '—'}) กลับมาที่เครื่อง ${r.machine_no} แล้ว — กดเข้าเครื่องเพื่อชั่งต่อ`)
      onResumed()
    } catch (e: any) {
      alert('ดึงงานไม่สำเร็จ: ' + (e?.message ?? e))
    } finally { setRestoring(null) }
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl max-h-[88vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 shrink-0">
          <div>
            <p className="text-white font-bold text-base">📂 ดึงงานเก่ามาชั่งต่อ</p>
            <p className="text-slate-400 text-xs mt-0.5">เลือกงานที่ปิดไปแล้วเพื่อ restore profile กลับ — ม้วนเก่ายังอยู่ในระบบ</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18}/></button>
        </div>
        <div className="px-5 py-2 border-b border-slate-800 shrink-0 space-y-2">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="ค้นหา (เครื่อง / lot / สินค้า / ลูกค้า / WO / SO)..."
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-brand-500"/>
          <div className="flex items-center gap-1.5">
            {([
              ['all', `ทั้งหมด (${rows.length})`],
              ['closed', `🏁 จบงานแล้ว (${rows.filter((r:any)=>r.source==='closed').length})`],
              ['open', `📦 ยังไม่ปิด (${rows.filter((r:any)=>r.source==='open').length})`],
            ] as const).map(([k,label]) => (
              <button key={k} onClick={()=>setStatusFilter(k as any)}
                className={`text-[11px] font-bold px-2.5 py-1 rounded-lg transition-colors ${statusFilter===k ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2">
          {loading ? (
            <p className="text-center py-10 text-slate-500">กำลังโหลด...</p>
          ) : filtered.length === 0 ? (
            <p className="text-center py-10 text-slate-500">{search.trim() ? 'ไม่พบงานที่ตรงกัน' : 'ยังไม่มีงานที่ปิดไว้'}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-800/50 text-[10px] text-slate-400 uppercase sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">เครื่อง / Lot</th>
                  <th className="px-3 py-2 text-left font-semibold">สินค้า / ลูกค้า</th>
                  <th className="px-3 py-2 text-right font-semibold">ยอด / ผลิต</th>
                  <th className="px-3 py-2 text-left font-semibold">สถานะ / ล่าสุด</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filtered.map(r => {
                  const lastActive = r.last_active ? new Date(r.last_active).toLocaleString('th-TH', { dateStyle:'short', timeStyle:'short' }) : '—'
                  const planned = parseFloat(r.planned_qty) || 0
                  const good = r.good_kg || 0
                  const remaining = Math.max(planned - good, 0)
                  const isClosed = r.source === 'closed'
                  return (
                    <tr key={r.id} className="hover:bg-slate-800/40">
                      <td className="px-3 py-2">
                        <p className="text-white font-bold">{r.machine_no}</p>
                        <p className="text-slate-500 text-[10px] font-mono">{r.lot_no}</p>
                      </td>
                      <td className="px-3 py-2">
                        <p className="text-slate-200 text-xs">{r.product_name || '—'}</p>
                        <p className="text-slate-500 text-[10px]">{r.customer || '—'}</p>
                        {r.work_order && <span className="inline-block mt-0.5 text-[9px] font-bold bg-amber-500/15 text-amber-300 px-1.5 py-0.5 rounded">WO {r.work_order}</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-xs">
                        <p className="text-slate-400">{planned ? `${planned.toFixed(0)} Kg` : '—'}</p>
                        <p className="text-green-400">{r.good_rolls || 0} ม้วน · {good.toFixed(2)} Kg</p>
                        {remaining > 0 && <p className="text-amber-400 text-[10px]">เหลือ {remaining.toFixed(0)}</p>}
                      </td>
                      <td className="px-3 py-2 text-[10px]">
                        {isClosed
                          ? <span className="inline-block px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 font-bold">🏁 ปิดถาวร</span>
                          : <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300 font-bold">📦 ยังไม่ปิด</span>}
                        <p className="text-slate-500 mt-0.5">{lastActive}</p>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => resume(r)} disabled={restoring === r.id}
                          className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-bold">
                          {restoring === r.id ? '...' : '↩ ดึงคืน'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Quick Edit Modal (กรอกข้อมูลงานใหม่) ─────────────────────────────────────
function QuickEditModal({ profile, onClose, onSaved, onParked }: {
  profile: MachineProfile; onClose: () => void; onSaved: () => void; onParked?: () => void
}) {
  const [p, setP]         = useState({ ...profile })
  const [products, setProducts] = useState<Product[]>([])
  const [saving, setSaving]   = useState(false)
  const [parking, setParking] = useState(false)
  const [parkBy,  setParkBy]  = useState('')
  const [showPark, setShowPark] = useState(false)
  const set = (k: keyof MachineProfile, v: any) => setP(prev => ({ ...prev, [k]: v }))
  const setMany = (patch: Partial<MachineProfile>) => setP(prev => ({ ...prev, ...patch }))

  useEffect(() => { fetchProducts().then(setProducts) }, [])

  // ── helper สร้าง Lot No อัตโนมัติ ──
  function genLotNo(machine: string, custCode: string): string {
    const yy = String((new Date().getFullYear() + 543) % 100).padStart(2, '0')
    const mm = String(new Date().getMonth() + 1).padStart(2, '0')
    const mc = (machine ?? '').toUpperCase()
    const cc = (custCode ?? '').replace(/\D/g, '').padStart(4, '0').slice(-4)
    if (!mc || !cc || cc === '0000') return ''
    return `${yy}${mc}${cc}${mm}`
  }
  // เช็คว่า lot string ตรงรูปแบบ auto-gen ของเครื่องนี้หรือเปล่า: yy + machine_no + 4digit + mm
  function isAutoLotPattern(lot: string, machine_no: string): boolean {
    if (!lot || !machine_no) return false
    const yy = String((new Date().getFullYear() + 543) % 100).padStart(2, '0')
    const mm = String(new Date().getMonth() + 1).padStart(2, '0')
    const re = new RegExp(`^${yy}${machine_no.toUpperCase()}\\d{4}${mm}$`)
    return re.test(lot)
  }
  // setMany สำหรับ Item Code pick: regen lot ทันทีตาม custCode ใหม่
  // เหมือนกับการเปลี่ยน custName/widthCm/thickMc ที่เขียนทับทันที
  // ถ้าผู้ใช้ต้องการ Lot custom ให้พิมพ์ทับหลังจากเลือก Item แล้ว
  const setManyWithLot = (patch: Partial<MachineProfile>) => {
    setP(prev => {
      const next = { ...prev, ...patch }
      if (!next.machine_no) return next
      const newAuto = genLotNo(next.machine_no, next.custCode ?? '')
      if (newAuto) next.lotNo = newAuto
      return next
    })
  }

  // ตอน mount: ถ้าโปรไฟล์มี machine + custCode แต่ lot ว่าง → เติมให้เลย
  useEffect(() => {
    if (!p.lotNo?.trim() && p.machine_no && p.custCode) {
      const auto = genLotNo(p.machine_no, p.custCode)
      if (auto) setP(prev => ({ ...prev, lotNo: auto }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hasJob = !!(profile.lotNo && profile.productName) // มีงานอยู่แล้ว

  async function parkJob() {
    if (!parkBy.trim()) { alert('กรุณากรอกชื่อผู้จอดงาน'); return }
    setParking(true)
    try {
      // บันทึก snapshot ลง parked_jobs — รองรับหลายงานต่อเครื่อง (unique: machine_no + lot_no)
      const { error: parkErr } = await supabase.from('parked_jobs').upsert(
        { machine_no: profile.machine_no, lot_no: profile.lotNo, profile_snapshot: profile, parked_by: parkBy.trim(), parked_at: new Date().toISOString() },
        { onConflict: 'machine_no,lot_no' }
      )
      // ⚠ ถ้าบันทึก parked ไม่สำเร็จ → หยุด ห้ามล้างงานออกจากเครื่อง (กันงานหาย)
      if (parkErr) { alert('จอดงานไม่สำเร็จ — งานยังอยู่ที่เครื่อง:\n' + parkErr.message); setParking(false); return }
      // เคลียร์งานออกจากเครื่อง (เหลือแค่ machine_no + section)
      await supabase.from('machine_profiles').upsert({
        machine_no: profile.machine_no, section: profile.section ?? 'blow',
        decimal_places: profile.decimal, core_weight: profile.coreWeight,
        cust_code:'', cust_name:'', cust_branch:'', cust_address:'', mat_code:'', product_code:'',
        product_name:'', width_cm:'', thick_mc:'', lot_no:'', length:'', pcs:'',
        inspector:'', planned_qty:'', label_size: profile.labelSize ?? 'long',
        header_text:'', blank_header: false, locked: false,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'machine_no' })
      onParked?.()
    } catch (e: any) {
      alert('จอดงานไม่สำเร็จ: ' + e?.message)
    } finally { setParking(false) }
  }

  // แผนกกรอ (rewind): ไม่บังคับ WO / SO / ยอดสั่งผลิต — เพราะส่วนใหญ่ใช้ "ตั้งค่าชั่งเอง"
  const isRewind = p.section === 'rewind'
  const ok = p.machine_no && p.custName && p.productName && (p.itemCode || p.matCode) && p.lotNo
    && (isRewind || (p.plannedQty && p.woNo))
  // เตือนถ้า Lot ซ้ำกับงานเก่าที่จอดไว้
  const lotSameAsParked = hasJob && p.lotNo && profile.lotNo && p.lotNo === profile.lotNo

  async function save() {
    if (!ok) {
      const missing = [
        !p.machine_no  && 'หมายเลขเครื่อง',
        !isRewind && !p.woNo        && 'เลขใบคำสั่งผลิต (WO)',
        !p.custName    && 'ชื่อลูกค้า',
        !p.productName && 'ชื่อสินค้า',
        !p.itemCode && !p.matCode && 'Item Code หรือ Mat Code',
        !p.lotNo       && 'Lot No',
        !isRewind && !p.plannedQty  && 'ยอดสั่งผลิต',
      ].filter(Boolean).join(', ')
      alert('กรอกข้อมูลให้ครบก่อน: ' + missing)
      return
    }
    // ── M4: hard-check Lot ซ้ำกับงานที่มีม้วนชั่งไปแล้ว — ป้องกันยอดงานใหม่รวมกับงานเก่า ──
    if (p.lotNo && p.machine_no) {
      const { count } = await supabase.from('production_rolls')
        .select('*', { count: 'exact', head: true })
        .eq('machine_no', p.machine_no)
        .eq('lot_no', p.lotNo)
      if (count && count > 0) {
        const proceed = confirm(
          `⚠ Lot "${p.lotNo}" บนเครื่อง ${p.machine_no} มีม้วนชั่งไปแล้ว ${count} ม้วน\n\n` +
          `ถ้ายืนยันต่อ ม้วนที่จะชั่งต่อไปจะถูกนับรวมกับ lot เดิม (เหมาะกับการรับงานต่อเท่านั้น)\n\n` +
          `กด OK = รับช่วงต่อ lot เดิม / Cancel = แก้เป็น Lot ใหม่`
        )
        if (!proceed) return
      }
    }
    setSaving(true)
    try {
      const { error } = await supabase.from('machine_profiles').upsert({
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
        header_text:   p.headerText ?? '',
        blank_header:  p.blankHeader ?? false,
        section:       p.section ?? 'blow',
        sale_order:    p.soNo ?? '',
        work_order:    p.woNo ?? '',
        delivery_date: p.deliveryDate || null,
        fresh_start:   p.freshStart ?? false,
        updated_at:    new Date().toISOString(),
      }, { onConflict: 'machine_no' })
      if (error) throw new Error(error.message)
      // จำ Mat Code / แกน / ชื่อสินค้า ที่พิมพ์เอง กลับเข้า master (เฉพาะตอน master ว่าง)
      backfillProductMatCore(p.itemCode, p.matCode, p.coreWeight, p.productName, (p as any).productCode)
      // จำลูกค้าที่พิมพ์เอง → เพิ่มเข้าคลังลูกค้าอัตโนมัติ
      backfillCustomer(p.custName, p.custCode)
      saveAllSuggestions(p)
      onSaved()
    } catch (e: any) {
      alert('บันทึกไม่สำเร็จ: ' + (e?.message ?? JSON.stringify(e)))
    } finally { setSaving(false) }
  }

  // helper inline เพื่อไม่ให้ re-mount input
  const inp = (label: string, k: keyof MachineProfile, ph = '', half = false) => {
    const listId = `bwp-list-${k}`
    const sugs = loadSuggestions(k)
    return (
      <div className={half ? '' : 'col-span-2'}>
        <label className="block text-[10px] text-slate-500 mb-1" htmlFor={`bwp-${k}`}>{label}</label>
        <input
          id={`bwp-${k}`}
          name={`bwp_${k}`}
          autoComplete="on"
          list={sugs.length > 0 ? listId : undefined}
          value={(p[k] as string) ?? ''}
          onChange={e => {
            const val = e.target.value
            if (k === 'matCode') {
              // พิมพ์ Mat Code ตรงกับสินค้า → เด้งข้อมูลให้เลย
              const m = products.find(x => (x.mat_code ?? '').trim().toLowerCase() === val.trim().toLowerCase() && val.trim() !== '')
              if (m) {
                setManyWithLot({
                  matCode:     val,
                  itemCode:    m.item_code,
                  productCode: m.product_code,
                  productName: m.product_name,
                  widthCm:     m.width_cm,
                  widthUnit:   (m.width_unit ?? 'cm') as 'cm'|'mm',
                  thickMc:     m.thick_mc,
                  custCode:    m.cust_code,
                  custName:    m.cust_name ?? '',
                  custAddress: m.cust_address ?? '',
                  coreWeight:  m.core_weight ?? '',
                })
                return
              }
            }
            setP(prev => ({ ...prev, [k]: val }))
          }}
          placeholder={ph}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500"
        />
        {sugs.length > 0 && (
          <datalist id={listId}>
            {sugs.map(s => <option key={s} value={s}/>)}
          </datalist>
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-800 shrink-0 flex items-center justify-between">
          <div>
            <p className="text-white font-bold">กรอกข้อมูลงานใหม่ — เครื่อง {p.machine_no}</p>
            <p className="text-slate-400 text-xs">เครื่องนี้ว่าง — กรอกข้อมูลงานก่อนเริ่มชั่ง</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-3">
          {/* ── งานครั้งนี้ — SO + Item Code อยู่แถวเดียวกัน ───── */}
          <p className="text-brand-400 text-[10px] font-bold uppercase tracking-wider">
            งานครั้งนี้ <span className="text-emerald-400 normal-case">(เลือก Item Code → เติมสินค้า+ลูกค้าให้อัตโนมัติ)</span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            {!isRewind && inp('เลขใบคำสั่งผลิต (WO) *', 'woNo', '', true)}
            {!isRewind && inp('Sale Order (SO)', 'soNo', '', true)}
            {/* วันที่ส่งของ — เฉพาะแผนกผลิต (เป่า/พิมพ์) */}
            {!isRewind && (
              <div>
                <label className="block text-[10px] text-slate-500 mb-1">📅 วันที่ส่งของ</label>
                <input type="date"
                  value={p.deliveryDate ?? ''}
                  onChange={e => setP(prev => ({ ...prev, deliveryDate: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500"/>
              </div>
            )}
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Item Code *</label>
              <ItemCodePicker
                value={p.itemCode}
                products={products}
                onChange={v => {
                  const match = products.find(x => x.item_code === v.trim())
                  if (match) {
                    setManyWithLot({
                      itemCode:    match.item_code,
                      productCode: match.product_code,
                      productName: match.product_name,
                      widthCm:     match.width_cm,
                      widthUnit:   (match.width_unit ?? 'cm') as 'cm'|'mm',  // ใช้หน่วยตามที่ master ตั้งไว้
                      thickMc:     match.thick_mc,
                      custCode:    match.cust_code,
                      custName:    match.cust_name ?? '',
                      custAddress: match.cust_address ?? '',
                      matCode:     match.mat_code ?? '',     // auto จาก DB (ไม่มี = เว้นว่างกรอกเอง)
                      coreWeight:  match.core_weight ?? '',  // auto น้ำหนักแกน
                    })
                  } else {
                    setMany({
                      itemCode: v,
                      productCode:'', productName:'',
                      widthCm:'', thickMc:'',
                      custCode:'', custName:'', custAddress:'',
                      matCode:'', coreWeight:'',
                    })
                  }
                }}
                onPick={s => setManyWithLot({
                  itemCode:    s.item_code,
                  productCode: s.product_code,
                  productName: s.product_name,
                  widthCm:     s.width_cm,
                  widthUnit:   (s.width_unit ?? 'cm') as 'cm'|'mm',  // ใช้หน่วยตามที่ master ตั้งไว้
                  thickMc:     s.thick_mc,
                  custCode:    s.cust_code,
                  custName:    s.cust_name ?? '',
                  custAddress: s.cust_address ?? '',
                  matCode:     s.mat_code ?? '',     // auto จาก DB
                  coreWeight:  s.core_weight ?? '',  // auto น้ำหนักแกน
                })}
              />
              {/* ── Item Code นี้ยังไม่มีในระบบ → เพิ่มเข้าฐานข้อมูลได้เลย ── */}
              {(p.itemCode ?? '').trim() && !products.some(x => x.item_code === (p.itemCode ?? '').trim()) && (
                <button type="button"
                  onClick={async () => {
                    if (!(p.productName ?? '').trim()) { alert('กรอกชื่อสินค้าก่อน จึงจะบันทึกเป็นสินค้าใหม่ได้'); return }
                    const r = await addProductIfMissing({
                      item_code: p.itemCode ?? '', product_code: p.productCode ?? '', product_name: p.productName ?? '',
                      width_cm: p.widthCm ?? '', width_unit: p.widthUnit ?? 'cm', thick_mc: p.thickMc ?? '',
                      cust_code: p.custCode ?? '', mat_code: p.matCode ?? '', core_weight: p.coreWeight ?? '',
                    })
                    if (r.ok) { alert(r.added ? `✓ เพิ่มสินค้า "${p.itemCode}" เข้าระบบแล้ว` : 'สินค้านี้มีอยู่แล้ว'); fetchProducts().then(setProducts) }
                    else alert('เพิ่มไม่สำเร็จ: ' + r.error)
                  }}
                  className="mt-1 w-full bg-emerald-600/90 hover:bg-emerald-500 text-white text-xs font-bold py-1.5 rounded-lg flex items-center justify-center gap-1">
                  ➕ Item Code นี้ยังไม่มีในระบบ — บันทึกเป็นสินค้าใหม่
                </button>
              )}
            </div>
            {inp('Mat Code',     'matCode', '',      true)}
            {/* Lot No — กดปุ๊ป auto-gen ทันที (ถ้าว่าง), แก้ได้ */}
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Lot No * <span className="text-emerald-400 normal-case">(คลิกช่อง → สร้างให้อัตโนมัติ)</span></label>
              <input
                value={p.lotNo ?? ''}
                onChange={e => setP(prev => ({ ...prev, lotNo: e.target.value }))}
                onFocus={() => {
                  if ((p.lotNo ?? '').trim()) return
                  const auto = genLotNo(p.machine_no ?? '', p.custCode ?? '')
                  if (auto) setP(prev => ({ ...prev, lotNo: auto }))
                }}
                placeholder="คลิกเพื่อสร้างอัตโนมัติ หรือพิมพ์เอง..."
                className="w-full bg-slate-800 border-2 border-brand-500/40 hover:border-brand-500 focus:border-brand-500 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none font-mono cursor-pointer"
              />
            </div>
            {/* เริ่มนับม้วนใหม่ — กรณี SO เดียวกันคนละ WO ใน Lot เดียวกัน */}
            {!isRewind && (
              <label className="col-span-2 flex items-start gap-2 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 cursor-pointer">
                <input type="checkbox" checked={!!p.freshStart}
                  onChange={e => setP(prev => ({ ...prev, freshStart: e.target.checked }))}
                  className="w-4 h-4 mt-0.5"/>
                <span className="text-xs">
                  <span className="text-white font-bold">▶ เริ่มนับม้วนใหม่ (เริ่ม Roll 1)</span>
                  <span className="block text-[10px] text-slate-500">เปิดเมื่อ SO เดียวกันแต่คนละ WO ใน Lot เดียวกัน — ไม่ต่อจากม้วนของ WO เดิม</span>
                </span>
              </label>
            )}
            {inp('Length (M.)',  'length',  '',          true)}
            {!isRewind && inp('ยอดสั่งผลิต (kg) *','plannedQty', '', true)}
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">ทศนิยม</label>
              <div className="flex gap-1">
                {([1,2] as const).map(d => (
                  <button key={d} onMouseDown={e => { e.preventDefault(); setP(prev => ({...prev, decimal: d})) }}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold ${p.decimal===d ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                    {d} ตำแหน่ง
                  </button>
                ))}
              </div>
            </div>
          </div>
          {lotSameAsParked && (
            <div className="bg-red-900/20 border border-red-500/40 rounded-lg px-3 py-2 text-xs text-red-400">
              ⚠️ Lot นี้เหมือนงานปัจจุบัน — ม้วนเก่าจะนับรวมด้วย กรุณาใช้ Lot ใหม่
            </div>
          )}

          {/* ── สินค้า (auto-fill ได้) ────────────────────────── */}
          <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider pt-2">รายละเอียดสินค้า</p>
          <div className="grid grid-cols-2 gap-2">
            {/* Product Code — removed */}
            {inp('ชื่อสินค้า (Product Name) *',  'productName', 'พิมพ์ชื่อสินค้าเองได้ ถ้าไม่มี')}
            {/* กว้าง + toggle cm/mm */}
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">กว้าง *</label>
              <div className="flex gap-1">
                <input value={p.widthCm ?? ''} onChange={e => setP(prev => ({ ...prev, widthCm: e.target.value }))}
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500" />
                {(['cm','mm'] as const).map(u => (
                  <button key={u} type="button"
                    onMouseDown={e => {
                      e.preventDefault()
                      const cur = (p.widthUnit ?? 'cm') as 'cm'|'mm'
                      if (cur !== u) {
                        setP(prev => ({ ...prev, widthCm: convertWidth(prev.widthCm ?? '', cur, u), widthUnit: u }))
                      } else {
                        setP(prev => ({ ...prev, widthUnit: u }))
                      }
                    }}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-bold ${
                      (p.widthUnit ?? 'cm') === u ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}>{u}</button>
                ))}
              </div>
            </div>
            {inp('หนา (mc)',      'thickMc',     '',            true)}
          </div>

          {/* ── ลูกค้า (auto-fill ได้) ────────────────────────── */}
          <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider pt-2">ลูกค้า</p>
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-2">
              <label className="block text-[10px] text-slate-500 mb-1">รหัส</label>
              <input value={p.custCode ?? ''} onChange={e => setP(prev => {
                  const newCode = e.target.value.slice(0,3)
                  const next = { ...prev, custCode: newCode }
                  if (next.machine_no && isAutoLotPattern(prev.lotNo ?? '', prev.machine_no ?? '')) {
                    const newAuto = genLotNo(next.machine_no, newCode)
                    if (newAuto) next.lotNo = newAuto
                  }
                  return next
                })}
                maxLength={3}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500 font-mono"/>
            </div>
            <div className="col-span-7">
              <label className="block text-[10px] text-slate-500 mb-1">ชื่อลูกค้า *</label>
              <input value={p.custName ?? ''} onChange={e => setP(prev => ({ ...prev, custName: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500"/>
            </div>
            <div className="col-span-3">
              <label className="block text-[10px] text-slate-500 mb-1">สาขา</label>
              <input value={p.custBranch ?? ''} onChange={e => setP(prev => ({ ...prev, custBranch: e.target.value }))}
                placeholder="เช่น สำนักงานใหญ่"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500"/>
            </div>
          </div>

          <p className="text-brand-400 text-[10px] font-bold uppercase tracking-wider pt-2">เครื่อง</p>
          <div className="grid grid-cols-2 gap-2">
            {inp('Core Weight (kg)',   'coreWeight', '', true)}
            {inp('ผู้ตรวจสอบ',        'inspector',  '',     true)}
            <div className="col-span-2">
              <label className="block text-[10px] text-slate-500 mb-1">ใบปะหน้า</label>
              <div className="flex gap-1">
                {(['long','short'] as const).map(s => (
                  <button key={s} onMouseDown={e => { e.preventDefault(); setP(prev => ({...prev, labelSize: s})) }}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold ${p.labelSize===s ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                    {s === 'long' ? 'ยาว 165×70' : 'สั้น 76×76'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {p.labelSize === 'short' && (
            <div className="col-span-2 space-y-1.5">
              <label className="flex items-center gap-2 cursor-pointer select-none"
                onMouseDown={e => { e.preventDefault(); setP(prev => ({...prev, blankHeader: !prev.blankHeader})) }}>
                <input type="checkbox" readOnly checked={!!p.blankHeader}
                  className="w-4 h-4 accent-brand-500 pointer-events-none"/>
                <span className="text-xs text-slate-300">เว้นหัวกระดาษว่าง (ไม่พิมพ์ชื่อบริษัท)</span>
              </label>
              {!p.blankHeader && (
                <input value={p.headerText ?? ''} onChange={e => setP(prev => ({...prev, headerText: e.target.value}))}
                  placeholder="ปล่อยว่าง = ใช้ชื่อบริษัท BWP"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500" />
              )}
            </div>
          )}
        </div>

        <div className="px-5 pt-3 pb-0 border-t border-slate-800 shrink-0">
          {/* ปุ่มจอดงาน — แสดงเฉพาะเมื่อมีงานอยู่ */}
          {hasJob && (
            <div className="mb-3">
              {!showPark ? (
                <button onClick={() => setShowPark(true)}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-colors">
                  🅿 จอดงานนี้ไว้ก่อน (แทรกงานด่วน)
                </button>
              ) : (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-2">
                  <p className="text-amber-300 text-xs font-bold">🅿 จอดงาน "{profile.productName}" ไว้ก่อน</p>
                  <input value={parkBy} onChange={e => setParkBy(e.target.value)}
                    placeholder="ชื่อผู้จอดงาน *"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-amber-500"/>
                  <div className="flex gap-2">
                    <button onClick={() => setShowPark(false)}
                      className="flex-1 py-1.5 rounded-lg text-xs text-slate-400 bg-slate-800 hover:bg-slate-700">ยกเลิก</button>
                    <button onClick={parkJob} disabled={parking}
                      className="flex-[2] py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50">
                      {parking ? 'กำลังจอด...' : '✓ จอดงาน + เปิดรับงานใหม่'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-2 px-5 py-3 shrink-0">
          <button onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-400 py-2.5 rounded-xl text-sm">ยกเลิก</button>
          <button onClick={save} disabled={!ok || saving}
            className="flex-[2] bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white py-2.5 rounded-xl font-bold">
            {saving ? 'บันทึก...' : '✓ บันทึก + พร้อมใช้งาน'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Offline Queue ─────────────────────────────────────────────────────────────
const QUEUE_KEY = 'bwp_offline_queue'
function loadQueue(): any[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') } catch { return [] }
}
function saveQueue(q: any[]) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)) }

// ── Weigh Page ────────────────────────────────────────────────────────────────
function WeighPage({ profile: initialProfile, onBack }: { profile: MachineProfile; onBack: () => void }) {
  // เก็บ profile เป็น state + refresh จาก DB ตอน mount — กันใช้ข้อมูล cached เก่า (เช่น widthUnit ไม่ตรง)
  const [profile, setProfile] = useState<MachineProfile>(initialProfile)
  useEffect(() => {
    if (!initialProfile.machine_no) return
    // ⚠ ไม่ refresh ในแผนกกรอ (rework_job mode) — profile มาจาก job ไม่ใช่ machine_profiles
    if (initialProfile.section === 'rewind') return
    supabase.from('machine_profiles').select('*').eq('machine_no', initialProfile.machine_no).maybeSingle()
      .then(({ data }) => {
        if (!data) return
        setProfile({
          machine_no:  data.machine_no,
          custCode:    data.cust_code    ?? '',
          custName:    data.cust_name    ?? '',
          custBranch:  data.cust_branch  ?? '',
          custAddress: data.cust_address ?? '',
          decimal:    (data.decimal_places ?? 2) as 1|2,
          itemCode:    data.item_code    ?? '',
          matCode:     data.mat_code     ?? '',
          productCode: data.product_code ?? '',
          productName: data.product_name ?? '',
          widthCm:     data.width_cm     ?? '',
          widthUnit:   (data.width_unit  ?? 'cm') as 'cm'|'mm',
          thickMc:     data.thick_mc     ?? '',
          lotNo:       data.lot_no       ?? '',
          length:      data.length       ?? '',
          pcs:         data.pcs          ?? '',
          coreWeight:  data.core_weight  ?? '1.25',
          inspector:   data.inspector    ?? '',
          locked:      data.locked       ?? false,
          plannedQty:  data.planned_qty  ?? '',
          labelSize:  (data.label_size   ?? 'long') as 'long'|'short',
          headerText:  data.header_text  ?? '',
          blankHeader: data.blank_header ?? false,
          section:    (data.section      ?? 'blow') as 'blow'|'print'|'rewind',
          soNo:        data.sale_order   ?? '',
          woNo:        data.work_order   ?? '',
          deliveryDate: data.delivery_date ?? '',
          freshStart:  data.fresh_start  ?? false,
        })
      })
  }, [initialProfile.machine_no])
  const [gross,        setGross]        = useState(0)
  const [netMode,      setNetMode]      = useState(false)  // กรอ: กรอกน้ำหนักสุทธิเอง (Bridge ไม่ต่อ → ใส่หลังบ้าน)
  const [rawWeight,    setRawWeight]    = useState('')     // ข้อความดิบตอนพิมพ์เอง (กันพิมพ์ "." ไม่ติด)
  const [testRandomEnabled, setTestRandomEnabled] = useState(false)

  // โหลด feature flag "ปุ่มสุ่มค่าทดสอบ" จาก Admin → app_settings
  useEffect(() => {
    fetchFlag('enable_test_random').then(setTestRandomEnabled)
  }, [])
  // ── Scale Bridge (WebSocket) ─────────────────────────────────────────
  const [serialConnected, setSerialConnected] = useState(false)
  const [serialStable,    setSerialStable]    = useState(false)
  const [rawSerial,       setRawSerial]       = useState('')
  const [bridgeUrl,       setBridgeUrl]       = useState(() => localStorage.getItem('bwp_bridge_url') ?? 'ws://localhost:8080')
  const wsRef             = useRef<WebSocket | null>(null)
  const wsReconnectRef    = useRef<any>(null)
  const wsRetryCountRef   = useRef(0)
  const simModeRef        = useRef(false)   // true = ใช้ค่าจำลอง ไม่รับค่าจาก Bridge
  const [simMode, setSimMode] = useState(false)

  // ── เชื่อมต่อ Bridge (WebSocket) — auto-reconnect ────────────────
  function connectBridge() {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    try {
      const ws = new WebSocket(bridgeUrl)
      wsRef.current = ws
      let lastUpdate = 0
      ws.onopen = () => {
        console.log('[bridge] connected')
        localStorage.setItem('bwp_bridge_url', bridgeUrl)
        wsRetryCountRef.current = 0  // reset backoff
      }
      ws.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data)
          if (d.type !== 'weight') return
          // ถ้า bridge ยังไม่ได้ต่อเครื่องชั่ง → connected = false
          if (d.connected !== undefined) setSerialConnected(d.connected)
          // ⚠ ถ้า bridge บอกว่าเครื่องชั่งไม่ต่อ → ไม่ override gross (ให้ผู้ใช้สุ่ม/พิมพ์เองได้)
          if (d.connected === false) {
            if (awaitingClearRef.current) { awaitingClearRef.current = false; setAwaitingClear(false) }
            return
          }
          // ถ้ากำลังใช้โหมดจำลอง → ไม่ override ค่าจาก Bridge
          if (simModeRef.current) return
          // throttle update ทุก 150ms
          const now = Date.now()
          if (now - lastUpdate < 150) return
          lastUpdate = now
          // เก็บค่าเต็มจาก Bridge — ไม่ truncate ที่ state (จะ format ตอน display ด้วย fmt(x, dec))
          if (typeof d.value === 'number') {
            setGross(d.value)
            // ปลดล็อกกันเบิ้ล เมื่อยกของออกแล้ว (น้ำหนักตกต่ำกว่าครึ่งของม้วนที่เพิ่งชั่ง)
            if (awaitingClearRef.current && d.value < grossAtSaveRef.current * 0.5) {
              awaitingClearRef.current = false
              setAwaitingClear(false)
            }
          }
          setSerialStable(!!d.stable)
          setStable(!!d.stable)
          if (d.raw) setRawSerial(d.raw)
        } catch {}
      }
      ws.onclose = () => {
        setSerialConnected(false)
        // auto-reconnect ทุก 3 วินาที
        // exponential backoff: 3s, 6s, 12s, 24s, max 60s
        const delay = Math.min(60000, 3000 * Math.pow(2, wsRetryCountRef.current))
        wsRetryCountRef.current++
        wsReconnectRef.current = setTimeout(connectBridge, delay)
      }
      ws.onerror = () => { setSerialConnected(false) }
    } catch (e) {
      console.error('ws error', e)
      wsReconnectRef.current = setTimeout(connectBridge, 3000)
    }
  }

  function disconnectBridge() {
    if (wsReconnectRef.current) clearTimeout(wsReconnectRef.current)
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
    setSerialConnected(false)
    setSerialStable(false)
  }

  // ── เชื่อม Bridge อัตโนมัติตอนเปิดหน้า ────────────────────────
  useEffect(() => {
    connectBridge()
    return () => disconnectBridge()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [rollNo,       setRollNo]       = useState(1)
  const [saving,       setSaving]       = useState(false)
  const [lastRoll,     setLastRoll]     = useState<any>(null)
  // ── กันชั่งเบิ้ล: หลังบันทึกต้องยกของออก (น้ำหนักตก) ก่อนชั่งม้วนถัดไป ──
  const [awaitingClear, setAwaitingClear] = useState(false)
  const awaitingClearRef = useRef(false)
  const grossAtSaveRef   = useRef(0)
  const [weighedKg,    setWeighedKg]    = useState(0)
  const [weighedRolls, setWeighedRolls] = useState<any[]>([])
  const [showCloseModal, setShowCloseModal] = useState(false)
  const [closing,        setClosing]        = useState(false)
  const [inspector,    setInspector]    = useState('')
  const [inspectorSetAt, setInspectorSetAt] = useState<number>(0)
  const [showInspectorPrompt, setShowInspectorPrompt] = useState(true)
  const [inspectorInput, setInspectorInput] = useState(profile.inspector || '')

  // ── แผนกกรอ: สาเหตุที่ม้วนนี้เสีย/มาจากอะไร (กรอกตอนชั่งออก = กรอสำเร็จ) ──
  const isRework = profile.section === 'rewind'
  // กรอ: "รอบ" การกรอใน Lot+WO เดียวกัน — โชว์เลขม้วนเริ่ม 1 ใหม่ต่อรอบ (roll_no จริงยังต่อเนื่องกัน index ไม่ชน)
  const [reworkRound, setReworkRound]   = useState(1)
  const [reworkCause, setReworkCause]   = useState('')
  const [reworkLen, setReworkLen]       = useState('')   // ความยาว(เมตร)งานกรอ — กรอกเองได้ (งานเก่าไม่ได้เก็บ length)
  const [reworkJobId, setReworkJobId]   = useState<string | null>(null)
  useEffect(() => {
    if (!isRework || !profile.lotNo) return
    supabase.from('rework_jobs')
      .select('id, source_defect_reason')
      .eq('lot_no', profile.lotNo)
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data && data[0]) {
          setReworkJobId(data[0].id)
          setReworkCause(data[0].source_defect_reason ?? '')
        }
      })
  }, [isRework, profile.lotNo])

  // ── ม้วนต้นทางที่เบิกมา (ของสินค้านี้) + ความคืบหน้ากรอต่อม้วน ──
  const [srcRolls, setSrcRolls]   = useState<any[]>([])         // ม้วนเสียที่เบิกมา (reworking)
  const [selSrc, setSelSrc]       = useState<any | null>(null)  // ม้วนต้นทางที่กำลังกรอ
  const [selSrc2, setSelSrc2]     = useState<any | null>(null)  // ม้วนต้นทางที่ 2 (กรอต่อ — 2 ม้วน→1)
  const [srcProg, setSrcProg]     = useState<Record<string, number>>({})  // sourceId → กรอได้สะสม (kg)
  // ม้วนนอกระบบ (เอามาจากงานอื่น/ที่อื่น มาชั่งรวมในงานนี้)
  const [manualMode, setManualMode]       = useState(false)
  const [manualSrcText, setManualSrcText] = useState('')   // ที่มา (พิมพ์เอง)
  const [manualSrcKg, setManualSrcKg]     = useState('')   // หยิบมากี่โล

  async function loadSrcRolls() {
    if (!isRework) return
    const ic = (profile.itemCode ?? '').trim()
    if (!ic) return
    // ม้วนเสียที่เบิกมา = bad + reworking + สินค้าเดียวกัน
    const { data: src } = await supabase.from('production_rolls')
      .select('id, lot_no, roll_no, weight, core_weight, length, pcs, work_order, sale_order, remark, inbound_type, product_name, customer, width_cm, width_unit, thick_mc, machine_no, review_action_reason, review_decision_by, new_system')
      .eq('roll_type', 'bad').eq('item_code', ic).eq('rework_status', 'reworking')
      .order('created_at', { ascending: true })
    setSrcRolls(src ?? [])
    // กรอได้สะสมต่อม้วนต้นทาง = ม้วนดีของ lot นี้ที่อ้างอิง source roll
    const { data: good } = await supabase.from('production_rolls')
      .select('rework_source_roll_id, weight')
      .eq('lot_no', profile.lotNo).eq('roll_type', 'good')
    const prog: Record<string, number> = {}
    for (const g of good ?? []) {
      const k = g.rework_source_roll_id
      if (k) prog[k] = (prog[k] ?? 0) + (g.weight ?? 0)
    }
    setSrcProg(prog)
  }
  useEffect(() => { loadSrcRolls() }, [isRework, profile.itemCode, profile.lotNo])

  // กดเสร็จม้วนต้นทาง → ที่เหลือเป็นเศษ → ม้วนหายจากลิสต์ (กันชั่งซ้ำ)
  async function finishSource(s: any) {
    if (!confirm(`ม้วนต้นทาง Lot ${s.lot_no} #${s.roll_no} (${fmt(s.weight,dec)} Kg) กรอไม่ได้ → เป็นเศษทั้งม้วน?\n\nม้วนนี้จะหายจากลิสต์`)) return
    const { error } = await supabase.from('production_rolls')
      .update({ rework_status: 'reworked', rework_remark: `กรอไม่ได้ · เศษทั้งม้วน ${fmt(s.weight,dec)} Kg` })
      .eq('id', s.id)
    if (error) { alert('ปิดม้วนไม่สำเร็จ: ' + error.message); return }
    if (selSrc?.id === s.id) setSelSrc(null)
    loadSrcRolls()
  }

  function confirmInspector(name: string) {
    if (!name.trim()) return
    setInspector(name.trim())
    setInspectorSetAt(Date.now())
    setShowInspectorPrompt(false)
  }

  // เตือนทุก 4 ชั่วโมง
  const hoursSinceSet = inspectorSetAt ? (Date.now() - inspectorSetAt) / 3600000 : 999
  const isStale = inspector && hoursSinceSet >= 4
  // offline queue
  const [queue,      setQueue]      = useState<any[]>(loadQueue)
  const [syncing,    setSyncing]    = useState(false)

  // ── เตือนถ้าผู้ใช้กำลังจะปิด tab/refresh ขณะ queue ยังค้าง ──
  // ป้องกันข้อมูลม้วนหายเพราะ localStorage โดน clear / ใช้คอมเครื่องอื่น
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (queue.length === 0) return
      const msg = `⚠ ยังมีม้วน ${queue.length} ม้วนค้างใน offline queue — กดปุ่ม "💾 Export Queue" เพื่อสำรองก่อนปิด`
      e.preventDefault()
      e.returnValue = msg
      return msg
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [queue.length])

  // ── Export queue + failed log เป็น JSON file (กดจาก badge) ──
  function exportQueue() {
    const q = loadQueue()
    const failed = (() => { try { return JSON.parse(localStorage.getItem('bwp_weigh_log_failed') || '[]') } catch { return [] } })()
    if (!q.length && !failed.length) { alert('ไม่มีข้อมูลค้างให้ export'); return }
    const blob = new Blob([JSON.stringify({
      exported_at: new Date().toISOString(),
      machine_no:  profile.machine_no,
      lot_no:      profile.lotNo,
      queue:       q,
      failed_logs: failed,
    }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bwp_offline_queue_${profile.machine_no}_${profile.lotNo}_${Date.now()}.json`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // sync queue เมื่อออนไลน์
  useEffect(() => {
    async function flushQueue() {
      const q = loadQueue()
      if (!q.length || !navigator.onLine) return
      setSyncing(true)
      const remaining: any[] = []
      for (const item of q) {
        try {
          let { error } = await supabase.from('production_rolls').insert(item)
          // ถ้า roll_no ชน — gen ใหม่จาก DB แล้วลองอีกครั้ง
          if (error && (error as any).code === '23505') {
            const { data: existing } = await supabase.from('production_rolls')
              .select('roll_no, roll_type')
              .eq('machine_no', item.machine_no)
              .eq('lot_no', item.lot_no)
            const sameType = (existing ?? []).filter((x:any) => x.roll_type === item.roll_type)
            const taken = new Set(sameType.map((x:any) => x.roll_no).filter(Boolean))
            let n = 1; while (taken.has(n)) n++
            const retry = await supabase.from('production_rolls').insert({ ...item, roll_no: n })
            error = retry.error
          }
          if (error) remaining.push(item)
        } catch { remaining.push(item) }
      }
      saveQueue(remaining)
      setQueue(remaining)
      setSyncing(false)
    }
    flushQueue()
    window.addEventListener('online', flushQueue)
    return () => window.removeEventListener('online', flushQueue)
  }, [])

  const [weighType,    setWeighType]    = useState<'good'|'bad'|'scrap'>('good')
  // กันค้าง: ถ้าเข้า rewind แล้ว weighType='bad' (ม้วนกรอ) — บังคับกลับ 'good'
  useEffect(() => {
    if (profile.section === 'rewind' && weighType === 'bad') setWeighType('good')
  }, [profile.section, weighType])
  const [scrapSub,     setScrapSub]     = useState<'scrap_clear'|'scrap_color'|'scrap_lump'>('scrap_clear')
  const [badReason,    setBadReason]    = useState('')
  // ม้วนกรอ: ผลิตประเมินว่ากรอได้ (default) หรือ "รอพิจารณา" (ส่งให้ ผจก ตัดสิน)
  const [badMode,      setBadMode]      = useState<'rework'|'pending_review'>('rework')
  const [scrapReason,  setScrapReason]  = useState('')
  const [badRollNo,    setBadRollNo]    = useState(1)  // ม้วนกรอเริ่มที่ 1 ของงานนี้
  const [stable,       setStable]       = useState(true)
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  // กรอ: ใช้แกนจริงของม้วนต้นทางที่เลือก (fallback แกนของงาน/มาสเตอร์) — กัน Net เพี้ยน
  const srcCore   = (isRework && selSrc && (selSrc.core_weight ?? '').toString().trim()) ? parseFloat(String(selSrc.core_weight)) : NaN
  const core      = (!isNaN(srcCore) ? srcCore : parseFloat(profile.coreWeight)) || 0
  const dec       = profile.decimal
  const planned   = parseFloat(profile.plannedQty) || 0
  const net       = parseFloat(Math.max(0, gross - core).toFixed(dec))
  const remaining = Math.max(0, planned - weighedKg)
  const pct       = planned > 0 ? Math.min(100, Math.round((weighedKg / planned) * 100)) : 0
  const done      = planned > 0 && weighedKg >= planned
  // กรอ: เลขม้วนถัดไปที่จะ "โชว์" (เริ่ม 1 ใหม่ต่อรอบ) — roll_no จริงยังเป็น rollNo เดิม
  const reworkDispNo = isRework
    ? weighedRolls.filter((r:any)=>r?.roll_type==='good' && (r.rework_batch??1)===reworkRound).length + 1
    : rollNo
  // ── ยอดสรุป: ม้วนดี (FG) vs ม้วนดี+กรอ รวม ──
  const goodCnt   = weighedRolls.filter((r:any)=>r?.roll_type==='good').length
  const badCnt    = weighedRolls.filter((r:any)=>r?.roll_type==='bad').length
  const badKgSum  = weighedRolls.filter((r:any)=>r?.roll_type==='bad').reduce((s:number,r:any)=>s+(r?.weight??0),0)
  const goodPlusBadKg = weighedKg + badKgSum

  // หาเลขม้วนที่หายไปเลขแรก (เช่น มี 1,2,3,5 → คืน 4) — ถ้าไม่มีช่องว่าง คืน max+1
  function nextRollNo(rolls: any[]): number {
    const taken = new Set(rolls.map(r => r.roll_no).filter(n => n && n > 0))
    let i = 1
    while (taken.has(i)) i++
    return i
  }

  // โหลดม้วนทั้งหมดของ machine+lot นี้ — merge กับ offline queue เพื่อไม่ให้เลขม้วนชน
  function loadRollsForMachine() {
    supabase.from('production_rolls')
      .select('*')
      .eq('machine_no', profile.machine_no)
      .eq('lot_no', profile.lotNo)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (error) { console.warn('load rolls error:', error.message); return }
        // ── รวมม้วนที่ค้างใน offline queue (ของ machine+lot นี้เท่านั้น) ──
        const offlineForThis = loadQueue()
          .filter((q: any) => q.machine_no === profile.machine_no && q.lot_no === profile.lotNo)
          .map((q: any) => ({ ...q, id: `offline_${q.created_at}_${q.roll_no}`, _offline: true }))
        let merged = [...(data ?? []), ...offlineForThis]
        // freshStart (งานผลิตดึงกลับ): นับเฉพาะม้วนของ WO นี้
        // ⚠ งานกรอ: ห้ามกรองตาม WO — เพราะงานรวมข้ามไซส์มีหลาย WO ใน Lot เดียว
        //   เลขม้วนต้อง unique ทั้ง Lot ไม่งั้นแจกเลขซ้ำ (เช่น #12 ชนกัน)
        if ((profile as any).freshStart && !isRework) {
          merged = merged.filter((r: any) => (r.work_order ?? '') === (profile.woNo ?? ''))
        }
        // ชุดระบบใหม่ (กรอ): พอโอนแล้วม้วนหลุดจากจอชั่ง → เริ่มชุดใหม่ #1 สะอาด (ไม่โชว์ประวัติที่โอนไปแล้ว)
        if (isRework && (profile as any).newSystem) {
          merged = merged.filter((r: any) => !r.transferred)
        }
        if (!merged.length) {
          setRollNo(1); setBadRollNo(1); setWeighedRolls([]); setWeighedKg(0); return
        }
        const goodRolls = merged.filter((r: any) => r.roll_type === 'good')
        const total = goodRolls.reduce((s: number, r: any) => s + (r.weight ?? 0), 0)
        setWeighedKg(parseFloat(total.toFixed(dec)))
        setWeighedRolls(merged)
        // กรอ: ตั้งรอบปัจจุบัน = รอบล่าสุดที่มีในข้อมูล (ม้วนใหม่ต่อในรอบนั้น จนกว่าจะกดเริ่มรอบใหม่)
        if (isRework) setReworkRound(Math.max(1, ...merged.map((r:any)=>r.rework_batch ?? 1)))
        const badRolls = merged.filter((r: any) => r.roll_type === 'bad')
        // ใช้เลขที่หายไปก่อน เพื่อทดแทนม้วนที่ถูกลบ
        setRollNo(nextRollNo(goodRolls))
        setBadRollNo(nextRollNo(badRolls))
      })
  }

  useEffect(() => {
    loadRollsForMachine()
    setStable(true)

    // Realtime: อัปเดตสถานะ transferred ทันทีเมื่อโอนจากหน้าอื่น
    const channel = supabase.channel(`rolls-${profile.machine_no}-${profile.lotNo}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'production_rolls',
        filter: `machine_no=eq.${profile.machine_no}`,
      }, () => { loadRollsForMachine() })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // reload ม้วนเมื่อ freshStart/WO/Lot เปลี่ยน (profile โหลด async หลัง mount)
  useEffect(() => { loadRollsForMachine() }, [(profile as any).freshStart, profile.woNo, profile.lotNo]) // eslint-disable-line react-hooks/exhaustive-deps

  function clearAwaiting() {
    if (awaitingClearRef.current) { awaitingClearRef.current = false; setAwaitingClear(false) }
  }

  function startIdle() {
    if (timerRef.current) clearInterval(timerRef.current)
    clearAwaiting()
    setStable(true)   // idle = พร้อมกด
    setGross(0)
    timerRef.current = setInterval(() => {
      const noise = (Math.random() - 0.5) * 0.03
      setGross(parseFloat(Math.max(0, noise).toFixed(dec)))
    }, 200)
  }

  function readScale() {
    simModeRef.current = true
    setSimMode(true)
    clearAwaiting()
    if (timerRef.current) clearInterval(timerRef.current)
    const target = parseFloat((22 + Math.random() * 6).toFixed(dec))
    setGross(target)
    setStable(true)
    // jitter เบาๆ ให้เหมือนเครื่องชั่งจริง
    timerRef.current = setInterval(() => {
      const n = (Math.random() - 0.5) * 0.02
      setGross(parseFloat((target + n).toFixed(dec)))
    }, 250)
  }

  // คำนวณสรุปยอด
  const goodRolls = weighedRolls.filter((r:any)=>r?.roll_type==='good')
  const badRolls  = weighedRolls.filter((r:any)=>r?.roll_type==='bad')
  const scrapRolls= weighedRolls.filter((r:any)=>r?.roll_type?.startsWith?.('scrap'))

  // ตรวจ "เลขแหว่ง" — ม้วนถัดไปจะทดแทนหรือต่อเลขปกติ
  const goodMaxRoll = Math.max(0, ...goodRolls.map((r:any) => r.roll_no ?? 0))
  const badMaxRoll  = Math.max(0, ...badRolls.map((r:any)  => r.roll_no ?? 0))
  const isFillingGapGood = rollNo    < goodMaxRoll
  const isFillingGapBad  = badRollNo < badMaxRoll
  const transferredKg = goodRolls.filter((r:any)=>r.transferred).reduce((s:number,r:any)=>s+(r.weight??0),0)
  const goodKg    = goodRolls.reduce((s:number,r:any)=>s+(r.weight??0),0)
  const badKg     = badRolls.reduce((s:number,r:any)=>s+(r.weight??0),0)
  const scrapKg   = scrapRolls.reduce((s:number,r:any)=>s+(r.weight??0),0)
  const totalProduced = goodKg + badKg + scrapKg
  const yieldPct  = totalProduced > 0 ? Math.round(goodKg / totalProduced * 100) : 0

  function printJobSummary() {
    const win = window.open('', '_blank', 'width=900,height=700')
    if (!win) return
    const date  = new Date().toLocaleDateString('th-TH')
    const time  = new Date().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Sarabun','Tahoma',sans-serif;font-size:11pt;color:#000;padding:10mm}
.head{text-align:center;border-bottom:2px solid #000;padding-bottom:3mm;margin-bottom:4mm}
.head h1{font-size:14pt;font-weight:800}
.head h2{font-size:18pt;font-weight:900;margin-top:2mm}
.box{border:1px solid #aaa;padding:3mm 4mm;margin-bottom:3mm}
.box h3{font-size:11pt;font-weight:700;border-bottom:1px solid #ddd;padding-bottom:1.5mm;margin-bottom:2mm}
.row{display:flex;justify-content:space-between;padding:1mm 0;font-size:10pt}
.kpi{display:grid;grid-template-columns:repeat(3,1fr);gap:3mm;margin-bottom:3mm}
.kpi-box{border:1px solid #aaa;padding:3mm;text-align:center}
.kpi-box .lbl{font-size:8pt;color:#666;text-transform:uppercase}
.kpi-box .val{font-size:18pt;font-weight:800;color:#003087;margin-top:1mm}
.sign{display:flex;justify-content:space-around;margin-top:15mm;gap:10mm}
.sign-box{flex:1;text-align:center}
.sign-line{border-top:1px solid #000;margin-top:18mm;padding-top:1mm;font-size:9pt}
@media print{@page{size:A4;margin:10mm}}
</style></head><body>
<div class="head">
  <h1>บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด</h1>
  <h2>สรุปการผลิต — Production Report</h2>
  <p style="font-size:9pt;color:#555">วันที่ปิดงาน ${date} ${time}</p>
</div>
<div class="box">
  <h3>ข้อมูลงาน</h3>
  <div class="row"><span>เลขใบคำสั่งผลิต (WO)</span><b style="color:#d97706">${profile.woNo || '—'}</b></div>
  <div class="row"><span>Sale Order (SO)</span><b style="color:#2563eb">${profile.soNo || '—'}</b></div>
  <div class="row"><span>วันที่ส่งของ</span><b>${profile.deliveryDate ? new Date(profile.deliveryDate).toLocaleDateString('th-TH') : '—'}</b></div>
  <div class="row"><span>ลูกค้า</span><b>${profile.custName}</b></div>
  <div class="row"><span>สินค้า</span><b>${profile.productName}</b></div>
  <div class="row"><span>Item Code</span><b>${profile.itemCode || '—'}</b></div>
  <div class="row"><span>Mat Code</span><b>${profile.matCode || '—'}</b></div>
  <div class="row"><span>Lot No</span><b>${profile.lotNo}</b></div>
  <div class="row"><span>เครื่อง</span><b>${profile.machine_no}</b></div>
  <div class="row"><span>ขนาด</span><b>${profile.widthCm} ${profile.widthUnit ?? 'cm'} × ${profile.thickMc} mc</b></div>
</div>
<div class="kpi">
  <div class="kpi-box"><div class="lbl">ยอดสั่ง</div><div class="val">${planned.toLocaleString('th-TH')}</div><div style="font-size:8pt">Kgs.</div></div>
  <div class="kpi-box" style="background:#e8f5e9"><div class="lbl">ผลิตดี</div><div class="val">${goodKg.toLocaleString('th-TH',{minimumFractionDigits:2})}</div><div style="font-size:8pt">${goodRolls.length} ม้วน</div></div>
  <div class="kpi-box" style="background:#fff3e0"><div class="lbl">Yield</div><div class="val">${yieldPct}%</div></div>
</div>
<div class="box">
  <h3>รายละเอียดการผลิต</h3>
  <div class="row"><span>ม้วนดี</span><b style="color:#1976d2">${goodKg.toLocaleString('th-TH',{minimumFractionDigits:2})} Kgs. (${goodRolls.length} ม้วน)</b></div>
  <div class="row"><span>ม้วนกรอ</span><b style="color:#f57c00">${badKg.toLocaleString('th-TH',{minimumFractionDigits:2})} Kgs. (${badRolls.length} ม้วน)</b></div>
  <div class="row"><span>เศษเสีย</span><b style="color:#d32f2f">${scrapKg.toLocaleString('th-TH',{minimumFractionDigits:2})} Kgs. (${scrapRolls.length} ถุง)</b></div>
  <div class="row" style="border-top:1px solid #000;padding-top:2mm;margin-top:1mm;font-size:12pt">
    <span><b>รวมทั้งหมด</b></span><b>${totalProduced.toLocaleString('th-TH',{minimumFractionDigits:2})} Kgs.</b>
  </div>
</div>
<div class="box">
  <h3>การโอนเข้าคลัง</h3>
  <div class="row"><span>โอนไปแล้ว</span><b style="color:#2e7d32">${transferredKg.toLocaleString('th-TH',{minimumFractionDigits:2})} Kgs.</b></div>
  <div class="row"><span>ยังไม่โอน</span><b>${(goodKg-transferredKg).toLocaleString('th-TH',{minimumFractionDigits:2})} Kgs.</b></div>
</div>
<div class="sign">
  <div class="sign-box"><div class="sign-line"></div><div><b>${inspector||'—'}</b></div><div style="font-size:9pt;color:#555">ผู้ตรวจสอบ</div></div>
  <div class="sign-box"><div class="sign-line"></div><div>...........................</div><div style="font-size:9pt;color:#555">หัวหน้างาน</div></div>
  <div class="sign-box"><div class="sign-line"></div><div>...........................</div><div style="font-size:9pt;color:#555">ผู้อนุมัติ</div></div>
</div>
<script>window.onload=()=>{setTimeout(()=>window.print(),400)}<\/script>
</body></html>`)
    win.document.close()
  }

  async function handleCloseJob() {
    setClosing(true)
    try {
      // ── H6: ใช้ ground truth จาก DB ไม่ใช่ state ใน memory ──
      const { data: dbRolls, error: loadErr } = await supabase.from('production_rolls')
        .select('weight, roll_type, transferred')
        .eq('machine_no', profile.machine_no)
        .eq('lot_no', profile.lotNo)
      if (loadErr) throw loadErr
      const all = dbRolls ?? []
      const dbGood  = all.filter((r:any) => r.roll_type === 'good')
      const dbBad   = all.filter((r:any) => r.roll_type === 'bad')
      const dbScrap = all.filter((r:any) => typeof r.roll_type === 'string' && r.roll_type.startsWith('scrap'))
      const dbGoodKg  = dbGood.reduce((s:number,r:any)=>s+(r.weight??0), 0)
      const dbBadKg   = dbBad.reduce((s:number,r:any)=>s+(r.weight??0), 0)
      const dbScrapKg = dbScrap.reduce((s:number,r:any)=>s+(r.weight??0), 0)
      const dbTransferredKg = dbGood.filter((r:any)=>r.transferred).reduce((s:number,r:any)=>s+(r.weight??0), 0)
      const dbTotal = dbGoodKg + dbBadKg + dbScrapKg
      const dbYield = dbTotal > 0 ? Math.round(dbGoodKg / dbTotal * 100) : 0

      // ── เตือนถ้ายังมี offline queue ค้าง (ม้วนยังไม่ sync = สรุปยังไม่ครบ) ──
      const pendingForLot = loadQueue().filter((q:any) => q.machine_no === profile.machine_no && q.lot_no === profile.lotNo)
      if (pendingForLot.length > 0) {
        if (!confirm(`⚠ ยังมีม้วน ${pendingForLot.length} ม้วนค้าง offline ของ lot นี้\nสรุปยอดอาจไม่ครบ — ปิดงานต่อหรือไม่?`)) {
          setClosing(false); setShowCloseModal(false); return
        }
      }

      // ── 1) บันทึก job_summaries ก่อน (ground truth จาก DB + snapshot profile) ──
      await supabase.from('job_summaries').insert({
        machine_no:     profile.machine_no,
        lot_no:         profile.lotNo,
        sale_order:     profile.soNo ?? '',
        work_order:     profile.woNo ?? '',
        delivery_date:  profile.deliveryDate || null,
        product_name:   profile.productName,
        customer:       profile.custName,
        item_code:      profile.itemCode,
        mat_code:       profile.matCode,
        planned_qty:    planned,
        good_kg:        parseFloat(dbGoodKg.toFixed(2)),
        good_rolls:     dbGood.length,
        bad_kg:         parseFloat(dbBadKg.toFixed(2)),
        bad_rolls:      dbBad.length,
        scrap_kg:       parseFloat(dbScrapKg.toFixed(2)),
        transferred_kg: parseFloat(dbTransferredKg.toFixed(2)),
        yield_pct:      dbYield,
        closed_at:      new Date().toISOString(),
        closed_by:      inspector || null,
        inspector:      inspector || null,
      })

      // ── 1.5) ถ้าเป็นงานกรอ — ปิด rework_job ของ lot นี้ด้วย (ไม่งั้นการ์ดยังค้างใน "งานกรอ") ──
      if (isRework && profile.lotNo) {
        const upd = supabase.from('rework_jobs')
          .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: inspector || null })
          .eq('lot_no', profile.lotNo).eq('status', 'active')
        await (reworkJobId ? upd.eq('id', reworkJobId) : upd)
      }

      // ── 2) พิมพ์ใบสรุป — ตรวจว่า popup เปิดได้ก่อนเคลียร์ profile ──
      const win = window.open('', '_blank', 'width=900,height=700')
      if (!win) {
        if (!confirm('⚠ Browser block popup ทำให้พิมพ์ใบสรุปไม่ได้\nงานถูกบันทึกใน job_summaries แล้ว — ดำเนินการเคลียร์เครื่องต่อหรือไม่?\n(กด Cancel เพื่อพิมพ์ใบสรุปก่อนจาก History)')) {
          setClosing(false); setShowCloseModal(false); return
        }
      } else {
        win.close()  // ปิด popup ทดสอบ — เปิดของจริงในฟังก์ชัน
        printJobSummary()
      }

      // ── 3) เคลียร์ข้อมูลงาน (เก็บแต่ machine_no, core_weight, label_size, locked) ──
      await supabase.from('machine_profiles').update({
        cust_code: '', cust_name: '', cust_branch: '', cust_address: '',
        item_code: '', mat_code: '', product_code: '', product_name: '',
        width_cm: '', thick_mc: '',
        lot_no: '', length: '', pcs: '',
        planned_qty: '',
        inspector: '',
      }).eq('machine_no', profile.machine_no)
      alert('✓ ปิดงานสำเร็จ — เครื่อง ' + profile.machine_no + ' พร้อมรับงานใหม่ (กรอกข้อมูลที่หน้าตั้งค่า)')
      onBack()
    } catch (e: any) {
      alert('ปิดงานไม่สำเร็จ: ' + (e?.message ?? e))
    } finally {
      setClosing(false)
      setShowCloseModal(false)
    }
  }

  const isScrap = weighType === 'scrap'
  const isGood  = weighType === 'good'
  const isBad   = weighType === 'bad'
  // เศษใช้ gross โดยตรง (มาเป็นถุง ไม่หักแกน), ม้วนดี/กรอใช้ net
  const saveWeight = isScrap ? gross : net

  async function handleSave() {
    if (saveWeight <= 0 || !stable) return
    // กันชั่งเบิ้ล: ถ้ายังไม่ยกของออกจากเครื่องชั่ง ห้ามบันทึกซ้ำ
    if (awaitingClearRef.current) {
      alert('⚠ ยกม้วนออกจากเครื่องชั่งก่อน แล้วรอน้ำหนักตกลง จึงชั่งม้วนถัดไปได้')
      return
    }
    if (!inspector.trim()) { setShowInspectorPrompt(true); return }
    if (isBad && !badReason.trim()) { alert('กรุณาระบุเหตุผลม้วนกรอ'); return }
    if (isScrap && !scrapReason.trim()) { alert('กรุณาระบุเหตุผลเศษเสีย'); return }
    if (isGood && isRework && srcRolls.length > 0 && !selSrc && !manualMode) { alert('กรุณาเลือกม้วนต้นทางที่กำลังกรอก่อน (ติ๊กด้านบน) หรือกด ➕ ม้วนนอกระบบ'); return }
    if (isGood && isRework && manualMode && !manualSrcText.trim()) { alert('กรุณากรอกที่มาของม้วนนอกระบบ'); return }
    if (isGood && isRework && selSrc && ((selSrc.weight ?? 0) - (srcProg[selSrc.id] ?? 0)) <= 0.001) {
      alert('ม้วนต้นทางนี้กรอครบแล้ว — เลือกม้วนอื่น หรือกด "🗑 เศษทั้งม้วน"'); return
    }
    if (isGood && isRework && !reworkCause.trim()) { alert('กรุณาระบุสาเหตุที่ม้วนนี้เสีย / มาจากอะไร'); return }

    setSaving(true)
    try {
      const actualType = isScrap ? scrapSub : weighType
      // ── ชุดระบบใหม่ (กรอ): เลขม้วนนับต่อ "สินค้า (item_code)" รีเซ็ตตามการโอน ──
      //   เลข = max(เลขม้วนของสินค้านี้ ที่เป็นชุดใหม่ + ยังไม่โอน) + 1
      //   พอโอนหมด → max=0 → เริ่ม #1 ใหม่อัตโนมัติ
      const isNewSysRoll = isRework && isGood && ((selSrc as any)?.new_system || (profile as any).newSystem)
      let nsRollNo = 0
      if (isNewSysRoll) {
        const ic = (profile.itemCode ?? '').trim()
        const { data: nsRows } = await supabase.from('production_rolls')
          .select('roll_no').eq('item_code', ic).eq('roll_type', 'good')
          .eq('new_system', true).eq('transferred', false)
        nsRollNo = Math.max(0, ...((nsRows ?? []).map((x:any) => x.roll_no ?? 0))) + 1
      }
      const useRollNo  = isNewSysRoll ? nsRollNo : (isBad ? badRollNo : isGood ? rollNo : 0)
      // หมายเหตุม้วนกรอ: หยิบม้วนต้นทางมากี่โล ชั่งได้กี่โล เศษกี่โล
      const useSrc = (isRework && isGood && selSrc) ? selSrc : null
      const useManual = (isRework && isGood && manualMode && manualSrcText.trim())
        ? { text: manualSrcText.trim(), kg: parseFloat(manualSrcKg) || 0 } : null
      // กรอต่อ: ม้วนต้นทางที่ 2 (รวม 2 ม้วน → ออก 1 ม้วน)
      const useSrc2 = (isRework && isGood && selSrc && selSrc2) ? selSrc2 : null
      const srcKg  = useSrc ? ((useSrc.weight ?? 0) + (useSrc2 ? (useSrc2.weight ?? 0) : 0)) : useManual ? useManual.kg : 0
      const cumKg  = useSrc ? (useSrc2 ? saveWeight : ((srcProg[useSrc.id] ?? 0) + saveWeight)) : saveWeight
      const scrapKg = Math.max(0, srcKg - cumKg)
      const reworkNote = useSrc2
        ? `🔁 กรอต่อ: Lot ${useSrc.lot_no} #${useSrc.roll_no} + Lot ${useSrc2.lot_no} #${useSrc2.roll_no} · หยิบมา ${fmt(srcKg,dec)} · ชั่งได้ ${fmt(cumKg,dec)} · เศษ ${fmt(scrapKg,dec)} Kg`
        : useSrc
        ? `🔁 กรอจาก Lot ${useSrc.lot_no} #${useSrc.roll_no} · หยิบมา ${fmt(srcKg,dec)} · ชั่งได้ ${fmt(cumKg,dec)} · เศษ ${fmt(scrapKg,dec)} Kg`
        : useManual
        ? `🔁 กรอแทนจาก ${useManual.text}${useManual.kg ? ` · หยิบมา ${fmt(srcKg,dec)} · ชั่งได้ ${fmt(cumKg,dec)} · เศษ ${fmt(scrapKg,dec)} Kg` : ''}`
        : (isRework && isGood ? `🔁 กรอจาก ${(profile as any).sourceLotNo ? `Lot ${(profile as any).sourceLotNo}` : 'ม้วนเสีย'}` : '')
      // ม้วนกรอ: ฝังเหตุผลที่ม้วนเสีย (มาจากม้วนต้นทาง) ต่อท้ายโน้ตกรอ ให้เห็นบนฉลาก/คลัง
      const reworkRemark = (isRework && isGood)
        ? [reworkNote, reworkCause.trim() ? `เหตุผล: ${reworkCause.trim()}` : ''].filter(Boolean).join(' · ')
        : reworkNote
      const rollRemark = isBad ? badReason : isScrap ? scrapReason : (reworkRemark || null)
      // อ้างอิง WO/SO: ม้วนในระบบ → ตามต้นทาง · ม้วนนอกระบบ → ออกเป็น Lot/ออเดอร์ที่กำลังชั่ง
      const useWo = useSrc ? (useSrc.work_order ?? profile.woNo ?? '') : (profile.woNo ?? '')
      const useSo = useSrc ? (useSrc.sale_order ?? profile.soNo ?? '') : (profile.soNo ?? '')
      // ความยาว/Pcs — fallback สุดท้ายดึงจาก "มาสเตอร์สินค้า" (products.length ผูก item_code) ✨
      // → ถ้าตั้งงาน/ม้วนต้นทางไม่มี ก็ได้จากมาสเตอร์เสมอ ไม่ต้อง backfill รายตัวอีก
      let masterLen = '', masterPcs = ''
      if (isGood && (profile.itemCode ?? '').trim()) {
        try {
          const { data: pm } = await supabase.from('products')
            .select('length, pcs').eq('item_code', (profile.itemCode ?? '').trim()).limit(1).maybeSingle()
          masterLen = (pm as any)?.length ?? ''; masterPcs = (pm as any)?.pcs ?? ''
        } catch { /* คอลัมน์ยังไม่ถูกเพิ่ม — ข้าม */ }
      }
      const lengthVal = (isRework && isGood)
        ? (reworkLen.trim() || String(useSrc?.length ?? '') || masterLen || '')
        : (profile.length || masterLen || '')
      const pcsVal = (isRework && isGood)
        ? (String(useSrc?.pcs ?? '') || masterPcs || '')
        : (profile.pcs || masterPcs || '')

      const payload = {
        job_id:       null,
        roll_no:      useRollNo,
        roll_type:    actualType,
        weight:       parseFloat(saveWeight.toFixed(dec)),
        gross_weight: gross,
        core_weight:  isScrap ? 0 : core,
        length:       lengthVal || null,
        pcs:          pcsVal || null,
        new_system:   isNewSysRoll || false,
        remark:       rollRemark,
        inspector:    inspector || null,
        machine_no:   profile.machine_no,
        lot_no:       profile.lotNo,
        sale_order:   useSo,
        work_order:   useWo,
        rework_source_roll_id: useSrc ? useSrc.id : null,
        rework_source_lot:     useSrc ? useSrc.lot_no : (useManual ? useManual.text : null),
        rework_source_weight:  (useSrc || useManual) ? srcKg : null,
        rework_batch:          isRework ? reworkRound : null,
        item_code:    profile.itemCode    ?? '',
        product_code: profile.productCode ?? '',
        mat_code:     profile.matCode     ?? '',
        product_name: profile.productName,
        customer:     profile.custName,
        section:      profile.section ?? 'blow',
        width_cm:     profile.widthCm || null,
        width_unit:   profile.widthUnit ?? 'cm',
        thick_mc:     profile.thickMc || null,
        // ม้วนกรอ "รอ ผจก พิจารณา" → set review_status (ม้วนอื่นเป็น null = ปกติ)
        review_status: (isBad && badMode === 'pending_review') ? 'pending_review' : null,
        created_at:   new Date().toISOString(),
      }

      let data: any = null
      let { data: inserted, error: insertErr } = await supabase
        .from('production_rolls').insert(payload).select().single()

      // ── ถ้า roll_no ชน (unique violation 23505) → reload + retry ครั้งเดียว ──
      if (insertErr && (insertErr as any).code === '23505') {
        console.warn('roll_no ชน — กำลังหาเลขใหม่...')
        const { data: existing } = await supabase.from('production_rolls')
          .select('roll_no, roll_type, work_order')
          .eq('machine_no', profile.machine_no)
          .eq('lot_no', profile.lotNo)
        const sameTypeRolls = (existing ?? []).filter((x:any) =>
          x.roll_type === actualType && (!(profile as any).freshStart || (x.work_order ?? '') === (profile.woNo ?? '')))
        const newRollNo = nextRollNo(sameTypeRolls)
        const retryPayload = { ...payload, roll_no: newRollNo }
        const retry = await supabase.from('production_rolls').insert(retryPayload).select().single()
        inserted = retry.data
        insertErr = retry.error
      }

      if (insertErr || !inserted) {
        // ── ออฟไลน์ / error อื่น → บันทึกลง queue ────────────────────────
        const offlineId = `offline_${Date.now()}_${Math.random().toString(36).slice(2)}`
        const offlineRecord = { ...payload, id: offlineId, _offline: true }
        const q = [...loadQueue(), payload]
        saveQueue(q)
        setQueue(q)
        data = offlineRecord
        console.warn('offline — queued:', offlineRecord, insertErr?.message)
      } else {
        data = inserted
      }

      setLastRoll({ ...data, weighType: actualType })
      setWeighedRolls(prev => [...prev, data].filter(Boolean))
      // ม้วนต้นทาง: ชั่งได้แล้ว → ปิดม้วน (ที่เหลือเป็นเศษ) → หายจากลิสต์ กันชั่งซ้ำ
      // ⚠ เฉพาะตอนเซฟสำเร็จ (online) — ถ้าออฟไลน์ ม้วนใหม่ยังไม่ลง DB จึงไม่หักม้วนต้นทาง
      if (useSrc && inserted) {
        const sc = Math.max(0, (useSrc.weight ?? 0) - saveWeight)
        await supabase.from('production_rolls').update({
          rework_status: 'reworked',
          rework_remark: `กรอเสร็จ · หยิบมา ${fmt(useSrc.weight,dec)} · ชั่งได้ ${fmt(saveWeight,dec)} · เศษ ${fmt(sc,dec)} Kg`,
        }).eq('id', useSrc.id)
        setSelSrc(null)
        setSrcRolls(prev => prev.filter(x => x.id !== useSrc.id))
      }
      // ม้วนนอกระบบ: บวกเบิกมาเข้าเป้างาน (ให้คิดเศษถูก) + เคลียร์ช่องสำหรับม้วนถัดไป
      if (useManual && reworkJobId && inserted) {
        const { data: j } = await supabase.from('rework_jobs').select('planned_qty').eq('id', reworkJobId).maybeSingle()
        const newPlanned = ((parseFloat(j?.planned_qty ?? '0') || 0) + useManual.kg).toFixed(2)
        await supabase.from('rework_jobs').update({ planned_qty: newPlanned }).eq('id', reworkJobId)
        setManualSrcText(''); setManualSrcKg('')
      }

      // ── จำค่าที่กรอกเอง: ถ้า master ยังไม่มี Mat Code/แกน → เติมกลับให้ครั้งหน้า auto-fill ──
      backfillProductMatCore(profile.itemCode, profile.matCode, profile.coreWeight, profile.productName, (profile as any).productCode)
      backfillCustomer((profile as any).custName, (profile as any).custCode)

      // บันทึก log ทุกการชั่ง (await + retry 2 ครั้ง — log สำคัญสำหรับ recovery)
      const logPayload = {
        machine_no:   profile.machine_no,
        lot_no:       profile.lotNo,
        work_order:   profile.woNo ?? '',
        sale_order:   profile.soNo ?? '',
        item_code:    profile.itemCode,
        mat_code:     profile.matCode,
        product_name: profile.productName,
        customer:     profile.custName,
        roll_no:      useRollNo,
        roll_type:    actualType,
        gross_weight: gross,
        core_weight:  isScrap ? 0 : core,
        net_weight:   parseFloat(saveWeight.toFixed(dec)),
        remark:       rollRemark,
        inspector:    inspector || null,
      }
      let logOk = false
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error: logErr } = await supabase.from('weigh_logs').insert(logPayload)
        if (!logErr) { logOk = true; break }
        console.warn(`weigh_logs insert attempt ${attempt+1} failed:`, logErr.message)
        await new Promise(r => setTimeout(r, 300 * (attempt + 1)))
      }
      if (!logOk) {
        // เก็บลง localStorage เป็น last resort — ผู้ใช้ export ได้จากหน้า Admin
        try {
          const failed = JSON.parse(localStorage.getItem('bwp_weigh_log_failed') || '[]')
          failed.push({ ...logPayload, _failed_at: new Date().toISOString() })
          localStorage.setItem('bwp_weigh_log_failed', JSON.stringify(failed))
        } catch {}
      }

      if (isGood) {
        setWeighedKg(prev => parseFloat((prev + saveWeight).toFixed(dec)))
        // หาเลขถัดไปจาก gap (ไม่ +1 ตรงๆ — กันกรณีลบม้วนกลางๆ)
        const newList = [...weighedRolls, data]
        setRollNo(nextRollNo(newList.filter((r:any) => r?.roll_type === 'good')))
        // print fire-and-forget (ไม่ await — ไม่บล็อก save flow)
        printLabel({...profile, length: lengthVal || profile.length, pcs: pcsVal || profile.pcs, inspector}, rollNo, gross, saveWeight, profile.labelSize ?? 'long', 'good', '', data.id)
        // กรอต่อ: ม้วนต้นทางที่ 2 ถูกรวมเข้าม้วนนี้แล้ว → mark consumed (หลุดจากลิสต์ต้นทาง)
        if (useSrc2) {
          supabase.from('production_rolls')
            .update({ rework_status: 'reworked', rework_remark: `กรอต่อรวมกับ Lot ${useSrc.lot_no} #${useSrc.roll_no} → ออกม้วน #${useRollNo}` })
            .eq('id', useSrc2.id).then(() => loadSrcRolls(), () => {})
          setSelSrc2(null)
        }
        // แผนกกรอ: บันทึกสาเหตุที่ม้วนนี้เสีย/มาจากอะไร กลับเข้างานกรอ (ตาม Lot)
        if (isRework && reworkCause.trim()) {
          const upd = supabase.from('rework_jobs').update({ source_defect_reason: reworkCause.trim() })
          ;(reworkJobId ? upd.eq('id', reworkJobId) : upd.eq('lot_no', profile.lotNo))
            .then(() => {}, (e: any) => console.warn('update rework cause err:', e))
        }
      } else if (isBad) {
        const newList = [...weighedRolls, data]
        setBadRollNo(nextRollNo(newList.filter((r:any) => r?.roll_type === 'bad')))
        printLabel({...profile, inspector}, badRollNo, gross, saveWeight, profile.labelSize ?? 'long', 'bad', badReason, data.id)
        setBadReason('')
      } else {
        // เศษ — ไม่มี roll_no ไม่นับม้วน พิมพ์ label แยก
        printLabel({...profile, inspector}, 0, gross, gross, profile.labelSize ?? 'long', actualType, scrapReason, data.id)
        setScrapReason('')
      }
      // หลัง save: ถ้า simMode อยู่ → สุ่มค่าใหม่ให้พร้อมม้วนถัดไป, ถ้าไม่ → reset
      if (simModeRef.current) {
        readScale() // สุ่มน้ำหนักใหม่อัตโนมัติ — ไม่ต้องกดปุ่มสุ่มซ้ำ
      } else {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
        setGross(0); setRawWeight('')
        // ต่อเครื่องชั่งจริง: ล็อกจนกว่าจะยกของออก (น้ำหนักตก) กันชั่งเบิ้ล
        if (serialConnected) {
          grossAtSaveRef.current = gross
          awaitingClearRef.current = true
          setAwaitingClear(true)
        }
      }
    } catch (e: any) {
      alert('บันทึกไม่สำเร็จ: ' + (e?.message ?? JSON.stringify(e)))
    }
    finally { setSaving(false) }
  }

  const progressColor = done ? 'bg-green-500' : pct >= 80 ? 'bg-amber-400' : 'bg-brand-500'

  const goodListRef = useRef<HTMLDivElement>(null)

  // เลื่อนตารางม้วนดีไปแถวล่าสุดทุกครั้งที่บันทึกม้วนใหม่
  useEffect(() => {
    if (!lastRoll) return
    const el = goodListRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lastRoll])

  const [selectedRoll, setSelectedRoll] = useState<any>(null)
  const [deleteModal, setDeleteModal] = useState<{ roll: any } | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteBy, setDeleteBy]   = useState('')
  const [deleting, setDeleting]   = useState(false)

  async function confirmDelete() {
    if (!deleteModal) return
    if (!deleteBy.trim()) { alert('กรุณากรอกชื่อผู้ลบ'); return }
    if (!deleteReason.trim()) { alert('กรุณากรอกเหตุผล'); return }
    setDeleting(true)
    const r = deleteModal.roll
    // ── ใช้ RPC atomic: log + delete ใน transaction เดียว ──
    // ถ้า log insert fail หรือ delete fail → DB rollback ทั้งคู่
    // fallback: ถ้า RPC ยังไม่ถูก migrate (function not found) → ใช้ 2-step แบบเดิม
    const { error } = await supabase.rpc('delete_roll_atomic', {
      p_roll_id:    r.id,
      p_deleted_by: deleteBy.trim(),
      p_reason:     deleteReason.trim(),
      p_work_order: profile.woNo ?? null,
      p_sale_order: profile.soNo ?? null,
    })
    if (error && (/function .* does not exist/i.test(error.message) || /could not find the function/i.test(error.message))) {
      // ── Legacy fallback (จะแสดง warning ให้ admin migrate) ──
      console.warn('RPC delete_roll_atomic ยังไม่ถูก deploy — รัน db/hardening.sql ใน Supabase')
      const { error: logErr } = await supabase.from('roll_deletion_logs').insert({
        deleted_by:   deleteBy.trim(),
        reason:       deleteReason.trim(),
        machine_no:   r.machine_no, lot_no: r.lot_no,
        work_order:   profile.woNo ?? '', sale_order: profile.soNo ?? '',
        roll_no:      r.roll_no, roll_type: r.roll_type,
        weight:       r.weight, gross_weight: r.gross_weight, core_weight: r.core_weight,
        length:       r.length, pcs: r.pcs,
        product_name: profile.productName, product_code: profile.productCode,
        item_code:    profile.itemCode, mat_code: profile.matCode,
        cust_code:    profile.custCode, cust_name: profile.custName, cust_branch: profile.custBranch,
        width_cm:     profile.widthCm, width_unit: profile.widthUnit ?? 'cm', thick_mc: profile.thickMc,
        inspector:    r.inspector, started_at: r.started_at,
        original_id:  r.id, section: profile.section ?? 'blow',
      })
      if (logErr) { setDeleting(false); alert('ลบไม่สำเร็จ (log insert): ' + logErr.message); return }
      const { error: delErr } = await supabase.from('production_rolls').delete().eq('id', r.id)
      setDeleting(false)
      if (delErr) { alert('ลบไม่สำเร็จ: ' + delErr.message); return }
    } else {
      setDeleting(false)
      if (error) { alert('ลบไม่สำเร็จ: ' + error.message); return }
    }
    // ── ม้วนกรอ: ลบแล้วคืนม้วนต้นทางให้กลับมาเลือกกรอใหม่ได้ ──
    if (r.rework_source_roll_id) {
      const { error: srcErr } = await supabase.from('production_rolls')
        .update({
          rework_status: 'reworking',
          rework_remark: `คืนสถานะ (ลบม้วนกรอ #${r.roll_no}: ${deleteReason.trim()})`,
        })
        .eq('id', r.rework_source_roll_id)
      if (srcErr) console.warn('คืนม้วนต้นทางไม่สำเร็จ:', srcErr.message)
      // เด้งม้วนต้นทางกลับเข้ารายการเลือกกรอ
      loadSrcRolls()
    }
    setDeleteModal(null)
    setDeleteReason('')
    setDeleteBy('')
    setSelectedRoll(null)
    loadRollsForMachine() // → จะคำนวณ rollNo ใหม่ ใช้ gap (#ที่ถูกลบ) ก่อน
  }

  // สร้าง URL สำหรับม้วนที่เลือก — ใช้ ID สั้นๆ เท่านั้น
  function makeRollUrl(r: any) {
    return `${window.location.origin}/?roll=${r.id}`
  }

  return (
    <div className="h-[calc(100vh-48px)] bg-[#0a0f1e] flex flex-col">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-2.5 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-brand-600 text-white font-black text-base w-10 h-10 rounded-xl flex items-center justify-center shrink-0">
            {profile.machine_no}
          </div>
          <div>
            <p className="text-white font-bold text-sm">{profile.productName}</p>
            <p className="text-slate-400 text-xs">
              {profile.soNo && <span className="text-amber-300 font-bold mr-1.5">SO {profile.soNo}</span>}
              {profile.custName} · Lot {profile.lotNo}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Offline queue badge + Export */}
          {queue.length > 0 && (
            <div className="flex items-center gap-1.5">
              <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border font-semibold ${
                syncing ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
              }`}>
                {syncing
                  ? <><span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse inline-block"/> กำลัง sync {queue.length} รายการ...</>
                  : <><span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse inline-block"/> ค้างส่ง {queue.length} ม้วน (ออฟไลน์)</>
                }
              </div>
              <button onClick={exportQueue}
                title="ดาวน์โหลด queue เป็นไฟล์ JSON — สำรองก่อน clear browser"
                className="text-xs px-2 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold">
                💾 Export
              </button>
            </div>
          )}
          {/* Progress mini */}
          {planned > 0 && (
            <div className="text-right hidden sm:block">
              <p className="text-xs text-slate-500">{fmt(weighedKg,dec)} / {fmt(planned,dec)} Kgs.</p>
              <div className="h-1.5 bg-slate-800 rounded-full w-32 mt-1">
                <div className={`h-full rounded-full ${progressColor}`} style={{width:`${pct}%`}}/>
              </div>
            </div>
          )}
          {isRework && (
            <button
              onClick={() => {
                const maxB = Math.max(1, ...weighedRolls.map((r:any)=>r.rework_batch ?? 1))
                const cur = weighedRolls.filter((r:any)=>(r.rework_batch??1)===reworkRound).length
                // ถ้ารอบปัจจุบันยังว่าง ไม่ต้องขึ้นรอบใหม่ซ้ำ
                if (cur === 0 && reworkRound > maxB) { alert('รอบนี้ยังไม่มีม้วน — เริ่มม้วน 1 ได้เลย'); return }
                setReworkRound(maxB + 1)
                alert(`เริ่มรอบใหม่ (รอบ ${maxB + 1}) — ม้วนถัดไปจะโชว์เป็น 1`)
              }}
              className="flex items-center gap-1.5 text-xs bg-slate-800 border border-amber-500/40 hover:bg-amber-500/15 px-2.5 py-1.5 rounded-lg font-bold text-amber-300"
              title="เริ่มนับม้วนใหม่ (1) ใน Lot+WO เดิม — โชว์เลขรอบใหม่ + ป้าย (รอบ N)">
              🔄 เริ่มม้วน 1 ใหม่ {reworkRound > 1 && `· รอบ ${reworkRound}`}
            </button>
          )}
          <button onClick={() => setShowCloseModal(true)}
            className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg transition-colors font-semibold ${
              done ? 'bg-green-600 hover:bg-green-500 text-white animate-pulse' : 'bg-slate-800 hover:bg-slate-700 text-slate-400'
            }`}>
            🏁 ปิดงาน
          </button>
          <button onClick={onBack}
            className="flex items-center gap-1 text-slate-500 hover:text-white text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg transition-colors">
            <ArrowLeft size={12}/> เปลี่ยนเครื่อง
          </button>
        </div>
      </div>

      {/* Body: 2 column */}
      <div className="flex flex-1 min-h-0">

        {/* ── LEFT: เครื่องชั่ง ─────────────────────────────── */}
        <div className="w-[380px] shrink-0 flex flex-col gap-2.5 p-4 border-r border-slate-800 overflow-y-auto">

          {/* Type selector */}
          {/* ผู้ตรวจสอบ — แสดง badge + เตือนเมื่อนาน */}
          <button onClick={() => { setInspectorInput(inspector); setShowInspectorPrompt(true) }}
            className={`w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2 border transition-colors ${
              !inspector  ? 'bg-red-500/10 border-red-500/30 hover:bg-red-500/15' :
              isStale     ? 'bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/15' :
                            'bg-slate-800 border-slate-700 hover:bg-slate-700/50'
            }`}>
            <div className="flex items-center gap-2 text-left">
              <span className="text-slate-500 text-xs">ผู้ตรวจสอบ:</span>
              <span className={`font-bold text-sm ${!inspector ? 'text-red-400' : isStale ? 'text-amber-300' : 'text-white'}`}>
                {inspector || '⚠️ ยังไม่ได้กรอก!'}
              </span>
              {isStale && inspector && (
                <span className="text-[10px] text-amber-400">· ผ่านมา {Math.floor(hoursSinceSet)} ชม. — กดยืนยันใหม่</span>
              )}
            </div>
            <span className="text-slate-500 text-[10px]">เปลี่ยน ▸</span>
          </button>

          {/* แผนกกรอ: เอาปุ่ม "ม้วนกรอ" ออก — เหลือแค่ ม้วนดี + เศษ */}
          <div className={`grid ${profile.section === 'rewind' ? 'grid-cols-2' : 'grid-cols-3'} gap-1.5`}>
            {([
              { key:'good',  label:'ม้วนดี',  color:'bg-brand-600 text-white',   inactive:'bg-slate-800 text-slate-400 hover:text-white', show: true },
              { key:'bad',   label:'ม้วนกรอ', color:'bg-orange-600 text-white',  inactive:'bg-slate-800 text-slate-400 hover:text-white', show: profile.section !== 'rewind' },
              { key:'scrap', label:'เศษเสีย', color:'bg-amber-600 text-white',   inactive:'bg-slate-800 text-slate-400 hover:text-white', show: true },
            ] as const).filter(t => t.show).map(t => (
              <button key={t.key} onClick={() => setWeighType(t.key)}
                className={`py-2.5 rounded-xl text-sm font-bold transition-colors text-center ${weighType===t.key ? t.color : t.inactive}`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ── แจ้งเตือน: ม้วนถัดไปกำลังทดแทนเลขที่ลบ ─────────────── */}
          {((isGood && isFillingGapGood) || (isBad && isFillingGapBad)) && (
            <div className="relative bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 rounded-xl p-[2px] shadow-lg shadow-amber-500/40 animate-pulse">
              <div className="bg-slate-900 rounded-[10px] px-4 py-3.5 flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/50 shrink-0">
                  <span className="text-2xl">🔁</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-amber-300 text-[10px] font-black uppercase tracking-widest">⚠ ทดแทนเลขที่ถูกลบ</p>
                  <p className="text-white font-black text-lg leading-tight">
                    ม้วนถัดไป →{' '}
                    <span className="text-amber-300 text-2xl">
                      #{isGood ? rollNo : badRollNo}
                    </span>
                  </p>
                  <p className="text-slate-400 text-xs mt-0.5">
                    หลังจากนี้จะต่อหลังม้วน #{isGood ? goodMaxRoll : badMaxRoll}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* เศษ sub-select */}
          {isScrap && (
            <div className="grid grid-cols-3 gap-1">
              {([
                { key:'scrap_clear', label:'เศษใส',   color:'bg-slate-600' },
                { key:'scrap_color', label:'เศษสี',   color:'bg-purple-700' },
                { key:'scrap_lump',  label:'เศษก้อน', color:'bg-amber-700' },
              ] as const).map(s => (
                <button key={s.key} onClick={() => setScrapSub(s.key)}
                  className={`py-1.5 rounded-lg text-xs font-semibold transition-colors ${scrapSub===s.key ? s.color+' text-white' : 'bg-slate-800 text-slate-500 hover:text-white'}`}>
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {/* Bad: ส่งกรอ vs รอพิจารณา */}
          {isBad && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-1.5">
                <button type="button" onClick={() => setBadMode('rework')}
                  className={`py-2 rounded-xl text-xs font-bold border-2 transition-colors ${
                    badMode === 'rework'
                      ? 'bg-orange-600 border-orange-500 text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-orange-500/40'
                  }`}>
                  ✓ ส่งกรอ
                </button>
                <button type="button" onClick={() => setBadMode('pending_review')}
                  className={`py-2 rounded-xl text-xs font-bold border-2 transition-colors ${
                    badMode === 'pending_review'
                      ? 'bg-amber-600 border-amber-500 text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-amber-500/40'
                  }`}>
                  ⏳ รอ ผจก พิจารณา
                </button>
              </div>
              <input value={badReason} onChange={e => setBadReason(e.target.value)}
                placeholder={badMode === 'pending_review' ? 'เหตุผลที่ไม่แน่ใจว่ากรอได้ (จำเป็น)...' : 'เหตุผลม้วนกรอ (จำเป็น)...'}
                className={`w-full bg-slate-800 border rounded-xl px-3 py-2 text-sm text-white outline-none placeholder-slate-500 ${
                  badMode === 'pending_review' ? 'border-amber-500/40 focus:border-amber-500' : 'border-orange-500/40 focus:border-orange-500'
                }`} />
              {badMode === 'pending_review' && (
                <p className="text-[10px] text-amber-400/80 leading-tight">
                  💡 ม้วนนี้จะรอ ผจก พิจารณา — ยังไม่ถูกส่งไปแผนกกรอ
                </p>
              )}
            </div>
          )}

          {/* Scrap reason */}
          {isScrap && (
            <input value={scrapReason} onChange={e => setScrapReason(e.target.value)}
              placeholder="เหตุผลเศษเสีย (จำเป็น)..."
              className="w-full bg-slate-800 border border-red-500/40 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-red-500 placeholder-slate-500" />
          )}

          {/* แผนกกรอ: เลือกม้วนต้นทางที่กำลังกรอ (ติ๊กก่อนชั่ง) */}
          {isRework && isGood && (
            <div className="space-y-1.5 bg-slate-900 border border-blue-500/30 rounded-xl p-2.5">
              <p className="text-blue-300 text-xs font-bold">📌 กำลังกรอจากม้วนต้นทางไหน? (ติ๊กก่อนชั่ง)</p>
              <div className="space-y-1 max-h-[55vh] overflow-y-auto">
                {srcRolls.map(s => {
                  const done = srcProg[s.id] ?? 0
                  const left = Math.max(0, (s.weight ?? 0) - done)
                  const full = left <= 0.001          // กรอครบแล้ว → ล็อก
                  const sel = selSrc?.id === s.id
                  const sel2 = selSrc2?.id === s.id
                  return (
                    <div key={s.id}
                      className={`rounded-lg px-2.5 py-1.5 border transition-colors ${full ? 'bg-slate-800/40 border-slate-700 opacity-60' : sel ? 'bg-blue-500/20 border-blue-500' : sel2 ? 'bg-emerald-500/20 border-emerald-500' : 'bg-slate-800 border-slate-700 hover:border-blue-500/50'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <button disabled={full} onClick={() => { const ns = sel ? null : s; setSelSrc(ns); if (ns) { setReworkCause(ns.remark ?? ''); setReworkLen(String(ns.length ?? '')) } else { setSelSrc2(null) } }} className="flex-1 text-left disabled:cursor-not-allowed">
                          <span className="text-xs font-bold text-white flex items-center gap-1.5 flex-wrap">
                            <span className="shrink-0">{full ? '✓ กรอครบ' : sel ? '☑' : sel2 ? '➕2' : '☐'}</span>
                            {sel2 && <span className="text-[9px] bg-emerald-500/30 text-emerald-200 px-1.5 py-0.5 rounded font-black">กรอต่อ ม้วนที่ 2</span>}
                            {s.work_order && <span className="text-sm font-black bg-amber-500/25 text-amber-100 border border-amber-400/40 px-2 py-0.5 rounded whitespace-nowrap">WO {s.work_order}</span>}
                            <span className="text-slate-300 font-mono">Lot {s.lot_no} #{s.roll_no}</span>
                          </span>
                        </button>
                        {/* ➕ กรอต่อ: เลือกม้วนที่ 2 (มีม้วนแรกแล้ว · ม้วนนี้ยังไม่ใช่แรก/สอง) */}
                        {selSrc && !sel && !sel2 && !full && (
                          <button onClick={() => setSelSrc2(s)} title="รวมม้วนนี้กรอต่อกับม้วนแรก (2 ม้วน → 1)"
                            className="text-[10px] bg-emerald-700/80 hover:bg-emerald-600 text-white px-2 py-0.5 rounded font-bold shrink-0 whitespace-nowrap">➕ กรอต่อ</button>
                        )}
                        {sel2 && (
                          <button onClick={() => setSelSrc2(null)} title="เอาออก" className="text-[10px] bg-slate-700 hover:bg-slate-600 text-white px-2 py-0.5 rounded shrink-0">✕</button>
                        )}
                        <span className="text-[10px] text-slate-300 shrink-0">หยิบมา <b className="text-orange-300">{fmt(s.weight,dec)}</b></span>
                        <button onClick={() => finishSource(s)} title="กรอไม่ได้/เป็นเศษทั้งม้วน → เอาออกจากลิสต์"
                          className="text-[10px] bg-red-700/70 hover:bg-red-600 text-white px-2 py-0.5 rounded font-bold shrink-0">🗑 เศษทั้งม้วน</button>
                      </div>
                      {/* รายละเอียดเต็มของม้วนต้นทาง */}
                      <div className="flex items-center gap-1 flex-wrap text-[9px] mt-1">
                        {(() => {
                          const nc = ({ qc_reject:'🚫 NC ตรวจไม่ผ่าน', warehouse_damage:'📦 NC เสียจากคลัง' } as any)[s.inbound_type]
                          return nc ? <span className="bg-rose-500/20 text-rose-300 px-1.5 py-0.5 rounded font-bold">{nc}</span> : null
                        })()}
                        {s.sale_order && <span className="bg-blue-500/15 text-blue-300 px-1.5 py-0.5 rounded font-bold">SO {s.sale_order}</span>}
                        {s.width_cm && s.thick_mc && <span className="bg-brand-500/20 text-brand-200 px-1.5 py-0.5 rounded font-bold">{s.width_cm}{s.width_unit ?? 'cm'}×{s.thick_mc}mc</span>}
                        {s.machine_no && <span className="text-slate-500">เครื่อง {s.machine_no}</span>}
                      </div>
                      {(s.product_name || s.customer) && (
                        <p className="text-[9px] text-slate-400 mt-0.5 truncate">{s.product_name}{s.customer ? ` · ${s.customer}` : ''}</p>
                      )}
                      {s.remark && (
                        <p className="text-[9px] text-rose-300/90 mt-0.5 leading-tight" title={s.remark}>⚠ เหตุผล: {s.remark}</p>
                      )}
                      {s.review_decision_by && (
                        <p className="text-[9px] text-purple-300/80 mt-0.5">⚖ ผจก: {s.review_decision_by}{s.review_action_reason ? ` · ${s.review_action_reason}` : ''}</p>
                      )}
                      <div className="flex justify-between text-[10px] mt-0.5 text-slate-400">
                        <span>แกน {fmt(s.core_weight ?? 0, dec)} Kg</span>
                        <span>กรอได้ <b className="text-green-300">{fmt(done,dec)}</b> · เหลือ <b className="text-amber-300">{fmt(left,dec)}</b></span>
                      </div>
                    </div>
                  )
                })}
                {srcRolls.length === 0 && !manualMode && (
                  <p className="text-[10px] text-slate-500 px-1">ไม่มีม้วนต้นทางในระบบ — ถ้าเอาม้วนจากที่อื่นมาชั่งรวม กด ➕ ด้านล่าง</p>
                )}
              </div>

              {/* ➕ ม้วนนอกระบบ — เอามาจากงานอื่น/ที่อื่น */}
              {!manualMode ? (
                <button onClick={() => { setManualMode(true); setSelSrc(null) }}
                  className="w-full text-left rounded-lg px-2.5 py-1.5 border border-dashed border-amber-500/50 bg-amber-500/5 hover:bg-amber-500/10 text-amber-300 text-xs font-bold">
                  ➕ ม้วนนอกระบบ — เอามาจากที่อื่นมาชั่งรวม (กรอกที่มาเอง)
                </button>
              ) : (
                <div className="rounded-lg px-2.5 py-2 border border-amber-500/50 bg-amber-500/10 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-amber-300 text-xs font-bold">➕ ม้วนนอกระบบ</span>
                    <button onClick={() => { setManualMode(false); setManualSrcText(''); setManualSrcKg('') }} className="text-[10px] text-slate-400 hover:text-white underline">ยกเลิก</button>
                  </div>
                  <input value={manualSrcText} onChange={e => setManualSrcText(e.target.value)}
                    placeholder="ที่มา * เช่น WO 69/06/041 SO... ม้วน #3 / งานพี่เอก"
                    className="w-full bg-slate-800 border border-amber-500/40 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-amber-500"/>
                  <div className="flex items-center gap-2">
                    <input value={manualSrcKg} onChange={e => setManualSrcKg(e.target.value)} type="number" inputMode="decimal"
                      placeholder="หยิบมากี่โล"
                      className="flex-1 bg-slate-800 border border-amber-500/40 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-amber-500"/>
                    <span className="text-[10px] text-slate-400">Kg (ไว้คิดเศษ)</span>
                  </div>
                </div>
              )}

              {selSrc && !selSrc2 && (
                <p className="text-[10px] text-blue-200 bg-blue-500/10 rounded px-2 py-1">
                  ม้วนถัดไปจะบันทึกหมายเหตุ: หยิบมา {fmt(selSrc.weight,dec)} · ชั่งได้ + เศษ อัตโนมัติ
                </p>
              )}
              {selSrc && selSrc2 && (
                <p className="text-[11px] text-emerald-200 bg-emerald-500/15 border border-emerald-500/30 rounded px-2 py-1.5 font-bold">
                  🔗 กรอต่อ 2 ม้วน → 1 ม้วน · หยิบมารวม {fmt((selSrc.weight ?? 0) + (selSrc2.weight ?? 0), dec)} kg
                  <span className="block text-[9px] text-emerald-300/80 font-normal">Lot {selSrc.lot_no} #{selSrc.roll_no} + Lot {selSrc2.lot_no} #{selSrc2.roll_no} · ชั่งได้ค่าเดียว เศษคิดอัตโนมัติ</span>
                </p>
              )}
              {manualMode && manualSrcText.trim() && (
                <p className="text-[10px] text-amber-200 bg-amber-500/10 rounded px-2 py-1">
                  ม้วนถัดไปจะออกใน Lot นี้ + หมายเหตุ: กรอแทนจาก "{manualSrcText.trim()}"{manualSrcKg ? ` · หยิบมา ${manualSrcKg} · เศษอัตโนมัติ` : ''}
                </p>
              )}
            </div>
          )}

          {/* แผนกกรอ: สาเหตุที่ม้วนนี้เสีย/มาจากอะไร (กรอกตอนชั่งออก = กรอสำเร็จ) */}
          {isRework && isGood && (
            <div className="space-y-1">
              <p className="text-rose-300 text-xs font-bold">⚠ สาเหตุที่ม้วนเสีย (มาจากแผนกเป่า — แก้ไขได้)</p>
              <input value={reworkCause} onChange={e => setReworkCause(e.target.value)}
                placeholder="ติ๊กม้วนต้นทางด้านบน → สาเหตุจะเด้งมาเอง"
                className="w-full bg-slate-800 border border-rose-500/40 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-rose-500 placeholder-slate-500" />
              <p className="text-[10px] text-rose-400/70 leading-tight">ดึงจากสาเหตุที่แผนกเป่าระบุตอนชั่งเป็นม้วนกรอ — แก้/เพิ่มได้ถ้าต่างจากเดิม</p>
            </div>
          )}

          {isRework && isGood && (
            <div className="space-y-1">
              <p className="text-sky-300 text-xs font-bold">📏 ความยาว (เมตร) — กรอกเองได้</p>
              <div className="flex items-center gap-2">
                <input value={reworkLen} onChange={e => setReworkLen(e.target.value.replace(/[^\d.]/g, ''))}
                  inputMode="decimal" placeholder="เมตร เช่น 1540"
                  className="w-full bg-slate-800 border border-sky-500/40 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-sky-500 placeholder-slate-500" />
                <span className="text-slate-400 text-sm shrink-0">M.</span>
              </div>
              <p className="text-[10px] text-sky-400/70 leading-tight">
                ดึงจากม้วนต้นทางอัตโนมัติเมื่อติ๊กเลือก — ถ้าต้นทางไม่มีค่า (งานเก่า) กรอกเองได้ ค่านี้จะติดไปกับม้วนกรอ
              </p>
            </div>
          )}

          {/* Scale display */}
          <div className={`border-2 rounded-2xl px-5 py-6 text-center shadow-xl ${
            weighType==='good' ? 'bg-slate-900 border-slate-700' :
            weighType==='bad'  ? 'bg-orange-500/5 border-orange-500/30' :
            'bg-slate-900 border-slate-700'
          }`}>
            <div className="flex items-center justify-between mb-1 px-1">
              <p className="text-slate-500 text-[10px] uppercase tracking-widest">Gross Weight</p>
              <div className="flex items-center gap-1.5">
                {serialConnected ? (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                    serialStable ? 'bg-green-500/20 text-green-300 border-green-500/40' : 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
                  }`} title={`Bridge: ${bridgeUrl}`}>
                    <span className={`w-1.5 h-1.5 rounded-full inline-block ${serialStable?'bg-green-400':'bg-amber-400'}`}/>
                    {serialStable ? '● เครื่องชั่ง (นิ่ง)' : '◌ เครื่องชั่ง (อ่าน...)'}
                  </span>
                ) : (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/40">
                    ⚠ Bridge ไม่เชื่อมต่อ
                  </span>
                )}
                <button onClick={() => {
                  const url = prompt('Bridge URL (ws://IP:8080)', bridgeUrl)
                  if (!url) return
                  setBridgeUrl(url)
                  localStorage.setItem('bwp_bridge_url', url)
                  disconnectBridge()
                  setTimeout(connectBridge, 300)
                }}
                  className="text-[10px] text-slate-500 hover:text-slate-300 px-1 py-0.5 rounded hover:bg-slate-700"
                  title="ตั้งค่า Bridge URL">
                  ⚙
                </button>
              </div>
            </div>
            {/* กรอ: สลับกรอกน้ำหนักสุทธิเอง (เมื่อ Bridge ไม่ต่อ / แก้หลังบ้าน) */}
            {isRework && isGood && !isScrap && (
              <button onClick={() => { const on = !netMode; setNetMode(on); setRawWeight(on ? (net ? String(net) : '') : (gross ? String(gross) : '')); setStable(true) }}
                className={`mb-2 text-[11px] font-bold px-3 py-1 rounded-full border transition-colors ${netMode ? 'bg-brand-500/20 border-brand-500/50 text-brand-200' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>
                {netMode ? '✓ กรอกน้ำหนักสุทธิเอง (Net)' : '⌨ กรอกน้ำหนักสุทธิเอง'}
              </button>
            )}
            <input
              type="text" inputMode="decimal"
              value={netMode
                ? rawWeight
                : (serialConnected && !simMode ? (gross ? gross.toFixed(dec) : '') : rawWeight)}
              onChange={e => {
                const s = e.target.value.replace(/[^0-9.]/g, '')   // อนุญาตเลขกับจุด
                setRawWeight(s)
                const v = parseFloat(s) || 0
                // โหมด Net: ตั้ง gross = net + core เพื่อให้ net (=gross−core) ตรงกับที่พิมพ์
                setGross(netMode ? parseFloat((v + core).toFixed(dec)) : v)
                setStable(true)
              }}
              placeholder="0.00"
              readOnly={!netMode && serialConnected && !simMode}
              className={`w-full font-mono text-[72px] font-black tracking-tight leading-none mb-1 bg-transparent text-center outline-none placeholder-slate-700 focus:bg-slate-800/50 rounded-xl ${netMode ? 'text-brand-300' : 'text-white'}`}
            />
            <p className="text-slate-500 text-xs font-semibold mb-2">{netMode ? 'Kgs. (สุทธิ — กรอกเอง)' : 'Kgs.'}</p>
            {serialConnected && rawSerial && (
              <div className="bg-slate-950 border border-slate-800 rounded px-2 py-1 mb-3 font-mono text-[9px] text-slate-500 truncate text-left" title={rawSerial}>
                📥 {rawSerial.replace(/[\r\n]/g, '·').slice(-80)}
              </div>
            )}

            {!isScrap && (
              <div className="flex items-center justify-center gap-5 mb-4">
                <div className="text-center bg-slate-800 rounded-xl px-4 py-2">
                  <p className="text-slate-500 text-[9px]">Core</p>
                  <p className="text-slate-300 font-bold">{fmt(core, dec)} Kgs.</p>
                </div>
                <span className="text-slate-700 text-xl">−</span>
                <div className="text-center">
                  <p className="text-slate-500 text-[9px]">Net</p>
                  <p className="text-brand-400 font-black text-3xl">{fmt(net, dec)}</p>
                  <p className="text-brand-400/60 text-xs">Kgs.</p>
                </div>
              </div>
            )}
            {isScrap && (
              <div className="text-center mb-4">
                <p className="text-slate-500 text-xs">น้ำหนักเศษ (Gross)</p>
                <p className="text-amber-400 font-black text-3xl">{fmt(gross, dec)} Kgs.</p>
              </div>
            )}

            {testRandomEnabled && (
              <button onClick={readScale}
                className={`w-full py-1.5 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                  simMode
                    ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-500 hover:text-white'
                }`}>
                <RefreshCw size={11}/> {simMode ? '🎲 จำลองอยู่ — กดสุ่มใหม่' : 'สุ่มค่าทดสอบ'}
              </button>
            )}
          </div>

          {/* Roll No + Save */}
          <div className="flex items-center gap-2">
            {(isGood || isBad) && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 flex items-center gap-2 shrink-0">
                <span className="text-slate-500 text-xs">{isBad ? 'กรอ' : 'Roll'}</span>
                <span className="text-white font-black w-7 text-center">
                  {isBad ? badRollNo : reworkDispNo}
                </span>
              </div>
            )}
            <button onClick={handleSave} disabled={saving || awaitingClear || saveWeight <= 0 || !stable || (isBad && !badReason.trim()) || (isScrap && !scrapReason.trim()) || (isGood && isRework && !reworkCause.trim())}
              className={`flex-1 py-3 rounded-xl text-white font-black flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-40 ${
                awaitingClear ? 'bg-slate-700 cursor-not-allowed' :
                !stable ? 'bg-slate-700 cursor-not-allowed' :
                isGood  ? 'bg-brand-600 hover:bg-brand-500' :
                isBad   ? 'bg-orange-600 hover:bg-orange-500' :
                          'bg-amber-600 hover:bg-amber-500'
              }`}>
              <Save size={17}/>
              {saving ? 'บันทึก...' : awaitingClear ? '⬆ ยกม้วนออกก่อน' : !stable ? 'รอค่านิ่ง...' :
                isScrap ? `บันทึกเศษ ${fmt(gross,dec)} Kgs.` :
                isBad   ? `กรอ ${badRollNo} · ${fmt(saveWeight,dec)} Kgs.` :
                          `Roll ${reworkDispNo}${reworkRound>1?` (รอบ ${reworkRound})`:''} · ${fmt(saveWeight,dec)} Kgs.`}
            </button>
          </div>

          {/* แจ้งเตือนให้ยกของออก กันชั่งเบิ้ล */}
          {awaitingClear && (
            <p className="text-center text-amber-400 text-sm font-bold animate-pulse">
              ⬆ ยกม้วนออกจากเครื่องชั่ง แล้วรอน้ำหนักตกลง ก่อนชั่งม้วนถัดไป
            </p>
          )}

          {/* hint ทำไมกดไม่ได้ */}
          {!awaitingClear && (saveWeight <= 0 || !stable || (isBad && !badReason.trim()) || (isScrap && !scrapReason.trim()) || (isGood && isRework && !reworkCause.trim())) && (
            <p className="text-center text-slate-600 text-xs">
              {!stable ? '⟳ รอค่าชั่งนิ่งก่อน' :
               saveWeight <= 0 ? '▲ พิมพ์น้ำหนักหรือกดสุ่มค่าก่อน' :
               isBad && !badReason.trim() ? '▲ กรอกเหตุผลม้วนกรอก่อน' :
               isScrap && !scrapReason.trim() ? '▲ กรอกเหตุผลเศษเสียก่อน' :
               isGood && isRework && !reworkCause.trim() ? '▲ กรอกสาเหตุที่ม้วนนี้เสียก่อน' : ''}
            </p>
          )}

          {/* Last saved */}
          {lastRoll && (
            <div className={`rounded-xl px-4 py-2.5 flex items-center gap-2 border ${
              (lastRoll.weighType||lastRoll.roll_type)==='good' ? 'bg-green-500/10 border-green-500/25' :
              (lastRoll.weighType||lastRoll.roll_type)==='bad'  ? 'bg-orange-500/10 border-orange-500/25' :
              'bg-slate-800 border-slate-700'
            }`}>
              <CheckCircle2 size={14} className="text-green-400 shrink-0"/>
              <p className="text-green-300 text-sm font-semibold truncate">
                {(lastRoll.weighType||lastRoll.roll_type)==='good' ? `Roll ${lastRoll.roll_no} · ${fmt(lastRoll.weight,dec)} Kgs. ✓` :
                 (lastRoll.weighType||lastRoll.roll_type)==='bad'  ? `กรอ Roll ${lastRoll.roll_no} · ${fmt(lastRoll.weight,dec)} Kgs.` :
                 `เศษ · ${fmt(lastRoll.weight||lastRoll.gross_weight,dec)} Kgs.`}
              </p>
            </div>
          )}

          {/* Progress — แถบเดียวแบ่งสี (น้ำเงิน=ม้วนดี, เหลือง=กรอ) ชี้เมาส์เห็นยอดจริง */}
          {planned > 0 && (() => {
            const fgW  = Math.min(100, planned > 0 ? (weighedKg / planned) * 100 : 0)
            const badW = Math.min(100 - fgW, planned > 0 ? (badKgSum / planned) * 100 : 0)
            return (
            <div className={`rounded-xl p-3 border ${done ? 'bg-green-500/10 border-green-500/30' : 'bg-slate-900 border-slate-800'}`}>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-slate-400">ชั่งแล้ว (ม้วนดี) <b className={done?'text-green-300':'text-white'}>{fmt(weighedKg,dec)}</b></span>
                <span className={done ? 'text-green-400 font-bold' : 'text-brand-300'}>{done ? '✓ ครบ' : `เหลือ ${fmt(remaining,dec)}`}</span>
              </div>
              {/* แถบเดียว 2 สี — hover ดูยอดจริง */}
              <div className="h-3 bg-slate-800 rounded-full overflow-hidden flex"
                   title={`ม้วนดี ${fmt(weighedKg,dec)} + กรอ ${fmt(badKgSum,dec)} = รวม ${fmt(goodPlusBadKg,dec)} Kgs. (เป้า ${fmt(planned,dec)})`}>
                <div className={`h-full ${done ? 'bg-green-500' : 'bg-brand-500'} transition-all`} style={{width:`${fgW}%`}}
                     title={`ม้วนดี ${fmt(weighedKg,dec)} Kgs. (${goodCnt} ม้วน)`}/>
                <div className="h-full bg-amber-400 transition-all" style={{width:`${badW}%`}}
                     title={`กรอ ${fmt(badKgSum,dec)} Kgs. (${badCnt} ม้วน)`}/>
              </div>
              {/* legend + ยอดรวม */}
              <div className="flex justify-between items-center mt-1">
                <p className="text-slate-600 text-[10px]">
                  <span className="text-brand-400">■</span> ดี {fmt(weighedKg,dec)}
                  {badKgSum > 0 && <> · <span className="text-amber-400">■</span> กรอ {fmt(badKgSum,dec)}</>}
                </p>
                <p className="text-slate-500 text-[10px]">รวม <b className="text-slate-300">{fmt(goodPlusBadKg,dec)}</b> · เป้า {fmt(planned,dec)}</p>
              </div>
            </div>
            )
          })()}
        </div>

        {/* ── RIGHT: ตารางแยก ──────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Summary bar */}
          <div className="px-4 py-2 border-b border-slate-800 bg-slate-900 flex gap-4 shrink-0 text-xs">
            <span className="text-slate-500">ม้วนดี <b className="text-brand-300">{weighedRolls.filter((r:any)=>r?.roll_type==='good').length} ม้วน · {fmt(weighedKg,dec)} Kgs.</b></span>
            <span className="text-slate-700">|</span>
            <span className="text-slate-500">ม้วนกรอ <b className="text-orange-300">{weighedRolls.filter((r:any)=>r?.roll_type==='bad').length} ม้วน · {fmt(weighedRolls.filter((r:any)=>r?.roll_type==='bad').reduce((s:number,r:any)=>s+(r.weight??0),0),dec)} Kgs.</b></span>
            <span className="text-slate-700">|</span>
            {(() => {
              const clear = weighedRolls.filter((r:any)=>r?.roll_type==='scrap_clear')
              const color = weighedRolls.filter((r:any)=>r?.roll_type==='scrap_color')
              const lump  = weighedRolls.filter((r:any)=>r?.roll_type==='scrap_lump')
              const sum   = (a:any[]) => a.reduce((s:number,r:any)=>s+(r.weight??0),0)
              const total = sum(clear)+sum(color)+sum(lump)
              return (
                <span className="relative group">
                  <span className="text-slate-500 cursor-help">เศษรวม <b className="text-amber-300 underline decoration-dotted">{fmt(total,dec)} Kgs.</b></span>
                  <div className="absolute left-0 top-full mt-1 hidden group-hover:block z-20 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 shadow-2xl whitespace-nowrap">
                    <p className="text-amber-400 text-[10px] font-bold uppercase mb-1.5">แยกตามประเภท</p>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between gap-6">
                        <span className="text-slate-400">เศษใส <span className="text-slate-600">({clear.length})</span></span>
                        <b className="text-slate-200">{fmt(sum(clear),dec)} Kgs.</b>
                      </div>
                      <div className="flex justify-between gap-6">
                        <span className="text-slate-400">เศษสี <span className="text-slate-600">({color.length})</span></span>
                        <b className="text-purple-300">{fmt(sum(color),dec)} Kgs.</b>
                      </div>
                      <div className="flex justify-between gap-6">
                        <span className="text-slate-400">เศษก้อน <span className="text-slate-600">({lump.length})</span></span>
                        <b className="text-amber-300">{fmt(sum(lump),dec)} Kgs.</b>
                      </div>
                      <div className="flex justify-between gap-6 border-t border-slate-700 pt-1 mt-1">
                        <span className="text-slate-300 font-semibold">รวม</span>
                        <b className="text-amber-300">{fmt(total,dec)} Kgs.</b>
                      </div>
                    </div>
                  </div>
                </span>
              )
            })()}
          </div>

          {/* 2 tables side by side */}
          <div className="flex flex-1 min-h-0 divide-x divide-slate-800">

            {/* ── ม้วนดี ─────────────────────── */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="px-3 py-2 bg-brand-500/10 border-b border-brand-500/20 shrink-0 flex items-center justify-between">
                <span className="text-brand-300 text-xs font-bold">● ม้วนดี</span>
                <ExportButton rows={[...weighedRolls].filter(Boolean).sort((a:any,b:any)=>(a.roll_no??0)-(b.roll_no??0))}
                  cols={[
                    { header:'เวลาชั่ง', value:(r:any)=> r.created_at ? new Date(r.created_at).toLocaleString('th-TH') : '', width:18 },
                    { header:'ม้วนที่', value:'roll_no' },
                    { header:'ประเภท', value:(r:any)=> r.roll_type==='good'?'ม้วนดี':r.roll_type==='bad'?'ม้วนกรอ':String(r.roll_type).startsWith('scrap')?'เศษ':r.roll_type },
                    { header:'นน.เต็ม (kg)', value:(r:any)=> (r.weight??0)+(r.core_weight??0) },
                    { header:'นน.สุทธิ (kg)', value:(r:any)=> r.weight??0 },
                    { header:'เหตุผล', value:(r:any)=> r.remark ?? '', width:24 },
                  ]}
                  fileName={`ม้วน_${profile.lotNo || 'งานนี้'}`} sheetName="ม้วนในงานนี้"
                  label="📥 Excel"
                  className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white px-2 py-0.5 rounded text-[10px] font-bold" />
              </div>
              <div className="grid grid-cols-4 border-b border-slate-800 bg-slate-800/20 shrink-0">
                {['เวลา','ม้วน','นน.เต็ม','นน.สุทธิ'].map(h=>(
                  <div key={h} className="px-3 py-1.5 text-slate-500 text-[9px] font-semibold uppercase">{h}</div>
                ))}
              </div>
              <div ref={goodListRef} className="flex-1 overflow-y-auto divide-y divide-slate-800/40">
                {(() => {
                  const goods = weighedRolls.filter((r:any)=>r.roll_type==='good')
                  // กรอ: เลขโชว์ต่อรอบ (rework_batch) — แต่ละรอบเริ่ม 1 ใหม่ (roll_no จริงยังต่อเนื่อง)
                  const dispNoMap = new Map<string, number>()
                  if (isRework) {
                    const byBatch = new Map<number, any[]>()
                    for (const g of goods) { const b = g.rework_batch ?? 1; if(!byBatch.has(b)) byBatch.set(b,[]); byBatch.get(b)!.push(g) }
                    for (const arr of byBatch.values()) {
                      arr.sort((a:any,b:any)=>(a.roll_no??0)-(b.roll_no??0)).forEach((g:any,i:number)=>dispNoMap.set(g.id, i+1))
                    }
                  }
                  const hasRounds = isRework && new Set(goods.map((g:any)=>g.rework_batch ?? 1)).size > 1
                  // ม้วนทดแทน: roll นี้ถูกสร้างหลังจากม้วนเลขใหญ่กว่ามีอยู่แล้ว
                  const isReplacement = (r:any) =>
                    goods.some((x:any) => (x.roll_no ?? 0) > (r.roll_no ?? 0) && new Date(x.created_at) < new Date(r.created_at))
                  return [...goods]
                    .sort((a:any,b:any) => (a.roll_no ?? 0) - (b.roll_no ?? 0))
                    .map((r:any) => {
                  const isNew  = lastRoll?.id === r.id
                  const isDone = r.transferred
                  const isRep  = isReplacement(r)
                  const d      = new Date(r.created_at)
                  const dateShort = `${d.getDate()}/${d.getMonth()+1}`
                  const time   = d.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})
                  return (
                    <div key={r.id} onClick={()=>setSelectedRoll(r)}
                      className={`hover:bg-slate-800/40 cursor-pointer transition-colors ${
                        (r as any).new_system ? 'bg-emerald-500/10 border-l-4 border-emerald-400' : isRep ? 'bg-amber-500/10 border-l-4 border-amber-500' : isNew ? 'bg-green-500/5' : ''
                      } ${isDone?'opacity-60':''}`}>
                      <div className="grid grid-cols-4">
                        <div className={`px-3 py-2.5 text-xs leading-tight ${isDone?'text-slate-600 line-through':'text-slate-500'}`}>
                          <div className="text-[9px] text-slate-600">{dateShort}</div>
                          <div>{time}</div>
                        </div>
                        <div className="px-3 py-2.5">
                          <span className={`font-bold font-mono ${(r as any).new_system ? 'text-emerald-300' : isRep ? 'text-amber-300' : isDone?'text-slate-500 line-through':'text-white'}`}>{(r as any).new_system ? r.roll_no : (isRework ? (dispNoMap.get(r.id) ?? r.roll_no) : r.roll_no)}</span>
                          {(r as any).new_system && <span className="ml-1 text-[9px] text-emerald-400 font-black">✨ ใหม่</span>}
                          {hasRounds && !(r as any).new_system && <span className="ml-1 text-[9px] text-amber-400 font-bold">(รอบ {r.rework_batch ?? 1})</span>}
                          {isRep && !(r as any).new_system && <span className="ml-1 text-[9px] text-amber-400 font-bold">🔁 ทดแทน</span>}
                          {!isRep && isNew && <span className="ml-1 text-[9px] text-green-400">NEW</span>}
                          {isDone && <span className="ml-1 text-[9px] text-green-400">📦</span>}
                        </div>
                        <div className={`px-3 py-2.5 text-xs ${isDone?'text-slate-600 line-through':'text-slate-400'}`}>{fmt((r.weight??0)+(r.core_weight??0),dec)}</div>
                        <div className={`px-3 py-2.5 font-black ${isRep ? 'text-amber-300' : isDone?'text-slate-600 line-through':'text-brand-300'}`}>{fmt(r.weight??0,dec)}</div>
                      </div>
                      {isRework && r.remark && (
                        <div className="px-3 pb-2 -mt-1 text-[10px] text-blue-300 leading-snug">{r.remark}</div>
                      )}
                    </div>
                  )
                    })
                })()}
                {weighedRolls.filter((r:any)=>r?.roll_type==='good').length===0 && (
                  <div className="py-8 text-center text-slate-600 text-xs">ยังไม่มีม้วนดี</div>
                )}
              </div>
              {/* good footer */}
              <div className="border-t border-slate-800 px-3 py-1.5 bg-slate-900 flex justify-between text-xs shrink-0">
                <span className="text-slate-500">{weighedRolls.filter((r:any)=>r?.roll_type==='good').length} ม้วน</span>
                <span className="text-brand-300 font-black">{fmt(weighedKg,dec)} Kgs.</span>
              </div>
            </div>

            {/* ── ม้วนกรอ (ส่งกรอ — ไม่รวมที่รอผจก) ────────── */}
            {profile.section !== 'rewind' && (
            <div className="flex-1 flex flex-col min-w-0">
              <div className="px-3 py-2 bg-orange-500/10 border-b border-orange-500/20 shrink-0">
                <span className="text-orange-300 text-xs font-bold">● ม้วนกรอ</span>
              </div>
              <div className="grid grid-cols-4 border-b border-slate-800 bg-slate-800/20 shrink-0">
                {['เวลา','ม้วน','นน.กรอ','เหตุผล'].map(h=>(
                  <div key={h} className="px-3 py-1.5 text-slate-500 text-[9px] font-semibold uppercase">{h}</div>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-slate-800/40">
                {(() => {
                  const bads = weighedRolls.filter((r:any)=>r.roll_type==='bad' && (r as any).review_status !== 'pending_review')
                  const isReplacement = (r:any) =>
                    bads.some((x:any) => (x.roll_no ?? 0) > (r.roll_no ?? 0) && new Date(x.created_at) < new Date(r.created_at))
                  return [...bads]
                    .sort((a:any,b:any) => (a.roll_no ?? 0) - (b.roll_no ?? 0))
                    .map((r:any) => {
                  const isNew = lastRoll?.id === r.id
                  const isRep = isReplacement(r)
                  const d2    = new Date(r.created_at)
                  const dateShort2 = `${d2.getDate()}/${d2.getMonth()+1}`
                  const time  = d2.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})
                  return (
                    <div key={r.id} onClick={()=>setSelectedRoll(r)}
                      className={`grid grid-cols-4 hover:bg-slate-800/40 cursor-pointer transition-colors ${
                        isRep ? 'bg-amber-500/10 border-l-4 border-amber-500' : isNew ? 'bg-orange-500/5' : ''
                      }`}>
                      <div className="px-3 py-2.5 text-slate-500 text-xs leading-tight">
                        <div className="text-[9px] text-slate-600">{dateShort2}</div>
                        <div>{time}</div>
                      </div>
                      <div className="px-3 py-2.5">
                        <span className={`font-bold font-mono ${isRep ? 'text-amber-300' : 'text-orange-200'}`}>{r.roll_no}</span>
                        {isRep && <span className="ml-1 text-[9px] text-amber-400 font-bold">🔁 ทดแทน</span>}
                        {!isRep && isNew && <span className="ml-1 text-[9px] text-orange-400">NEW</span>}
                      </div>
                      <div className={`px-3 py-2.5 font-black ${isRep ? 'text-amber-300' : 'text-orange-300'}`}>{fmt(r.weight??0,dec)}</div>
                      <div className="px-3 py-2.5 text-slate-400 text-xs truncate">{r.remark||'—'}</div>
                    </div>
                  )
                    })
                })()}
                {weighedRolls.filter((r:any)=>r?.roll_type==='bad' && (r as any).review_status !== 'pending_review').length===0 && (
                  <div className="py-8 text-center text-slate-600 text-xs">ยังไม่มีม้วนกรอ</div>
                )}
              </div>
              {/* bad footer */}
              <div className="border-t border-slate-800 px-3 py-1.5 bg-slate-900 flex justify-between text-xs shrink-0">
                <span className="text-slate-500">{weighedRolls.filter((r:any)=>r?.roll_type==='bad' && (r as any).review_status !== 'pending_review').length} ม้วน</span>
                <span className="text-orange-300 font-black">{fmt(weighedRolls.filter((r:any)=>r?.roll_type==='bad' && (r as any).review_status !== 'pending_review').reduce((s:number,r:any)=>s+(r.weight??0),0),dec)} Kgs.</span>
              </div>
              {/* เศษ summary + รายถุง (คลิกเพื่อรีปริ้นใบปะหน้าเศษ) */}
              {weighedRolls.some((r:any)=>r.roll_type?.startsWith('scrap')) && (
                <div className="border-t border-slate-700 bg-slate-800/30 px-3 py-2 space-y-1.5 shrink-0 max-h-48 overflow-y-auto">
                  <p className="text-amber-400 text-[9px] font-bold uppercase">เศษเสีย — คลิกถุงเพื่อรีปริ้นใบปะหน้า</p>
                  {(['scrap_clear','scrap_color','scrap_lump'] as const).map(t => {
                    const rows = weighedRolls.filter((r:any)=>r.roll_type===t)
                    if (!rows.length) return null
                    const label = t==='scrap_clear'?'ใส':t==='scrap_color'?'สี':'ก้อน'
                    const total = rows.reduce((s:number,r:any)=>s+(r.weight??0),0)
                    return (
                      <div key={t}>
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-500">เศษ{label} ({rows.length})</span>
                          <span className="text-amber-300 font-semibold">{fmt(total,dec)} Kgs.</span>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {rows.map((r:any, i:number) => (
                            <button key={r.id} onClick={()=>setSelectedRoll(r)}
                              title="คลิกเพื่อรีปริ้นใบปะหน้าเศษ"
                              className="text-[10px] bg-slate-800 hover:bg-amber-500/20 border border-slate-700 hover:border-amber-500/50 text-slate-300 px-1.5 py-0.5 rounded">
                              🖨 ถุง {i+1} · {fmt(r.weight??0,dec)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            )}

            {/* ── ⏳ รอ ผจก พิจารณา ────────────────────────── */}
            {profile.section !== 'rewind' && (
            <div className="flex-1 flex flex-col min-w-0">
              <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/20 shrink-0">
                <span className="text-amber-300 text-xs font-bold">⏳ รอ ผจก พิจารณา</span>
              </div>
              <div className="grid grid-cols-4 border-b border-slate-800 bg-slate-800/20 shrink-0">
                {['เวลา','ม้วน','นน.','เหตุผล'].map(h=>(
                  <div key={h} className="px-3 py-1.5 text-slate-500 text-[9px] font-semibold uppercase">{h}</div>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-slate-800/40">
                {(() => {
                  const pending = weighedRolls.filter((r:any) => r.roll_type === 'bad' && (r as any).review_status === 'pending_review')
                  return [...pending]
                    .sort((a:any,b:any) => (a.roll_no ?? 0) - (b.roll_no ?? 0))
                    .map((r:any) => {
                      const isNew = lastRoll?.id === r.id
                      const d = new Date(r.created_at)
                      const dateShort = `${d.getDate()}/${d.getMonth()+1}`
                      const time = d.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})
                      return (
                        <div key={r.id} onClick={()=>setSelectedRoll(r)}
                          className={`grid grid-cols-4 hover:bg-slate-800/40 cursor-pointer transition-colors ${isNew ? 'bg-amber-500/5' : ''}`}>
                          <div className="px-3 py-2.5 text-slate-500 text-xs leading-tight">
                            <div className="text-[9px] text-slate-600">{dateShort}</div>
                            <div>{time}</div>
                          </div>
                          <div className="px-3 py-2.5">
                            <span className="font-bold font-mono text-amber-200">{r.roll_no}</span>
                            {isNew && <span className="ml-1 text-[9px] text-amber-400">NEW</span>}
                          </div>
                          <div className="px-3 py-2.5 font-black text-amber-300">{fmt(r.weight??0,dec)}</div>
                          <div className="px-3 py-2.5 text-slate-400 text-xs truncate">{r.remark||'—'}</div>
                        </div>
                      )
                    })
                })()}
                {weighedRolls.filter((r:any) => r.roll_type === 'bad' && (r as any).review_status === 'pending_review').length === 0 && (
                  <div className="py-8 text-center text-slate-600 text-xs">ไม่มีม้วนรอพิจารณา</div>
                )}
              </div>
              {/* pending footer */}
              <div className="border-t border-slate-800 px-3 py-1.5 bg-slate-900 flex justify-between text-xs shrink-0">
                <span className="text-slate-500">
                  {weighedRolls.filter((r:any) => r.roll_type === 'bad' && (r as any).review_status === 'pending_review').length} ม้วน
                </span>
                <span className="text-amber-300 font-black">
                  {fmt(weighedRolls.filter((r:any) => r.roll_type === 'bad' && (r as any).review_status === 'pending_review').reduce((s:number,r:any) => s + (r.weight??0), 0), dec)} Kgs.
                </span>
              </div>
            </div>
            )}

          </div>
        </div>
      </div>

      {/* ── Modal: ประวัติม้วน ─────────────────────────────── */}
      {/* ── Modal ปิดงาน ─────────────────────────────────── */}
      {showCloseModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border-2 border-green-500/40 rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-800">
              <p className="text-white font-bold text-lg flex items-center gap-2">🏁 ปิดงาน · พิมพ์สรุปการผลิต</p>
              <p className="text-slate-400 text-xs mt-1">{profile.productName} · Lot {profile.lotNo}</p>
            </div>

            <div className="px-6 py-4 space-y-3">
              {/* KPI */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-slate-800 rounded-xl p-3 text-center">
                  <p className="text-slate-500 text-[10px]">ยอดสั่ง</p>
                  <p className="text-white font-black text-xl">{fmt(planned,dec)}</p>
                  <p className="text-slate-600 text-[9px]">Kgs.</p>
                </div>
                <div className="bg-green-500/10 border border-green-500/25 rounded-xl p-3 text-center">
                  <p className="text-green-400 text-[10px]">ผลิตดี</p>
                  <p className="text-green-300 font-black text-xl">{fmt(goodKg,dec)}</p>
                  <p className="text-slate-500 text-[9px]">{goodRolls.length} ม้วน</p>
                </div>
                <div className="bg-brand-500/10 border border-brand-500/25 rounded-xl p-3 text-center">
                  <p className="text-brand-400 text-[10px]">Yield</p>
                  <p className="text-brand-300 font-black text-xl">{yieldPct}%</p>
                  <p className="text-slate-500 text-[9px]">เทียบผลิตรวม</p>
                </div>
              </div>

              {/* Details */}
              <div className="bg-slate-800 rounded-xl p-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-slate-400">ม้วนกรอ</span><b className="text-orange-300">{fmt(badKg,dec)} Kgs. ({badRolls.length})</b></div>
                <div className="flex justify-between"><span className="text-slate-400">เศษเสีย</span><b className="text-amber-300">{fmt(scrapKg,dec)} Kgs. ({scrapRolls.length})</b></div>
                <div className="flex justify-between border-t border-slate-700 pt-1.5"><span className="text-slate-400">โอนเข้าคลัง</span><b className="text-green-300">{fmt(transferredKg,dec)} Kgs.</b></div>
                <div className="flex justify-between"><span className="text-slate-400">ยังไม่โอน</span><b className="text-amber-300">{fmt(goodKg-transferredKg,dec)} Kgs.</b></div>
              </div>

              {goodKg-transferredKg > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2 text-xs text-amber-300">
                  ⚠️ ยังมี <b>{fmt(goodKg-transferredKg)} Kgs.</b> ที่ยังไม่ได้โอนเข้าคลัง
                </div>
              )}
              <p className="text-slate-500 text-xs text-center">เลือกการดำเนินการ:</p>
            </div>

            <div className="px-6 pb-4 space-y-2">
              <button onClick={async () => {
                  const by = prompt('ชื่อผู้พักงาน:')
                  if (!by || !by.trim()) return
                  setClosing(true)
                  try {
                    const { error: parkErr } = await supabase.from('parked_jobs').upsert(
                      { machine_no: profile.machine_no, lot_no: profile.lotNo, profile_snapshot: profile, parked_by: by.trim(), parked_at: new Date().toISOString() },
                      { onConflict: 'machine_no,lot_no' }
                    )
                    if (parkErr) { alert('พักงานไม่สำเร็จ — งานยังอยู่ที่เครื่อง:\n' + parkErr.message); setClosing(false); return }
                    await supabase.from('machine_profiles').update({
                      cust_code:'', cust_name:'', cust_branch:'', cust_address:'',
                      item_code:'', mat_code:'', product_code:'', product_name:'',
                      width_cm:'', thick_mc:'',
                      lot_no:'', length:'', pcs:'',
                      planned_qty:'',
                      inspector:'',
                    }).eq('machine_no', profile.machine_no)
                    alert(`⏸ พักงาน "${profile.productName}" แล้ว — ดึงคืนได้ที่หน้าเลือกเครื่อง (ปุ่ม 🅿 มีงานจอด)`)
                    setShowCloseModal(false)
                    onBack()
                  } catch (e:any) {
                    alert('พักงานไม่สำเร็จ: ' + e?.message)
                  } finally { setClosing(false) }
                }} disabled={closing}
                className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white py-3 rounded-xl font-bold transition-colors flex items-center justify-center gap-2">
                ⏸ พักงาน (ดึงกลับมาทำต่อได้)
              </button>
              <button onClick={handleCloseJob} disabled={closing}
                className="w-full bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white py-3 rounded-xl font-bold transition-colors flex items-center justify-center gap-2">
                {closing ? 'กำลังปิด...' : '🏁 ปิดงานถาวร (ปิดสรุปยอด)'}
              </button>
              <p className="text-[10px] text-slate-500 text-center">
                <b className="text-amber-400">พัก:</b> profile หาย ม้วนยังอยู่ — ดึงกลับได้ทุกเมื่อ ·
                <b className="text-brand-400 ml-2">ปิดถาวร:</b> เขียน summary + ดึงงานเก่าได้จากปุ่ม "📂 ดึงงานเก่า"
              </p>
              <button onClick={() => setShowCloseModal(false)} disabled={closing}
                className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-400 py-2 rounded-xl text-sm transition-colors">
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal บังคับกรอกผู้ตรวจสอบ ─────────────────── */}
      {showInspectorPrompt && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4">
          <div className="bg-slate-900 border-2 border-brand-500/40 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="px-6 py-5 text-center relative">
              {/* ปุ่ม X → กลับหน้าแรก */}
              <button onClick={onBack}
                className="absolute top-3 right-3 text-slate-500 hover:text-white w-7 h-7 rounded-lg hover:bg-slate-700 flex items-center justify-center transition-colors">
                <X size={16}/>
              </button>
              {/* เลขเครื่อง — ใหญ่ชัดเจน */}
              <div className="bg-brand-600/20 border-2 border-brand-500/50 rounded-2xl px-6 py-3 mb-4 inline-block">
                <p className="text-brand-300 text-[11px] font-semibold uppercase tracking-widest mb-0.5">เครื่อง</p>
                <p className="text-white font-black text-5xl tracking-wider">{profile.machine_no}</p>
              </div>
              <p className="text-slate-300 text-sm font-semibold truncate px-2">{profile.productName}</p>
              <p className="text-white font-bold text-lg mt-3">ผู้ตรวจสอบกะนี้คือใคร?</p>
              {isStale && inspector && (
                <p className="text-amber-400 text-xs mt-2">⚠️ ผ่านมา {Math.floor(hoursSinceSet)} ชั่วโมง — เปลี่ยนกะหรือยัง?</p>
              )}
              <input value={inspectorInput} onChange={e => setInspectorInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmInspector(inspectorInput) }}
                placeholder="ชื่อผู้ตรวจสอบ..."
                autoFocus
                className="w-full mt-4 bg-slate-800 border-2 border-slate-700 rounded-xl px-4 py-3 text-white text-lg text-center outline-none focus:border-brand-500" />
            </div>
            <div className="px-6 py-4 border-t border-slate-800">
              <button onClick={() => confirmInspector(inspectorInput)}
                disabled={!inspectorInput.trim()}
                className="w-full bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white py-3 rounded-xl font-bold text-base transition-colors">
                ✓ ยืนยัน
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedRoll && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedRoll(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
              <div>
                <p className="text-white font-bold">Roll {selectedRoll.roll_no}</p>
                <p className="text-slate-400 text-xs">{profile.machine_no} · {profile.lotNo}</p>
              </div>
              <button onClick={() => setSelectedRoll(null)}>
                <X size={18} className="text-slate-400 hover:text-white"/>
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              {/* น้ำหนัก 3 ค่า */}
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label:'นน.เต็ม',  val: fmt((selectedRoll.weight??0)+(selectedRoll.core_weight??0), dec), cls:'text-slate-300 text-lg' },
                  { label:'นน.แกน',   val: fmt(selectedRoll.core_weight??0, dec),  cls:'text-slate-500 text-lg' },
                  { label:'นน.สุทธิ', val: fmt(selectedRoll.weight??0, dec),       cls:'text-brand-400 font-black text-2xl' },
                ].map(item => (
                  <div key={item.label} className="bg-slate-800 rounded-xl py-3">
                    <p className="text-slate-500 text-[9px] mb-1">{item.label}</p>
                    <p className={`font-bold ${item.cls}`}>{item.val}</p>
                    <p className="text-slate-600 text-[9px]">Kgs.</p>
                  </div>
                ))}
              </div>

              {/* รายละเอียด */}
              <div className="bg-slate-800 rounded-xl px-4 py-3 space-y-2">
                {[
                  { k:'ลูกค้า',      v: profile.custName },
                  { k:'สินค้า',      v: profile.productName },
                  { k:'Mat Code',    v: profile.matCode,    mono:true },
                  { k:'Lot No',      v: profile.lotNo,      mono:true },
                  { k:'ขนาด',        v: fmtSize(profile.widthCm, profile.thickMc, profile.widthUnit) || '—' },
                  { k:'ความยาว',     v: ((selectedRoll.length || profile.length)
                      ? `${selectedRoll.length || profile.length} M.${(selectedRoll.pcs || profile.pcs) ? ` · ${selectedRoll.pcs || profile.pcs} Pcs.` : ''}`
                      : '—') },
                  { k:'เครื่อง',     v: profile.machine_no },
                  { k:'ผู้ตรวจสอบ', v: selectedRoll.inspector || profile.inspector || '—' },
                  { k:'วันที่ชั่ง',  v: `${new Date(selectedRoll.created_at).toLocaleDateString('th-TH')} ${new Date(selectedRoll.created_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})}` },
                ].map(row => (
                  <div key={row.k} className="flex justify-between items-baseline gap-2">
                    <span className="text-slate-500 text-xs shrink-0">{row.k}</span>
                    <span className={`text-right text-sm font-semibold text-slate-200 truncate ${(row as any).mono ? 'font-mono' : ''}`}>{row.v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Reprint */}
            <div className="flex gap-2 px-5 pt-4 border-t border-slate-800">
              <button onClick={() => printLabel({...profile, length: selectedRoll.length || profile.length, pcs: selectedRoll.pcs || profile.pcs, inspector: selectedRoll.inspector || profile.inspector}, selectedRoll.roll_no, selectedRoll.gross_weight??0, selectedRoll.weight??0, 'short', selectedRoll.roll_type, selectedRoll.remark??'', selectedRoll.id)}
                className="flex-1 flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white text-sm py-2.5 rounded-xl transition-colors">
                <Printer size={14}/> ใบสั้น
              </button>
              <button onClick={() => printLabel({...profile, length: selectedRoll.length || profile.length, pcs: selectedRoll.pcs || profile.pcs, inspector: selectedRoll.inspector || profile.inspector}, selectedRoll.roll_no, selectedRoll.gross_weight??0, selectedRoll.weight??0, 'long', selectedRoll.roll_type, selectedRoll.remark??'', selectedRoll.id)}
                className="flex-1 flex items-center justify-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white text-sm py-2.5 rounded-xl transition-colors font-semibold">
                <Printer size={14}/> ใบยาว
              </button>
            </div>

            {/* ลบม้วน */}
            <div className="px-5 pb-4 pt-2">
              <button onClick={() => { setDeleteModal({ roll: selectedRoll }); setDeleteReason(''); setDeleteBy('') }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-red-900/20 hover:bg-red-900/50 text-red-400 hover:text-red-300 border border-red-900/30 transition-colors">
                <X size={14}/> ลบม้วนนี้ (ชั่งผิด / งานผิด)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Modal ────────────────────────────────────────────────── */}
      {deleteModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => !deleting && setDeleteModal(null)}>
          <div className="bg-slate-900 border border-red-900/50 rounded-2xl w-full max-w-sm p-5 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-full bg-red-900/40 flex items-center justify-center">
                <X size={16} className="text-red-400"/>
              </div>
              <div>
                <p className="text-white font-bold text-sm">ลบม้วน {deleteModal.roll.roll_no}</p>
                <p className="text-slate-500 text-xs">{fmt(deleteModal.roll.weight??0,dec)} Kgs. · {deleteModal.roll.machine_no}</p>
              </div>
            </div>

            <div className="space-y-3 mb-4">
              <label className="flex flex-col gap-1">
                <span className="text-slate-400 text-xs font-semibold">ชื่อผู้ลบ *</span>
                <input value={deleteBy} onChange={e => setDeleteBy(e.target.value)}
                  placeholder="กรอกชื่อ..."
                  className="bg-slate-800 text-white text-sm rounded-lg px-3 py-2 border border-slate-700 focus:border-red-500 focus:outline-none"/>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-slate-400 text-xs font-semibold">เหตุผลที่ลบ *</span>
                <input value={deleteReason} onChange={e => setDeleteReason(e.target.value)}
                  placeholder="เช่น ชั่งผิดงาน, กรอกข้อมูลผิด..."
                  className="bg-slate-800 text-white text-sm rounded-lg px-3 py-2 border border-slate-700 focus:border-red-500 focus:outline-none"/>
              </label>

              {/* แจ้งว่าม้วนถัดไปจะทดแทนเลขที่ถูกลบ */}
              {deleteModal.roll.roll_no > 0 && (deleteModal.roll.roll_type === 'good' || deleteModal.roll.roll_type === 'bad') && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-2.5 text-xs text-blue-200 leading-snug">
                  <span className="font-bold">💡 ม้วนถัดไปจะเป็น #{deleteModal.roll.roll_no}</span><br/>
                  <span className="text-blue-300/80">ระบบจะแจ้งให้ชั่งทดแทนเลขที่ถูกลบนี้ก่อน เพื่อไม่ให้เลขแหว่ง — ไม่ต้องเลื่อนเลขม้วนเก่า</span>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button onClick={() => setDeleteModal(null)} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl text-sm text-slate-400 bg-slate-800 hover:bg-slate-700 transition-colors">
                ยกเลิก
              </button>
              <button onClick={confirmDelete} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50">
                {deleting ? 'กำลังลบ...' : 'ยืนยันลบ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function WeighStation({ dept }: { dept?: 'blow' | 'print' | 'rewind' }) {
  const [selected, setSelected] = useState<MachineProfile | null>(null)
  const [profiles, setProfiles] = useState<MachineProfile[]>(loadProfiles())

  function reload() {
    supabase.from('machine_profiles').select('*').order('machine_no')
      .then(({ data }) => {
        if (!data) return
        const list = data.map((r: any) => ({
          machine_no:  r.machine_no,
          custCode:    r.cust_code    ?? '',
          custName:    r.cust_name    ?? '',
          custBranch:  r.cust_branch  ?? '',
          custAddress: r.cust_address ?? '',
          decimal:    (r.decimal_places ?? 2) as 1|2,
          itemCode:    r.item_code    ?? '',
          matCode:     r.mat_code     ?? '',
          productCode: r.product_code ?? '',
          productName: r.product_name ?? '',
          widthCm:     r.width_cm     ?? '',
          widthUnit:   (r.width_unit  ?? 'cm') as 'cm'|'mm',
          thickMc:     r.thick_mc     ?? '',
          lotNo:       r.lot_no       ?? '',
          length:      r.length       ?? '',
          pcs:         r.pcs          ?? '',
          coreWeight:  r.core_weight  ?? '1.25',
          inspector:   r.inspector    ?? '',
          locked:      r.locked       ?? false,
          plannedQty:  r.planned_qty  ?? '',
          labelSize:  (r.label_size   ?? 'long') as 'long'|'short',
          headerText:  r.header_text  ?? '',
          blankHeader: r.blank_header ?? false,
          section:    (r.section      ?? 'blow') as 'blow'|'print'|'rewind',
          soNo:        r.sale_order   ?? '',
          woNo:        r.work_order   ?? '',
          deliveryDate: r.delivery_date ?? '',
          freshStart:  r.fresh_start  ?? false,
        }))
        setProfiles(list)
        saveProfiles(list)
        // ✨ sync selected ด้วย — กัน WeighPage ใช้ profile เก่า (เช่น widthUnit ที่เพิ่งเปลี่ยน)
        setSelected(prev => prev ? (list.find(x => x.machine_no === prev.machine_no) ?? prev) : null)
      })
  }

  useEffect(() => { reload() }, [])

  // filter เครื่องตาม dept
  const filtered = dept ? profiles.filter(p => (p.section ?? 'blow') === dept) : profiles

  if (!selected) {
    // แผนกกรอ: ใช้ job-centric list แทน machine picker
    if (dept === 'rewind') {
      return <ReworkJobList onPickJob={(prof) => setSelected(prof)} />
    }
    return <MachinePicker profiles={filtered} onSelect={setSelected} onProfileUpdated={reload} dept={dept} />
  }
  return <WeighPage profile={selected} onBack={() => { setSelected(null); reload() }} />
}
