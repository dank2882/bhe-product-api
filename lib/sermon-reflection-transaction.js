"use strict";

const { runDanFirestoreTransaction } = require("./dan-firestore-transaction");

// Reuse the domain validators/normalizers while staging their writes. Firestore
// requires every read before every write; flushing only after validation also
// makes the analysis, learning, and proposal receipt one atomic commit.
async function runReflectionTransaction(deps, callback) {
  return runDanFirestoreTransaction(deps, deps.preachingAnalysesCollection, async transaction => {
    const pending = new Map();
    const atomicDeps = { ...deps };
    for (const [name, collection] of Object.entries(deps)) {
      if (!name.endsWith("Collection") || typeof collection?.doc !== "function") continue;
      const wrapQuery = query => {
        const wrapper = {
          get: async () => {
            if ([...pending.values()].some(write => write.collection === name)) {
              throw new Error(`Reflection transaction cannot query staged writes in ${name}`);
            }
            return transaction.get(query);
          }
        };
        for (const method of ["limit", "where", "orderBy", "select"]) {
          if (typeof query[method] === "function") {
            wrapper[method] = (...args) => wrapQuery(query[method](...args));
          }
        }
        return wrapper;
      };
      atomicDeps[name] = {
        ...wrapQuery(collection),
        doc: id => {
          const ref = collection.doc(id);
          const key = `${name}/${id}`;
          const get = async () => pending.has(key)
            ? { id, exists: true, data: () => structuredClone(pending.get(key).data) }
            : transaction.get(ref);
          return {
            id, get,
            create: async data => {
              if ((await get()).exists) throw new Error(`Document already exists: ${key}`);
              pending.set(key, { collection: name, ref, data, create: true });
            },
            set: async data => {
              pending.set(key, { collection: name, ref, data,
                create: pending.get(key)?.create === true });
            }
          };
        }
      };
    }
    const result = await callback(atomicDeps);
    for (const write of pending.values()) {
      if (write.create) transaction.create(write.ref, write.data);
      else transaction.set(write.ref, write.data);
    }
    return result;
  });
}

module.exports = { runReflectionTransaction };
