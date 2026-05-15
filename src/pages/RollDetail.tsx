// หน้านี้แสดงเมื่อสแกน QR จากใบปะหน้า
// URL: /?roll=BASE64_JSON

import QRCode from 'react-qr-code'

interface RollData {
  mat:      string
  lot:      string
  roll:     number
  net:      string
  gross:    string
  core:     string
  machine:  string
  date:     string
  time:     string
  customer: string
  product:  string
  width?:   string
  thick?:   string
  length?:  string
  inspector?:string
  planned?: string
}

export default function RollDetail() {
  const params = new URLSearchParams(window.location.search)
  const raw    = params.get('roll')

  if (!raw) return null

  let d: RollData
  try {
    d = JSON.parse(atob(raw))
  } catch {
    return (
      <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center text-red-400">
        ข้อมูลไม่ถูกต้อง
      </div>
    )
  }

  const currentUrl = window.location.href

  return (
    <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-brand-700 px-5 py-4 text-center">
          <p className="text-white/70 text-xs">บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด</p>
          <p className="text-white font-black text-xl mt-0.5">ม้วนที่ #{d.roll}</p>
          <p className="text-brand-200 text-sm">{d.machine} · {d.date} {d.time}</p>
        </div>

        {/* น้ำหนัก */}
        <div className="grid grid-cols-3 divide-x divide-slate-800 border-b border-slate-800">
          {[
            { label: 'นน.เต็ม',  val: d.gross, cls: 'text-slate-300' },
            { label: 'นน.แกน',   val: d.core,  cls: 'text-slate-500' },
            { label: 'นน.สุทธิ', val: d.net,   cls: 'text-brand-400 font-black text-2xl' },
          ].map(item => (
            <div key={item.label} className="py-4 text-center">
              <p className="text-slate-500 text-[10px] uppercase tracking-wider mb-1">{item.label}</p>
              <p className={`font-bold text-xl ${item.cls}`}>{item.val}</p>
              <p className="text-slate-600 text-[9px]">Kgs.</p>
            </div>
          ))}
        </div>

        {/* รายละเอียดสินค้า */}
        <div className="px-5 py-4 space-y-2 border-b border-slate-800">
          <Row label="ลูกค้า"       val={d.customer} />
          <Row label="สินค้า"       val={d.product}  />
          <Row label="Mat Code"     val={d.mat}       mono />
          <Row label="Lot No"       val={d.lot}       mono />
          {d.width  && <Row label="ขนาด" val={`${d.width} cm × ${d.thick} mc`} />}
          {d.length && <Row label="ความยาว" val={`${d.length} Ms.`} />}
          <Row label="เครื่อง"      val={d.machine}  />
          {d.inspector && <Row label="ผู้ตรวจสอบ" val={d.inspector} />}
          {d.planned   && <Row label="ยอดสั่งผลิต" val={`${d.planned} Kgs.`} />}
          <Row label="วันที่ชั่ง"   val={`${d.date} เวลา ${d.time}`} />
        </div>

        {/* QR ของหน้านี้ (สแกนซ้ำได้) */}
        <div className="flex flex-col items-center gap-2 px-5 py-4">
          <p className="text-slate-500 text-[10px] uppercase tracking-wider">QR Code ม้วนนี้</p>
          <div className="bg-white p-3 rounded-xl">
            <QRCode value={currentUrl} size={140} level="M" />
          </div>
          <p className="text-slate-600 text-[9px] text-center">สแกนเพื่อแชร์ข้อมูลม้วนนี้</p>
        </div>

      </div>
    </div>
  )
}

function Row({ label, val, mono }: { label: string; val: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-baseline gap-2">
      <span className="text-slate-500 text-xs shrink-0">{label}</span>
      <span className={`text-right text-sm font-semibold text-slate-200 ${mono ? 'font-mono' : ''}`}>{val}</span>
    </div>
  )
}
