import storeProductRosterDocument from "@platform-operations/store-product-roster.graphql?raw";
import readStoreProductDocument from "@platform-operations/read-store-product.graphql?raw";
import storeProductTypesDocument from "@platform-operations/store-product-types.graphql?raw";
import storeProductAttributeValuesDocument from "@platform-operations/store-product-attribute-values.graphql?raw";
import replaceStoreProductAttributesDocument from "@platform-operations/replace-store-product-attributes.graphql?raw";
import storeProductVariantsDocument from "@platform-operations/store-product-variants.graphql?raw";
import storeProductVariantAttributeValuesDocument from "@platform-operations/store-product-variant-attribute-values.graphql?raw";
import createStoreProductVariantDocument from "@platform-operations/create-store-product-variant.graphql?raw";
import createStoreProductDocument from "@platform-operations/create-store-product.graphql?raw";
import updateStoreProductDocument from "@platform-operations/update-store-product.graphql?raw";
import publishStoreProductDocument from "@platform-operations/publish-store-product.graphql?raw";

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
  StoreProductRosterQuery,
  StoreProductRosterQueryVariables,
  ReadStoreProductQuery,
  ReadStoreProductQueryVariables,
  StoreProductTypesQuery,
  StoreProductAttributeValuesQuery,
  StoreProductAttributeValuesQueryVariables,
  ReplaceStoreProductAttributesMutation,
  ReplaceStoreProductAttributesMutationVariables,
  StoreProductVariantsQuery,
  StoreProductVariantsQueryVariables,
  StoreProductVariantAttributeValuesQuery,
  StoreProductVariantAttributeValuesQueryVariables,
  CreateStoreProductVariantMutation,
  CreateStoreProductVariantMutationVariables,
  CreateStoreProductMutation,
  CreateStoreProductMutationVariables,
  UpdateStoreProductMutation,
  UpdateStoreProductMutationVariables,
  PublishStoreProductMutation,
  PublishStoreProductMutationVariables,
} from "./generated/platform-operations";

// Domain-facing names are aliases of GraphQL Code Generator's SDL-derived types.
// Do not introduce parallel handwritten wire models here.
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
    /** Injected only by the isolated Playwright build. Never persisted in storage. */
    __MARKETPLACE_E2E_ACCESS_TOKEN__?: string;
  }
}

const GRAPHQL_URL = import.meta.env.VITE_MARKETPLACE_GRAPHQL_URL || "/graphql";
const E2E_MODE = import.meta.env.VITE_MARKETPLACE_E2E_MODE === "true";

async function graphQl<TData, TVariables extends object = Record<string, never>>(
  query: string,
  variables: TVariables = {} as TVariables,
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
    body: JSON.stringify({ query, variables }),
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
      const data = await graphQl<StoreProductRosterQuery, StoreProductRosterQueryVariables>(
        storeProductRosterDocument,
        { first: 50, after },
      );
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
    const data = await graphQl<ReadStoreProductQuery, ReadStoreProductQueryVariables>(
      readStoreProductDocument,
      { id },
    );
    if (!data.storeProduct) throw new Error("GraphQL did not return the requested owned product.");
    return data.storeProduct;
  },

  async listProductTypes(): Promise<PlatformProductType[]> {
    const data = await graphQl<StoreProductTypesQuery>(storeProductTypesDocument);
    return data.storeProductTypes;
  },

  async listProductAttributeValues(productId: string): Promise<PlatformAttributeValue[]> {
    const data = await graphQl<StoreProductAttributeValuesQuery, StoreProductAttributeValuesQueryVariables>(
      storeProductAttributeValuesDocument,
      { productId },
    );
    return data.storeProductAttributeValues;
  },

  async replaceProductAttributeValues(
    id: string,
    values: PlatformAttributeValueInput[],
  ): Promise<PlatformAttributeValue[]> {
    const data = await graphQl<
      ReplaceStoreProductAttributesMutation,
      ReplaceStoreProductAttributesMutationVariables
    >(replaceStoreProductAttributesDocument, { id, values });
    return data.replaceStoreProductAttributes;
  },

  async listProductVariants(productId: string): Promise<PlatformProductVariant[]> {
    const data = await graphQl<StoreProductVariantsQuery, StoreProductVariantsQueryVariables>(
      storeProductVariantsDocument,
      { productId },
    );
    return data.storeProductVariants;
  },

  async listVariantAttributeValues(variantId: string): Promise<PlatformAttributeValue[]> {
    const data = await graphQl<
      StoreProductVariantAttributeValuesQuery,
      StoreProductVariantAttributeValuesQueryVariables
    >(storeProductVariantAttributeValuesDocument, { variantId });
    return data.storeProductVariantAttributeValues;
  },

  async createProductVariant(
    productId: string,
    input: CreateProductVariantRequest,
  ): Promise<PlatformProductVariant> {
    const data = await graphQl<
      CreateStoreProductVariantMutation,
      CreateStoreProductVariantMutationVariables
    >(createStoreProductVariantDocument, { productId, input });
    return data.createStoreProductVariant;
  },

  async createProduct(input: CreateProductRequest): Promise<PlatformProduct> {
    const data = await graphQl<CreateStoreProductMutation, CreateStoreProductMutationVariables>(
      createStoreProductDocument,
      { input },
    );
    return data.createStoreProduct;
  },

  async updateProduct(id: string, input: UpdateProductRequest): Promise<PlatformProduct> {
    const data = await graphQl<UpdateStoreProductMutation, UpdateStoreProductMutationVariables>(
      updateStoreProductDocument,
      { id, input },
    );
    return data.updateStoreProduct;
  },

  async publishProduct(id: string): Promise<PlatformProduct> {
    const data = await graphQl<PublishStoreProductMutation, PublishStoreProductMutationVariables>(
      publishStoreProductDocument,
      { id },
    );
    return data.publishStoreProduct;
  },
};
