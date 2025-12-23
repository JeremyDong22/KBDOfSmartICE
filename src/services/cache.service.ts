// Version: 1.1 - Fixed time_slot_config key type mismatch (number vs string)
// IndexedDB cache service for KBD application
// Provides persistent caching for restaurants, employees, tasks, check-in records, time configs, and avatars

import type { Restaurant, Employee, Task, CheckInRecord, TimeSlotConfig } from '@/types/models';

const DB_NAME = 'KBDCache';
const DB_VERSION = 1;

// Store names
const STORES = {
  RESTAURANTS: 'restaurants',
  EMPLOYEES: 'employees',
  TASKS: 'tasks',
  DAILY_TASKS: 'daily_tasks',
  CHECK_IN_RECORDS: 'check_in_records',
  TIME_SLOT_CONFIG: 'time_slot_config',
  AVATARS: 'avatars'
} as const;

interface CachedRestaurant extends Restaurant {
  _cached_at: number;
}

interface CachedEmployee extends Employee {
  _cached_at: number;
}

interface DailyTaskCache {
  key: string; // Format: ${date}_${brandId}_${slotType}
  date: string;
  brand_id: number;
  slot_type: string;
  task: Task;
  cached_at: number;
}

interface CheckInRecordsCache {
  restaurant_id: string;
  records: CheckInRecord[];
  last_updated: number;
}

interface TimeSlotConfigCache {
  brand_id: number;
  config: TimeSlotConfig[];
  cached_at: number;
}

interface AvatarCache {
  employee_id: string;
  blob: Blob;
  checked_date: string; // Format: YYYY-MM-DD
  cached_at: number;
}

class CacheService {
  private static db: IDBDatabase | null = null;
  private static initPromise: Promise<void> | null = null;

  /**
   * Initialize IndexedDB database and create object stores
   */
  static async init(): Promise<void> {
    // Return existing initialization promise if already in progress
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise<void>((resolve, reject) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
          console.error('[CacheService] Failed to open IndexedDB:', request.error);
          reject(request.error);
        };

        request.onsuccess = () => {
          this.db = request.result;
          console.log('[CacheService] IndexedDB initialized successfully');
          resolve();
        };

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          console.log('[CacheService] Upgrading database schema...');

          // Create restaurants store
          if (!db.objectStoreNames.contains(STORES.RESTAURANTS)) {
            db.createObjectStore(STORES.RESTAURANTS, { keyPath: 'id' });
          }

          // Create employees store
          if (!db.objectStoreNames.contains(STORES.EMPLOYEES)) {
            db.createObjectStore(STORES.EMPLOYEES, { keyPath: 'id' });
          }

          // Create tasks store (permanent cache)
          if (!db.objectStoreNames.contains(STORES.TASKS)) {
            db.createObjectStore(STORES.TASKS, { keyPath: 'id' });
          }

          // Create daily_tasks store (composite key: date_brand_slot)
          if (!db.objectStoreNames.contains(STORES.DAILY_TASKS)) {
            db.createObjectStore(STORES.DAILY_TASKS, { keyPath: 'key' });
          }

          // Create check_in_records store
          if (!db.objectStoreNames.contains(STORES.CHECK_IN_RECORDS)) {
            db.createObjectStore(STORES.CHECK_IN_RECORDS, { keyPath: 'restaurant_id' });
          }

          // Create time_slot_config store
          if (!db.objectStoreNames.contains(STORES.TIME_SLOT_CONFIG)) {
            db.createObjectStore(STORES.TIME_SLOT_CONFIG, { keyPath: 'brand_id' });
          }

          // Create avatars store
          if (!db.objectStoreNames.contains(STORES.AVATARS)) {
            db.createObjectStore(STORES.AVATARS, { keyPath: 'employee_id' });
          }

          console.log('[CacheService] Database schema upgraded');
        };
      } catch (error) {
        console.error('[CacheService] Failed to initialize:', error);
        reject(error);
      }
    });

    return this.initPromise;
  }

  /**
   * Ensure database is initialized before operations
   */
  private static async ensureDB(): Promise<IDBDatabase> {
    if (!this.db) {
      await this.init();
    }
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  /**
   * Generic get method for any store
   */
  static async get<T>(storeName: string, key: string): Promise<T | null> {
    try {
      const db = await this.ensureDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(key);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error(`[CacheService] Failed to get from ${storeName}:`, error);
      return null;
    }
  }

  /**
   * Generic set method for any store
   */
  static async set(storeName: string, key: string, value: any): Promise<void> {
    try {
      const db = await this.ensureDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.put(value);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error(`[CacheService] Failed to set in ${storeName}:`, error);
      throw error;
    }
  }

  /**
   * Generic getAll method for any store
   */
  static async getAll<T>(storeName: string): Promise<T[]> {
    try {
      const db = await this.ensureDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error(`[CacheService] Failed to getAll from ${storeName}:`, error);
      return [];
    }
  }

  /**
   * Generic delete method for any store
   */
  static async delete(storeName: string, key: string): Promise<void> {
    try {
      const db = await this.ensureDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.delete(key);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error(`[CacheService] Failed to delete from ${storeName}:`, error);
      throw error;
    }
  }

  /**
   * Generic clear method for any store
   */
  static async clear(storeName: string): Promise<void> {
    try {
      const db = await this.ensureDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error(`[CacheService] Failed to clear ${storeName}:`, error);
      throw error;
    }
  }

  // ==================== Restaurant Cache ====================

  /**
   * Get all cached restaurants
   */
  static async getRestaurants(): Promise<Restaurant[]> {
    try {
      console.log('[CACHE] 🔍 CHECKING: restaurants');
      const cached = await this.getAll<CachedRestaurant>(STORES.RESTAURANTS);
      if (cached.length > 0) {
        const age = Date.now() - cached[0]!._cached_at;
        console.log(`[CACHE] ✅ HIT: restaurants (${cached.length} items, age: ${Math.round(age/1000)}s)`);
      } else {
        console.log('[CACHE] ❌ MISS: restaurants (empty)');
      }
      // Remove _cached_at metadata before returning
      return cached.map(({ _cached_at, ...restaurant }) => restaurant);
    } catch (error) {
      console.error('[CacheService] Failed to get restaurants:', error);
      return [];
    }
  }

  /**
   * Cache restaurants with timestamp
   */
  static async setRestaurants(restaurants: Restaurant[]): Promise<void> {
    try {
      console.log(`[CACHE] 💾 STORING: restaurants (${restaurants.length} items)`);
      const db = await this.ensureDB();
      const transaction = db.transaction(STORES.RESTAURANTS, 'readwrite');
      const store = transaction.objectStore(STORES.RESTAURANTS);

      // Clear existing data first
      await store.clear();

      // Add new data with timestamp
      const timestamp = Date.now();
      for (const restaurant of restaurants) {
        const cached: CachedRestaurant = { ...restaurant, _cached_at: timestamp };
        await store.put(cached);
      }

      console.log(`[CacheService] Cached ${restaurants.length} restaurants`);
    } catch (error) {
      console.error('[CacheService] Failed to set restaurants:', error);
      throw error;
    }
  }

  /**
   * Check if restaurant cache is valid (not expired)
   */
  static async isRestaurantsCacheValid(maxAgeMs: number): Promise<boolean> {
    try {
      const cached = await this.getAll<CachedRestaurant>(STORES.RESTAURANTS);
      if (cached.length === 0) {
        return false;
      }

      const now = Date.now();
      const oldest = cached[0]!._cached_at;
      const age = now - oldest;

      return age < maxAgeMs;
    } catch (error) {
      console.error('[CacheService] Failed to check restaurant cache validity:', error);
      return false;
    }
  }

  // ==================== Employee Cache ====================

  /**
   * Get all cached employees
   */
  static async getEmployees(): Promise<Employee[]> {
    try {
      console.log('[CACHE] 🔍 CHECKING: employees');
      const cached = await this.getAll<CachedEmployee>(STORES.EMPLOYEES);
      if (cached.length > 0) {
        const age = Date.now() - cached[0]!._cached_at;
        console.log(`[CACHE] ✅ HIT: employees (${cached.length} items, age: ${Math.round(age/1000)}s)`);
      } else {
        console.log('[CACHE] ❌ MISS: employees (empty)');
      }
      // Remove _cached_at metadata before returning
      return cached.map(({ _cached_at, ...employee }) => employee);
    } catch (error) {
      console.error('[CacheService] Failed to get employees:', error);
      return [];
    }
  }

  /**
   * Cache employees with timestamp
   */
  static async setEmployees(employees: Employee[]): Promise<void> {
    try {
      console.log(`[CACHE] 💾 STORING: employees (${employees.length} items)`);
      const db = await this.ensureDB();
      const transaction = db.transaction(STORES.EMPLOYEES, 'readwrite');
      const store = transaction.objectStore(STORES.EMPLOYEES);

      // Clear existing data first
      await store.clear();

      // Add new data with timestamp
      const timestamp = Date.now();
      for (const employee of employees) {
        const cached: CachedEmployee = { ...employee, _cached_at: timestamp };
        await store.put(cached);
      }

      console.log(`[CacheService] Cached ${employees.length} employees`);
    } catch (error) {
      console.error('[CacheService] Failed to set employees:', error);
      throw error;
    }
  }

  // ==================== Task Cache ====================

  /**
   * Get cached daily task for specific date, brand, and slot
   */
  static async getDailyTask(date: string, brandId: number, slotType: string): Promise<Task | null> {
    try {
      const key = `${date}_${brandId}_${slotType}`;
      console.log(`[CACHE] 🔍 CHECKING: daily_task (key: ${key})`);
      const cached = await this.get<DailyTaskCache>(STORES.DAILY_TASKS, key);
      if (cached) {
        const age = Date.now() - cached.cached_at;
        console.log(`[CACHE] ✅ HIT: daily_task (${cached.task.task_name}, age: ${Math.round(age/1000)}s)`);
        return cached.task;
      }
      console.log(`[CACHE] ❌ MISS: daily_task (key: ${key})`);
      return null;
    } catch (error) {
      console.error('[CacheService] Failed to get daily task:', error);
      return null;
    }
  }

  /**
   * Cache daily task for specific date, brand, and slot
   */
  static async setDailyTask(date: string, brandId: number, slotType: string, task: Task): Promise<void> {
    try {
      const key = `${date}_${brandId}_${slotType}`;
      console.log(`[CACHE] 💾 STORING: daily_task (key: ${key}, task: ${task.task_name})`);
      const cached: DailyTaskCache = {
        key,
        date,
        brand_id: brandId,
        slot_type: slotType,
        task,
        cached_at: Date.now()
      };

      await this.set(STORES.DAILY_TASKS, key, cached);
      console.log(`[CacheService] Cached daily task: ${key} -> ${task.task_name}`);
    } catch (error) {
      console.error('[CacheService] Failed to set daily task:', error);
      throw error;
    }
  }

  // ==================== Check-in Records Cache ====================

  /**
   * Get cached check-in records for a restaurant
   */
  static async getCheckInRecords(restaurantId: string): Promise<CheckInRecord[]> {
    try {
      console.log(`[CACHE] 🔍 CHECKING: check_in_records (restaurant: ${restaurantId})`);
      const cached = await this.get<CheckInRecordsCache>(STORES.CHECK_IN_RECORDS, restaurantId);
      if (cached && cached.records.length > 0) {
        const age = Date.now() - cached.last_updated;
        console.log(`[CACHE] ✅ HIT: check_in_records (${cached.records.length} items, age: ${Math.round(age/1000)}s)`);
        return cached.records;
      }
      console.log(`[CACHE] ❌ MISS: check_in_records (restaurant: ${restaurantId})`);
      return [];
    } catch (error) {
      console.error('[CacheService] Failed to get check-in records:', error);
      return [];
    }
  }

  /**
   * Append a new check-in record (limit to 10 most recent)
   */
  static async appendCheckInRecord(restaurantId: string, record: CheckInRecord): Promise<void> {
    try {
      const existing = await this.get<CheckInRecordsCache>(STORES.CHECK_IN_RECORDS, restaurantId);
      let records = existing ? existing.records : [];

      // Add new record at the beginning
      records.unshift(record);

      // Keep only the 10 most recent records
      if (records.length > 10) {
        records = records.slice(0, 10);
      }

      const cached: CheckInRecordsCache = {
        restaurant_id: restaurantId,
        records,
        last_updated: Date.now()
      };

      await this.set(STORES.CHECK_IN_RECORDS, restaurantId, cached);
      console.log(`[CacheService] Appended check-in record for restaurant ${restaurantId} (total: ${records.length})`);
    } catch (error) {
      console.error('[CacheService] Failed to append check-in record:', error);
      throw error;
    }
  }

  /**
   * Set all check-in records for a restaurant (replace existing)
   */
  static async setCheckInRecords(restaurantId: string, records: CheckInRecord[]): Promise<void> {
    try {
      // Ensure we don't exceed 10 records
      const limitedRecords = records.slice(0, 10);

      const cached: CheckInRecordsCache = {
        restaurant_id: restaurantId,
        records: limitedRecords,
        last_updated: Date.now()
      };

      await this.set(STORES.CHECK_IN_RECORDS, restaurantId, cached);
      console.log(`[CacheService] Set ${limitedRecords.length} check-in records for restaurant ${restaurantId}`);
    } catch (error) {
      console.error('[CacheService] Failed to set check-in records:', error);
      throw error;
    }
  }

  // ==================== Time Slot Config Cache ====================

  /**
   * Get cached time slot config for a brand
   * Note: Uses numeric key directly to match IndexedDB keyPath type
   */
  static async getTimeSlotConfig(brandId: number): Promise<TimeSlotConfig[] | null> {
    try {
      console.log(`[CACHE] 🔍 CHECKING: time_slot_config (brand: ${brandId})`);
      // Use numeric key directly - IndexedDB keyPath is brand_id (number)
      const db = await this.ensureDB();
      const cached = await new Promise<TimeSlotConfigCache | null>((resolve, reject) => {
        const transaction = db.transaction(STORES.TIME_SLOT_CONFIG, 'readonly');
        const store = transaction.objectStore(STORES.TIME_SLOT_CONFIG);
        const request = store.get(brandId); // Use number directly, not string!

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });

      if (cached) {
        const age = Date.now() - cached.cached_at;
        console.log(`[CACHE] ✅ HIT: time_slot_config (${cached.config.length} slots, age: ${Math.round(age/1000)}s)`);
        return cached.config;
      }
      console.log(`[CACHE] ❌ MISS: time_slot_config (brand: ${brandId})`);
      return null;
    } catch (error) {
      console.error('[CacheService] Failed to get time slot config:', error);
      return null;
    }
  }

  /**
   * Cache time slot config for a brand
   * Note: Uses numeric brand_id as keyPath
   */
  static async setTimeSlotConfig(brandId: number, config: TimeSlotConfig[]): Promise<void> {
    try {
      console.log(`[CACHE] 💾 STORING: time_slot_config (brand: ${brandId}, ${config.length} slots)`);
      const cached: TimeSlotConfigCache = {
        brand_id: brandId, // Numeric key for IndexedDB keyPath
        config,
        cached_at: Date.now()
      };

      // Use db.put directly with numeric key
      const db = await this.ensureDB();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORES.TIME_SLOT_CONFIG, 'readwrite');
        const store = transaction.objectStore(STORES.TIME_SLOT_CONFIG);
        const request = store.put(cached);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      console.log(`[CacheService] Cached time slot config for brand ${brandId} (${config.length} slots)`);
    } catch (error) {
      console.error('[CacheService] Failed to set time slot config:', error);
      throw error;
    }
  }

  // ==================== Avatar Cache ====================

  /**
   * Get cached avatar blob for an employee
   */
  static async getAvatarBlob(employeeId: string): Promise<Blob | null> {
    try {
      console.log(`[CACHE] 🔍 CHECKING: avatar (employee: ${employeeId})`);
      const cached = await this.get<AvatarCache>(STORES.AVATARS, employeeId);
      if (cached) {
        const age = Date.now() - cached.cached_at;
        console.log(`[CACHE] ✅ HIT: avatar (employee: ${employeeId}, age: ${Math.round(age/1000)}s, checked: ${cached.checked_date})`);
        return cached.blob;
      }
      console.log(`[CACHE] ❌ MISS: avatar (employee: ${employeeId})`);
      return null;
    } catch (error) {
      console.error('[CacheService] Failed to get avatar blob:', error);
      return null;
    }
  }

  /**
   * Cache avatar blob for an employee and return object URL
   */
  static async setAvatarBlob(employeeId: string, blob: Blob): Promise<string> {
    try {
      console.log(`[CACHE] 💾 STORING: avatar (employee: ${employeeId}, size: ${blob.size}B)`);
      const today = new Date().toISOString().split('T')[0]!; // Format: YYYY-MM-DD

      const cached: AvatarCache = {
        employee_id: employeeId,
        blob,
        checked_date: today,
        cached_at: Date.now()
      };

      await this.set(STORES.AVATARS, employeeId, cached);

      // Create and return object URL
      const objectUrl = URL.createObjectURL(blob);
      console.log(`[CacheService] Cached avatar for employee ${employeeId}`);
      return objectUrl;
    } catch (error) {
      console.error('[CacheService] Failed to set avatar blob:', error);
      throw error;
    }
  }

  /**
   * Check if avatar was checked today
   */
  static async isAvatarCheckedToday(employeeId: string): Promise<boolean> {
    try {
      const cached = await this.get<AvatarCache>(STORES.AVATARS, employeeId);
      if (!cached) {
        return false;
      }

      const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
      return cached.checked_date === today;
    } catch (error) {
      console.error('[CacheService] Failed to check avatar date:', error);
      return false;
    }
  }

  /**
   * Mark avatar as checked today (update checked_date)
   */
  static async markAvatarChecked(employeeId: string): Promise<void> {
    try {
      const cached = await this.get<AvatarCache>(STORES.AVATARS, employeeId);
      if (!cached) {
        console.warn(`[CacheService] No cached avatar found for employee ${employeeId}`);
        return;
      }

      const today = new Date().toISOString().split('T')[0]!; // Format: YYYY-MM-DD
      cached.checked_date = today;

      await this.set(STORES.AVATARS, employeeId, cached);
      console.log(`[CacheService] Marked avatar as checked for employee ${employeeId}`);
    } catch (error) {
      console.error('[CacheService] Failed to mark avatar as checked:', error);
      throw error;
    }
  }
}

// Expose to window for HTML compatibility
if (typeof window !== 'undefined') {
  (window as any).CacheService = CacheService;
}

export { CacheService };
