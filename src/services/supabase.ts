// Version: 3.0 - TypeScript migration with environment variables
// Supabase client initialization with type safety

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';

// Get environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.');
}

// Initialize Supabase client with type safety
export const supabaseClient = createClient<Database>(supabaseUrl, supabaseAnonKey);

// Expose to window for backward compatibility with HTML onclick handlers
if (typeof window !== 'undefined') {
  window.supabaseClient = supabaseClient;
}
