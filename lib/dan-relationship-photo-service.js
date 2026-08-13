"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { isIP } = require("node:net");
const sharp = require("sharp");
const { getDanActorFields, requireDanPrivateAccess } = require("./dan-private-access");
const { runDanFirestoreTransaction } = require("./dan-firestore-transaction");
const {
  assertExpectedVersion,
  createRelationshipError,
  getCollection,
  getNowIso,
  getRequiredRecord,
  normalizeString
} = require("./dan-relationships-service");

const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const SUPPORTED_PHOTO_MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

function getPhotoBucket(deps = {}) {
  const bucket = deps.relationshipPhotoBucket;
  if (!bucket || typeof bucket.file !== "function") {
    throw createRelationshipError(
      "The private Dan relationship photo bucket is not configured",
      503,
      "relationship_photo_bucket_not_configured"
    );
  }
  return bucket;
}

function sanitizeFilename(value) {
  const clean = normalizeString(value).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean || "relationship-photo";
}

function extensionForMimeType(mimeType) {
  return {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif"
  }[mimeType] || "bin";
}

function assertSupportedPhotoMimeType(value, deps = {}) {
  const mimeType = normalizeString(value).toLowerCase();
  if (!SUPPORTED_PHOTO_MIME_TYPES.includes(mimeType)) {
    throw createRelationshipError(
      "Profile photos must be JPEG, PNG, WebP, or a runtime-supported HEIC/HEIF image",
      400,
      "unsupported_relationship_photo_type",
      { mimeType, allowed: SUPPORTED_PHOTO_MIME_TYPES }
    );
  }
  if (
    ["image/heic", "image/heif"].includes(mimeType)
    && (deps.relationshipPhotoHeicEnabled !== true || !sharp.format?.heif?.input?.buffer)
  ) {
    throw createRelationshipError(
      "HEIC/HEIF is not supported by the current production image runtime",
      415,
      "relationship_photo_heic_runtime_unsupported"
    );
  }
  return mimeType;
}

function assertSafeDownloadUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (_error) {
    throw createRelationshipError("The attached photo download URL is invalid", 400, "relationship_photo_download_url_invalid");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateIpv4 = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
  const privateIpv6 = /^(?:::1$|fe[89ab][0-9a-f]:|f[cd][0-9a-f]{2}:)/i;
  if (
    url.protocol !== "https:"
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || (isIP(hostname) === 4 && privateIpv4.test(hostname))
    || (isIP(hostname) === 6 && privateIpv6.test(hostname))
  ) {
    throw createRelationshipError(
      "The attached photo download URL must be a public HTTPS endpoint",
      400,
      "relationship_photo_download_url_not_allowed"
    );
  }
  return url.toString();
}

async function downloadOpenAiPhoto(fileRef, deps = {}) {
  const downloadLink = normalizeString(fileRef?.download_link);
  if (!downloadLink) {
    throw createRelationshipError(
      "The attached photo did not include a backend-downloadable file reference",
      400,
      "relationship_photo_download_reference_missing"
    );
  }
  const fetchImpl = deps.fetchImpl || fetch;
  let currentUrl = assertSafeDownloadUrl(downloadLink);
  let response;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    response = await fetchImpl(currentUrl, { redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers?.get?.("location");
    if (!location || redirectCount === 3) {
      throw createRelationshipError("The attached photo redirect could not be followed safely", 400, "relationship_photo_redirect_invalid");
    }
    currentUrl = assertSafeDownloadUrl(new URL(location, currentUrl).toString());
  }
  if (!response.ok) {
    throw createRelationshipError("The attached photo could not be downloaded", 400, "relationship_photo_download_failed", {
      status: response.status
    });
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_PHOTO_BYTES) {
    throw createRelationshipError(
      "The attached photo must be between 1 byte and 25 MB",
      413,
      "relationship_photo_size_invalid",
      { byteSize: buffer.length, maximumBytes: MAX_PHOTO_BYTES }
    );
  }
  return buffer;
}

function normalizeFocalPoint(value = {}) {
  if (!value || typeof value !== "object") return null;
  if (!["x", "y", "zoom"].some((key) => Object.prototype.hasOwnProperty.call(value, key))) return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const zoom = value.zoom === undefined ? 1 : Number(value.zoom);
  if (![x, y, zoom].every(Number.isFinite) || x < 0 || x > 1 || y < 0 || y > 1 || zoom < 1 || zoom > 8) {
    throw createRelationshipError(
      "focalPoint requires x and y between 0 and 1 and zoom between 1 and 8",
      400,
      "invalid_profile_photo_focal_point"
    );
  }
  return { x, y, zoom };
}

function normalizeCropBox(value = {}, metadata = {}) {
  if (!value || typeof value !== "object") return null;
  const left = Math.trunc(Number(value.left));
  const top = Math.trunc(Number(value.top));
  const width = Math.trunc(Number(value.width));
  const height = Math.trunc(Number(value.height));
  const imageWidth = Number(metadata.width || 0);
  const imageHeight = Number(metadata.height || 0);
  if (![left, top, width, height].every(Number.isInteger) || left < 0 || top < 0 || width < 1 || height < 1) {
    throw createRelationshipError("cropBox values must be positive pixel coordinates", 400, "invalid_profile_photo_crop_box");
  }
  if (left + width > imageWidth || top + height > imageHeight) {
    throw createRelationshipError(
      "cropBox extends beyond the oriented image",
      400,
      "profile_photo_crop_box_out_of_bounds",
      { imageWidth, imageHeight }
    );
  }
  return { left, top, width, height };
}

function cropBoxFromFocalPoint(focalPoint, metadata) {
  if (!focalPoint) return null;
  const imageWidth = Number(metadata.width || 0);
  const imageHeight = Number(metadata.height || 0);
  const size = Math.max(1, Math.floor(Math.min(imageWidth, imageHeight) / focalPoint.zoom));
  const centerX = Math.round(focalPoint.x * imageWidth);
  const centerY = Math.round(focalPoint.y * imageHeight);
  const left = Math.min(Math.max(centerX - Math.floor(size / 2), 0), Math.max(imageWidth - size, 0));
  const top = Math.min(Math.max(centerY - Math.floor(size / 2), 0), Math.max(imageHeight - size, 0));
  return { left, top, width: size, height: size };
}

async function inspectOrientedPhoto(buffer) {
  try {
    const orientedBuffer = await sharp(buffer, { failOn: "error", limitInputPixels: 100_000_000 }).rotate().toBuffer();
    const metadata = await sharp(orientedBuffer, { failOn: "error" }).metadata();
    if (!metadata.width || !metadata.height) throw new Error("missing dimensions");
    return { orientedBuffer, metadata };
  } catch (error) {
    throw createRelationshipError(
      "The attached file is not a readable supported image",
      400,
      "relationship_photo_corrupt_or_unsupported",
      { reason: normalizeString(error?.message).slice(0, 160) }
    );
  }
}

async function renderSquareCrop(buffer, { cropBox, focalPoint, size = 648 } = {}) {
  const { orientedBuffer, metadata } = await inspectOrientedPhoto(buffer);
  const normalizedBox = cropBox
    ? normalizeCropBox(cropBox, metadata)
    : cropBoxFromFocalPoint(normalizeFocalPoint(focalPoint), metadata);
  let pipeline = sharp(orientedBuffer, { failOn: "error" });
  if (normalizedBox) pipeline = pipeline.extract(normalizedBox);
  const { data, info } = await pipeline
    .resize(size, size, {
      fit: "cover",
      position: normalizedBox ? "centre" : sharp.strategy.attention,
      withoutEnlargement: false
    })
    .jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
    .toBuffer({ resolveWithObject: true });
  return {
    buffer: data,
    info,
    sourceMetadata: {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format || "",
      orientationApplied: true
    },
    crop: normalizedBox
      ? { mode: cropBox ? "manual_box" : "focal_point", cropBox: normalizedBox, focalPoint: focalPoint || null }
      : { mode: "attention", cropBox: null, focalPoint: null },
    warnings: Math.min(metadata.width, metadata.height) < 240 ? ["source_resolution_below_240"] : []
  };
}

async function savePrivateBuffer(bucket, storageKey, buffer, contentType) {
  await bucket.file(storageKey).save(buffer, {
    contentType,
    resumable: false,
    validation: "crc32c",
    metadata: { cacheControl: "private, max-age=0, no-store" }
  });
}

async function getFileBuffer(bucket, storageKey) {
  const result = await bucket.file(storageKey).download();
  return Buffer.isBuffer(result) ? result : result[0];
}

async function createShortLivedUrl(bucket, storageKey, expiresMs = 15 * 60 * 1000) {
  const file = bucket.file(storageKey);
  if (typeof file.getSignedUrl !== "function") return "";
  const [url] = await file.getSignedUrl({ action: "read", expires: Date.now() + expiresMs });
  return url;
}

function photoSummary(photo = {}) {
  return {
    photoId: photo.photoId || "",
    personId: photo.personId || "",
    status: photo.status || "draft",
    originalFilename: photo.originalFilename || "",
    originalMimeType: photo.originalMimeType || "",
    originalByteSize: Number(photo.originalByteSize || 0),
    checksumSha256: photo.checksumSha256 || "",
    source: photo.source || "chat_upload",
    sourceReference: photo.sourceReference || {},
    originalStorageKey: photo.originalStorageKey || "",
    previewStorageKey: photo.previewStorageKey || "",
    thumbnailStorageKey: photo.thumbnailStorageKey || "",
    outlookStorageKey: photo.outlookStorageKey || "",
    sourceMetadata: photo.sourceMetadata || {},
    crop: photo.crop || {},
    warnings: Array.isArray(photo.warnings) ? photo.warnings : [],
    approvedAt: photo.approvedAt || "",
    approvedBySub: photo.approvedBySub || "",
    version: Number(photo.version || 0),
    createdAt: photo.createdAt || "",
    updatedAt: photo.updatedAt || ""
  };
}

async function uploadRelationshipPhoto(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const person = await getRequiredRecord(getCollection(deps, "relationshipPeopleCollection"), input.personId, "person");
  const refs = Array.isArray(input.openaiFileIdRefs) ? input.openaiFileIdRefs : [];
  if (refs.length !== 1) {
    throw createRelationshipError("Attach exactly one profile-photo source image", 400, "relationship_photo_requires_one_file");
  }
  const fileRef = refs[0] || {};
  const mimeType = assertSupportedPhotoMimeType(fileRef.mime_type || fileRef.mimeType, deps);
  const buffer = await downloadOpenAiPhoto(fileRef, deps);
  const checksumSha256 = createHash("sha256").update(buffer).digest("hex");
  const photos = getCollection(deps, "relationshipPhotosCollection");
  const existing = (await (typeof photos.get === "function" ? photos.get() : { docs: [] })).docs
    ?.map((doc) => doc.data() || {})
    .find((photo) => photo.personId === person.personId && photo.checksumSha256 === checksumSha256);
  if (existing) return { photo: photoSummary(existing), duplicate: true };

  const photoId = `relationship-photo-${randomUUID()}`;
  const filename = sanitizeFilename(fileRef.name || `photo.${extensionForMimeType(mimeType)}`);
  const prefix = `relationships/${person.personId}/photos/${photoId}`;
  const originalStorageKey = `${prefix}/original-${filename}`;
  const previewStorageKey = `${prefix}/preview-648.jpg`;
  const bucket = getPhotoBucket(deps);
  const rendered = await renderSquareCrop(buffer, { cropBox: input.cropBox, focalPoint: input.focalPoint, size: 648 });
  await savePrivateBuffer(bucket, originalStorageKey, buffer, mimeType);
  await savePrivateBuffer(bucket, previewStorageKey, rendered.buffer, "image/jpeg");

  const actor = getDanActorFields(deps);
  const now = getNowIso(deps);
  const record = {
    photoId,
    personId: person.personId,
    owner: "dan",
    serves: ["dan"],
    visibility: "private",
    ownerSub: actor.actorSub,
    createdBySub: actor.actorSub,
    source: "chat_upload",
    sourceReference: { originalName: normalizeString(fileRef.name), downloadLinkPersisted: false },
    originalFilename: filename,
    originalMimeType: mimeType,
    originalByteSize: buffer.length,
    checksumSha256,
    originalStorageKey,
    previewStorageKey,
    thumbnailStorageKey: "",
    outlookStorageKey: "",
    sourceMetadata: rendered.sourceMetadata,
    crop: rendered.crop,
    warnings: rendered.warnings,
    status: "preview_ready",
    version: 1,
    createdAt: now,
    updatedAt: now
  };
  await photos.doc(photoId).create(record);
  return {
    photo: photoSummary(record),
    duplicate: false,
    previewUrl: await createShortLivedUrl(bucket, previewStorageKey)
  };
}

async function adjustRelationshipPhotoCrop(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const photos = getCollection(deps, "relationshipPhotosCollection");
  const existing = await getRequiredRecord(photos, input.photoId, "photo");
  assertExpectedVersion(existing, input.expectedVersion, "photo");
  if (!input.cropBox && !input.focalPoint) {
    throw createRelationshipError("Provide cropBox or focalPoint", 400, "missing_profile_photo_crop_adjustment");
  }
  const bucket = getPhotoBucket(deps);
  const original = await getFileBuffer(bucket, existing.originalStorageKey);
  const rendered = await renderSquareCrop(original, { cropBox: input.cropBox, focalPoint: input.focalPoint, size: 648 });
  await savePrivateBuffer(bucket, existing.previewStorageKey, rendered.buffer, "image/jpeg");
  const docRef = photos.doc(existing.photoId);
  const next = await runDanFirestoreTransaction(deps, photos, async (transaction) => {
    const currentDoc = await transaction.get(docRef);
    if (!currentDoc.exists) throw createRelationshipError("photo not found", 404, "photo_not_found", { id: input.photoId });
    const current = { ...(currentDoc.data() || {}), photoId: input.photoId };
    assertExpectedVersion(current, input.expectedVersion, "photo");
    const updated = {
      ...current,
      crop: rendered.crop,
      sourceMetadata: rendered.sourceMetadata,
      warnings: rendered.warnings,
      status: "preview_ready",
      approvedAt: "",
      approvedBySub: "",
      version: Number(current.version || 0) + 1,
      updatedAt: getNowIso(deps)
    };
    transaction.set(docRef, updated);
    return updated;
  });
  return { photo: photoSummary(next), previewUrl: await createShortLivedUrl(bucket, next.previewStorageKey) };
}

async function approveRelationshipProfilePhoto(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  if (input.approved !== true) {
    throw createRelationshipError("Explicit profile-photo approval is required", 400, "profile_photo_approval_required");
  }
  const photos = getCollection(deps, "relationshipPhotosCollection");
  const people = getCollection(deps, "relationshipPeopleCollection");
  const existing = await getRequiredRecord(photos, input.photoId, "photo");
  assertExpectedVersion(existing, input.expectedVersion, "photo");
  const person = await getRequiredRecord(people, existing.personId, "person");
  const bucket = getPhotoBucket(deps);
  const original = await getFileBuffer(bucket, existing.originalStorageKey);
  const renderOptions = existing.crop?.mode === "manual_box"
    ? { cropBox: existing.crop.cropBox }
    : existing.crop?.mode === "focal_point"
      ? { focalPoint: existing.crop.focalPoint }
      : {};
  const [thumbnail, outlook] = await Promise.all([
    renderSquareCrop(original, { ...renderOptions, size: 240 }),
    renderSquareCrop(original, { ...renderOptions, size: 648 })
  ]);
  const prefix = `relationships/${person.personId}/photos/${existing.photoId}`;
  const thumbnailStorageKey = `${prefix}/profile-240.jpg`;
  const outlookStorageKey = `${prefix}/outlook-648.jpg`;
  await Promise.all([
    savePrivateBuffer(bucket, thumbnailStorageKey, thumbnail.buffer, "image/jpeg"),
    savePrivateBuffer(bucket, outlookStorageKey, outlook.buffer, "image/jpeg")
  ]);
  const actor = getDanActorFields(deps);
  const now = getNowIso(deps);
  const photoRef = photos.doc(existing.photoId);
  const personRef = people.doc(person.personId);
  const { nextPhoto, nextPerson } = await runDanFirestoreTransaction(deps, photos, async (transaction) => {
    const [currentPhotoDoc, currentPersonDoc] = await Promise.all([
      transaction.get(photoRef),
      transaction.get(personRef)
    ]);
    if (!currentPhotoDoc.exists) throw createRelationshipError("photo not found", 404, "photo_not_found", { id: input.photoId });
    if (!currentPersonDoc.exists) throw createRelationshipError("person not found", 404, "person_not_found", { id: person.personId });
    const currentPhoto = { ...(currentPhotoDoc.data() || {}), photoId: input.photoId };
    const currentPerson = { ...(currentPersonDoc.data() || {}), personId: person.personId };
    assertExpectedVersion(currentPhoto, input.expectedVersion, "photo");
    const updatedPhoto = {
      ...currentPhoto,
      thumbnailStorageKey,
      outlookStorageKey,
      status: "approved",
      approvedAt: now,
      approvedBySub: actor.actorSub,
      version: Number(currentPhoto.version || 0) + 1,
      updatedAt: now
    };
    const updatedPerson = {
      ...currentPerson,
      profilePhotoId: currentPhoto.photoId,
      version: Number(currentPerson.version || 0) + 1,
      updatedAt: now
    };
    transaction.set(photoRef, updatedPhoto);
    transaction.set(personRef, updatedPerson);
    return { nextPhoto: updatedPhoto, nextPerson: updatedPerson };
  });
  return { photo: photoSummary(nextPhoto), personId: person.personId, personVersion: nextPerson.version };
}

async function getRelationshipPhoto(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const photo = await getRequiredRecord(getCollection(deps, "relationshipPhotosCollection"), input.photoId, "photo");
  const bucket = getPhotoBucket(deps);
  const storageKey = photo.status === "approved" && photo.thumbnailStorageKey
    ? photo.thumbnailStorageKey
    : photo.previewStorageKey;
  return {
    photo: photoSummary(photo),
    displayUrl: storageKey ? await createShortLivedUrl(bucket, storageKey) : "",
    expiresInSeconds: storageKey ? 900 : 0
  };
}

async function getOutlookPhotoPayload(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const photo = await getRequiredRecord(getCollection(deps, "relationshipPhotosCollection"), input.photoId, "photo");
  if (photo.status !== "approved" || !photo.outlookStorageKey) {
    throw createRelationshipError("Only an approved profile photo can be published to Outlook", 409, "profile_photo_not_approved");
  }
  const bucket = getPhotoBucket(deps);
  return {
    photoId: photo.photoId,
    personId: photo.personId,
    contentType: "image/jpeg",
    byteSize: Number((await bucket.file(photo.outlookStorageKey).getMetadata())?.[0]?.size || 0),
    downloadUrl: await createShortLivedUrl(bucket, photo.outlookStorageKey, 5 * 60 * 1000),
    expiresInSeconds: 300
  };
}

module.exports = {
  MAX_PHOTO_BYTES,
  SUPPORTED_PHOTO_MIME_TYPES,
  adjustRelationshipPhotoCrop,
  approveRelationshipProfilePhoto,
  assertSupportedPhotoMimeType,
  assertSafeDownloadUrl,
  getOutlookPhotoPayload,
  getRelationshipPhoto,
  photoSummary,
  renderSquareCrop,
  uploadRelationshipPhoto
};
