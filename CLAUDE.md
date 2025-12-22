# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KBD (开闭店打卡系统) is a restaurant chain check-in system for SmartICE, tracking 4 daily check-in nodes (午市开店/闭店, 晚市开店/闭店) across multiple restaurant locations. The system uses a map-based interface to display real-time check-in status with avatar markers.

**Tech Stack:**
- Frontend: TypeScript with Vite build tool
- Map: Leaflet.js with OpenStreetMap tiles
- Backend: Supabase (PostgreSQL + Storage + Row Level Security)
- Font: Noto Sans SC (Google Fonts)

## Architecture

### Project Structure
```
KBDOfSmartICE/
├── index.html              # Login page entry point
├── main.html               # Main application page
├── package.json            # npm dependencies and scripts
├── tsconfig.json           # TypeScript configuration
├── vite.config.ts          # Vite build configuration
├── .env                    # Environment variables (not in git)
├── .env.example            # Environment template
├── profile/                # Profile-related assets (avatars, images)
├── documents/              # Technical documentation
│   ├── TASK_SYSTEM_LOGIC.md  # Task selection algorithm
│   ├── task_pool.md          # Task pool documentation
│   ├── MAP_COORDINATE_GUIDE.md
│   ├── LOCAL_TILES_SETUP.md
│   └── coordinates.md        # Restaurant GPS coordinates
├── src/
│   ├── login.ts           # Login page entry point
│   ├── main.ts            # Main application entry point
│   ├── types/             # TypeScript type definitions
│   │   ├── models.ts      # Business models (Employee, Restaurant, Task, etc.)
│   │   ├── database.types.ts # Supabase generated types
│   │   ├── leaflet.d.ts   # Leaflet type extensions
│   │   └── global.d.ts    # Window global interface
│   ├── services/          # Service layer
│   │   ├── supabase.ts    # Supabase client initialization
│   │   ├── auth.service.ts # Authentication service (login, logout, session)
│   │   └── kbd.service.ts  # KBD business logic (tasks, check-ins, media)
│   ├── modules/           # Core UI modules
│   │   ├── edge-indicators.ts  # Off-screen restaurant indicators
│   │   ├── map.ts         # Leaflet map management
│   │   ├── checkin.ts     # Check-in panel and media handling
│   │   ├── ui.ts          # UI state and animations
│   │   └── app.ts         # Application coordinator
│   └── styles/            # CSS modules
│       ├── variables.css  # CSS custom properties
│       ├── base.css       # Base styles and reset
│       ├── login.css      # Login page styles
│       └── main.css       # Main application styles
```

### Authentication Architecture
- **No Supabase Auth SDK**: System uses custom authentication via `master_employee` table lookup
- **Session Storage**: User data stored in `sessionStorage.currentUser` (not JWT-based)
- **Password**: Currently uses plain password comparison (password_hash field contains plain text)
- **RLS Workaround**: Since there's no real Supabase auth session, RLS policies may need adjustment for production

### Database Schema (Supabase)

**📖 For detailed task system logic and selection algorithms, see [documents/TASK_SYSTEM_LOGIC.md](./documents/TASK_SYSTEM_LOGIC.md)**

#### Core Tables

**1. kbd_time_slot_config**
Time window configuration per brand/restaurant. Controls when check-ins are allowed for each slot type.

Columns:
- `id` (uuid, PK): Primary key
- `brand_id` (integer, FK → master_brand.id): Brand identifier
- `restaurant_id` (uuid, nullable, FK → master_restaurant.id): Restaurant override (NULL = brand-level default)
- `slot_type` (varchar): One of: lunch_open, lunch_close, dinner_open, dinner_close
- `window_start` (time): Check-in window start time
- `window_end` (time): Check-in window end time
- `is_active` (boolean): Whether this config is active
- `created_at`, `updated_at` (timestamptz): Timestamps

Hierarchy: Brand-level defaults can be overridden at restaurant level.

**2. kbd_task_pool**
Unified task pool containing both routine and temporary tasks.

Columns:
- `id` (uuid, PK): Primary key
- `brand_id` (integer, nullable, FK → master_brand.id): NULL = global task
- `restaurant_id` (uuid, nullable, FK → master_restaurant.id): NULL = brand-level task
- `task_name` (varchar): Task title
- `task_description` (text): Detailed description
- `media_type` (varchar): notification, text, voice, image, video
  - `notification`: Read-only text display
  - `text`: Requires text input
  - `voice`: Requires voice recording
  - `image`: Requires photo upload
  - `video`: Requires video upload
- `applicable_slots` (varchar[]): Array of slot types this task applies to
- `is_routine` (boolean): true = routine task, false = temporary task
- `weight` (integer): Random selection weight for routine tasks (default: 100)
- `fixed_weekdays` (int4[]): Array of weekdays (0=Sunday, 6=Saturday) for fixed routine tasks
- `fixed_slots` (varchar[]): Specific slots for fixed routine tasks
- `execute_date` (date): Execution date for temporary tasks
- `execute_slot` (varchar): Execution slot for temporary tasks
- `is_announced` (boolean): Temporary task published flag (overrides routine tasks)
- `announced_at` (timestamptz): When temporary task was published
- `is_active` (boolean): Whether task is active
- `created_by` (uuid, FK → master_employee.id): Task creator
- `created_at`, `updated_at` (timestamptz): Timestamps

Task Selection Priority (Two-Branch System):
- **Branch 1**: Brand-level random selection (applies to all stores)
- **Branch 2**: Temporary task override (store-specific or brand-wide)

Temporary Task Priority:
1. Store-specific (`brand_id=X, restaurant_id=Y`)
2. Brand-level (`brand_id=X, restaurant_id=NULL`)
3. Global (`brand_id=NULL, restaurant_id=NULL`)

Routine Task Selection:
1. Fixed routine tasks (matching `fixed_weekdays` + `fixed_slots`)
2. Weighted random routine tasks

**📖 See [documents/TASK_SYSTEM_LOGIC.md](./documents/TASK_SYSTEM_LOGIC.md) for complete algorithm and examples**

Scope Control:
- `brand_id=NULL`: Global task (all brands)
- `brand_id=X, restaurant_id=NULL`: Brand-level task
- `brand_id=X, restaurant_id=Y`: Restaurant-specific task

**3. kbd_check_in_record**
Check-in submissions from employees.

Columns:
- `id` (uuid, PK): Primary key
- `restaurant_id` (uuid, FK → master_restaurant.id): Restaurant where check-in occurred
- `employee_id` (uuid, FK → master_employee.id): Employee who checked in
- `task_id` (uuid, FK → kbd_task_pool.id): Task that was completed
- `check_in_date` (date): Date of check-in
- `slot_type` (varchar): lunch_open, lunch_close, dinner_open, dinner_close
- `check_in_at` (timestamptz): Actual check-in timestamp
- `is_late` (boolean): Whether check-in was late
- `text_content` (text): Text submission (for text tasks)
- `media_urls` (text[]): Array of Supabase Storage URLs
- `remark` (text): Additional notes
- `created_at`, `updated_at` (timestamptz): Timestamps

Constraints:
- UNIQUE (restaurant_id, check_in_date, slot_type): One check-in per node per day

Media Storage Path Convention:
```
{brand_id}/{restaurant_id}/{year}/{month}/{date}/{slot_type}/{media_type}/{employee_id}_{timestamp}.{ext}
Example: 1/abc-123/2025/12/18/lunch_open/image/emp-456_1734512345.jpg
```

#### Supporting Tables

**master_brand**
Brand registry (野百灵, 宁桂杏, etc.)
- `id` (integer, PK)
- `code` (varchar, unique): Brand code (e.g., "YBL", "NGX")
- `name` (varchar): Brand name
- `is_active` (boolean)

**master_restaurant**
Restaurant/store registry
- `id` (uuid, PK)
- `restaurant_name` (varchar): Store name
- `brand_id` (integer, FK → master_brand.id)
- `latitude`, `longitude` (numeric): GPS coordinates for map display
- `is_active` (boolean)

**master_employee**
Employee authentication and profile
- `id` (uuid, PK)
- `username` (varchar, unique): Login username
- `password_hash` (varchar): Plain text password (not hashed in v1)
- `employee_name` (varchar): Display name
- `restaurant_id` (uuid, FK → master_restaurant.id)
- `role_code` (varchar, FK → master_role.code)
- `is_active` (boolean): Account enabled
- `is_locked` (boolean): Account locked due to failed logins
- `login_failed_count` (integer): Failed login attempts counter

Authentication Note: System uses custom auth via `master_employee` table lookup, not Supabase Auth SDK. User data stored in `sessionStorage.currentUser`.

#### RLS (Row Level Security)

All KBD tables have RLS enabled, but due to custom authentication (not using Supabase Auth), RLS policies may need adjustment for production. Current workaround: Filter data in JavaScript after query instead of using chained `.or()` clauses.

Example RLS Workaround:
```javascript
// ❌ Don't chain .or() - causes 406 errors
.or('brand_id.is.null,brand_id.eq.1')

// ✅ Filter in JavaScript after query
const tasks = await supabaseClient.from('kbd_task_pool').select('*');
const filtered = tasks?.filter(task =>
  task.brand_id === null || task.brand_id === userBrandId
);
```

### Data Flow

**Task Selection Logic** (supabase.js:62-141):
Two-branch system for robust task assignment:
1. **Branch 1**: Select ONE routine task for all stores in brand (weighted random)
2. **Branch 2**: Check for temporary task overrides (store > brand > global priority)
3. Apply temporary override if exists, otherwise use routine task

**📖 See [documents/TASK_SYSTEM_LOGIC.md](./documents/TASK_SYSTEM_LOGIC.md) for detailed algorithm, flow diagrams, and examples**

**Check-in Flow** (main.html:726-811):
1. Upload image → KBDService.uploadMedia() → Supabase Storage bucket `KBD`
2. Submit record → KBDService.submitCheckIn() → kbd_check_in_record table
3. Three-step UI animation:
   - Step 1 (≤200ms): Map unblur, avatar state change
   - Step 2 (≈300ms): "已打卡" confirmation
   - Step 3: Floating panel fade-out

## Commands

### Development
```bash
# Install dependencies
npm install

# Start development server with HMR
npm run dev
# Opens http://localhost:3000/

# Type check without building
npm run type-check

# Build for production
npm run build

# Preview production build
npm run preview
```

### Environment Variables
Create `.env` file with Supabase credentials:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Testing with Supabase
The project connects to a live Supabase instance via `.mcp.json` configuration:
- **Project**: Smartice.ai (wdpeoyugsxqnpwwtkqsl)
- **Region**: us-east-1
- Can use Supabase MCP server for database operations via Claude Code

### Storage File Upload (Standard Practice)
**ALWAYS use Supabase CLI for uploading files to Storage** (not HTML/JS scripts):

```bash
# Upload single file
supabase storage cp ./profile/avatar.jpg ss:///KBD/profiles/avatar.jpg \
  --experimental --linked \
  --content-type image/jpeg

# Batch upload directory (recursive)
supabase storage cp ./profile/ ss:///KBD/profiles/ \
  -r --experimental --linked

# Parallel upload (4 concurrent jobs)
supabase storage cp ./assets/ ss:///KBD/uploads/ \
  -r -j 4 --experimental --linked \
  --cache-control "max-age=3600"
```

**Why CLI over HTML/JavaScript:**
- Unified standard approach across all storage operations
- Better performance with parallel uploads (`-j` flag)
- Direct integration with project workflow
- Avoids creating one-off HTML utility files

**Note:** For operations requiring database updates (e.g., updating `profile_photo_url` after upload), write a dedicated script or use Supabase MCP tools to update the database separately.

## Key Implementation Patterns

### TypeScript Module Pattern
```typescript
// Services use static class methods for easy access
import { AuthService } from '@services/auth.service';
import { KBDService } from '@services/kbd.service';

const user = AuthService.getCurrentUser();
const task = await KBDService.getTodayTask(restaurantId, slotType);
```

### Path Aliases (tsconfig.json)
```typescript
// Use aliases instead of relative paths
import { supabaseClient } from '@services/supabase';  // ✅
import { Employee } from '@/types/models';            // ✅
// Avoid: import { ... } from '../../../services/...'  // ❌
```

### Window Global Exposure (for HTML onclick handlers)
```typescript
// Each module exposes itself to window for HTML compatibility
if (typeof window !== 'undefined') {
  window.AuthService = AuthService;
}
```

### RLS Filtering Workaround (v1.4)
Due to RLS limitations with sessionStorage auth, use JavaScript filtering instead of chained `.or()` clauses:
```javascript
// ❌ Don't chain .or() - causes 406 errors
.or('brand_id.is.null,brand_id.eq.1')

// ✅ Filter in JavaScript after query
const tasks = await supabaseClient.from('kbd_task_pool').select('*');
const filtered = tasks?.filter(task =>
  task.brand_id === null || task.brand_id === userBrandId
);
```

### File Upload Path Convention
```
{brand_id}/{restaurant_id}/{year}/{month}/{date}/{slot_type}/{media_type}/{employee_id}_{timestamp}.{ext}

Example: 1/abc-123/2025/12/18/lunch_open/image/emp-456_1734512345.jpg
```

## UI Design Principles (from UI_plan.md)

1. **Map as Emotional Background**: Map is atmosphere, not information source
   - Slight blur + reduced contrast when user hasn't checked in
   - Clears when check-in complete (not a reward, just a reminder)

2. **Avatar Status Visualization**:
   - Unchecked: Grayscale/semi-transparent
   - Checked: Clear + thumbnail preview appears above avatar
   - Current user: Subtle border/glow (no animation)

3. **Floating Check-in Panel Philosophy**:
   - Answer only ONE question: "你打卡了吗？"
   - Extreme minimalism: One message, one subtitle, one button
   - No rules, no history, no instructions

4. **Three-Step Completion Animation** (core UX):
   - Must feel like "task complete, stage returns to map"
   - No explosion, no celebration, just quiet satisfaction

## Important Constraints

### Security & Data
- **RLS enabled** on all KBD tables, but custom auth limits effectiveness
- **Permission level**: Tasks creation requires `permission_level > 50`
- **File size limit**: 50MB per upload (Supabase Storage)
- **Supported formats**: JPG, PNG, MP3, MP4, MOV

### Database Constraints
- **One check-in per slot per day**: UNIQUE (restaurant_id, check_in_date, slot_type)
- **Task pools must have valid slots**: applicable_slots array must contain valid slot types
- **Temporary tasks override routine**: When `is_announced=true` and date matches

### UI/UX Rules
- **Mobile-first**: Viewport settings prevent zoom, fixed positioning
- **No demo features**: Production code should not include mock/demo functionality
- **Avatar fallback**: Uses pravatar.cc for mock avatars (index-based for consistency)
- **Map tiles**: OpenStreetMap standard (better connectivity than CartoDB)

## Common Issues & Solutions

### Login Fails
- Verify employee exists in `master_employee` with `is_active=true`
- Check `is_locked=false`
- Password comparison is currently plain text (not hashed)

### Map Doesn't Show Restaurants
- Ensure `master_restaurant` has valid `latitude` and `longitude` values
- Check browser console for JavaScript errors
- Verify restaurants have `is_active=true`

### Check-in Fails
- Check UNIQUE constraint: Each restaurant can only check-in once per slot per day
- Verify task exists in `kbd_task_pool` with `is_active=true`
- Check Supabase Storage bucket `KBD` permissions and RLS policies

### Task Not Found (406 Errors)
- If using `.or()` with multiple conditions, filter in JavaScript instead
- See "RLS Filtering Workaround" section above

## Development Workflow

1. **Making UI Changes**: Edit TypeScript files in `src/modules/` or CSS in `src/styles/`
2. **Updating API Logic**: Modify `src/services/*.ts` (always update version comment)
3. **Adding Types**: Update `src/types/models.ts` for new data structures
4. **Database Changes**: Use Supabase MCP server or dashboard
5. **Testing**: Run `npm run dev`, check browser console, verify Supabase logs if needed

## Version Tracking

When modifying files, update version comments at the top of each file:
```typescript
// Version: 3.0 - TypeScript migration of AuthService
// Authentication service with type safety
```
