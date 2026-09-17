#!/usr/bin/env python3
"""Apply the explicitly approved Maintenance resource grants; never handle secret values."""
import argparse
import json
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--apply', action='store_true')
parser.add_argument('--gcloud', default='gcloud')
args = parser.parse_args()
project = 'location-map-985'
region = 'us-west1'
worker = f'fbc-maintenance-worker@{project}.iam.gserviceaccount.com'
jobs = f'fbc-maintenance-jobs@{project}.iam.gserviceaccount.com'
member = f'serviceAccount:{worker}'

def run(parts):
    command = [args.gcloud, *parts, f'--project={project}', '--quiet', '--format=none']
    if not args.apply:
        print(json.dumps(command))
        return
    result = subprocess.run(command, text=True, capture_output=True)
    if result.returncode:
        raise SystemExit(result.stderr)
    print('OK: ' + ' '.join(parts[:4]), flush=True)

def existing(parts):
    result = subprocess.run([args.gcloud, *parts, f'--project={project}', '--format=json'], text=True, capture_output=True)
    if result.returncode:
        raise SystemExit(result.stderr)
    return json.loads(result.stdout)

if args.apply:
    service_accounts = {x['email'] for x in existing(['iam', 'service-accounts', 'list'])}
else:
    service_accounts = set()
for name, email in [('fbc-maintenance-worker', worker), ('fbc-maintenance-jobs', jobs)]:
    if email not in service_accounts:
        run(['iam', 'service-accounts', 'create', name, f'--display-name={name}'])

run(['services', 'enable', 'cloudtasks.googleapis.com', 'cloudscheduler.googleapis.com', 'iamcredentials.googleapis.com', 'secretmanager.googleapis.com'])
queues = {x['name'].split('/')[-1] for x in existing(['tasks', 'queues', 'list', f'--location={region}'])} if args.apply else set()
if 'fbc-maintenance-messaging' not in queues:
    run(['tasks', 'queues', 'create', 'fbc-maintenance-messaging', f'--location={region}', '--max-dispatches-per-second=5', '--max-concurrent-dispatches=2', '--max-attempts=5', '--max-retry-duration=3600s'])
    run(['tasks', 'queues', 'pause', 'fbc-maintenance-messaging', f'--location={region}'])

condition = 'expression=resource.name=="projects/location-map-985/databases/chatgptstorage" || resource.name=="projects/location-map-985/databases/correspondence",title=fbc-maintenance-databases'
run(['projects', 'add-iam-policy-binding', project, f'--member={member}', '--role=roles/datastore.user', f'--condition={condition}'])
object_condition = 'expression=resource.name.startsWith("projects/_/buckets/bhe-product-assets/objects/maintenance/incoming/"),title=fbc-maintenance-media'
for role in ['roles/storage.objectCreator', 'roles/storage.objectViewer']:
    run(['storage', 'buckets', 'add-iam-policy-binding', 'gs://bhe-product-assets', f'--member={member}', f'--role={role}', f'--condition={object_condition}'])

# Self-only signing, no downloadable service-account keys and no other identity.
run(['iam', 'service-accounts', 'add-iam-policy-binding', worker, f'--member={member}', '--role=roles/iam.serviceAccountTokenCreator', '--condition=None'])
run(['iam', 'service-accounts', 'add-iam-policy-binding', jobs, f'--member={member}', '--role=roles/iam.serviceAccountUser', '--condition=None'])
run(['tasks', 'queues', 'add-iam-policy-binding', 'fbc-maintenance-messaging', f'--location={region}', f'--member={member}', '--role=roles/cloudtasks.enqueuer'])

secrets = {x['name'].split('/')[-1] for x in existing(['secrets', 'list'])} if args.apply else set()
for secret in ['fbc-maintenance-twilio-auth-token', 'fbc-maintenance-microsoft-client-secret']:
    if secret not in secrets:
        run(['secrets', 'create', secret, '--replication-policy=automatic', '--labels=owner=fbc,domain=maintenance'])
    run(['secrets', 'add-iam-policy-binding', secret, f'--member={member}', '--role=roles/secretmanager.secretAccessor', '--condition=None'])

print('Provisioning completed. Independently verify IAM and test allow/deny before activation.')
