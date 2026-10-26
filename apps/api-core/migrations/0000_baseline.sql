-- ============================================================================
-- 0000 Baseline: api-core schema as of 2026-10-25 (pg_dump --schema-only).
-- Only applied to an EMPTY database; on an existing database the migration
-- runner records it as applied without running it (see src/db/migrate.ts).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE public.attempt_status AS ENUM (
    'in_progress',
    'submitted',
    'abandoned'
);

CREATE TYPE public.difficulty_level AS ENUM (
    'easy',
    'moderate',
    'hard'
);

CREATE TYPE public.ingestion_source AS ENUM (
    'csv_upload',
    'json_upload',
    'pdf_extract',
    'ai_generated',
    'manual'
);

CREATE TYPE public.ingestion_status AS ENUM (
    'pending_ai',
    'pending_review',
    'approved',
    'rejected',
    'inserted',
    'failed'
);

CREATE TYPE public.mastery_band AS ENUM (
    'critical_weakness',
    'needs_revision',
    'proficient',
    'exam_ready'
);

CREATE TYPE public.option_key AS ENUM (
    'A',
    'B',
    'C',
    'D'
);

CREATE TYPE public.question_attempt_state AS ENUM (
    'answered',
    'marked_for_review',
    'answered_and_marked',
    'unanswered',
    'not_visited'
);

CREATE TYPE public.question_source AS ENUM (
    'pyq',
    'educator',
    'ai_generated'
);

CREATE TYPE public.subscription_tier AS ENUM (
    'free',
    'pro_prelims',
    'wbcs_executive_pass'
);

CREATE TYPE public.user_role AS ENUM (
    'aspirant',
    'educator',
    'admin'
);

CREATE TABLE public.attempt_answers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    attempt_id uuid NOT NULL,
    user_id uuid NOT NULL,
    question_id uuid NOT NULL,
    subtopic_id uuid NOT NULL,
    selected_option public.option_key,
    state public.question_attempt_state DEFAULT 'unanswered'::public.question_attempt_state NOT NULL,
    is_correct boolean DEFAULT false NOT NULL,
    marks_awarded numeric(5,2) DEFAULT 0.00 NOT NULL,
    time_spent_seconds integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "position" integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.chapters (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    subject_id uuid NOT NULL,
    slug character varying(140) NOT NULL,
    name jsonb NOT NULL,
    display_order integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.exams (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    slug character varying(80) NOT NULL,
    title jsonb NOT NULL,
    description jsonb NOT NULL,
    total_questions integer DEFAULT 100 NOT NULL,
    duration_minutes integer DEFAULT 90 NOT NULL,
    marks_per_correct numeric(5,2) DEFAULT 1.00 NOT NULL,
    negative_marks_per_wrong numeric(5,2) DEFAULT 0.25 NOT NULL,
    estimated_cutoff_marks numeric(6,2) DEFAULT 65.00 NOT NULL,
    target_time_per_question_sec integer DEFAULT 45 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.question_ingestion_jobs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    uploaded_by uuid,
    source public.ingestion_source NOT NULL,
    status public.ingestion_status DEFAULT 'pending_ai'::public.ingestion_status NOT NULL,
    batch_id character varying(80) NOT NULL,
    raw_data jsonb NOT NULL,
    enriched_data jsonb,
    exam_id uuid,
    subject_id uuid,
    chapter_id uuid,
    subtopic_id uuid,
    pyq_year integer,
    pyq_exam_name character varying(160),
    ai_confidence_score numeric(4,2),
    content_hash character varying(64),
    review_notes text,
    inserted_question_id uuid,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone
);

CREATE TABLE public.questions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    exam_id uuid NOT NULL,
    exam_slug character varying(80) NOT NULL,
    subject_id uuid NOT NULL,
    chapter_id uuid NOT NULL,
    subtopic_id uuid NOT NULL,
    stem jsonb NOT NULL,
    options jsonb NOT NULL,
    correct_option public.option_key NOT NULL,
    explanation jsonb NOT NULL,
    difficulty public.difficulty_level DEFAULT 'moderate'::public.difficulty_level NOT NULL,
    marks_positive numeric(5,2) DEFAULT 1.00 NOT NULL,
    marks_negative numeric(5,2) DEFAULT 0.25 NOT NULL,
    previous_year_tag character varying(100),
    source public.question_source DEFAULT 'educator'::public.question_source NOT NULL,
    pyq_exam_slug character varying(80),
    pyq_year integer,
    answer_key_verified boolean DEFAULT false NOT NULL,
    content_hash character varying(64),
    ingestion_job_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.subjects (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    exam_id uuid NOT NULL,
    slug character varying(120) NOT NULL,
    name jsonb NOT NULL,
    weightage_questions integer DEFAULT 25 NOT NULL,
    display_order integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.subtopics (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    chapter_id uuid NOT NULL,
    subject_id uuid NOT NULL,
    slug character varying(160) NOT NULL,
    name jsonb NOT NULL,
    expected_time_seconds integer DEFAULT 45 NOT NULL,
    is_high_yield_wbpsc boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.test_attempts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    exam_id uuid NOT NULL,
    is_remedial boolean DEFAULT false NOT NULL,
    status public.attempt_status DEFAULT 'in_progress'::public.attempt_status NOT NULL,
    preferred_language character varying(2) DEFAULT 'bn'::character varying NOT NULL,
    total_questions integer NOT NULL,
    attempted_count integer DEFAULT 0 NOT NULL,
    correct_count integer DEFAULT 0 NOT NULL,
    incorrect_count integer DEFAULT 0 NOT NULL,
    unanswered_count integer DEFAULT 0 NOT NULL,
    raw_positive_score numeric(7,2) DEFAULT 0.00 NOT NULL,
    negative_penalty numeric(7,2) DEFAULT 0.00 NOT NULL,
    final_net_score numeric(7,2) DEFAULT 0.00 NOT NULL,
    max_possible_score numeric(7,2) DEFAULT 100.00 NOT NULL,
    accuracy_percentage numeric(5,2) DEFAULT 0.00 NOT NULL,
    total_time_spent_seconds integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    submitted_at timestamp with time zone
);

CREATE TABLE public.user_subtopic_mastery (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    exam_id uuid NOT NULL,
    subject_id uuid NOT NULL,
    chapter_id uuid NOT NULL,
    subtopic_id uuid NOT NULL,
    total_encountered integer DEFAULT 0 NOT NULL,
    total_attempted integer DEFAULT 0 NOT NULL,
    total_correct integer DEFAULT 0 NOT NULL,
    total_incorrect integer DEFAULT 0 NOT NULL,
    total_unanswered integer DEFAULT 0 NOT NULL,
    cumulative_net_score numeric(8,2) DEFAULT 0.00 NOT NULL,
    cumulative_time_seconds integer DEFAULT 0 NOT NULL,
    accuracy_percentage numeric(5,2) DEFAULT 0.00 NOT NULL,
    avg_time_per_question_seconds numeric(6,2) DEFAULT 0.00 NOT NULL,
    mastery_band public.mastery_band DEFAULT 'critical_weakness'::public.mastery_band NOT NULL,
    weakness_priority_score numeric(6,2) DEFAULT 100.00 NOT NULL,
    last_tested_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email character varying(255) NOT NULL,
    phone character varying(20),
    password_hash text,
    full_name character varying(160) NOT NULL,
    preferred_language character varying(2) DEFAULT 'bn'::character varying NOT NULL,
    target_exam_slug character varying(80) DEFAULT 'wbcs-prelims'::character varying NOT NULL,
    role public.user_role DEFAULT 'aspirant'::public.user_role NOT NULL,
    subscription_tier public.subscription_tier DEFAULT 'free'::public.subscription_tier NOT NULL,
    razorpay_customer_id character varying(128),
    subscription_expires_at timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    google_sub character varying(64),
    last_login_at timestamp with time zone
);

ALTER TABLE ONLY public.attempt_answers
    ADD CONSTRAINT attempt_answers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.chapters
    ADD CONSTRAINT chapters_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.exams
    ADD CONSTRAINT exams_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.question_ingestion_jobs
    ADD CONSTRAINT question_ingestion_jobs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.subtopics
    ADD CONSTRAINT subtopics_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.test_attempts
    ADD CONSTRAINT test_attempts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_subtopic_mastery
    ADD CONSTRAINT user_subtopic_mastery_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX attempt_answers_attempt_question_unique_idx ON public.attempt_answers USING btree (attempt_id, question_id);

CREATE INDEX attempt_answers_user_question_idx ON public.attempt_answers USING btree (user_id, question_id);

CREATE INDEX attempt_answers_user_subtopic_idx ON public.attempt_answers USING btree (user_id, subtopic_id);

CREATE INDEX chapters_subject_id_idx ON public.chapters USING btree (subject_id);

CREATE UNIQUE INDEX chapters_subject_slug_unique_idx ON public.chapters USING btree (subject_id, slug);

CREATE UNIQUE INDEX exams_slug_unique_idx ON public.exams USING btree (slug);

CREATE INDEX ingestion_jobs_batch_idx ON public.question_ingestion_jobs USING btree (batch_id);

CREATE INDEX ingestion_jobs_content_hash_idx ON public.question_ingestion_jobs USING btree (content_hash);

CREATE INDEX ingestion_jobs_exam_idx ON public.question_ingestion_jobs USING btree (exam_id);

CREATE INDEX ingestion_jobs_status_idx ON public.question_ingestion_jobs USING btree (status);

CREATE INDEX ingestion_jobs_uploader_idx ON public.question_ingestion_jobs USING btree (uploaded_by);

CREATE UNIQUE INDEX questions_content_hash_unique_idx ON public.questions USING btree (content_hash);

CREATE INDEX questions_exam_active_idx ON public.questions USING btree (exam_id, is_active);

CREATE INDEX questions_pyq_idx ON public.questions USING btree (pyq_exam_slug, pyq_year);

CREATE INDEX questions_source_idx ON public.questions USING btree (source);

CREATE INDEX questions_subject_chapter_idx ON public.questions USING btree (subject_id, chapter_id);

CREATE INDEX questions_subtopic_active_idx ON public.questions USING btree (subtopic_id, is_active);

CREATE INDEX subjects_exam_id_idx ON public.subjects USING btree (exam_id);

CREATE UNIQUE INDEX subjects_exam_slug_unique_idx ON public.subjects USING btree (exam_id, slug);

CREATE UNIQUE INDEX subtopics_chapter_slug_unique_idx ON public.subtopics USING btree (chapter_id, slug);

CREATE INDEX subtopics_slug_idx ON public.subtopics USING btree (slug);

CREATE INDEX subtopics_subject_id_idx ON public.subtopics USING btree (subject_id);

CREATE INDEX test_attempts_user_exam_idx ON public.test_attempts USING btree (user_id, exam_id);

CREATE INDEX test_attempts_user_status_idx ON public.test_attempts USING btree (user_id, status);

CREATE UNIQUE INDEX user_subtopic_mastery_user_subtopic_unique_idx ON public.user_subtopic_mastery USING btree (user_id, subtopic_id);

CREATE INDEX user_subtopic_mastery_weakness_rank_idx ON public.user_subtopic_mastery USING btree (user_id, exam_id, weakness_priority_score);

CREATE UNIQUE INDEX users_email_unique_idx ON public.users USING btree (email);

CREATE UNIQUE INDEX users_google_sub_unique_idx ON public.users USING btree (google_sub);

CREATE UNIQUE INDEX users_phone_unique_idx ON public.users USING btree (phone);

CREATE INDEX users_target_exam_idx ON public.users USING btree (target_exam_slug);

ALTER TABLE ONLY public.attempt_answers
    ADD CONSTRAINT attempt_answers_attempt_id_test_attempts_id_fk FOREIGN KEY (attempt_id) REFERENCES public.test_attempts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.attempt_answers
    ADD CONSTRAINT attempt_answers_question_id_questions_id_fk FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.attempt_answers
    ADD CONSTRAINT attempt_answers_subtopic_id_subtopics_id_fk FOREIGN KEY (subtopic_id) REFERENCES public.subtopics(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.attempt_answers
    ADD CONSTRAINT attempt_answers_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.chapters
    ADD CONSTRAINT chapters_subject_id_subjects_id_fk FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.question_ingestion_jobs
    ADD CONSTRAINT question_ingestion_jobs_chapter_id_chapters_id_fk FOREIGN KEY (chapter_id) REFERENCES public.chapters(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.question_ingestion_jobs
    ADD CONSTRAINT question_ingestion_jobs_exam_id_exams_id_fk FOREIGN KEY (exam_id) REFERENCES public.exams(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.question_ingestion_jobs
    ADD CONSTRAINT question_ingestion_jobs_subject_id_subjects_id_fk FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.question_ingestion_jobs
    ADD CONSTRAINT question_ingestion_jobs_subtopic_id_subtopics_id_fk FOREIGN KEY (subtopic_id) REFERENCES public.subtopics(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.question_ingestion_jobs
    ADD CONSTRAINT question_ingestion_jobs_uploaded_by_users_id_fk FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_chapter_id_chapters_id_fk FOREIGN KEY (chapter_id) REFERENCES public.chapters(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_exam_id_exams_id_fk FOREIGN KEY (exam_id) REFERENCES public.exams(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_subject_id_subjects_id_fk FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_subtopic_id_subtopics_id_fk FOREIGN KEY (subtopic_id) REFERENCES public.subtopics(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_exam_id_exams_id_fk FOREIGN KEY (exam_id) REFERENCES public.exams(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.subtopics
    ADD CONSTRAINT subtopics_chapter_id_chapters_id_fk FOREIGN KEY (chapter_id) REFERENCES public.chapters(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.subtopics
    ADD CONSTRAINT subtopics_subject_id_subjects_id_fk FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.test_attempts
    ADD CONSTRAINT test_attempts_exam_id_exams_id_fk FOREIGN KEY (exam_id) REFERENCES public.exams(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.test_attempts
    ADD CONSTRAINT test_attempts_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_subtopic_mastery
    ADD CONSTRAINT user_subtopic_mastery_chapter_id_chapters_id_fk FOREIGN KEY (chapter_id) REFERENCES public.chapters(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_subtopic_mastery
    ADD CONSTRAINT user_subtopic_mastery_exam_id_exams_id_fk FOREIGN KEY (exam_id) REFERENCES public.exams(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_subtopic_mastery
    ADD CONSTRAINT user_subtopic_mastery_subject_id_subjects_id_fk FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_subtopic_mastery
    ADD CONSTRAINT user_subtopic_mastery_subtopic_id_subtopics_id_fk FOREIGN KEY (subtopic_id) REFERENCES public.subtopics(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_subtopic_mastery
    ADD CONSTRAINT user_subtopic_mastery_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

