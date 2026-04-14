/**
 * LRU Cache implementation using TypeScript
 * Uses JavaScript Map for O(1) get, put, and eviction operations
 */
export class LRUCache {
  private capacity: number;
  private cache: Map<number, number>;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.cache = new Map<number, number>();
  }

  /**
   * Returns the value of the key if it exists, otherwise returns -1.
   * When accessed, the key becomes most recently used.
   */
  get(key: number): number {
    if (!this.cache.has(key)) {
      return -1;
    }

    // Move the key to the end (most recently used)
    // by deleting and re-inserting
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);

    return value;
  }

  /**
   * Inserts a key-value pair into the cache.
   * If the cache is at capacity, evicts the least recently used key.
   * When inserted, the key becomes most recently used.
   */
  put(key: number, value: number): void {
    // If key already exists, delete it first to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Insert the new key-value pair (becomes most recently used)
    this.cache.set(key, value);

    // If cache exceeds capacity, evict the least recently used key
    // (the first/oldest entry in the Map)
    if (this.cache.size > this.capacity) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
  }
}
