-- เพิ่ม column cust_branch (สาขาลูกค้า — กรอกเอง)
ALTER TABLE machine_profiles ADD COLUMN IF NOT EXISTS cust_branch TEXT;
ALTER TABLE production_rolls ADD COLUMN IF NOT EXISTS cust_branch TEXT;
ALTER TABLE weigh_logs       ADD COLUMN IF NOT EXISTS cust_branch TEXT;
ALTER TABLE roll_deletion_logs ADD COLUMN IF NOT EXISTS cust_branch TEXT;
