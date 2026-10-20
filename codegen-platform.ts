import { existsSync } from "node:fs";
import { type CodegenConfig } from "@graphql-codegen/cli";

const output = existsSync("./dashboard-overlay")
  ? "./dashboard-overlay/generated/platform-operations.ts"
  : "./src/marketplaceAdmin/generated/platform-operations.ts";

const config: CodegenConfig = {
  schema: ["./platform-contracts/generated-schema.graphqls"],
  documents: ["./platform-operations/**/*.graphql"],
  generates: {
    [output]: {
      plugins: ["typescript", "typescript-operations", "typed-document-node"],
      config: {
        useTypeImports: true,
        avoidOptionals: false,
        nonOptionalTypename: false,
        enumsAsTypes: false,
      },
    },
  },
};

export default config;
