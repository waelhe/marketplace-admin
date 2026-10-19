import {
  CreateStoreProductDocument,
  CreateStoreProductVariantDocument,
  PublishStoreProductDocument,
  ReadStoreProductDocument,
  ReplaceStoreProductAttributesDocument,
  StoreProductAttributeValuesDocument,
  StoreProductRosterDocument,
  StoreProductTypesDocument,
  StoreProductVariantAttributeValuesDocument,
  StoreProductVariantsDocument,
  UpdateStoreProductDocument,
} from "./generated/platform-operations";

import { print } from "graphql";
import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import type {
  StoreProduct,
  StoreProductAttributeScope,
  StoreProductAttributeValue,
  StoreProductAttributeValueInput,
  StoreProductAttributeValueType,
  StoreProductAttributeOption,
  StoreProductCreateInput,
  StoreProductType,
  StoreProductTypeAttribute,
  StoreProductUpdateInput,
  StoreProductVariant,
  StoreProductVariantCreateInput,
  StoreProductVariantStatus,
  StoreProductStatus,
} from "./generated/platform-operations";

// Domain-facing names remain aliases of generated SDL types, not handwritten wire models.
export type PlatformProductStatus = StoreProductStatus;
export type PlatformVariantStatus = StoreProductVariantStatus;
export type PlatformAttributeValueType = StoreProductAttributeValueType;
export type PlatformAttributeScope = StoreProductAttributeScope;
export type PlatformAttributeOption = StoreProductAttributeOption;
export type PlatformProductTypeAttribute = StoreProductTypeAttribute;
export type PlatformProductType = StoreProductType;
export type PlatformProduct = StoreProduct;
export type PlatformAttributeValue = StoreProductAttributeValue;
export type PlatformAttributeValueInput = StoreProductAttributeValueInput;
export type PlatformProductVariant = StoreProductVariant;
export type CreateProductRequest = StoreProductCreateInput;
export type UpdateProductRequest = StoreProductUpdateInput;
export type CreateProductVariantRequest = StoreProductVariantCreateInput;

type GraphQlError = {
  message: string;
  extensions?: { code?: string; classification?: string };
};

type GraphQlEnvelope<TData> = {
  data?: TData | null;
  errors?: GraphQlError[];
};

declare global {
  interface Window {
    /** Injected only by an E2E-only build. Production uses the authenticated edge/BFF. */
    __MARKETPLACE_E2E_ACCESS_TOKEN__?: string;
  }
}

const GRAPHQL_URL = import.meta.env.VITE_MARKETPLACE_GRAPHQL_URL || "/graphql";
const E2E_MODE = import.meta.env.VITE_MARKETPLACE_E2E_MODE === "true";

async function graphQl<TData, TVariables>(
  document: TypedDocumentNode<TData, TVariables>,
  variables?: TVariables,
): Promise<TData> {
  const headers = new Headers({ Accept: "application/json", "Content-Type": "application/json" });

  // Production deployment uses the authenticated edge/BFF and its server-side TokenRelay.
  // A transient bearer is accepted only for a dedicated, isolated Playwright build.
  const testToken = E2E_MODE ? window.__MARKETPLACE_E2E_ACCESS_TOKEN__ : undefined;
  if (testToken) headers.set("Authorization", `Bearer ${testToken}`);

  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers,
    credentials: "same-origin",
    body: JSON.stringify({ query: print(document), variables: variables ?? {} }),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const envelope = (await response.json()) as GraphQlEnvelope<TData>;
  if (envelope.errors?.length) {
    throw new Error(envelope.errors.map(error => error.message).join("; "));
  }
  if (envelope.data == null) {
    throw new Error("GraphQL returned neither data nor a classified error.");
  }
  return envelope.data;
}

export const marketplaceApi = {
  async listProducts(): Promise<PlatformProduct[]> {
    const products: PlatformProduct[] = [];
    let after: string | null = null;
    const maxPages = 100;

    for (let page = 0; page < maxPages; page++) {
      const data = await graphQl(StoreProductRosterDocument, { first: 50, after });
      const edges = data.storeProducts.edges ?? [];
      for (const edge of edges) {
        if (edge?.node) products.push(edge.node);
      }
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
    const data = await graphQl(ReadStoreProductDocument, { id });
    if (!data.storeProduct) throw new Error("GraphQL did not return the requested owned product.");
    return data.storeProduct;
  },

  async listProductTypes(): Promise<PlatformProductType[]> {
    const data = await graphQl(StoreProductTypesDocument);
    return data.storeProductTypes;
  },

  async listProductAttributeValues(productId: string): Promise<PlatformAttributeValue[]> {
    const data = await graphQl(StoreProductAttributeValuesDocument, { productId });
    return data.storeProductAttributeValues;
  },

  async replaceProductAttributeValues(
    id: string,
    values: PlatformAttributeValueInput[],
  ): Promise<PlatformAttributeValue[]> {
    const data = await graphQl(ReplaceStoreProductAttributesDocument, { id, values });
    return data.replaceStoreProductAttributes;
  },

  async listProductVariants(productId: string): Promise<PlatformProductVariant[]> {
    const data = await graphQl(StoreProductVariantsDocument, { productId });
    return data.storeProductVariants;
  },

  async listVariantAttributeValues(variantId: string): Promise<PlatformAttributeValue[]> {
    const data = await graphQl(StoreProductVariantAttributeValuesDocument, { variantId });
    return data.storeProductVariantAttributeValues;
  },

  async createProductVariant(
    productId: string,
    input: CreateProductVariantRequest,
  ): Promise<PlatformProductVariant> {
    const data = await graphQl(CreateStoreProductVariantDocument, { productId, input });
    return data.createStoreProductVariant;
  },

  async createProduct(input: CreateProductRequest): Promise<PlatformProduct> {
    const data = await graphQl(CreateStoreProductDocument, { input });
    return data.createStoreProduct;
  },

  async updateProduct(id: string, input: UpdateProductRequest): Promise<PlatformProduct> {
    const data = await graphQl(UpdateStoreProductDocument, { id, input });
    return data.updateStoreProduct;
  },

  async publishProduct(id: string): Promise<PlatformProduct> {
    const data = await graphQl(PublishStoreProductDocument, { id });
    return data.publishStoreProduct;
  },
};
