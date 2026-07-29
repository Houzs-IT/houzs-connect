CREATE SCHEMA IF NOT EXISTS "connect";
--> statement-breakpoint
CREATE TYPE "connect"."AutomationStatus" AS ENUM('DRAFT', 'PUBLISHED');--> statement-breakpoint
CREATE TYPE "connect"."ConversationStatus" AS ENUM('OPEN', 'CLOSED', 'QUEUE', 'PENDING');--> statement-breakpoint
CREATE TYPE "connect"."Direction" AS ENUM('IN', 'OUT');--> statement-breakpoint
CREATE TYPE "connect"."FieldType" AS ENUM('TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT');--> statement-breakpoint
CREATE TYPE "connect"."MessageStatus" AS ENUM('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');--> statement-breakpoint
CREATE TYPE "connect"."MessageType" AS ENUM('TEXT', 'INTERACTIVE', 'TEMPLATE', 'IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO');--> statement-breakpoint
CREATE TYPE "connect"."PaymentStatus" AS ENUM('PENDING', 'VERIFIED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "connect"."Role" AS ENUM('OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'SALES', 'DRIVER', 'VIEWER');--> statement-breakpoint
CREATE TABLE "connect"."automation" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger_type" text NOT NULL,
	"trigger_config" jsonb,
	"status" "connect"."AutomationStatus" DEFAULT 'DRAFT' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"graph" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connect"."automation_run" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"contact_id" text,
	"status" text DEFAULT 'running' NOT NULL,
	"cursor_node_id" text,
	"context" jsonb,
	"log" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connect"."campaign" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"name" text NOT NULL,
	"template_name" text,
	"audience" jsonb,
	"schedule_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"stats" jsonb,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"approved_by_member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connect"."channel" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"display_name" text NOT NULL,
	"phone" text NOT NULL,
	"provider" text DEFAULT 'whatsapp' NOT NULL,
	"mode" text DEFAULT 'DEMO' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connect"."company" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "connect"."contact" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text,
	"phone" text NOT NULL,
	"email" text,
	"source" text,
	"source_id" text,
	"source_url" text,
	"attributes" jsonb,
	"marketing_opt_in" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connect"."contact_field" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"type" "connect"."FieldType" DEFAULT 'TEXT' NOT NULL,
	"options" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connect"."contact_tag" (
	"contact_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "contact_tag_contact_id_tag_id_pk" PRIMARY KEY("contact_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "connect"."conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"status" "connect"."ConversationStatus" DEFAULT 'OPEN' NOT NULL,
	"assigned_agent_id" text,
	"assigned_department_id" text,
	"last_message_at" timestamp with time zone,
	"window_expires_at" timestamp with time zone,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connect"."conversation_tag" (
	"conversation_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "conversation_tag_conversation_id_tag_id_pk" PRIMARY KEY("conversation_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "connect"."department" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connect"."driver_event" (
	"id" text PRIMARY KEY NOT NULL,
	"driver_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"order_ref" text,
	"event_type" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connect"."form" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"fields" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connect"."form_response" (
	"id" text PRIMARY KEY NOT NULL,
	"form_id" text NOT NULL,
	"contact_id" text,
	"answers" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connect"."member" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"title" text,
	"role" "connect"."Role" DEFAULT 'AGENT' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"concurrency_limit" integer DEFAULT 0 NOT NULL,
	"manager_id" text,
	"department_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "connect"."message" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"direction" "connect"."Direction" NOT NULL,
	"type" "connect"."MessageType" DEFAULT 'TEXT' NOT NULL,
	"body" text,
	"media_url" text,
	"status" "connect"."MessageStatus" DEFAULT 'SENT' NOT NULL,
	"sent_by_member_id" text,
	"is_bot" boolean DEFAULT false NOT NULL,
	"wa_message_id" text,
	"interactive_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connect"."note" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"member_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connect"."payment" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"conversation_id" text,
	"amount" double precision,
	"currency" text DEFAULT 'MYR' NOT NULL,
	"method" text,
	"reference_no" text,
	"order_ref" text,
	"receipt_media_url" text,
	"ocr_raw_text" text,
	"status" "connect"."PaymentStatus" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connect"."quick_reply" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"shortcut" text NOT NULL,
	"body" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connect"."tag" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#16695f' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connect"."team" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connect"."team_member" (
	"team_id" text NOT NULL,
	"member_id" text NOT NULL,
	CONSTRAINT "team_member_team_id_member_id_pk" PRIMARY KEY("team_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "connect"."webhook_event" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"event_type" text,
	"payload" jsonb NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "automation_company_idx" ON "connect"."automation" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "automation_run_automation_idx" ON "connect"."automation_run" USING btree ("automation_id");--> statement-breakpoint
CREATE INDEX "campaign_company_idx" ON "connect"."campaign" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "channel_company_idx" ON "connect"."channel" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_company_phone_key" ON "connect"."contact" USING btree ("company_id","phone");--> statement-breakpoint
CREATE INDEX "contact_company_idx" ON "connect"."contact" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_field_company_key_key" ON "connect"."contact_field" USING btree ("company_id","key");--> statement-breakpoint
CREATE INDEX "contact_field_company_idx" ON "connect"."contact_field" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "conversation_channel_idx" ON "connect"."conversation" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "conversation_contact_idx" ON "connect"."conversation" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "conversation_status_idx" ON "connect"."conversation" USING btree ("status");--> statement-breakpoint
CREATE INDEX "department_company_idx" ON "connect"."department" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "driver_event_contact_idx" ON "connect"."driver_event" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "form_company_idx" ON "connect"."form" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "form_response_form_idx" ON "connect"."form_response" USING btree ("form_id");--> statement-breakpoint
CREATE INDEX "member_company_idx" ON "connect"."member" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "member_manager_idx" ON "connect"."member" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "message_conversation_idx" ON "connect"."message" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "note_conversation_idx" ON "connect"."note" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "payment_contact_idx" ON "connect"."payment" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quick_reply_company_shortcut_key" ON "connect"."quick_reply" USING btree ("company_id","shortcut");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_company_name_key" ON "connect"."tag" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "team_company_idx" ON "connect"."team" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "webhook_event_source_idx" ON "connect"."webhook_event" USING btree ("source");