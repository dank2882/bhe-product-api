#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const project = process.env.GCP_PROJECT_ID || "location-map-985";
const database = process.env.SERMON_ARCHIVE_DATABASE || "chatgptstorage";
const assetBucket = process.env.SERMON_ASSET_BUCKET || "bhe-product-assets";
const backupBucket = process.env.SERMON_ASSET_BACKUP_BUCKET || "bhe-product-assets-backup-location-map-985";
const transferDescription = "Daily backup of BHE product assets";
const deploymentSourceBucket = process.env.DEPLOYMENT_SOURCE_BUCKET || "run-sources-location-map-985-us-west1";
const sourceTransferDescription = "Daily backup of deployed BHE API source";

function gcloud(args) {
  return JSON.parse(execFileSync("gcloud", [...args, "--project", project, "--format=json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }));
}

function durationSeconds(value) {
  if (typeof value === "number") return value;
  const match = String(value || "").match(/^(\d+)(?:s)?$/);
  return match ? Number(match[1]) : 0;
}

const firestore = gcloud(["firestore", "databases", "describe", `--database=${database}`]);
const schedules = gcloud(["firestore", "backups", "schedules", "list", `--database=${database}`]);
const backups = gcloud(["firestore", "backups", "list"]);
const assets = gcloud(["storage", "buckets", "describe", `gs://${assetBucket}`]);
const replica = gcloud(["storage", "buckets", "describe", `gs://${backupBucket}`]);
const deploymentSources = gcloud(["storage", "buckets", "describe", `gs://${deploymentSourceBucket}`]);
const transferJobs = gcloud(["transfer", "jobs", "list"]);
const transferJob = transferJobs.find((job) => job.description === transferDescription);
const sourceTransferJob = transferJobs.find((job) => job.description === sourceTransferDescription);
const transferOperations = transferJob
  ? gcloud(["transfer", "operations", "list", `--job-names=${transferJob.name.replace("transferJobs/", "")}`, "--limit=1"])
  : [];
const latestTransfer = transferOperations[0]?.metadata || null;
const sourceTransferOperations = sourceTransferJob
  ? gcloud(["transfer", "operations", "list", `--job-names=${sourceTransferJob.name.replace("transferJobs/", "")}`, "--limit=1"])
  : [];
const latestSourceTransfer = sourceTransferOperations[0]?.metadata || null;
const daily = schedules.find((schedule) => schedule.dailyRecurrence);
const weekly = schedules.find((schedule) => schedule.weeklyRecurrence);
const newestScheduleCreatedAt = schedules
  .map((schedule) => new Date(schedule.createTime || 0).getTime())
  .filter(Number.isFinite)
  .sort((left, right) => right - left)[0] || 0;
const scheduleGraceActive = Date.now() - newestScheduleCreatedAt < 36 * 60 * 60 * 1000;
const readyBackups = backups.filter((backup) => !backup.state || backup.state === "READY");
const lifecycleDays = (bucket) => (bucket.lifecycle_config?.rule || [])
  .map((rule) => Number(rule.condition?.daysSinceNoncurrentTime || 0));

const checks = {
  firestoreDeleteProtection: firestore.deleteProtectionState === "DELETE_PROTECTION_ENABLED",
  firestorePitr: firestore.pointInTimeRecoveryEnablement === "POINT_IN_TIME_RECOVERY_ENABLED",
  firestorePitrSevenDays: durationSeconds(firestore.versionRetentionPeriod) >= 604800,
  firestoreDailyBackup: durationSeconds(daily?.retention) >= 1209600,
  firestoreWeeklyBackup: durationSeconds(weekly?.retention) >= 7257600,
  firestoreBackupMaterialized: readyBackups.length > 0 || scheduleGraceActive,
  assetVersioning: assets.versioning_enabled === true,
  assetSoftDeleteThirtyDays: durationSeconds(assets.soft_delete_policy?.retentionDurationSeconds) >= 2592000,
  assetNoncurrentRetentionNinetyDays: lifecycleDays(assets).some((days) => days >= 90),
  replicaVersioning: replica.versioning_enabled === true,
  replicaSoftDeleteThirtyDays: durationSeconds(replica.soft_delete_policy?.retentionDurationSeconds) >= 2592000,
  replicaRetentionThirtyDays: durationSeconds(
    replica.retention_policy?.retentionPeriodSeconds || replica.retention_policy?.retentionPeriod
  ) >= 2592000,
  replicaNoncurrentRetentionOneEightyDays: lifecycleDays(replica).some((days) => days >= 180),
  dailyAssetReplication: transferJob?.status === "ENABLED" &&
    durationSeconds(transferJob?.schedule?.repeatInterval) <= 86400 &&
    transferJob?.transferSpec?.transferOptions?.deleteObjectsFromSourceAfterTransfer !== true &&
    transferJob?.transferSpec?.transferOptions?.deleteObjectsUniqueInSink !== true,
  latestAssetReplicationSucceeded: latestTransfer?.status === "SUCCESS",
  deploymentSourceVersioning: deploymentSources.versioning_enabled === true,
  deploymentSourceSoftDeleteThirtyDays: durationSeconds(
    deploymentSources.soft_delete_policy?.retentionDurationSeconds
  ) >= 2592000,
  deploymentSourceNoncurrentRetentionNinetyDays: lifecycleDays(deploymentSources).some((days) => days >= 90),
  dailyDeploymentSourceReplication: sourceTransferJob?.status === "ENABLED" &&
    durationSeconds(sourceTransferJob?.schedule?.repeatInterval) <= 86400 &&
    sourceTransferJob?.transferSpec?.transferOptions?.deleteObjectsFromSourceAfterTransfer !== true &&
    sourceTransferJob?.transferSpec?.transferOptions?.deleteObjectsUniqueInSink !== true,
  latestDeploymentSourceReplicationSucceeded: latestSourceTransfer?.status === "SUCCESS"
};

const result = {
  ok: Object.values(checks).every(Boolean),
  checkedAt: new Date().toISOString(),
  project,
  database,
  assetBucket,
  backupBucket,
  deploymentSourceBucket,
  checks,
  schedules: schedules.map((schedule) => ({
    name: schedule.name,
    recurrence: schedule.dailyRecurrence ? "daily" : `weekly:${schedule.weeklyRecurrence?.day || ""}`,
    retentionSeconds: durationSeconds(schedule.retention)
  })),
  firestoreBackups: {
    readyCount: readyBackups.length,
    initialScheduleGraceActive: scheduleGraceActive
  },
  transferJob: transferJob ? { name: transferJob.name, status: transferJob.status } : null,
  latestTransfer: latestTransfer ? {
    name: latestTransfer.name,
    status: latestTransfer.status,
    objectsFound: Number(latestTransfer.counters?.objectsFoundFromSource || 0),
    objectsCopied: Number(latestTransfer.counters?.objectsCopiedToSink || 0),
    bytesFound: Number(latestTransfer.counters?.bytesFoundFromSource || 0),
    bytesCopied: Number(latestTransfer.counters?.bytesCopiedToSink || 0),
    startedAt: latestTransfer.startTime || "",
    completedAt: latestTransfer.endTime || ""
  } : null,
  sourceTransferJob: sourceTransferJob ? { name: sourceTransferJob.name, status: sourceTransferJob.status } : null,
  latestSourceTransfer: latestSourceTransfer ? {
    name: latestSourceTransfer.name,
    status: latestSourceTransfer.status,
    objectsFound: Number(latestSourceTransfer.counters?.objectsFoundFromSource || 0),
    objectsCopied: Number(latestSourceTransfer.counters?.objectsCopiedToSink || 0),
    bytesFound: Number(latestSourceTransfer.counters?.bytesFoundFromSource || 0),
    bytesCopied: Number(latestSourceTransfer.counters?.bytesCopiedToSink || 0),
    startedAt: latestSourceTransfer.startTime || "",
    completedAt: latestSourceTransfer.endTime || ""
  } : null
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
