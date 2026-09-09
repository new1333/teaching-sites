CREATE TYPE "public"."deploy_env" AS ENUM('production', 'staging');--> statement-breakpoint
CREATE TYPE "public"."deploy_status" AS ENUM('success', 'failed');--> statement-breakpoint
CREATE TABLE "deploys" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "deploys_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"env" "deploy_env" NOT NULL,
	"status" "deploy_status" NOT NULL,
	"commit" text NOT NULL,
	"summary" text NOT NULL
);
