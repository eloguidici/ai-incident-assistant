CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_unique UNIQUE (email)
);

CREATE TABLE analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users (id),
  source_text text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  result jsonb,
  error_code text,
  error_message text,
  prompt_version text,
  provider text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT analyses_id_owner_unique UNIQUE (id, owner_id)
);

CREATE INDEX analyses_owner_created_idx ON analyses (owner_id, created_at DESC);
CREATE INDEX analyses_expires_idx ON analyses (expires_at);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  status text NOT NULL CHECK (status IN ('completed', 'failed')),
  result jsonb,
  error_code text,
  sequence integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_analysis_sequence_unique UNIQUE (analysis_id, sequence),
  CONSTRAINT messages_analysis_owner_fk
    FOREIGN KEY (analysis_id, owner_id) REFERENCES analyses (id, owner_id) ON DELETE CASCADE
);

CREATE TABLE ai_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('analysis', 'question')),
  status text NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  prompt_version text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  error_code text,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT ai_executions_analysis_owner_fk
    FOREIGN KEY (analysis_id, owner_id) REFERENCES analyses (id, owner_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX ai_exec_one_analysis_inflight
  ON ai_executions (owner_id)
  WHERE status = 'processing' AND kind = 'analysis';

CREATE UNIQUE INDEX ai_exec_one_question_inflight
  ON ai_executions (analysis_id)
  WHERE status = 'processing' AND kind = 'question';

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  result text NOT NULL,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
