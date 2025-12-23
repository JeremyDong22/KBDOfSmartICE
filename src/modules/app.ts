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

    // 1. Initialize cache service (must be first)
    const cacheStart = performance.now();
    await CacheService.init();

    // 2. Check authentication
    this.currentUser = AuthService.getCurrentUser();

    if (!this.currentUser) {
      window.location.href = '/';
      return;
    }


    // 3. Initialize check-in module
    CheckInModule.initialize();

    // 4. Load time configuration (cache-first)
    const timeConfigStart = performance.now();
    const timeConfig = await this.loadTimeSlotConfig();

    // 5. Initialize time scheduler (replaces 60-second polling)
    TimeScheduler.init(timeConfig);
    TimeScheduler.onSlotChange((newSlot, prevSlot) => {
      this.handleTimeWindowChange();
    });
    TimeScheduler.onPreload((upcomingSlot) => {
      this.preloadTaskForSlot(upcomingSlot);
    });

    // 6. Detect current time window
    this.currentSlotType = TimeScheduler.getCurrentSlot();
    this.isInTimeWindow = TimeScheduler.isInTimeWindow();

    // 7. Load restaurants and initialize map
    const mapStart = performance.now();
    await this.loadRestaurantsAndInitMap();

    // 8. Set up UI event listeners
    UIModule.setupLogoutButton();
    this.setupRecenterButton();

    // 9. Initialize time control module (dev mode)
    TimeControlModule.initialize(() => this.handleTimeWindowChange());

    // 10. Start Realtime subscription
    const realtimeStart = performance.now();
    await RealtimeService.init();
    RealtimeService.onNewCheckIn((record) => {
      this.handleNewCheckIn(record);
    });

    // 11. Background tasks (non-blocking)
    this.backgroundInit();

    const totalTime = performance.now() - initStart;
  }

  /**
   * Get user's brand_id (from session first, then cache, then DB as fallback)
   * Also syncs cache with KBDService
   */
  private static async getBrandId(): Promise<number> {
    // 1. Check if brand_id is already cached in memory
    if (this.cachedBrandId !== null) {
      return this.cachedBrandId;
    }

    // 2. Check if brand_id exists in sessionStorage (from login)
    if (this.currentUser?.brand_id !== undefined) {
      this.cachedBrandId = this.currentUser.brand_id;
      KBDService.setBrandIdCache(this.currentUser.restaurant_id, this.cachedBrandId);
      return this.cachedBrandId;
    }

    // 3. Fallback: query database (only for old sessions without brand_id)
    const queryStart = performance.now();
    const { data: restaurant } = await supabaseClient
      .from('master_restaurant')
      .select('brand_id')
      .eq('id', this.currentUser!.restaurant_id)
      .single();

    const restaurantData = restaurant as { brand_id: number } | null;
    if (!restaurantData) {
      throw new Error('Restaurant not found for user');
    }

    this.cachedBrandId = restaurantData.brand_id;

    // Sync with KBDService to avoid duplicate queries
    KBDService.setBrandIdCache(this.currentUser!.restaurant_id, this.cachedBrandId);

    return this.cachedBrandId;
  }

  /**
   * Detect current time slot based on time window configuration
   */
  static async detectTimeSlot(): Promise<void> {

    try {
      // If in test mode, use test slot type (for backward compatibility)
      if (this.testMode) {
        this.currentSlotType = this.testSlotType;
        this.isInTimeWindow = this.testSlotType !== null;
        return;
      }

      // Get user's brand_id (cached)
      const brandId = await this.getBrandId();

      // Get current time slot, using dev time if available
      const devTime = TimeControlModule.isDevMode() ? TimeControlModule.getCurrentTime() : null;
      if (devTime) {
      }

      const detectedSlot = await KBDService.getCurrentTimeSlot(brandId, devTime);

      if (detectedSlot) {
        this.currentSlotType = detectedSlot;
        this.isInTimeWindow = true;
      } else {
        this.isInTimeWindow = false;
      }
    } catch (error) {
      this.isInTimeWindow = false;
    }
  }

  /**
   * Load restaurants and initialize map
   */
  static async loadRestaurantsAndInitMap(): Promise<void> {

    try {
      // Determine which slot to fetch data for
      let slotForFetch: SlotType;
      let displayMode = false;

      if (this.isInTimeWindow && this.currentSlotType) {
        // Inside check-in window: fetch current slot data, normal mode
        slotForFetch = this.currentSlotType;
        displayMode = false;
      } else {
        // Outside check-in window: fetch previous slot data, display mode
        slotForFetch = KBDService.getPreviousTimeSlot();
        displayMode = true;
      }

      // Use dev time if available for cross-day testing
      const devTime = TimeControlModule.isDevMode() ? TimeControlModule.getCurrentTime() : null;
      this.allRestaurants = await KBDService.getRestaurantsWithStatus(slotForFetch, displayMode, devTime);


      // Initialize map
      await MapModule.initialize(this.allRestaurants);

      // Extract and cache employee data for avatar and other uses
      // Only cache if data came fresh (KBDService handles restaurant+employee caching together)
      const allEmployees = this.allRestaurants.flatMap(r => r.master_employee || []);
      if (allEmployees.length > 0) {
        // Check if employees cache needs update (employees are embedded in restaurants cache)
        const cachedEmployees = await CacheService.getEmployees();
        if (cachedEmployees.length === 0) {
          await CacheService.setEmployees(allEmployees);
        } else {
        }
      }

      // Initialize edge indicators after map is ready
      const mapInstance = MapModule.getMap();
      if (mapInstance) {
        EdgeIndicatorsModule.initialize(mapInstance, this.allRestaurants);
      } else {
      }

      // Only load task if in time window
      if (this.isInTimeWindow && this.currentSlotType) {
        await this.loadCurrentTask();
      } else {
      }

      // Update UI
      UIModule.updateStatusBar(this.currentSlotType);
      UIModule.updateCheckInPanel(this.isCurrentUserCheckedIn(), this.currentTask);

      // Hide loading overlay
      UIModule.hideLoading();

      // Apply blur and show panel only if in time window and not checked in
      if (this.isInTimeWindow && !this.isCurrentUserCheckedIn()) {
        MapModule.setBlur(true);

        setTimeout(() => {
          UIModule.showCheckInPanel();
        }, 600);
      } else {
        MapModule.setBlur(false);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert('加载失败：' + errorMessage);
    }
  }

  /**
   * Update UI based on current time window
   */
  static async updateUIBasedOnTimeWindow(): Promise<void> {

    // Use dev time if available for cross-day testing
    const devTime = TimeControlModule.isDevMode() ? TimeControlModule.getCurrentTime() : null;

    if (!this.isInTimeWindow) {

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

      // Reload data for new slot in normal mode
      this.allRestaurants = await KBDService.getRestaurantsWithStatus(this.currentSlotType!, false, devTime);

      // Load task for current slot
      await this.loadCurrentTask();

      // Update markers on map
      MapModule.updateAllMarkers(this.allRestaurants);

      // Update edge indicators
      EdgeIndicatorsModule.updateRestaurantData(this.allRestaurants);

      if (!this.isCurrentUserCheckedIn()) {
        MapModule.setBlur(true);
        UIModule.showCheckInPanel();
      } else {
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
      return;
    }


    try {
      // Use dev time if available for cross-day testing
      const devTime = TimeControlModule.isDevMode() ? TimeControlModule.getCurrentTime() : null;
      if (devTime) {
      }

      this.currentTask = await KBDService.getTodayTask(this.currentUser.restaurant_id, this.currentSlotType!, devTime);

      if (this.currentTask) {

        // Update panel subtitle with task description
        const subtitleElement = document.getElementById('panelSubtitle');
        if (subtitleElement) {
          subtitleElement.textContent = this.currentTask.task_description || this.currentTask.task_name;
        }
      } else {
      }
    } catch (error) {
    }
  }

  /**
   * Check if current user has checked in
   */
  static isCurrentUserCheckedIn(): boolean {
    if (!this.currentSlotType) {
      return false;
    }

    const userRestaurant = this.allRestaurants.find(r => r.id === this.currentUser?.restaurant_id);
    const isChecked = userRestaurant?.checked || false;

    return isChecked;
  }

  /**
   * Handle time window change (triggered by TimeControlModule)
   */
  static async handleTimeWindowChange(): Promise<void> {

    // Re-detect time slot and update UI
    await this.detectTimeSlot();
    await this.updateUIBasedOnTimeWindow();
  }

  /**
   * Handle time jump test control - DEPRECATED
   * Kept for backward compatibility
   */
  static async handleTimeJump(slot: SlotType | null): Promise<void> {

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
        MapModule.recenterToInitialView();
      });
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
      return cached;
    }

    // Cache miss - query database
    const { data: configs } = await supabaseClient
      .from('kbd_time_slot_config')
      .select('*')
      .eq('brand_id', brandId)
      .is('restaurant_id', null)
      .eq('is_active', true);

    const configList = (configs || []) as TimeSlotConfig[];
    await CacheService.setTimeSlotConfig(brandId, configList);

    return configList;
  }

  /**
   * Preload task for upcoming slot (called 5 minutes before slot change)
   * @param slotType - Upcoming slot type
   */
  private static async preloadTaskForSlot(slotType: SlotType): Promise<void> {
    if (!this.currentUser?.restaurant_id) return;

    try {
      await KBDService.getTodayTask(this.currentUser.restaurant_id, slotType);
    } catch (error) {
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

    }
  }

  /**
   * Background initialization tasks (non-blocking)
   */
  private static backgroundInit(): void {
    // Preload tasks for all slots
    if (this.currentUser?.restaurant_id) {
      KBDService.preloadTasksForAllSlots(this.currentUser.restaurant_id).catch(err => {
      });
    }

    // Check and update avatar cache
    CacheService.getEmployees().then(employees => {
      if (employees.length > 0) {
        AvatarCacheService.checkAndUpdateAvatars(employees).catch(err => {
        });
      }
    });
  }
}

// Export to window for backward compatibility
if (typeof window !== 'undefined') {
  window.AppModule = AppModule;
}
