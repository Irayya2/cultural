// db.js
// Supabase database configuration

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// We no longer need a read/write init phase like lowdb, but we keep the export pattern.
async function initDb() {
  console.log("Supabase client initialized.");
  return supabase;
}

module.exports = { supabase, initDb };
