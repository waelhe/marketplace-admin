export type PlatformProductStatus = "DRAFT" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";

export interface PlatformProductType {
  id: string;
  code: string;
  nameEn?: string | null;
  nameAr?: string | null;
  description?: string | null;
}

export interface PlatformProduct {
  id: string;
  storeCategoryCode: string;
  title: string;
  description?: string | null;
  priceMinor: number;
  currency: string;
  providerId?: string;
  productTypeId?: string | null;
  status: PlatformProductStatus;
}

export interface CreateProductRequest {
  storeCategoryCode: string;
  title: string;
  description?: string;
  priceMinor: number;
  currency: string;
  productTypeId?: string;
  attributeValues: [];
}

export interface UpdateProductRequest {
  title: string;
  description?: string;
  priceMinor: number;
}

declare global {
  interface Window {
    /** Injected by Playwright only when VITE_MARKETPLACE_E2E_MODE=true. */
    __MARKETPLACE_E2E_ACCESS_TOKEN__?: string;
  }
}

const API_BASE = (import.meta.env.VITE_MARKETPLACE_API_BASE_URL || "/api/v1").replace(/\/$/, "");
const E2E_MODE = import.meta.env.VITE_MARKETPLACE_E2E_MODE === "true";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined) headers.set("Content-Type", "application/json");

  // Production deployment uses the authenticated edge/BFF and its server-side TokenRelay.
  // A bearer token is accepted only in the isolated Playwright build; no token is persisted.
  const testToken = E2E_MODE ? window.__MARKETPLACE_E2E_ACCESS_TOKEN__ : undefined;
  if (testToken) headers.set("Authorization", `Bearer ${testToken}`);

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object") {
        const record = body as Record<string, unknown>;
        detail = String(record.detail ?? record.message ?? record.title ?? "");
      }
    } catch {
      // Some error responses have no JSON body; keep the status diagnostic.
    }
    throw new Error(`${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const marketplaceApi = {
  listProducts: () => request<PlatformProduct[]>("/store/products"),
  getProduct: (id: string) => request<PlatformProduct>(`/store/products/${encodeURIComponent(id)}`),
  listProductTypes: () => request<PlatformProductType[]>("/store/product-types"),
  createProduct: (body: CreateProductRequest) =>
    request<PlatformProduct>("/store/products", { method: "POST", body: JSON.stringify(body) }),
  updateProduct: (id: string, body: UpdateProductRequest) =>
    request<PlatformProduct>(`/store/products/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  publishProduct: (id: string) =>
    request<PlatformProduct>(`/store/products/${encodeURIComponent(id)}/publish`, { method: "POST" }),
};
