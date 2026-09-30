CREATE TABLE "waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"company" text NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_email_unique" UNIQUE("email"),
	CONSTRAINT "waitlist_email_shape" CHECK (char_length("waitlist"."email") between 3 and 254 and "waitlist"."email" = lower("waitlist"."email") and position('@' in "waitlist"."email") > 1),
	CONSTRAINT "waitlist_company_length" CHECK (char_length("waitlist"."company") between 1 and 120)
);
