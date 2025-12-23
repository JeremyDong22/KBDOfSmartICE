// Version: 6.6 - Use brand_id from sessionStorage (fetched at login) to eliminate 1.7s query
// App Module - Main application coordination and initialization
// Handles: Application initialization, time slot detection, state management, coordination between modules

import { supabaseClient } from '@services/supabase';
import { AuthService } from '@services/auth.service';
import { KBDService } from '@services/kbd.service';
import { CacheService } from '@services/cache.service';
import { RealtimeService } from '@services/realtime.service';
import { AvatarCacheService } from '@services/avatar-cache.service';
import { EdgeIndicatorsModule } from '@modules/edge-indicators';
import { MapModule } from '@modules/map';
import { CheckInModule } from '@modules/checkin';
import { UIModule } from '@modules/ui';
import { TimeControlModule } from '@modules/time-control';
import { TimeScheduler } from '@modules/time-scheduler';
import type { Employee, Restaurant, Task, SlotType, TimeSlotConfig, CheckInRecord } from '@/types/models';

console.log('[APP] Module loaded');

export class AppModule {
  // State
  static currentUser: Employee | null = null;
  static currentSlotType: SlotType | null = null;
  static currentTask: Task | null = null;
  static allRestaurants: Restaurant[] = [];
  static isInTimeWindow: boolean = false;
  static testMode: boolean = false;
  static testSlotType: SlotType | null = null;
  // Cached brand_id to avoid redundant API calls
  private static cachedBrandId: number | null = null;

  /**
   * Initialize application
   */
  static async init(): Promise<void> {
    const initStart = performance.now();
    console.log('[APP] ===== Application initialization started =====');

    // 1. Initialize cache service (must be first)
    const cacheStart = performance.now();
    await CacheService.init();
    console.log(`[APP] ⏱️ CacheService initialized in ${(performance.now() - cacheStart).toFixed(0)}ms`);

    // 2. Check authentication
    this.currentUser = AuthService.getCurrentUser();

    if (!this.currentUser) {
      console.warn('[APP] No authenticated user, redirecting to login');
      window.location.href = '/';
      return;
    }

    console.log('[APP] Current user:', this.currentUser.employee_name);
    console.log('[APP] Restaurant ID:', this.currentUser.restaurant_id);

    // 3. Initialize check-in module
    CheckInModule.initialize();

    // 4. Load time configuration (cache-first)
    const timeConfigStart = performance.now();
    const timeConfig = await this.loadTimeSlotConfig();
    console.log(`[APP] ⏱️ Time config loaded in ${(performance.now() - timeConfigStart).toFixed(0)}ms`);

    // 5. Initialize time scheduler (replaces 60-second polling)
    TimeScheduler.init(timeConfig);
    TimeScheduler.onSlotChange((newSlot, prevSlot) => {
      console.log('[APP] TimeScheduler: slot changed', prevSlot, '->', newSlot);
      this.handleTimeWindowChange();
    });
    TimeScheduler.onPreload((upcomingSlot) => {
      console.log('[APP] TimeScheduler: preloading task for', upcomingSlot);
      this.preloadTaskForSlot(upcomingSlot);
    });

    // 6. Detect current time window
    this.currentSlotType = TimeScheduler.getCurrentSlot();
    this.isInTimeWindow = TimeScheduler.isInTimeWindow();
    console.log('[APP] Current slot:', this.currentSlotType, 'in window:', this.isInTimeWindow);

    // 7. Load restaurants and initialize map
    const mapStart = performance.now();
    await this.loadRestaurantsAndInitMap();
    console.log(`[APP] ⏱️ Restaurants & map loaded in ${(performance.now() - mapStart).toFixed(0)}ms`);

    // 8. Set up UI event listeners
    UIModule.setupLogoutButton();
    this.setupRecenterButton();

    // 9. Initialize time control module (dev mode)
    TimeControlModule.initialize(() => this.handleTimeWindowChange());

    // 10. Start Realtime subscription
    const realtimeStart = performance.now();
    await RealtimeService.init();
    console.log(`[APP] ⏱️ Realtime initialized in ${(performance.now() - realtimeStart).toFixed(0)}ms`);
    RealtimeService.onNewCheckIn((record) => {
      console.log('[APP] Realtime: new check-in received', record.restaurant_id);
      this.handleNewCheckIn(record);
    });

    // 11. Background tasks (non-blocking)
    this.backgroundInit();

    const totalTime = performance.now() - initStart;
    console.log(`[APP] ===== Application initialization complete in ${totalTime.toFixed(0)}ms =====`);
  }

  /**
   * Get user's brand_id (from session first, then cache, then DB as fallback)
   * Also syncs cache with KBDService
   */
  private static async getBrandId(): Promise<number> {
    // 1. Check if brand_id is already cached in memory
    if (this.cachedBrandId !== null) {
      console.log('[APP] brand_id memory cache HIT:', this.cachedBrandId);
      return this.cachedBrandId;
    }

    // 2. Check if brand_id exists in sessionStorage (from login)
    if (this.currentUser?.brand_id !== undefined) {
      this.cachedBrandId = this.currentUser.brand_id;
      console.log('[APP] brand_id session cache HIT:', this.cachedBrandId);
      KBDService.setBrandIdCache(this.currentUser.restaurant_id, this.cachedBrandId);
      return this.cachedBrandId;
    }

    // 3. Fallback: query database (only for old sessions without brand_id)
    console.log('[APP] brand_id cache MISS (old session), querying DB...');
    const queryStart = performance.now();
    const { data: restaurant } = await supabaseClient
      .from('master_restaurant')
      .select('brand_id')
      .eq('id', this.currentUser!.restaurant_id)
      .single();
    console.log(`[APP] ⏱️ brand_id DB query took ${(performance.now() - queryStart).toFixed(0)}ms`);

    const restaurantData = restaurant as { brand_id: number } | null;
    if (!restaurantData) {
      throw new Error('Restaurant not found for user');
    }

    this.cachedBrandId = restaurantData.brand_id;
    console.log('[APP] brand_id cached from DB:', this.cachedBrandId);

    // Sync with KBDService to avoid duplicate queries
    KBDService.setBrandIdCache(this.currentUser!.restaurant_id, this.cachedBrandId);

    return this.cachedBrandId;
  }

  /**
   * Detect current time slot based on time window configuration
   */
  static async detectTimeSlot(): Promise<void> {
    console.log('[APP] Detecting current time slot');

    try {
      // If in test mode, use test slot type (for backward compatibility)
      if (this.testMode) {
        this.currentSlotType = this.testSlotType;
        this.isInTimeWindow = this.testSlotType !== null;
        console.log('[APP] Test mode active, slot:', this.currentSlotType, 'in window:', this.isInTimeWindow);
        return;
      }

      // Get user's brand_id (cached)
      const brandId = await this.getBrandId();
      console.log('[APP] User brand_id:', brandId);

      // Get current time slot, using dev time if available
      const devTime = TimeControlModule.isDevMode() ? TimeControlModule.getCurrentTime() : null;
      if (devTime) {
        console.log('[APP] Using dev time:', TimeControlModule.getFormattedTime());
      }

      const detectedSlot = await KBDService.getCurrentTimeSlot(brandId, devTime);

      if (detectedSlot) {
        this.currentSlotType = detectedSlot;
        this.isInTimeWindow = true;
        console.log('[APP] Detected time slot:', detectedSlot, '✓ IN WINDOW');
      } else {
        this.isInTimeWindow = false;
        console.log('[APP] Not in any time window ✗');
      }
    } catch (error) {
      console.error('[APP] Error detecting time slot:', error);
      this.isInTimeWindow = false;
    }
  }

  /**
   * Load restaurants and initialize map
   */
  static async loadRestaurantsAndInitMap(): Promise<void> {
    console.log('[APP] Loading restaurants and initializing map');

    try {
      // Determine which slot to fetch data for
      let slotForFetch: SlotType;
      let displayMode = false;

      if (this.isInTimeWindow && this.currentSlotType) {
        // Inside check-in window: fetch current slot data, normal mode
        slotForFetch = this.currentSlotType;
        displayMode = false;
        console.log('[APP] Inside window, fetching current slot:', slotForFetch);
      } else {
        // Outside check-in window: fetch previous slot data, display mode
        slotForFetch = KBDService.getPreviousTimeSlot();
        displayMode = true;
        console.log('[APP] Outside window, fetching previous slot:', slotForFetch, '(display mode)');
      }

      // Use dev time if available for cross-day testing
      const devTime = TimeControlModule.isDevMode() ? TimeControlModule.getCurrentTime() : null;
      this.allRestaurants = await KBDService.getRestaurantsWithStatus(slotForFetch, displayMode, devTime);

      console.log('[APP] Loaded restaurants:', this.allRestaurants.length);
      console.log('[APP] Restaurant details:', this.allRestaurants.map(r => ({
        name: r.restaurant_name,
        brand_id: r.brand_id,
        lat: r.latitude,
        lng: r.longitude,
        checked: r.checked,
        displayMode: (r as any).displayMode
      })));

      // Initialize map
      await MapModule.initialize(this.allRestaurants);

      // Extract and cache employee data for avatar and other uses
      // Only cache if data came fresh (KBDService handles restaurant+employee caching together)
      const allEmployees = this.allRestaurants.flatMap(r => r.master_employee || []);
      if (allEmployees.length > 0) {
        // Check if employees cache needs update (employees are embedded in restaurants cache)
        const cachedEmployees = await CacheService.getEmployees();
        if (cachedEmployees.length === 0) {
          console.log('[APP] Employees cache empty, storing', allEmployees.length, 'employees');
          await CacheService.setEmployees(allEmployees);
        } else {
          console.log('[APP] Employees already cached (', cachedEmployees.length, 'items)');
        }
      }

      // Initialize edge indicators after map is ready
      const mapInstance = MapModule.getMap();
      if (mapInstance) {
        console.log('[APP] Initializing edge indicators with map instance');
        EdgeIndicatorsModule.initialize(mapInstance, this.allRestaurants);
      } else {
        console.warn('[APP] Map instance not available, skipping edge indicators');
      }

      // Only load task if in time window
      if (this.isInTimeWindow && this.currentSlotType) {
        console.log('[APP] In time window, loading current task');
        await this.loadCurrentTask();
      } else {
        console.log('[APP] Not in time window, skipping task load');
      }

      // Update UI
      UIModule.updateStatusBar(this.currentSlotType);
      UIModule.updateCheckInPanel(this.isCurrentUserCheckedIn(), this.currentTask);

      // Hide loading overlay
      UIModule.hideLoading();

      // Apply blur and show panel only if in time window and not checked in
      if (this.isInTimeWindow && !this.isCurrentUserCheckedIn()) {
        console.log('[APP] User not checked in, showing check-in panel');
        MapModule.setBlur(true);

        setTimeout(() => {
          UIModule.showCheckInPanel();
        }, 600);
      } else {
        console.log('[APP] User already checked in or not in window, panel hidden');
        MapModule.setBlur(false);
      }
    } catch (error) {
      console.error('[APP] Initialization error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert('加载失败：' + errorMessage);
    }
  }

  /**
   * Update UI based on current time window
   */
  static async updateUIBasedOnTimeWindow(): Promise<void> {
    console.log('[APP] Updating UI based on time window, in window:', this.isInTimeWindow);

    // Use dev time if available for cross-day testing
    const devTime = TimeControlModule.isDevMode() ? TimeControlModule.getCurrentTime() : null;

    if (!this.isInTimeWindow) {
      console.log('[APP] Outside time window - showing previous slot data in display mode');

      // Fetch previous slot data in display mode
      const previousSlot = KBDService.getPreviousTimeSlot();
      this.allRestaurants = await KBDService.getRestaurantsWithStatus(previousSlot, true, devTime);

      MapModule.setBlur(false);
      UIModule.hideCheckInPanel();
      UIModule.updateStatusBar(null);

      // Update markers with previous slot data (all colored)
      MapModule.updateAllMarkers(this.allRestaurants);

      // Update edge indicators with new restaurant data
      EdgeIndicatorsModule.updateRestaurantData(this.allRestaurants);
    } else {
      console.log('[APP] Inside time window - reloading data for slot:', this.currentSlotType);

      // Reload data for new slot in normal mode
      this.allRestaurants = await KBDService.getRestaurantsWithStatus(this.currentSlotType!, false, devTime);

      // Load task for current slot
      await this.loadCurrentTask();

      // Update markers on map
      MapModule.updateAllMarkers(this.allRestaurants);

      // Update edge indicators
      EdgeIndicatorsModule.updateRestaurantData(this.allRestaurants);

      if (!this.isCurrentUserCheckedIn()) {
        console.log('[APP] User not checked in, showing panel');
        MapModule.setBlur(true);
        UIModule.showCheckInPanel();
      } else {
        console.log('[APP] User already checked in, hiding panel');
        MapModule.setBlur(false);
        UIModule.hideCheckInPanel();
      }

      UIModule.updateStatusBar(this.currentSlotType);
      UIModule.updateCheckInPanel(this.isCurrentUserCheckedIn(), this.currentTask);
    }
  }

  /**
   * Load current task for user's restaurant and slot
   */
  static async loadCurrentTask(): Promise<void> {
    if (!this.currentUser?.restaurant_id) {
      console.warn('[APP] No restaurant ID for current user');
      return;
    }

    console.log('[APP] Loading current task for restaurant:', this.currentUser.restaurant_id, 'slot:', this.currentSlotType);

    try {
      // Use dev time if available for cross-day testing
      const devTime = TimeControlModule.isDevMode() ? TimeControlModule.getCurrentTime() : null;
      if (devTime) {
        console.log('[APP] Using dev time for task selection:', devTime.toISOString());
      }

      this.currentTask = await KBDService.getTodayTask(this.currentUser.restaurant_id, this.currentSlotType!, devTime);

      if (this.currentTask) {
        console.log('[APP] Task loaded:', this.currentTask.task_name);
        console.log('[APP] Task description:', this.currentTask.task_description);
        console.log('[APP] Media type:', this.currentTask.media_type);

        // Update panel subtitle with task description
        const subtitleElement = document.getElementById('panelSubtitle');
        if (subtitleElement) {
          subtitleElement.textContent = this.currentTask.task_description || this.currentTask.task_name;
        }
      } else {
        console.warn('[APP] No task found for current slot');
      }
    } catch (error) {
      console.error('[APP] Error loading task:', error);
    }
  }

  /**
   * Check if current user has checked in
   */
  static isCurrentUserCheckedIn(): boolean {
    if (!this.currentSlotType) {
      console.log('[APP] Not in time window, consider not checked in');
      return false;
    }

    const userRestaurant = this.allRestaurants.find(r => r.id === this.currentUser?.restaurant_id);
    const isChecked = userRestaurant?.checked || false;

    console.log('[APP] Current user checked in:', isChecked);
    return isChecked;
  }

  /**
   * Handle time window change (triggered by TimeControlModule)
   */
  static async handleTimeWindowChange(): Promise<void> {
    console.log('[APP] ===== Time window change detected =====');

    // Re-detect time slot and update UI
    await this.detectTimeSlot();
    await this.updateUIBasedOnTimeWindow();
  }

  /**
   * Handle time jump test control - DEPRECATED
   * Kept for backward compatibility
   */
  static async handleTimeJump(slot: SlotType | null): Promise<void> {
    console.warn('[APP] handleTimeJump is deprecated - use TimeControlModule instead');

    // Update test mode for backward compatibility
    if (slot === null) {
      this.testMode = true;
      this.testSlotType = null;
    } else {
      this.testMode = true;
      this.testSlotType = slot;
    }

    await this.detectTimeSlot();
    await this.updateUIBasedOnTimeWindow();
  }

  /**
   * Set up recenter button event listener
   */
  static setupRecenterButton(): void {
    const recenterBtn = document.getElementById('recenterBtn');
    if (recenterBtn) {
      recenterBtn.addEventListener('click', () => {
        console.log('[APP] Recenter button clicked');
        MapModule.recenterToInitialView();
      });
      console.log('[APP] Recenter button listener attached');
    }
  }

  /**
   * Load time slot configuration (cache-first)
   * @returns Array of time slot configurations
   */
  private static async loadTimeSlotConfig(): Promise<TimeSlotConfig[]> {
    // Get user's brand_id (cached)
    const brandId = await this.getBrandId();

    // Check cache first
    const cached = await CacheService.getTimeSlotConfig(brandId);
    if (cached) {
      console.log('[APP] Using cached time slot config');
      return cached;
    }

    // Cache miss - query database
    console.log('[APP] Time slot config cache miss, querying database');
    const { data: configs } = await supabaseClient
      .from('kbd_time_slot_config')
      .select('*')
      .eq('brand_id', brandId)
      .is('restaurant_id', null)
      .eq('is_active', true);

    const configList = (configs || []) as TimeSlotConfig[];
    await CacheService.setTimeSlotConfig(brandId, configList);
    console.log('[APP] Time slot config cached');

    return configList;
  }

  /**
   * Preload task for upcoming slot (called 5 minutes before slot change)
   * @param slotType - Upcoming slot type
   */
  private static async preloadTaskForSlot(slotType: SlotType): Promise<void> {
    if (!this.currentUser?.restaurant_id) return;

    try {
      console.log('[APP] Preloading task for slot:', slotType);
      await KBDService.getTodayTask(this.currentUser.restaurant_id, slotType);
    } catch (error) {
      console.warn('[APP] Task preload failed (non-critical):', error);
    }
  }

  /**
   * Handle new check-in from Realtime subscription
   * @param record - Check-in record received via Realtime
   */
  private static handleNewCheckIn(record: CheckInRecord): void {
    // Find and update restaurant in local state
    const restaurant = this.allRestaurants.find(r => r.id === record.restaurant_id);
    if (restaurant) {
      restaurant.checked = true;
      restaurant.checkInData = record;

      // Update all map markers (includes the updated restaurant)
      MapModule.updateAllMarkers(this.allRestaurants);

      // Update edge indicators
      EdgeIndicatorsModule.updateRestaurantData(this.allRestaurants);

      console.log('[APP] Updated restaurant status from Realtime:', restaurant.restaurant_name);
    }
  }

  /**
   * Background initialization tasks (non-blocking)
   */
  private static backgroundInit(): void {
    // Preload tasks for all slots
    if (this.currentUser?.restaurant_id) {
      KBDService.preloadTasksForAllSlots(this.currentUser.restaurant_id).catch(err => {
        console.warn('[APP] Task preload failed (non-critical):', err);
      });
    }

    // Check and update avatar cache
    CacheService.getEmployees().then(employees => {
      if (employees.length > 0) {
        AvatarCacheService.checkAndUpdateAvatars(employees).catch(err => {
          console.warn('[APP] Avatar update failed (non-critical):', err);
        });
      }
    });
  }
}

// Export to window for backward compatibility
if (typeof window !== 'undefined') {
  window.AppModule = AppModule;
  console.log('[APP] Module exported to window');
}
