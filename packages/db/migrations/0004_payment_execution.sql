CREATE TABLE "cluster_health" (
	"cluster" "cluster_name" PRIMARY KEY NOT NULL,
	"proof_program_ok" boolean NOT NULL,
	"detail" text,
	"checked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "transfer_signature" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "created_by" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "private_blob" "bytea";--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;