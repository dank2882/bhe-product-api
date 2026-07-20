# Sermon Archive Backup And Recovery

## Protected Resources

- Firestore database: `chatgptstorage`
- Live asset bucket: `gs://bhe-product-assets`
- Independent asset replica: `gs://bhe-product-assets-backup-location-map-985`
- Cloud Run deployment sources: `gs://run-sources-location-map-985-us-west1`

## Protection Policy

- Firestore database deletion protection is enabled.
- Firestore point-in-time recovery retains seven days of versions.
- Daily Firestore backups are retained for 14 days.
- Sunday Firestore backups are retained for 12 weeks.
- Live assets retain soft-deleted objects for 30 days and noncurrent versions for 90 days.
- The independent replica retains soft-deleted objects for 30 days, has a 30-day unlocked retention policy, and retains noncurrent versions for 180 days.
- Storage Transfer Service copies new and changed live assets to the replica daily. Source deletions are not propagated.
- Cloud Run deployment source archives have 30-day soft delete and version history, and are copied daily to `cloud-run-source/` in the independent replica.

Verify the complete posture:

```bash
npm run sermon:audit-backups
```

## Firestore Recovery

Never restore directly over the production database. Restore or clone into a new database, inspect it, and only then plan a controlled migration.

List managed backups:

```bash
gcloud firestore backups list --project=location-map-985
```

Restore one backup into a new database:

```bash
gcloud firestore databases restore \
  --source-backup=BACKUP_RESOURCE_NAME \
  --destination-database=sermon-recovery-YYYYMMDD \
  --project=location-map-985
```

Clone a PITR snapshot into a new database. The snapshot time must be a whole minute within the current PITR window:

```bash
gcloud firestore databases clone \
  --source-database=projects/location-map-985/databases/chatgptstorage \
  --snapshot-time=YYYY-MM-DDTHH:MM:00Z \
  --destination-database=sermon-recovery-YYYYMMDD \
  --project=location-map-985
```

## Asset Recovery

List all versions of one live object:

```bash
gcloud storage ls --all-versions gs://bhe-product-assets/PATH
```

List soft-deleted objects:

```bash
gcloud storage ls --soft-deleted --recursive gs://bhe-product-assets/**
```

Restore the latest soft-deleted version of one object:

```bash
gcloud storage restore gs://bhe-product-assets/PATH
```

Recover an independently replicated object without overwriting production first:

```bash
gcloud storage cp \
  gs://bhe-product-assets-backup-location-map-985/PATH \
  ./recovery-review/
```

After inspecting the recovered file, copy it back to the live bucket only with explicit confirmation.

## Deployed Source Recovery

List protected Cloud Run source archives:

```bash
gcloud storage ls \
  gs://bhe-product-assets-backup-location-map-985/cloud-run-source/services/bhe-product-api/
```

Download the needed deployment archive for inspection:

```bash
gcloud storage cp \
  gs://bhe-product-assets-backup-location-map-985/cloud-run-source/services/bhe-product-api/SOURCE.zip \
  ./recovery-review/
```

These archives represent deployed revisions. Local work that has never been deployed or committed is not included.

## Safety Rules

1. Do not disable database delete protection during routine maintenance.
2. Do not lock bucket retention policies; unlocked policies preserve operational flexibility.
3. Do not configure the transfer job to delete destination objects when source objects disappear.
4. Restore Firestore into a new database rather than overwriting production.
5. Run the audit after infrastructure changes and at least monthly.
