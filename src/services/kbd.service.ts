// Version: 3.2 - Fixed checkInData missing check_in_date and slot_type fields
// KBD business logic service with type safety

import { supabaseClient } from './supabase';
import type { Task, Restaurant, SlotType, CheckInRecord } from '@/types/models';

export class KBDService {
  // Task cache: { restaurantId_slotType_date: task }
  private static _taskCache: Map<string, Task | null> = new Map();

  /**
   * Get today's task for a specific restaurant and slot
   * Priority: 1. Temporary tasks, 2. Fixed routine tasks, 3. Weighted random routine tasks
   */
  static async getTodayTask(restaurantId: string, slotType: SlotType): Promise<Task | null> {
    try {
      const today = new Date().toISOString().split('T')[0]!;
      const weekday = new Date().getDay() || 7;
      const cacheKey = `${restaurantId}_${slotType}_${today}`;

      // Check cache
      if (this._taskCache.has(cacheKey)) {
        console.log('[KBDService] Task cache hit:', cacheKey);
        return this._taskCache.get(cacheKey) || null;
      }

      // Timeout wrapper for queries (10 seconds max)
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Task query timeout')), 10000)
      );

      // Parallel queries: restaurant + all tasks at once
      const queryPromise = Promise.all([
        supabaseClient.from('master_restaurant').select('brand_id').eq('id', restaurantId).single(),
        supabaseClient.from('kbd_task_pool').select('*').eq('is_routine', false).eq('is_announced', true).eq('is_active', true).eq('execute_date', today).eq('execute_slot', slotType!),
        supabaseClient.from('kbd_task_pool').select('*').eq('is_routine', true).eq('is_active', true).contains('fixed_weekdays', [weekday]).contains('fixed_slots', [slotType!]),
        supabaseClient.from('kbd_task_pool').select('*').eq('is_routine', true).eq('is_active', true).contains('applicable_slots', [slotType!])
      ]);

      const [restaurantResult, adhocResult, fixedResult, routineResult] = await Promise.race([
        queryPromise,
        timeoutPromise
      ]);

      const restaurantData = restaurantResult.data as { brand_id: number } | null;
      if (!restaurantData) throw new Error('Restaurant not found');

      // Priority 1: Temporary tasks (adhoc)
      const adhocTask = (adhocResult.data as any[] | null)?.find((task: any) =>
        (task.brand_id === null || task.brand_id === restaurantData.brand_id) &&
        (task.restaurant_id === null || task.restaurant_id === restaurantId)
      ) as Task | undefined;

      if (adhocTask) {
        this._taskCache.set(cacheKey, adhocTask);
        return adhocTask;
      }

      // Priority 2: Fixed routine tasks
      const fixedTask = (fixedResult.data as any[] | null)?.find((task: any) =>
        task.brand_id === null || task.brand_id === restaurantData.brand_id
      ) as Task | undefined;

      if (fixedTask) {
        this._taskCache.set(cacheKey, fixedTask);
        return fixedTask;
      }

      // Priority 3: Random routine task (weighted)
      const filteredRoutineTasks = ((routineResult.data as any[] | null)?.filter((task: any) =>
        task.brand_id === null || task.brand_id === restaurantData.brand_id
      ) || []) as Task[];

      if (filteredRoutineTasks.length > 0) {
        const totalWeight = filteredRoutineTasks.reduce((sum, task) => sum + (task.weight || 100), 0);
        let random = Math.random() * totalWeight;

        for (const task of filteredRoutineTasks) {
          random -= (task.weight || 100);
          if (random <= 0) {
            this._taskCache.set(cacheKey, task);
            return task;
          }
        }

        const fallbackTask = filteredRoutineTasks[0];
        this._taskCache.set(cacheKey, fallbackTask ?? null);
        return fallbackTask ?? null;
      }

      this._taskCache.set(cacheKey, null);
      return null;
    } catch (error) {
      console.error('[KBDService] Error getting today task:', error);
      throw error;
    }
  }

  /**
   * Preload tasks for all slots to improve perceived performance
   */
  static async preloadTasksForAllSlots(restaurantId: string): Promise<void> {
    const slots: SlotType[] = ['lunch_open', 'lunch_close', 'dinner_open', 'dinner_close'];
    console.log('[KBDService] Preloading tasks for all slots:', slots);

    await Promise.all(slots.map(slot => this.getTodayTask(restaurantId, slot)));
    console.log('[KBDService] Task preload complete');
  }

  /**
   * Clear task cache (useful after check-in or when data changes)
   */
  static clearTaskCache(): void {
    console.log('[KBDService] Clearing task cache');
    this._taskCache.clear();
  }

  /**
   * Submit check-in record
   */
  static async submitCheckIn(data: Partial<CheckInRecord>): Promise<{ success: boolean; record?: CheckInRecord; error?: string }> {
    try {
      const { data: record, error } = await supabaseClient
        .from('kbd_check_in_record')
        .insert([{
          restaurant_id: data.restaurant_id!,
          employee_id: data.employee_id!,
          task_id: data.task_id!,
          check_in_date: data.check_in_date!,
          slot_type: data.slot_type!,
          check_in_at: new Date().toISOString(),
          is_late: data.is_late || false,
          text_content: data.text_content || null,
          media_urls: data.media_urls || []
        }] as any)
        .select()
        .single();

      if (error) throw error;

      console.log('[KBDService] Check-in submitted successfully');
      return { success: true, record: record as unknown as CheckInRecord };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[KBDService] Check-in error:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get all restaurants with check-in status for today
   */
  static async getRestaurantsWithStatus(slotType: SlotType, displayMode: boolean = false): Promise<Restaurant[]> {
    try {
      const today = new Date().toISOString().split('T')[0]!;

      // Get all restaurants
      const { data: restaurants, error: restaurantError } = await supabaseClient
        .from('master_restaurant')
        .select('*')
        .eq('is_active', true);

      if (restaurantError) throw restaurantError;

      const restaurantList = (restaurants || []) as any[];

      // Get all employees for these restaurants (only managers/store managers)
      const { data: employees, error: employeeError } = await supabaseClient
        .from('master_employee')
        .select('id, employee_name, restaurant_id, profile_photo_url')
        .in('restaurant_id', restaurantList.map((r: any) => r.id))
        .eq('role_code', 'manager');

      if (employeeError) throw employeeError;

      const employeeList = (employees || []) as any[];

      // Get all check-in records for today
      const { data: checkIns, error: checkInError } = await supabaseClient
        .from('kbd_check_in_record')
        .select('restaurant_id, media_urls, check_in_date, slot_type')
        .eq('check_in_date', today)
        .eq('slot_type', slotType!);

      if (checkInError) {
        // If no check-ins found, that's okay
        console.log('[KBDService] No check-ins found for today:', checkInError);
      }

      const checkInList = (checkIns || []) as any[];

      // Group employees by restaurant
      const employeeMap = new Map();
      employeeList.forEach((emp: any) => {
        if (!employeeMap.has(emp.restaurant_id)) {
          employeeMap.set(emp.restaurant_id, []);
        }
        employeeMap.get(emp.restaurant_id)!.push(emp);
      });

      // Combine data
      const checkInMap = new Map(checkInList.map((c: any) => [c.restaurant_id, c]));

      return restaurantList.map((r: any) => ({
        ...r,
        master_employee: employeeMap.get(r.id) || [],
        checked: displayMode ? true : checkInMap.has(r.id), // In display mode, show all as checked
        checkInData: checkInMap.get(r.id),
        displayMode: displayMode // Flag to indicate display mode
      })) as Restaurant[];
    } catch (error) {
      console.error('[KBDService] Error getting restaurants:', error);
      throw error;
    }
  }

  /**
   * Get current time slot based on time window configuration
   * @param brandId - Brand ID to check time slots for
   * @param customTime - Optional custom time (for dev/testing), if null uses current time
   */
  static async getCurrentTimeSlot(brandId: number, customTime: Date | null = null): Promise<SlotType | null> {
    try {
      const now = customTime || new Date();
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;

      // Get time slot configurations for this brand
      const { data: configs, error } = await supabaseClient
        .from('kbd_time_slot_config')
        .select('*')
        .eq('brand_id', brandId)
        .is('restaurant_id', null)
        .eq('is_active', true);

      if (error) throw error;
      if (!configs || configs.length === 0) return null;

      const configList = configs as any[];

      // Check each config to see if current time is within window
      for (const config of configList) {
        const start = config.window_start;
        const end = config.window_end;

        // Handle midnight crossing (e.g., 21:30:00 - 01:00:00)
        if (end < start) {
          // Window crosses midnight
          if (currentTime >= start || currentTime <= end) {
            return config.slot_type as SlotType;
          }
        } else {
          // Normal window
          if (currentTime >= start && currentTime <= end) {
            return config.slot_type as SlotType;
          }
        }
      }

      return null; // Not in any time window
    } catch (error) {
      console.error('[KBDService] Error getting current time slot:', error);
      return null;
    }
  }

  /**
   * Get previous time slot (for display when outside check-in window)
   */
  static getPreviousTimeSlot(currentTime: string | null = null): SlotType {
    if (!currentTime) {
      const now = new Date();
      currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
    }

    // Approximate time boundaries (actual boundaries from config, but this is for fallback)
    const slotBoundaries = {
      'lunch_open': '11:30:00',
      'lunch_close': '15:30:00',
      'dinner_open': '17:30:00',
      'dinner_close': '01:00:00'
    };

    // If before lunch_open, show dinner_close from yesterday
    if (currentTime < slotBoundaries.lunch_open) {
      return 'dinner_close';
    }
    // If between lunch_open and lunch_close, show lunch_open
    if (currentTime < slotBoundaries.lunch_close) {
      return 'lunch_open';
    }
    // If between lunch_close and dinner_open, show lunch_close
    if (currentTime < slotBoundaries.dinner_open) {
      return 'lunch_close';
    }
    // If between dinner_open and dinner_close, show dinner_open
    if (currentTime < slotBoundaries.dinner_close) {
      return 'dinner_open';
    }
    // After dinner_close (late night), show dinner_close
    return 'dinner_close';
  }

  /**
   * Upload media to Supabase Storage
   */
  static async uploadMedia(file: File, restaurantId: string, slotType: SlotType, employeeId: string): Promise<string> {
    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const date = String(now.getDate()).padStart(2, '0');
      const timestamp = now.getTime();

      const ext = file.name.split('.').pop();
      const mediaType = file.type.startsWith('image/') ? 'image' :
                       file.type.startsWith('video/') ? 'video' : 'voice';

      // Get brand_id
      const { data: restaurant } = await supabaseClient
        .from('master_restaurant')
        .select('brand_id')
        .eq('id', restaurantId)
        .single();

      const restaurantData = restaurant as { brand_id: number } | null;
      if (!restaurantData) throw new Error('Restaurant not found');

      const path = `${restaurantData.brand_id}/${restaurantId}/${year}/${month}/${date}/${slotType}/${mediaType}/${employeeId}_${timestamp}.${ext}`;

      const { error } = await supabaseClient.storage
        .from('KBD')
        .upload(path, file);

      if (error) throw error;

      // Get public URL
      const { data: { publicUrl } } = supabaseClient.storage
        .from('KBD')
        .getPublicUrl(path);

      console.log('[KBDService] Media uploaded:', publicUrl);
      return publicUrl;
    } catch (error) {
      console.error('[KBDService] Upload error:', error);
      throw error;
    }
  }

  /**
   * Get check-in history for a restaurant with pagination
   * Returns records with task information
   */
  static async getCheckInHistory(
    restaurantId: string,
    limit: number = 10,
    offset: number = 0
  ): Promise<{
    records: Array<CheckInRecord & { task?: Task }>;
    hasMore: boolean;
  }> {
    try {
      console.log('[KBDService] Fetching check-in history:', { restaurantId, limit, offset });

      // Fetch records with pagination
      const { data: records, error } = await supabaseClient
        .from('kbd_check_in_record')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('check_in_at', { ascending: false })
        .range(offset, offset + limit); // limit + 1 to check if there are more records

      if (error) throw error;

      const recordList = (records || []) as CheckInRecord[];
      console.log('[KBDService] Fetched', recordList.length, 'records');

      // Check if there are more records
      const hasMore = recordList.length > limit;
      const actualRecords = hasMore ? recordList.slice(0, limit) : recordList;

      // Get task details for each record
      const taskIds = [...new Set(actualRecords.map(r => r.task_id))];
      const { data: tasks } = await supabaseClient
        .from('kbd_task_pool')
        .select('id, task_name, task_description, media_type')
        .in('id', taskIds);

      const taskMap = new Map((tasks || []).map((t: any) => [t.id, t as Task]));

      // Combine records with task info
      const enrichedRecords = actualRecords.map(record => ({
        ...record,
        task: taskMap.get(record.task_id)
      }));

      return {
        records: enrichedRecords,
        hasMore
      };
    } catch (error) {
      console.error('[KBDService] Error fetching history:', error);
      throw error;
    }
  }
}

// Expose to window for backward compatibility with HTML onclick handlers
if (typeof window !== 'undefined') {
  window.KBDService = KBDService;
}
