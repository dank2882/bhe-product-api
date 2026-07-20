# Sermon Action Transport Diagnostic

This isolated schema diagnoses the boundary between a Custom GPT and the
`bhe-product-api` service. It does not access Firestore, sermon records, PowerPoint
generation, or artifact storage during the first transport phase. A third Action then
runs the existing direct PowerPoint endpoint as a controlled A/B test.

## Configuration

- Schema: `sermon-action-transport.schema.json`
- Authentication: API Key
- Authentication type: Custom header
- Header: `x-api-key`
- Use a separate temporary Custom GPT with no knowledge files and minimal instructions.

## Test Order

Run each test in a fresh conversation and preserve the returned `requestId` or exact
tool error. Use a unique marker for every call.

1. Call `pingGptActionTransport` once.
2. Call `runGptActionTransportProbe` with `plain_json`.
3. Call it with `same_domain_url`.
4. Call it with `long_external_url`.
5. Call it with `delayed_json` and `delayMs` set to `5000`.
6. Call it with `http_error`; this one is expected to surface an HTTP failure.

After the transport scenarios are understood, call
`createSermonPresentationFromLookupDirect` once with the known successful `Living Free`
lookup and the existing idempotency key. This distinguishes the direct endpoint from the
larger sermon GPT configuration without creating a duplicate presentation.

The final gateway-control phase adds `runSermonWorkspaceQuery` and
`runSermonWorkspaceArtifact`. Test `listSermons` first, then replay the existing
`createSermonPresentationFromLookup` artifact operation. These calls determine whether
the generic dispatcher contract remains reliable inside the proven minimal GPT.

Run the first five scenarios three times in Chrome. After Chrome is understood, repeat
once in Atlas. Do not run sermon or PowerPoint operations in the diagnostic GPT.

## Interpretation

- GET and POST both fail before ingress: schema, authentication, domain policy, or Action platform.
- GET succeeds but plain POST never reaches ingress: POST Action transport or request serialization.
- Plain POST succeeds but a URL scenario fails: response URL handling.
- Plain POST succeeds but delayed POST fails: timeout handling; use asynchronous artifact jobs.
- All probes succeed: the failure is in the main GPT configuration/version or its larger schema.
- The intentional HTTP error should fail and should have a matching ingress log and request ID.
