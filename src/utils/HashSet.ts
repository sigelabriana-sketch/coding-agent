/**
 * A generic HashSet implementation in TypeScript
 * Provides O(1) average case complexity for add, has, delete operations
 */
export class HashSet<T> {
  private data: T[] = [];
  private indexMap: Map<string, number> = new Map();
  private size: number = 0;

  /**
   * Adds an element to the set
   * @param item - The item to add
   * @returns true if the item was added (didn't exist), false if it was already in the set
   */
  add(item: T): boolean {
    const key = this.#makeKey(item);
    
    if (this.indexMap.has(key)) {
      return false;
    }

    const index = this.data.length;
    this.data.push(item);
    this.indexMap.set(key, index);
    this.size++;
    return true;
  }

  /**
   * Checks if an element exists in the set
   * @param item - The item to check
   * @returns true if the item exists in the set
   */
  has(item: T): boolean {
    const key = this.#makeKey(item);
    return this.indexMap.has(key);
  }

  /**
   * Removes an element from the set
   * @param item - The item to delete
   * @returns true if the item was removed, false if it wasn't in the set
   */
  delete(item: T): boolean {
    const key = this.#makeKey(item);
    const index = this.indexMap.get(key);

    if (index === undefined) {
      return false;
    }

    // Move the last element to the deleted position and update its index
    const lastElement = this.data[this.data.length - 1];
    const lastIndex = this.data.length - 1;

    if (index !== lastIndex) {
      this.data[index] = lastElement;
      this.indexMap.set(this.#makeKey(lastElement), index);
    }

    this.data.pop();
    this.indexMap.delete(key);
    this.size--;
    return true;
  }

  /**
   * Returns the number of elements in the set
   */
  size(): number {
    return this.size;
  }

  /**
   * Returns an array of all elements in the set
   */
  toArray(): T[] {
    return [...this.data];
  }

  /**
   * Clears all elements from the set
   */
  clear(): void {
    this.data = [];
    this.indexMap.clear();
    this.size = 0;
  }

  /**
   * Returns true if the set is empty
   */
  isEmpty(): boolean {
    return this.size === 0;
  }

  /**
   * Creates a unique string key for any item
   * Uses JSON.stringify for objects, toISOString for Date, etc.
   */
  #makeKey(item: T): string {
    if (item === null || item === undefined) {
      return String(item);
    }
    
    if (typeof item !== 'object') {
      return String(item);
    }

    // Handle special object types
    if (item instanceof Date) {
      return 'date:' + item.toISOString();
    }

    if (Array.isArray(item)) {
      return 'array:' + JSON.stringify(item);
    }

    // For plain objects, sort keys for consistent serialization
    try {
      const sortedKeys = Object.keys(item).sort();
      const sortedObj: Record<string, unknown> = {};
      for (const key of sortedKeys) {
        sortedObj[key] = (item as Record<string, unknown>)[key];
      }
      return 'object:' + JSON.stringify(sortedObj);
    } catch {
      return 'object:' + String(item);
    }
  }
}
