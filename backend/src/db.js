import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

export const db = createClient(config.supabaseUrl || 'http://localhost', config.supabaseKey || 'missing', {
  auth: { persistSession: false },
});

export function must({ data, error }) {
  if (error) throw new Error(`DB: ${error.message}`);
  return data;
}
