import { createClient } from '@supabase/supabase-js';
import { logger } from './logger';

let supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  logger.error('Missing SUPABASE_URL or SUPABASE_KEY environment variables');
  process.exit(1);
}

// Clean up URL if it contains /rest/v1 suffix
if (supabaseUrl.endsWith('/rest/v1/')) {
  supabaseUrl = supabaseUrl.slice(0, -9);
} else if (supabaseUrl.endsWith('/rest/v1')) {
  supabaseUrl = supabaseUrl.slice(0, -8);
}

export const supabase = createClient(supabaseUrl, supabaseKey);
