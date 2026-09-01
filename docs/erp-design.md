# BWP mini-ERP — Design v0.1 (ข้อเสนอ ยังไม่ได้รัน)

ฐานที่มีอยู่จริงวันนี้: `production_rolls`, `weigh_logs`, `machine_profiles`,
`parked_jobs`, `rework_jobs`, `products`, `customers`, `roll_deletion_logs`

ปัญหาเชิงโครงสร้างที่ต้องแก้ก่อนขยาย

1. `work_order` / `sale_order` เป็น **TEXT อิสระ** บน rolls — ไม่มีตารางแม่ ไม่มีใครรู้ว่า WO นี้สั่งกี่กิโล เหลือกี่กิโล
2. **ไม่มี ledger ของสต๊อก** — สถานะของกลายเป็น flag บนแถวม้วน (`transferred`, `rework_status`, `is_rewound`) พอเพิ่มพิมพ์/คลัง/ขาย flag จะระเบิด
3. **ไม่มี user จริง** — RLS เปิด `USING(true)` ทั้งหมด พอมีราคาขาย/ราคาซื้อ อันนี้รับไม่ได้

Design นี้แก้ 3 ข้อนี้ โดย **ไม่แตะจอเป่า/กรอที่ใช้งานอยู่**

---

## A. แกนกลาง — เอกสาร (documents)

ทุกเอกสารในระบบใช้กติกาเดียวกัน:

| field | กติกา |
|---|---|
| `doc_no` | gen ที่ DB จาก sequence ต่อประเภทต่อปี เช่น `SO-2569-00042` |
| `status` | `draft` → `confirmed` → `done` / `cancelled` เท่านั้น |
| `created_by` / `confirmed_by` | auth.uid() |
| ลบ | **ห้าม** — มีแต่ `cancelled` (revoke DELETE จาก anon เหมือนที่ทำใน hardening.sql แล้ว) |

```sql
CREATE TABLE doc_sequences (
  doc_type TEXT NOT NULL,          -- 'SO','PO','PR','WO','GRN','ISS','DO','ADJ'
  year     INT  NOT NULL,
  last_no  INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_type, year)
);

-- gen เลขที่ atomic (กันชนตอน offline sync — ปัญหาเดียวกับ next_roll_no)
CREATE FUNCTION next_doc_no(p_type TEXT) RETURNS TEXT AS $$
DECLARE y INT := EXTRACT(YEAR FROM NOW())::INT + 543; n INT;
BEGIN
  INSERT INTO doc_sequences(doc_type, year, last_no) VALUES (p_type, y, 1)
  ON CONFLICT (doc_type, year) DO UPDATE SET last_no = doc_sequences.last_no + 1
  RETURNING last_no INTO n;
  RETURN p_type || '-' || y || '-' || LPAD(n::TEXT, 5, '0');
END $$ LANGUAGE plpgsql;
```

---

## B. สต๊อก — ledger เดียวจบ (หัวใจของทั้งระบบ)

**ยอดคงเหลือ = SUM ของ moves เท่านั้น ห้ามมีคอลัมน์ `qty_onhand` ที่ update ทับกัน**

```sql
CREATE TABLE locations (
  code   TEXT PRIMARY KEY,   -- 'RM-01','WIP-BLOW','WIP-REWIND','WIP-PRINT','FG-01','QC-HOLD','SCRAP','CUSTOMER','SUPPLIER'
  name   TEXT NOT NULL,
  kind   TEXT NOT NULL,      -- 'internal' | 'external' (external = นอกโรงงาน ใช้เป็นต้นทาง/ปลายทาง)
  active BOOLEAN DEFAULT true
);

CREATE TABLE stock_moves (
  id          BIGSERIAL PRIMARY KEY,
  moved_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  item_code   TEXT NOT NULL REFERENCES products(item_code),
  roll_id     UUID REFERENCES production_rolls(id),   -- NULL = ของ bulk เช่นเม็ดพลาสติก
  lot_no      TEXT,
  qty         NUMERIC NOT NULL,        -- กิโลเสมอ
  uom         TEXT NOT NULL DEFAULT 'KG',
  from_loc    TEXT REFERENCES locations(code),
  to_loc      TEXT REFERENCES locations(code),
  ref_type    TEXT NOT NULL,           -- 'WO','GRN','ISS','DO','QC','ADJ','REWIND','PRINT'
  ref_id      UUID,
  ref_doc_no  TEXT,
  note        TEXT,
  created_by  UUID
);
CREATE INDEX ON stock_moves (item_code, moved_at);
CREATE INDEX ON stock_moves (roll_id);
CREATE INDEX ON stock_moves (ref_type, ref_id);

-- ยอดคงเหลือ
CREATE VIEW stock_onhand AS
SELECT item_code, loc, SUM(q) AS qty FROM (
  SELECT item_code, to_loc   AS loc,  qty AS q FROM stock_moves WHERE to_loc   IS NOT NULL
  UNION ALL
  SELECT item_code, from_loc AS loc, -qty AS q FROM stock_moves WHERE from_loc IS NOT NULL
) t GROUP BY 1,2;
-- ใช้จริงเมื่อข้อมูลโต: ห่อเป็น MATERIALIZED VIEW + refresh หรือ rollup รายวัน

-- ม้วนแต่ละม้วนอยู่ไหนตอนนี้
CREATE VIEW roll_location AS
SELECT DISTINCT ON (roll_id) roll_id, to_loc AS loc, moved_at
FROM stock_moves WHERE roll_id IS NOT NULL
ORDER BY roll_id, moved_at DESC, id DESC;
```

**ผลพลอยได้:** `transferred`, `is_rewound`, `rework_status` เลิกเป็นแหล่งความจริง กลายเป็น cache ของ `roll_location`
(คงคอลัมน์ไว้ได้เพื่อไม่พังจอเดิม แต่ให้ trigger เขียนให้ ไม่ให้ UI เขียนเอง)

---

## C. ม้วน = serial + สายพันธุ์ (genealogy)

เป่า 1 ม้วน → กรอเป็น 3 ม้วน → พิมพ์ 3 ม้วน คือ **ม้วนคนละใบ** ต้องตามย้อนได้ว่ามาจากแม่ไหน

```sql
ALTER TABLE production_rolls ADD COLUMN wo_id     UUID REFERENCES work_orders(id);
ALTER TABLE production_rolls ADD COLUMN stage     TEXT DEFAULT 'blow';  -- blow|rewind|print|fg
ALTER TABLE production_rolls ADD COLUMN qc_status TEXT;                 -- NULL|pass|hold|reject
ALTER TABLE production_rolls ADD COLUMN roll_uid  TEXT UNIQUE;          -- เลขบน QR ที่ยิงได้ทั้งโรงงาน

CREATE TABLE roll_links (          -- แม่→ลูก (many-to-many: กรอรวมม้วนได้ด้วย)
  parent_roll_id UUID NOT NULL REFERENCES production_rolls(id),
  child_roll_id  UUID NOT NULL REFERENCES production_rolls(id),
  op             TEXT NOT NULL,    -- 'rewind' | 'print' | 'rework'
  qty_consumed   NUMERIC,
  PRIMARY KEY (parent_roll_id, child_roll_id)
);
```

`roll_uid` คือสิ่งที่ยิงได้ทุกจอทุกแผนก — ตอนนี้ QR ผูก `id` (UUID) ซึ่งยิงได้แต่ในบริบทเดิม
แนะนำรูปแบบที่อ่านออกด้วยตาด้วย เช่น `69BL06003408-007`

---

## D. เอกสารรายโมดูล

### ขาย
```sql
sales_orders(id, doc_no, cust_code→customers, cust_branch, order_date,
             due_date, status, remark, created_by)
so_lines(id, so_id, line_no, item_code→products, qty_kg, price_per_kg, due_date)
```
> `qty_delivered` **ห้ามเก็บเป็นคอลัมน์** — คำนวณจาก `stock_moves WHERE ref_type='DO'`

### จัดซื้อ
```sql
suppliers(id, sup_code UNIQUE, sup_name, contact, terms)
purchase_requests(id, doc_no, requested_by, need_date, status, source_wo_id)
pr_lines(id, pr_id, item_code, qty, note)
purchase_orders(id, doc_no, sup_code, order_date, status, pr_id)
po_lines(id, po_id, item_code, qty, price)
goods_receipts(id, doc_no, po_id, received_at, received_by)  -- ยิงรับ → stock_moves เข้า RM-01
```

### BOM (ง่ายที่สุดที่ใช้ได้จริง)
```sql
bom_lines(item_code→products, component_item_code, qty_per_kg, scrap_pct)
```
ใช้แค่ 2 อย่าง: คำนวณ PR ตอนเปิด WO และเทียบ yield จริงกับมาตรฐาน

### ผลิต — ยกระดับ work_order จาก TEXT เป็นตารางจริง
```sql
work_orders(id, doc_no, wo_type, so_id, item_code, planned_qty_kg,
            due_date, priority INT, status, insert_reason, created_by)
-- wo_type: 'normal' | 'RD' | 'rework' | 'stock'
--   RD/ตัวอย่าง = WO ที่ so_id IS NULL และไม่ตัดสต๊อกขาย → ไม่ต้องมีจอใหม่
--   แทรกงาน    = priority น้อย = มาก่อน + บังคับกรอก insert_reason

wo_ops(id, wo_id, seq, dept, machine_no, status, started_at, finished_at)
-- dept: 'blow'|'rewind'|'print'|'qc'|'pack' — สร้างจาก routing ของ item
```
`production_rolls.work_order` (TEXT) คงไว้ แล้ว backfill `wo_id` จากมันทีหลัง — ไม่ต้อง big-bang

### QC
```sql
qc_checks(id, roll_id→production_rolls, wo_id, checked_at, checked_by,
          result TEXT,            -- pass|hold|reject
          defect_code TEXT→qc_defects, qty_reject_kg NUMERIC, photo_url TEXT, note TEXT)
qc_defects(code PRIMARY KEY, name, dept)    -- dropdown หน้างาน ห้ามพิมพ์เอง
```
`result` → เขียน stock_moves ให้อัตโนมัติ: pass → `FG-01`, hold → `QC-HOLD`, reject → `SCRAP`
(ต่อกับ `review_queue` / `rework_jobs` ที่มีอยู่แล้วได้เลย)

### คลัง / ส่งของ
```sql
delivery_orders(id, doc_no, so_id, cust_code, ship_date, status, plate_no, driver)
do_lines(id, do_id, roll_id, item_code, qty_kg)     -- ยิง QR ทีละม้วนตอนขึ้นรถ
stock_adjustments(id, doc_no, reason, approved_by)  -- ปรับยอด ต้องมีคนอนุมัติเสมอ
```

---

## E. สิทธิ์ผู้ใช้ (ต้องมาก่อนโมดูลที่มีราคา)

```sql
app_users(id UUID PK = auth.uid(), emp_code, full_name, dept, active)
user_roles(user_id, role)  -- 'operator','leader','planner','sales','purchase','qc','store','admin','owner'
```

- `operator` — INSERT ม้วน/ชั่งของแผนกตัวเอง แก้ของตัวเองได้ภายใน 5 นาที
- `leader` — approve review_queue, ยกเลิกเอกสารในแผนก
- `sales` / `purchase` — เห็นราคาของฝั่งตัวเอง **เท่านั้น**
- `owner` / `admin` — เห็นหมด
- ราคา (`so_lines.price_per_kg`, `po_lines.price`) แยกเป็น view ที่ mask ให้ role ที่ไม่มีสิทธิ์

---

## F. ลำดับ migration ที่ปลอดภัย (ไม่ล้มของที่วิ่งอยู่)

| เฟส | ทำอะไร | เสี่ยง |
|---|---|---|
| 1 | สร้าง `locations`, `stock_moves`, `doc_sequences` + backfill moves ย้อนหลังจาก `production_rolls`/`weigh_logs` | ต่ำ — เพิ่มอย่างเดียว |
| 2 | สร้าง `work_orders` + backfill จาก DISTINCT `work_order` เดิม + เติม `wo_id` | ต่ำ |
| 3 | auth จริง + `app_users`/`user_roles` แล้วค่อย ๆ ปิด `USING(true)` ทีละตาราง | **กลาง** — ทำนอกเวลาผลิต |
| 4 | QC + พิมพ์ (ตารางใหม่ + จอใหม่ที่ลอกจอกรอ) | ต่ำ |
| 5 | คลังเต็มรูป (GRN/ISS/DO) — ledger พร้อมแล้ว จอเป็นแค่ UI | ต่ำ |
| 6 | ขาย + จัดซื้อ + BOM | ต่ำ |
| 7 | วางแผนตัวเต็ม (ตารางเครื่อง/กะ) ใช้ข้อมูลจริงจากเฟส 1–6 | ต่ำ |

**ตัวชี้ว่าเฟส 1 สำเร็จ:** `stock_onhand` ของ FG ตรงกับที่นับจริงในคลัง โดยไม่ต้องแก้มือ
ถ้ายังไม่ตรง อย่าไปเฟส 2

---

## G. โครงโค้ดฝั่ง app

ตอนนี้ `src/pages/` แบน 20 ไฟล์ ถ้าเพิ่ม 5 แผนกจะ 60+ ควรย้ายเป็น:

```
src/modules/{sales,purchase,planning,production,qc,warehouse}/{pages,components,api}
src/shared/{doc,stock,scan}      ← useScanRoll(), postStockMove(), useDocNo()
```

`postStockMove()` ต้องเป็น **ทางเดียว** ที่ทั้งแอปเขียน stock_moves
ถ้ามีที่เขียนตรง 5 ที่ สต๊อกจะเพี้ยนแน่นอน
