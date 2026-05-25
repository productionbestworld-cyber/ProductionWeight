-- ─── คลัง Item Code (สินค้า) ───────────────────────────────────────
-- เก็บข้อมูล Item Code + รายละเอียดสินค้า + ลูกค้า สำหรับ auto-fill
-- รันใน Supabase SQL Editor ครั้งเดียว

CREATE TABLE IF NOT EXISTS products (
  id            BIGSERIAL PRIMARY KEY,
  mat_code      TEXT NOT NULL UNIQUE,
  product_code  TEXT,
  product_name  TEXT,
  width_cm      TEXT,
  thick_mc      TEXT,
  cust_code     TEXT,
  cust_name     TEXT,
  cust_address  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_mat_code  ON products(mat_code);
CREATE INDEX IF NOT EXISTS idx_products_cust_code ON products(cust_code);
CREATE INDEX IF NOT EXISTS idx_products_name      ON products USING gin (to_tsvector('simple', coalesce(product_name,'')));

-- auto update updated_at
CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_set_updated_at ON products;
CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- เปิด RLS + อนุญาตทุก operation (ปรับ policy ตามต้องการภายหลัง)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "products_all" ON products;
CREATE POLICY "products_all" ON products FOR ALL USING (true) WITH CHECK (true);
