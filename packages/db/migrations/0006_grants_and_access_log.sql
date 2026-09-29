CREATE TABLE "access_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "access_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"org_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_log_action_format" CHECK ("access_log"."action" ~ '^[a-z][a-z_]{2,63}$')
);
--> statement-breakpoint
ALTER TABLE "grants" ADD COLUMN "holder_name" text;--> statement-breakpoint
ALTER TABLE "grants" ADD COLUMN "holder_title" text;--> statement-breakpoint
ALTER TABLE "grants" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "access_log" ADD CONSTRAINT "access_log_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_log" ADD CONSTRAINT "access_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_log_org_created_idx" ON "access_log" USING btree ("org_id","created_at");--> statement-breakpoint
-- Rows written before step 2.4: a settled payment's last update is its settlement (the worker's), and
-- an active grant became active at the latest when it was created or its viewer registered a key.
UPDATE "payments" SET "settled_at" = "updated_at" WHERE "status" = 'settled' AND "settled_at" IS NULL;--> statement-breakpoint
UPDATE "grants" SET "activated_at" = "created_at" WHERE "status" = 'active' AND "activated_at" IS NULL;
