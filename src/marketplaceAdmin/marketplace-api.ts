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
  /** Exact base-10 integer string in the currency's minor unit. */
  priceMinor: string;
  currency: string;
  providerId: string;
  productTypeId?: string | null;
  status: PlatformProductStatus;
}

export interface CreateProductRequest {
  storeCategoryCode: string;
  title: string;
  description?: string;
  /** Exact base-10 integer string in the currency's minor unit. */
  priceMinor: string;
  currency: string;
  productTypeId?: string;
}

export interface UpdateProductRequest {
  title: string;
  description?: string;
  /** Exact base-10 integer string in the currency's minor unit. */
  priceMinor: string;
}

type GraphQlError = {
  message: string;
  extensions?: { code?: string; classification?: string };
};

type GraphQlEnvelope<T> = {
  data?: T;
  errors?: GraphQlError[];
};

declare global {
  interface Window {
    /** Injected only by the isolated Playwright build. Never persisted in storage. */
    __MARKETPLACE_E2E_ACCESS_TOKEN__?: string;
  }
}

const GRAPHQL_URL = import.meta.env.VITE_MARKETPLACE_GRAPHQL_URL || "/graphql";
const E2E_MODE = import.meta.env.VITE_MARKETPLACE_E2E_MODE === "true";

async function graphQl<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const headers = new Headers({ Accept: "application/json", "Content-Type": "application/json" });

  // Production deployment uses the authenticated edge/BFF and its server-side TokenRelay.
  // A transient bearer is accepted only for a dedicated, isolated Playwright build.
  const testToken = E2E_MODE ? window.__MARKETPLACE_E2E_ACCESS_TOKEN__ : undefined;
  if (testToken) headers.set("Authorization", `Bearer ${testToken}`);

  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers,
    credentials: "same-origin",
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const envelope = (await response.json()) as GraphQlEnvelope<T>;
  if (envelope.errors?.length) {
    throw new Error(envelope.errors.map(error => error.message).join("; "));
  }
  if (envelope.data === undefined) {
    throw new Error("GraphQL returned neither data nor a classified error.");
  }
  return envelope.data;
}

const productFields = `
  id storeCategoryCode title description priceMinor currency providerId productTypeId status
`;

export const marketplaceApi = {
  async listProducts(): Promise<PlatformProduct[]> {
    const data = await graphQl<{
      storeProducts: { edges: Array<{ node: PlatformProduct }> };
    }>(`
      query StoreProductRoster {
        storeProducts(first: 50) {
          edges { node { ${productFields} } }
          pageInfo { hasNextPage endCursor }
        }
      }
    `);
    return data.storeProducts.edges.map(edge => edge.node);
  },

  async getProduct(id: string): Promise<PlatformProduct> {
    const data = await graphQl<{ storeProduct: PlatformProduct }>(`
      query ReadStoreProduct($id: ID!) {
        storeProduct(id: $id) { ${productFields} }
      }
    `, { id });
    if (!data.storeProduct) throw new Error("GraphQL did not return the requested owned product.");
    return data.storeProduct;
  },

  listProductTypes: async (): Promise<PlatformProductType[]> => {
    const data = await graphQl<{ storeProductTypes: PlatformProductType[] }>(`
      query StoreProductTypes {
        storeProductTypes { id code nameEn nameAr description }
      }
    `);
    return data.storeProductTypes;
  },

  createProduct: async (input: CreateProductRequest): Promise<PlatformProduct> => {
    const data = await graphQl<{ createStoreProduct: PlatformProduct }>(`
      mutation CreateStoreProduct($input: StoreProductCreateInput!) {
        createStoreProduct(input: $input) { ${productFields} }
      }
    `, { input });
    return data.createStoreProduct;
  },

  updateProduct: async (id: string, input: UpdateProductRequest): Promise<PlatformProduct> => {
    const data = await graphQl<{ updateStoreProduct: PlatformProduct }>(`
      mutation UpdateStoreProduct($id: ID!, $input: StoreProductUpdateInput!) {
        updateStoreProduct(id: $id, input: $input) { ${productFields} }
      }
    `, { id, input });
    return data.updateStoreProduct;
  },

  publishProduct: async (id: string): Promise<PlatformProduct> => {
    const data = await graphQl<{ publishStoreProduct: PlatformProduct }>(`
      mutation PublishStoreProduct($id: ID!) {
        publishStoreProduct(id: $id) { ${productFields} }
      }
    `, { id });
    return data.publishStoreProduct;
  },
};
