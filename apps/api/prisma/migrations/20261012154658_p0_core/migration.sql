-- pgvector for knowledge retrieval embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('PROCESSING', 'CLINICIAN_SHARING', 'VOICE', 'ANALYTICS');

-- CreateEnum
CREATE TYPE "ConsentAction" AS ENUM ('GRANTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "BundleStatus" AS ENUM ('DRAFT', 'REVIEW_REQUESTED', 'APPROVED', 'EVALUATED', 'STAGED', 'RELEASED', 'RETIRED');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('DRAFT', 'APPROVED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "CheckStatus" AS ENUM ('DRAFT', 'COLLECTING', 'AWAITING_CONFIRMATION', 'ASSESSING', 'COMPLETED', 'INCOMPLETE', 'ESCALATED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FactState" AS ENUM ('PRESENT', 'ABSENT', 'UNKNOWN', 'DECLINED', 'NOT_ASKED');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "active_bundle_id" UUID,
ADD COLUMN     "capabilities" TEXT[],
ADD COLUMN     "domain_verified_at" TIMESTAMP(3),
ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "platform_flags" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_flags_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "outbox_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "run_after" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "last_error" TEXT,
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "outbox_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notice_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "purpose" "ConsentPurpose" NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMP(3),

    CONSTRAINT "notice_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subject_user_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "action" "ConsentAction" NOT NULL,
    "notice_version_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "date_of_birth" DATE,
    "sex_at_birth" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "pregnancy_status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "conditions" JSONB NOT NULL DEFAULT '{"state":"unknown","items":[]}',
    "medications" JSONB NOT NULL DEFAULT '{"state":"unknown","items":[]}',
    "allergies" JSONB NOT NULL DEFAULT '{"state":"unknown","items":[]}',
    "city" TEXT,
    "preferred_language" TEXT NOT NULL DEFAULT 'en',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_versions" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_bundles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "version" TEXT NOT NULL,
    "status" "BundleStatus" NOT NULL DEFAULT 'DRAFT',
    "schema_version" TEXT NOT NULL DEFAULT '1',
    "content" JSONB NOT NULL,
    "change_note" TEXT,
    "author_id" UUID NOT NULL,
    "approver_id" UUID,
    "approved_at" TIMESTAMP(3),
    "evaluation" JSONB,
    "evaluated_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "retired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinical_bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "source_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "publisher" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "url" TEXT,
    "licence" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL,
    "reviewed_at" TIMESTAMP(3) NOT NULL,
    "review_due_at" TIMESTAMP(3) NOT NULL,
    "concern_codes" TEXT[],
    "status" "SourceStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "heading" TEXT,
    "text" TEXT NOT NULL,
    "embedding" vector,
    "embedding_model" TEXT,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_user_id" UUID NOT NULL,
    "status" "CheckStatus" NOT NULL DEFAULT 'DRAFT',
    "concern_code" TEXT,
    "bundle_id" UUID NOT NULL,
    "input_version" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "turn_count" INTEGER NOT NULL DEFAULT 0,
    "urgency" TEXT,
    "pending_question_id" TEXT,
    "current_result_id" UUID,
    "parent_session_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "sender" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "question_id" TEXT,
    "input_version" INTEGER NOT NULL,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_facts" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "state" "FactState" NOT NULL,
    "value" JSONB,
    "source" TEXT NOT NULL,
    "source_message_id" UUID,
    "quote" TEXT,
    "assertion" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "input_version" INTEGER NOT NULL,
    "superseded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answers" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "question_id" TEXT NOT NULL,
    "state" "FactState" NOT NULL,
    "value" JSONB,
    "input_version" INTEGER NOT NULL,
    "superseded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_events" (
    "sequence" BIGSERIAL NOT NULL,
    "session_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_events_pkey" PRIMARY KEY ("sequence")
);

-- CreateTable
CREATE TABLE "urgency_decisions" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "input_version" INTEGER NOT NULL,
    "level" TEXT NOT NULL,
    "rule_ids" TEXT[],
    "bundle_id" UUID NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'RULES',
    "reason" TEXT,
    "actor_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "urgency_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_results" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "input_version" INTEGER NOT NULL,
    "input_hash" TEXT NOT NULL,
    "bundle_id" UUID NOT NULL,
    "schema_version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "urgency" TEXT NOT NULL,
    "generator" TEXT NOT NULL,
    "model" TEXT,
    "prompt_version" TEXT,
    "content" JSONB NOT NULL,
    "superseded_at" TIMESTAMP(3),
    "review_status" TEXT NOT NULL DEFAULT 'UNREVIEWED',
    "latency_ms" INTEGER,
    "usage" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_links" (
    "id" UUID NOT NULL,
    "result_id" UUID NOT NULL,
    "chunk_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "citation_id" TEXT NOT NULL,

    CONSTRAINT "evidence_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_acknowledgements" (
    "id" UUID NOT NULL,
    "result_id" UUID NOT NULL,
    "item_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "acknowledged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_acknowledgements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_tasks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "result_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "assignee_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "due_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_decisions" (
    "id" UUID NOT NULL,
    "review_task_id" UUID NOT NULL,
    "result_id" UUID NOT NULL,
    "clinician_id" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "corrected_urgency" TEXT,
    "patient_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinics" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "phone" TEXT,

    CONSTRAINT "clinics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "external_ref" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "specialties" TEXT[],
    "languages" TEXT[],
    "qualifications" TEXT[],
    "registration_number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "verified_at" TIMESTAMP(3),
    "verified_by_id" UUID,
    "credential_expires_at" TIMESTAMP(3),
    "booking_method" TEXT NOT NULL,
    "booking_url" TEXT,
    "booking_phone" TEXT,
    "consultation_modes" TEXT[],
    "fee_amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "accessibility" TEXT[],
    "next_available_at" TIMESTAMP(3),
    "schedule_updated_at" TIMESTAMP(3),
    "bio" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_user_id" UUID NOT NULL,
    "session_id" UUID,
    "result_id" UUID,
    "provider_id" UUID NOT NULL,
    "specialty" TEXT,
    "status" TEXT NOT NULL DEFAULT 'HANDOFF_OPENED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_reported_appointments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_user_id" UUID NOT NULL,
    "referral_id" UUID,
    "provider_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "time_zone" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PATIENT_REPORTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_reported_appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicine_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "slug" TEXT NOT NULL,
    "generic_name" TEXT NOT NULL,
    "brand_examples" TEXT[],
    "category" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "how_it_works" TEXT NOT NULL,
    "common_side_effects" TEXT[],
    "warnings" TEXT[],
    "when_to_seek_help" TEXT NOT NULL,
    "source_document_id" UUID,
    "reviewed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicine_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "actor_user_id" UUID,
    "subject_user_id" UUID,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "purpose" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'SUCCESS',
    "correlation_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privacy_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "privacy_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_holds" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),

    CONSTRAINT "legal_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deletion_tombstones" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subject_hash" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deletion_tombstones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbox_jobs_status_run_after_idx" ON "outbox_jobs"("status", "run_after");

-- CreateIndex
CREATE UNIQUE INDEX "notice_versions_tenant_id_purpose_version_key" ON "notice_versions"("tenant_id", "purpose", "version");

-- CreateIndex
CREATE INDEX "consent_records_tenant_id_subject_user_id_purpose_created_a_idx" ON "consent_records"("tenant_id", "subject_user_id", "purpose", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "patient_profiles_tenant_id_user_id_key" ON "patient_profiles"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "profile_versions_profile_id_version_key" ON "profile_versions"("profile_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "clinical_bundles_tenant_id_version_key" ON "clinical_bundles"("tenant_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_documents_tenant_id_source_key_version_key" ON "knowledge_documents"("tenant_id", "source_key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_document_id_ordinal_key" ON "knowledge_chunks"("document_id", "ordinal");

-- CreateIndex
CREATE INDEX "assessment_sessions_tenant_id_patient_user_id_created_at_idx" ON "assessment_sessions"("tenant_id", "patient_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_sessions_tenant_id_patient_user_id_idempotency_k_key" ON "assessment_sessions"("tenant_id", "patient_user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "messages_session_id_created_at_idx" ON "messages"("session_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "messages_session_id_idempotency_key_key" ON "messages"("session_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "case_facts_session_id_key_idx" ON "case_facts"("session_id", "key");

-- CreateIndex
CREATE INDEX "answers_session_id_question_id_idx" ON "answers"("session_id", "question_id");

-- CreateIndex
CREATE INDEX "session_events_session_id_sequence_idx" ON "session_events"("session_id", "sequence");

-- CreateIndex
CREATE INDEX "urgency_decisions_session_id_created_at_idx" ON "urgency_decisions"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "assessment_results_session_id_created_at_idx" ON "assessment_results"("session_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_links_result_id_citation_id_key" ON "evidence_links"("result_id", "citation_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_acknowledgements_result_id_item_id_key" ON "task_acknowledgements"("result_id", "item_id");

-- CreateIndex
CREATE INDEX "review_tasks_tenant_id_status_due_at_idx" ON "review_tasks"("tenant_id", "status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "review_tasks_result_id_key" ON "review_tasks"("result_id");

-- CreateIndex
CREATE INDEX "clinics_tenant_id_city_idx" ON "clinics"("tenant_id", "city");

-- CreateIndex
CREATE INDEX "providers_tenant_id_status_idx" ON "providers"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "providers_tenant_id_external_ref_key" ON "providers"("tenant_id", "external_ref");

-- CreateIndex
CREATE INDEX "referrals_tenant_id_patient_user_id_idx" ON "referrals"("tenant_id", "patient_user_id");

-- CreateIndex
CREATE INDEX "patient_reported_appointments_tenant_id_patient_user_id_idx" ON "patient_reported_appointments"("tenant_id", "patient_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "medicine_entries_tenant_id_slug_key" ON "medicine_entries"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_created_at_idx" ON "audit_events"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_subject_user_id_created_at_idx" ON "audit_events"("tenant_id", "subject_user_id", "created_at");

-- CreateIndex
CREATE INDEX "privacy_requests_tenant_id_user_id_idx" ON "privacy_requests"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "legal_holds_tenant_id_user_id_idx" ON "legal_holds"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "deletion_tombstones_tenant_id_subject_hash_key" ON "deletion_tombstones"("tenant_id", "subject_hash");

-- CreateIndex
CREATE INDEX "product_events_tenant_id_name_created_at_idx" ON "product_events"("tenant_id", "name", "created_at");

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_notice_version_id_fkey" FOREIGN KEY ("notice_version_id") REFERENCES "notice_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_versions" ADD CONSTRAINT "profile_versions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "assessment_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_facts" ADD CONSTRAINT "case_facts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "assessment_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "assessment_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "assessment_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "urgency_decisions" ADD CONSTRAINT "urgency_decisions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "assessment_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "assessment_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "assessment_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "knowledge_chunks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_acknowledgements" ADD CONSTRAINT "task_acknowledgements_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "assessment_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_decisions" ADD CONSTRAINT "clinical_decisions_review_task_id_fkey" FOREIGN KEY ("review_task_id") REFERENCES "review_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "providers" ADD CONSTRAINT "providers_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_reported_appointments" ADD CONSTRAINT "patient_reported_appointments_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "referrals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
