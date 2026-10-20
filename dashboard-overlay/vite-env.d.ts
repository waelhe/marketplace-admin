// Ambient augmentation kept as a script so Saleor's own `declare module` remains an ambient declaration.
interface ImportMetaEnv {
  readonly VITE_MARKETPLACE_ADMIN_MODE?: string;
  readonly VITE_MARKETPLACE_GRAPHQL_URL?: string;
  readonly VITE_MARKETPLACE_E2E_MODE?: string;
  readonly VITE_MARKETPLACE_DEFAULT_CATEGORY_CODE?: string;
  readonly VITE_MARKETPLACE_E2E_PRODUCT_TYPE_ID?: string;
}
