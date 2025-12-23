// Version: 1.2 - Added environment guards for console.logs (production cleanup)
// Monitors kbd_check_in_record table INSERT events and notifies subscribers

import { supabaseClient } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { CheckInRecord } from '@/types/models';

// Debug logging only in development mode
const debugLog = (...args: unknown[]) => {
  if (import.meta.env.DEV) {
    console.log(...args);
  }
};

/**
 * Callback type for new check-in notifications
 */
type CheckInCallback = (record: CheckInRecord) => void;

/**
 * RealtimeService - Supabase Realtime subscription manager
 */
export class RealtimeService {
  private static channel: RealtimeChannel | null = null;
  private static callbacks: Set<CheckInCallback> = new Set();
  private static _isConnected: boolean = false;

  /**
   * Initialize and start subscribing to kbd_check_in_record INSERT events
   */
  static async init(): Promise<void> {
    if (this.channel) {
      // eslint-disable-next-line no-console
      debugLog('[RealtimeService] Already initialized, skipping...');
      return;
    }

    // eslint-disable-next-line no-console
    debugLog('[RealtimeService] Initializing subscription...');

    this.channel = supabaseClient
      .channel('kbd-check-ins')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'kbd_check_in_record'
      }, (payload) => {
        const receiveTime = performance.now();
        const receiveDate = new Date();
        const localTime = receiveDate.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + receiveDate.getMilliseconds().toString().padStart(3, '0');

        // eslint-disable-next-line no-console
        debugLog(`[RealtimeService] ⏱️ ${localTime} | 📥 RECEIVED`, {
          eventType: payload.eventType,
          table: payload.table,
          commit_timestamp: payload.commit_timestamp
        });

        const newRecord = payload.new as CheckInRecord;

        // Calculate server -> client latency
        if (payload.commit_timestamp) {
          const serverTime = new Date(payload.commit_timestamp);
          const latencyMs = receiveDate.getTime() - serverTime.getTime();
          // eslint-disable-next-line no-console
          debugLog(`[RealtimeService] ⏱️ ${localTime} | 📊 LATENCY`, {
            server_time: payload.commit_timestamp,
            client_time: receiveDate.toISOString(),
            latency_ms: latencyMs,
            latency_display: latencyMs > 1000 ? `${(latencyMs/1000).toFixed(1)}s` : `${latencyMs}ms`
          });
        }

        // Log record details
        // eslint-disable-next-line no-console
        debugLog(`[RealtimeService] ⏱️ ${localTime} | 📋 RECORD`, {
          id: newRecord.id,
          restaurant_id: newRecord.restaurant_id,
          employee_id: newRecord.employee_id,
          slot_type: newRecord.slot_type,
          check_in_at: newRecord.check_in_at,
          created_at: newRecord.created_at
        });

        // Calculate DB insert -> client receive latency
        if (newRecord.created_at) {
          const dbInsertTime = new Date(newRecord.created_at);
          const dbToClientMs = receiveDate.getTime() - dbInsertTime.getTime();
          // eslint-disable-next-line no-console
          debugLog(`[RealtimeService] ⏱️ ${localTime} | 📊 DB->CLIENT`, {
            db_created_at: newRecord.created_at,
            total_latency_ms: dbToClientMs,
            total_latency_display: dbToClientMs > 1000 ? `${(dbToClientMs/1000).toFixed(1)}s` : `${dbToClientMs}ms`
          });
        }

        // Notify all registered callbacks with timing
        const callbackStart = performance.now();
        let callbackCount = 0;

        this.callbacks.forEach((cb) => {
          const cbStart = performance.now();
          try {
            cb(newRecord);
            const cbDuration = performance.now() - cbStart;
            // eslint-disable-next-line no-console
            debugLog(`[RealtimeService] ⏱️ ${localTime} | ✅ CALLBACK #${callbackCount + 1}`, { duration_ms: cbDuration.toFixed(2) });
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[RealtimeService] Callback execution error:', err);
          }
          callbackCount++;
        });

        const totalCallbackTime = performance.now() - callbackStart;
        const totalProcessTime = performance.now() - receiveTime;

        // eslint-disable-next-line no-console
        debugLog(`[RealtimeService] ⏱️ ${localTime} | 📊 COMPLETE`, {
          callbacks_executed: callbackCount,
          callback_total_ms: totalCallbackTime.toFixed(2),
          total_process_ms: totalProcessTime.toFixed(2)
        });

        // eslint-disable-next-line no-console
        debugLog('─'.repeat(60));
      })
      .subscribe((status) => {
        // eslint-disable-next-line no-console
        debugLog('[RealtimeService] Subscription status:', status);
        this._isConnected = status === 'SUBSCRIBED';

        if (status === 'SUBSCRIBED') {
          // eslint-disable-next-line no-console
          debugLog('[RealtimeService] ✅ Successfully subscribed to real-time updates');
        } else if (status === 'CHANNEL_ERROR') {
          // eslint-disable-next-line no-console
          console.error('[RealtimeService] ❌ Channel error occurred');
        } else if (status === 'TIMED_OUT') {
          // eslint-disable-next-line no-console
          console.error('[RealtimeService] ❌ Subscription timed out');
        } else if (status === 'CLOSED') {
          // eslint-disable-next-line no-console
          debugLog('[RealtimeService] Channel closed');
          this._isConnected = false;
        }
      });
  }

  /**
   * Register a callback for new check-in events
   */
  static onNewCheckIn(callback: CheckInCallback): () => void {
    this.callbacks.add(callback);
    // eslint-disable-next-line no-console
    debugLog('[RealtimeService] Callback registered, total callbacks:', this.callbacks.size);

    return () => {
      this.callbacks.delete(callback);
      // eslint-disable-next-line no-console
      debugLog('[RealtimeService] Callback removed, remaining callbacks:', this.callbacks.size);
    };
  }

  /**
   * Stop subscription and clean up all resources
   */
  static stop(): void {
    if (this.channel) {
      // eslint-disable-next-line no-console
      debugLog('[RealtimeService] Stopping subscription...');
      supabaseClient.removeChannel(this.channel);
      this.channel = null;
      this._isConnected = false;
      this.callbacks.clear();
      // eslint-disable-next-line no-console
      debugLog('[RealtimeService] Subscription stopped and cleaned up');
    }
  }

  /**
   * Get current connection status
   */
  static isConnected(): boolean {
    return this._isConnected;
  }
}

// Expose to window for debugging
if (typeof window !== 'undefined') {
  window.RealtimeService = RealtimeService;
}
