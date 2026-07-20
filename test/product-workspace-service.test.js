const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const productDispatcherSchema = require("../docs/gpts/product-builder.schema.dispatcher-upload.json");
const {
  listProductWorkspaceOperations
} = require("../lib/product-workspace-operation-registry");

const {
  getProductWorkspaceConfig,
  importProductRegister,
  searchProducts,
  seedProductWorkspaceConfig,
  suggestSku,
  updateProductSpecifications
} = require("../lib/product-workspace-service");

function createFakeProductsCollection(seed = {}) {
  const records = new Map(Object.entries(seed));

  return {
    records,
    doc(id) {
      return {
        async get() {
          return {
            exists: records.has(id),
            data: () => records.get(id)
          };
        },
        async set(value, options = {}) {
          records.set(id, options.merge ? { ...(records.get(id) || {}), ...value } : value);
        },
        async update(value) {
          if (!records.has(id)) throw new Error("not found");
          records.set(id, { ...(records.get(id) || {}), ...value });
        }
      };
    },
    limit() {
      return {
        async get() {
          return {
            docs: Array.from(records.entries()).map(([id, value]) => ({
              id,
              data: () => value
            }))
          };
        }
      };
    }
  };
}

function createFakeConfigCollection(seed = {}) {
  const records = new Map(Object.entries(seed));

  return {
    records,
    doc(id) {
      return {
        async get() {
          return {
            exists: records.has(id),
            data: () => records.get(id)
          };
        },
        async set(value) {
          records.set(id, value);
        }
      };
    }
  };
}

test("suggestSku builds the expected BHE SKU and reports conflicts", async () => {
  const productsCollection = createFakeProductsCollection({
    "tyndale-new-testament-1526": {
      slug: "tyndale-new-testament-1526",
      title: "Tyndale New Testament 1526 Commemorative Edition",
      productType: "Facsimile Bible",
      identifiers: {
        bheSku: "BHE-FB-TYN-1526-COM"
      }
    }
  });

  const result = await suggestSku(
    {
      title: "Tyndale New Testament 1526 Commemorative Edition",
      productType: "Facsimile Bible"
    },
    { productsCollection }
  );

  assert.equal(result.sku, "BHE-FB-TYN-1526-COM");
  assert.equal(result.available, false);
  assert.equal(result.conflicts.length, 1);
});

test("importProductRegister dry run plans product import without writing", async () => {
  const productsCollection = createFakeProductsCollection();

  const result = await importProductRegister(
    {
      dryRun: true,
      sourceName: "shopify-products-csv",
      records: [
        {
          title: "Geneva Bible 1560 Black",
          shopifyHandle: "geneva-bible-1560-black",
          productType: "Facsimile Bible",
          sku: "BHE-FB-GEN-1560-BLK",
          isbn13: "9780000000001"
        }
      ]
    },
    {
      productsCollection,
      now: () => "2026-07-14T12:00:00.000Z"
    }
  );

  assert.equal(result.dryRun, true);
  assert.equal(result.plannedCount, 1);
  assert.equal(result.importedCount, 0);
  assert.equal(productsCollection.records.size, 0);
});

test("searchProducts includes identifiers in searchable text", async () => {
  const productsCollection = createFakeProductsCollection({
    "geneva-bible-1560-black": {
      slug: "geneva-bible-1560-black",
      title: "Geneva Bible 1560 Black",
      productType: "Facsimile Bible",
      identifiers: {
        bheSku: "BHE-FB-GEN-1560-BLK",
        isbn13: "9780000000001"
      }
    }
  });

  const result = await searchProducts(
    {
      query: "BHE-FB-GEN-1560-BLK"
    },
    { productsCollection }
  );

  assert.equal(result.count, 1);
  assert.equal(result.results[0].slug, "geneva-bible-1560-black");
});

test("updateProductSpecifications stores structured fields and syncs compatibility fields", async () => {
  const productsCollection = createFakeProductsCollection({
    "tyndale-new-testament-1526": {
      slug: "tyndale-new-testament-1526",
      title: "1526 William Tyndale New Testament Facsimile",
      authors: [],
      binding: "",
      language: "English"
    }
  });

  const result = await updateProductSpecifications(
    {
      slug: "tyndale-new-testament-1526",
      authors: ["William Tyndale"],
      pageCount: 704,
      pageCountUnit: "pages",
      binding: "Hardcover",
      language: "English",
      languageType: "Original",
      publicationDate: null,
      bisacCode: "bib018030",
      subjectCode: "bib018030",
      subjectCodeType: "bisac"
    },
    {
      productsCollection,
      now: () => "2026-07-16T12:00:00.000Z"
    }
  );

  assert.deepEqual(result.authors, ["William Tyndale"]);
  assert.equal(result.specifications.pageCount, 704);
  assert.equal(result.specifications.publicationDate, null);
  assert.equal(result.classification.bisacCode, "BIB018030");

  const stored = productsCollection.records.get("tyndale-new-testament-1526");
  assert.equal(stored.binding, "Hardcover");
  assert.equal(stored.language, "English");
  assert.equal(stored.specifications.languageType, "Original");
  assert.equal(stored.classification.subjectCodeType, "BISAC");
  assert.match(stored.searchText, /bib018030/);
});

test("updateProductSpecifications rejects invalid page counts and publication dates", async () => {
  const productsCollection = createFakeProductsCollection({
    "tyndale-new-testament-1526": {
      slug: "tyndale-new-testament-1526",
      title: "1526 William Tyndale New Testament Facsimile"
    }
  });

  await assert.rejects(
    updateProductSpecifications(
      { slug: "tyndale-new-testament-1526", pageCount: 0 },
      { productsCollection }
    ),
    (error) => error.code === "invalid_page_count"
  );

  await assert.rejects(
    updateProductSpecifications(
      { slug: "tyndale-new-testament-1526", publicationDate: "2026-02-31" },
      { productsCollection }
    ),
    (error) => error.code === "invalid_publication_date"
  );
});

test("product dispatcher requires structured arguments and advertises specification updates", () => {
  const queryRequest = productDispatcherSchema.components.schemas.QueryDispatchRequest;
  const commandRequest = productDispatcherSchema.components.schemas.CommandDispatchRequest;
  const queryArguments = productDispatcherSchema.components.schemas.QueryDispatchArguments;
  const catalog = listProductWorkspaceOperations();

  assert.ok(queryRequest.required.includes("arguments"));
  assert.ok(commandRequest.required.includes("arguments"));
  assert.ok(commandRequest.required.includes("idempotencyKey"));
  assert.equal(queryArguments.properties.query.type, "string");
  assert.ok(catalog.operations.some((operation) => operation.operation === "updateProductSpecifications"));
});

test("Product GPT instructions and uploaded catalog stay within the live contract", () => {
  const instructions = fs.readFileSync(
    path.join(__dirname, "../docs/gpts/product-builder.instructions.md"),
    "utf8"
  );
  const uploadedCatalog = fs.readFileSync(
    path.join(__dirname, "../docs/gpts/product-workspace.operation-catalog.md"),
    "utf8"
  );
  const catalog = listProductWorkspaceOperations();

  assert.ok(instructions.length <= 8000, `Product GPT instructions are ${instructions.length}/8000 characters`);
  assert.ok(uploadedCatalog.includes("Catalog version: `" + catalog.catalogVersion + "`"));
  assert.ok(uploadedCatalog.includes("Catalog hash: `" + catalog.catalogHash + "`"));
  assert.match(uploadedCatalog, new RegExp(`currently exposes ${catalog.count} operations`));
});

test("product workspace config falls back to defaults and can be seeded", async () => {
  const configCollection = createFakeConfigCollection();

  const fallback = await getProductWorkspaceConfig({}, {});
  assert.equal(fallback.source, "backend-defaults");
  assert.ok(fallback.config.allowedValues.productTypes.includes("Facsimile Bible"));

  const seeded = await seedProductWorkspaceConfig(
    { configId: "default" },
    {
      productWorkspaceConfigCollection: configCollection,
      now: () => "2026-07-14T12:00:00.000Z"
    }
  );
  assert.equal(seeded.seeded, true);
  assert.equal(configCollection.records.has("default"), true);

  const stored = await getProductWorkspaceConfig(
    {},
    { productWorkspaceConfigCollection: configCollection }
  );
  assert.equal(stored.source, "firestore");
  assert.equal(stored.config.defaults.vendor, "Biblical Heritage Exhibit");
});
