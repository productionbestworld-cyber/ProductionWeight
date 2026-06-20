// รีปริ้นใบปะหน้าใบยาว ทุกม้วนดี (lot ปัจจุบัน) ของเครื่องที่ระบุ → ไฟล์ HTML เดียว (Ctrl+P ปริ้นรวด)
import { createClient } from '@supabase/supabase-js'
import QRCode from 'qrcode'
import { writeFileSync } from 'node:fs'

const url='https://belwjdajuaxbhaqtlhrj.supabase.co'
const key='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbHdqZGFqdWF4YmhhcXRsaHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzgzNzYsImV4cCI6MjA5NDM1NDM3Nn0.aM-DKa8v0OlQQW6MsDzmCrEFY0d8rEVgzuemZ8UKZJA'
const APP='https://production-weight.vercel.app'  // ใช้ทำ QR (โดเมน production)
const MACHINES=['BL03']
const NAME_OVERRIDE=''  // '' = ใช้ชื่อจากม้วน · ใส่ชื่อ = บังคับใช้ชื่อนี้
const LOT_ONLY='69BL03000106'   // '' = ทุก lot · ใส่ = เฉพาะ lot นี้
const WO_ONLY='69/06/108'   // '' = ทุก WO · ใส่ = เฉพาะ WO นี้
const ROLL_FROM=8   // 0 = ไม่จำกัด · ใส่ = เฉพาะม้วนตั้งแต่เลขนี้
const ROLL_TO=30    // 0 = ไม่จำกัด · ใส่ = เฉพาะม้วนถึงเลขนี้
const sb=createClient(url,key)

const fmt=(n,d=2)=>{ const x=Number(n); return isNaN(x)?(0).toFixed(d):x.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}) }
const thai=d=>`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()+543}`

// layout
const {data:lay}=await sb.from('label_layouts').select('layout').eq('id','long').single()
const L=lay.layout
// profiles
const {data:profs}=await sb.from('machine_profiles').select('*').in('machine_no',MACHINES)
const profByM=new Map(profs.map(p=>[p.machine_no,p]))

const jobs=new Map()  // jobKey -> {meta, labels[]}
for(const m of MACHINES){
  const mp=profByM.get(m); if(!mp) continue
  const useLot = LOT_ONLY || mp.lot_no; if(!useLot) continue
  const curWO=String(mp.work_order??'').trim()
  const {data:rolls}=await sb.from('production_rolls').select('*')
    .eq('machine_no',m).eq('lot_no',useLot).eq('roll_type','good').order('roll_no')
  for(const r of (rolls||[])){
    if(WO_ONLY && String(r.work_order??'').trim()!==WO_ONLY) continue
    if(ROLL_FROM && Number(r.roll_no)<ROLL_FROM) continue
    if(ROLL_TO && Number(r.roll_no)>ROLL_TO) continue
    const isRunning = String(r.work_order??'').trim()===curWO
    const jobKey=`${m}|${r.lot_no}|${r.work_order??''}`
    const dec=mp.decimal_places??2
    const mfgDate=thai(new Date(r.created_at))
    const showExp=String(mp.cust_code??'').trim()==='08'
    const exp=(()=>{const d=new Date(r.created_at);d.setMonth(d.getMonth()+6);return thai(d)})()
    const core=Number(r.core_weight)||0, gross=Number(r.gross_weight)||0, net=Number(r.weight)||0
    const qr=await QRCode.toDataURL(`${APP}/?roll=${r.id}`,{width:144,margin:1,errorCorrectionLevel:'M'})
    // ใช้ข้อมูล "ของม้วนตอนชั่งจริง" (r) ก่อน · ถ้าไม่มีค่อย fallback profile (mp)
    const MAT=r.mat_code||mp.mat_code||'', PC=r.product_code||mp.product_code||''
    const PN=NAME_OVERRIDE||r.product_name||mp.product_name||''
    const W=r.width_cm||mp.width_cm||'', WU=r.width_unit||mp.width_unit||'cm', TH=r.thick_mc||mp.thick_mc||''
    const D={
      header:(mp.header_text?.trim()||'บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด'),
      mat:`Mat Code&nbsp;&nbsp;<b style="font-size:1.15em">${MAT}</b>`,
      mfg:`MFG Date&nbsp;&nbsp;<b style="font-size:1.15em">${mfgDate}</b>${showExp?`&nbsp;&nbsp;&nbsp;EXP&nbsp;&nbsp;<b style="font-size:1.15em">${exp}</b>`:''}`,
      rollno:`Roll No.&nbsp;&nbsp;<b style="font-size:1.15em">${r.roll_no}</b>`,
      prodcode:PC?`<span style="font-weight:400">Product Code</span>&nbsp;&nbsp;<b>${PC}</b>`:'',
      prodname:`<span style="font-weight:400">Product Name</span>&nbsp;&nbsp;<b>${PN}</b>`,
      machine:`เครื่อง&nbsp;&nbsp;<b>${r.machine_no||mp.machine_no}</b>`,
      core:`Core Weight&nbsp;&nbsp;<b>${fmt(core,dec)}</b>`,
      size:`Size&nbsp;&nbsp;<b style="font-size:1.2em">${W}</b>&nbsp;${WU}&nbsp;×&nbsp;<b style="font-size:1.2em">${TH}</b>&nbsp;mc`,
      lotno:`Lot No&nbsp;&nbsp;<b>${r.lot_no}</b>`,
      length:`Length&nbsp;&nbsp;<b>${mp.length||'—'}</b>&nbsp;M.${mp.pcs?`&nbsp;&nbsp;<b>${mp.pcs}</b>&nbsp;Pcs.`:''}`,
      gross:`Gross Weight&nbsp;&nbsp;<b>${fmt(gross,dec)} Kgs.</b>`,
      net:fmt(net,dec),
      barcode_lbl:'Barcode No.',
      inspector:`ผู้ตรวจสอบ&nbsp;&nbsp;<b>${r.inspector||mp.inspector||'—'}</b>`,
    }
    const render=f=>{
      if(!f.visible) return ''
      if(f.type==='separator'){ return f.h>f.w
        ?`<div style="position:absolute;left:${f.x}mm;top:${f.y}mm;width:0;height:${f.h}mm;border-left:1px solid #000"></div>`
        :`<div style="position:absolute;left:${f.x}mm;top:${f.y}mm;width:${f.w}mm;height:0;border-top:1px solid #000"></div>` }
      if(f.type==='qr'){ const px=Math.round(f.h*3.78); return `<img src="${qr}" width="${px}" height="${px}" style="position:absolute;left:${f.x}mm;top:${f.y}mm;width:${f.w}mm;height:${f.h}mm;image-rendering:pixelated"/>` }
      const v=D[f.id]??f.sampleValue??''
      const border=f.border?'border:1px solid #000;':''
      const justify=f.align==='center'?'justify-content:center;':f.align==='right'?'justify-content:flex-end;':''
      if(f.type==='weight'){ return `<div style="position:absolute;left:${f.x}mm;top:${f.y}mm;width:${f.w}mm;height:${f.h}mm;${border}padding:0 1mm"><div style="font-size:7.5pt;font-weight:700;line-height:1.4">Net Weight</div><div style="font-size:${f.fontSize}pt;font-weight:900;line-height:1;color:#003087">${v}</div><div style="font-size:8pt;font-weight:700;line-height:1.3">Kgs.</div></div>` }
      return `<div style="position:absolute;left:${f.x}mm;top:${f.y}mm;width:${f.w}mm;height:${f.h}mm;font-size:${f.fontSize}pt;font-weight:${f.fontWeight};text-align:${f.align};${border}display:flex;align-items:center;${justify}padding:0 0.5mm"><span style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.1;width:100%;word-break:break-word">${v}</span></div>`
    }
    const inner=L.fields.map(render).join('\n')
    if(!jobs.has(jobKey)) jobs.set(jobKey,{ machine:m, lot:r.lot_no, wo:String(r.work_order??''), so:String(r.sale_order??''), prod:NAME_OVERRIDE||r.product_name||mp.product_name||'', running:isRunning, labels:[] })
    jobs.get(jobKey).labels.push(`<div class="lbl">${inner}</div>`)
  }
}

const page=(title,secs)=>`<!doctype html><html><head><meta charset="utf-8">
<style>@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800;900&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Sarabun','Arial',sans-serif;color:#000;background:#eee}
.lbl{position:relative;width:${L.labelW}mm;height:${L.labelH}mm;border:1.5px solid #000;background:#fff;overflow:hidden;page-break-after:always;margin:4mm auto}
@media print{body{background:#fff}@page{size:${L.labelW}mm ${L.labelH}mm;margin:0}.lbl{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}.noprint{display:none}}
</style></head><body>
<div style="text-align:center;padding:8px;font-family:sans-serif" class="noprint">
<b>${title} — ${secs.length} ใบ</b> · <button onclick="window.print()">🖨 ปริ้น</button></div>
${secs.join('\n')}
</body></html>`

const safe=s=>String(s).replace(/[\\/:*?"<>|]/g,'-').replace(/\s+/g,'').slice(0,30)
const list=[...jobs.values()].sort((a,b)=> (a.running===b.running?0:a.running?-1:1))
for(const j of list){
  const status=j.running?'🟢กำลังเดิน':'■จบแล้ว'
  const title=`${status} · ${j.machine} · ${j.prod} · WO ${j.wo||'—'} · Lot ${j.lot}`
  const fn=`C:\\Users\\Meeting\\Desktop\\reprint_${j.machine}_WO${safe(j.wo)}_${safe(j.prod)}.html`
  writeFileSync(fn,page(title,j.labels),'utf8')
  console.log(`✓ ${j.machine} WO${j.wo||'-'} (${j.running?'กำลังเดิน':'จบแล้ว'}) ${j.labels.length} ใบ → ${fn}`)
}
console.log(`รวม ${list.length} งาน`)
