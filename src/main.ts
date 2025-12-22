// Version: 5.0 - TypeScript main entry point
// Main application initialization - imports styles, modules, and starts the app

// Import styles in order
import './styles/variables.css';
import './styles/base.css';
import './styles/main.css';
import 'leaflet/dist/leaflet.css';

// Import services (no side effects, but needed for window exposure)
import { AuthService } from '@services/auth.service';
import { KBDService } from '@services/kbd.service';

// Import modules in order (CRITICAL: preserve load order)
// EdgeIndicators → Map → CheckIn → UI → App
import { EdgeIndicatorsModule } from '@modules/edge-indicators';
import { MapModule } from '@modules/map';
import { CheckInModule } from '@modules/checkin';
import { UIModule } from '@modules/ui';
import { AppModule } from '@modules/app';

// These imports are needed for window exposure (side effects)
// TypeScript may warn they're unused, but they're required for HTML onclick handlers
void AuthService;
void KBDService;
void EdgeIndicatorsModule;
void MapModule;
void CheckInModule;
void UIModule;

console.log('[MAIN] Main entry point loaded');

/**
 * Initialize application
 */
const initApp = async (): Promise<void> => {
  console.log('[MAIN] Initializing application');

  // Wait for DOM if not ready
  if (document.readyState === 'loading') {
    await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve));
  }

  console.log('[MAIN] DOM ready, starting app module');

  // Initialize app (will handle authentication check internally)
  await AppModule.init();
};

// Start app
initApp().catch(error => {
  console.error('[MAIN] Fatal error during initialization:', error);
  alert('应用初始化失败：' + (error instanceof Error ? error.message : 'Unknown error'));
});
