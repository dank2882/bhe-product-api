# Product Workspace Operation Catalog

Upload this file as Custom GPT knowledge with `product-builder.schema.dispatcher-upload.json`. It documents backend operations routed through the stable Product Workspace dispatcher Actions.

Catalog version: `1-5e657660d6af`

Catalog hash: `5e657660d6af7d3e17fe8c54f7d5ba63e54060624f595eeef35e91094ac05150`

The registry currently exposes 12 operations. Adding registry operations does not add OpenAPI operations.

## Dispatcher Rules

1. Use `listProductWorkspaceOperations` when the correct operation or arguments are unclear.
2. Use `runProductWorkspaceQuery` for read-only operations.
3. Use `runProductWorkspaceCommand` for durable imports, SKU assignment, marketplace identifier updates, or product specification updates.
4. For command operations, send a stable `idempotencyKey` for one user-approved intent and reuse it only when retrying that same intent.
5. Never invent ISBNs, UPCs, GTINs, ASINs, Shopify IDs, or eBay item numbers. Store only values provided by source data or the operator.
6. Treat BHE SKU as the permanent internal identifier. Treat ISBN/UPC/GTIN/ASIN as external identifiers attached to that SKU.
7. Use `suggestSku` before `assignSku` unless the operator gives an explicit final SKU.
8. Run `importProductRegister` with `dryRun: true` before a live product-register import.
9. Use `getProductWorkspaceConfig` for living allowed values, SKU policy, marketplace rules, import mappings, and workflow rules.
10. Treat static knowledge files as fallback workflow guidance; backend product config is the source of truth for changeable product policy.
11. Always send an `arguments` object. For `searchProducts`, put the identifying text in `arguments.query`; never send an empty arguments object.
12. Store only verified specifications and classification values. A historical work year is not the modern reproduction publication date.

## Query Operations

### `listProducts`

List compact product records with SKU and ISBN summary fields.

Optional arguments: `status`, `productType`, `limit`, `scanLimit`

Example:

```json
{
  "operation": "listProducts",
  "arguments": {
    "limit": 25
  }
}
```

### `searchProducts`

Search product records by title, slug, ISBN, SKU, Shopify handle, variant text, or marketplace identifiers.

Required arguments: `query`

Optional arguments: `limit`, `scanLimit`

Example:

```json
{
  "operation": "searchProducts",
  "arguments": {
    "query": "Tyndale 1526",
    "limit": 10
  }
}
```

### `getProduct`

Retrieve one complete product record by slug.

Required arguments: `slug`

Example:

```json
{
  "operation": "getProduct",
  "arguments": {
    "slug": "tyndale-new-testament-1526"
  }
}
```

### `suggestSku`

Suggest a BHE SKU using the controlled `BHE-[TYPE]-[WORK]-[YEAR]-[EDITION]` pattern and check for conflicts.

Optional arguments: `slug`, `title`, `productType`, `binding`, `variant`, `edition`, `workCode`, `year`, `editionCode`

Guidance: Use this before assigning a SKU. Review warnings when a year or work code is inferred.

Example:

```json
{
  "operation": "suggestSku",
  "arguments": {
    "title": "Tyndale New Testament 1526 Commemorative Edition",
    "productType": "Facsimile Bible"
  }
}
```

### `auditProductIdentifiers`

Audit products for missing BHE SKUs, missing external identifiers, duplicate SKUs, and duplicate ISBN-13 values.

Optional arguments: `scanLimit`

Example:

```json
{
  "operation": "auditProductIdentifiers",
  "arguments": {
    "scanLimit": 1000
  }
}
```

### `getProductWorkspaceConfig`

Retrieve backend product workspace config for allowed values, SKU policy, marketplace rules, import mappings, and workflow rules.

Optional arguments: `configId`

Example:

```json
{
  "operation": "getProductWorkspaceConfig",
  "arguments": {
    "configId": "default"
  }
}
```

## Command Operations

### `importProductRegister`

Import or update products from a Shopify/product register export, preserving existing records and storing current identifiers.

Required arguments: `records`

Optional arguments: `dryRun`, `sourceName`

Guidance: Use `dryRun: true` first. Each record may include title, slug, Shopify handle, product type, SKU/BHE SKU, ISBN, UPC/GTIN, ASIN, Shopify IDs, eBay item number, and variants.

Example:

```json
{
  "operation": "importProductRegister",
  "idempotencyKey": "import-shopify-products-2026-07-14-dry-run",
  "arguments": {
    "dryRun": true,
    "sourceName": "shopify-products-csv",
    "records": [
      {
        "title": "Tyndale New Testament 1526 Commemorative Edition",
        "shopifyHandle": "tyndale-new-testament-1526",
        "productType": "Facsimile Bible",
        "sku": "BHE-FB-TYN-1526-COM",
        "isbn13": "9780000000000"
      }
    ]
  }
}
```

### `seedProductWorkspaceConfig`

Create the backend product workspace config document from current defaults, or overwrite it when explicitly approved.

Optional arguments: `configId`, `dryRun`, `overwrite`, `updatedBy`

Guidance: Use `dryRun: true` first. Do not set `overwrite: true` unless the operator explicitly approves replacing the backend config.

Example:

```json
{
  "operation": "seedProductWorkspaceConfig",
  "idempotencyKey": "seed-product-workspace-config-default-dry-run",
  "arguments": {
    "configId": "default",
    "dryRun": true
  }
}
```

### `updateProductWorkspaceConfig`

Patch backend product workspace config for allowed values, SKU policy, marketplace rules, import mappings, or workflow rules.

Required arguments: `patch`

Optional arguments: `configId`, `dryRun`, `updatedBy`

Guidance: Use `dryRun: true` first for policy changes. Patch only the specific values that need to change.

Example:

```json
{
  "operation": "updateProductWorkspaceConfig",
  "idempotencyKey": "update-product-config-luther-work-code-dry-run",
  "arguments": {
    "configId": "default",
    "dryRun": true,
    "patch": {
      "skuPolicy": {
        "workCodes": {
          "luther": "LUT"
        }
      }
    }
  }
}
```

### `assignSku`

Assign one permanent BHE SKU to a product after checking for duplicate SKU usage.

Required arguments: `slug`, `bheSku`

Optional arguments: `manufacturerPartNumber`, `allowDuplicate`

Guidance: Do not use `allowDuplicate` unless an operator explicitly approves a known duplicate.

Example:

```json
{
  "operation": "assignSku",
  "idempotencyKey": "assign-sku-tyndale-1526-com",
  "arguments": {
    "slug": "tyndale-new-testament-1526",
    "bheSku": "BHE-FB-TYN-1526-COM"
  }
}
```

### `updateProductSpecifications`

Update verified authors, physical specifications, modern publication date, and marketplace classification fields for one product.

Required arguments: `slug`

Optional arguments: `authors`, `specifications`, `classification`, `pageCount`, `pageCountUnit`, `binding`, `language`, `languageType`, `publicationDate`, `bisacCode`, `subjectCode`, `subjectCodeType`

Guidance: Store only values confirmed by the operator or a trusted source. Use `null` for an unknown publication date. Flat specification and classification arguments are stored in their corresponding nested product objects.

Example:

```json
{
  "operation": "updateProductSpecifications",
  "idempotencyKey": "update-specifications-tyndale-1526",
  "arguments": {
    "slug": "tyndale-new-testament-1526",
    "authors": ["William Tyndale"],
    "pageCount": 704,
    "pageCountUnit": "pages",
    "binding": "Hardcover",
    "language": "English",
    "languageType": "Original",
    "publicationDate": null,
    "bisacCode": "BIB018030",
    "subjectCode": "BIB018030",
    "subjectCodeType": "BISAC"
  }
}
```

### `updateMarketplaceIdentifiers`

Update ISBN, UPC/GTIN, Amazon ASIN, MPN, Shopify, and eBay identifier fields for one product.

Required arguments: `slug`

Optional arguments: `identifiers`, `isbn10`, `isbn13`, `upc`, `gtin`, `amazonAsin`, `manufacturerPartNumber`, `shopifyProductId`, `shopifyVariantId`, `ebayItemNumber`

Example:

```json
{
  "operation": "updateMarketplaceIdentifiers",
  "idempotencyKey": "update-identifiers-tyndale-1526",
  "arguments": {
    "slug": "tyndale-new-testament-1526",
    "isbn13": "9780000000000",
    "manufacturerPartNumber": "BHE-FB-TYN-1526-COM"
  }
}
```

## BHE SKU Policy

Use one permanent BHE SKU for each sellable product or variant:

```text
BHE-[TYPE]-[WORK]-[YEAR]-[EDITION]
```

Examples:

```text
BHE-FB-TYN-1526-COM
BHE-FB-TYN-1526-DLX
BHE-FB-GEN-1560-BLK
BHE-PO-TYN-2436
```

Controlled type codes currently include:

```text
FB Facsimile Bible
BK Book
RP Reproduction
TR Teaching Resource
AR Artwork
PO Poster
DV DVD
ST Statue
CV Canvas
CM Coins & Medallions
BS Bible Stand
PR Book Press
SS Sculpture Stand
DA Dimensional Art
TO Tour
```

Each separately purchasable edition, binding, size, color, or set should have its own SKU. If two products have different ISBNs, they normally should have different SKUs.
