export default class HashMap<K, V> {
  private map = new Map<K, V>();
  set(key: K, value: V) { this.map.set(key, value); }
  get(key: K): V | undefined { return this.map.get(key); }
  has(key: K): boolean { return this.map.has(key); }
  delete(key: K): boolean { return this.map.delete(key); }
  keys(): IterableIterator<K> { return this.map.keys(); }
  values(): IterableIterator<V> { return this.map.values(); }
  get size(): number { return this.map.size; }
}
