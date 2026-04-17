# BHE Knowledge Repository GPT Planning

This file is the internal planning snapshot for the separate BHE Knowledge Repository Assistant GPT.

## Purpose

The Knowledge Repository GPT is intended for staff use when working with research materials, scanned documents, OCR text, provenance, and higher-level repository knowledge items.

It is separate from the Product Builder GPT.

## Implemented Backend Scope

The backend currently supports:

* repository document intake
* repository document retrieval
* repository document source-text retrieval
* repository document search
* provenance-based repository document listing
* repository OCR start
* repository OCR cleanup
* repository OCR normalize
* repository OCR AI-correct
* repository OCR human review
* repository item creation
* repository item retrieval
* repository item search
* repository item summary save
* repository document-to-item linking
* repository item linked-document retrieval

## Intended Default Staff Workflow

1. upload repository PDFs
2. save provenance fields
3. retrieve the repository document if needed
4. run OCR start
5. run OCR cleanup
6. run OCR normalize
7. run OCR AI-correct when useful
8. save human-reviewed text when staff has corrections
9. inspect best available text
10. create repository items for durable concepts
11. save canonical item summaries
12. link documents to items
13. retrieve linked documents as evidence sets

## Separation From Product Builder

Stay in repository mode for:

* scans
* provenance
* OCR review
* source-text work
* knowledge-item organization
* research retrieval

Shift to Product Builder only when the user is explicitly moving into:

* store product records
* product copy
* product metadata
* product asset management
* store publishing work

## Known Gaps

The backend does not yet support:

* repository timeline drafting
* unlinking documents from items
* AI-generated repository item summaries
* richer repository analytics or synthesis workflows

## Source Of Truth

The source of truth for the active repository GPT instruction draft should be:

* `docs/gpts/knowledge-repository.instructions.md`
