# DEV Time Control Feature

## Overview
The DEV Time Control feature provides a collapsible clock panel for testing time-based functionality without waiting for actual time windows.

## Features

### 1. Collapsible Clock Panel
- **Default State**: Collapsed (only shows clock icon)
- **Location**: Top-left corner, below logout button
- **Toggle**: Click the clock icon to expand/collapse
- **Visual Feedback**: Icon turns blue when expanded

### 2. Time Simulation
- **Display**: Large digital clock showing HH:MM:SS
- **Controls**: +/- buttons for hours, minutes, and seconds
- **Auto-Tick**: Clock advances automatically every second
- **Reset**: Reset button to return to current real time

### 3. Time Window Detection
- Automatically detects when simulated time crosses time window boundaries
- Triggers state updates when entering/exiting check-in windows
- Time windows:
  - 午市开店: 10:00-11:30
  - 营业中: 11:30-13:30
  - 午市闭店: 13:30-15:30
  - 营业中: 15:30-16:00
  - 晚市开店: 16:00-17:30
  - 营业中: 17:30-21:30
  - 晚市闭店: 21:30-01:00
  - 休息中: 01:00-10:00

## Implementation Details

### Files Modified
1. **main.html**: Replaced time-jump-panel with time-control-panel
2. **src/styles/main.css**: New styles for collapsible time control panel
3. **src/modules/time-control.ts**: New module for time simulation logic
4. **src/modules/ui.ts**: Updated to use TimeControlModule for business status
5. **src/modules/app.ts**: Integrated TimeControlModule, updated time detection
6. **src/services/kbd.service.ts**: Added customTime parameter to getCurrentTimeSlot()

### Architecture
```
TimeControlModule
├── State Management
│   ├── devTime: Date | null (null = real time)
│   ├── isCollapsed: boolean
│   └── previousSlotType: string | null
├── Time Operations
│   ├── getCurrentTime(): Date
│   ├── setDevTime(time: Date)
│   ├── adjustTime(unit, delta)
│   └── resetTime()
├── Auto-Tick
│   └── Updates every second
└── Boundary Detection
    └── Triggers onTimeWindowChange callback
```

### Integration Points
- **KBDService.getCurrentTimeSlot(brandId, customTime?)**: Accepts optional custom time
- **AppModule.handleTimeWindowChange()**: Called when time crosses boundaries
- **UIModule.getBusinessStatus()**: Uses dev time for status display

## Usage

### For Development Testing
1. Click the clock icon in top-left corner to expand panel
2. Adjust time using +/- buttons:
   - **Hour**: Jump quickly between time windows
   - **Minute**: Fine-tune to specific window boundaries
   - **Second**: Precise testing of time-based logic
3. Watch the status bar update as you cross time windows
4. Observe map state changes (blur, panel visibility, avatar states)

### Example Test Scenarios
```typescript
// Test lunch_open window (10:00-11:30)
Set time to 10:15 → Should show "午市开店" status
                  → Check-in panel should appear if not checked in
                  → Map should be blurred

// Test transition at 11:30
Set time to 11:29:55 → Watch auto-tick cross boundary at 11:30:00
                     → Status should change from "午市开店" to "营业中"
                     → Panel should disappear if checked in

// Test dinner_close midnight crossing (21:30-01:00)
Set time to 23:45 → Should show "晚市闭店" status
Set time to 00:30 → Should still be in "晚市闭店" window
Set time to 01:00 → Should transition to "休息中"
```

### For Production
Add `.production` class to `<body>` in main.html to completely hide the panel:
```html
<body class="production">
```

Or remove the panel via CSS:
```css
body.production .time-control-panel {
    display: none !important;
}
```

## Technical Notes

### Time Format
- Internal storage: JavaScript Date object
- Display format: HH:MM:SS (24-hour format)
- Database comparison: HH:MM:SS string format

### Boundary Detection
- Checks on every time adjustment
- Checks on every auto-tick
- Compares current slot type vs previous
- Only triggers callback when slot actually changes

### Performance
- Auto-tick interval: 1 second
- No performance impact when collapsed
- Minimal DOM updates (only changed values)
- Uses requestAnimationFrame for smooth UI updates

## Backward Compatibility

### Deprecated Methods (Kept for compatibility)
- `UIModule.setupTimeJumpControls()`: No-op, logs deprecation warning
- `AppModule.handleTimeJump()`: Redirects to new time system
- `AppModule.testMode` / `testSlotType`: Still supported for old code

### Migration Path
Old code using time jump buttons will continue to work, but should migrate to:
```typescript
// Old way (deprecated)
UIModule.setupTimeJumpControls((slot) => handleTimeJump(slot));

// New way
TimeControlModule.initialize(() => handleTimeWindowChange());
```

## Troubleshooting

### Clock not updating
- Check console for "[TIME] Auto-ticking started" message
- Verify TimeControlModule.initialize() was called
- Check for JavaScript errors blocking execution

### Time window not detecting
- Verify kbd_time_slot_config table has correct time windows
- Check brand_id matches user's restaurant brand
- Look for "[APP] Detected time slot" console messages

### Panel not showing
- Check if body has `.production` class
- Verify HTML contains `<div class="time-control-panel collapsed">`
- Check CSS is loaded correctly
- Use browser DevTools to inspect element

## Future Enhancements
- [ ] Quick jump buttons to common times (10:00, 13:30, 16:00, 21:30)
- [ ] Preset scenarios (full day cycle, boundary crossing, etc.)
- [ ] Time speed multiplier (fast-forward testing)
- [ ] History of time changes for debugging
- [ ] Export/import time test sequences
