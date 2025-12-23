// Version: 1.0 - Seeded random utilities for deterministic task selection
// Implements djb2 hash and Mulberry32 PRNG for consistent random task assignment across clients

/**
 * Generates a 32-bit integer seed from date, brand ID, and slot type using djb2 hash algorithm
 * @param date - Date string in 'YYYY-MM-DD' format
 * @param brandId - Brand identifier (integer)
 * @param slotType - Time slot type (e.g., 'lunch_open', 'dinner_close')
 * @returns 32-bit unsigned integer seed
 */
export function generateSeed(date: string, brandId: number, slotType: string): number {
  const input = `${date}_${brandId}_${slotType}`;

  // djb2 hash algorithm
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i);
    hash = hash & 0xFFFFFFFF; // Convert to 32-bit integer
  }

  return hash >>> 0; // Convert to unsigned integer
}

/**
 * Creates a seeded random number generator using Mulberry32 algorithm
 * @param seed - Seed value (32-bit integer)
 * @returns Function that returns random numbers between 0 (inclusive) and 1 (exclusive)
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed;

  return function(): number {
    // Mulberry32 PRNG algorithm
    let t = state += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Selects a random element index based on weights using weighted random sampling
 * @param items - Array of items to choose from
 * @param weights - Corresponding weight array (must match items length)
 * @param random - Seeded random number generator function
 * @returns Index of selected item, or -1 if inputs are invalid
 */
export function weightedRandomSelect<T>(
  items: T[],
  weights: number[],
  random: () => number
): number {
  if (items.length === 0 || items.length !== weights.length) {
    return -1;
  }

  // Calculate total weight
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  if (totalWeight <= 0) {
    return -1;
  }

  // Generate random value in [0, totalWeight)
  const randomValue = random() * totalWeight;

  // Find the item corresponding to this random value
  let cumulativeWeight = 0;
  for (let i = 0; i < items.length; i++) {
    cumulativeWeight += weights[i]!;
    if (randomValue < cumulativeWeight) {
      return i;
    }
  }

  // Fallback to last item (should rarely happen due to floating point precision)
  return items.length - 1;
}

/**
 * Convenience function: selects a daily task deterministically based on date, brand, and slot
 * @param tasks - Array of tasks with id and weight properties
 * @param date - Date string 'YYYY-MM-DD'
 * @param brandId - Brand ID (integer)
 * @param slotType - Time slot type
 * @returns Selected task object, or null if task array is empty or invalid
 */
export function selectDailyTask<T extends { id: string; weight: number }>(
  tasks: T[],
  date: string,
  brandId: number,
  slotType: string
): T | null {
  if (tasks.length === 0) {
    return null;
  }

  // Generate seed from date, brand, and slot
  const seed = generateSeed(date, brandId, slotType);

  // Create seeded random generator
  const random = createSeededRandom(seed);

  // Extract weights
  const weights = tasks.map(task => task.weight);

  // Select index using weighted random
  const selectedIndex = weightedRandomSelect(tasks, weights, random);

  if (selectedIndex === -1) {
    return null;
  }

  return tasks[selectedIndex] ?? null;
}
