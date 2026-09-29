CREATE TYPE "public"."payroll_run_status" AS ENUM('draft', 'awaiting_approval', 'approved', 'executing', 'settled', 'partially_settled', 'failed');--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"period" char(7) NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "payroll_run_status" DEFAULT 'draft' NOT NULL,
	"line_count" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"executed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_runs_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "payroll_runs_period_format" CHECK ("payroll_runs"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "payroll_runs_line_count_min" CHECK ("payroll_runs"."line_count" >= 1)
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "line_no" integer;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payroll_runs_org_id_idx" ON "payroll_runs" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_run_id_idx" ON "payments" USING btree ("run_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_run_line_key" UNIQUE("run_id","line_no");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_kind_run" CHECK (("payments"."kind" = 'payroll_line' and "payments"."run_id" is not null and "payments"."line_no" is not null and "payments"."line_no" >= 1) or ("payments"."kind" = 'single' and "payments"."run_id" is null and "payments"."line_no" is null));