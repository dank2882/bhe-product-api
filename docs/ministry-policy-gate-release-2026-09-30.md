# Required Music policy review — September 30, 2026

Commit `77e8047` deployed as `bhe-product-api-00304-8zn` at 100% traffic.
All 721 tests and required checks passed. Runtime guidance was synchronized and
read back as `1-ac628be36434`.

The Music query and command dispatchers require acknowledgement of the current
policy version before running a domain operation. Guidance and catalog retrieval
remain available. A stale version also fails; re-reading policy does not alter
the command intent or its idempotency fingerprint. The CLI importer requires an
explicit reviewed version rather than auto-acknowledging fetched instructions.

Live FBC connector acceptance verified missing and stale acknowledgement rejection,
guidance accessibility, a read with the current version, and rejection of a
command lacking acknowledgement. The command probe had no profile ID or changes,
so it could not mutate a roster record even if the gate failed. Accepted query
request: `5758af83-aede-45e6-8e18-370e3614fa1f`.

This proves enforcement on the connected Music dispatcher, not a model's internal
reasoning. Backend-held instructions require review before each task, suggestion
or revision. The version check cannot prevent unsupported prose without tools,
and does not protect legacy non-dispatcher/internal calls. No current-policy
acknowledgement substitutes for slot-color, membership or workload verification.
