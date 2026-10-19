# Marketplace Admin integration

This independent repository starts from the pinned Saleor Dashboard release and adds platform-native administrative journeys. **GraphQL is the primary transport for Dashboard catalog interactions.** REST remains a supported platform transport for existing mobile clients, partner integrations, webhooks and HTTP-shaped operations, but it is not the acceptance path for this Dashboard journey.

## Upstream baseline

- Repository: `saleor/saleor-dashboard`
- Version: `3.23.39`
- Commit: `bc75e988da0fa4fbc3d47378a888d859d070746f`

The importer materializes the complete pinned source into this separate repository. The upstream Dashboard operations and generated Saleor schema remain available for upstream screens; platform-specific catalog operations use a separate typed GraphQL request adapter on the custom catalog screen. This avoids pretending that the platform implements Saleor's full GraphQL schema or breaking upstream generated types.

## Platform GraphQL contract

The current `app-java-v3/main` GraphQL schema has product/service-demo fields but did not previously expose product administration. The backend implementation therefore has to land as a schema-first DGS slice before the browser acceptance workflow can be marked green:

- `storeProducts(first, after)`: provider-owned cursor-paginated roster.
- `storeProduct(id)`: owner-scoped product read-back.
- `storeProductTypes`: product types permitted in provider configuration.
- `createStoreProduct(input)`, `updateStoreProduct(id, input)`, `publishStoreProduct(id)`: the product lifecycle commands.

The adapter delegates to the catalog's named `ProductAdminSpi`, which itself delegates to the same secured domain services used by REST. It must not access repositories/entities directly or duplicate publication validation. The GraphQL schema uses an exact decimal string for `priceMinor`; GraphQL `Int` is only signed 32-bit and `Float` is not an exact money representation. The connection is bounded and cursor-based; the server owns provider scope and status transitions.

Backend work is being tracked in a separate stacked PR in `waelhe/app-java-v3` based on the typed catalog PR. It is not merged yet. Until that contract is integrated into the dedicated test backend, the actual browser flow is **blocked / not proven**.

## Authentication boundary

In production, mount the Dashboard behind the platform's authenticated edge/BFF. Browser requests are same-origin `POST /graphql` calls; the edge owns the OAuth session and relays the user's authorized access token server-side. The browser never receives the confidential OAuth client secret and does not persist a durable access token.

Only the isolated Playwright build accepts the transient `window.__MARKETPLACE_E2E_ACCESS_TOKEN__` value injected by the test. The test obtains a short-lived user token using Authorization Code + PKCE, keeping the client secret in the Node/Playwright process.

## Real Playwright lifecycle gate

Workflow: `.github/workflows/platform-lifecycle-e2e.yml`, manually dispatched against the protected `marketplace-e2e` environment. After the backend GraphQL contract is deployed to that dedicated non-production environment, it must drive the real browser UI and verify:

1. Anonymous access to the protected catalog GraphQL query is rejected.
2. The roster and ProductType configuration are read through GraphQL.
3. The browser creates a typed product draft through `createStoreProduct`.
4. The browser edits it through `updateStoreProduct`.
5. The browser publishes it through `publishStoreProduct`.
6. A new `storeProduct(id)` query returns the persisted values and `ACTIVE` status.

Required protected-environment configuration:

- Variables: `MARKETPLACE_E2E_TARGET_APPROVED=yes`, `MARKETPLACE_E2E_API_ORIGIN` (origin only), `MARKETPLACE_E2E_CLIENT_ID`, `MARKETPLACE_E2E_REDIRECT_URI`, `MARKETPLACE_E2E_STORE_CATEGORY_CODE`, `MARKETPLACE_E2E_PRODUCT_TYPE_ID`, and `MARKETPLACE_PRODUCTION_API_ORIGIN`.
- Secrets: `MARKETPLACE_E2E_CLIENT_SECRET`, `MARKETPLACE_E2E_USERNAME`, and `MARKETPLACE_E2E_PASSWORD` for a test account with the PROVIDER role.

The OAuth redirect URI must be registered on the dedicated test backend. The chosen test ProductType must have no required PRODUCT-scope values or VARIANT_SELECTION dimensions for this first lifecycle slice; those later attribute/variant editing journeys need their own explicit GraphQL operations and Playwright tests. The chosen store-category code must already exist. The workflow refuses an exact API-origin match with the configured production origin.

## What is and is not proven

- A successful source import proves source materialization only.
- A successful type-check/build proves the customized Dashboard compiles only.
- The original Saleor E2E suite proves the upstream Dashboard against disposable Saleor only.
- The platform journey is proven only after the protected-environment Playwright run reaches the actual Spring GraphQL endpoint, succeeds end to end, and uploads a reviewable report.

No production deployment or full Saleor feature parity is claimed.
