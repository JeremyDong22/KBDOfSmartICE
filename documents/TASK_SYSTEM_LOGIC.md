# Task System Logic Documentation

**Version:** 1.0
**Last Updated:** 2025-12-21
**Related:** See [CLAUDE.md](./CLAUDE.md) for full project documentation

---

## Overview

The KBD task system manages daily check-in tasks across multiple restaurant brands and locations. Tasks are assigned using a two-branch logic system that combines brand-level random selection with store-specific temporary overrides.

**Key Concepts:**
- **Routine Tasks**: Recurring tasks selected randomly based on weight
- **Temporary Tasks**: One-time tasks for specific dates/slots that override routine tasks
- **Scope Hierarchy**: Global → Brand → Store (each level can override the previous)

---

## Database Schema

### kbd_task_pool Table Structure

```sql
CREATE TABLE kbd_task_pool (
  id UUID PRIMARY KEY,
  brand_id INTEGER REFERENCES master_brand(id),  -- NULL = global
  restaurant_id UUID REFERENCES master_restaurant(id),  -- NULL = brand-level
  task_name VARCHAR NOT NULL,
  task_description TEXT NOT NULL,
  media_type VARCHAR NOT NULL,  -- notification, text, voice, image, video
  applicable_slots VARCHAR[] NOT NULL,  -- Array of slot types
  is_routine BOOLEAN NOT NULL,
  weight INTEGER DEFAULT 100,
  fixed_weekdays INT4[],  -- 0=Sunday, 6=Saturday
  fixed_slots VARCHAR[],
  execute_date DATE,  -- For temporary tasks
  execute_slot VARCHAR,  -- For temporary tasks
  is_announced BOOLEAN DEFAULT false,
  announced_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES master_employee(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraint: Prevent duplicate temporary tasks
  CONSTRAINT unique_temporary_task
    UNIQUE (execute_date, execute_slot, brand_id, restaurant_id)
);
```

### Scope Hierarchy

| brand_id | restaurant_id | Scope | Applies To |
|----------|---------------|-------|------------|
| NULL | NULL | Global | All brands, all stores |
| X | NULL | Brand-level | All stores in brand X |
| X | Y | Store-specific | Only store Y in brand X |

**Important:** Lower-level scopes override higher-level scopes:
- Store-specific > Brand-level > Global

### Task Record Rules

1. **One Record = One Date + One Slot**
   - If a task applies to multiple dates/slots, create multiple records
   - Example: Task for 3 days × 2 slots = 6 separate records

2. **applicable_slots Array**
   - Defines which slot types a routine task can appear in
   - `['lunch_open', 'dinner_open']` → Only opening slots
   - `['lunch_open', 'lunch_close', 'dinner_open', 'dinner_close']` → All slots

3. **Temporary Task Uniqueness**
   - Cannot have duplicate temporary tasks for same (date, slot, brand, store)
   - CAN have brand-level and store-specific tasks coexist (store overrides brand)

---

## Task Selection Logic (Two-Branch System)

### System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    TASK SELECTION SYSTEM                         │
│                                                                  │
│  ┌──────────────────────┐      ┌──────────────────────┐        │
│  │   BRANCH 1:          │      │   BRANCH 2:          │        │
│  │   Brand-Level        │      │   Store-Specific     │        │
│  │   Random Selection   │      │   Temporary Override │        │
│  └──────────────────────┘      └──────────────────────┘        │
│           │                              │                      │
│           │                              │                      │
│           ▼                              ▼                      │
│  Pick ONE task for       ─────────→  Override for specific     │
│  ALL stores in brand                 stores if exists          │
└─────────────────────────────────────────────────────────────────┘
```

### Branch 1: Brand-Level Random Selection

**Purpose:** Select ONE routine task that applies to ALL stores under a brand

**Algorithm:**
```
Input: brand_id, slot_type, date

1. Query routine tasks:
   SELECT * FROM kbd_task_pool
   WHERE is_routine = true
     AND is_active = true
     AND slot_type = ANY(applicable_slots)
     AND (brand_id IS NULL OR brand_id = input_brand_id)
     AND restaurant_id IS NULL

2. Filter by weekday (if fixed routine):
   IF fixed_weekdays IS NOT NULL:
     FILTER WHERE weekday(date) = ANY(fixed_weekdays)

   IF fixed_slots IS NOT NULL:
     FILTER WHERE slot_type = ANY(fixed_slots)

3. Weighted random selection:
   - Calculate total weight: SUM(weight)
   - Generate random number: rand(0, total_weight)
   - Select task based on cumulative weight distribution

4. Result:
   - ONE task selected
   - Applies to ALL stores in the brand
```

**Scope Priority for Routine Tasks:**
1. Brand-specific tasks (brand_id = X, restaurant_id = NULL)
2. Global tasks (brand_id = NULL, restaurant_id = NULL)

### Branch 2: Temporary Task Override

**Purpose:** Replace brand-level task for specific stores or entire brand

**Algorithm:**
```
Input: brand_id, restaurant_id, slot_type, date

1. Query temporary tasks:
   SELECT * FROM kbd_task_pool
   WHERE is_routine = false
     AND is_announced = true
     AND execute_date = input_date
     AND execute_slot = input_slot_type
     AND slot_type = ANY(applicable_slots)
     AND is_active = true

2. Filter by scope (ROBUST FILTERING):
   Priority order (highest to lowest):

   a) Store-specific temporary task:
      WHERE brand_id = input_brand_id
        AND restaurant_id = input_restaurant_id

   b) Brand-level temporary task:
      WHERE brand_id = input_brand_id
        AND restaurant_id IS NULL

   c) Global temporary task:
      WHERE brand_id IS NULL
        AND restaurant_id IS NULL

3. Apply override:
   IF store-specific task found:
     RETURN store-specific task (only for this store)
   ELSE IF brand-level task found:
     RETURN brand-level task (for all stores in brand)
   ELSE IF global task found:
     RETURN global task (for all stores in all brands)
   ELSE:
     RETURN result from Branch 1
```

**Scope Priority for Temporary Tasks:**
1. Store-specific (brand_id = X, restaurant_id = Y)
2. Brand-level (brand_id = X, restaurant_id = NULL)
3. Global (brand_id = NULL, restaurant_id = NULL)

### Complete Flow Diagram

```
Employee Opens Check-in Panel
(Brand B, Store S, Slot T, Date D)
│
├──────────────────────────────────────────────────────────────────┐
│                                                                   │
▼ BRANCH 1: Brand-Level Routine Task Selection                     │
│                                                                   │
┌─────────────────────────────────────────────────────────────────┐│
│ 1. Query routine tasks:                                          ││
│    - is_routine = true                                           ││
│    - is_active = true                                            ││
│    - T IN applicable_slots                                       ││
│    - (brand_id IS NULL OR brand_id = B)                          ││
│    - restaurant_id IS NULL                                       ││
└─────────────────────────────────────────────────────────────────┘│
│                                                                   │
┌─────────────────────────────────────────────────────────────────┐│
│ 2. Filter by weekday (if fixed):                                 ││
│    - fixed_weekdays IS NULL OR weekday(D) IN fixed_weekdays      ││
│    - fixed_slots IS NULL OR T IN fixed_slots                     ││
└─────────────────────────────────────────────────────────────────┘│
│                                                                   │
┌─────────────────────────────────────────────────────────────────┐│
│ 3. Weighted random selection:                                    ││
│    - Calculate cumulative weights                                ││
│    - Select ONE task → Task A                                    ││
│    - Task A applies to ALL stores in Brand B                     ││
└─────────────────────────────────────────────────────────────────┘│
│                                                                   │
│                                                                   │
▼ BRANCH 2: Temporary Task Override Check                          │
│                                                                   │
┌─────────────────────────────────────────────────────────────────┐│
│ 4. Query temporary tasks:                                        ││
│    - is_routine = false                                          ││
│    - is_announced = true                                         ││
│    - execute_date = D                                            ││
│    - execute_slot = T                                            ││
│    - T IN applicable_slots                                       ││
│    - is_active = true                                            ││
└─────────────────────────────────────────────────────────────────┘│
│                                                                   │
┌─────────────────────────────────────────────────────────────────┐│
│ 5. Robust scope filtering (priority order):                      ││
│                                                                   ││
│    Priority 1: Store-specific                                    ││
│    ┌──────────────────────────────────────────────────────────┐ ││
│    │ brand_id = B AND restaurant_id = S                        │ ││
│    └──────────────────────────────────────────────────────────┘ ││
│                          │                                        ││
│                    Found? │ Not Found                             ││
│                          ▼                                        ││
│                   Use for Store S only                            ││
│                                                                   ││
│    Priority 2: Brand-level                                       ││
│    ┌──────────────────────────────────────────────────────────┐ ││
│    │ brand_id = B AND restaurant_id IS NULL                    │ ││
│    └──────────────────────────────────────────────────────────┘ ││
│                          │                                        ││
│                    Found? │ Not Found                             ││
│                          ▼                                        ││
│                   Use for ALL stores in Brand B                   ││
│                                                                   ││
│    Priority 3: Global                                            ││
│    ┌──────────────────────────────────────────────────────────┐ ││
│    │ brand_id IS NULL AND restaurant_id IS NULL                │ ││
│    └──────────────────────────────────────────────────────────┘ ││
│                          │                                        ││
│                    Found? │ Not Found                             ││
│                          ▼                                        ││
│                   Use for ALL stores in ALL brands                ││
└─────────────────────────────────────────────────────────────────┘│
│                                                                   │
┌─────────────────────────────────────────────────────────────────┐│
│ 6. Final Decision:                                               ││
│                                                                   ││
│    IF temporary task found (any priority level):                 ││
│       RETURN temporary task                                      ││
│    ELSE:                                                         ││
│       RETURN Task A from Branch 1                                ││
└─────────────────────────────────────────────────────────────────┘│
                          │                                         │
                          ▼                                         │
                 Display Task to Employee                           │
```

---

## Example Scenarios

### Scenario 1: Normal Day (No Temporary Tasks)

**Context:**
- Brand: 野百灵 (ID=1)
- Stores: Store A, Store B, Store C
- Slot: lunch_open
- Date: 2025-12-22

**Branch 1 Execution:**
```
Query routine tasks for brand_id=1, slot=lunch_open:
- 检查食材新鲜度 (weight=100)
- 检查后厨卫生 (weight=80)
- 门店地面卫生检查 (weight=100, global task)

Total weight: 280
Random selection → 检查食材新鲜度
```

**Branch 2 Execution:**
```
Query temporary tasks for date=2025-12-22, slot=lunch_open:
- No temporary tasks found
```

**Result:**
- Store A → 检查食材新鲜度
- Store B → 检查食材新鲜度
- Store C → 检查食材新鲜度

---

### Scenario 2: Store-Specific Temporary Task

**Context:**
- Brand: 野百灵 (ID=1)
- Stores: Store A, Store B, Store C
- Slot: lunch_open
- Date: 2025-12-21

**Branch 1 Execution:**
```
Random selection → 检查食材新鲜度
```

**Branch 2 Execution:**
```
Query temporary tasks:
- Found: "烤箱设备检修记录"
  - brand_id=1, restaurant_id=Store B
  - execute_date=2025-12-21, execute_slot=lunch_open

Scope: Store-specific (Priority 1)
Applies to: Store B only
```

**Result:**
- Store A → 检查食材新鲜度 (from Branch 1)
- Store B → 烤箱设备检修记录 (temporary override)
- Store C → 检查食材新鲜度 (from Branch 1)

---

### Scenario 3: Brand-Level Temporary Task

**Context:**
- Brand: 野百灵 (ID=1)
- Stores: Store A, Store B, Store C
- Slot: lunch_open
- Date: 2025-12-21

**Branch 1 Execution:**
```
Random selection → 检查食材新鲜度
```

**Branch 2 Execution:**
```
Query temporary tasks:
- Found: "元旦食品安全专项检查"
  - brand_id=1, restaurant_id=NULL
  - execute_date=2025-12-21, execute_slot=lunch_open

Scope: Brand-level (Priority 2)
Applies to: All stores in Brand 1
```

**Result:**
- Store A → 元旦食品安全专项检查 (temporary override)
- Store B → 元旦食品安全专项检查 (temporary override)
- Store C → 元旦食品安全专项检查 (temporary override)

---

### Scenario 4: Global Temporary Task

**Context:**
- Brand: 野百灵 (ID=1), 宁桂杏 (ID=2)
- All stores across all brands
- Slot: dinner_close
- Date: 2025-12-31

**Branch 1 Execution:**
```
Each brand gets its own random selection:
- Brand 1 → 今日营业总结
- Brand 2 → 设备关闭检查
```

**Branch 2 Execution:**
```
Query temporary tasks:
- Found: "年终安全检查"
  - brand_id=NULL, restaurant_id=NULL
  - execute_date=2025-12-31, execute_slot=dinner_close

Scope: Global (Priority 3)
Applies to: All stores in all brands
```

**Result:**
- All stores in Brand 1 → 年终安全检查 (global override)
- All stores in Brand 2 → 年终安全检查 (global override)

---

### Scenario 5: Mixed Override (Store + Brand)

**Context:**
- Brand: 野百灵 (ID=1)
- Stores: Store A, Store B, Store C, Store D
- Slot: lunch_open
- Date: 2025-12-21

**Branch 1 Execution:**
```
Random selection → 检查食材新鲜度
```

**Branch 2 Execution:**
```
Query temporary tasks:
- Found (1): "元旦食品安全专项检查"
  - brand_id=1, restaurant_id=NULL (brand-level)

- Found (2): "烤箱设备检修记录"
  - brand_id=1, restaurant_id=Store B (store-specific)

Scope filtering:
- Store A: Brand-level task (Priority 2)
- Store B: Store-specific task (Priority 1) ← Higher priority
- Store C: Brand-level task (Priority 2)
- Store D: Brand-level task (Priority 2)
```

**Result:**
- Store A → 元旦食品安全专项检查 (brand-level temporary)
- Store B → 烤箱设备检修记录 (store-specific temporary, overrides brand)
- Store C → 元旦食品安全专项检查 (brand-level temporary)
- Store D → 元旦食品安全专项检查 (brand-level temporary)

---

## Implementation Guide

### Frontend Logic (JavaScript)

```javascript
/**
 * Get today's task for a specific restaurant and slot
 * Implements two-branch task selection logic
 */
async function getTodayTask(restaurantId, slotType, date) {
  const restaurant = await getRestaurant(restaurantId);
  const brandId = restaurant.brand_id;
  const weekday = new Date(date).getDay(); // 0=Sunday, 6=Saturday

  // BRANCH 1: Get brand-level routine task
  const routineTasks = await fetchRoutineTasks(brandId, slotType, date, weekday);
  const defaultTask = weightedRandomSelect(routineTasks);

  // BRANCH 2: Check for temporary override (robust filtering)
  const temporaryTask = await fetchTemporaryTask(
    brandId,
    restaurantId,
    slotType,
    date
  );

  // Return temporary if exists (any scope), otherwise default
  return temporaryTask || defaultTask;
}

/**
 * Fetch routine tasks for brand-level selection
 */
async function fetchRoutineTasks(brandId, slotType, date, weekday) {
  const { data: tasks } = await supabaseClient
    .from('kbd_task_pool')
    .select('*')
    .eq('is_routine', true)
    .eq('is_active', true)
    .is('restaurant_id', null)
    .contains('applicable_slots', [slotType]);

  // Filter by brand scope (JavaScript filtering due to RLS)
  const scopedTasks = tasks.filter(task =>
    task.brand_id === null || task.brand_id === brandId
  );

  // Filter by fixed weekday/slot if applicable
  const filteredTasks = scopedTasks.filter(task => {
    // If fixed_weekdays is set, check if today matches
    if (task.fixed_weekdays && task.fixed_weekdays.length > 0) {
      if (!task.fixed_weekdays.includes(weekday)) return false;
    }

    // If fixed_slots is set, check if current slot matches
    if (task.fixed_slots && task.fixed_slots.length > 0) {
      if (!task.fixed_slots.includes(slotType)) return false;
    }

    return true;
  });

  return filteredTasks;
}

/**
 * Fetch temporary task with robust scope filtering
 * Priority: Store-specific > Brand-level > Global
 */
async function fetchTemporaryTask(brandId, restaurantId, slotType, date) {
  const { data: tasks } = await supabaseClient
    .from('kbd_task_pool')
    .select('*')
    .eq('is_routine', false)
    .eq('is_announced', true)
    .eq('execute_date', date)
    .eq('execute_slot', slotType)
    .eq('is_active', true)
    .contains('applicable_slots', [slotType]);

  if (!tasks || tasks.length === 0) return null;

  // Priority 1: Store-specific temporary task
  const storeSpecific = tasks.find(task =>
    task.brand_id === brandId && task.restaurant_id === restaurantId
  );
  if (storeSpecific) return storeSpecific;

  // Priority 2: Brand-level temporary task
  const brandLevel = tasks.find(task =>
    task.brand_id === brandId && task.restaurant_id === null
  );
  if (brandLevel) return brandLevel;

  // Priority 3: Global temporary task
  const global = tasks.find(task =>
    task.brand_id === null && task.restaurant_id === null
  );
  if (global) return global;

  return null;
}

/**
 * Weighted random selection
 */
function weightedRandomSelect(tasks) {
  if (!tasks || tasks.length === 0) return null;

  const totalWeight = tasks.reduce((sum, task) => sum + (task.weight || 100), 0);
  let random = Math.random() * totalWeight;

  for (const task of tasks) {
    random -= (task.weight || 100);
    if (random <= 0) return task;
  }

  return tasks[0]; // Fallback
}
```

### Database Constraint (Already Applied)

```sql
-- Prevent duplicate temporary tasks for same date+slot+brand+store
ALTER TABLE kbd_task_pool
ADD CONSTRAINT unique_temporary_task
UNIQUE (execute_date, execute_slot, brand_id, restaurant_id);
```

---

## UI Display

### Task Panel Structure

```
┌─────────────────────────────────────┐
│  [Task Name]                        │
│  任务名称                            │
│                                     │
│  [Task Description]                 │
│  任务描述详情                        │
│                                     │
│  [Media Input Based on Type]        │
│  ┌─────────────────────────────┐   │
│  │ notification: Read-only     │   │
│  │ text: Text input box        │   │
│  │ voice: Voice recorder       │   │
│  │ image: Camera/upload        │   │
│  │ video: Video recorder       │   │
│  └─────────────────────────────┘   │
│                                     │
│  [Submit Button]                    │
└─────────────────────────────────────┘
```

### Media Type Behaviors

| Media Type | UI Component | User Action | Storage |
|------------|--------------|-------------|---------|
| notification | Read-only text | Acknowledge | None |
| text | Text input box | Type text | kbd_check_in_record.text_content |
| voice | Voice recorder | Record audio | Supabase Storage → media_urls[] |
| image | Camera/upload | Take/upload photo | Supabase Storage → media_urls[] |
| video | Video recorder | Record video | Supabase Storage → media_urls[] |

---

## Edge Cases & FAQs

### Q1: What if no tasks match?

**Answer:** Return `null` and handle in UI:
- Option A: Show generic notification "请确认门店状态正常"
- Option B: Block check-in with error message
- Option C: Allow check-in without task (task_id=NULL)

**Recommendation:** Option A (generic notification) for better UX

### Q2: Can a temporary task apply to multiple slots?

**Answer:** No. Each temporary task record is for ONE date + ONE slot.
- If you need a task for multiple slots, create multiple records
- Example: Task for lunch_open + dinner_open = 2 records

### Q3: Can brand-level and store-specific temporary tasks coexist?

**Answer:** Yes. Store-specific tasks override brand-level tasks.
- Brand-level: Applies to all stores in brand
- Store-specific: Overrides brand-level for that specific store

### Q4: How are global tasks handled?

**Answer:** Global tasks (brand_id=NULL) apply to all brands.
- For routine tasks: Included in random selection pool for all brands
- For temporary tasks: Override all brands unless more specific task exists

### Q5: What happens if a temporary task's date has passed?

**Answer:** Frontend filters by exact date match.
- If execute_date < today → Task won't be returned
- No automatic cleanup needed (handled by query logic)

### Q6: Can multiple temporary tasks exist for the same date+slot+brand?

**Answer:** Yes, if they target different stores.
- Brand-level (restaurant_id=NULL): Applies to all stores
- Store-specific (restaurant_id=X): Applies to specific store
- UNIQUE constraint prevents duplicates at same scope level

### Q7: How is task expiration handled?

**Answer:** By date matching in query.
- Temporary tasks only appear when execute_date = today
- Past tasks remain in database but won't be selected
- No automatic expiration mechanism needed

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-21 | Initial documentation with two-branch logic and robust filtering |

---

**For full project documentation, see [CLAUDE.md](./CLAUDE.md)**
