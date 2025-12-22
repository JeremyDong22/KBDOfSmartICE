// Version: 5.3 - Pass dev time to getRestaurantsWithStatus for cross-day testing
// App Module - Main application coordination and initialization
// Handles: Application initialization, time slot detection, state management, coordination between modules

import { supabaseClient } from '@services/supabase';
import { AuthService } from '@services/auth.service';
import { KBDService } from '@services/kbd.service';
import { EdgeIndicatorsModule } from '@modules/edge-indicators';
import { MapModule } from '@modules/map';
import { CheckInModule } from '@modules/checkin';
import { UIModule } from '@modules/ui';
import { TimeControlModule } from '@modules/time-control';
import type { Employee, Restaurant, Task, SlotType } from '@/types/models';

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

  /**
   * Initialize application
   */
  static async init(): Promise<void> {
    console.log('[APP] ===== Application initialization started =====');

    // Check authentication
    this.currentUser = AuthService.getCurrentUser();

    if (!this.currentUser) {
      console.warn('[APP] No authenticated user, redirecting to login');
      window.location.href = '/';
      return;
    }

    console.log('[APP] Current user:', this.currentUser.employee_name);
    console.log('[APP] Restaurant ID:', this.currentUser.restaurant_id);

    // Initialize check-in module
    CheckInModule.initialize();

    // Detect current time slot
    await this.detectTimeSlot();

    // Load data and initialize map
    await this.loadRestaurantsAndInitMap();

    // Set up UI event listeners
    UIModule.setupLogoutButton();
    this.setupRecenterButton();

    // Initialize time control module (dev only)
    TimeControlModule.initialize(() => this.handleTimeWindowChange());

    // Set up periodic time slot checking (every minute)
    setInterval(async () => {
      console.log('[APP] Periodic time slot check');
      await this.detectTimeSlot();
      await this.updateUIBasedOnTimeWindow();
    }, 60000); // Check every 60 seconds

    console.log('[APP] ===== Application initialization complete =====');
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

      // Get user's restaurant to find brand_id
      const { data: restaurant } = await supabaseClient
        .from('master_restaurant')
        .select('brand_id')
        .eq('id', this.currentUser!.restaurant_id)
        .single();

      const restaurantData = restaurant as { brand_id: number } | null;
      if (!restaurantData) {
        console.error('[APP] Restaurant not found for user');
        return;
      }

      console.log('[APP] User brand_id:', restaurantData.brand_id);

      // Get current time slot, using dev time if available
      const devTime = TimeControlModule.isDevMode() ? TimeControlModule.getCurrentTime() : null;
      if (devTime) {
        console.log('[APP] Using dev time:', TimeControlModule.getFormattedTime());
      }

      const detectedSlot = await KBDService.getCurrentTimeSlot(restaurantData.brand_id, devTime);

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

      // Preload tasks for all slots in background (non-blocking)
      KBDService.preloadTasksForAllSlots(this.currentUser!.restaurant_id).catch(err => {
        console.warn('[APP] Task preload failed (non-critical):', err);
      });

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
}

// Export to window for backward compatibility
if (typeof window !== 'undefined') {
  window.AppModule = AppModule;
  console.log('[APP] Module exported to window');
}
