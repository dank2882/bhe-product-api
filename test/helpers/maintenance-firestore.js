"use strict";
// A serialized transactional store with snapshot versions. Exercised by domain
// concurrency tests; live Firestore/IAM acceptance remains a separate gate.
function fakeFirestore() {
  const rows = new Map(); let lock = Promise.resolve(), tick = 0;
  const clone = value => value === undefined ? undefined : structuredClone(value);
  const conflict = code => Object.assign(new Error("Storage conflict"), { code });
  function ref(path) {
    const id = path.split("/").at(-1);
    const r = { path, id, firestore: db, collection: name => collection(`${path}/${name}`),
      get: async () => { const saved = rows.get(path), data = clone(saved?.data), t = saved?.tick; return { id, ref: r, exists: !!saved, updateTime: t, data: () => clone(data) }; },
      create: async data => { if (rows.has(path)) throw conflict(6); rows.set(path, { data: clone(data), tick: ++tick }); },
      set: async data => { rows.set(path, { data: clone(data), tick: ++tick }); },
      update: async (data, precondition) => { const old = rows.get(path); if (!old) throw conflict(5); if (precondition && precondition.lastUpdateTime !== old.tick) throw conflict(9); rows.set(path, { data: { ...old.data, ...clone(data) }, tick: ++tick }); },
      delete: async () => rows.delete(path)
    }; return r;
  }
  function collection(path, filters = [], after = "", max = 10001) {
    return { path, firestore: db, doc: id => ref(`${path}/${id}`),
      where: (field, op, value) => collection(path, [...filters, [field, value]], after, max),
      orderBy: () => collection(path, filters, after, max),
      startAfter: value => collection(path, filters, typeof value === "string" ? value : value.id, max),
      limit: value => collection(path, filters, after, value),
      get: async () => ({ docs: await Promise.all([...rows.keys()].filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/") && key.split("/").at(-1) > after && filters.every(([k,v]) => rows.get(key).data[k] === v)).sort().slice(0, max).map(key => ref(key).get())) })
    };
  }
  const db = { collection, rows, runTransaction: fn => {
    const run = lock.then(async () => {
      const writes = [];
      const result = await fn({ get: q => q.get(), set: (r,d) => writes.push(() => r.set(d)), create: (r,d) => writes.push(() => r.create(d)), update: (r,d,p) => writes.push(() => r.update(d,p)), delete: r => writes.push(() => r.delete()) });
      for (const write of writes) await write(); return result;
    });
    lock = run.catch(() => {}); return run;
  }};
  return db;
}
module.exports = { fakeFirestore };
