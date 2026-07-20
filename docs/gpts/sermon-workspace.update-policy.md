# Sermon Workspace GPT Update Policy

The Custom GPT uses two stable configuration surfaces and two routinely updated knowledge files.

## Stable Configuration

Upload these once for compatibility contract `2.5.0`:

- `sermon-workspace.schema.dispatcher-upload.json`
- `sermon-workspace.instructions.upload.md`

Normal backend development must not require either file to change. New capabilities belong in the server-side operation registry and must use one of the existing modes: query, artifact, or command.

Specialized direct Actions remain appropriate when stronger typing, file transport, reliability, latency, or confirmation behavior materially improves the workflow. The platform limit is 30 Actions; keep useful headroom, but do not preserve a low count at the expense of sound engineering.

Run this before deployment:

```sh
npm run sermon:check-stable-gpt-config
```

Changing the stable files requires an intentional compatibility review followed by:

```sh
npm run sermon:refresh-stable-gpt-config
```

## Updatable Knowledge

Upload these whenever their content changes:

- `sermon-workspace.operation-catalog.md` after adding, changing, deprecating, or documenting registry operations.
- `sermon-workspace.supplemental.md` after changing workflows, preferences, defaults, or detailed guidance.

Generate and verify the catalog with:

```sh
npm run sermon:generate-operation-catalog
npm run sermon:check-operation-catalog
```

The live catalog endpoint remains the runtime source of truth if the uploaded catalog is temporarily stale.

## Development Rule

Prefer this order for future changes:

1. Implement or update backend service behavior.
2. Register the operation under query, artifact, or command.
3. Decide whether the dispatcher is sufficient or a specialized direct Action provides a concrete reliability or UX benefit.
4. Add tests.
5. Regenerate the operation catalog.
6. Update supplemental guidance when user-facing behavior or preferences changed.
7. Deploy the backend.
8. Upload only the changed configuration or knowledge files.
