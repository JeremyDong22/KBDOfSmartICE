// Version: 4.6 - Cache enriched records with task info to eliminate task lookup query
// KBD business logic service with type safety

import { supabaseClient } from './supabase';
import { CacheService } from './cache.service';
import { selectDailyTask } from '@/utils/seeded-random';
import type { Task, Restaurant, SlotType, CheckInRecord } from '@/types/models';

export class KBDService {
  // In-memory cache for brand_id lookups (restaurant_id -> brand_id)
  private static brandIdCache: Map<string, number> = new Map();

  /**
   * Get brand_id for a restaurant (cached)
   * Public method to allow external components to pre-seed the cache
   */
  static async getBrandId(restaurantId: string): Promise<number> {
    // Check in-memory cache first
    const cached = this.brandIdCache.get(restaurantId);
    if (cached !== undefined) {
      return cached;
    }

    // Query database
    const { data: restaurantData } = await supabaseClient
      .from('master_restaurant')
      .select('brand_id')
      .eq('id', restaurantId)
      .single();

    if (!restaurantData) throw new Error('Restaurant not found');
    const brandId = (restaurantData as { brand_id: number }).brand_id;

    // Cache for future use
    this.brandIdCache.set(restaurantId, brandId);
    return brandId;
  }

  /**
   * Pre-seed brand_id cache (used by AppModule to avoid duplicate queries)
   */
  static setBrandIdCache(restaurantId: string, brandId: number): void {
    this.brandIdCache.set(restaurantId, brandId);
  }
  /**
   * Get today's task for a specific restaurant and slot
   * Uses IndexedDB cache and seeded random for consistency across clients
   * Priority: 1. Temporary tasks, 2. Fixed routine tasks, 3. Weighted random routine tasks
   * @param customTime - Optional custom time (for dev/testing), if null uses current time
   */
  static async getTodayTask(restaurantId: string, slotType: SlotType, customTime: Date | null = null): Promise<Task | null> {
    try {
      const now = customTime || new Date();
      const today = now.toISOString().split('T')[0]!;
      const weekday = now.getDay();

      // 1. Get restaurant's brand_id (uses in-memory cache)
      const brandId = await this.getBrandId(restaurantId);

      // 2. Check IndexedDB cache
      const cachedTask = await CacheService.getDailyTask(today, brandId, slotType);
      if (cachedTask) {
        return cachedTask;
      }

      // 3. Cache miss - query database

      // Check temporary tasks (is_announced=true, execute_date=today)
      const { data: adhocTasks } = await supabaseClient
        .from('kbd_task_pool')
        .select('*')
        .eq('is_routine', false)
        .eq('is_announced', true)
        .eq('is_active', true)
        .eq('execute_date', today)
        .eq('execute_slot', slotType);

      const adhocTask = (adhocTasks || []).find((task: any) =>
        (task.brand_id === null || task.brand_id === brandId) &&
        (task.restaurant_id === null || task.restaurant_id === restaurantId)
      ) as Task | undefined;

      if (adhocTask) {
        await CacheService.setDailyTask(today, brandId, slotType, adhocTask);
        return adhocTask;
      }

      // Check fixed routine tasks (fixed_weekdays + fixed_slots match)
      const { data: fixedTasks } = await supabaseClient
        .from('kbd_task_pool')
        .select('*')
        .eq('is_routine', true)
        .eq('is_active', true)
        .contains('fixed_weekdays', [weekday])
        .contains('fixed_slots', [slotType]);

      const fixedTask = (fixedTasks || []).find((task: any) =>
        task.brand_id === null || task.brand_id === brandId
      ) as Task | undefined;

      if (fixedTask) {
        await CacheService.setDailyTask(today, brandId, slotType, fixedTask);
        return fixedTask;
      }

      // Seeded random selection from routine tasks
      const { data: routineTasks } = await supabaseClient
        .from('kbd_task_pool')
        .select('*')
        .eq('is_routine', true)
        .eq('is_active', true)
        .contains('applicable_slots', [slotType]);

      const filteredRoutineTasks = (routineTasks || []).filter((task: any) =>
        task.brand_id === null || task.brand_id === brandId
      ) as Task[];

      if (filteredRoutineTasks.length > 0) {
        // Use seeded random to ensure all clients get the same task
        const selectedTask = selectDailyTask(
          filteredRoutineTasks.map(t => ({ ...t, weight: t.weight || 100 })),
          today,
          brandId,
          slotType
        );

        if (selectedTask) {
          await CacheService.setDailyTask(today, brandId, slotType, selectedTask as Task);
          return selectedTask as Task;
        }
      }

      return null;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Preload tasks for all slots to improve perceived performance
   * Tasks will be cached in IndexedDB automatically
   */
  static async preloadTasksForAllSlots(restaurantId: string): Promise<void> {
    const slots: SlotType[] = ['lunch_open', 'lunch_close', 'dinner_open', 'dinner_close'];

    await Promise.all(slots.map(slot => this.getTodayTask(restaurantId, slot)));
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

      return { success: true, record: record as unknown as CheckInRecord };
    } catch (error) {
      // Handle Supabase errors (they have message property but aren't Error instances)
      const errorMessage = error instanceof Error
        ? error.message
        : (error as any)?.message || (error as any)?.code || JSON.stringify(error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get all restaurants with check-in status for today
   * Uses cache-first strategy for base restaurant data, fresh query for check-in status
   * @param slotType - Slot type to check status for
   * @param displayMode - If true, show all restaurants as checked (for display outside time window)
   * @param customTime - Optional custom time (for dev/testing), if null uses current time
   */
  static async getRestaurantsWithStatus(slotType: SlotType, displayMode: boolean = false, customTime: Date | null = null): Promise<Restaurant[]> {
    const funcStart = performance.now();
    try {
      const now = customTime || new Date();
      const today = now.toISOString().split('T')[0]!;

      // 1. Try to get restaurants from cache first (valid for 1 hour)
      let restaurantList: any[] = [];
      const cacheCheckStart = performance.now();
      const cacheValid = await CacheService.isRestaurantsCacheValid(60 * 60 * 1000); // 1 hour

      if (cacheValid) {
        const cacheReadStart = performance.now();
        restaurantList = await CacheService.getRestaurants() as any[];
      } else {
        // Get all restaurants from database
        const { data: restaurants, error: restaurantError } = await supabaseClient
          .from('master_restaurant')
          .select('*')
          .eq('is_active', true);

        if (restaurantError) throw restaurantError;
        restaurantList = (restaurants || []) as any[];

        // Get all employees for these restaurants (only managers/store managers)
        const { data: employees, error: employeeError } = await supabaseClient
          .from('master_employee')
          .select('id, employee_name, restaurant_id, profile_photo_url')
          .in('restaurant_id', restaurantList.map((r: any) => r.id))
          .eq('role_code', 'manager');

        if (employeeError) throw employeeError;

        const employeeList = (employees || []) as any[];

        // Group employees by restaurant
        const employeeMap = new Map();
        employeeList.forEach((emp: any) => {
          if (!employeeMap.has(emp.restaurant_id)) {
            employeeMap.set(emp.restaurant_id, []);
          }
          employeeMap.get(emp.restaurant_id)!.push(emp);
        });

        // Attach employees to restaurants for caching
        restaurantList = restaurantList.map((r: any) => ({
          ...r,
          master_employee: employeeMap.get(r.id) || []
        }));

        // Cache the restaurant base data
        await CacheService.setRestaurants(restaurantList as Restaurant[]);
      }

      // 2. Always query fresh check-in records for today's slot
      const checkInQueryStart = performance.now();
      const { data: checkIns, error: checkInError } = await supabaseClient
        .from('kbd_check_in_record')
        .select('restaurant_id, media_urls, check_in_date, slot_type, text_content')
        .eq('check_in_date', today)
        .eq('slot_type', slotType!);

      if (checkInError) {
        // If no check-ins found, that's okay
      }

      const checkInList = (checkIns || []) as any[];

      // 3. Combine cached restaurants with fresh check-in status
      const checkInMap = new Map(checkInList.map((c: any) => [c.restaurant_id, c]));

      const result = restaurantList.map((r: any) => ({
        ...r,
        checked: displayMode ? false : checkInMap.has(r.id), // In display mode, show all as NOT checked (white)
        checkInData: checkInMap.get(r.id),
        displayMode: displayMode // Flag to indicate display mode
      })) as Restaurant[];

      return result;
    } catch (error) {
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

      // Get brand_id (uses in-memory cache)
      const brandId = await this.getBrandId(restaurantId);

      const path = `${brandId}/${restaurantId}/${year}/${month}/${date}/${slotType}/${mediaType}/${employeeId}_${timestamp}.${ext}`;

      const { error } = await supabaseClient.storage
        .from('KBD')
        .upload(path, file);

      if (error) throw error;

      // Get public URL
      const { data: { publicUrl } } = supabaseClient.storage
        .from('KBD')
        .getPublicUrl(path);

      return publicUrl;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get check-in history for a restaurant with pagination
   * Uses cache-first strategy for first page (10 records)
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
    const historyStart = performance.now();
    try {

      // For first page (offset=0, limit<=10), try cache first
      if (offset === 0 && limit <= 10) {
        const cacheCheckStart = performance.now();
        const cachedRecords = await CacheService.getCheckInRecords(restaurantId);

        if (cachedRecords.length > 0) {

          // Check if cached records already have task info embedded
          const firstRecord = cachedRecords[0] as any;
          if (firstRecord?.task) {
            // Cached records already have task info, use directly
            const enrichedRecords = cachedRecords.slice(0, limit) as Array<CheckInRecord & { task?: Task }>;

            const totalTime = performance.now() - historyStart;

            return {
              records: enrichedRecords,
              hasMore: cachedRecords.length > limit
            };
          }

          // Legacy cache without task info - need to lookup tasks
          const taskQueryStart = performance.now();
          const taskIds = [...new Set(cachedRecords.map(r => r.task_id))];
          const { data: tasks } = await supabaseClient
            .from('kbd_task_pool')
            .select('id, task_name, task_description, media_type')
            .in('id', taskIds);

          const taskMap = new Map((tasks || []).map((t: any) => [t.id, t as Task]));

          const enrichedRecords = cachedRecords.slice(0, limit).map(record => ({
            ...record,
            task: taskMap.get(record.task_id)
          }));

          // Update cache with enriched records (so next load is instant)
          await CacheService.setCheckInRecords(restaurantId, enrichedRecords as any);

          const totalTime = performance.now() - historyStart;

          return {
            records: enrichedRecords,
            hasMore: cachedRecords.length > limit
          };
        }
      } else {
      }

      // Cache miss or pagination - query database
      const dbQueryStart = performance.now();
      const { data: records, error } = await supabaseClient
        .from('kbd_check_in_record')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('check_in_at', { ascending: false })
        .range(offset, offset + limit); // limit + 1 to check if there are more records

      if (error) throw error;

      const recordList = (records || []) as CheckInRecord[];

      // Check if there are more records
      const hasMore = recordList.length > limit;
      const actualRecords = hasMore ? recordList.slice(0, limit) : recordList;

      // Get task details for each record FIRST (before caching)
      const taskQueryStart = performance.now();
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

      // Cache first page results WITH task info embedded
      if (offset === 0 && enrichedRecords.length > 0) {
        const cacheStoreStart = performance.now();
        await CacheService.setCheckInRecords(restaurantId, enrichedRecords as any);
      }

      const totalTime = performance.now() - historyStart;

      return {
        records: enrichedRecords,
        hasMore
      };
    } catch (error) {
      throw error;
    }
  }
}

// Expose to window for backward compatibility with HTML onclick handlers
if (typeof window !== 'undefined') {
  window.KBDService = KBDService;
}
