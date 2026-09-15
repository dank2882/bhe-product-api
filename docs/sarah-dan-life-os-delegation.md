# Sarah delegation for Dan Life OS

Dan explicitly authorized full read/edit access for Sarah on 2026-09-15:
"no private records from sarah all is open to her".

The backend grants access only when the exact authenticated actor appears in
`DAN_PRIVATE_DELEGATE_SUBJECTS`. `DAN_PRIVATE_OWNER_SUBJECTS` identifies the
existing owner and verified historical aliases whose records are shared.
These are access grants, not identity aliases. Existing owners remain unchanged;
audit events and edits identify Sarah. Unlisted administrators gain no access.
Remove the delegate setting to revoke the grant without rewriting records.

Architecture: bhe-agent-platform/docs/adr/0031-dan-life-os-sarah-delegation.md.
