# Reviewed Life Context testing allowance

October 29, 2026. Dan authorized the next real-context Google AI verification after releasing v3, and asked to complete testing without repeated per-attempt cap approvals.

The existing two-attempt daily limit had been consumed. Expose the same limit as `LIFE_CONTEXT_DAILY_LIMIT`, default 2, validated as an integer 1–10. Keep the existing monthly reservation ceiling independent, and preserve all recorded usage and failed-attempt receipts. No counters are reset, no new store or collection endpoint is introduced, and the regular default is unchanged.

For this verification only, stage the current source with collection enabled, daily allowance 3 and cumulative October ceiling 300000 microdollars (three $0.10 reservations, including the two already used). Verify live counters before staging. Restore the exact disabled revision and remove all three test flags afterward; abort restoration on concurrent deployment changes rather than overwriting them.

Use a fixed distinct reviewed-test run ID, `life-context-v3-real-20261029`, because the original daily pilot has already completed and must remain immutable. Check exact existence and current version first. Collect a new bounded whole sample, publish only through authenticated Life OS, and independently read the run and context. This is a manual acceptance run, not daily schedule activation or approved-profile population.
