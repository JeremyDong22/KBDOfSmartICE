// Version: 1.0 - Avatar caching service with daily refresh check
// Provides employee avatar caching with daily update validation and background refresh

import { CacheService } from './cache.service';
import type { Employee } from '@/types/models';

/**
 * AvatarCacheService
 *
 * Manages employee avatar caching in IndexedDB with daily validation.
 * Avatars are stored as Blobs and served via object URLs for fast display.
 *
 * Key Features:
 * - Automatic daily freshness check
 * - Background refresh (non-blocking)
 * - Graceful fallback to remote URLs on failure
 * - Batch update for all employees
 */
class AvatarCacheService {
  /**
   * Get employee avatar URL (priority: cache > download)
   *
   * @param employeeId - Employee ID
   * @param remoteUrl - Remote avatar URL (Supabase Storage)
   * @returns Avatar URL (object URL or remote URL)
   *
   * Logic Flow:
   * 1. Check cache -> if exists and verified today -> return cached
   * 2. If cached but not verified today -> return cached + background check
   * 3. If no cache -> download and cache
   * 4. On error -> fallback to remote URL
   */
  static async getAvatarUrl(employeeId: string, remoteUrl: string): Promise<string> {
    // Handle empty remote URL
    if (!remoteUrl || remoteUrl.trim() === '') {
      return ''; // Return empty string for default avatar handling
    }

    try {
      // Step 1: Check cache
      const cachedBlob = await CacheService.getAvatarBlob(employeeId);

      if (cachedBlob) {
        // Step 2: Check if verified today
        const checkedToday = await CacheService.isAvatarCheckedToday(employeeId);

        if (checkedToday) {
          // Cache is fresh, return immediately
          return URL.createObjectURL(cachedBlob);
        }

        // Step 3: Cache exists but not verified today - trigger background check
        this.backgroundCheck(employeeId, remoteUrl);

        // Return cached version immediately (non-blocking)
        return URL.createObjectURL(cachedBlob);
      }

      // Step 4: No cache, download and cache
      return await this.downloadAndCache(employeeId, remoteUrl);

    } catch (error) {
      // Fallback to remote URL on error
      return remoteUrl;
    }
  }

  /**
   * Check and update avatars for all employees (non-blocking background task)
   *
   * @param employees - Array of employees to check
   *
   * This method runs in the background and does not block UI initialization.
   * It checks each employee's avatar freshness and triggers downloads if needed.
   */
  static async checkAndUpdateAvatars(employees: Employee[]): Promise<void> {

    for (const emp of employees) {
      // Skip employees without avatar URLs
      if (!emp.profile_photo_url || emp.profile_photo_url.trim() === '') {
        continue;
      }

      try {
        // Check if avatar was verified today
        const checkedToday = await CacheService.isAvatarCheckedToday(emp.id);

        if (!checkedToday) {
          // Not verified today, trigger background download (non-blocking)
          this.backgroundCheck(emp.id, emp.profile_photo_url);
        }
      } catch (error) {
        // Single employee failure should not affect others
      }
    }

  }

  /**
   * Force refresh a specific employee's avatar
   *
   * @param employeeId - Employee ID
   * @param remoteUrl - Remote avatar URL
   * @returns New avatar URL (object URL)
   *
   * Use this when you know the avatar has been updated remotely.
   */
  static async refreshAvatar(employeeId: string, remoteUrl: string): Promise<string> {

    try {
      return await this.downloadAndCache(employeeId, remoteUrl);
    } catch (error) {
      // Fallback to remote URL
      return remoteUrl;
    }
  }

  /**
   * Clean up stale avatars (not used for 30+ days)
   *
   * This is a placeholder for future implementation.
   * Could be triggered by a periodic maintenance task.
   */
  static async cleanupStaleAvatars(): Promise<void> {
    // TODO: Future implementation
    // 1. Get all cached avatars
    // 2. Check cached_at timestamp
    // 3. Delete avatars older than 30 days
  }

  // ==================== Private Helper Methods ====================

  /**
   * Background check: download and update avatar (non-blocking)
   *
   * @param employeeId - Employee ID
   * @param remoteUrl - Remote avatar URL
   *
   * This method runs asynchronously without blocking the caller.
   * Failures are silently caught to avoid disrupting the user experience.
   */
  private static backgroundCheck(employeeId: string, remoteUrl: string): void {
    // Fire and forget - do not await
    this.downloadAndCache(employeeId, remoteUrl)
      .then(() => {
      })
      .catch((error) => {
        // Silent failure - log only
      });
  }

  /**
   * Download avatar from remote URL and cache it
   *
   * @param employeeId - Employee ID
   * @param remoteUrl - Remote avatar URL
   * @returns Object URL for the downloaded avatar
   *
   * This method:
   * 1. Downloads the avatar as a Blob
   * 2. Stores it in IndexedDB
   * 3. Marks it as checked today
   * 4. Returns an object URL for immediate use
   */
  private static async downloadAndCache(employeeId: string, remoteUrl: string): Promise<string> {
    try {
      // Step 1: Download avatar as Blob
      const response = await fetch(remoteUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const blob = await response.blob();

      // Step 2: Cache the Blob in IndexedDB
      const objectUrl = await CacheService.setAvatarBlob(employeeId, blob);

      // Step 3: Mark as checked today
      await CacheService.markAvatarChecked(employeeId);

      return objectUrl;

    } catch (error) {
      throw error; // Re-throw to let caller handle fallback
    }
  }
}

// Expose to window for HTML compatibility
if (typeof window !== 'undefined') {
  (window as any).AvatarCacheService = AvatarCacheService;
}

export { AvatarCacheService };
