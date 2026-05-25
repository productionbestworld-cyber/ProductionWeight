-- ─── แยกข้อมูลลูกค้าออกจาก products ──────────────────────────────
-- รันใน Supabase SQL Editor ครั้งเดียว (หลังจากรัน products.sql แล้ว)

-- 1) สร้างตารางลูกค้า
CREATE TABLE IF NOT EXISTS customers (
  id            BIGSERIAL PRIMARY KEY,
  cust_code     TEXT NOT NULL UNIQUE,
  cust_name     TEXT NOT NULL,
  cust_address  TEXT,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_code ON customers(cust_code);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(cust_name);

DROP TRIGGER IF EXISTS customers_set_updated_at ON customers;
CREATE TRIGGER customers_set_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customers_all" ON customers;
CREATE POLICY "customers_all" ON customers FOR ALL USING (true) WITH CHECK (true);

-- 2) ย้ายลูกค้าจาก products → customers (ไม่ซ้ำ)
INSERT INTO customers (cust_code, cust_name, cust_address)
SELECT DISTINCT ON (cust_code)
  cust_code,
  COALESCE(NULLIF(cust_name,''), '(ไม่ระบุ)'),
  cust_address
FROM products
WHERE cust_code IS NOT NULL AND cust_code <> ''
ON CONFLICT (cust_code) DO NOTHING;

-- 3) ลบ cust_name/cust_address ออกจาก products (ใช้ join เอา)
--    เก็บไว้แค่ cust_code เป็น FK
ALTER TABLE products DROP COLUMN IF EXISTS cust_name;
ALTER TABLE products DROP COLUMN IF EXISTS cust_address;

-- 4) เพิ่ม FK constraint (ไม่บังคับ — products ที่ไม่มีลูกค้าก็ยังบันทึกได้)
--    ใช้ ON UPDATE CASCADE เผื่อแก้ cust_code แล้วลามไป products ด้วย
ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_cust_code_fkey;
ALTER TABLE products
  ADD CONSTRAINT products_cust_code_fkey
  FOREIGN KEY (cust_code) REFERENCES customers(cust_code)
  ON UPDATE CASCADE ON DELETE SET NULL;

-- 5) View สำหรับ join (อ่านง่าย)
CREATE OR REPLACE VIEW products_with_customer AS
SELECT
  p.*,
  c.cust_name,
  c.cust_address
FROM products p
LEFT JOIN customers c ON c.cust_code = p.cust_code;
