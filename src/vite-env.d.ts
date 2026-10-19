/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly VITE_DISABLE_STRICT_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*/vite.config.js" {
  const content: any;
  // eslint-disable-next-line import/no-default-export
  export default content;
}


// Types for the independently maintained platform-admin overlay.
// Ambient augmentation kept as a script so Saleor's own `declare module` remains an ambient declaration.
interface ImportMetaEnv {
  readonly VITE_MARKETPLACE_ADMIN_MODE?: string;
  readonly VITE_MARKETPLACE_API_BASE_URL?: string;
  readonly VITE_MARKETPLACE_E2E_MODE?: string;
  readonly VITE_MARKETPLACE_DEFAULT_CATEGORY_CODE?: string;
  readonly VITE_MARKETPLACE_E2E_PRODUCT_TYPE_ID?: string;
}

