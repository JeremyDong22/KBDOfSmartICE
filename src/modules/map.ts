// Version: 6.7 - Dynamic thumbnail sizing + smooth preview animations with loading spinner
// Map Module - Leaflet.js map initialization and marker management
// Philosophy: Rely on browser's built-in HTTP cache to minimize API requests
// Handles: Map initialization, marker creation, marker updates, restaurant navigation, history panel, media preview, night theme

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AuthService } from '@services/auth.service';
import { KBDService } from '@services/kbd.service';
import type { Restaurant, CheckInRecord, Task } from '@/types/models';


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
   * Check if URL is a video file based on extension
   */
  private static isVideoUrl(url: string): boolean {
    const ext = url.split('.').pop()?.toLowerCase() || '';
    return ['mp4', 'mov', 'webm', 'ogg', 'avi'].includes(ext);
  }

  /**
   * Check if URL is an audio file based on extension
   */
  private static isAudioUrl(url: string): boolean {
    const ext = url.split('.').pop()?.toLowerCase() || '';
    return ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'webm'].includes(ext);
  }

  /**
   * Create thumbnail element (image or video placeholder icon)
   */
  private static createThumbnailElement(mediaUrl: string, restaurantId: string, isVisible: boolean): string {
    const isVideo = this.isVideoUrl(mediaUrl);
    const isAudio = this.isAudioUrl(mediaUrl);

    if (isVideo) {
      // Video: show video icon placeholder instead of trying to load video as image
      return `
        <div class="avatar-thumbnail ${isVisible ? 'visible' : ''}" id="thumb-${restaurantId}">
          <div class="video-thumb-placeholder">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
        </div>
      `;
    } else if (isAudio) {
      // Audio: show audio icon placeholder
      return `
        <div class="avatar-thumbnail ${isVisible ? 'visible' : ''}" id="thumb-${restaurantId}">
          <div class="audio-thumb-placeholder">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
          </div>
        </div>
      `;
    } else {
      // Image: use img tag with dynamic sizing on load
      // Max dimensions for thumbnail (excluding padding)
      const maxW = 120;
      const maxH = 100;
      const padding = 12; // 6px padding on each side
      return `
        <div class="avatar-thumbnail ${isVisible ? 'visible' : ''}" id="thumb-${restaurantId}">
          <img src="${mediaUrl}" alt="" onload="
            (function(img) {
              var container = img.parentElement;
              var naturalW = img.naturalWidth;
              var naturalH = img.naturalHeight;
              var maxW = ${maxW - padding};
              var maxH = ${maxH - padding};
              var ratio = Math.min(maxW / naturalW, maxH / naturalH);
              var w = Math.round(naturalW * ratio) + ${padding};
              var h = Math.round(naturalH * ratio) + ${padding};
              container.style.width = w + 'px';
              container.style.height = h + 'px';
            })(this);
          ">
        </div>
      `;
    }
  }

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
  }

  /**
   * Initialize Leaflet map with OpenStreetMap tiles
   */
  static async initialize(restaurants: Restaurant[]): Promise<void> {

    if (restaurants.length === 0) {
      alert('没有找到门店数据');
      return;
    }

    // If map already exists, just update markers instead of re-initializing
    if (this.map) {
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
      initialZoom = 16;
    } else if (validRestaurants.length > 0) {
      centerLat = validRestaurants.reduce((sum, r) => sum + parseFloat(String(r.latitude)), 0) / validRestaurants.length;
      centerLng = validRestaurants.reduce((sum, r) => sum + parseFloat(String(r.longitude)), 0) / validRestaurants.length;
      initialZoom = 16;
    } else {
      // Fallback to default coordinates if no valid restaurants
      centerLat = 31.47;
      centerLng = 104.73;
      initialZoom = 11;
    }


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


    // Add markers
    restaurants.forEach((restaurant, index) => {
      this.addMarker(restaurant, index);
    });

    // Auto-set theme based on current time (night mode after 18:00)
    this.autoSetTheme();
  }

  /**
   * Add a restaurant marker to the map
   */
  static addMarker(restaurant: Restaurant, _index: number): void {
    // Skip restaurants with null/invalid coordinates
    const lat = parseFloat(String(restaurant.latitude));
    const lng = parseFloat(String(restaurant.longitude));
    if (isNaN(lat) || isNaN(lng) || restaurant.latitude == null || restaurant.longitude == null) {
      return;
    }


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

    // Create thumbnail HTML using helper method
    const thumbnailHtml = thumbnailUrl ? this.createThumbnailElement(thumbnailUrl, restaurant.id, Boolean(showThumbnail)) : '';

    markerEl.innerHTML = `
            <div class="completion-badge"></div>
            ${thumbnailHtml}
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
        const videoPlaceholder = markerElement.querySelector('.video-thumb-placeholder');
        const audioPlaceholder = markerElement.querySelector('.audio-thumb-placeholder');

        if (avatarImg) {
          avatarImg.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showRestaurantHistory(restaurant);
          });
        }

        // Click on image thumbnail
        if (thumbnailElement) {
          thumbnailElement.addEventListener('click', (e) => {
            e.stopPropagation();
            this.previewMedia(restaurant);
          });
        }

        // Click on video/audio placeholder
        if (videoPlaceholder || audioPlaceholder) {
          const placeholder = videoPlaceholder || audioPlaceholder;
          placeholder?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.previewMedia(restaurant);
          });
        }
      }
    }, 100);

  }

  /**
   * Update all markers with new restaurant data
   */
  static updateAllMarkers(restaurants: Restaurant[]): void {

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
          const isVideoFile = newThumbnailUrl ? this.isVideoUrl(newThumbnailUrl) : false;
          const isAudioFile = newThumbnailUrl ? this.isAudioUrl(newThumbnailUrl) : false;

          if (newThumbnailUrl) {
            // For images: update existing or create new
            if (thumbnailContainer && thumbnailImg && !isVideoFile && !isAudioFile) {
              // Update existing image thumbnail
              if (thumbnailImg.src !== newThumbnailUrl) {
                thumbnailImg.src = newThumbnailUrl;
              }
              thumbnailContainer.classList.toggle('visible', Boolean(showThumbnail));
            } else if (thumbnailContainer && (isVideoFile || isAudioFile)) {
              // Already has placeholder, just update visibility
              thumbnailContainer.classList.toggle('visible', Boolean(showThumbnail));
            } else {
              // Create new thumbnail (use helper for proper video/audio handling)
              const tempDiv = document.createElement('div');
              tempDiv.innerHTML = this.createThumbnailElement(newThumbnailUrl, restaurant.id, Boolean(showThumbnail));
              const newThumbnail = tempDiv.firstElementChild as HTMLElement;

              const avatarImg = markerElement.querySelector('.avatar-img');
              if (avatarImg?.parentElement && newThumbnail) {
                // Insert before avatar-img within the avatar-marker container
                avatarImg.parentElement.insertBefore(newThumbnail, avatarImg);
              }

              // Re-attach click handler
              setTimeout(() => {
                const img = newThumbnail?.querySelector('img');
                const videoPlaceholder = newThumbnail?.querySelector('.video-thumb-placeholder');
                const audioPlaceholder = newThumbnail?.querySelector('.audio-thumb-placeholder');

                const clickTarget = img || videoPlaceholder || audioPlaceholder;
                if (clickTarget) {
                  clickTarget.addEventListener('click', (e) => {
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

  }

  /**
   * Set map blur state
   */
  static setBlur(blurred: boolean): void {
    const mapElement = document.getElementById('map');
    if (!mapElement) return;

    if (blurred) {
      mapElement.classList.add('blurred');
    } else {
      mapElement.classList.remove('blurred');
    }
  }

  /**
   * Focus map on a specific restaurant
   */
  static focusOnRestaurant(restaurantId: string): void {
    const marker = this.markers[restaurantId];
    if (marker && this.map) {
      const latlng = marker.getLatLng();
      this.map.flyTo([latlng.lat, latlng.lng], 16, {
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
      return;
    }

    this.map.flyTo([this.initialView.lat, this.initialView.lng], this.initialView.zoom, {
      duration: 0.4  // Fast animation (0.4 seconds)
    });
  }

  /**
   * Time-of-day theme types
   */
  static readonly THEMES = ['sunrise', 'day', 'sunset', 'night'] as const;
  static currentTheme: typeof MapModule.THEMES[number] | null = null;

  /**
   * Set map theme based on time of day
   * Only affects tile layer, not markers/avatars
   */
  static setTheme(theme: typeof MapModule.THEMES[number]): void {
    const mapElement = document.getElementById('map');
    if (!mapElement) return;

    // Remove all theme classes
    this.THEMES.forEach(t => mapElement.classList.remove(`theme-${t}`));

    // Add new theme class
    mapElement.classList.add(`theme-${theme}`);
    this.currentTheme = theme;

  }

  /**
   * Get theme based on current hour
   * Night: >= 18:00, Day: < 18:00
   */
  static getThemeForHour(hour: number): typeof MapModule.THEMES[number] | null {
    if (hour >= 18 || hour < 6) return 'night';
    return null;  // No filter during daytime
  }

  /**
   * Auto-set theme based on current time
   */
  static autoSetTheme(): void {
    const hour = new Date().getHours();
    const theme = this.getThemeForHour(hour);
    if (theme) {
      this.setTheme(theme);
    } else {
      this.clearTheme();
    }
  }

  /**
   * Clear theme (return to default)
   */
  static clearTheme(): void {
    const mapElement = document.getElementById('map');
    if (!mapElement) return;

    this.THEMES.forEach(t => mapElement.classList.remove(`theme-${t}`));
    this.currentTheme = null;
  }

  /**
   * Show loading spinner on avatar during upload
   */
  static showAvatarSpinner(restaurantId: string): void {
    const marker = this.markers[restaurantId];
    if (!marker) {
      return;
    }

    const markerElement = marker.getElement();
    if (!markerElement) return;

    const avatarMarker = markerElement.querySelector('.avatar-marker');
    if (!avatarMarker) return;

    // Check if spinner already exists
    if (avatarMarker.querySelector('.avatar-spinner')) return;

    // Create spinner element
    const spinner = document.createElement('div');
    spinner.className = 'avatar-spinner';
    avatarMarker.insertBefore(spinner, avatarMarker.firstChild);

  }

  /**
   * Hide loading spinner on avatar after upload
   */
  static hideAvatarSpinner(restaurantId: string): void {
    const marker = this.markers[restaurantId];
    if (!marker) return;

    const markerElement = marker.getElement();
    if (!markerElement) return;

    const spinner = markerElement.querySelector('.avatar-spinner');
    if (spinner) {
      spinner.remove();
    }
  }

  /**
   * Show restaurant check-in history panel with lazy loading
   */
  static async showRestaurantHistory(restaurant: Restaurant): Promise<void> {

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

    // Create thumbnail HTML based on media type (image, video, audio, or text)
    let thumbnailHtml = '';
    const firstMediaUrl = record.media_urls?.[0];

    if (firstMediaUrl) {
      const isVideo = this.isVideoUrl(firstMediaUrl);
      const isAudio = this.isAudioUrl(firstMediaUrl);

      if (isVideo) {
        // Video placeholder icon
        thumbnailHtml = `
          <div class="history-item-thumbnail history-video-thumb">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
        `;
      } else if (isAudio) {
        // Audio placeholder icon
        thumbnailHtml = `
          <div class="history-item-thumbnail history-audio-thumb">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
          </div>
        `;
      } else {
        // Image thumbnail
        thumbnailHtml = `
          <div class="history-item-thumbnail">
            <img src="${firstMediaUrl}" alt="打卡照片" />
          </div>
        `;
      }
    }

    // Create text content display (for text-type check-ins)
    const textContentHtml = record.text_content
      ? `<div class="history-item-text">"${record.text_content}"</div>`
      : '';

    item.innerHTML = `
      ${thumbnailHtml}
      <div class="history-item-content">
        <div class="history-item-title">${taskName}</div>
        ${textContentHtml}
        <div class="history-item-meta">
          <span class="history-item-date">${dateStr}</span>
          <span class="history-item-time">${timeStr}</span>
          <span class="history-item-slot">${slotName}</span>
        </div>
      </div>
    `;

    // Add click handler for media preview
    if (record.media_urls && record.media_urls.length > 0) {
      const thumbnail = item.querySelector('.history-item-thumbnail');
      thumbnail?.addEventListener('click', () => {
        this.previewMediaUrls(record.media_urls!);
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
   * Preview media URL (for history items - single URL, simple view)
   */
  private static previewMediaUrl(mediaUrl: string): void {
    // Delegate to previewMediaUrls for consistency
    this.previewMediaUrls([mediaUrl]);
  }

  /**
   * Preview multiple media URLs (gallery modal with swipe and long-press download)
   * Used by history panel to preview all media from a check-in record
   */
  private static previewMediaUrls(mediaUrls: string[]): void {
    if (mediaUrls.length === 0) {
      return;
    }


    // Create overlay (semi-transparent background)
    const overlay = document.createElement('div');
    overlay.className = 'media-preview-overlay';

    // Create modal container (centered popup, not fullscreen)
    const modal = document.createElement('div');
    modal.className = 'media-preview-modal';

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.innerHTML = '✕';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      overlay.remove();
    });
    modal.appendChild(closeBtn);

    // Create gallery container
    const gallery = document.createElement('div');
    gallery.className = 'media-gallery';

    const track = document.createElement('div');
    track.className = 'media-gallery-track';

    let currentIndex = 0;

    // Add media items to track
    mediaUrls.forEach((url, index) => {
      const item = document.createElement('div');
      item.className = 'media-gallery-item';

      const ext = url.split('.').pop()?.toLowerCase() || '';
      const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext);
      const isVideo = ['mp4', 'mov', 'webm', 'ogg'].includes(ext);
      const isAudio = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'webm'].includes(ext);

      if (isImage) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = `Image ${index + 1}`;
        img.draggable = false;
        item.appendChild(img);
      } else if (isVideo) {
        const video = document.createElement('video');
        video.src = url;
        video.controls = true;
        video.addEventListener('click', (e) => e.stopPropagation());
        item.appendChild(video);
      } else if (isAudio) {
        const audioContainer = document.createElement('div');
        audioContainer.innerHTML = `
          <div style="font-size: 64px; margin-bottom: 16px;">🎵</div>
        `;
        const audio = document.createElement('audio');
        audio.src = url;
        audio.controls = true;
        audio.addEventListener('click', (e) => e.stopPropagation());
        audioContainer.appendChild(audio);
        item.appendChild(audioContainer);
      }

      track.appendChild(item);
    });

    gallery.appendChild(track);
    modal.appendChild(gallery);

    // Update track position
    const updateTrackPosition = () => {
      track.style.transform = `translateX(-${currentIndex * 100}%)`;
    };

    // Add navigation if multiple images
    if (mediaUrls.length > 1) {
      // Navigation arrows
      const prevBtn = document.createElement('button');
      prevBtn.className = 'gallery-nav prev';
      prevBtn.innerHTML = '‹';
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentIndex > 0) {
          currentIndex--;
          updateTrackPosition();
          updateDots();
        }
      });
      gallery.appendChild(prevBtn);

      const nextBtn = document.createElement('button');
      nextBtn.className = 'gallery-nav next';
      nextBtn.innerHTML = '›';
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentIndex < mediaUrls.length - 1) {
          currentIndex++;
          updateTrackPosition();
          updateDots();
        }
      });
      gallery.appendChild(nextBtn);

      // Dots indicator
      const dots = document.createElement('div');
      dots.className = 'gallery-dots';
      mediaUrls.forEach((_, index) => {
        const dot = document.createElement('div');
        dot.className = `gallery-dot ${index === 0 ? 'active' : ''}`;
        dot.addEventListener('click', (e) => {
          e.stopPropagation();
          currentIndex = index;
          updateTrackPosition();
          updateDots();
        });
        dots.appendChild(dot);
      });
      modal.appendChild(dots);

      const updateDots = () => {
        dots.querySelectorAll('.gallery-dot').forEach((dot, i) => {
          dot.classList.toggle('active', i === currentIndex);
        });
      };

      // Swipe support
      let touchStartX = 0;

      gallery.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0]?.clientX || 0;
      });

      gallery.addEventListener('touchend', (e) => {
        const touchEndX = e.changedTouches[0]?.clientX || 0;
        const diff = touchStartX - touchEndX;

        if (Math.abs(diff) > 50) {
          if (diff > 0 && currentIndex < mediaUrls.length - 1) {
            currentIndex++;
          } else if (diff < 0 && currentIndex > 0) {
            currentIndex--;
          }
          updateTrackPosition();
          updateDots();
        }
      });
    }

    overlay.appendChild(modal);

    // Close on overlay click (not modal)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });

    document.body.appendChild(overlay);
  }

  /**
   * Preview media from check-in (gallery modal with swipe and long-press download)
   */
  static previewMedia(restaurant: Restaurant): void {
    const mediaUrls = restaurant.checkInData?.media_urls || [];
    if (mediaUrls.length === 0) {
      return;
    }


    // Mark as read for future use
    if (restaurant.checkInData) {
      this.markCheckInAsRead(restaurant.id, restaurant.checkInData.check_in_date, restaurant.checkInData.slot_type);
    }

    // Create overlay (semi-transparent background)
    const overlay = document.createElement('div');
    overlay.className = 'media-preview-overlay';

    // Create modal container (centered popup, not fullscreen)
    const modal = document.createElement('div');
    modal.className = 'media-preview-modal';

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.innerHTML = '✕';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      overlay.remove();
    });
    modal.appendChild(closeBtn);

    // Create gallery container
    const gallery = document.createElement('div');
    gallery.className = 'media-gallery';

    const track = document.createElement('div');
    track.className = 'media-gallery-track';

    let currentIndex = 0;
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;

    // Add media items to track
    mediaUrls.forEach((url, index) => {
      const item = document.createElement('div');
      item.className = 'media-gallery-item';

      const ext = url.split('.').pop()?.toLowerCase() || '';
      const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext);
      const isVideo = ['mp4', 'mov', 'webm', 'ogg'].includes(ext);
      const isAudio = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'webm'].includes(ext);

      if (isImage) {
        // Add loading spinner
        const spinner = document.createElement('div');
        spinner.className = 'media-loading-spinner';
        item.appendChild(spinner);

        const img = document.createElement('img');
        img.src = url;
        img.alt = `Image ${index + 1}`;
        img.draggable = false;

        // On load: remove spinner, show image
        img.addEventListener('load', () => {
          spinner.remove();
          img.classList.add('loaded');
        });

        // On error: remove spinner, show error
        img.addEventListener('error', () => {
          spinner.remove();
          item.innerHTML = '<div style="color: #999; padding: 40px;">加载失败</div>';
        });

        // Long-press to download
        img.addEventListener('touchstart', (e) => {
          longPressTimer = setTimeout(() => {
            this.downloadMedia(url, `image_${index + 1}.${ext}`);
          }, 800);
        });
        img.addEventListener('touchend', () => {
          if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
          }
        });
        img.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.downloadMedia(url, `image_${index + 1}.${ext}`);
        });

        item.appendChild(img);
      } else if (isVideo) {
        const video = document.createElement('video');
        video.src = url;
        video.controls = true;
        video.addEventListener('click', (e) => e.stopPropagation());
        item.appendChild(video);
      } else if (isAudio) {
        const audioContainer = document.createElement('div');
        audioContainer.innerHTML = `
          <div style="font-size: 64px; margin-bottom: 16px;">🎵</div>
        `;
        const audio = document.createElement('audio');
        audio.src = url;
        audio.controls = true;
        audio.addEventListener('click', (e) => e.stopPropagation());
        audioContainer.appendChild(audio);
        item.appendChild(audioContainer);
      }

      track.appendChild(item);
    });

    gallery.appendChild(track);
    modal.appendChild(gallery);

    // Update track position
    const updateTrackPosition = () => {
      track.style.transform = `translateX(-${currentIndex * 100}%)`;
    };

    // Add navigation if multiple images
    if (mediaUrls.length > 1) {
      // Navigation arrows
      const prevBtn = document.createElement('button');
      prevBtn.className = 'gallery-nav prev';
      prevBtn.innerHTML = '‹';
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentIndex > 0) {
          currentIndex--;
          updateTrackPosition();
          updateDots();
        }
      });
      gallery.appendChild(prevBtn);

      const nextBtn = document.createElement('button');
      nextBtn.className = 'gallery-nav next';
      nextBtn.innerHTML = '›';
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentIndex < mediaUrls.length - 1) {
          currentIndex++;
          updateTrackPosition();
          updateDots();
        }
      });
      gallery.appendChild(nextBtn);

      // Dots indicator
      const dots = document.createElement('div');
      dots.className = 'gallery-dots';
      mediaUrls.forEach((_, index) => {
        const dot = document.createElement('div');
        dot.className = `gallery-dot ${index === 0 ? 'active' : ''}`;
        dot.addEventListener('click', (e) => {
          e.stopPropagation();
          currentIndex = index;
          updateTrackPosition();
          updateDots();
        });
        dots.appendChild(dot);
      });
      modal.appendChild(dots);

      const updateDots = () => {
        dots.querySelectorAll('.gallery-dot').forEach((dot, i) => {
          dot.classList.toggle('active', i === currentIndex);
        });
      };

      // Swipe support
      let touchStartX = 0;
      let touchEndX = 0;

      gallery.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0]?.clientX || 0;
      });

      gallery.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0]?.clientX || 0;
        const diff = touchStartX - touchEndX;

        if (Math.abs(diff) > 50) {
          if (diff > 0 && currentIndex < mediaUrls.length - 1) {
            currentIndex++;
          } else if (diff < 0 && currentIndex > 0) {
            currentIndex--;
          }
          updateTrackPosition();
          updateDots();
        }
      });
    }

    // Download hint
    const hint = document.createElement('div');
    hint.className = 'download-hint';
    hint.textContent = '长按图片保存';
    modal.appendChild(hint);

    overlay.appendChild(modal);

    // Close on overlay click (not modal)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });

    document.body.appendChild(overlay);
  }

  /**
   * Download media file
   */
  private static downloadMedia(url: string, filename: string): void {

    // Create temporary link for download
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.target = '_blank';

    // For cross-origin URLs, just open in new tab
    if (!url.startsWith(window.location.origin)) {
      window.open(url, '_blank');
      return;
    }

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

// Export to window for backward compatibility
if (typeof window !== 'undefined') {
  window.MapModule = MapModule;
}
