// Version: 1.0 - Supabase database type definitions
// This file can be auto-generated using: npm run generate-types
// For now, we use a basic placeholder structure

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      master_employee: {
        Row: {
          id: string
          username: string
          password_hash: string
          employee_name: string
          restaurant_id: string
          role_code: string
          is_active: boolean
          is_locked: boolean
          login_failed_count: number
          profile_photo_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['master_employee']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['master_employee']['Insert']>
      }
      master_restaurant: {
        Row: {
          id: string
          restaurant_name: string
          brand_id: number
          latitude: number
          longitude: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['master_restaurant']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['master_restaurant']['Insert']>
      }
      kbd_task_pool: {
        Row: {
          id: string
          brand_id: number | null
          restaurant_id: string | null
          task_name: string
          task_description: string
          media_type: string
          applicable_slots: string[]
          is_routine: boolean
          weight: number
          fixed_weekdays: number[] | null
          fixed_slots: string[] | null
          execute_date: string | null
          execute_slot: string | null
          is_announced: boolean
          announced_at: string | null
          is_active: boolean
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['kbd_task_pool']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['kbd_task_pool']['Insert']>
      }
      kbd_check_in_record: {
        Row: {
          id: string
          restaurant_id: string
          employee_id: string
          task_id: string
          check_in_date: string
          slot_type: string
          check_in_at: string
          is_late: boolean
          text_content: string | null
          media_urls: string[] | null
          remark: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['kbd_check_in_record']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['kbd_check_in_record']['Insert']>
      }
      master_brand: {
        Row: {
          id: number
          code: string
          name: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['master_brand']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['master_brand']['Insert']>
      }
      kbd_time_slot_config: {
        Row: {
          id: string
          brand_id: number
          restaurant_id: string | null
          slot_type: string
          window_start: string
          window_end: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['kbd_time_slot_config']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['kbd_time_slot_config']['Insert']>
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
