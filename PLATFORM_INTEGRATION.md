# Marketplace Admin integration

This repository contains a downstream customization of the pinned Saleor Dashboard release and its platform-specific Spring REST integration.

## Upstream baseline

- Repository: `saleor/saleor-dashboard`
- Version: `3.23.39`
- Commit: `bc75e988da0fa4fbc3d47378a888d859d070746f`

The bootstrap workflow imports the complete upstream source snapshot into this independent repository, then adds the REST adapter. The build workflow independently materializes the same fixed upstream commit and reapplies the overlay, so source drift is detected instead of silently accepted.

## Platform API boundary

The product workspace talks to the platform's existing versioned REST contracts, not Saleor's GraphQL schema:
- `GET /api/v1/store/products`
- `GET /api/v1/store/product-types`
- `POST /api/v1/store/products`
- `PATCH /api/v1/store/products/{id}`
- `POST /api/v1/store/products/{id}/publish`
- `GET /api/v1/store/products/{id}`

In production, deploy the Dashboard behind the authenticated platform edge/BFF. The browser does not hold a confidential client secret or persist an access token; the edge owns the OAuth session and relays the user's authorized access token to Spring.

## Real Playwright lifecycle gate

Workflow: `.github/workflows/platform-lifecycle-e2e.yml` (manual dispatch against the protected `marketplace-e2e` environment). It obtains a short-lived access token using the existing Authorization Code + PKCE flow, then drives the actual browser UI and verifies create → edit → publish → read-back against Spring REST. It also proves that anonymous reads are rejected. The confidential client secret and test-user password remain GitHub environment secrets, not bundled into the browser.

Configure these environment variables/secrets in a dedicated non-production `marketplace-e2e` environment before running that workflow:

- Variables: `MARKETPLACE_E2E_TARGET_APPROVED=yes`, `MARKETPLACE_E2E_API_ORIGIN` (origin only), `MARKETPLACE_E2E_CLIENT_ID`, `MARKETPLACE_E2E_REDIRECT_URI`, `MARKETPLACE_E2E_STORE_CATEGORY_CODE`, `MARKETPLACE_E2E_PRODUCT_TYPE_ID`.
- Secret: `MARKETPLACE_E2E_CLIENT_SECRET`.
- Secrets: `MARKETPLACE_E2E_USERNAME` and `MARKETPLACE_E2E_PASSWORD` for a test account with the PROVIDER role.
- Variable: `MARKETPLACE_PRODUCTION_API_ORIGIN` (recommended; the workflow refuses an exact origin match).

The redirect URI must be registered with the dedicated test backend's OAuth client. The selected ProductType must have no required PRODUCT-scope attribute values and no required VARIANT_SELECTION dimensions for this initial create/edit/publish proof; those separate attribute/variant editing journeys remain additional acceptance work. The store category code must already exist in that test database. Do not aim the mutating workflow at production.

## What is and is not proven

The Dashboard build/type-check is an automated gate. The live Spring Playwright acceptance gate is only proven after the protected-environment workflow runs successfully and its HTML report is reviewed. A successful build or upstream Saleor-only test is not a substitute.
