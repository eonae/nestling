CREATE TABLE "outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"subject" text NOT NULL,
	"payload" jsonb,
	"durable" boolean NOT NULL,
	"partition_key" text,
	"context" jsonb,
	"state" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"avatar_url" text,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "outbox_ready_idx" ON "outbox" USING btree ("state","available_at");--> statement-breakpoint
CREATE INDEX "outbox_partition_idx" ON "outbox" USING btree ("partition_key","seq");