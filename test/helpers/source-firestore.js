'use strict';
const assert=require('node:assert/strict');
// Transactional in-memory Firestore: rejects reads after writes and rolls back
// failures, so tests exercise the production transaction contract.
class Store {
  constructor() { this.data = new Map(); this.tail = Promise.resolve(); }
  collection(name) { return new Query(this, name); }
  async runTransaction(action) {
    const run = this.tail.then(async () => {
      const writes = []; let writing = false;
      const result = await action({
        get: (ref) => { assert.equal(writing, false, "Firestore reads must precede writes"); return ref.get(); },
        create: (ref, value) => { writing = true; writes.push(() => ref.create(value)); },
        set: (ref, value) => { writing = true; writes.push(() => ref.set(value)); },
        update: (ref, value) => { writing = true; writes.push(() => ref.update(value)); },
        delete: (ref) => { writing = true; writes.push(() => ref.delete()); }
      });
      const backup = structuredClone(this.data);
      try { for (const write of writes) await write(); } catch (error) { this.data = backup; throw error; }
      return result;
    });
    this.tail = run.catch(() => {}); return run;
  }
}
class Ref {
  constructor(store, name, id) { this.store = store; this.key = `${name}/${id}`; this.id = id; }
  async get() { const v = this.store.data.get(this.key); return { id: this.id, exists: v !== undefined, data: () => structuredClone(v) }; }
  async set(v) { this.store.data.set(this.key, structuredClone(v)); }
  async create(v) { if (this.store.data.has(this.key)) throw Object.assign(new Error("already exists"), { code: 6 }); await this.set(v); }
  async update(v) { assert(this.store.data.has(this.key)); await this.set({ ...this.store.data.get(this.key), ...v }); }
  async delete() { this.store.data.delete(this.key); }
}
class Query {
  constructor(store, name, filters = [], order = "", after = "", maximum = Infinity, nearest = null) { Object.assign(this, { store, name, filters, order, after, maximum, nearest }); }
  copy(changes) { return Object.assign(new Query(this.store, this.name), this, changes); }
  doc(id) { return new Ref(this.store, this.name, id); }
  where(field, op, value) { return this.copy({ filters: [...this.filters, [field, op, value]] }); }
  orderBy(field) { return this.copy({ order: field }); }
  startAfter(value) { return this.copy({ after: value }); }
  limit(maximum) { return this.copy({ maximum }); }
  findNearest(nearest) { return this.copy({ nearest, maximum: nearest.limit }); }
  count() { return { get: async () => ({ data: () => ({ count: this.values().length }) }) }; }
  values() {
    let rows = [...this.store.data.entries()].filter(([key]) => key.startsWith(`${this.name}/`))
      .map(([key, value]) => ({ id: key.split("/")[1], ...structuredClone(value) }))
      .filter((v) => this.filters.every(([f, op, val]) => op === "==" ? v[f] === val : op === "in" ? val.includes(v[f]) : op === "array-contains-any" ? val.some((t) => v[f]?.includes(t)) : false));
    if (this.nearest) rows = rows.filter((r) => r.embeddingVector).map((r) => ({ ...r, vectorDistance: r.embeddingVector.reduce((n, x, i) => n + (x - this.nearest.queryVector[i]) ** 2, 0) })).sort((a, b) => a.vectorDistance - b.vectorDistance);
    else if (this.order) rows.sort((a, b) => a[this.order] < b[this.order] ? -1 : 1);
    if (this.after) rows = rows.filter((r) => r[this.order] > this.after);
    return rows.slice(0, this.maximum);
  }
  async get() { return { docs: this.values().map((v) => ({ id: v.id, data: () => { const { id, ...data } = v; return data; } })) }; }
}

module.exports={Store};
