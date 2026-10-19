# Marketplace Admin integration

This independent repository starts from the pinned Saleor Dashboard release and adds platform-native administrative journeys. **GraphQL is the primary transport for Dashboard catalog interactions.** REST remains supported for existing mobile clients, partner integrations, webhooks and HTTP-shaped operations, but it is not the acceptance transport for this Dashboard journey.

## Upstream baseline

- Repository: `saleor/saleor-dashboard`
- Version: `3.23.39`
- Commit: `bc75e988da0fa4fbc3d47378a888d859d070746f`

The complete pinned Dashboard source is materialized into this separate repository. Upstream Saleor screens keep their upstream GraphQL model; the custom platform catalog screen uses a separate typed GraphQL adapter. This avoids pretending that the platform implements Saleor's full GraphQL schema or contaminating upstream generated types.

## Platform GraphQL contract

The catalog-admin interface uses the platform's schema-first DGS contract being added in stacked [app-java-v3 PR #666](https://github.com/waelhe/app-java-v3/pull/666), based on [typed catalog PR #665](https://github.com/waelhe/app-java-v3/pull/665):

- Reads: `storeProducts(first, after)`, `storeProduct(id)`, `storeProductTypes`, `storeProductAttributeValues(productId)`, `storeProductVariants(productId)`, and `storeProductVariantAttributeValues(variantId)`.
- Product lifecycle: `createStoreProduct(input)`, `updateStoreProduct(id, input)`, `publishStoreProduct(id)`.
- Typed configuration/lifecycle: `replaceStoreProductAttributes(id, values)`, `createStoreProductVariant(productId, input)`.

The ProductType projection carries the assigned attribute definitions, scopes, required flags, and CHOICE options. The editor renders PRODUCT-scope fields separately from VARIANT and VARIANT_SELECTION fields. It supports text, exact decimal-number strings, booleans, and option IDs. Product and variant values are read back via GraphQL after saving; server-owned rules still decide whether a product can be published and whether a variant-selection combination is unique.

The backend adapter delegates to the catalog's named `ProductAdminSpi`, which itself delegates to the same secured domain services used by REST. It must not access repositories/entities directly or duplicate business rules. The GraphQL schema uses decimal strings for `priceMinor` because GraphQL `Int` is signed 32-bit and `Float` is not exact money. Connections are bounded/cursor-based; server-side identity and ownership determine scope.

Both PRs remain Draft. The typed schema and resolvers are not merged to `main`, and the backend integration has not yet passed the latest full CI round. Do not treat this document or source changes as proof of a live browser journey.

## Authentication boundary

Production UI requests are same-origin `POST /graphql` calls through the authenticated platform edge/BFF. The edge owns the OAuth session and relays authorized access server-side. The browser never receives the confidential OAuth client secret and does not persist a durable access token.

Only the isolated Playwright build accepts the transient `window.__MARKETPLACE_E2E_ACCESS_TOKEN__` value injected by the Node test after obtaining a short-lived user token using Authorization Code + PKCE.

## Real Playwright lifecycle gate

Workflow: `.github/workflows/platform-lifecycle-e2e.yml`, manually dispatched against the protected `marketplace-e2e` environment. After PR #666's GraphQL contract is deployed to the dedicated non-production environment, Playwright must drive the actual Dashboard and Spring endpoint and verify:

1. Anonymous GraphQL catalog access is rejected.
2. The roster and ProductType/attribute/option configuration are read through GraphQL.
3. The browser creates a typed draft, enters required product attributes, and saves them via GraphQL.
4. The browser creates a variant with required typed selections and reads its saved values back.
5. The browser edits and publishes the product through GraphQL.
6. Fresh GraphQL queries confirm saved product values, variant values, and `ACTIVE` status.

Required protected-environment configuration:

- Variables: `MARKETPLACE_E2E_TARGET_APPROVED=yes`, `MARKETPLACE_E2E_API_ORIGIN` (origin only), `MARKETPLACE_E2E_CLIENT_ID`, `MARKETPLACE_E2E_REDIRECT_URI`, `MARKETPLACE_E2E_STORE_CATEGORY_CODE`, `MARKETPLACE_E2E_PRODUCT_TYPE_ID`, and `MARKETPLACE_PRODUCTION_API_ORIGIN`.
- Secrets: `MARKETPLACE_E2E_CLIENT_SECRET`, `MARKETPLACE_E2E_USERNAME`, and `MARKETPLACE_E2E_PASSWORD` for a dedicated test user with PROVIDER role.

The OAuth redirect URI must be registered on the dedicated test backend. The configured ProductType must have at least one selectable option for every required CHOICE/VARIANT_SELECTION assignment. The store-category code must already exist. The workflow refuses an exact API-origin match with the configured production origin.

## What is and is not proven

- A successful source import proves source materialization only.
- A successful type-check/build proves the customized Dashboard compiles only.
- The upstream Saleor E2E suite proves the upstream Dashboard against disposable Saleor only.
- The platform journey is proven only after the protected-environment Playwright run reaches the actual Spring GraphQL endpoint, completes the browser-driven typed catalog flow, and uploads a reviewable report.

No production deployment or full Saleor feature parity is claimed.
