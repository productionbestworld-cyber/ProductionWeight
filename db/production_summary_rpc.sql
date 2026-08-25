-- ════════════════════════════════════════════════════════════════
--  สรุปยอดผลิต(เป่า) ฝั่งเซิร์ฟเวอร์ — ใช้กับหน้า "แดชบอร์ดผลิต"
--  เหตุผล: ถ้าเลือกช่วงยาว (เช่นทั้งปี) การดึงม้วนทุกใบมาคำนวณในเบราว์เซอร์
--          จะช้าและกิน egress มาก · ฟังก์ชันนี้ให้ Postgres รวมยอดมาให้เลย
--  รันใน Supabase SQL Editor ครั้งเดียว (ปลอดภัย: อ่านอย่างเดียว ไม่แก้ข้อมูล)
--  หน้าเว็บใช้ได้ทันทีเมื่อรันแล้ว · ถ้ายังไม่รัน หน้าเว็บจะ fallback
--  ไปคำนวณฝั่งเบราว์เซอร์เหมือนเดิมโดยอัตโนมัติ (ไม่พัง)
-- ════════════════════════════════════════════════════════════════

-- นับเฉพาะงานผลิต(เป่า): section = 'blow' หรือ NULL (ข้อมูลเก่าก่อนมีคอลัมน์ section)
-- p_group: 'day' | 'machine' | 'wo' | 'reason' | 'customer'
--   day     = วันที่ผลิตตามเวลาไทย (Asia/Bangkok)
--   reason  = หมายเหตุของม้วนเสีย/เศษ (นับเฉพาะม้วนที่ไม่ใช่ FG)
-- p_machine / p_wo / p_customer: ใส่ NULL = ไม่กรอง

CREATE OR REPLACE FUNCTION production_summary(
  p_from     TIMESTAMPTZ,
  p_to       TIMESTAMPTZ,
  p_group    TEXT,
  p_machine  TEXT DEFAULT NULL,
  p_wo       TEXT DEFAULT NULL,
  p_customer TEXT DEFAULT NULL
)
RETURNS TABLE (
  key        TEXT,
  good_kg    NUMERIC,
  good_rolls BIGINT,
  bad_kg     NUMERIC,
  bad_rolls  BIGINT,
  scrap_kg   NUMERIC,
  scrap_rolls BIGINT,
  clear_kg   NUMERIC,
  color_kg   NUMERIC,
  lump_kg    NUMERIC,
  total_kg   NUMERIC,
  rolls      BIGINT,
  machines   TEXT,
  customers  TEXT
)
LANGUAGE sql
STABLE
AS $$
  WITH src AS (
    SELECT
      r.roll_type,
      COALESCE(r.weight, 0)                                        AS w,
      COALESCE(NULLIF(TRIM(r.machine_no), ''), '(ไม่ระบุเครื่อง)')   AS machine,
      COALESCE(NULLIF(TRIM(r.work_order), ''), '(ไม่ระบุ WO)')      AS wo,
      COALESCE(NULLIF(TRIM(r.customer), ''), '(ไม่ระบุลูกค้า)')      AS cust,
      COALESCE(NULLIF(TRIM(r.remark), ''), '(ไม่ระบุ)')             AS reason,
      TO_CHAR(r.created_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS day
    FROM production_rolls r
    WHERE COALESCE(r.section, 'blow') = 'blow'
      AND r.created_at >= p_from
      AND r.created_at <= p_to
      AND (p_machine  IS NULL OR r.machine_no = p_machine)
      AND (p_wo       IS NULL OR TRIM(r.work_order) = p_wo)
      AND (p_customer IS NULL OR TRIM(r.customer)  = p_customer)
      -- แท็บ "สาเหตุ" สนใจเฉพาะม้วนที่มีปัญหา (เสีย/เศษ) เท่านั้น
      AND (p_group <> 'reason' OR r.roll_type <> 'good')
  )
  SELECT
    CASE p_group
      WHEN 'day'      THEN day
      WHEN 'machine'  THEN machine
      WHEN 'wo'       THEN wo
      WHEN 'customer' THEN cust
      WHEN 'reason'   THEN reason
    END                                                                       AS key,
    SUM(w) FILTER (WHERE roll_type = 'good')::NUMERIC                          AS good_kg,
    COUNT(*) FILTER (WHERE roll_type = 'good')                                 AS good_rolls,
    SUM(w) FILTER (WHERE roll_type = 'bad')::NUMERIC                           AS bad_kg,
    COUNT(*) FILTER (WHERE roll_type = 'bad')                                  AS bad_rolls,
    SUM(w) FILTER (WHERE roll_type LIKE 'scrap%')::NUMERIC                     AS scrap_kg,
    COUNT(*) FILTER (WHERE roll_type LIKE 'scrap%')                            AS scrap_rolls,
    SUM(w) FILTER (WHERE roll_type = 'scrap_clear')::NUMERIC                   AS clear_kg,
    SUM(w) FILTER (WHERE roll_type = 'scrap_color')::NUMERIC                   AS color_kg,
    SUM(w) FILTER (WHERE roll_type = 'scrap_lump')::NUMERIC                    AS lump_kg,
    SUM(w)::NUMERIC                                                            AS total_kg,
    COUNT(*)                                                                   AS rolls,
    STRING_AGG(DISTINCT machine, ', ' ORDER BY machine)                        AS machines,
    STRING_AGG(DISTINCT cust,    ', ' ORDER BY cust)                           AS customers
  FROM src
  GROUP BY 1
  ORDER BY 1;
$$;

-- ให้หน้าเว็บ (anon key) เรียกได้
GRANT EXECUTE ON FUNCTION production_summary(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ── ดัชนีช่วยให้ช่วงวันที่ยาว ๆ เร็วขึ้น (ไม่บังคับ แต่แนะนำ) ──
CREATE INDEX IF NOT EXISTS idx_rolls_created_section
  ON production_rolls (created_at, section);

-- ── ตัวอย่างเรียกใช้ ──
-- SELECT * FROM production_summary('2026-01-01', '2026-12-31', 'day');
-- SELECT * FROM production_summary('2026-08-01', '2026-08-31', 'reason');
