# Quarterly personal-finance schedules — November 7, 2026

Dan requested an existing planned purchase recur every three months. Extend the
existing schedule enum and calendar-month occurrence generator. The anchor date
is preserved across short months/leap years. Unsupported frequencies fail closed.
Known expenses still consume category allowances; the first existing occurrence
is updated in place, not duplicated.

Implementation: `87cf4c8`. Production core `bhe-product-api-pf-1107q`, 100% traffic.
Catalog1.5.0, engine1.2.0. Life OS stays on `dan-life-os-mcp-pf-1107w`: its existing
JSON arguments and live catalog already support the additive schedule frequency.
All prior runtime settings and traffic tags were independently compared/preserved.
No new service, database, OAuth, permission, source write or financial execution.

954 backend tests passed, plus repository checks. Focused coverage verifies
three-calendar-month spacing, February/leap-day clamping without anchor drift,
strict frequency handling, exact forecast occurrences and budget remainder without
double counting. The unchanged gateway previously passed257 tests.

A candidate read-only scenario produced the expected quarterly events while the
existing baseline remained identical to production; unauthorized access remained
403 and no workspace mutation occurred. After promotion, the user-authorized
existing schedule was updated, independently read back, and inspected through the
actual twelve-month forecast: four occurrences, with the initial purchase once.
The two user-ranked wishes remained unchanged. Private amounts and source details
stay in the owning financial records, not this release note or registry.

Rollback constraint: previous core revisions do not understand quarterly records.
Do not route traffic to a pre-quarterly engine while such records exist. First
restore compatible once-occurrence schedules through versioned domain commands,
or deploy a compatible fix forward. Earlier wish-list rollback notes alone are
insufficient after this recurrence release. Household reconciliation and an
unqualified affordability result remain separate unfinished acceptance work.
