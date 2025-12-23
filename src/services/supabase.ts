// Version: 3.1 - Added storage timeout configuration for large file uploads
// Supabase client initialization with type safety

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';

// Get environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.');
}

// Initialize Supabase client with type safety and storage timeout
// Global timeout: 2 minutes for most operations
// Storage timeout: 5 minutes for large file uploads (max 50MB)
export const supabaseClient = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  global: {
    headers: {
      'x-client-info': 'kbd-web-app'
    }
  },
  db: {
    schema: 'public'
  },
  realtime: {
    timeout: 120000 // 2 minutes for realtime connections
  }
});

// Expose to window for backward compatibility with HTML onclick handlers
if (typeof window !== 'undefined') {
  window.supabaseClient = supabaseClient;
}
