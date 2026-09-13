CREATE TABLE "inbox" (
	"consumer" text NOT NULL,
	"key" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inbox_consumer_key_pk" PRIMARY KEY("consumer","key")
);
--> statement-breakpoint
CREATE INDEX "inbox_received_idx" ON "inbox" USING btree ("received_at");