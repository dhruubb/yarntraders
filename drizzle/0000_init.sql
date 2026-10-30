CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"opening_balance" numeric(16, 2) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text DEFAULT '' NOT NULL,
	"summary" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"gstin" text DEFAULT '' NOT NULL,
	"state_code" text DEFAULT '27' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"date" date NOT NULL,
	"category" text NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"account_id" integer NOT NULL,
	"paid_to" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_by" integer,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"file_name" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'review' NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"row_no" integer NOT NULL,
	"data" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"result_id" integer
);
--> statement-breakpoint
CREATE TABLE "invoice_counters" (
	"business_id" integer NOT NULL,
	"series" text NOT NULL,
	"next" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "invoice_counters_business_id_series_pk" PRIMARY KEY("business_id","series")
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" integer NOT NULL,
	"lot_no" text DEFAULT '' NOT NULL,
	"bags" numeric(16, 3) NOT NULL,
	"kg" numeric(16, 3) NOT NULL,
	"rate" numeric(14, 2) NOT NULL,
	"rate_basis" text NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"taxable" numeric(16, 2) NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"cgst" numeric(16, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(16, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(16, 2) DEFAULT '0' NOT NULL,
	"cost_per_kg" numeric(16, 4) DEFAULT '0' NOT NULL,
	"cogs" numeric(16, 2) DEFAULT '0' NOT NULL,
	"ref_line_id" integer
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"kind" text NOT NULL,
	"number" text NOT NULL,
	"supplier_bill_no" text DEFAULT '' NOT NULL,
	"party_id" integer NOT NULL,
	"date" date NOT NULL,
	"due_date" date,
	"is_interstate" boolean DEFAULT false NOT NULL,
	"lines_amount" numeric(16, 2) NOT NULL,
	"freight" numeric(16, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"taxable" numeric(16, 2) NOT NULL,
	"cgst" numeric(16, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(16, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(16, 2) DEFAULT '0' NOT NULL,
	"round_off" numeric(16, 2) DEFAULT '0' NOT NULL,
	"total" numeric(16, 2) NOT NULL,
	"cogs" numeric(16, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"ref_invoice_id" integer,
	"agent" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_by" integer,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"gstin" text DEFAULT '' NOT NULL,
	"state_code" text DEFAULT '27' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"credit_days" integer DEFAULT 30 NOT NULL,
	"credit_limit" numeric(16, 2),
	"opening_balance" numeric(16, 2) DEFAULT '0' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"direction" text NOT NULL,
	"party_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"mode" text NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"cheque_no" text DEFAULT '' NOT NULL,
	"cheque_status" text DEFAULT 'na' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_by" integer,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text
);
--> statement-breakpoint
CREATE TABLE "product_stock" (
	"product_id" integer PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"bags" numeric(16, 3) DEFAULT '0' NOT NULL,
	"kg" numeric(16, 3) DEFAULT '0' NOT NULL,
	"value" numeric(16, 2) DEFAULT '0' NOT NULL,
	"low_stock_alerted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"count" text NOT NULL,
	"brand" text NOT NULL,
	"quality" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"hsn" text DEFAULT '5205' NOT NULL,
	"gst_rate" numeric(5, 2) DEFAULT '5' NOT NULL,
	"bag_weight_kg" numeric(10, 3) NOT NULL,
	"rate_basis" text DEFAULT 'per_5kg' NOT NULL,
	"cones_per_bag" integer,
	"low_stock_bags" numeric(16, 3) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"lot_no" text DEFAULT '' NOT NULL,
	"date" date NOT NULL,
	"type" text NOT NULL,
	"bags" numeric(16, 3) NOT NULL,
	"kg" numeric(16, 3) NOT NULL,
	"unit_cost_per_kg" numeric(16, 4) NOT NULL,
	"value" numeric(16, 2) NOT NULL,
	"invoice_id" integer,
	"invoice_line_id" integer,
	"note" text DEFAULT '' NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"name" text NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_stock" ADD CONSTRAINT "product_stock_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_stock" ADD CONSTRAINT "product_stock_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_business_idx" ON "audit_log" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_idem_uq" ON "expenses" USING btree ("business_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "import_rows_batch_idx" ON "import_rows" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_product_idx" ON "invoice_lines" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_idem_uq" ON "invoices" USING btree ("business_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_uq" ON "invoices" USING btree ("business_id","kind","number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_supplier_bill_uq" ON "invoices" USING btree ("business_id","party_id",lower("supplier_bill_no")) WHERE "invoices"."supplier_bill_no" <> '' and "invoices"."kind" = 'purchase' and "invoices"."status" = 'posted';--> statement-breakpoint
CREATE INDEX "invoices_party_idx" ON "invoices" USING btree ("party_id","date");--> statement-breakpoint
CREATE INDEX "invoices_date_idx" ON "invoices" USING btree ("business_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("business_id","dedupe_key") WHERE "notifications"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "notifications_status_idx" ON "notifications" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "parties_name_uq" ON "parties" USING btree ("business_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idem_uq" ON "payments" USING btree ("business_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "payments_party_idx" ON "payments" USING btree ("party_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "products_name_uq" ON "products" USING btree ("business_id",lower("name"));--> statement-breakpoint
CREATE INDEX "stock_mov_product_idx" ON "stock_movements" USING btree ("product_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_uq" ON "users" USING btree (lower("username"));