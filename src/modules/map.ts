// Version: 5.9 - Fixed updateAllMarkers to target inner .avatar-marker element (not Leaflet wrapper)
// Map Module - Leaflet.js map initialization and marker management
// Philosophy: Rely on browser's built-in HTTP cache to minimize API requests
// Handles: Map initialization, marker creation, marker updates, restaurant navigation, history panel, media preview

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AuthService } from '@services/auth.service';
import { KBDService } from '@services/kbd.service';
import type { Restaurant, CheckInRecord, Task } from '@/types/models';

console.log('[MAP] Module loaded');

export class MapModule {
  // State
  static map: L.Map | null = null;
  static markers: Record<string, L.Marker> = {};
  static initialView: { lat: number; lng: number; zoom: number } | null = null;

  // History panel state
  private static historyPanel: HTMLDivElement | null = null;
  private static historyOffset: number = 0;
  private static historyHasMore: boolean = true;
  private static historyLoading: boolean = false;
  private static currentRestaurantId: string | null = null;

  /**
   * LocalStorage key format for read status: kbd_read_{restaurantId}_{date}_{slotType}
   */
  private static getReadKey(restaurantId: string, date: string, slotType: string): string {
    return `kbd_read_${restaurantId}_${date}_${slotType}`;
  }

  /**
   * Check if a check-in has been read by current user
   */
  private static isCheckInRead(restaurantId: string, checkInDate: string, slotType: string): boolean {
    const key = this.getReadKey(restaurantId, checkInDate, slotType);
    return localStorage.getItem(key) === 'true';
  }

  /**
   * Mark a check-in as read
   */
  private static markCheckInAsRead(restaurantId: string, checkInDate: string, slotType: string): void {
    const key = this.getReadKey(restaurantId, checkInDate, slotType);
    localStorage.setItem(key, 'true');
    console.log('[MAP] Marked check-in as read:', key);
  }

  /**
   * Initialize Leaflet map with OpenStreetMap tiles
   */
  static async initialize(restaurants: Restaurant[]): Promise<void> {
    console.log('[MAP] Initializing Leaflet map with', restaurants.length, 'restaurants');

    if (restaurants.length === 0) {
      console.error('[MAP] No restaurants to display');
      alert('没有找到门店数据');
      return;
    }

    // If map already exists, just update markers instead of re-initializing
    if (this.map) {
      console.log('[MAP] Map already initialized, updating markers only');
      this.updateAllMarkers(restaurants);
      return;
    }

    // Find current user's restaurant for initial focus
    const currentUser = AuthService.getCurrentUser();
    const userRestaurant = restaurants.find(r => r.id === currentUser?.restaurant_id);

    // Filter restaurants with valid coordinates for center calculation
    const validRestaurants = restaurants.filter(r =>
      r.latitude != null && r.longitude != null &&
      !isNaN(parseFloat(String(r.latitude))) && !isNaN(parseFloat(String(r.longitude)))
    );

    let centerLat: number, centerLng: number, initialZoom: number;

    // Check if user restaurant has valid coordinates
    const userHasValidCoords = userRestaurant &&
      userRestaurant.latitude != null && userRestaurant.longitude != null &&
      !isNaN(parseFloat(String(userRestaurant.latitude))) && !isNaN(parseFloat(String(userRestaurant.longitude)));

    if (userHasValidCoords) {
      centerLat = parseFloat(String(userRestaurant!.latitude));
      centerLng = parseFloat(String(userRestaurant!.longitude));
      initialZoom = 13;
      console.log('[MAP] Centering on user restaurant:', userRestaurant!.restaurant_name);
    } else if (validRestaurants.length > 0) {
      centerLat = validRestaurants.reduce((sum, r) => sum + parseFloat(String(r.latitude)), 0) / validRestaurants.length;
      centerLng = validRestaurants.reduce((sum, r) => sum + parseFloat(String(r.longitude)), 0) / validRestaurants.length;
      initialZoom = 11;
      console.log('[MAP] User restaurant not found or invalid coords, using average center of', validRestaurants.length, 'valid restaurants');
    } else {
      // Fallback to default coordinates if no valid restaurants
      centerLat = 31.47;
      centerLng = 104.73;
      initialZoom = 11;
      console.log('[MAP] No valid restaurant coordinates, using default center');
    }

    console.log('[MAP] Center coordinates:', { lat: centerLat, lng: centerLng, zoom: initialZoom });

    // Store initial view for recenter button
    this.initialView = {
      lat: centerLat || 31.47,
      lng: centerLng || 104.73,
      zoom: initialZoom
    };

    // Create Leaflet map with normal interaction
    this.map = L.map('map', {
      center: [centerLat || 31.47, centerLng || 104.73],
      zoom: initialZoom,
      minZoom: 9,       // Allow wide view
      maxZoom: 18,      // Allow close-up for nearby stores
      zoomControl: true  // Show zoom buttons
    });

    // Add Gaode (高德) map tiles with aggressive browser caching
    // Browser will cache tiles automatically, reducing repeat requests
    // Note: If coordinates are in WGS-84, they will have ~100-600m offset in China
    const gaodeTileLayer = L.tileLayer(
      'https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1&style=7',
      {
        subdomains: ['1', '2', '3', '4'],
        attribution: '© 高德地图',
        maxZoom: 18,
        minZoom: 3,
        // Optimize for caching
        crossOrigin: true,
        className: 'gaode-tiles'  // Custom class for styling
      }
    );
    gaodeTileLayer.addTo(this.map);

    console.log('[MAP] Leaflet map created successfully');

    // Add markers
    restaurants.forEach((restaurant, index) => {
      this.addMarker(restaurant, index);
    });
  }

  /**
   * Add a restaurant marker to the map
   */
  static addMarker(restaurant: Restaurant, _index: number): void {
    // Skip restaurants with null/invalid coordinates
    const lat = parseFloat(String(restaurant.latitude));
    const lng = parseFloat(String(restaurant.longitude));
    if (isNaN(lat) || isNaN(lng) || restaurant.latitude == null || restaurant.longitude == null) {
      console.log('[MAP] Skipping restaurant with invalid coordinates:', restaurant.restaurant_name);
      return;
    }

    console.log('[MAP] Adding Leaflet marker for:', restaurant.restaurant_name);

    const currentUser = AuthService.getCurrentUser();
    const isChecked = restaurant.checked || false;
    const isCurrentUser = restaurant.id === currentUser?.restaurant_id;

    const manager = restaurant.master_employee?.[0] || { employee_name: restaurant.restaurant_name, profile_photo_url: null };
    const initials = manager.employee_name?.substring(0, 2) || restaurant.restaurant_name?.substring(0, 2) || '店';
    const avatarUrl = 'profile_photo_url' in manager ? manager.profile_photo_url : null;

    // Check if thumbnail should be visible (DEV-9: only show in current time window, hide when outside)
    // Thumbnail is visible when: has media AND NOT in display mode (i.e., in active time window)
    const showThumbnail = isChecked && restaurant.checkInData?.media_urls?.[0] &&
                         !restaurant.displayMode;  // Hide thumbnails in display mode (outside time window)
    const thumbnailUrl = showThumbnail ? restaurant.checkInData!.media_urls![0] : null;

    // Check if text bubble should be visible (for text-type check-ins)
    const showTextBubble = isChecked && !thumbnailUrl && restaurant.checkInData?.text_content &&
                          !restaurant.displayMode;
    const textContent = showTextBubble ? restaurant.checkInData!.text_content : null;

    // Create marker HTML
    const markerEl = document.createElement('div');
    markerEl.className = `avatar-marker ${isChecked ? 'checked' : 'not-checked'} ${isCurrentUser ? 'current-user' : ''}`;
    markerEl.setAttribute('data-id', restaurant.id);
    markerEl.innerHTML = `
            <div class="completion-badge"></div>
            ${thumbnailUrl ? `
            <div class="avatar-thumbnail ${showThumbnail ? 'visible' : ''}" id="thumb-${restaurant.id}">
                <img src="${thumbnailUrl}" alt="">
            </div>
            ` : ''}
            ${textContent ? `
            <div class="avatar-text-bubble ${showTextBubble ? 'visible' : ''}" id="text-${restaurant.id}">
                <span class="text-quote">"${textContent}"</span>
            </div>
            ` : ''}
            <div class="avatar-img" data-initials="${initials}" ${avatarUrl ? `style="background-image: url('${avatarUrl}'); background-size: cover; background-position: center;"` : ''}>${avatarUrl ? '' : initials}</div>
            <span class="avatar-name">${restaurant.restaurant_name}</span>
        `;

    // Create Leaflet marker with custom icon
    const icon = L.divIcon({
      html: markerEl.outerHTML,
      className: '',  // Remove default Leaflet icon classes
      iconSize: [56, 56],  // Size of the icon (avatar size)
      iconAnchor: [28, 28],  // Point that corresponds to marker's location (center of avatar)
      popupAnchor: [0, -28]  // Popup opens above the marker
    });

    const marker = L.marker(
      [lat, lng],
      { icon: icon }
    ).addTo(this.map!);

    this.markers[restaurant.id] = marker;

    // Add click handlers (need to wait for DOM)
    setTimeout(() => {
      const markerElement = marker.getElement();
      if (markerElement) {
        const avatarImg = markerElement.querySelector('.avatar-img');
        const thumbnailElement = markerElement.querySelector('.avatar-thumbnail img');

        if (avatarImg) {
          avatarImg.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showRestaurantHistory(restaurant);
          });
        }

        if (thumbnailElement) {
          thumbnailElement.addEventListener('click', (e) => {
            e.stopPropagation();
            this.previewMedia(restaurant);
          });
        }
      }
    }, 100);

    console.log('[MAP] Leaflet marker added successfully');
  }

  /**
   * Update all markers with new restaurant data
   */
  static updateAllMarkers(restaurants: Restaurant[]): void {
    console.log('[MAP] Updating all markers with fresh data');

    const currentUser = AuthService.getCurrentUser();

    restaurants.forEach((restaurant) => {
      const existingMarker = this.markers[restaurant.id];

      if (existingMarker) {
        const isChecked = restaurant.checked || false;
        const isCurrentUser = restaurant.id === currentUser?.restaurant_id;

        const markerElement = existingMarker.getElement();
        if (markerElement) {
          // Check if thumbnail should be visible (DEV-9: only in time window, not in display mode past window)
          // Thumbnail is visible when: has media AND NOT in display mode (i.e., in active time window)
          const showThumbnail = isChecked && restaurant.checkInData?.media_urls?.[0] &&
                               !restaurant.displayMode;  // Hide thumbnails in display mode (outside time window)
          const newThumbnailUrl = showThumbnail ? restaurant.checkInData!.media_urls![0] : null;

          // Update marker classes on the inner .avatar-marker element (not the Leaflet wrapper)
          const avatarMarker = markerElement.querySelector('.avatar-marker');
          if (avatarMarker) {
            avatarMarker.classList.toggle('checked', isChecked);
            avatarMarker.classList.toggle('not-checked', !isChecked);
            avatarMarker.classList.toggle('current-user', isCurrentUser);
          }

          // Update thumbnail
          const thumbnailContainer = markerElement.querySelector('.avatar-thumbnail');
          const thumbnailImg = thumbnailContainer?.querySelector('img') as HTMLImageElement | null;

          if (newThumbnailUrl) {
            if (thumbnailContainer && thumbnailImg) {
              // Update existing thumbnail
              if (thumbnailImg.src !== newThumbnailUrl) {
                thumbnailImg.src = newThumbnailUrl;
              }
              thumbnailContainer.classList.toggle('visible', Boolean(showThumbnail));
            } else {
              // Create new thumbnail
              const newThumbnail = document.createElement('div');
              newThumbnail.className = `avatar-thumbnail ${showThumbnail ? 'visible' : ''}`;
              newThumbnail.id = `thumb-${restaurant.id}`;
              newThumbnail.innerHTML = `<img src="${newThumbnailUrl}" alt="">`;
              const avatarImg = markerElement.querySelector('.avatar-img');
              if (avatarImg?.parentElement) {
                // Insert before avatar-img within the avatar-marker container
                avatarImg.parentElement.insertBefore(newThumbnail, avatarImg);
              }

              // Re-attach click handler
              setTimeout(() => {
                const img = newThumbnail.querySelector('img');
                if (img) {
                  img.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.previewMedia(restaurant);
                  });
                }
              }, 0);
            }
          } else if (thumbnailContainer) {
            // Hide or remove thumbnail if no media (DEV-9: outside time window)
            thumbnailContainer.classList.remove('visible');
          }

          // Handle text bubble for text-type check-ins
          const showTextBubble = isChecked && !newThumbnailUrl && restaurant.checkInData?.text_content &&
                                !restaurant.displayMode;
          const newTextContent = showTextBubble ? restaurant.checkInData!.text_content : null;
          const textBubbleContainer = markerElement.querySelector('.avatar-text-bubble');

          if (newTextContent) {
            if (textBubbleContainer) {
              // Update existing text bubble
              const textQuote = textBubbleContainer.querySelector('.text-quote');
              if (textQuote) {
                textQuote.textContent = `"${newTextContent}"`;
              }
              textBubbleContainer.classList.toggle('visible', Boolean(showTextBubble));
            } else {
              // Create new text bubble
              const newTextBubble = document.createElement('div');
              newTextBubble.className = `avatar-text-bubble ${showTextBubble ? 'visible' : ''}`;
              newTextBubble.id = `text-${restaurant.id}`;
              newTextBubble.innerHTML = `<span class="text-quote">"${newTextContent}"</span>`;
              const avatarImg = markerElement.querySelector('.avatar-img');
              if (avatarImg?.parentElement) {
                avatarImg.parentElement.insertBefore(newTextBubble, avatarImg);
              }
            }
          } else if (textBubbleContainer) {
            // Hide text bubble if no text content
            textBubbleContainer.classList.remove('visible');
          }
        }
      } else {
        this.addMarker(restaurant, 0);
      }
    });

    // Remove markers that no longer exist
    const restaurantIds = new Set(restaurants.map(r => r.id));
    Object.keys(this.markers).forEach(markerId => {
      if (!restaurantIds.has(markerId)) {
        this.map?.removeLayer(this.markers[markerId]!);
        delete this.markers[markerId];
      }
    });

    console.log('[MAP] All markers updated successfully');
  }

  /**
   * Set map blur state
   */
  static setBlur(blurred: boolean): void {
    const mapElement = document.getElementById('map');
    if (!mapElement) return;

    if (blurred) {
      console.log('[MAP] Applying blur effect');
      mapElement.classList.add('blurred');
    } else {
      console.log('[MAP] Removing blur effect');
      mapElement.classList.remove('blurred');
    }
  }

  /**
   * Focus map on a specific restaurant
   */
  static focusOnRestaurant(restaurantId: string): void {
    const marker = this.markers[restaurantId];
    if (marker && this.map) {
      console.log('[MAP] Focusing on restaurant:', restaurantId);
      const latlng = marker.getLatLng();
      this.map.flyTo([latlng.lat, latlng.lng], 15, {
        duration: 0.4  // Fast animation (0.4 seconds)
      });

      setTimeout(() => {
        const markerElement = marker.getElement();
        if (markerElement) {
          markerElement.classList.add('focus-pulse');
          setTimeout(() => markerElement.classList.remove('focus-pulse'), 600);
        }
      }, 200);  // Reduced delay before pulse animation
    } else {
      console.warn('[MAP] Restaurant marker not found:', restaurantId);
    }
  }

  /**
   * Get map instance
   */
  static getMap(): L.Map | null {
    return this.map;
  }

  /**
   * Recenter map to initial view
   */
  static recenterToInitialView(): void {
    if (!this.map || !this.initialView) {
      console.warn('[MAP] Cannot recenter: map or initialView not available');
      return;
    }

    console.log('[MAP] Recentering to initial view:', this.initialView);
    this.map.flyTo([this.initialView.lat, this.initialView.lng], this.initialView.zoom, {
      duration: 0.4  // Fast animation (0.4 seconds)
    });
  }

  /**
   * Show restaurant check-in history panel with lazy loading
   */
  static async showRestaurantHistory(restaurant: Restaurant): Promise<void> {
    console.log('[MAP] Showing history for restaurant:', restaurant.id);

    // Reset state
    this.currentRestaurantId = restaurant.id;
    this.historyOffset = 0;
    this.historyHasMore = true;
    this.historyLoading = false;

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'history-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.closeHistoryPanel();
      }
    });

    // Create panel
    this.historyPanel = document.createElement('div');
    this.historyPanel.className = 'history-panel';

    // Get manager info
    const manager = restaurant.master_employee?.[0];
    const managerName = manager?.employee_name || restaurant.restaurant_name;

    this.historyPanel.innerHTML = `
      <div class="history-header">
        <h3>${managerName}</h3>
        <button class="history-close-btn" aria-label="关闭">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="history-list-container">
        <div class="history-list" id="historyList"></div>
        <div class="history-loading" id="historyLoading" style="display: none;">
          <div class="spinner-small"></div>
          <span>加载中...</span>
        </div>
        <div class="history-end" id="historyEnd" style="display: none;">没有更多了</div>
      </div>
    `;

    overlay.appendChild(this.historyPanel);
    document.body.appendChild(overlay);

    // Add close button handler
    const closeBtn = this.historyPanel.querySelector('.history-close-btn');
    closeBtn?.addEventListener('click', () => this.closeHistoryPanel());

    // Add scroll handler for lazy loading
    const listContainer = this.historyPanel.querySelector('.history-list-container') as HTMLDivElement;
    listContainer.addEventListener('scroll', () => this.handleHistoryScroll());

    // Animate in
    requestAnimationFrame(() => {
      overlay.classList.add('visible');
    });

    // Load initial data
    await this.loadMoreHistory();
  }

  /**
   * Load more history records
   */
  private static async loadMoreHistory(): Promise<void> {
    if (this.historyLoading || !this.historyHasMore || !this.currentRestaurantId) {
      return;
    }

    this.historyLoading = true;
    const loadingEl = document.getElementById('historyLoading');
    if (loadingEl) loadingEl.style.display = 'flex';

    try {
      const { records, hasMore } = await KBDService.getCheckInHistory(
        this.currentRestaurantId,
        10,
        this.historyOffset
      );

      this.historyHasMore = hasMore;
      this.historyOffset += records.length;

      const listEl = document.getElementById('historyList');
      if (listEl) {
        records.forEach(record => {
          const item = this.createHistoryItem(record);
          listEl.appendChild(item);
        });
      }

      // Show end message if no more records
      if (!hasMore) {
        const endEl = document.getElementById('historyEnd');
        if (endEl) endEl.style.display = 'block';
      }
    } catch (error) {
      console.error('[MAP] Error loading history:', error);
      alert('加载历史记录失败');
    } finally {
      this.historyLoading = false;
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  /**
   * Create a history list item element
   */
  private static createHistoryItem(record: CheckInRecord & { task?: Task }): HTMLDivElement {
    const item = document.createElement('div');
    item.className = 'history-item';

    const checkInDate = new Date(record.check_in_at);
    const dateStr = checkInDate.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const timeStr = checkInDate.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    });

    // Slot type display names
    const slotTypeNames: Record<string, string> = {
      lunch_open: '午市开店',
      lunch_close: '午市闭店',
      dinner_open: '晚市开店',
      dinner_close: '晚市闭店'
    };

    const slotName = slotTypeNames[record.slot_type] || record.slot_type;
    const taskName = record.task?.task_name || '打卡任务';

    // Create thumbnail if media exists
    const thumbnailHtml = record.media_urls && record.media_urls.length > 0
      ? `<div class="history-item-thumbnail">
           <img src="${record.media_urls[0]}" alt="打卡照片" />
         </div>`
      : '';

    item.innerHTML = `
      ${thumbnailHtml}
      <div class="history-item-content">
        <div class="history-item-title">${taskName}</div>
        <div class="history-item-meta">
          <span class="history-item-date">${dateStr}</span>
          <span class="history-item-time">${timeStr}</span>
          <span class="history-item-slot">${slotName}</span>
        </div>
      </div>
    `;

    // Add click handler for thumbnail preview
    if (record.media_urls && record.media_urls.length > 0) {
      const thumbnail = item.querySelector('.history-item-thumbnail');
      thumbnail?.addEventListener('click', () => {
        this.previewMediaUrl(record.media_urls![0]!);
      });
    }

    return item;
  }

  /**
   * Handle scroll for lazy loading
   */
  private static handleHistoryScroll(): void {
    const listContainer = this.historyPanel?.querySelector('.history-list-container') as HTMLDivElement;
    if (!listContainer) return;

    const scrollTop = listContainer.scrollTop;
    const scrollHeight = listContainer.scrollHeight;
    const clientHeight = listContainer.clientHeight;

    // Trigger load when scrolled to bottom 100px
    if (scrollHeight - scrollTop - clientHeight < 100) {
      this.loadMoreHistory();
    }
  }

  /**
   * Close history panel
   */
  private static closeHistoryPanel(): void {
    const overlay = document.querySelector('.history-overlay');
    if (overlay) {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 300);
    }
    this.historyPanel = null;
    this.currentRestaurantId = null;
  }

  /**
   * Preview media URL (for history items)
   */
  private static previewMediaUrl(mediaUrl: string): void {
    console.log('[MAP] Previewing media:', mediaUrl);

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.9);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    `;

    const img = document.createElement('img');
    img.src = mediaUrl;
    img.style.cssText = `
      max-width: 90vw;
      max-height: 90vh;
      object-fit: contain;
    `;

    overlay.appendChild(img);
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
  }

  /**
   * Preview media from check-in (DEV-8: improved with image/audio/video support)
   */
  static previewMedia(restaurant: Restaurant): void {
    const mediaUrl = restaurant.checkInData?.media_urls?.[0];
    if (!mediaUrl) {
      console.warn('[MAP] No media to preview for:', restaurant.restaurant_name);
      return;
    }

    console.log('[MAP] Previewing media:', mediaUrl);

    // Mark as read for future use
    if (restaurant.checkInData) {
      this.markCheckInAsRead(restaurant.id, restaurant.checkInData.check_in_date, restaurant.checkInData.slot_type);
    }

    // Determine media type from URL extension
    const ext = mediaUrl.split('.').pop()?.toLowerCase() || '';
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext);
    const isVideo = ['mp4', 'mov', 'webm', 'ogg'].includes(ext);
    const isAudio = ['mp3', 'wav', 'ogg', 'm4a', 'aac'].includes(ext);

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'media-preview-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.95);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      cursor: pointer;
      padding: 20px;
    `;

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = `
      position: absolute;
      top: 20px;
      right: 20px;
      background: rgba(255,255,255,0.9);
      border: none;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      font-size: 24px;
      color: #333;
      cursor: pointer;
      z-index: 10001;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    `;
    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.background = '#fff';
      closeBtn.style.transform = 'scale(1.1)';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.background = 'rgba(255,255,255,0.9)';
      closeBtn.style.transform = 'scale(1)';
    });
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      overlay.remove();
    });
    overlay.appendChild(closeBtn);

    // Create media element based on type
    let mediaElement: HTMLElement;

    if (isImage) {
      // Image preview with zoom support
      const img = document.createElement('img');
      img.src = mediaUrl;
      img.style.cssText = `
        max-width: 90vw;
        max-height: 90vh;
        object-fit: contain;
        cursor: zoom-in;
        transition: transform 0.3s;
      `;

      let zoomed = false;
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!zoomed) {
          img.style.maxWidth = '150vw';
          img.style.maxHeight = '150vh';
          img.style.cursor = 'zoom-out';
          img.style.transform = 'scale(1.5)';
          zoomed = true;
        } else {
          img.style.maxWidth = '90vw';
          img.style.maxHeight = '90vh';
          img.style.cursor = 'zoom-in';
          img.style.transform = 'scale(1)';
          zoomed = false;
        }
      });

      mediaElement = img;
    } else if (isVideo) {
      // Video preview with controls
      const video = document.createElement('video');
      video.src = mediaUrl;
      video.controls = true;
      video.autoplay = true;
      video.style.cssText = `
        max-width: 90vw;
        max-height: 90vh;
        outline: none;
      `;

      video.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      mediaElement = video;
    } else if (isAudio) {
      // Audio preview with waveform visualization
      const audioContainer = document.createElement('div');
      audioContainer.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 20px;
      `;

      const icon = document.createElement('div');
      icon.innerHTML = '🎵';
      icon.style.cssText = `
        font-size: 80px;
        margin-bottom: 20px;
      `;

      const audio = document.createElement('audio');
      audio.src = mediaUrl;
      audio.controls = true;
      audio.autoplay = true;
      audio.style.cssText = `
        width: 400px;
        max-width: 90vw;
        outline: none;
      `;

      audio.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      audioContainer.appendChild(icon);
      audioContainer.appendChild(audio);
      mediaElement = audioContainer;
    } else {
      // Fallback for unknown types
      const fallback = document.createElement('div');
      fallback.style.cssText = `
        color: white;
        font-size: 16px;
        text-align: center;
      `;
      fallback.innerHTML = `
        <p>无法预览此文件类型</p>
        <a href="${mediaUrl}" target="_blank" style="color: #3b82f6; text-decoration: underline;">打开链接查看</a>
      `;
      mediaElement = fallback;
    }

    overlay.appendChild(mediaElement);

    // Close on overlay click (but not media click)
    overlay.addEventListener('click', () => overlay.remove());

    document.body.appendChild(overlay);
  }
}

// Export to window for backward compatibility
if (typeof window !== 'undefined') {
  window.MapModule = MapModule;
  console.log('[MAP] Module exported to window');
}
