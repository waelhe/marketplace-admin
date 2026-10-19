/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MARKETPLACE_ADMIN_MODE?: string;
  readonly VITE_MARKETPLACE_API_BASE_URL?: string;
  readonly VITE_MARKETPLACE_E2E_MODE?: string;
  readonly VITE_MARKETPLACE_DEFAULT_CATEGORY_CODE?: string;
  readonly VITE_MARKETPLACE_E2E_PRODUCT_TYPE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
