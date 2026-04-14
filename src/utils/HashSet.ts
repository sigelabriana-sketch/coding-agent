/**
 * A generic HashSet implementation in TypeScript
 */
export class HashSet<T> {
  private set: Set<T>;

  constructor(items?: T[]) {
    this.set = new Set(items);
  }

  /**
   * Adds an item to the set
   * @param item - The item to add
   * @returns true if the item was added, false if it already existed
   */
  add(item: T): boolean {
    const hadItem = this.set.has(item);
    this.set.add(item);
    return !hadItem;
  }

  /**
   * Checks if the set contains an item
   * @param item - The item to check
   * @returns true if the item exists in the set
   */
  has(item: T): boolean {
    return this.set.has(item);
  }

  /**
   * Deletes an item from the set
   * @param item - The item to delete
   * @returns true if the item was deleted, false if it didn't exist
   */
  delete(item: T): boolean {
    return this.set.delete(item);
  }

  /**
   * Returns the number of items in the set
   */
  get size(): number {
    return this.set.size;
  }

  /**
   * Clears all items from the set
   */
  clear(): void {
    this.set.clear();
  }

  /**
   * Returns an array of all items in the set
   */
  toArray(): T[] {
    return Array.from(this.set);
  }

  /**
   * Returns an iterator over the items in the set
   */
  *[Symbol.iterator](): Iterator<T> {
    yield* this.set.values();
  }
}
