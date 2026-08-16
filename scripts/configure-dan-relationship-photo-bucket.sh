#!/usr/bin/env bash
set -euo pipefail

project_id="${GCP_PROJECT_ID:-location-map-985}"
region="${GCP_REGION:-us-west1}"
api_service="${BHE_API_SERVICE_NAME:-bhe-product-api}"
bucket_name="${DAN_RELATIONSHIP_PHOTO_BUCKET_NAME:-${project_id}-dan-relationship-photos}"

if [[ ! "$bucket_name" =~ ^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$ ]]; then
  echo "DAN_RELATIONSHIP_PHOTO_BUCKET_NAME is not a valid explicit bucket name" >&2
  exit 2
fi

runtime_service_account="${BHE_API_RUNTIME_SERVICE_ACCOUNT:-}"
if [[ -z "$runtime_service_account" ]]; then
  runtime_service_account="$(gcloud run services describe "$api_service" \
    --project "$project_id" \
    --region "$region" \
    --format='value(spec.template.spec.serviceAccountName)')"
fi
if [[ -z "$runtime_service_account" || "$runtime_service_account" != *"@${project_id}.iam.gserviceaccount.com" ]]; then
  echo "Could not verify the exact bhe-product-api runtime service account in $project_id" >&2
  exit 2
fi

if ! gcloud storage buckets describe "gs://${bucket_name}" --project "$project_id" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${bucket_name}" \
    --project "$project_id" \
    --location "$region" \
    --uniform-bucket-level-access \
    --public-access-prevention
fi

gcloud storage buckets update "gs://${bucket_name}" \
  --project "$project_id" \
  --uniform-bucket-level-access \
  --public-access-prevention \
  --versioning \
  --lifecycle-file="infra/dan-relationship-photos-lifecycle.json"

gcloud storage buckets add-iam-policy-binding "gs://${bucket_name}" \
  --project "$project_id" \
  --member="serviceAccount:${runtime_service_account}" \
  --role="roles/storage.objectAdmin"

# Remove project-wide legacy grants that new buckets may inherit. Project-level
# IAM still controls who may administer the bucket; object access stays limited
# to the explicit runtime binding above.
for binding in \
  "projectEditor:${project_id}|roles/storage.legacyBucketOwner" \
  "projectViewer:${project_id}|roles/storage.legacyBucketReader" \
  "projectEditor:${project_id}|roles/storage.legacyObjectOwner" \
  "projectOwner:${project_id}|roles/storage.legacyObjectOwner" \
  "projectViewer:${project_id}|roles/storage.legacyObjectReader"
do
  member="${binding%%|*}"
  role="${binding#*|}"
  gcloud storage buckets remove-iam-policy-binding "gs://${bucket_name}" \
    --project "$project_id" \
    --member="$member" \
    --role="$role" \
    --quiet >/dev/null 2>&1 || true
done

iam_policy_json="$(gcloud storage buckets get-iam-policy "gs://${bucket_name}" \
  --project "$project_id" \
  --format=json)"
runtime_member="serviceAccount:${runtime_service_account}"
if ! jq -e --arg runtime "$runtime_member" '
  any(.bindings[]?; .role == "roles/storage.objectAdmin" and (.members // [] | index($runtime)))
  and all(
    .bindings[]?;
    if (.role | test("^roles/storage\\.(?:legacyObject|object)"))
    then all(.members[]?; . == $runtime)
    else true
    end
  )
  and all(.bindings[]?.members[]?; . != "allUsers" and . != "allAuthenticatedUsers")
' <<<"$iam_policy_json" >/dev/null; then
  echo "Private bucket IAM verification failed: unexpected object access remains" >&2
  exit 3
fi

# The Node Storage signer needs signBlob for short-lived, private preview URLs.
gcloud iam service-accounts add-iam-policy-binding "$runtime_service_account" \
  --project "$project_id" \
  --member="serviceAccount:${runtime_service_account}" \
  --role="roles/iam.serviceAccountTokenCreator"

gcloud storage buckets describe "gs://${bucket_name}" \
  --project "$project_id" \
  --format="yaml(name,location,iamConfiguration,versioning,lifecycle_config)"

printf '%s\n' "$iam_policy_json"

printf '%s\n' "Configured private relationship-photo bucket gs://${bucket_name} for ${runtime_service_account}"
