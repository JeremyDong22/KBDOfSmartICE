// Version: 1.6 - Added handleVideoUpload and clearVideoSelection functions
// Defines global window interfaces and Vite environment variables

import type { AuthService } from '@services/auth.service';
import type { KBDService } from '@services/kbd.service';
import type { RealtimeService } from '@services/realtime.service';
import type { CacheService } from '@services/cache.service';
import type { AvatarCacheService } from '@services/avatar-cache.service';
import type { MapModule } from '@modules/map';
import type { CheckInModule } from '@modules/checkin';
import type { UIModule } from '@modules/ui';
import type { EdgeIndicatorsModule } from '@modules/edge-indicators';
import type { TimeControlModule } from '@modules/time-control';
import type { TimeScheduler } from '@modules/time-scheduler';
import type { AppModule } from '@modules/app';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SlotType } from './models';

declare global {
  interface Window {
    // Services
    AuthService: typeof AuthService;
    KBDService: typeof KBDService;
    RealtimeService: typeof RealtimeService;
    CacheService: typeof CacheService;
    AvatarCacheService: typeof AvatarCacheService;
    supabaseClient: SupabaseClient;

    // Modules
    MapModule: typeof MapModule;
    CheckInModule: typeof CheckInModule;
    UIModule: typeof UIModule;
    EdgeIndicatorsModule: typeof EdgeIndicatorsModule;
    TimeControlModule: typeof TimeControlModule;
    TimeScheduler: typeof TimeScheduler;
    AppModule: typeof AppModule;

    // Global functions exposed for HTML onclick handlers
    submitCheckIn: () => Promise<void>;
    startRecording: (event: Event) => Promise<void>;
    stopRecording: (event: Event) => void;
    toggleVideoRecording: () => Promise<void>;
    handleVideoUpload: (event: Event) => Promise<void>;
    clearVideoSelection: () => void;
    handleTimeJump: (slot: SlotType | null) => Promise<void>;
  }

  interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL: string;
    readonly VITE_SUPABASE_ANON_KEY: string;
    readonly DEV: boolean;
    readonly PROD: boolean;
    readonly MODE: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

export {};
