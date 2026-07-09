const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.pdnveouohbhbgspwsmxd:Irayya%409436@aws-0-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false },
});

const sql = `
CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  uucms_no TEXT,
  created_at BIGINT
);

CREATE TABLE IF NOT EXISTS teachers (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS otps (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  role TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  used BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS quiz_sets (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  semester INT NOT NULL,
  questions JSONB NOT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  created_at BIGINT
);

CREATE TABLE IF NOT EXISTS attempts (
  id UUID PRIMARY KEY,
  student_id UUID REFERENCES students(id),
  quiz_set_id UUID REFERENCES quiz_sets(id),
  question_order JSONB NOT NULL,
  answers JSONB DEFAULT '{}'::jsonb,
  tab_switch_count INT DEFAULT 0,
  status TEXT DEFAULT 'in_progress',
  started_at BIGINT,
  submitted_at BIGINT
);

-- Enable RLS and create permissive policies so the publishable key can read/write
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE attempts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on students') THEN
    CREATE POLICY "Allow all on students" ON students FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on teachers') THEN
    CREATE POLICY "Allow all on teachers" ON teachers FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on otps') THEN
    CREATE POLICY "Allow all on otps" ON otps FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all on quiz_sets') THEN
    CREATE POLICY "Allow all on quiz_sets" ON quiz_sets FOR ALL USING (true) WITH CHECK (true);
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
