import { expect, test, type Page } from "@playwright/test";

const apiOrigin = requiredEnv("MARKETPLACE_E2E_API_ORIGIN").replace(/\/$/, "");
const token = requiredEnv("MARKETPLACE_E2E_ACCESS_TOKEN");
const categoryCode = requiredEnv("MARKETPLACE_E2E_STORE_CATEGORY_CODE");
const productTypeId = requiredEnv("MARKETPLACE_E2E_PRODUCT_TYPE_ID");

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Missing required test environment variable: ${name}`);
  return value.trim();
}

async function installTestAuthorization(page: Page) {
  await page.addInitScript(value => {
    // Available only in the E2E build. Production relies on the authenticated edge/BFF.
    (window as Window & { __MARKETPLACE_E2E_ACCESS_TOKEN__?: string }).__MARKETPLACE_E2E_ACCESS_TOKEN__ = value;
  }, token);
}

test("product lifecycle is created, edited, published and read back from Spring", async ({ page, request }) => {
  await installTestAuthorization(page);

  const anonymous = await request.get(`${apiOrigin}/api/v1/store/products`);
  expect(anonymous.status(), "protected product API must reject anonymous calls").toBe(401);

  const apiProducts = await request.get(`${apiOrigin}/api/v1/store/products`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(apiProducts.status(), await apiProducts.text()).toBe(200);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Marketplace catalog" })).toBeVisible();
  await expect(page.getByTestId("product-editor")).toBeVisible();

  const title = `Playwright catalog journey ${new Date().toISOString()}`;
  const editedTitle = `${title} — edited`;
  const initialPrice = "123.45";
  const editedPrice = "128.99";

  await page.getByTestId("category-code").fill(categoryCode);
  await page.getByTestId("product-type").selectOption(productTypeId);
  await page.getByTestId("product-title").fill(title);
  await page.getByTestId("product-description").fill("Browser-driven Spring REST lifecycle acceptance test.");
  await page.getByTestId("product-price").fill(initialPrice);
  await page.getByTestId("product-currency").fill("SAR");
  await page.getByTestId("save-product").click();

  const createdNotice = page.getByRole("status");
  await expect(createdNotice).toContainText("Draft created:");
  const productId = (await createdNotice.innerText()).match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0];
  expect(productId, "create response should return a product UUID").toBeTruthy();

  const draftResponse = await request.get(`${apiOrigin}/api/v1/store/products/${productId}`, {
    headers: { Authorization: `Bearer ${token}` },
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
  await page.getByTestId("product-price").fill(editedPrice);
  await page.getByTestId("save-product").click();
  await expect(page.getByRole("status")).toContainText("Changes saved.");

  const editResponse = await request.get(`${apiOrigin}/api/v1/store/products/${productId}`, {
    headers: { Authorization: `Bearer ${token}` },
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
    headers: { Authorization: `Bearer ${token}` },
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
