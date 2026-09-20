import { config } from './config.js';

// @supabase/supabase-js v2.116+ checks for WebSocket even when Realtime is unused.
// Provide defensive polyfill if running on older Node without native WebSocket.
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class NoopWebSocket {};
}

const { createClient } = await import('@supabase/supabase-js');

export const db = createClient(config.supabaseUrl || 'http://localhost', config.supabaseKey || 'missing', {
  auth: { persistSession: false },
});

export function must({ data, error }) {
  if (error) throw new Error(`DB: ${error.message}`);
  return data;
}
