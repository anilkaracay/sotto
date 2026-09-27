DROP INDEX "orgs_owner_user_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "orgs_owner_user_id_key" ON "orgs" USING btree ("owner_user_id");