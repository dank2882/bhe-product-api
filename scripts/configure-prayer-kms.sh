#!/usr/bin/env bash
set -euo pipefail

project_id="${GCP_PROJECT_ID:-location-map-985}"
region="${PRAYER_KMS_LOCATION:-us-west1}"
service_name="${PRAYER_BACKEND_SERVICE:-bhe-product-api}"
key_ring="${PRAYER_KMS_KEY_RING:-dan-private-data}"
key_name="${PRAYER_KMS_KEY:-prayer-management-v1}"

runtime_service_account="$(gcloud run services describe "$service_name" --project="$project_id" --region="$region" --format='value(spec.template.spec.serviceAccountName)')"
if [[ -z "$runtime_service_account" ]]; then
  echo "Could not verify the exact $service_name runtime service account" >&2
  exit 1
fi

if ! gcloud kms keyrings describe "$key_ring" --project="$project_id" --location="$region" >/dev/null 2>&1; then
  gcloud kms keyrings create "$key_ring" --project="$project_id" --location="$region"
fi

if ! gcloud kms keys describe "$key_name" --project="$project_id" --location="$region" --keyring="$key_ring" >/dev/null 2>&1; then
  gcloud kms keys create "$key_name" --project="$project_id" --location="$region" --keyring="$key_ring" --purpose=encryption --rotation-period=90d --next-rotation-time="$(date -u -v+90d '+%Y-%m-%dT%H:%M:%SZ')"
fi

key_resource="projects/${project_id}/locations/${region}/keyRings/${key_ring}/cryptoKeys/${key_name}"
gcloud kms keys add-iam-policy-binding "$key_name" --project="$project_id" --location="$region" --keyring="$key_ring" --member="serviceAccount:${runtime_service_account}" --role="roles/cloudkms.cryptoKeyEncrypterDecrypter"
gcloud run services update "$service_name" --project="$project_id" --region="$region" --update-env-vars="PRAYER_KMS_KEY_NAME=${key_resource}"

echo "Configured Prayer Management KMS key for ${service_name} runtime identity ${runtime_service_account}"
