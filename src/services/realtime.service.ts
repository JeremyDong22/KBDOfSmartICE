// Version: 1.0 - Supabase Realtime subscription service for check-in broadcasts
// Monitors kbd_check_in_record table INSERT events and notifies subscribers

import { supabaseClient } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { CheckInRecord } from '@/types/models';

/**
 * Callback type for new check-in notifications
 */
type CheckInCallback = (record: CheckInRecord) => void;

/**
 * RealtimeService - Supabase Realtime subscription manager
 *
 * Subscribes to kbd_check_in_record table INSERT events and broadcasts
 * new check-ins to registered callbacks for real-time UI updates.
 *
 * Usage:
 * ```typescript
 * // Initialize once at app startup
 * await RealtimeService.init();
 *
 * // Register callback
 * const unsubscribe = RealtimeService.onNewCheckIn((record) => {
 *   console.log('New check-in:', record);
 * });
 *
 * // Cleanup when done
 * unsubscribe();
 * ```
 */
export class RealtimeService {
  private static channel: RealtimeChannel | null = null;
  private static callbacks: Set<CheckInCallback> = new Set();
  private static _isConnected: boolean = false;

  /**
   * Initialize and start subscribing to kbd_check_in_record INSERT events
   *
   * Safe to call multiple times - will skip if already initialized.
   * Automatically updates IndexedDB cache and notifies all registered callbacks.
   */
  static async init(): Promise<void> {
    if (this.channel) {
      console.log('[RealtimeService] Already initialized, skipping...');
      return;
    }

    console.log('[RealtimeService] Initializing subscription...');

    this.channel = supabaseClient
      .channel('kbd-check-ins')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'kbd_check_in_record'
      }, (payload) => {
        console.log('[RealtimeService] New check-in received:', payload);
        const newRecord = payload.new as CheckInRecord;

        // Notify all registered callbacks
        this.callbacks.forEach(cb => {
          try {
            cb(newRecord);
          } catch (err) {
            console.error('[RealtimeService] Callback execution error:', err);
          }
        });
      })
      .subscribe((status) => {
        console.log('[RealtimeService] Subscription status:', status);
        this._isConnected = status === 'SUBSCRIBED';

        if (status === 'SUBSCRIBED') {
          console.log('[RealtimeService] Successfully subscribed to real-time updates');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[RealtimeService] Channel error occurred');
        } else if (status === 'TIMED_OUT') {
          console.error('[RealtimeService] Subscription timed out');
        } else if (status === 'CLOSED') {
          console.log('[RealtimeService] Channel closed');
          this._isConnected = false;
        }
      });
  }

  /**
   * Register a callback for new check-in events
   *
   * @param callback - Function to call when a new check-in is received
   * @returns Unsubscribe function to remove this callback
   *
   * @example
   * ```typescript
   * const unsubscribe = RealtimeService.onNewCheckIn((record) => {
   *   MapModule.updateAvatar(record.employee_id);
   * });
   *
   * // Later, when no longer needed
   * unsubscribe();
   * ```
   */
  static onNewCheckIn(callback: CheckInCallback): () => void {
    this.callbacks.add(callback);
    console.log('[RealtimeService] Callback registered, total callbacks:', this.callbacks.size);

    // Return unsubscribe function
    return () => {
      this.callbacks.delete(callback);
      console.log('[RealtimeService] Callback removed, remaining callbacks:', this.callbacks.size);
    };
  }

  /**
   * Stop subscription and clean up all resources
   *
   * Removes the Supabase channel, clears all callbacks, and resets connection state.
   * Safe to call multiple times.
   */
  static stop(): void {
    if (this.channel) {
      console.log('[RealtimeService] Stopping subscription...');
      supabaseClient.removeChannel(this.channel);
      this.channel = null;
      this._isConnected = false;
      this.callbacks.clear();
      console.log('[RealtimeService] Subscription stopped and cleaned up');
    } else {
      console.log('[RealtimeService] No active subscription to stop');
    }
  }

  /**
   * Get current connection status
   *
   * @returns true if subscribed to Realtime channel, false otherwise
   */
  static isConnected(): boolean {
    return this._isConnected;
  }
}

// Expose to window for backward compatibility with HTML onclick handlers and debugging
if (typeof window !== 'undefined') {
  window.RealtimeService = RealtimeService;
}
