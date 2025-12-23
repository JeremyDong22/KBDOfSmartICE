// Version: 5.2 - Integrated with TimeControlModule for dev time support
// UI Module - UI state management and animations
// Handles: Panel visibility, status bar with business states, animations, restaurant navigation

import { AuthService } from '@services/auth.service';
import type { Restaurant, Task, SlotType, MediaType } from '@/types/models';


export class UIModule {
  /**
   * Determine business status based on current time
   * Supports dev time from TimeControlModule
   * Time windows:
   * - 10:00-11:30: lunch_open window
   * - 11:30-13:30: 营业中 (午市)
   * - 13:30-15:30: lunch_close window
   * - 15:30-16:00: 营业中 (过渡)
   * - 16:00-17:30: dinner_open window
   * - 17:30-21:30: 营业中 (晚市)
   * - 21:30-01:00: dinner_close window
   * - 01:00-10:00: 休息中
   */
  private static getBusinessStatus(): { status: string; dotColor: 'green' | 'gray' } {
    // Try to get dev time from TimeControlModule if available
    let now: Date;
    try {
      const TimeControlModule = (window as any).TimeControlModule;
      if (TimeControlModule && TimeControlModule.isDevMode && TimeControlModule.isDevMode()) {
        now = TimeControlModule.getCurrentTime();
      } else {
        now = new Date();
      }
    } catch {
      now = new Date();
    }

    const hours = now.getHours();
    const minutes = now.getMinutes();
    const totalMinutes = hours * 60 + minutes;

    // Convert time windows to minutes
    const lunchOpenStart = 10 * 60; // 10:00
    const lunchOpenEnd = 11 * 60 + 30; // 11:30
    const lunchBusinessEnd = 13 * 60 + 30; // 13:30
    const lunchCloseEnd = 15 * 60 + 30; // 15:30
    const transitionEnd = 16 * 60; // 16:00
    const dinnerOpenEnd = 17 * 60 + 30; // 17:30
    const dinnerBusinessEnd = 21 * 60 + 30; // 21:30
    const dinnerCloseEnd = 24 * 60 + 60; // 01:00 next day (25:00)

    // Handle time windows
    if (totalMinutes >= lunchOpenStart && totalMinutes < lunchOpenEnd) {
      return { status: '● 午市开店', dotColor: 'green' };
    } else if (totalMinutes >= lunchOpenEnd && totalMinutes < lunchBusinessEnd) {
      return { status: '营业中', dotColor: 'green' };
    } else if (totalMinutes >= lunchBusinessEnd && totalMinutes < lunchCloseEnd) {
      return { status: '● 午市闭店', dotColor: 'green' };
    } else if (totalMinutes >= lunchCloseEnd && totalMinutes < transitionEnd) {
      return { status: '营业中', dotColor: 'green' };
    } else if (totalMinutes >= transitionEnd && totalMinutes < dinnerOpenEnd) {
      return { status: '● 晚市开店', dotColor: 'green' };
    } else if (totalMinutes >= dinnerOpenEnd && totalMinutes < dinnerBusinessEnd) {
      return { status: '营业中', dotColor: 'green' };
    } else if (totalMinutes >= dinnerBusinessEnd && totalMinutes < dinnerCloseEnd) {
      return { status: '● 晚市闭店', dotColor: 'green' };
    } else {
      // 01:00-10:00 or after 01:00 (handle next day)
      if (totalMinutes >= 60 && totalMinutes < lunchOpenStart) {
        return { status: '休息中', dotColor: 'gray' };
      } else if (totalMinutes < 60) {
        // 00:00-01:00 is still dinner_close window
        return { status: '● 晚市闭店', dotColor: 'green' };
      } else {
        return { status: '休息中', dotColor: 'gray' };
      }
    }
  }

  /**
   * Update status bar with current slot type and business status
   */
  static updateStatusBar(_currentSlotType: SlotType | null = null): void {
    const businessStatus = this.getBusinessStatus();
    const slotTypeText = document.getElementById('slotTypeText');
    const statusDot = document.querySelector('.status-dot') as HTMLElement;

    if (slotTypeText) {
      slotTypeText.textContent = businessStatus.status;
    }

    if (statusDot) {
      // Remove all color classes
      statusDot.classList.remove('green', 'gray');
      // Add the appropriate color class
      statusDot.classList.add(businessStatus.dotColor);
    }

  }

  /**
   * Update check-in panel based on current state
   */
  static updateCheckInPanel(isCheckedIn: boolean, currentTask: Task | null): void {

    const panelTitle = document.getElementById('panelTitle');
    const panelSubtitle = document.getElementById('panelSubtitle');

    if (isCheckedIn) {
      if (panelTitle) panelTitle.textContent = '✓ 已打卡';
      if (panelSubtitle) panelSubtitle.textContent = '今日任务已完成';
      this.hideAllInputSections();
      return;
    }

    // Show task info and appropriate input method
    if (currentTask) {

      if (panelTitle) panelTitle.textContent = currentTask.task_name;
      if (panelSubtitle) panelSubtitle.textContent = currentTask.task_description || '';
      this.showInputSection(currentTask.media_type);
    } else {
    }
  }

  /**
   * Hide all input sections
   */
  static hideAllInputSections(): void {

    const sections = [
      'notificationInput',
      'textInput',
      'imageInput',
      'voiceInput',
      'videoInput'
    ];

    sections.forEach(sectionId => {
      const section = document.getElementById(sectionId) as HTMLElement;
      if (section) {
        section.style.display = 'none';
      }
    });
  }

  /**
   * Show specific input section based on media type
   */
  static showInputSection(mediaType: MediaType): void {
    this.hideAllInputSections();

    const sectionMap: Record<MediaType, string> = {
      'notification': 'notificationInput',
      'text': 'textInput',
      'image': 'imageInput',
      'voice': 'voiceInput',
      'video': 'videoInput'
    };

    const sectionId = sectionMap[mediaType];
    if (sectionId) {
      const section = document.getElementById(sectionId) as HTMLElement;
      if (section) {
        section.style.display = 'flex';
      }
    } else {
    }
  }

  /**
   * Show check-in panel with animation
   */
  static showCheckInPanel(): void {

    const panel = document.getElementById('checkinPanel') as HTMLElement;
    if (panel) {
      panel.style.display = 'block';

      setTimeout(() => {
        panel.classList.add('visible');
      }, 100);
    }
  }

  /**
   * Hide check-in panel with animation
   */
  static hideCheckInPanel(): void {

    const panel = document.getElementById('checkinPanel') as HTMLElement;
    if (panel) {
      panel.classList.remove('visible');

      setTimeout(() => {
        panel.style.display = 'none';
      }, 500);
    }
  }

  /**
   * Perform three-step check-in completion animation
   */
  static async performCheckInAnimation(
    _mediaUrl: string | null,
    updateRestaurants: () => Promise<void>
  ): Promise<void> {

    // Step 1: Map unblur + avatar state change (≤200ms)
    setTimeout(async () => {

      if (updateRestaurants) {
        await updateRestaurants();
      }

      const MapModule = window.MapModule;
      if (MapModule) {
        MapModule.setBlur(false);
      }
      this.updateStatusBar();
    }, 150);

    // Step 2: Show "已打卡" (≈300ms)
    setTimeout(() => {

      const panelTitle = document.getElementById('panelTitle');
      const panelSubtitle = document.getElementById('panelSubtitle');

      if (panelTitle) panelTitle.textContent = '✓ 已打卡';
      if (panelSubtitle) panelSubtitle.textContent = '今日任务已完成';
      this.hideAllInputSections();
    }, 250);

    // Step 3: Fade out panel (≈800ms later)
    setTimeout(() => {
      const panel = document.getElementById('checkinPanel');
      if (panel) {
        panel.classList.add('fade-out');
      }
    }, 900);

    setTimeout(() => {
      const panel = document.getElementById('checkinPanel');
      if (panel) {
        panel.classList.remove('visible', 'fade-out');
        panel.style.display = 'none';
      }
    }, 1200);
  }

  /**
   * Render restaurant navigation menu
   */
  static renderRestaurantNav(restaurants: Restaurant[], currentUserId: string): void {

    const navContainer = document.getElementById('restaurantNav');
    if (!navContainer) return;

    // Clear existing items (keep header)
    const header = navContainer.querySelector('h4');
    navContainer.innerHTML = '';
    if (header) {
      navContainer.appendChild(header);
    }

    // Add restaurant items
    restaurants.forEach((restaurant) => {
      const isCurrentUser = restaurant.id === currentUserId;

      // Get manager info and extract initials
      const manager = restaurant.master_employee?.[0] || { employee_name: restaurant.restaurant_name };
      const initials = manager.employee_name?.substring(0, 2) || restaurant.restaurant_name?.substring(0, 2) || '店';

      const navItem = document.createElement('div');
      navItem.className = `nav-item ${isCurrentUser ? 'current' : ''}`;
      navItem.innerHTML = `
        <div class="nav-item-avatar" data-initials="${initials}">${initials}</div>
        <span class="nav-item-name">${restaurant.restaurant_name}</span>
        <span class="nav-item-status">${restaurant.checked ? '✓' : '○'}</span>
      `;

      navItem.addEventListener('click', () => {
        const MapModule = window.MapModule;
        if (MapModule) {
          MapModule.focusOnRestaurant(restaurant.id);
        }
      });

      navContainer.appendChild(navItem);
    });

  }

  /**
   * Show loading overlay
   */
  static showLoading(message: string = '加载中...'): void {

    const overlay = document.getElementById('loadingOverlay') as HTMLElement;
    const text = document.querySelector('.loading-text') as HTMLElement;

    if (text) {
      text.textContent = message;
    }

    if (overlay) {
      overlay.style.display = 'flex';
    }
  }

  /**
   * Hide loading overlay
   */
  static hideLoading(): void {
    const overlay = document.getElementById('loadingOverlay') as HTMLElement;
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  /**
   * Setup time jump test controls (dev only) - DEPRECATED
   * This method is kept for backward compatibility but does nothing.
   * Use TimeControlModule.initialize() instead.
   */
  static setupTimeJumpControls(_onTimeJump: (slot: SlotType | null) => Promise<void>): void {
  }

  /**
   * Setup logout button
   */
  static setupLogoutButton(): void {

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        AuthService.logout();
      });
    }
  }
}

// Export to window for backward compatibility
if (typeof window !== 'undefined') {
  window.UIModule = UIModule;
}
