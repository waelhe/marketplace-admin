import { createHash, randomBytes } from "node:crypto";
import { expect, test, type Page, type APIRequestContext, type APIResponse } from "@playwright/test";

const apiOrigin = requiredEnv("MARKETPLACE_E2E_API_ORIGIN").replace(/\/$/, "");
const clientId = requiredEnv("MARKETPLACE_E2E_CLIENT_ID");
const clientSecret = requiredEnv("MARKETPLACE_E2E_CLIENT_SECRET");
const username = requiredEnv("MARKETPLACE_E2E_USERNAME");
const password = requiredEnv("MARKETPLACE_E2E_PASSWORD");
const categoryCode = requiredEnv("MARKETPLACE_E2E_STORE_CATEGORY_CODE");
const productTypeId = requiredEnv("MARKETPLACE_E2E_PRODUCT_TYPE_ID");
const browserOrigin = process.env.MARKETPLACE_ADMIN_BROWSER_URL || "http://127.0.0.1:4180";
const redirectUri = process.env.MARKETPLACE_E2E_REDIRECT_URI || "http://127.0.0.1:4180/oauth/callback";

const productFields = "id storeCategoryCode title description priceMinor currency providerId productTypeId status";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Missing required test environment variable: ${name}`);
  return value.trim();
}

function isCallback(url: string, expectedState: string): boolean {
  const parsed = new URL(url);
  return parsed.pathname === new URL(redirectUri).pathname &&
    parsed.searchParams.has("code") &&
    parsed.searchParams.get("state") === expectedState;
}

/**
 * Obtain a short-lived user token using the existing Spring Authorization Server PKCE flow.
 * The confidential client secret stays in the Node/Playwright process and is never bundled
 * into the Dashboard or placed in browser storage. Production UI requests go through edge/BFF.
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

    // The client may require a consent decision on its first authorization. Only visible
    // controls are used; no production credentials are written to browser storage.
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
      if (await submit.count()) {
        await submit.last().click();
      } else {
        break;
      }
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
  variables: Record<string, unknown> = {},
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

test("GraphQL-backed typed catalog lifecycle works in the actual Dashboard", async ({ page, request }) => {
  const anonymous = await graphQl(request, "query { storeProducts(first: 1) { edges { node { id } } } }");
  expect(anonymous.status(), "the protected GraphQL product API must reject anonymous calls").toBe(401);

  const accessToken = await obtainAccessToken(page, request);
  await page.addInitScript(value => {
    // This global is read only by an E2E-specific build; production relies on the authenticated edge/BFF.
    (window as Window & { __MARKETPLACE_E2E_ACCESS_TOKEN__?: string }).__MARKETPLACE_E2E_ACCESS_TOKEN__ = value;
  }, accessToken);

  const roster = await graphQl(request, `
    query StoreProductRoster {
      storeProducts(first: 10) {
        edges { node { id title status } }
        pageInfo { hasNextPage endCursor }
      }
      storeProductTypes {
        id code nameEn nameAr
        attributes {
          assignmentId attributeDefinitionId code valueType scope required position
          options { id code nameEn nameAr position }
        }
      }
    }
  `, {}, accessToken);
  const rosterData = await graphQlData<{
    storeProducts: { edges: Array<{ node: { id: string; title: string; status: string } }> };
    storeProductTypes: Array<{
      id: string;
      code: string;
      attributes: Array<{
        assignmentId: string;
        code: string;
        valueType: "TEXT" | "NUMBER" | "BOOLEAN" | "CHOICE";
        scope: "PRODUCT" | "VARIANT" | "VARIANT_SELECTION";
        required: boolean;
        options: Array<{ id: string; code: string }>;
      }>;
    }>;
  }>(roster, "initial GraphQL roster");

  const configuredType = rosterData.storeProductTypes.find(type => type.id === productTypeId);
  expect(configuredType, "the configured ProductType must be available through GraphQL").toBeTruthy();

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

  const draftResponse = await graphQl(request, `
    query ReadStoreProduct($id: ID!) {
      storeProduct(id: $id) { ${productFields} }
    }
  `, { id: productId }, accessToken);
  const createdData = await graphQlData<{ storeProduct: Record<string, unknown> }>(draftResponse, "draft GraphQL read-back");
  expect(createdData.storeProduct).toMatchObject({
    id: productId,
    title,
    priceMinor: "12345",
    currency: "SAR",
    productTypeId,
    status: "DRAFT",
  });

  const configuredAttributes = configuredType!.attributes;
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
    const attributeReadResponse = await graphQl(request, `
      query ProductAttributeReadBack($productId: ID!) {
        storeProductAttributeValues(productId: $productId) {
          assignmentId textValue numberValue booleanValue optionId
        }
      }
    `, { productId }, accessToken);
    const attributeReadData = await graphQlData<{
      storeProductAttributeValues: Array<{ assignmentId: string }>;
    }>(attributeReadResponse, "product attribute read-back");
    expect(attributeReadData.storeProductAttributeValues.length).toBe(productAttributes.filter(
      attribute => attribute.required,
    ).length + productAttributes.filter(attribute => !attribute.required).length);
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

  const variantRosterResponse = await graphQl(request, `
    query VariantReadBack($productId: ID!) {
      storeProductVariants(productId: $productId) { id sku priceMinor status }
    }
  `, { productId }, accessToken);
  const variantRosterData = await graphQlData<{
    storeProductVariants: Array<{ id: string; sku: string; priceMinor: string; status: string }>;
  }>(variantRosterResponse, "variant roster read-back");
  const createdVariant = variantRosterData.storeProductVariants.find(variant => variant.sku === sku);
  expect(createdVariant, "the created variant must be persisted and readable through GraphQL").toBeTruthy();
  expect(createdVariant).toMatchObject({ sku, priceMinor: "12999", status: "ACTIVE" });

  const variantValuesResponse = await graphQl(request, `
    query VariantAttributeReadBack($variantId: ID!) {
      storeProductVariantAttributeValues(variantId: $variantId) {
        assignmentId textValue numberValue booleanValue optionId
      }
    }
  `, { variantId: createdVariant!.id }, accessToken);
  const variantValues = await graphQlData<{
    storeProductVariantAttributeValues: Array<{ assignmentId: string }>;
  }>(variantValuesResponse, "variant attribute read-back");
  expect(variantValues.storeProductVariantAttributeValues.length).toBe(variantAttributes.length);

  await page.getByTestId("product-title").fill(editedTitle);
  await page.getByTestId("product-description").fill("Updated description saved through GraphQL.");
  await page.getByTestId("product-price").fill("128.99");
  await page.getByTestId("save-product").click();
  await expect(page.getByRole("status")).toContainText("Changes saved.");

  const editResponse = await graphQl(request, `
    query ReadEditedStoreProduct($id: ID!) {
      storeProduct(id: $id) { ${productFields} }
    }
  `, { id: productId }, accessToken);
  const editedData = await graphQlData<{ storeProduct: Record<string, unknown> }>(editResponse, "edited GraphQL read-back");
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

  const readBackResponse = await graphQl(request, `
    query ReadPublishedStoreProduct($id: ID!) {
      storeProduct(id: $id) { ${productFields} }
    }
  `, { id: productId }, accessToken);
  const readBack = await graphQlData<{ storeProduct: Record<string, unknown> }>(readBackResponse, "published GraphQL read-back");
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
