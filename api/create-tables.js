const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.pdnveouohbhbgspwsmxd:Irayya%409436@aws-0-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false },
});

const sql = `
CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY,
  team_number INT UNIQUE,
  team_name TEXT,
  email TEXT,
  password_hash TEXT,
  uucms_no TEXT,
  semester INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teachers (
  id UUID PRIMARY KEY,
  name TEXT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quiz_sets (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  semester INT NOT NULL,
  questions JSONB NOT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quiz_answers (
  id UUID PRIMARY KEY,
  quiz_set_id UUID REFERENCES quiz_sets(id) ON DELETE CASCADE,
  answers JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attempts (
  id UUID PRIMARY KEY,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  quiz_set_id UUID REFERENCES quiz_sets(id) ON DELETE CASCADE,
  question_order JSONB NOT NULL,
  answers JSONB DEFAULT '{}'::jsonb,
  tab_switch_count INT DEFAULT 0,
  status TEXT DEFAULT 'in_progress',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  score INT
);

-- Enable RLS and create permissive policies
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE attempts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on students') THEN
    CREATE POLICY "Allow all on students" ON students FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on teachers') THEN
    CREATE POLICY "Allow all on teachers" ON teachers FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on quiz_sets') THEN
    CREATE POLICY "Allow all on quiz_sets" ON quiz_sets FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on quiz_answers') THEN
    CREATE POLICY "Allow all on quiz_answers" ON quiz_answers FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on attempts') THEN
    CREATE POLICY "Allow all on attempts" ON attempts FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
`;

async function run() {
  try {
    await client.connect();
    console.log('Connected to Supabase PostgreSQL!');
    await client.query(sql);
    console.log('All tables and policies created successfully!');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.end();
  }
}

run();
