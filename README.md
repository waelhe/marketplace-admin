# Marketplace Admin

Independent downstream workspace for the platform's administration UI, derived from the pinned Saleor Dashboard source and integrated with the platform's Spring REST contracts.

## Upstream baseline

- Repository: `saleor/saleor-dashboard`
- Version: `3.23.39`
- Commit: `bc75e988da0fa4fbc3d47378a888d859d070746f`

The upstream application is materialized by CI at the pinned commit. Platform-specific changes live in this repository as an overlay and are applied with strict source-shape checks; the upstream source is not copied into the Maven backend repository.

## Intended acceptance journey

A browser-level Playwright test must run the real Dashboard-derived UI against the real Spring REST endpoints and verify:

1. create a product draft,
2. edit its title/description/price,
3. publish the draft,
4. read it again from the API and assert persisted values and `ACTIVE` state,
5. verify an unauthenticated request is rejected and the UI does not report failed operations as successful.

The UI calls the same-origin `/api/v1` path. Production deployment must place the Dashboard behind the platform's authenticated BFF/edge so the user's access token remains server-side and is relayed to Spring; do not put a confidential OAuth client secret or durable access token in browser storage.

## Status

This repository is initialized. The integration overlay, executable CI flow, and Playwright proof are developed in a separate branch and must pass CI before this is treated as delivered.
