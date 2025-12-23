// Version: 1.0 - Precise time slot scheduler with preload support
// This module replaces the 60-second polling with precise setTimeout-based scheduling
// Triggers callbacks at exact time slot boundaries and provides 5-minute preload warnings

import type { TimeSlotConfig, SlotType } from '@/types/models';

type TimeSlotChangeCallback = (newSlot: SlotType, previousSlot: SlotType | null) => void;
type PreloadCallback = (upcomingSlot: SlotType) => void;

export class TimeScheduler {
  private static slotConfig: TimeSlotConfig[] = [];
  private static currentSlot: SlotType | null = null;
  private static mainTimer: ReturnType<typeof setTimeout> | null = null;
  private static preloadTimer: ReturnType<typeof setTimeout> | null = null;
  private static slotChangeCallbacks: Set<TimeSlotChangeCallback> = new Set();
  private static preloadCallbacks: Set<PreloadCallback> = new Set();

  /**
   * Initialize the scheduler with time slot configuration
   * @param config - Array of time slot configurations (4 slots)
   */
  static init(config: TimeSlotConfig[]): void {
    this.slotConfig = config;

    // Detect current slot immediately
    this.checkNow();

    // Schedule next trigger
    this.scheduleNext();

    // Listen for page visibility changes (wake from sleep)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.checkNow();
        this.scheduleNext();
      }
    });
  }

  /**
   * Register a callback for time slot changes
   * @param callback - Function to call when slot changes
   * @returns Unsubscribe function
   */
  static onSlotChange(callback: TimeSlotChangeCallback): () => void {
    this.slotChangeCallbacks.add(callback);
    return () => {
      this.slotChangeCallbacks.delete(callback);
    };
  }

  /**
   * Register a callback for preload events (5 minutes before slot change)
   * @param callback - Function to call for preload
   * @returns Unsubscribe function
   */
  static onPreload(callback: PreloadCallback): () => void {
    this.preloadCallbacks.add(callback);
    return () => {
      this.preloadCallbacks.delete(callback);
    };
  }

  /**
   * Get the current active time slot
   * @returns Current slot type or null if outside all time windows
   */
  static getCurrentSlot(): SlotType | null {
    return this.currentSlot;
  }

  /**
   * Get information about the next time slot
   * @returns Next slot type and start time, or null if no config available
   */
  static getNextSlotInfo(): { slot: SlotType; startsAt: Date } | null {
    if (!this.slotConfig.length) return null;

    const now = new Date();
    const currentTimeStr = now.toTimeString().slice(0, 8); // HH:MM:SS

    // Find the nearest upcoming slot today
    const sortedConfigs = [...this.slotConfig]
      .filter(c => c.is_active)
      .sort((a, b) => a.window_start.localeCompare(b.window_start));

    for (const config of sortedConfigs) {
      if (config.window_start > currentTimeStr) {
        // This slot hasn't started yet today
        const timeParts = config.window_start.split(':').map(Number);
        const hours = timeParts[0] ?? 0;
        const minutes = timeParts[1] ?? 0;
        const seconds = timeParts[2] ?? 0;
        const startsAt = new Date(now);
        startsAt.setHours(hours, minutes, seconds, 0);

        return { slot: config.slot_type, startsAt };
      }
    }

    // All slots for today have passed, return tomorrow's first slot
    if (sortedConfigs.length > 0) {
      const firstConfig = sortedConfigs[0];
      if (!firstConfig) return null;

      const timeParts = firstConfig.window_start.split(':').map(Number);
      const hours = timeParts[0] ?? 0;
      const minutes = timeParts[1] ?? 0;
      const seconds = timeParts[2] ?? 0;
      const startsAt = new Date(now);
      startsAt.setDate(startsAt.getDate() + 1); // Tomorrow
      startsAt.setHours(hours, minutes, seconds, 0);

      return { slot: firstConfig.slot_type, startsAt };
    }

    return null;
  }

  /**
   * Stop all timers and clear callbacks
   */
  static stop(): void {
    if (this.mainTimer) clearTimeout(this.mainTimer);
    if (this.preloadTimer) clearTimeout(this.preloadTimer);
    this.mainTimer = null;
    this.preloadTimer = null;
    this.slotChangeCallbacks.clear();
    this.preloadCallbacks.clear();
  }

  /**
   * Manually trigger a time slot check (useful for testing and page recovery)
   */
  static checkNow(): void {
    const now = new Date();
    const currentTimeStr = now.toTimeString().slice(0, 8);

    let newSlot: SlotType | null = null;

    for (const config of this.slotConfig) {
      if (!config.is_active) continue;

      const start = config.window_start;
      const end = config.window_end;

      // Handle midnight crossing case (e.g., 21:30 - 01:00)
      if (end < start) {
        if (currentTimeStr >= start || currentTimeStr <= end) {
          newSlot = config.slot_type;
          break;
        }
      } else {
        if (currentTimeStr >= start && currentTimeStr <= end) {
          newSlot = config.slot_type;
          break;
        }
      }
    }

    if (newSlot !== this.currentSlot) {
      const previousSlot = this.currentSlot;
      this.currentSlot = newSlot;

      if (newSlot) {
        this.slotChangeCallbacks.forEach(cb => {
          try {
            cb(newSlot!, previousSlot);
          } catch (e) {
          }
        });
      }
    }
  }

  /**
   * Check if currently within any time window
   * @returns True if in a time window, false otherwise
   */
  static isInTimeWindow(): boolean {
    return this.currentSlot !== null;
  }

  /**
   * Schedule the next time slot trigger and preload event
   * @private
   */
  private static scheduleNext(): void {
    // Clear old timers
    if (this.mainTimer) clearTimeout(this.mainTimer);
    if (this.preloadTimer) clearTimeout(this.preloadTimer);

    const nextSlotInfo = this.getNextSlotInfo();
    if (!nextSlotInfo) {
      return;
    }

    const now = new Date();
    const msUntilNext = nextSlotInfo.startsAt.getTime() - now.getTime();
    const msUntilPreload = msUntilNext - (5 * 60 * 1000); // 5 minutes before

    // Set preload timer if there's more than 5 minutes
    if (msUntilPreload > 0) {
      this.preloadTimer = setTimeout(() => {
        this.preloadCallbacks.forEach(cb => {
          try {
            cb(nextSlotInfo.slot);
          } catch (e) {
          }
        });
      }, msUntilPreload);
    }

    // Set main timer for slot change
    if (msUntilNext > 0) {
      this.mainTimer = setTimeout(() => {
        const previousSlot = this.currentSlot;
        this.currentSlot = nextSlotInfo.slot;

        this.slotChangeCallbacks.forEach(cb => {
          try {
            cb(nextSlotInfo.slot, previousSlot);
          } catch (e) {
          }
        });

        // Recursively schedule the next slot
        this.scheduleNext();
      }, msUntilNext);
    }
  }
}

// Expose to window for HTML onclick handlers and debugging
if (typeof window !== 'undefined') {
  window.TimeScheduler = TimeScheduler;
}
