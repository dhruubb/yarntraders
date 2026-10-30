-- Posted financial records can never be silently edited or deleted.
-- Corrections happen by cancelling (status change, recorded in the audit log) and re-entering.

CREATE OR REPLACE FUNCTION ycrm_block_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Deleting rows from % is not allowed; cancel the record instead', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Allow UPDATE only of the columns listed in TG_ARGV (e.g. status, cancel fields).
CREATE OR REPLACE FUNCTION ycrm_guard_update() RETURNS trigger AS $$
DECLARE
  allowed text[] := TG_ARGV;
BEGIN
  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION 'Posted % records cannot be edited; cancel and re-enter instead', TG_TABLE_NAME
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'A cancelled % record cannot be reinstated', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION ycrm_block_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Rows in % are append-only', TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER invoices_no_delete BEFORE DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION ycrm_block_delete();
--> statement-breakpoint
CREATE TRIGGER invoices_guard_update BEFORE UPDATE ON invoices FOR EACH ROW
  EXECUTE FUNCTION ycrm_guard_update('status', 'cancelled_by', 'cancelled_at', 'cancel_reason');
--> statement-breakpoint
CREATE TRIGGER invoice_lines_no_delete BEFORE DELETE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION ycrm_block_delete();
--> statement-breakpoint
CREATE TRIGGER invoice_lines_no_update BEFORE UPDATE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION ycrm_block_update();
--> statement-breakpoint
CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments FOR EACH ROW EXECUTE FUNCTION ycrm_block_delete();
--> statement-breakpoint
CREATE TRIGGER payments_guard_update BEFORE UPDATE ON payments FOR EACH ROW
  EXECUTE FUNCTION ycrm_guard_update('status', 'cancelled_by', 'cancelled_at', 'cancel_reason', 'cheque_status');
--> statement-breakpoint
CREATE TRIGGER expenses_no_delete BEFORE DELETE ON expenses FOR EACH ROW EXECUTE FUNCTION ycrm_block_delete();
--> statement-breakpoint
CREATE TRIGGER expenses_guard_update BEFORE UPDATE ON expenses FOR EACH ROW
  EXECUTE FUNCTION ycrm_guard_update('status', 'cancelled_by', 'cancelled_at', 'cancel_reason');
--> statement-breakpoint
CREATE TRIGGER stock_movements_no_delete BEFORE DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION ycrm_block_delete();
--> statement-breakpoint
CREATE TRIGGER stock_movements_no_update BEFORE UPDATE ON stock_movements FOR EACH ROW EXECUTE FUNCTION ycrm_block_update();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION ycrm_block_delete();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION ycrm_block_update();
--> statement-breakpoint

-- Sanity constraints
ALTER TABLE invoices ADD CONSTRAINT invoices_total_nonneg CHECK (total >= 0);
--> statement-breakpoint
ALTER TABLE invoice_lines ADD CONSTRAINT lines_qty_pos CHECK (bags > 0 AND kg > 0 AND rate >= 0);
--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT payments_amount_pos CHECK (amount > 0);
--> statement-breakpoint
ALTER TABLE expenses ADD CONSTRAINT expenses_amount_pos CHECK (amount > 0);
--> statement-breakpoint
ALTER TABLE product_stock ADD CONSTRAINT stock_nonneg CHECK (bags >= 0 AND kg >= 0);
--> statement-breakpoint
ALTER TABLE products ADD CONSTRAINT products_bag_weight_pos CHECK (bag_weight_kg > 0);

--> statement-breakpoint
-- Party balance: positive = party owes us (receivable), negative = we owe the party (payable).
CREATE VIEW party_balances AS
SELECT p.id AS party_id, p.business_id,
  p.opening_balance
  + COALESCE((SELECT SUM(CASE i.kind WHEN 'sale' THEN i.total WHEN 'purchase_return' THEN i.total ELSE -i.total END)
              FROM invoices i WHERE i.party_id = p.id AND i.status = 'posted'), 0)
  + COALESCE((SELECT SUM(CASE y.direction WHEN 'out' THEN y.amount ELSE -y.amount END)
              FROM payments y WHERE y.party_id = p.id AND y.status = 'posted' AND y.cheque_status <> 'bounced'), 0)
  AS balance
FROM parties p;
--> statement-breakpoint
-- Cash/bank balance: pending or bounced cheques are not counted until cleared.
CREATE VIEW account_balances AS
SELECT a.id AS account_id, a.business_id,
  a.opening_balance
  + COALESCE((SELECT SUM(CASE y.direction WHEN 'in' THEN y.amount ELSE -y.amount END)
              FROM payments y WHERE y.account_id = a.id AND y.status = 'posted' AND y.cheque_status IN ('na', 'cleared')), 0)
  - COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.account_id = a.id AND e.status = 'posted'), 0)
  AS balance
FROM accounts a;
