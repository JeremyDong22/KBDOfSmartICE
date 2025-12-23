// Version: 2.0 - Added date control for cross-day testing
// Time Control Module - Developer time simulation with collapsible clock interface
// Handles: Simulated time state, time and date adjustments, auto-ticking clock, time window boundary detection


export class TimeControlModule {
  // State
  private static devTime: Date | null = null; // null = use real time
  private static tickInterval: number | null = null;
  private static isCollapsed: boolean = true;
  private static onTimeWindowChange: (() => Promise<void>) | null = null;
  private static previousSlotType: string | null = null;

  /**
   * Time window boundaries (HH:MM format)
   */
  private static readonly TIME_WINDOWS = {
    lunch_open: { start: '10:00', end: '11:30' },
    lunch_close: { start: '13:30', end: '15:30' },
    dinner_open: { start: '16:00', end: '17:30' },
    dinner_close: { start: '21:30', end: '01:00' }
  };

  /**
   * Initialize time control panel
   */
  static initialize(onTimeWindowChange: () => Promise<void>): void {

    this.onTimeWindowChange = onTimeWindowChange;

    // Set up toggle button
    const toggleBtn = document.getElementById('timeControlToggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => this.togglePanel());
    }

    // Set up time adjustment buttons
    document.querySelectorAll('.time-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const button = e.target as HTMLElement;
        const unit = button.dataset.unit as 'hour' | 'minute' | 'second';
        const delta = parseInt(button.dataset.delta || '0');
        this.adjustTime(unit, delta);
      });
    });

    // Set up reset button
    const resetBtn = document.getElementById('resetDevTime');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => this.resetTime());
    }

    // Initialize display with current time
    this.updateDisplay();

    // Start auto-ticking
    this.startTicking();

  }

  /**
   * Toggle panel collapsed/expanded state
   */
  private static togglePanel(): void {
    const panel = document.querySelector('.time-control-panel');
    if (!panel) return;

    this.isCollapsed = !this.isCollapsed;

    if (this.isCollapsed) {
      panel.classList.add('collapsed');
    } else {
      panel.classList.remove('collapsed');
    }
  }

  /**
   * Get current time (dev time or real time)
   */
  static getCurrentTime(): Date {
    return this.devTime ? new Date(this.devTime) : new Date();
  }

  /**
   * Set dev time to specific time
   */
  static setDevTime(time: Date): void {
    this.devTime = new Date(time);
    this.updateDisplay();
    this.checkTimeWindowBoundary();
  }

  /**
   * Reset to real time
   */
  private static resetTime(): void {
    this.devTime = null;
    this.updateDisplay();
    this.checkTimeWindowBoundary();
  }

  /**
   * Adjust time by delta
   */
  private static adjustTime(unit: 'hour' | 'minute' | 'second' | 'day', delta: number): void {
    const currentTime = this.getCurrentTime();

    switch (unit) {
      case 'day':
        currentTime.setDate(currentTime.getDate() + delta);
        break;
      case 'hour':
        currentTime.setHours(currentTime.getHours() + delta);
        break;
      case 'minute':
        currentTime.setMinutes(currentTime.getMinutes() + delta);
        break;
      case 'second':
        currentTime.setSeconds(currentTime.getSeconds() + delta);
        break;
    }

    this.devTime = currentTime;
    this.updateDisplay();
    this.checkTimeWindowBoundary();

  }

  /**
   * Start auto-ticking (every second)
   */
  private static startTicking(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
    }

    this.tickInterval = window.setInterval(() => {
      if (this.devTime) {
        this.devTime.setSeconds(this.devTime.getSeconds() + 1);
        this.updateDisplay();
        this.checkTimeWindowBoundary();
      } else {
        // Update display even for real time
        this.updateDisplay();
      }
    }, 1000);

  }

  /**
   * Stop auto-ticking
   */
  static stopTicking(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  /**
   * Update time display in UI
   */
  private static updateDisplay(): void {
    const currentTime = this.getCurrentTime();
    const timeString = this.formatTime(currentTime);
    const dateString = this.formatDate(currentTime);

    const dateDisplayElement = document.getElementById('devDateDisplay');
    const displayElement = document.getElementById('devTimeDisplay');
    const dayElement = document.getElementById('devDay');
    const hourElement = document.getElementById('devHour');
    const minuteElement = document.getElementById('devMinute');
    const secondElement = document.getElementById('devSecond');

    if (dateDisplayElement) {
      dateDisplayElement.textContent = dateString;
    }

    if (displayElement) {
      displayElement.textContent = timeString;
    }

    if (dayElement) {
      dayElement.textContent = String(currentTime.getDate()).padStart(2, '0');
    }

    if (hourElement) {
      hourElement.textContent = String(currentTime.getHours()).padStart(2, '0');
    }

    if (minuteElement) {
      minuteElement.textContent = String(currentTime.getMinutes()).padStart(2, '0');
    }

    if (secondElement) {
      secondElement.textContent = String(currentTime.getSeconds()).padStart(2, '0');
    }
  }

  /**
   * Format time as HH:MM:SS
   */
  private static formatTime(date: Date): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  /**
   * Format date as YYYY-MM-DD
   */
  private static formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Format datetime as YYYY-MM-DD HH:MM:SS
   */
  private static formatDateTime(date: Date): string {
    return `${this.formatDate(date)} ${this.formatTime(date)}`;
  }

  /**
   * Check if time crossed a window boundary and trigger update if needed
   */
  private static async checkTimeWindowBoundary(): Promise<void> {
    const currentSlot = this.getCurrentSlotType();

    if (currentSlot !== this.previousSlotType) {
      this.previousSlotType = currentSlot;

      // Trigger state update
      if (this.onTimeWindowChange) {
        await this.onTimeWindowChange();
      }
    }
  }

  /**
   * Get current slot type based on time
   */
  private static getCurrentSlotType(): string | null {
    const currentTime = this.getCurrentTime();
    const timeStr = `${String(currentTime.getHours()).padStart(2, '0')}:${String(currentTime.getMinutes()).padStart(2, '0')}`;

    for (const [slotType, window] of Object.entries(this.TIME_WINDOWS)) {
      if (this.isTimeInWindow(timeStr, window.start, window.end)) {
        return slotType;
      }
    }

    return null; // Not in any window
  }

  /**
   * Check if time is within a window (handles midnight crossing for dinner_close)
   */
  private static isTimeInWindow(time: string, start: string, end: string): boolean {
    if (start < end) {
      // Normal case: window doesn't cross midnight
      return time >= start && time < end;
    } else {
      // Special case: window crosses midnight (e.g., 21:30-01:00)
      return time >= start || time < end;
    }
  }

  /**
   * Check if currently in dev mode (using simulated time)
   */
  static isDevMode(): boolean {
    return this.devTime !== null;
  }

  /**
   * Get formatted current time for logging
   */
  static getFormattedTime(): string {
    return this.formatTime(this.getCurrentTime());
  }
}

// Export to window for backward compatibility
if (typeof window !== 'undefined') {
  window.TimeControlModule = TimeControlModule;
}
