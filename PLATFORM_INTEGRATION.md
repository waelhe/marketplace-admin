# Marketplace Admin integration

This downstream repository adapts a pinned Saleor Dashboard source for the platform's administrative journeys. **GraphQL is the primary transport for Dashboard catalog interactions.** Existing REST endpoints remain available to mobile clients and other integrations; the custom Dashboard catalog flow does not use REST as a substitute for the platform's GraphQL contract.

## Upstream baseline

- Repository: [saleor/saleor-dashboard](https://github.com/saleor/saleor-dashboard)
- Version: `3.23.39`
- Immutable commit: `bc75e988da0fa4fbc3d47378a888d859d070746f`

The complete pinned Dashboard source is materialized by CI. Platform-specific changes live in this repository's overlay and are applied with strict source-shape checks. Upstream Saleor screens retain their upstream GraphQL model; platform mode blocks routes that have not been adapted to the platform.

## Platform GraphQL contract

The custom catalog interface uses the schema-first Netflix DGS contract in [app-java-v3 PR #666](https://github.com/waelhe/app-java-v3/pull/666), built on typed catalog work in [PR #665](https://github.com/waelhe/app-java-v3/pull/665). Both backend PRs have been merged to `main`. The resolvers delegate to the catalog's secured domain services through `ProductAdminSpi`; GraphQL must not access repositories/entities directly or reimplement business rules.

The contract includes:

- Reads: `storeProducts(first, after)`, `storeProduct(id)`, `storeProductTypes`, `storeProductAttributeValues(productId)`, `storeProductVariants(productId)`, and `storeProductVariantAttributeValues(variantId)`.
- Product lifecycle: `createStoreProduct(input)`, `updateStoreProduct(id, input)`, and `publishStoreProduct(id)`.
- Typed configuration: `replaceStoreProductAttributes(id, values)` and `createStoreProductVariant(productId, input)`.

The ProductType projection includes assigned attribute definitions, scopes, required flags, and CHOICE options. The editor collects PRODUCT, VARIANT, and VARIANT_SELECTION values. Money crosses the contract as decimal strings for minor-unit values because GraphQL `Int` is signed 32-bit and `Float` is not exact for money. Domain services remain authoritative for ownership, validation, publishability, and unique variant-selection combinations.

## Generated contract; no manual schema edits

Source-controlled operation documents live under `platform-operations/**/*.graphql`. `pnpm run generate:platform` resolves the immutable commit SHA of the backend's published `graphql-contract` branch, fetches its SDL, validates the required fields/types, writes a generated manifest, and runs GraphQL Code Generator for operation ASTs, `TypedDocumentNode`, result types, and variable types.

Generated SDL and TypeScript output are build artifacts; do not hand-edit them. If a required operation or type is absent, publish the accepted backend schema contract first and rerun generation. Do not fetch an unmerged PR's SDL, hand-extend generated types, or add a second manually maintained API model.

## Authentication boundary

Production Dashboard requests use same-origin `POST /graphql` through the platform's authenticated edge/BFF. The edge owns the OAuth session and relays authorized access server-side; the browser must not receive a confidential OAuth client secret or persist a durable bearer token.

The isolated E2E build alone accepts the transient `window.__MARKETPLACE_E2E_ACCESS_TOKEN__` set by Playwright after obtaining a short-lived user token through the existing Spring Authorization Server Authorization Code + PKCE flow. The client secret remains in the Node test process and is never bundled into the Dashboard.

## Shared Railway production acceptance test

The project's Railway service is both the production service and the configured acceptance-test target; this workflow does not assume or provision a separate staging API. `MARKETPLACE_E2E_API_ORIGIN` is sourced directly from the protected `MARKETPLACE_PRODUCTION_API_ORIGIN` variable and is validated to match it. The GitHub Actions environment `marketplace-e2e` scopes credentials and any configured approvals; it is not a separate backend deployment.

Workflow: `.github/workflows/platform-lifecycle-e2e.yml`. The mutating flow runs only on manual dispatch with `confirm_shared_production_test=true`, or when a maintainer deliberately adds the `run-spring-e2e-production` label to this PR before the workflow is available on the default branch. Ordinary PR updates do not run the production mutations. The confirmation explicitly acknowledges that this test publishes catalog data that is not automatically deleted or unpublished.

The browser-based Playwright test drives the real Dashboard overlay and Spring GraphQL endpoint and verifies:

1. An anonymous catalog request is rejected with HTTP 401.
2. The authenticated user can read the product roster and configured ProductType.
3. The browser creates a typed draft and reads its persisted values through a fresh GraphQL query.
4. Product-scope attributes are saved and read back, and a variant is created with typed variant/selection values.
5. A fresh GraphQL query confirms the saved variant and attribute values.
6. The product is edited, published, and queried again; persisted fields and `ACTIVE` status must match the expected values.

The test title begins `E2E TEST — NOT FOR SALE`, includes the workflow run ID and attempt, and its description and variant name identify the record as test data. The Playwright report includes the created product ID, title, variant SKU, final status, and the fact that cleanup is intentionally not performed.

### Required GitHub Actions configuration

Variables in the protected `marketplace-e2e` environment:

- `MARKETPLACE_PRODUCTION_API_ORIGIN`: origin only, such as `https://host.example` (no path, query, or fragment).
- `MARKETPLACE_E2E_CLIENT_ID`.
- `MARKETPLACE_E2E_REDIRECT_URI`: redirect URI registered on the same Spring Authorization Server used by the target.
- `MARKETPLACE_E2E_STORE_CATEGORY_CODE`: an existing catalog category code.
- `MARKETPLACE_E2E_PRODUCT_TYPE_ID`: an existing ProductType compatible with the test's required values.

Secrets in that environment:

- `MARKETPLACE_E2E_CLIENT_SECRET`.
- `MARKETPLACE_E2E_USERNAME` and `MARKETPLACE_E2E_PASSWORD` for the dedicated test provider account.

The configured ProductType must include at least one selectable option for each required CHOICE/VARIANT_SELECTION assignment. The configured category must already exist. Missing configuration stops the workflow before the browser test runs. Secrets must not be committed to this repository.

### Intentional retention of test records

There is no delete or unpublish mutation in the current platform catalog GraphQL contract, and this plan does not add one solely for test cleanup. A successful run leaves its published E2E product and variant in the shared production catalog. A failure after draft creation may leave a draft, and a failure after publication may leave an active test record. Each run uses a unique ID and the generated records are explicitly labelled.

**The label is descriptive, not an access-control rule.** An `ACTIVE` product may be visible and purchasable wherever its category/provider is exposed; this workflow does not disable checkout or automatically clean up the record. The acceptance owner must understand this side effect before confirming the run.

## What is and is not proven

- A successful overlay import proves source materialization only.
- A successful type-check/build proves the customized Dashboard compiles only.
- The upstream Saleor E2E suite proves the upstream Dashboard against its disposable Saleor instance only.
- The platform journey is proven only after the protected workflow reaches the configured Spring GraphQL endpoint, completes the browser-driven typed catalog flow, and uploads a reviewable Playwright report.
- This workflow does not deploy the Dashboard to production or claim full Saleor feature parity.
