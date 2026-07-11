// db.js
// Supabase database configuration

const { createClient } = require('@supabase/supabase-js');

let supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env");
  process.exit(1);
}

// Clean up URL if it contains /rest/v1 suffix
if (supabaseUrl.endsWith('/rest/v1/')) {
  supabaseUrl = supabaseUrl.slice(0, -9);
} else if (supabaseUrl.endsWith('/rest/v1')) {
  supabaseUrl = supabaseUrl.slice(0, -8);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// We no longer need a read/write init phase like lowdb, but we keep the export pattern.
async function initDb() {
  console.log("Supabase client initialized.");
  return supabase;
}

module.exports = { supabase, initDb };
