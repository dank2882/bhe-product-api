# Ranked personal-finance wish list — November 7, 2026

Dan explicitly requested a durable, ordered list of future purchases that stays
outside budgets and forecasts until a separately requested comparison or plan.
The existing private finance domain now owns individual wishlist records, optional
USD integer-cent estimates, notes, source provenance, status and contiguous rank.
New/restored wanted items append; explicit moves and status changes reindex in one
versioned transaction. No synthetic wishes were inserted in production.

Implementation: core `9893ae6`, Life OS `343aaa6`.
Production: `bhe-product-api-pf-1107w`, `dan-life-os-mcp-pf-1107w`, both100%.
Catalog1.4.0; cash engine unchanged1.1.0. Existing runtime settings and all prior
traffic tags independently compared and preserved. Prior100% revisions were
`bhe-product-api-pf-1107a` and `dan-life-os-mcp-pf-1107a`; these remain rollback.
No new service, database, OAuth, sharing grant or Staff Tools deployment.

953 backend and257 gateway tests passed, plus repository checks. The initial
restricted test run could not bind local test servers; rerunning with authorized
local-server access passed. Tests cover ordering, edits, deferral/restoration,
purchased-state isolation, unknown cost, invalid input, stale versions/cursors,
retry safety, history, exact-owner denial and unchanged cash forecasts.

Candidate checks independently verified an empty ordered list, catalog discovery,
exact-owner denial for reads/writes (including a forged owner alias), invalid
writes without mutation, and identical baseline cash output versus production.
Two fresh local MCP SDK sessions discovered the three existing personal-finance
tools and retrieved the empty list through the production core. The dedicated
wish-list operations are exposed through those same three tools. This is not a
claim that an existing installed-client cache or OAuth session was refreshed.

The accepted feature behavior was saved and independently read back as a private
finance artifact. No operational financial contents are included in Git or the
engineering registry. A first real wish and explicit user ordering remain user
input, not missing technical implementation. No affordability claim, automatic
funding, source-system update, purchase or cash movement is implied.

Rollback to prior revisions hides the additive wishlist collection/operations
without deleting records or changing cash. The underlying household history and
balance reconciliation/affordability acceptance remain separate unfinished work.
