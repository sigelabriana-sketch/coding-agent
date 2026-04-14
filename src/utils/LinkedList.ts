/**
 * Generic LinkedList implementation in TypeScript
 */

interface ListNode<T> {
  value: T;
  next: ListNode<T> | null;
}

export class LinkedList<T> {
  private head: ListNode<T> | null;
  private tail: ListNode<T> | null;
  private listSize: number;

  constructor() {
    this.head = null;
    this.tail = null;
    this.listSize = 0;
  }

  /**
   * Add a value to the end of the list
   */
  add(value: T): void {
    const newNode: ListNode<T> = { value, next: null };

    if (!this.head) {
      this.head = newNode;
      this.tail = newNode;
    } else {
      if (this.tail) {
        this.tail.next = newNode;
      }
      this.tail = newNode;
    }

    this.listSize++;
  }

  /**
   * Remove the first occurrence of a value
   * Returns true if removed, false if not found
   */
  remove(value: T): boolean {
    if (!this.head) {
      return false;
    }

    if (this.head.value === value) {
      this.head = this.head.next;
      if (!this.head) {
        this.tail = null;
      }
      this.listSize--;
      return true;
    }

    let current = this.head;
    while (current.next) {
      if (current.next.value === value) {
        current.next = current.next.next;
        if (!current.next) {
          this.tail = current;
        }
        this.listSize--;
        return true;
      }
      current = current.next;
    }

    return false;
  }

  /**
   * Get the value at a specific index
   * Returns undefined if index is out of bounds
   */
  get(index: number): T | undefined {
    if (index < 0 || index >= this.listSize) {
      return undefined;
    }

    let current = this.head;
    for (let i = 0; i < index; i++) {
      current = current?.next ?? null;
      if (!current) {
        return undefined;
      }
    }

    return current?.value;
  }

  /**
   * Return the size of the list
   */
  size(): number {
    return this.listSize;
  }
}
