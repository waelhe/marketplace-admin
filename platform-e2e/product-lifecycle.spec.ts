import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page, type APIRequestContext, type APIResponse } from "@playwright/test";

import type {
  StoreProductAttributeValuesQuery,
  StoreProductAttributeValuesQueryVariables,
  StoreProductRosterQuery,
  StoreProductRosterQueryVariables,
  StoreProductTypesQuery,
  StoreProductVariantAttributeValuesQuery,
  StoreProductVariantAttributeValuesQueryVariables,
  StoreProductVariantsQuery,
  StoreProductVariantsQueryVariables,
  ReadStoreProductQuery,
  ReadStoreProductQueryVariables,
} from "../src/marketplaceAdmin/generated/platform-operations";

const apiOrigin = requiredEnv("MARKETPLACE_E2E_API_ORIGIN").replace(/\/$/, "");
const clientId = requiredEnv("MARKETPLACE_E2E_CLIENT_ID");
const clientSecret = requiredEnv("MARKETPLACE_E2E_CLIENT_SECRET");
const username = requiredEnv("MARKETPLACE_E2E_USERNAME");
const password = requiredEnv("MARKETPLACE_E2E_PASSWORD");
const categoryCode = requiredEnv("MARKETPLACE_E2E_STORE_CATEGORY_CODE");
const productTypeId = requiredEnv("MARKETPLACE_E2E_PRODUCT_TYPE_ID");
const browserOrigin = process.env.MARKETPLACE_ADMIN_BROWSER_URL || "http://127.0.0.1:4180";
const redirectUri = process.env.MARKETPLACE_E2E_REDIRECT_URI || "http://127.0.0.1:4180/oauth/callback";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Missing required test environment variable: ${name}`);
  return value.trim();
}

/** Reuse the source-controlled operation documents validated by GraphQL Code Generator. */
function operation(name: string): string {
  return readFileSync(resolve(process.cwd(), "platform-operations", name), "utf8");
}

function isCallback(url: string, expectedState: string): boolean {
  const parsed = new URL(url);
  return parsed.pathname === new URL(redirectUri).pathname &&
    parsed.searchParams.has("code") &&
    parsed.searchParams.get("state") === expectedState;
}

/**
 * Obtain a short-lived user token using Spring Authorization Server's Authorization Code + PKCE flow.
 * The confidential client secret stays in the Playwright process and is never bundled into the browser.
 */
async function obtainAccessToken(page: Page, request: APIRequestContext): Promise<string> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(24).toString("base64url");
  const authorize = new URL("/oauth2/authorize", browserOrigin);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("scope", "openid profile");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("nonce", randomBytes(24).toString("base64url"));
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");

  await page.goto(authorize.toString());

  if (!isCallback(page.url(), state)) {
    const userField = page.locator('input[name="username"]');
    if (await userField.isVisible().catch(() => false)) {
      await userField.fill(username);
      await page.locator('input[name="password"]').fill(password);
      await page.locator('button[type="submit"], input[type="submit"]').last().click();
    }

    // First-time authorization may display a consent screen. Use visible controls only.
    for (let attempt = 0; attempt < 2 && !isCallback(page.url(), state); attempt++) {
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      if (await page.locator('input[name="username"]').isVisible().catch(() => false)) {
        await page.locator('input[name="username"]').fill(username);
        await page.locator('input[name="password"]').fill(password);
        await page.locator('button[type="submit"], input[type="submit"]').last().click();
        continue;
      }

      const checkboxes = page.locator('input[type="checkbox"]');
      for (let i = 0; i < await checkboxes.count(); i++) {
        const checkbox = checkboxes.nth(i);
        if (await checkbox.isVisible().catch(() => false) && !(await checkbox.isChecked().catch(() => true))) {
          await checkbox.check();
        }
      }
      const submit = page.locator('button[type="submit"], input[type="submit"]');
      if (await submit.count()) await submit.last().click();
      else break;
    }
  }

  await page.waitForURL(url => isCallback(url.toString(), state), { timeout: 60_000 });
  const callback = new URL(page.url());
  const code = callback.searchParams.get("code");
  if (!code) throw new Error("Spring authorization callback did not contain an authorization code.");

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const tokenResponse = await request.post("/oauth2/token", {
    headers: { Authorization: `Basic ${basic}` },
    form: {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    },
  });
  const payload = await tokenResponse.json().catch(() => ({})) as { access_token?: string; error?: string };
  if (!tokenResponse.ok() || !payload.access_token) {
    throw new Error(`Spring token exchange failed (${tokenResponse.status()}): ${payload.error || "access_token missing"}`);
  }
  return payload.access_token;
}

async function graphQl(
  request: APIRequestContext,
  query: string,
  variables: object = {},
  accessToken?: string,
): Promise<APIResponse> {
  return request.post(`${apiOrigin}/graphql`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    data: { query, variables },
    failOnStatusCode: false,
  });
}

async function graphQlData<T>(
  response: APIResponse,
  diagnostic: string,
): Promise<T> {
  const rawBody = await response.text();
  expect(response.status(), `${diagnostic}: HTTP ${response.status()} ${rawBody}`).toBe(200);
  const envelope = JSON.parse(rawBody) as { data?: T; errors?: Array<{ message?: string }> };
  expect(envelope.errors, `${diagnostic} GraphQL errors: ${JSON.stringify(envelope.errors)}`).toBeUndefined();
  expect(envelope.data, `${diagnostic} returned no GraphQL data`).toBeDefined();
  return envelope.data as T;
}

test("typed catalog lifecycle uses generated GraphQL operations through the actual Dashboard", async ({ page, request }) => {
  // Platform mode deliberately hides every upstream Saleor route not yet backed by platform operations.
  await page.goto("/");
  await expect(page.getByTestId("marketplace-admin-unavailable")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open supported catalog" }))
    .toHaveAttribute("href", "/marketplace-admin");

  const anonymousVariables: StoreProductRosterQueryVariables = { first: 1, after: null };
  const anonymous = await graphQl(request, operation("store-product-roster.graphql"), anonymousVariables);
  expect(anonymous.status(), "the protected GraphQL product API must reject anonymous calls").toBe(401);

  const accessToken = await obtainAccessToken(page, request);
  await page.addInitScript(value => {
    // Read only by an E2E-specific build. Production relies on the authenticated edge/BFF.
    (window as Window & { __MARKETPLACE_E2E_ACCESS_TOKEN__?: string }).__MARKETPLACE_E2E_ACCESS_TOKEN__ = value;
  }, accessToken);

  const rosterVariables: StoreProductRosterQueryVariables = { first: 10, after: null };
  const roster = await graphQl(
    request,
    operation("store-product-roster.graphql"),
    rosterVariables,
    accessToken,
  );
  const rosterData = await graphQlData<StoreProductRosterQuery>(roster, "initial generated GraphQL roster");
  const typesResponse = await graphQl(
    request,
    operation("store-product-types.graphql"),
    {},
    accessToken,
  );
  const typesData = await graphQlData<StoreProductTypesQuery>(typesResponse, "generated GraphQL ProductTypes");
  const configuredType = typesData.storeProductTypes.find(type => type.id === productTypeId);
  expect(configuredType, "the configured ProductType must be available through GraphQL").toBeTruthy();
  if (!configuredType) throw new Error("Configured ProductType is absent from the generated GraphQL response.");

  await page.goto("/marketplace-admin");
  await expect(page.getByRole("heading", { name: "Marketplace catalog" })).toBeVisible();
  await expect(page.getByTestId("product-editor")).toBeVisible();

  const title = `Playwright GraphQL catalog journey ${new Date().toISOString()}`;
  const editedTitle = `${title} — edited`;

  await page.getByTestId("category-code").fill(categoryCode);
  await page.getByTestId("product-type").selectOption(productTypeId);
  await page.getByTestId("product-title").fill(title);
  await page.getByTestId("product-description").fill("Browser-driven typed GraphQL lifecycle acceptance test.");
  await page.getByTestId("product-price").fill("123.45");
  await page.getByTestId("product-currency").fill("SAR");
  await page.getByTestId("save-product").click();

  const createdNotice = page.getByRole("status");
  await expect(createdNotice).toContainText("Draft created:");
  const productId = (await createdNotice.innerText()).match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0];
  expect(productId, "createStoreProduct must return a product UUID").toBeTruthy();
  if (!productId) throw new Error("The create mutation did not expose the product UUID.");

  const draftVariables: ReadStoreProductQueryVariables = { id: productId };
  const draftResponse = await graphQl(
    request,
    operation("read-store-product.graphql"),
    draftVariables,
    accessToken,
  );
  const createdData = await graphQlData<ReadStoreProductQuery>(draftResponse, "draft GraphQL read-back");
  expect(createdData.storeProduct).toMatchObject({
    id: productId,
    title,
    priceMinor: "12345",
    currency: "SAR",
    productTypeId,
    status: "DRAFT",
  });

  const configuredAttributes = configuredType.attributes;
  const productAttributes = configuredAttributes.filter(attribute => attribute.scope === "PRODUCT");
  for (const attribute of productAttributes) {
    const field = page.getByTestId(`product-attribute-${attribute.assignmentId}`);
    switch (attribute.valueType) {
      case "TEXT":
        await field.fill(`Playwright value ${attribute.code}`);
        break;
      case "NUMBER":
        await field.fill("1");
        break;
      case "BOOLEAN":
        await field.selectOption("true");
        break;
      case "CHOICE":
        expect(attribute.options.length, `CHOICE ${attribute.code} must have options`).toBeGreaterThan(0);
        await field.selectOption(attribute.options[0].id);
        break;
    }
  }

  if (productAttributes.length > 0) {
    await page.getByTestId("save-product-attributes").click();
    await expect(page.getByRole("status")).toContainText("Product attributes saved");
    const attributeVariables: StoreProductAttributeValuesQueryVariables = { productId };
    const attributeReadResponse = await graphQl(
      request,
      operation("store-product-attribute-values.graphql"),
      attributeVariables,
      accessToken,
    );
    const attributeReadData = await graphQlData<StoreProductAttributeValuesQuery>(
      attributeReadResponse,
      "product attribute read-back",
    );
    expect(attributeReadData.storeProductAttributeValues.map(value => value.assignmentId).sort())
      .toEqual(productAttributes.map(attribute => attribute.assignmentId).sort());
  }

  const variantAttributes = configuredAttributes.filter(
    attribute => attribute.scope === "VARIANT" || attribute.scope === "VARIANT_SELECTION",
  );
  const sku = `PW-GQL-${Date.now()}`;
  await page.getByTestId("variant-sku").fill(sku);
  await page.getByTestId("variant-name").fill("Playwright typed variant");
  await page.getByTestId("variant-price").fill("129.99");
  for (const attribute of variantAttributes) {
    const field = page.getByTestId(`variant-attribute-${attribute.assignmentId}`);
    switch (attribute.valueType) {
      case "TEXT":
        await field.fill(`Variant value ${attribute.code}`);
        break;
      case "NUMBER":
        await field.fill("2");
        break;
      case "BOOLEAN":
        await field.selectOption("true");
        break;
      case "CHOICE":
        expect(attribute.options.length, `CHOICE ${attribute.code} must have options`).toBeGreaterThan(0);
        await field.selectOption(attribute.options[0].id);
        break;
    }
  }

  await page.getByTestId("create-variant").click();
  await expect(page.getByRole("status")).toContainText(`Variant ${sku} created through GraphQL`);

  const variantVariables: StoreProductVariantsQueryVariables = { productId };
  const variantRosterResponse = await graphQl(
    request,
    operation("store-product-variants.graphql"),
    variantVariables,
    accessToken,
  );
  const variantRosterData = await graphQlData<StoreProductVariantsQuery>(
    variantRosterResponse,
    "variant roster read-back",
  );
  const createdVariant = variantRosterData.storeProductVariants.find(variant => variant.sku === sku);
  expect(createdVariant, "the created variant must be persisted and readable through GraphQL").toBeTruthy();
  if (!createdVariant) throw new Error("The created variant was not returned by the generated GraphQL query.");
  expect(createdVariant).toMatchObject({ sku, priceMinor: "12999", status: "ACTIVE" });

  const variantValuesVariables: StoreProductVariantAttributeValuesQueryVariables = { variantId: createdVariant.id };
  const variantValuesResponse = await graphQl(
    request,
    operation("store-product-variant-attribute-values.graphql"),
    variantValuesVariables,
    accessToken,
  );
  const variantValues = await graphQlData<StoreProductVariantAttributeValuesQuery>(
    variantValuesResponse,
    "variant attribute read-back",
  );
  expect(variantValues.storeProductVariantAttributeValues.map(value => value.assignmentId).sort())
    .toEqual(variantAttributes.map(attribute => attribute.assignmentId).sort());

  await page.getByTestId("product-title").fill(editedTitle);
  await page.getByTestId("product-description").fill("Updated description saved through GraphQL.");
  await page.getByTestId("product-price").fill("128.99");
  await page.getByTestId("save-product").click();
  await expect(page.getByRole("status")).toContainText("Changes saved.");

  const editResponse = await graphQl(
    request,
    operation("read-store-product.graphql"),
    draftVariables,
    accessToken,
  );
  const editedData = await graphQlData<ReadStoreProductQuery>(editResponse, "edited GraphQL read-back");
  expect(editedData.storeProduct).toMatchObject({
    id: productId,
    title: editedTitle,
    description: "Updated description saved through GraphQL.",
    priceMinor: "12899",
    status: "DRAFT",
  });

  await page.getByTestId("publish-product").click();
  await expect(page.getByTestId("published-readback")).toBeVisible();
  await expect(page.getByTestId("readback-title")).toHaveText(editedTitle);
  await expect(page.getByTestId("readback-price")).toHaveText("12899");
  await expect(page.getByTestId("readback-status")).toHaveText("ACTIVE");

  const readBackResponse = await graphQl(
    request,
    operation("read-store-product.graphql"),
    draftVariables,
    accessToken,
  );
  const readBack = await graphQlData<ReadStoreProductQuery>(readBackResponse, "published GraphQL read-back");
  expect(readBack.storeProduct).toMatchObject({
    id: productId,
    title: editedTitle,
    description: "Updated description saved through GraphQL.",
    priceMinor: "12899",
    currency: "SAR",
    productTypeId,
    status: "ACTIVE",
  });
});
