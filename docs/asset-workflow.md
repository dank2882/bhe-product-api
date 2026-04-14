# Asset Workflow Note

## Root Idea

Chat-visible images and backend-persisted assets are different objects with different lifecycles.

For ChatGPT Actions, the upload step only works when the action call includes `openaiFileIdRefs`. Seeing an image in chat is not enough by itself to attach it to a product.

- `analyzeUploadedImages` works on chat-visible image context and returns analysis-only data.
- `uploadAssetsToStorage` persists downloadable chat file references into backend storage and returns stable backend asset references.
- `attachAssetsToProduct` attaches only backend-persisted asset references to a product record.

## New Flow

1. Analyze the image in chat if needed.
2. Call `uploadAssetsToStorage` with backend-downloadable file references.
3. Call `attachAssetsToProduct` with returned `assetIds`.

## Guardrail

If `attachAssetsToProduct` is called without backend-issued asset references, it fails with:

`The images were visible in chat, but no backend-uploaded asset references were available, so they could not be attached to the product record.`

## Example: Upload Asset

Request:

```json
{
  "assetType": "imagesRaw",
  "purpose": "supporting-reference",
  "notes": "Narration notes scan",
  "openaiFileIdRefs": [
    {
      "name": "notes-page-1.jpg",
      "mime_type": "image/jpeg",
      "download_link": "https://files.example/notes-page-1.jpg"
    }
  ]
}
```

Response:

```json
{
  "ok": true,
  "message": "Files were uploaded into backend asset storage. Attach them to the product with their assetIds in a separate step.",
  "slug": "sample-product",
  "uploadedCount": 1,
  "persistedAssets": [
    {
      "assetId": "c4a8f8f4-3d0f-4cf7-9f9d-62e4cdd0a8b3",
      "filename": "notes-page-1.jpg",
      "mimeType": "image/jpeg",
      "storageKey": "products/sample-product/asset-library/c4a8f8f4-3d0f-4cf7-9f9d-62e4cdd0a8b3-notes-page-1.jpg",
      "canonicalUrl": "gs://bhe-product-assets/products/sample-product/asset-library/c4a8f8f4-3d0f-4cf7-9f9d-62e4cdd0a8b3-notes-page-1.jpg",
      "byteSize": 248193,
      "checksumSha256": "8e9b7f2d7c6f46d64d4d8579c63d97ea4d8de0db713b7a50f2f325edb6b5f27a",
      "intendedAssetType": "imagesRaw",
      "purpose": "supporting-reference",
      "uploadState": "persisted"
    }
  ]
}
```

## Example: Attach Asset To Product

Request:

```json
{
  "assetIds": [
    "c4a8f8f4-3d0f-4cf7-9f9d-62e4cdd0a8b3"
  ],
  "assetRole": "reference_scan"
}
```

Response:

```json
{
  "ok": true,
  "message": "Backend-persisted assets were attached to the product record.",
  "slug": "sample-product",
  "attachedCount": 1,
  "duplicateAssetIds": [],
  "attachedAssets": [
    {
      "assetId": "c4a8f8f4-3d0f-4cf7-9f9d-62e4cdd0a8b3",
      "filename": "notes-page-1.jpg",
      "storagePath": "products/sample-product/asset-library/c4a8f8f4-3d0f-4cf7-9f9d-62e4cdd0a8b3-notes-page-1.jpg",
      "storageKey": "products/sample-product/asset-library/c4a8f8f4-3d0f-4cf7-9f9d-62e4cdd0a8b3-notes-page-1.jpg",
      "canonicalUrl": "gs://bhe-product-assets/products/sample-product/asset-library/c4a8f8f4-3d0f-4cf7-9f9d-62e4cdd0a8b3-notes-page-1.jpg",
      "mimeType": "image/jpeg",
      "assetRole": "reference_scan"
    }
  ]
}
```

## Example: Failure When Asset References Are Missing

Request:

```json
{
  "chatVisibleImages": [
    {
      "chatImageId": "chat-image-1",
      "filename": "visible-only.jpg",
      "mimeType": "image/jpeg"
    }
  ]
}
```

Response:

```json
{
  "ok": false,
  "error": "The images were visible in chat, but no backend-uploaded asset references were available, so they could not be attached to the product record."
}
```
