export type PlatformProductStatus = "DRAFT" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";
export type PlatformVariantStatus = "ACTIVE" | "SUSPENDED" | "ARCHIVED";
export type PlatformAttributeValueType = "TEXT" | "NUMBER" | "BOOLEAN" | "CHOICE";
export type PlatformAttributeScope = "PRODUCT" | "VARIANT" | "VARIANT_SELECTION";

export interface PlatformAttributeOption {
  id: string;
  code: string;
  nameEn?: string | null;
  nameAr?: string | null;
  position: number;
}

export interface PlatformProductTypeAttribute {
  assignmentId: string;
  attributeDefinitionId: string;
  code: string;
  nameEn?: string | null;
  nameAr?: string | null;
  valueType: PlatformAttributeValueType;
  scope: PlatformAttributeScope;
  required: boolean;
  position: number;
  options: PlatformAttributeOption[];
}

export interface PlatformProductType {
  id: string;
  code: string;
  nameEn?: string | null;
  nameAr?: string | null;
  description?: string | null;
  attributes: PlatformProductTypeAttribute[];
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

export interface PlatformAttributeValue {
  assignmentId: string;
  textValue?: string | null;
  numberValue?: string | null;
  booleanValue?: boolean | null;
  optionId?: string | null;
}

export interface PlatformProductVariant {
  id: string;
  productId: string;
  sku: string;
  name?: string | null;
  /** Exact base-10 integer string in the currency's minor unit. */
  priceMinor: string;
  currency: string;
  providerId: string;
  status: PlatformVariantStatus;
  stockQuantity: number;
  reservedQuantity: number;
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

export interface CreateProductVariantRequest {
  sku: string;
  name?: string;
  priceMinor: string;
  attributeValues: PlatformAttributeValue[];
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

const attributeValueFields = `
  assignmentId textValue numberValue booleanValue optionId
`;

const variantFields = `
  id productId sku name priceMinor currency providerId status stockQuantity reservedQuantity
`;

const productTypeFields = `
  id code nameEn nameAr description
  attributes {
    assignmentId attributeDefinitionId code nameEn nameAr valueType scope required position
    options { id code nameEn nameAr position }
  }
`;

export const marketplaceApi = {
  async listProducts(): Promise<PlatformProduct[]> {
    const products: PlatformProduct[] = [];
    let after: string | null = null;
    const maxPages = 100;
    for (let page = 0; page < maxPages; page++) {
      const data = await graphQl<{
        storeProducts: {
          edges: Array<{ node: PlatformProduct }>;
          pageInfo: { hasNextPage: boolean; endCursor?: string | null };
        };
      }>(`
        query StoreProductRoster($first: Int, $after: String) {
          storeProducts(first: $first, after: $after) {
            edges { node { ${productFields} } }
            pageInfo { hasNextPage endCursor }
          }
        }
      `, { first: 50, after });
      products.push(...data.storeProducts.edges.map(edge => edge.node));
      const pageInfo = data.storeProducts.pageInfo;
      if (!pageInfo.hasNextPage) return products;
      if (!pageInfo.endCursor || pageInfo.endCursor === after) {
        throw new Error("GraphQL product pagination returned no advancing endCursor.");
      }
      after = pageInfo.endCursor;
    }
    throw new Error("Product roster exceeds the 5,000-item administration safety bound.");
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
        storeProductTypes { ${productTypeFields} }
      }
    `);
    return data.storeProductTypes;
  },

  listProductAttributeValues: async (productId: string): Promise<PlatformAttributeValue[]> => {
    const data = await graphQl<{ storeProductAttributeValues: PlatformAttributeValue[] }>(`
      query StoreProductAttributeValues($productId: ID!) {
        storeProductAttributeValues(productId: $productId) { ${attributeValueFields} }
      }
    `, { productId });
    return data.storeProductAttributeValues;
  },

  replaceProductAttributeValues: async (
    id: string,
    values: PlatformAttributeValue[],
  ): Promise<PlatformAttributeValue[]> => {
    const data = await graphQl<{ replaceStoreProductAttributes: PlatformAttributeValue[] }>(`
      mutation ReplaceStoreProductAttributes($id: ID!, $values: [StoreProductAttributeValueInput!]!) {
        replaceStoreProductAttributes(id: $id, values: $values) { ${attributeValueFields} }
      }
    `, { id, values });
    return data.replaceStoreProductAttributes;
  },

  listProductVariants: async (productId: string): Promise<PlatformProductVariant[]> => {
    const data = await graphQl<{ storeProductVariants: PlatformProductVariant[] }>(`
      query StoreProductVariants($productId: ID!) {
        storeProductVariants(productId: $productId) { ${variantFields} }
      }
    `, { productId });
    return data.storeProductVariants;
  },

  listVariantAttributeValues: async (variantId: string): Promise<PlatformAttributeValue[]> => {
    const data = await graphQl<{ storeProductVariantAttributeValues: PlatformAttributeValue[] }>(`
      query StoreProductVariantAttributeValues($variantId: ID!) {
        storeProductVariantAttributeValues(variantId: $variantId) { ${attributeValueFields} }
      }
    `, { variantId });
    return data.storeProductVariantAttributeValues;
  },

  createProductVariant: async (
    productId: string,
    input: CreateProductVariantRequest,
  ): Promise<PlatformProductVariant> => {
    const data = await graphQl<{ createStoreProductVariant: PlatformProductVariant }>(`
      mutation CreateStoreProductVariant($productId: ID!, $input: StoreProductVariantCreateInput!) {
        createStoreProductVariant(productId: $productId, input: $input) { ${variantFields} }
      }
    `, { productId, input });
    return data.createStoreProductVariant;
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
    `);
    return data.publishStoreProduct;
  },
};
