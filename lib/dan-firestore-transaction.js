"use strict";

function getFirestoreDb(deps = {}, collection) {
  const firestoreDb = deps.firestoreDb || collection?.firestore;
  if (!firestoreDb || typeof firestoreDb.runTransaction !== "function") {
    const error = new Error("Dan private Firestore transactions are not configured");
    error.statusCode = 500;
    error.code = "dan_private_transactions_not_configured";
    throw error;
  }
  return firestoreDb;
}

async function runDanFirestoreTransaction(deps, collection, callback) {
  return getFirestoreDb(deps, collection).runTransaction(callback);
}

module.exports = {
  getFirestoreDb,
  runDanFirestoreTransaction
};
