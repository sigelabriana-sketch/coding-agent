/**
 * Generic HashMap class using Map internally
 * Provides a Map-like interface with additional utility methods
 */
export class HashMap<K, V> {
  private map: Map<K, V>;

  constructor(entries?: Iterable<readonly [K, V]>) {
    this.map = new Map(entries);
  }

  /**
   * Set a value for a key
   * @param key The key to set
   * @param value The value to set
   * @returns The HashMap instance for chaining
   */
  set(key: K, value: V): this {
    this.map.set(key, value);
    return this;
  }

  /**
   * Get a value by key
   * @param key The key to retrieve
   * @returns The value, or undefined if not found
   */
  get(key: K): V | undefined {
    return this.map.get(key);
  }

  /**
   * Check if a key exists
   * @param key The key to check
   * @returns true if the key exists, false otherwise
   */
  has(key: K): boolean {
    return this.map.has(key);
  }

  /**
   * Delete a key-value pair
   * @param key The key to delete
   * @returns true if the key was found and deleted, false otherwise
   */
  delete(key: K): boolean {
    return this.map.delete(key);
  }

  /**
   * Get the size of the HashMap
   * @returns The number of key-value pairs
   */
  size(): number {
    return this.map.size;
  }

  /**
   * Clear all key-value pairs
   * @returns The HashMap instance for chaining
   */
  clear(): this {
    this.map.clear();
    return this;
  }

  /**
   * Get all keys
   * @returns An array of all keys
   */
  keys(): K[] {
    return Array.from(this.map.keys());
  }

  /**
   * Get all values
   * @returns An array of all values
   */
  values(): V[] {
    return Array.from(this.map.values());
  }

  /**
   * Get all entries as an array of key-value pairs
   * @returns An array of all key-value pairs
   */
  entries(): Array<[K, V]> {
    return Array.from(this.map.entries());
  }

  /**
   * Iterate over all key-value pairs
   * @param callback Function to execute for each key-value pair
   */
  forEach(callback: (value: V, key: K, map: HashMap<K, V>) => void): void {
    this.map.forEach((value, key) => callback(value, key, this));
  }

  /**
   * Convert to a plain object (only for string keys)
   * @returns A plain JavaScript object
   */
  toJSON(): Record<string, any> {
    const obj: Record<string, any> = {};
    for (const [key, value] of this.map.entries()) {
      obj[String(key)] = value;
    }
    return obj;
  }

  /**
   * Create a copy of this HashMap
   * @returns A new HashMap with the same entries
   */
  clone(): HashMap<K, V> {
    return new HashMap(this.map.entries());
  }

  /**
   * Get a value or a default if not found
   * @param key The key to retrieve
   * @param defaultValue The default value if key is not found
   * @returns The value or default value
   */
  getOrDefault(key: K, defaultValue: V): V {
    return this.map.get(key) ?? defaultValue;
  }

  /**
   * Execute a callback only if the key exists
   * @param key The key to check
   * @param callback The function to execute if key exists
   */
  ifExists(key: K, callback: (value: V) => void): void {
    const value = this.map.get(key);
    if (value !== undefined) {
      callback(value);
    }
  }

  /**
   * Merge another HashMap into this one
   * @param other The HashMap to merge
   * @returns The HashMap instance for chaining
   */
  merge(other: HashMap<K, V>): this {
    for (const [key, value] of other.entries()) {
      this.set(key, value);
    }
    return this;
  }
}
