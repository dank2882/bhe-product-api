#!/usr/bin/env python3
"""Provision additive notebook indexes/queue; never alters other domains."""
import argparse
import json
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--project', default='location-map-985')
parser.add_argument('--database', default='chatgptstorage')
parser.add_argument('--location', default='us-west1')
parser.add_argument('--apply', action='store_true')
args = parser.parse_args()
indexes = json.loads((Path(__file__).parent.parent / 'infra/notebooks/indexes.json').read_text())
for index in indexes:
    cmd = ['gcloud', 'firestore', 'indexes', 'composite', 'create', '--project='+args.project,
           '--database='+args.database, '--collection-group='+index['collectionGroup'], '--query-scope=collection', '--async']
    for field in index['fields']:
        cmd.append('--field-config='+json.dumps(field, separators=(',', ':')))
    if not args.apply:
        print(json.dumps(cmd))
        continue
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode and 'ALREADY_EXISTS' not in result.stderr:
        raise RuntimeError(result.stderr)
    print(index['collectionGroup'], 'exists' if result.returncode else 'requested')
cmd = ['gcloud', 'tasks', 'queues', 'create', 'dan-notebook-indexing', '--project='+args.project,
       '--location='+args.location, '--max-concurrent-dispatches=2', '--max-dispatches-per-second=1',
       '--max-attempts=5', '--min-backoff=10s', '--max-backoff=300s']
if args.apply:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode and 'ALREADY_EXISTS' not in result.stderr: raise RuntimeError(result.stderr)
    print('dan-notebook-indexing', 'exists' if result.returncode else 'created')
else:
    print(json.dumps(cmd))
