// ─────────────────────────────────────────────────────────────────────────────
// ใบน้ำหนัก (Weight Slip) — ลูกค้าแต่ละเจ้าใช้ฟอร์มคนละแบบแนบไปกับใบส่งของ
// อ่านแบบจริงจาก "แบบฟอร์มใบน้ำหนัก.xlsx" → แตกเป็น 6 เลย์เอาต์
//   cok       ไทยน้ำทิพย์      10 คอลัมน์ (มี หน้ากว้าง / Thickness / MD% / TD%)
//   osotspa   โอสถสภา          5 คอลัมน์ 2 บล็อก/หน้า
//   haadthip  หาดทิพย์         6 คอลัมน์ (มีวันที่ผลิต) 2 บล็อก/หน้า
//   generic   ม้วนพิมพ์/ม้วนใส  5 คอลัมน์ + หมายเหตุ (ฟอร์มกลาง)
//   sevenstar เซเว่นสตาร์       หัวใบมี ขนาด/ทรีท/ความยาว/นน.มาตรฐาน
//   tcp       กระทิงแดง        ฟอร์มของลูกค้าเอง (Batch/Expiry/Pallet + Warehouse Operation)
// ค่าที่ระบบไม่มี (PO, ทะเบียนรถ, เลขที่บิล, ใบกำกับภาษี, เวลา) → เว้นว่างให้เขียนมือ
// ─────────────────────────────────────────────────────────────────────────────
import * as XLSX from 'xlsx'

export type SlipRoll = Record<string, any>

export type SlipExtra = {
  md_pct?: string        // MD % (COK)
  td_pct?: string        // TD % (COK)
  thick_spec?: string    // ต่อท้ายความหนา เช่น "+/-5%"
  treat?: string         // ทรีท (เซเว่นสตาร์)
  material_code?: string // Material Code (TCP) — ว่าง = ใช้รหัสสินค้าของม้วน
  std_weight?: string    // นน.มาตรฐาน/ม้วน (เซเว่นสตาร์)
  length_m?: string      // ความยาว เมตร/ม้วน (เซเว่นสตาร์)
  exp_months?: string    // อายุสินค้า (เดือน) → คำนวณวันหมดอายุ (TCP / ม้วนใส)
}

export type TemplateId = 'cok' | 'osotspa' | 'haadthip' | 'generic' | 'sevenstar' | 'tcp'

export type SlipTemplateRow = {
  id?: number
  cust_code?: string | null
  cust_match: string
  template: TemplateId
  slip_title?: string | null
  extra: SlipExtra
  sort_order?: number
  active?: boolean
}

export type SlipCtx = {
  staff: string
  note: string
  extra: SlipExtra
  titleOverride?: string | null
}

// ── helper ────────────────────────────────────────────────────────────────────
const BKK = 'Asia/Bangkok'

export function esc(s: any) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}
function num(v: any): number {
  const x = Number(String(v ?? '').replace(/,/g, ''))
  return isFinite(x) ? x : 0
}
function n2(v: any): string {
  if (v == null || v === '') return ''
  const x = Number(v)
  return isFinite(x) ? x.toFixed(2) : ''
}
/** นน.รวม — ใช้ gross_weight ถ้ามี ไม่งั้น สุทธิ+แกน */
function gross(r: SlipRoll): number {
  const g = num(r.gross_weight)
  return g > 0 ? g : num(r.weight) + num(r.core_weight)
}
/** วันที่แบบ d/m/yy พ.ศ. — ตรงกับที่เขียนในแบบฟอร์มจริง (5/6/69) */
export function thaiShort(d: Date | string | null | undefined): string {
  if (!d) return ''
  const dt = typeof d === 'string' ? new Date(d) : d
  if (isNaN(dt.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: BKK, day: 'numeric', month: 'numeric', year: 'numeric' })
    .formatToParts(dt)
  const g = (t: string) => parts.find(x => x.type === t)?.value ?? ''
  const yy = (Number(g('year')) + 543) % 100
  return `${g('day')}/${g('month')}/${String(yy).padStart(2, '0')}`
}
function addMonths(d: Date, m: number): Date {
  const x = new Date(d.getTime())
  x.setMonth(x.getMonth() + m)
  return x
}
function expDate(r: SlipRoll, ctx: SlipCtx): string {
  const m = Number(ctx.extra?.exp_months)
  if (!isFinite(m) || m <= 0 || !r.created_at) return ''
  return thaiShort(addMonths(new Date(r.created_at), m))
}

// ── นิยามคอลัมน์ / ฟอร์ม ──────────────────────────────────────────────────────
type Align = 'l' | 'c' | 'r'
type Col = {
  label: string
  sub?: string                                    // บรรทัดที่ 2 ของหัวคอลัมน์
  w: number                                       // สัดส่วนความกว้าง (%)
  align: Align
  get: (r: SlipRoll, i: number, ctx: SlipCtx) => string
  sum?: boolean                                   // รวมท้ายบล็อก
  bold?: boolean
}
type HeadField = { label: string; get: (g: Group, ctx: SlipCtx) => string; wide?: boolean }
/** ข้อมูลที่ส่งให้ตัววาดหัวใบ — F('ป้าย') = ค่าของช่องนั้นจาก head */
type HeadCtx = { g: Group; ctx: SlipCtx; page: number; pages: number; F: (label: string) => string }
type Tpl = {
  id: TemplateId
  label: string
  title: string                                   // หัวใบ (ใช้ตั้งชื่อไฟล์/ชีต Excel)
  company: boolean                                // พิมพ์ชื่อบริษัทเราด้านบน (Excel)
  banner?: string                                 // ฟอร์มของลูกค้าเอง (แทนชื่อบริษัทเรา)
  rowsPerBlock: number
  blocksPerPage: number
  landscape?: boolean
  frame?: boolean                                 // ตีกรอบล้อมทั้งใบ (ฟอร์ม TCP)
  cols: Col[]
  head: HeadField[]                               // คู่ ป้าย/ค่า — ใช้ทั้งวาดหัวใบและ Excel
  renderHead: (h: HeadCtx) => string              // ผังหัวใบเฉพาะของฟอร์มนั้น
  lotTable: boolean
  lotExp?: boolean                                // ตารางท้ายใบมีคอลัมน์ Exp.Date
  tcFooter?: boolean                              // ท้ายใบ Warehouse Operation (TC)
  signature?: boolean
}

const COMPANY = 'บริษัทเบสท์เวิลด์ อินเตอร์พลาส จำกัด'
const TCP_BANNER = 'แบบฟอร์มแจ้งรายการส่งสินค้าบริษัท ที.ซี.ฟาร์มาซูติคอล จำกัด'

// ── ตัวช่วยวาดหัวใบ ──────────────────────────────────────────────────────────
/** ช่องกรอก — ค่าว่าง = เส้นประให้เขียนมือ */
const U = (v: string, w?: string) => `<u${w ? ` style="min-width:${w}"` : ''}>${esc(v)}</u>`
/** ป้าย + ช่องกรอก */
const LV = (label: string, v: string, w?: string) => `<b>${esc(label)}</b>${U(v, w)}`
const PG = (h: HeadCtx) => `หน้า ${h.page}/${h.pages}`

/** หัวใบตระกูลเบสท์เวิลด์ (โอสถสภา / หาดทิพย์ / ฟอร์มกลาง) — ต้นฉบับ:
 *  บริษัท + "ใบน้ำหนักสินค้า" กลางบน · ซ้าย ลูกค้า/สินค้า · ขวา หน้า/วันที่ */
const bwpHead = (h: HeadCtx) => `
<div class="company">${esc(COMPANY)}</div>
<div class="title">${esc(h.ctx.titleOverride || 'ใบน้ำหนักสินค้า')}</div>
<div class="hg">
  ${LV('ลูกค้า', h.F('ลูกค้า'))}${LV('หน้า', PG(h).replace('หน้า ', ''), '20mm')}
  ${LV('สินค้า', h.F('สินค้า'))}${LV('วันที่', h.F('วันที่'), '20mm')}
</div>`

const C = {
  seq:    (label = 'ลำดับ'): Col      => ({ label, w: 7,  align: 'c', get: (_r, i) => String(i + 1) }),
  roll:   (label = 'เลขที่ม้วน'): Col => ({ label, w: 12, align: 'c', bold: true, get: r => String(r.roll_no ?? '') }),
  grossC: (label = 'นน.รวม'): Col     => ({ label, w: 15, align: 'r', sum: true, get: r => n2(gross(r)) }),
  coreC:  (label = 'นน.แกน'): Col     => ({ label, w: 14, align: 'r', sum: true, get: r => n2(r.core_weight) }),
  netC:   (label = 'นน.สุทธิ'): Col   => ({ label, w: 15, align: 'r', sum: true, bold: true, get: r => n2(r.weight) }),
  // ⚠ หมายเหตุต้องเว้นว่างให้เขียนมือ — ห้ามดึง remark ของม้วนมาพิมพ์
  //   remark เก็บโน้ตภายในโรงงาน เช่น "โป่งแตกเม็ดไหม้" / "🔁 กรอจาก Lot ... เหตุผล: ..."
  //   ซึ่งกติกาเดิม (v2.28.0) ห้ามให้โผล่ในเอกสารที่ถึงมือลูกค้า และในแบบฟอร์มต้นฉบับ
  //   ช่องนี้ก็ว่างอยู่แล้ว
  note:   (label = 'หมายเหตุ'): Col   => ({ label, w: 16, align: 'l', get: () => '' }),
}

export const TEMPLATES: Record<TemplateId, Tpl> = {
  // ── ไทยน้ำทิพย์ (COK) ──────────────────────────────────────────────────────
  cok: {
    id: 'cok', label: 'ไทยน้ำทิพย์ (COK)', title: 'ใบน้ำหนัก', company: true,
    rowsPerBlock: 30, blocksPerPage: 1,
    cols: [
      C.seq(),
      { label: 'ม้วนที่', w: 10, align: 'c', bold: true, get: r => String(r.roll_no ?? '') },
      { label: 'หน้ากว้าง', w: 11, align: 'c', get: r => (r.width_cm ? `${r.width_cm} ${r.width_unit || 'cm'}` : '') },
      {
        label: 'AVE.Thickness', sub: '(Micron)', w: 13, align: 'c',
        get: (r, _i, ctx) => (r.thick_mc ? `${r.thick_mc}${ctx.extra?.thick_spec ?? ''}` : ''),
      },
      { label: 'MD %', w: 8, align: 'c', get: (_r, _i, ctx) => ctx.extra?.md_pct ?? '' },
      { label: 'TD %', w: 8, align: 'c', get: (_r, _i, ctx) => ctx.extra?.td_pct ?? '' },
      C.grossC(), C.coreC(), C.netC(), C.note(),
    ],
    head: [
      { label: 'ชื่อลูกค้า', get: g => g.customer, wide: true },
      { label: 'SHRINK FILM', get: g => g.productLine, wide: true },
      { label: 'วันที่', get: () => thaiShort(new Date()) },
      { label: 'Po.', get: () => '' },
    ],
    // ต้นฉบับ: บริษัทกลางบรรทัดบน · "ใบน้ำหนัก" กลาง แถวเดียวกับ หน้า x/y ขวาสุด
    //          ซ้าย "ชื่อลูกค้า : ..." / "SHRINK  FILM : ..."  ขวา วันที่ / Po.
    renderHead: h => `
<div class="company">${esc(COMPANY)}</div>
<div class="rowttl"><span class="title">${esc(h.ctx.titleOverride || 'ใบน้ำหนัก')}</span><span class="rt">${LV('หน้า', PG(h).replace('หน้า ', ''), '16mm')}</span></div>
<div class="hg">
  <div class="wide2">ชื่อลูกค้า : ${esc(h.F('ชื่อลูกค้า'))}</div>${LV('วันที่', h.F('วันที่'), '20mm')}
  <div class="wide2">SHRINK&nbsp; FILM : ${esc(h.F('SHRINK FILM'))}</div>${LV('Po.', h.F('Po.'), '20mm')}
</div>`,
    lotTable: true, signature: true,
  },

  // ── โอสถสภา ────────────────────────────────────────────────────────────────
  osotspa: {
    id: 'osotspa', label: 'โอสถสภา', title: 'ใบน้ำหนักสินค้า', company: true,
    rowsPerBlock: 30, blocksPerPage: 2,
    cols: [C.seq(), C.roll(), C.grossC(), C.coreC(), C.netC()],
    head: [
      { label: 'ลูกค้า', get: g => g.customer, wide: true },
      { label: 'สินค้า', get: g => g.productLine, wide: true },
      { label: 'วันที่', get: () => thaiShort(new Date()) },
    ],
    renderHead: bwpHead,
    lotTable: true, signature: true,
  },

  // ── หาดทิพย์ ───────────────────────────────────────────────────────────────
  haadthip: {
    id: 'haadthip', label: 'หาดทิพย์', title: 'ใบน้ำหนักสินค้า', company: true,
    rowsPerBlock: 30, blocksPerPage: 2,
    cols: [
      C.seq(), C.roll(),
      { label: 'วันที่ผลิต', w: 15, align: 'c', get: r => thaiShort(r.created_at) },
      C.grossC(), C.coreC(), C.netC(),
    ],
    head: [
      { label: 'ลูกค้า', get: g => g.customer, wide: true },
      { label: 'สินค้า', get: g => g.productLine, wide: true },
      { label: 'วันที่', get: () => thaiShort(new Date()) },
    ],
    renderHead: bwpHead,
    lotTable: true, signature: true,
  },

  // ── ฟอร์มกลาง (ม้วนพิมพ์ / ม้วนใส) ────────────────────────────────────────
  generic: {
    id: 'generic', label: 'ฟอร์มกลาง (ม้วนพิมพ์/ม้วนใส)', title: 'ใบน้ำหนักสินค้า', company: true,
    rowsPerBlock: 30, blocksPerPage: 2,
    cols: [C.seq(), C.roll(), C.grossC(), C.coreC(), C.netC(), C.note()],
    head: [
      { label: 'ลูกค้า', get: g => g.customer, wide: true },
      { label: 'สินค้า', get: g => g.productLine, wide: true },
      { label: 'วันที่', get: () => thaiShort(new Date()) },
    ],
    renderHead: bwpHead,
    lotTable: true, lotExp: true, signature: true,
  },

  // ── เซเว่นสตาร์ ────────────────────────────────────────────────────────────
  sevenstar: {
    id: 'sevenstar', label: 'เซเว่นสตาร์', title: 'ใบน้ำหนักสินค้า', company: true,
    rowsPerBlock: 30, blocksPerPage: 2,
    cols: [
      C.seq('ลำดับที่'), C.roll('ม้วนที่'),
      C.grossC('น้ำหนักรวมแกน'), C.coreC('น้ำหนักแกน'), C.netC('น้ำหนักจริง'),
    ],
    head: [
      { label: 'ชื่อลูกค้า', get: g => g.customer, wide: true },
      { label: 'เลขที่ผลิต', get: g => g.wo },
      {
        label: 'ขนาด', get: g => {
          const w = g.sample.width_cm ? `${g.sample.width_cm} ${g.sample.width_unit || 'มม.'}` : ''
          const t = g.sample.thick_mc ? `${g.sample.thick_mc} ไมครอน` : ''
          return [w, t].filter(Boolean).join('  X  ')
        },
      },
      { label: 'ทรีท', get: (_g, c) => c.extra?.treat ?? '' },
      { label: 'รหัสสินค้า', get: g => g.code },
      { label: 'วันที่ส่ง', get: () => thaiShort(new Date()) },
      { label: 'เลขที่ PO', get: () => '' },
      { label: 'น้ำหนัก', get: (_g, c) => (c.extra?.std_weight ? `${c.extra.std_weight} กก.` : '') },
      {
        label: 'ความยาว', get: (g, c) => {
          const L = c.extra?.length_m || g.sample.length
          return L ? `${L} เมตร/ม้วน` : ''
        },
      },
    ],
    // ต้นฉบับไม่มีชื่อบริษัท ไม่มีหัวเรื่อง — ขึ้นต้นด้วย "ชื่อลูกค้า :" เลย
    // ซ้าย ชื่อลูกค้า/เลขที่ผลิต/ขนาด/ทรีท+รหัสสินค้า · ขวา วันที่ส่ง/เลขที่ PO/น้ำหนัก/ความยาว
    renderHead: h => `
<div class="ss">
  <div class="c">${LV('ชื่อลูกค้า :', h.F('ชื่อลูกค้า'))}</div>
  <div class="c">${LV('วันที่ส่ง', h.F('วันที่ส่ง'), '22mm')}</div>
  <div class="pgbox">${PG(h)}</div>
  <div class="c">${LV('เลขที่ผลิต :', h.F('เลขที่ผลิต'))}</div>
  <div class="c">${LV('เลขที่ PO', h.F('เลขที่ PO'), '22mm')}</div><div></div>
  <div class="c">${LV('ขนาด :', h.F('ขนาด'))}</div>
  <div class="c">${LV('น้ำหนัก', h.F('น้ำหนัก'), '22mm')}</div><div></div>
  <div class="c">${LV('ทรีท :', h.F('ทรีท'))}${LV('รหัสสินค้า', h.F('รหัสสินค้า'))}</div>
  <div class="c">${LV('ความยาว', h.F('ความยาว'), '22mm')}</div><div></div>
</div>`,
    lotTable: true, signature: true,
  },

  // ── กระทิงแดง / ที.ซี.ฟาร์มาซูติคอล — ฟอร์มของลูกค้าเอง ───────────────────
  tcp: {
    id: 'tcp', label: 'กระทิงแดง (ที.ซี.ฟาร์มาฯ)', title: '',
    company: false, banner: TCP_BANNER,
    rowsPerBlock: 30, blocksPerPage: 1, landscape: true, frame: true,
    cols: [
      C.seq(),
      { label: 'วันที่ผลิต', sub: 'Batch No.', w: 11, align: 'c', get: r => thaiShort(r.created_at) },
      { label: 'วันที่ หมดอายุ', sub: 'Expiry Date', w: 11, align: 'c', get: (r, _i, c) => expDate(r, c) },
      { label: 'Lot No/Pallet No.', w: 16, align: 'l', get: r => String(r.lot_no ?? '') },
      { label: 'หมายเลขกล่อง/ม้วน/กระสอบ', w: 13, align: 'c', bold: true, get: r => String(r.roll_no ?? '') },
      C.grossC(), C.coreC('นน.กล่อง แกน/กระสอบ'), C.netC('นน. สุทธิ'),
      { label: 'จำนวน(หน่วย)', w: 9, align: 'c', get: () => 'Kg.' },
      C.note(),
    ],
    head: [
      { label: 'ชื่อสินค้า', get: g => g.productLine, wide: true },
      { label: 'Material Code', get: (g, c) => c.extra?.material_code || g.code },
      { label: 'เลขที่บิลส่งสินค้า', get: () => '' },
      { label: 'เลขที่ใบกำกับภาษี', get: () => '' },
      { label: 'ทะเบียนรถ', get: () => '' },
      { label: 'พนักงานส่งสินค้า', get: (_g, c) => c.staff },
      { label: 'วันที่', get: () => thaiShort(new Date()) },
      { label: 'เวลา', get: () => '' },
    ],
    // ต้นฉบับ: หัวเรื่องในกรอบเต็มความกว้าง · หน้า x/y ในกรอบเล็กขวาสุด
    //          แล้วตาราง 3 ช่อง — ซ้าย ชื่อสินค้า/Material Code
    //          กลาง เลขที่บิลส่งสินค้า/เลขที่ใบกำกับภาษี · ขวา วันที่+เวลา/ทะเบียนรถ/พนักงานส่งสินค้า
    renderHead: h => `
<div class="tcpttl">${esc(TCP_BANNER)}</div>
<div class="tcppg"><span class="pgbox">${PG(h)}</span></div>
<div class="tcp">
  <div></div><div></div>
  <div class="c">${LV('วันที่', h.F('วันที่'), '20mm')}${LV('เวลา:', h.F('เวลา'), '16mm')}</div>
  <div class="c">${LV('ชื่อสินค้า', h.F('ชื่อสินค้า'))}</div>
  <div class="c">${LV('เลขที่บิลส่งสินค้า :', h.F('เลขที่บิลส่งสินค้า'))}</div>
  <div class="c">${LV('ทะเบียนรถ :', h.F('ทะเบียนรถ'))}</div>
  <div class="c">${LV('Material Code:', h.F('Material Code'))}</div>
  <div class="c">${LV('เลขที่ใบกำกับภาษี:', h.F('เลขที่ใบกำกับภาษี'))}</div>
  <div class="c">${LV('พนักงานส่งสินค้า:', h.F('พนักงานส่งสินค้า'))}</div>
</div>`,
    lotTable: false, tcFooter: true,
  },
}

export const TEMPLATE_LIST = Object.values(TEMPLATES).map(t => ({ id: t.id, label: t.label }))

// ── จับคู่ ลูกค้า → ฟอร์ม ─────────────────────────────────────────────────────
/** ชื่อลูกค้าจริงในฐานข้อมูลคั่นด้วย non-breaking space ( ) ไม่ใช่เว้นวรรคปกติ
 *  เช่น "บริษัท ไทยน้ำทิพย์ คอร์ปอเรชั่น จำกัด (มหาชน)"
 *  ถ้าไม่ปรับให้เหมือนกันก่อน คนตั้งค่าที่พิมพ์เว้นวรรคปกติจะจับคู่ไม่ติดแบบเงียบ ๆ */
function normName(s: any): string {
  return String(s ?? '').replace(/[\u00A0\u2007\u202F]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
}

export function resolveTemplate(
  rolls: SlipRoll[], rows: SlipTemplateRow[],
): { template: TemplateId; extra: SlipExtra; title?: string | null } {
  const list = (rows ?? []).filter(r => r.active !== false)
    .sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100))
  const codes = new Set(rolls.map(r => normName(r.cust_code)).filter(Boolean))
  const names = rolls.map(r => normName(r.customer)).filter(Boolean)

  for (const t of list) {
    const c = normName(t.cust_code)
    if (c && codes.has(c))
      return { template: t.template, extra: t.extra ?? {}, title: t.slip_title }
  }
  for (const t of list) {
    const m = normName(t.cust_match)
    if (m && names.some(n => n.includes(m)))
      return { template: t.template, extra: t.extra ?? {}, title: t.slip_title }
  }
  return { template: 'generic', extra: {} }
}

// ── จัดกลุ่ม: 1 ใบ = 1 สินค้า (ตามแบบฟอร์มจริง หัวใบระบุสินค้าเดียว) ─────────
export type Group = {
  key: string
  customer: string
  product: string
  code: string          // รหัสสินค้า (item_code / product_code / mat_code)
  productLine: string   // "สินค้า (รหัส)" สำหรับหัวใบ
  wo: string
  sample: SlipRoll
  rolls: SlipRoll[]
}

export function groupByProduct(rolls: SlipRoll[]): Group[] {
  const map = new Map<string, Group>()
  for (const r of rolls) {
    const code = String(r.item_code || r.product_code || r.mat_code || '').trim()
    const product = String(r.product_name ?? '').trim() || '—'
    const customer = String(r.customer ?? '').trim() || '—'
    const key = `${customer}__${product}__${code}`
    if (!map.has(key)) {
      map.set(key, {
        key, customer, product, code,
        productLine: code ? `${product}  (${code})` : product,
        wo: String(r.work_order ?? '').trim(),
        sample: r, rolls: [],
      })
    }
    map.get(key)!.rolls.push(r)
  }
  const out = Array.from(map.values())
  out.forEach(g => g.rolls.sort((a, b) =>
    num(a.roll_no) - num(b.roll_no) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))))
  return out.sort((a, b) => a.customer.localeCompare(b.customer) || a.product.localeCompare(b.product))
}

/** ตารางท้ายใบ: ช่วงเลขม้วน → วันที่ผลิต → Lot (ยุบม้วน Lot+วันเดียวกันเป็นแถวเดียว) */
export type LotLine = { range: string; date: string; lot: string; exp: string; kg: number }
export function lotLines(g: Group, ctx: SlipCtx): LotLine[] {
  const out: LotLine[] = []
  for (const r of g.rolls) {
    const lot = String(r.lot_no ?? '').trim()
    const date = thaiShort(r.created_at)
    const no = num(r.roll_no)
    const last = out[out.length - 1]
    if (last && last.lot === lot && last.date === date) {
      const first = last.range.split('-')[0]
      last.range = num(first) === no ? String(no) : `${first}-${no}`
      last.kg += num(r.weight)
    } else {
      out.push({ range: String(r.roll_no ?? ''), date, lot, exp: expDate(r, ctx), kg: num(r.weight) })
    }
  }
  return out
}

// ── แบ่งหน้า ──────────────────────────────────────────────────────────────────
type Block = { rolls: SlipRoll[]; from: number }
function paginate(g: Group, tpl: Tpl): Block[][] {
  const per = tpl.rowsPerBlock
  const blocks: Block[] = []
  for (let i = 0; i < g.rolls.length; i += per) blocks.push({ rolls: g.rolls.slice(i, i + per), from: i })
  if (!blocks.length) blocks.push({ rolls: [], from: 0 })
  const pages: Block[][] = []
  for (let i = 0; i < blocks.length; i += tpl.blocksPerPage) pages.push(blocks.slice(i, i + tpl.blocksPerPage))
  return pages
}

// ── HTML ──────────────────────────────────────────────────────────────────────
const CSS = (landscape: boolean) => `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Sarabun','TH Sarabun New','Tahoma',sans-serif;font-size:10pt;color:#000;background:#fff}
.page{padding:6mm 7mm;page-break-after:always}
.page:last-child{page-break-after:auto}
.company{text-align:center;font-size:12pt;font-weight:800}
.title{text-align:center;font-size:13pt;font-weight:900}
/* ช่องกรอก — ว่าง = เส้นประให้เขียนมือ */
u{text-decoration:none;border-bottom:1px dotted #777;display:inline-block;min-width:24mm;padding:0 1mm}
/* หัวใบตระกูลเบสท์เวิลด์: ซ้าย ป้าย+ค่า · ขวา หน้า/วันที่ */
.hg{display:grid;grid-template-columns:auto 1fr auto auto;gap:.6mm 3mm;align-items:baseline;
    margin:1.5mm 0 2mm;font-size:9.5pt}
.hg b{white-space:nowrap;font-weight:700}
.hg u{width:100%;min-width:0}
.hg .wide2{grid-column:1 / 3}
/* COK: "ใบน้ำหนัก" กลาง แถวเดียวกับ หน้า x/y ขวาสุด */
.rowttl{display:grid;grid-template-columns:1fr auto 1fr;align-items:baseline}
.rowttl .title{grid-column:2}
.rowttl .rt{grid-column:3;justify-self:end;font-size:9.5pt;white-space:nowrap}
/* เซเว่นสตาร์: ไม่มีหัวบริษัท — ซ้าย/ขวา/กล่องเลขหน้า */
.ss{display:grid;grid-template-columns:1.5fr 1fr auto;gap:.8mm 5mm;align-items:baseline;
    margin-bottom:2mm;font-size:9.5pt}
.ss .c{display:flex;gap:1.5mm;align-items:baseline;min-width:0}
.ss .c b{white-space:nowrap;font-weight:700}
.ss .c u{flex:1;min-width:0}
.pgbox{border:1px solid #000;padding:.4mm 3mm;font-size:9pt;white-space:nowrap;align-self:start}
/* TCP: หัวเรื่องในกรอบ + ตาราง 3 ช่อง */
.tcpttl{text-align:center;font-size:11.5pt;font-weight:800;border:1px solid #000;padding:.8mm}
.tcppg{display:flex;justify-content:flex-end;margin:.8mm 0}
.tcp{display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:.8mm 4mm;align-items:baseline;
     margin-bottom:1.5mm;font-size:9.5pt}
.tcp .c{display:flex;gap:1.5mm;align-items:baseline;min-width:0}
.tcp .c b{white-space:nowrap;font-weight:700}
.tcp .c u{flex:1;min-width:0}
.frame{border:1.5px solid #000;padding:2.5mm}
.blocks{display:flex;gap:4mm;align-items:flex-start}
.blk{flex:1;min-width:0}
table{width:100%;border-collapse:collapse;table-layout:fixed}
th,td{border:1px solid #000;padding:.6mm 1.2mm;font-size:8.5pt;line-height:1.25;height:5mm;overflow:hidden}
th{background:#eee;font-weight:700;text-align:center;font-size:8pt}
th small{display:block;font-weight:400;font-size:7pt}
.l{text-align:left}.c{text-align:center}.r{text-align:right}
.b{font-weight:700}
tr.sum td{font-weight:800;background:#f2f2f2}
.grand{margin-top:2mm;display:flex;justify-content:flex-end;gap:3mm;align-items:baseline;font-size:11.5pt;font-weight:800}
.grand .box{border:1.5px solid #000;padding:1mm 5mm;min-width:38mm;text-align:right}
.lot{margin-top:3mm;width:auto;table-layout:auto}
.lot th,.lot td{font-size:8.5pt;padding:.6mm 2.5mm}
.tcfoot{margin-top:2mm;font-size:9pt}
.tcfoot .ops{border:1px solid #000;padding:1.5mm}
.sign{display:flex;justify-content:space-between;gap:8mm;margin-top:8mm}
.sign div.sbox{flex:1;text-align:center;font-size:9pt}
.sign .line{border-top:1px dotted #000;margin-top:12mm;padding-top:1mm}
tr{page-break-inside:avoid}
@media print{@page{size:A4 ${landscape ? 'landscape' : 'portrait'};margin:6mm}
  body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`

function blockTable(tpl: Tpl, b: Block, ctx: SlipCtx, blkLabel: string): string {
  const cols = tpl.cols
  const rows = b.rolls.map((r, i) => `<tr>${cols.map(c =>
    `<td class="${c.align}${c.bold ? ' b' : ''}">${esc(c.get(r, b.from + i, ctx))}</td>`).join('')}</tr>`).join('')
  // เติมแถวว่างให้เต็มบล็อก — ฟอร์มลูกค้าใช้ตารางเต็มหน้า เขียนมือเพิ่มได้
  const pad = Array.from({ length: Math.max(0, tpl.rowsPerBlock - b.rolls.length) }, (_, k) =>
    `<tr>${cols.map((c, ci) =>
      `<td class="${c.align}">${ci === 0 ? b.from + b.rolls.length + k + 1 : ''}</td>`).join('')}</tr>`).join('')
  const sums = cols.map(c => (c.sum ? b.rolls.reduce((s, r) => s + num(c.get(r, 0, ctx)), 0) : null))
  const sumRow = `<tr class="sum">${cols.map((c, i) => {
    if (sums[i] != null) return `<td class="r">${sums[i]!.toFixed(2)}</td>`
    if (i === 0) return `<td class="c">${esc(blkLabel)}</td>`
    if (i === 1) return `<td class="c">${b.rolls.length} ม้วน</td>`
    return '<td></td>'
  }).join('')}</tr>`
  return `<table>
<colgroup>${cols.map(c => `<col style="width:${c.w}%">`).join('')}</colgroup>
<thead><tr>${cols.map(c => `<th>${esc(c.label)}${c.sub ? `<small>${esc(c.sub)}</small>` : ''}</th>`).join('')}</tr></thead>
<tbody>${rows}${pad}${sumRow}</tbody></table>`
}

function headHtml(tpl: Tpl, g: Group, ctx: SlipCtx, pageNo: number, pageTotal: number): string {
  // F('ป้าย') — ดึงค่าจาก head ตามชื่อป้าย ให้ผังของแต่ละฟอร์มหยิบไปวางตรงตำแหน่งจริงได้
  const F = (label: string) => {
    const f = tpl.head.find(x => x.label === label)
    return f ? f.get(g, ctx) : ''
  }
  return tpl.renderHead({ g, ctx, page: pageNo, pages: pageTotal, F })
}

function lotHtml(tpl: Tpl, g: Group, ctx: SlipCtx): string {
  if (!tpl.lotTable) return ''
  const lines = lotLines(g, ctx)
  if (!lines.length) return ''
  return `<table class="lot"><thead><tr>
    <th style="width:26mm">No.</th><th style="width:24mm">Date</th>
    ${tpl.lotExp ? '<th style="width:24mm">Exp.Date</th>' : ''}
    <th style="width:46mm">Lot. No.</th><th style="width:28mm">WEIGHT (KGS)</th>
  </tr></thead><tbody>
  ${lines.map(l => `<tr>
    <td class="c">${esc(l.range)}</td><td class="c">${esc(l.date)}</td>
    ${tpl.lotExp ? `<td class="c">${esc(l.exp)}</td>` : ''}
    <td class="l">${esc(l.lot)}</td><td class="r">${l.kg.toFixed(2)}</td></tr>`).join('')}
  </tbody></table>`
}

/** สร้าง HTML ใบน้ำหนัก (หลายใบ = หลายสินค้า) */
export function buildSlipHtml(rolls: SlipRoll[], tplId: TemplateId, ctx: SlipCtx): string {
  const tpl = TEMPLATES[tplId] ?? TEMPLATES.generic
  const groups = groupByProduct(rolls)
  const pagesHtml: string[] = []

  for (const g of groups) {
    const pages = paginate(g, tpl)
    const netAll = g.rolls.reduce((s, r) => s + num(r.weight), 0)
    pages.forEach((blocks, pi) => {
      const last = pi === pages.length - 1
      pagesHtml.push(`<div class="page"><div class="${tpl.frame ? 'frame' : ''}">
${headHtml(tpl, g, ctx, pi + 1, pages.length)}
<div class="blocks">${blocks.map((b, bi) =>
        `<div class="blk">${blockTable(tpl, b, ctx, `รวม ${pi * tpl.blocksPerPage + bi + 1}`)}</div>`).join('')}</div>
${last ? `<div class="grand"><span>น้ำหนักรวมสุทธิ</span><span class="box">${netAll.toFixed(2)}</span><span>กก.</span></div>` : ''}
${last ? lotHtml(tpl, g, ctx) : ''}
${last && tpl.tcFooter ? `<div class="tcfoot"><div class="ops"><b>Warehouse Operation (TC) :</b>
  &nbsp;&nbsp;ผ่าน (........................)&nbsp;&nbsp;&nbsp;ไม่ผ่าน (........................)</div>
  <div style="margin-top:1mm">G (Good Condition) = สินค้าสภาพดีครบ , S (Service) = บริการ การขนส่ง)</div></div>` : ''}
${last && tpl.signature ? `<div class="sign">
  <div class="sbox"><div class="line"></div>${esc(ctx.staff || '')}<br>ผู้จัดของ / ผู้ชั่ง</div>
  <div class="sbox"><div class="line"></div>&nbsp;<br>ผู้ตรวจสอบ</div>
  <div class="sbox"><div class="line"></div>&nbsp;<br>ผู้รับสินค้า</div></div>` : ''}
</div></div>`)
    })
  }

  const closeTag = '<' + '/script>'
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${esc(ctx.titleOverride || tpl.title || 'ใบน้ำหนัก')}</title>
<style>${CSS(!!tpl.landscape)}</style></head><body>
${pagesHtml.join('\n')}
<script>window.onload=function(){setTimeout(function(){window.print()},400)}${closeTag}
</body></html>`
}

export function printSlip(rolls: SlipRoll[], tplId: TemplateId, ctx: SlipCtx) {
  if (!rolls.length) return
  const win = window.open('', '_blank', 'width=1000,height=760')
  if (!win) { alert('เบราว์เซอร์บล็อกป็อปอัพ — อนุญาต popup ของเว็บนี้ก่อนแล้วลองใหม่'); return }
  win.document.write(buildSlipHtml(rolls, tplId, ctx))
  win.document.close()
}

// ── Excel ─────────────────────────────────────────────────────────────────────
/** Export ใบน้ำหนัก — 1 ชีตต่อสินค้า คอลัมน์ชุดเดียวกับใบพิมพ์ */
export function exportSlipExcel(rolls: SlipRoll[], tplId: TemplateId, ctx: SlipCtx) {
  if (!rolls.length) return
  const tpl = TEMPLATES[tplId] ?? TEMPLATES.generic
  const groups = groupByProduct(rolls)
  const wb = XLSX.utils.book_new()
  const used = new Set<string>()

  groups.forEach((g, gi) => {
    const aoa: any[][] = []
    if (tpl.banner) aoa.push([tpl.banner])
    if (tpl.company) aoa.push([COMPANY])
    if (ctx.titleOverride || tpl.title) aoa.push([ctx.titleOverride || tpl.title])
    aoa.push([])
    tpl.head.forEach(f => aoa.push([`${f.label} :`, f.get(g, ctx)]))
    aoa.push([])
    aoa.push(tpl.cols.map(c => (c.sub ? `${c.label} ${c.sub}` : c.label)))

    g.rolls.forEach((r, i) => aoa.push(tpl.cols.map(c => {
      const v = c.get(r, i, ctx)
      return c.sum ? (v === '' ? '' : Number(v)) : v
    })))

    aoa.push(tpl.cols.map((c, i) => {
      if (c.sum) return Number(g.rolls.reduce((s, r) => s + num(c.get(r, 0, ctx)), 0).toFixed(2))
      if (i === 0) return 'รวม'
      if (i === 1) return `${g.rolls.length} ม้วน`
      return ''
    }))
    aoa.push([])
    aoa.push(['น้ำหนักรวมสุทธิ', Number(g.rolls.reduce((s, r) => s + num(r.weight), 0).toFixed(2)), 'กก.'])

    if (tpl.lotTable) {
      const lines = lotLines(g, ctx)
      if (lines.length) {
        aoa.push([])
        aoa.push(['No.', 'Date', ...(tpl.lotExp ? ['Exp.Date'] : []), 'Lot. No.', 'WEIGHT (KGS)'])
        lines.forEach(l => aoa.push([l.range, l.date, ...(tpl.lotExp ? [l.exp] : []), l.lot, Number(l.kg.toFixed(2))]))
      }
    }
    if (tpl.tcFooter) {
      aoa.push([])
      aoa.push(['Warehouse Operation (TC) :', 'ผ่าน (..............)', 'ไม่ผ่าน (..............)'])
      aoa.push(['G (Good Condition) = สินค้าสภาพดีครบ , S (Service) = บริการ การขนส่ง)'])
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = tpl.cols.map(c => ({ wch: Math.max(9, Math.round(c.w * 1.4)) }))
    // ชื่อชีตห้ามซ้ำ / ห้ามยาวเกิน 31 ตัว / ห้ามมีอักขระต้องห้ามของ Excel
    let name = (g.product || `ใบที่ ${gi + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 28).trim() || `ใบที่ ${gi + 1}`
    let k = 2
    while (used.has(name)) name = `${name.slice(0, 26)} ${k++}`
    used.add(name)
    XLSX.utils.book_append_sheet(wb, ws, name)
  })

  const cust = (groups[0]?.customer || 'ใบน้ำหนัก').replace(/[\\/?*[\]:]/g, ' ').slice(0, 20)
  XLSX.writeFile(wb, `ใบน้ำหนัก_${cust}_${new Date().toISOString().slice(0, 10)}.xlsx`)
}

// ── โหลด config จาก DB ────────────────────────────────────────────────────────
export const SLIP_TPL_COLS = 'id,cust_code,cust_match,template,slip_title,extra,sort_order,active'
