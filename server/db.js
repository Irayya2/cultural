// db.js
// Supabase database configuration

const { createClient } = require('@supabase/supabase-js');

const path = require('path');
const fs = require('fs');

if (!process.env.SUPABASE_URL) {
  const localDotenv = path.join(__dirname, '.env');
  const parentDotenv = path.join(__dirname, '..', '.env');
  if (fs.existsSync(localDotenv)) {
    require('dotenv').config({ path: localDotenv });
  } else if (fs.existsSync(parentDotenv)) {
    require('dotenv').config({ path: parentDotenv });
  } else {
    require('dotenv').config();
  }
}

let supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn("⚠️ Warning: Missing SUPABASE_URL or SUPABASE_KEY environment variables!");
}

// Clean up URL if it contains /rest/v1 suffix
if (supabaseUrl.endsWith('/rest/v1/')) {
  supabaseUrl = supabaseUrl.slice(0, -9);
} else if (supabaseUrl.endsWith('/rest/v1')) {
  supabaseUrl = supabaseUrl.slice(0, -8);
}

const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseKey || 'placeholder'
);

// We no longer need a read/write init phase like lowdb, but we keep the export pattern.
async function initDb() {
  console.log("Supabase client initialized.");
  return supabase;
}

module.exports = { supabase, initDb };
