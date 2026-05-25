-- ════════════════════════════════════════════════════════════════════
--  BWP — Item Code (master) + Mat Code (per-job) + Customers
--  รันใน Supabase SQL Editor / psql / pgAdmin ครั้งเดียวจบ
-- ════════════════════════════════════════════════════════════════════

-- ─── 0) trigger helper ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$ LANGUAGE plpgsql;

-- ════════════════════════════════════════════════════════════════════
-- 1) ตาราง customers
-- ════════════════════════════════════════════════════════════════════
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
  BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customers_all" ON customers;
CREATE POLICY "customers_all" ON customers FOR ALL USING (true) WITH CHECK (true);

-- ════════════════════════════════════════════════════════════════════
-- 2) ตาราง products (master Item Code — ใช้เป็น lookup)
--    ไม่มี mat_code (mat_code ไปอยู่ที่ machine_profiles)
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS products (
  id            BIGSERIAL PRIMARY KEY,
  item_code     TEXT NOT NULL UNIQUE,
  product_code  TEXT,
  product_name  TEXT,
  width_cm      TEXT,
  thick_mc      TEXT,
  cust_code     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ถ้าตาราง products เคยมี mat_code อยู่ → rename เป็น item_code
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='products' AND column_name='mat_code'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='products' AND column_name='item_code'
  ) THEN
    ALTER TABLE products RENAME COLUMN mat_code TO item_code;
  END IF;
END $$;

-- ลบ cust_name/cust_address ออกถ้ายังมี (ใช้ join จาก customers แทน)
ALTER TABLE products DROP COLUMN IF EXISTS cust_name;
ALTER TABLE products DROP COLUMN IF EXISTS cust_address;

CREATE INDEX IF NOT EXISTS idx_products_item_code ON products(item_code);
CREATE INDEX IF NOT EXISTS idx_products_cust_code ON products(cust_code);

DROP TRIGGER IF EXISTS products_set_updated_at ON products;
CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "products_all" ON products;
CREATE POLICY "products_all" ON products FOR ALL USING (true) WITH CHECK (true);

-- FK: products.cust_code → customers.cust_code
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_cust_code_fkey;
ALTER TABLE products
  ADD CONSTRAINT products_cust_code_fkey
  FOREIGN KEY (cust_code) REFERENCES customers(cust_code)
  ON UPDATE CASCADE ON DELETE SET NULL;

-- ════════════════════════════════════════════════════════════════════
-- 3) เพิ่ม item_code ใน machine_profiles (mat_code เดิมยังคงอยู่)
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE machine_profiles ADD COLUMN IF NOT EXISTS item_code TEXT;
CREATE INDEX IF NOT EXISTS idx_machine_profiles_item_code ON machine_profiles(item_code);

-- ════════════════════════════════════════════════════════════════════
-- 4) VIEW products_with_customer
-- ════════════════════════════════════════════════════════════════════
DROP VIEW IF EXISTS products_with_customer;
CREATE VIEW products_with_customer AS
SELECT p.*, c.cust_name, c.cust_address
FROM products p
LEFT JOIN customers c ON c.cust_code = p.cust_code;

-- ════════════════════════════════════════════════════════════════════
-- ตรวจสอบ
-- ════════════════════════════════════════════════════════════════════
SELECT 'customers' AS tbl, COUNT(*) AS rows FROM customers
UNION ALL SELECT 'products', COUNT(*) FROM products
UNION ALL SELECT 'machine_profiles', COUNT(*) FROM machine_profiles;
