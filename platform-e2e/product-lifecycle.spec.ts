import { createHash, randomBytes } from "node:crypto";
import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

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
    // checkboxes/buttons are used; no production credentials are written to browser storage.
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

test("product lifecycle is created, edited, published and read back from Spring", async ({ page, request }) => {
  const anonymous = await request.get(`${apiOrigin}/api/v1/store/products`);
  expect(anonymous.status(), "protected product API must reject anonymous calls").toBe(401);

  const accessToken = await obtainAccessToken(page, request);
  await page.addInitScript(value => {
    // This global is read only by an E2E-specific build; production relies on the edge/BFF.
    (window as Window & { __MARKETPLACE_E2E_ACCESS_TOKEN__?: string }).__MARKETPLACE_E2E_ACCESS_TOKEN__ = value;
  }, accessToken);

  const apiProducts = await request.get(`${apiOrigin}/api/v1/store/products`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(apiProducts.status(), await apiProducts.text()).toBe(200);

  await page.goto("/marketplace-admin");
  await expect(page.getByRole("heading", { name: "Marketplace catalog" })).toBeVisible();
  await expect(page.getByTestId("product-editor")).toBeVisible();

  const title = `Playwright catalog journey ${new Date().toISOString()}`;
  const editedTitle = `${title} — edited`;

  await page.getByTestId("category-code").fill(categoryCode);
  await page.getByTestId("product-type").selectOption(productTypeId);
  await page.getByTestId("product-title").fill(title);
  await page.getByTestId("product-description").fill("Browser-driven Spring REST lifecycle acceptance test.");
  await page.getByTestId("product-price").fill("123.45");
  await page.getByTestId("product-currency").fill("SAR");
  await page.getByTestId("save-product").click();

  const createdNotice = page.getByRole("status");
  await expect(createdNotice).toContainText("Draft created:");
  const productId = (await createdNotice.innerText()).match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0];
  expect(productId, "create response should return a product UUID").toBeTruthy();

  const draftResponse = await request.get(`${apiOrigin}/api/v1/store/products/${productId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(draftResponse.status(), await draftResponse.text()).toBe(200);
  const created = await draftResponse.json();
  expect(created.id).toBe(productId);
  expect(created.title).toBe(title);
  expect(created.productTypeId).toBe(productTypeId);
  expect(created.status).toBe("DRAFT");

  await page.getByTestId(`product-row-${productId}`).getByRole("button", { name: "Edit" }).click();
  await page.getByTestId("product-title").fill(editedTitle);
  await page.getByTestId("product-description").fill("Updated description saved through the Dashboard REST bridge.");
  await page.getByTestId("product-price").fill("128.99");
  await page.getByTestId("save-product").click();
  await expect(page.getByRole("status")).toContainText("Changes saved.");

  const editResponse = await request.get(`${apiOrigin}/api/v1/store/products/${productId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(editResponse.status(), await editResponse.text()).toBe(200);
  const edited = await editResponse.json();
  expect(edited.title).toBe(editedTitle);
  expect(edited.description).toBe("Updated description saved through the Dashboard REST bridge.");
  expect(edited.priceMinor).toBe(12899);
  expect(edited.status).toBe("DRAFT");

  await page.getByTestId("publish-product").click();
  await expect(page.getByTestId("published-readback")).toBeVisible();
  await expect(page.getByTestId("readback-title")).toHaveText(editedTitle);
  await expect(page.getByTestId("readback-price")).toHaveText("12899");
  await expect(page.getByTestId("readback-status")).toHaveText("ACTIVE");

  const readBackResponse = await request.get(`${apiOrigin}/api/v1/store/products/${productId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(readBackResponse.status(), await readBackResponse.text()).toBe(200);
  const readBack = await readBackResponse.json();
  expect(readBack).toMatchObject({
    id: productId,
    title: editedTitle,
    description: "Updated description saved through the Dashboard REST bridge.",
    priceMinor: 12899,
    currency: "SAR",
    productTypeId,
    status: "ACTIVE",
  });
});
