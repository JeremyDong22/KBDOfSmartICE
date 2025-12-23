// Version: 1.1 - Added brand_id to Employee for login-time caching
// Core type definitions for KBD system

export type SlotType = 'lunch_open' | 'lunch_close' | 'dinner_open' | 'dinner_close';

export type MediaType = 'notification' | 'text' | 'image' | 'voice' | 'video';

export interface Restaurant {
  id: string;
  restaurant_name: string;
  brand_id: number;
  latitude: number;
  longitude: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;

  // Extended fields (populated by joins or client logic)
  master_employee?: Employee[];
  checked?: boolean;
  checkInData?: CheckInRecord | null;
  displayMode?: boolean;
}

export interface Employee {
  id: string;
  username: string;
  password_hash: string;
  employee_name: string;
  restaurant_id: string;
  role_code: string;
  is_active: boolean;
  is_locked: boolean;
  login_failed_count: number;
  profile_photo_url: string | null;
  brand_id?: number; // Cached from master_restaurant at login
  created_at?: string;
  updated_at?: string;
}

export interface Task {
  id: string;
  brand_id: number | null;
  restaurant_id: string | null;
  task_name: string;
  task_description: string;
  media_type: MediaType;
  applicable_slots: SlotType[];
  is_routine: boolean;
  weight: number;
  fixed_weekdays: number[] | null;
  fixed_slots: SlotType[] | null;
  execute_date: string | null;
  execute_slot: SlotType | null;
  is_announced: boolean;
  announced_at: string | null;
  is_active: boolean;
  created_by: string;
  created_at?: string;
  updated_at?: string;
}

export interface CheckInRecord {
  id: string;
  restaurant_id: string;
  employee_id: string;
  task_id: string;
  check_in_date: string;
  slot_type: SlotType;
  check_in_at: string;
  is_late: boolean;
  text_content: string | null;
  media_urls: string[] | null;
  remark: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Brand {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface TimeSlotConfig {
  id: string;
  brand_id: number;
  restaurant_id: string | null;
  slot_type: SlotType;
  window_start: string;
  window_end: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

// API Response types
export interface LoginResponse {
  success: boolean;
  user?: Employee;
  error?: string;
}

export interface TimeSlotDetectionResult {
  currentSlotType: SlotType | null;
  isInTimeWindow: boolean;
  config?: TimeSlotConfig;
}
