// Version: 5.2 - Center-out layout; automatically skips restaurants without markers (null coords)
// Edge Indicators Module - Off-screen restaurant navigation indicators
// Handles: Detecting off-screen markers, rendering edge indicators, center-out position calculation

import L from 'leaflet';
import type { Restaurant } from '@/types/models';


interface OffScreenRestaurant {
  restaurant: Restaurant;
  markerLatLng: L.LatLng;
  index: number;
  side: 'left' | 'right';
}

interface IndicatorPosition {
  restaurant: Restaurant;
  markerLatLng: L.LatLng;
  index: number;
  x: number;
  y: number;
}

export class EdgeIndicatorsModule {
  // State
  private static indicators: Record<string, HTMLElement> = {};
  private static updateInterval: number | null = null;
  private static map: L.Map | null = null;
  private static restaurants: Restaurant[] = [];
  private static hasMapInteraction: boolean = false;

  /**
   * Initialize edge indicators
   */
  static initialize(mapInstance: L.Map, restaurantData: Restaurant[]): void {

    this.map = mapInstance;
    this.restaurants = restaurantData;

    // Start monitoring map movements (Leaflet events)
    this.map.on('moveend', () => {
      this.hasMapInteraction = true;
      this.updateIndicators();
    });
    this.map.on('zoomend', () => {
      this.hasMapInteraction = true;
      this.updateIndicators();
    });

    // Initial update
    this.updateIndicators();

    // Periodic update only if user interacted with map
    this.updateInterval = window.setInterval(() => {
      if (this.hasMapInteraction) {
        this.updateIndicators();
        this.hasMapInteraction = false;
      }
    }, 2000);

  }

  /**
   * Update restaurant data
   */
  static updateRestaurantData(restaurantData: Restaurant[]): void {
    this.restaurants = restaurantData;
    this.updateIndicators();
  }

  /**
   * Main update function - checks which markers are off-screen and shows indicators
   */
  static updateIndicators(): void {
    if (!this.map) return;

    const bounds = this.map.getBounds();
    const mapContainer = this.map.getContainer();
    const mapRect = mapContainer.getBoundingClientRect();

    // Import MapModule dynamically to avoid circular dependency
    const MapModule = window.MapModule;
    if (!MapModule) return;

    // Collect all off-screen restaurants with their data
    const offScreenRestaurants: OffScreenRestaurant[] = [];
    const offScreenIds = new Set<string>();

    this.restaurants.forEach((restaurant, index) => {
      const marker = MapModule.markers[restaurant.id];
      if (!marker) return;

      // Leaflet: getLatLng() returns {lat, lng}
      const markerLatLng = marker.getLatLng();

      // Check if marker is outside viewport (Leaflet bounds)
      if (!bounds.contains(markerLatLng)) {
        const mapCenter = this.map!.getCenter();
        const centerPoint = this.map!.latLngToContainerPoint(mapCenter);
        const markerPoint = this.map!.latLngToContainerPoint(markerLatLng);
        const dx = markerPoint.x - centerPoint.x;

        offScreenRestaurants.push({
          restaurant,
          markerLatLng,
          index,
          side: dx >= 0 ? 'right' : 'left'
        });
        offScreenIds.add(`edge-indicator-${restaurant.id}`);
      }
    });

    // Remove indicators for restaurants that are now on-screen
    Object.keys(this.indicators).forEach(indicatorId => {
      if (!offScreenIds.has(indicatorId)) {
        this.indicators[indicatorId]?.remove();
        delete this.indicators[indicatorId];
      }
    });

    // Calculate positions for all indicators
    const positions = this.calculateIndicatorPositions(offScreenRestaurants, mapRect);

    // Create or update indicators with calculated positions
    positions.forEach(({ restaurant, markerLatLng, index, x, y }) => {
      this.createOrUpdateIndicator(restaurant, markerLatLng, index, x, y);
    });
  }

  /**
   * Calculate optimal positions for all indicators - center-out distribution
   * Starts from vertical center of screen edge, expands alternately up and down
   * No overlap (can touch), with corner offset
   */
  static calculateIndicatorPositions(offScreenRestaurants: OffScreenRestaurant[], mapRect: DOMRect): IndicatorPosition[] {
    const width = mapRect.width;
    const height = mapRect.height;
    const edgePadding = 30;
    const indicatorSize = 44; // From CSS
    const indicatorSpacing = 0; // Can touch but not overlap
    const cornerOffsetPercent = 0.12; // 12% offset from corners

    const cornerOffset = height * cornerOffsetPercent;
    const minY = cornerOffset;
    const maxY = height - cornerOffset;
    const centerY = height / 2;

    // Group by side
    const leftSide = offScreenRestaurants.filter(r => r.side === 'left');
    const rightSide = offScreenRestaurants.filter(r => r.side === 'right');

    const positions: IndicatorPosition[] = [];

    // Process each side with center-out distribution
    [leftSide, rightSide].forEach((sideRestaurants, sideIndex) => {
      if (sideRestaurants.length === 0) return;

      const isRight = sideIndex === 1;
      const x = isRight ? width - edgePadding : edgePadding;

      // Sort by distance from center (closest to center first)
      const sortedByCenter = [...sideRestaurants].sort((a, b) => {
        const aPoint = this.map!.latLngToContainerPoint(a.markerLatLng);
        const bPoint = this.map!.latLngToContainerPoint(b.markerLatLng);
        const aDist = Math.abs(aPoint.y - centerY);
        const bDist = Math.abs(bPoint.y - centerY);
        return aDist - bDist;
      });

      // Distribute from center outward, alternating up and down
      const distributedPositions: number[] = [];
      let upOffset = 0;
      let downOffset = 0;
      const step = indicatorSize + indicatorSpacing;

      sortedByCenter.forEach((item, i) => {
        let y: number;

        if (i === 0) {
          // First item goes to center
          y = centerY;
        } else if (i % 2 === 1) {
          // Odd items go up
          upOffset += step;
          y = centerY - upOffset;
        } else {
          // Even items go down
          downOffset += step;
          y = centerY + downOffset;
        }

        // Clamp to corner offset bounds
        y = Math.max(minY, Math.min(maxY, y));
        distributedPositions.push(y);

        positions.push({
          restaurant: item.restaurant,
          markerLatLng: item.markerLatLng,
          index: item.index,
          x,
          y
        });
      });
    });

    return positions;
  }

  /**
   * Create or update an edge indicator at a specific position
   */
  static createOrUpdateIndicator(restaurant: Restaurant, _markerLatLng: L.LatLng, _index: number, x: number, y: number): void {
    const indicatorId = `edge-indicator-${restaurant.id}`;
    let indicator = this.indicators[indicatorId];

    if (indicator) {
      // Update existing indicator
      indicator.style.left = `${x}px`;
      indicator.style.top = `${y}px`;

      // Update checked state
      indicator.classList.toggle('checked', restaurant.checked || false);
      indicator.classList.toggle('not-checked', !restaurant.checked);
    } else {
      // Create new indicator element
      indicator = document.createElement('div');
      indicator.id = indicatorId;
      indicator.className = `edge-indicator ${restaurant.checked ? 'checked' : 'not-checked'}`;
      indicator.style.left = `${x}px`;
      indicator.style.top = `${y}px`;
      indicator.style.transform = `translate(-50%, -50%)`;

      // Avatar with initials or photo
      const manager = restaurant.master_employee?.[0] || { employee_name: restaurant.restaurant_name, profile_photo_url: null };
      const initials = manager.employee_name?.substring(0, 2) || restaurant.restaurant_name?.substring(0, 2) || '店';
      const avatarUrl = 'profile_photo_url' in manager ? manager.profile_photo_url : null;

      if (avatarUrl) {
        // Use profile photo
        indicator.innerHTML = `<img class="edge-indicator-avatar" src="${avatarUrl}" alt="${manager.employee_name}">`;
      } else {
        // Use text initials
        indicator.innerHTML = `<div class="edge-indicator-avatar" data-initials="${initials}">${initials}</div>`;
      }

      // Click handler - navigate to restaurant
      indicator.addEventListener('click', () => {
        const MapModule = window.MapModule;
        if (MapModule && MapModule.focusOnRestaurant) {
          MapModule.focusOnRestaurant(restaurant.id);
        }
      });

      // Add to DOM
      document.body.appendChild(indicator);
      this.indicators[indicatorId] = indicator;

    }
  }

  /**
   * Clear all edge indicators
   */
  static clearIndicators(): void {
    Object.values(this.indicators).forEach(indicator => {
      indicator.remove();
    });
    this.indicators = {};
  }

  /**
   * Destroy module and clean up
   */
  static destroy(): void {

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    this.clearIndicators();

    if (this.map) {
      this.map.off('moveend');
      this.map.off('zoomend');
    }

    this.map = null;
    this.restaurants = [];
  }
}

// Export to window for backward compatibility
if (typeof window !== 'undefined') {
  window.EdgeIndicatorsModule = EdgeIndicatorsModule;
}
