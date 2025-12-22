// Version: 1.0 - Leaflet type extensions for KBD project
// Extends Leaflet types to support custom marker properties

import 'leaflet';

declare module 'leaflet' {
  interface MarkerOptions {
    restaurantId?: string;
  }

  // Extend Marker to include custom restaurant ID
  interface Marker {
    options: MarkerOptions;
  }
}

export {};
