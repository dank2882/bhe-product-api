# Container shipping dashboard

Dan accepted a dashboard within the existing FBC Shipping system on November 20,
2026. Shipping owns the records; this is a read-only projection with no duplicate
ledger, new service, authentication flow or expanded access.

`getDashboard` returns paginated rows using the current Pacific date. The recent
view covers six calendar months, inclusive, and requires sourced actual departure
or delivery dates with reported/verified evidence. Month-only, disputed, future,
conflicting and superseded dates do not establish recent activity. Current and
recent can overlap. Partial container deliveries remain current until all
containers are covered. Old incomplete history is explicitly unconfirmed.
Canceled records and older completed history remain accessible.

The existing Staff Tools gateway supplies `shipping_open_dashboard` and an
app-only read allowlist for dashboard pages, shipment details and document links.
The component follows all pages, displays partial coverage until complete, and
clears stale rows on failed refresh. It shows timeline sources, paperwork owners
and dates, payer roles, cost lines, separate currencies, payment dates/evidence,
open incidents and missing readiness fields. No physical location is inferred
from an ETA. An absent invoice or payment record remains unknown. Invoice totals
are not automatically final costs; only verified allocated payments settle the
existing ledger calculation. Expired quotes remain visibly distinct.

Validation: 1,019 core tests and 268 platform tests passed on Node 22; repository
checks passed. Browser acceptance covered pagination, views, details, restricted
file labels, authorized file links, container search, narrow mobile layout and
stale-data clearing. Synthetic desktop/mobile renders were visually inspected.

Release and live client acceptance are separate; see companion platform release
note for deployed commits and any outstanding client catalog gate. No shipment
record, document, access grant or external message is changed by this feature.
