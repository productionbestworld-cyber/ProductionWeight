-- v2.18.2 — เพิ่มคอลัมน์ให้ "ดึงงานเก่ามาชั่งต่อ" กู้รายละเอียดกลับได้ครบ
-- รันใน Supabase → SQL Editor (ครั้งเดียว)
alter table production_rolls add column if not exists label_size   text;
alter table production_rolls add column if not exists cust_address text;
