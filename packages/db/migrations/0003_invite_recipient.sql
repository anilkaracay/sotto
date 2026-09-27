ALTER TABLE "invites" ADD COLUMN "recipient_id" uuid;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invites_recipient_id_idx" ON "invites" USING btree ("recipient_id");--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_token_sha256" CHECK ("invites"."token" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_recipient_role" CHECK (("invites"."role" = 'recipient') = ("invites"."recipient_id" is not null));