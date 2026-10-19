import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import {
  marketplaceApi,
  type PlatformAttributeValue,
  type PlatformProduct,
  type PlatformProductType,
  type PlatformProductTypeAttribute,
  type PlatformProductVariant,
} from "./marketplace-api";
import "./marketplace-admin.css";

type EditorValues = {
  storeCategoryCode: string;
  title: string;
  description: string;
  price: string;
  currency: string;
  productTypeId: string;
};

const emptyEditor: EditorValues = {
  storeCategoryCode: import.meta.env.VITE_MARKETPLACE_DEFAULT_CATEGORY_CODE || "",
  title: "",
  description: "",
  price: "",
  currency: "SAR",
  productTypeId: import.meta.env.VITE_MARKETPLACE_E2E_PRODUCT_TYPE_ID || "",
};

function currencyFractionDigits(currency: string): number {
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    return typeof digits === "number" ? digits : 2;
  } catch {
    return 2;
  }
}

function decimalToMinor(value: string, currency: string): string {
  const digits = currencyFractionDigits(currency);
  const normalized = value.trim();
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]*))?$/.exec(normalized);
  if (!match) throw new Error("Enter a non-negative decimal amount.");
  const fraction = match[2] || "";
  if (fraction.length > digits) {
    throw new Error(`This currency accepts at most ${digits} fractional digit(s).`);
  }
  const factor = 10n ** BigInt(digits);
  const fractionalMinor = digits === 0 ? 0n : BigInt(fraction.padEnd(digits, "0") || "0");
  return (BigInt(match[1]) * factor + fractionalMinor).toString();
}

function minorToDecimal(minorValue: string, currency: string): string {
  const digits = currencyFractionDigits(currency);
  const factor = 10n ** BigInt(digits);
  const minor = BigInt(minorValue);
  const whole = minor / factor;
  if (digits === 0) return whole.toString();
  const fraction = (minor % factor).toString().padStart(digits, "0");
  return `${whole}.${fraction}`;
}

function formatPrice(minor: string, currency: string): string {
  const decimal = minorToDecimal(minor, currency);
  const [whole, fraction] = decimal.split(".");
  const groupedWhole = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(BigInt(whole));
  return fraction === undefined ? `${currency} ${groupedWhole}` : `${currency} ${groupedWhole}.${fraction}`;
}

const productTypeLabel = (type: PlatformProductType) =>
  type.nameEn || type.nameAr || type.code;

function valuesToMap(values: PlatformAttributeValue[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const value of values) {
    if (value.textValue != null) result[value.assignmentId] = value.textValue;
    else if (value.numberValue != null) result[value.assignmentId] = value.numberValue;
    else if (value.booleanValue != null) result[value.assignmentId] = String(value.booleanValue);
    else if (value.optionId != null) result[value.assignmentId] = value.optionId;
  }
  return result;
}

function valuesFromMap(
  attributes: PlatformProductTypeAttribute[],
  values: Record<string, string>,
): PlatformAttributeValue[] {
  return attributes.flatMap(attribute => {
    const value = values[attribute.assignmentId];
    if (value === undefined || value === "") return [];
    const base = { assignmentId: attribute.assignmentId };
    switch (attribute.valueType) {
      case "TEXT": return [{ ...base, textValue: value }];
      case "NUMBER": return [{ ...base, numberValue: value }];
      case "BOOLEAN": return [{ ...base, booleanValue: value === "true" }];
      case "CHOICE": return [{ ...base, optionId: value }];
    }
  });
}

type TypedAttributeFieldsProps = {
  attributes: PlatformProductTypeAttribute[];
  values: Record<string, string>;
  onChange: (assignmentId: string, value: string) => void;
  testIdPrefix: string;
};

function TypedAttributeFields({ attributes, values, onChange, testIdPrefix }: TypedAttributeFieldsProps) {
  if (attributes.length === 0) return null;
  return (
    <div className="ma-typed-fields">
      {attributes.map(attribute => {
        const label = attribute.nameEn || attribute.nameAr || attribute.code;
        const fieldId = `${testIdPrefix}-attribute-${attribute.assignmentId}`;
        const required = attribute.required || attribute.scope === "VARIANT_SELECTION";
        return (
          <label key={attribute.assignmentId}>
            {label}{required ? " *" : ""}
            {attribute.valueType === "CHOICE" ? (
              <select data-testid={fieldId} value={values[attribute.assignmentId] || ""}
                onChange={event => onChange(attribute.assignmentId, event.target.value)} required={required}>
                <option value="">Choose {label.toLowerCase()}</option>
                {attribute.options.map(option => (
                  <option key={option.id} value={option.id}>{option.nameEn || option.nameAr || option.code}</option>
                ))}
              </select>
            ) : attribute.valueType === "BOOLEAN" ? (
              <select data-testid={fieldId} value={values[attribute.assignmentId] || ""}
                onChange={event => onChange(attribute.assignmentId, event.target.value)} required={required}>
                <option value="">Choose yes or no</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : attribute.valueType === "NUMBER" ? (
              <input data-testid={fieldId} type="number" step="any" value={values[attribute.assignmentId] || ""}
                onChange={event => onChange(attribute.assignmentId, event.target.value)} required={required} />
            ) : (
              <input data-testid={fieldId} value={values[attribute.assignmentId] || ""}
                onChange={event => onChange(attribute.assignmentId, event.target.value)}
                required={required} maxLength={4000} />
            )}
          </label>
        );
      })}
    </div>
  );
}

function explainError(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.startsWith("401")) {
      return "Sign in through the platform's authenticated edge before managing products.";
    }
    if (error.message.startsWith("403")) {
      return "Your current account does not have permission to manage these products.";
    }
    return error.message;
  }
  return "The request failed for an unknown reason.";
}

export default function MarketplaceAdminApp() {
  const [products, setProducts] = useState<PlatformProduct[]>([]);
  const [productTypes, setProductTypes] = useState<PlatformProductType[]>([]);
  const [editor, setEditor] = useState<EditorValues>(emptyEditor);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [readBack, setReadBack] = useState<PlatformProduct | null>(null);
  const [productAttributeValues, setProductAttributeValues] = useState<Record<string, string>>({});
  const [variants, setVariants] = useState<PlatformProductVariant[]>([]);
  const [variantAttributeValues, setVariantAttributeValues] = useState<Record<string, string>>({});
  const [variantSku, setVariantSku] = useState("");
  const [variantName, setVariantName] = useState("");
  const [variantPrice, setVariantPrice] = useState("");

  const authenticationRequired = error?.includes("authenticated edge") ?? false;

  const selectedProductType = useMemo(
    () => productTypes.find(type => type.id === editor.productTypeId),
    [editor.productTypeId, productTypes],
  );
  const productAttributes = useMemo(
    () => (selectedProductType?.attributes || []).filter(attribute => attribute.scope === "PRODUCT"),
    [selectedProductType],
  );
  const variantAttributes = useMemo(
    () => (selectedProductType?.attributes || []).filter(
      attribute => attribute.scope === "VARIANT" || attribute.scope === "VARIANT_SELECTION",
    ),
    [selectedProductType],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextProducts, nextTypes] = await Promise.all([
        marketplaceApi.listProducts(),
        marketplaceApi.listProductTypes(),
      ]);
      setProducts(nextProducts);
      setProductTypes(nextTypes);
    } catch (cause) {
      setError(explainError(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setField = (key: keyof EditorValues, value: string) => {
    setEditor(current => ({ ...current, [key]: value }));
  };

  const resetEditor = () => {
    setEditingId(null);
    setEditor(emptyEditor);
    setReadBack(null);
    setProductAttributeValues({});
    setVariants([]);
    setVariantAttributeValues({});
    setVariantSku("");
    setVariantName("");
    setVariantPrice("");
    setError(null);
    setNotice(null);
  };

  const beginEdit = async (product: PlatformProduct) => {
    setEditingId(product.id);
    setEditor({
      storeCategoryCode: product.storeCategoryCode,
      title: product.title,
      description: product.description || "",
      price: minorToDecimal(product.priceMinor, product.currency),
      currency: product.currency,
      productTypeId: product.productTypeId || "",
    });
    setReadBack(null);
    setNotice(null);
    setError(null);
    setProductAttributeValues({});
    setVariants([]);
    setVariantAttributeValues({});
    setVariantSku("");
    setVariantName("");
    setVariantPrice("");
    try {
      const [attributeValues, nextVariants] = await Promise.all([
        marketplaceApi.listProductAttributeValues(product.id),
        marketplaceApi.listProductVariants(product.id),
      ]);
      setProductAttributeValues(valuesToMap(attributeValues));
      setVariants(nextVariants);
    } catch (cause) {
      setError(explainError(cause));
    }
    document.getElementById("platform-product-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const setProductAttributeValue = (assignmentId: string, value: string) => {
    setProductAttributeValues(current => ({ ...current, [assignmentId]: value }));
  };

  const setVariantAttributeValue = (assignmentId: string, value: string) => {
    setVariantAttributeValues(current => ({ ...current, [assignmentId]: value }));
  };

  const saveProductAttributes = async () => {
    if (!editingId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await marketplaceApi.replaceProductAttributeValues(
        editingId,
        valuesFromMap(productAttributes, productAttributeValues),
      );
      setProductAttributeValues(valuesToMap(saved));
      setNotice("Product attributes saved and read back through GraphQL.");
    } catch (cause) {
      setError(explainError(cause));
    } finally {
      setSaving(false);
    }
  };

  const createVariant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const created = await marketplaceApi.createProductVariant(editingId, {
        sku: variantSku.trim(),
        name: variantName.trim() || undefined,
        priceMinor: decimalToMinor(variantPrice, editor.currency.toUpperCase()),
        attributeValues: valuesFromMap(variantAttributes, variantAttributeValues),
      });
      const persistedValues = await marketplaceApi.listVariantAttributeValues(created.id);
      setVariants(current => [...current, created].sort((left, right) => left.sku.localeCompare(right.sku)));
      setVariantAttributeValues({});
      setVariantSku("");
      setVariantName("");
      setVariantPrice("");
      setNotice(
        `Variant ${created.sku} created through GraphQL; ${persistedValues.length} typed attribute value(s) read back.`,
      );
    } catch (cause) {
      setError(explainError(cause));
    } finally {
      setSaving(false);
    }
  };

  const saveDraftOrChanges = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    setReadBack(null);
    try {
      const priceMinor = decimalToMinor(editor.price, editor.currency.toUpperCase());

      if (editingId) {
        await marketplaceApi.updateProduct(editingId, {
          title: editor.title.trim(),
          description: editor.description.trim() || undefined,
          priceMinor,
        });
        setNotice("Changes saved.");
      } else {
        const created = await marketplaceApi.createProduct({
          storeCategoryCode: editor.storeCategoryCode.trim(),
          title: editor.title.trim(),
          description: editor.description.trim() || undefined,
          priceMinor,
          currency: editor.currency.trim().toUpperCase(),
          ...(editor.productTypeId ? { productTypeId: editor.productTypeId } : {}),
        });
        setEditingId(created.id);
        setProductAttributeValues({});
        setVariants([]);
        setVariantAttributeValues({});
        setVariantSku("");
        setVariantName("");
        setVariantPrice("");
        setNotice(`Draft created: ${created.id}`);
      }

      await refresh();
    } catch (cause) {
      setError(explainError(cause));
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (!editingId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    setReadBack(null);
    try {
      const published = await marketplaceApi.publishProduct(editingId);
      if (published.status !== "ACTIVE") {
        throw new Error(`The API returned publish status ${published.status}; expected ACTIVE.`);
      }
      const persisted = await marketplaceApi.getProduct(editingId);
      if (
        persisted.id !== published.id ||
        persisted.status !== "ACTIVE" ||
        persisted.title !== editor.title.trim() ||
        persisted.priceMinor !== decimalToMinor(editor.price, editor.currency.toUpperCase())
      ) {
        throw new Error("Read-back did not match the published product fields.");
      }
      setReadBack(persisted);
      setNotice("Product published and verified by reading the saved record back from Spring.");
      await refresh();
    } catch (cause) {
      setError(explainError(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="marketplace-admin" data-testid="marketplace-admin-app">
      <header className="marketplace-admin__header">
        <div>
          <p className="marketplace-admin__eyebrow">PLATFORM OPERATIONS</p>
          <h1>Marketplace catalog</h1>
          <p className="marketplace-admin__subtitle">
            Create a product draft, edit it, publish it, then verify the persisted record from Spring.
          </p>
        </div>
        <div className="marketplace-admin__header-actions">
          <a className="ma-button ma-button--secondary" href="/">Back to Dashboard</a>
          <button className="ma-button ma-button--secondary" type="button" onClick={() => void refresh()} disabled={loading}>
            Refresh list
          </button>
        </div>
      </header>

      {error && (
        <div className="ma-alert ma-alert--error" role="alert">
          <span>{error}</span>{" "}
          {authenticationRequired && <a className="ma-alert__signin" href="/oauth2/authorization/marketplace-web-client">Sign in</a>}
        </div>
      )}
      {notice && <div className="ma-alert ma-alert--success" role="status">{notice}</div>}

      <section className="ma-panel" aria-labelledby="products-title">
        <div className="ma-panel__heading">
          <div>
            <h2 id="products-title">Your products</h2>
            <p>Records are read from the platform API. Select a row to edit or publish.</p>
          </div>
          <span className="ma-count">{products.length} records</span>
        </div>
        {loading ? (
          <p className="ma-state">Loading products from the platform…</p>
        ) : products.length === 0 ? (
          <p className="ma-state" data-testid="empty-products">No products returned for this account.</p>
        ) : (
          <div className="ma-table-wrap">
            <table className="ma-table">
              <thead>
                <tr><th>Product</th><th>Type</th><th>Price</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {products.map(product => (
                  <tr key={product.id} data-testid={`product-row-${product.id}`}>
                    <td>
                      <strong>{product.title}</strong>
                      <small>{product.id}</small>
                    </td>
                    <td>{productTypes.find(type => type.id === product.productTypeId)?.code || "Legacy / untyped"}</td>
                    <td>{formatPrice(product.priceMinor, product.currency)}</td>
                    <td><span className={`ma-status ma-status--${product.status.toLowerCase()}`}>{product.status}</span></td>
                    <td><button className="ma-link" type="button" onClick={() => beginEdit(product)}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section id="platform-product-editor" className="ma-panel" aria-labelledby="editor-title">
        <div className="ma-panel__heading">
          <div>
            <h2 id="editor-title">{editingId ? "Edit product" : "Create product draft"}</h2>
            <p>{editingId ? `Product ID: ${editingId}` : "A typed product is created as a draft and must be explicitly published."}</p>
          </div>
          {editingId && <button className="ma-button ma-button--secondary" type="button" onClick={resetEditor}>New product</button>}
        </div>

        <form onSubmit={saveDraftOrChanges} className="ma-form" data-testid="product-editor">
          {!editingId && (
            <>
              <label>
                Store category code
                <input
                  data-testid="category-code"
                  name="storeCategoryCode"
                  value={editor.storeCategoryCode}
                  onChange={event => setField("storeCategoryCode", event.target.value)}
                  placeholder="An existing platform category code"
                  required
                  maxLength={50}
                />
              </label>
              <label>
                Product type
                <select
                  data-testid="product-type"
                  name="productTypeId"
                  value={editor.productTypeId}
                  onChange={event => setField("productTypeId", event.target.value)}
                  required
                >
                  
                  {productTypes.map(type => (
                    <option key={type.id} value={type.id}>{productTypeLabel(type)} ({type.code})</option>
                  ))}
                </select>
                <small>Choose a ProductType to create a draft. ProductType attribute and variant editing will be separate typed GraphQL journeys.</small>
              </label>
              {selectedProductType && (
                <p className="ma-inline-note" data-testid="selected-product-type">
                  Selected: {selectedProductType.code}. Required values are validated by Spring during publication.
                </p>
              )}
            </>
          )}

          <div className="ma-form__grid">
            <label>
              Product title
              <input data-testid="product-title" name="title" value={editor.title} onChange={event => setField("title", event.target.value)} required maxLength={200} />
            </label>
            <label>
              Price
              <input data-testid="product-price" name="price" type="number" min="0" step={10 ** -currencyFractionDigits(editor.currency.toUpperCase())} value={editor.price} onChange={event => setField("price", event.target.value)} required />
            </label>
          </div>
          <label>
            Description
            <textarea data-testid="product-description" name="description" value={editor.description} onChange={event => setField("description", event.target.value)} rows={3} maxLength={2000} />
          </label>
          {!editingId && (
            <label>
              Currency (ISO 4217)
              <input data-testid="product-currency" name="currency" value={editor.currency} onChange={event => setField("currency", event.target.value)} required minLength={3} maxLength={3} />
            </label>
          )}
          <div className="ma-form__actions">
            <button data-testid="save-product" className="ma-button ma-button--primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Create draft"}
            </button>
            {editingId && (
              <button data-testid="publish-product" className="ma-button ma-button--publish" type="button" onClick={() => void publish()} disabled={saving}>
                {saving ? "Working…" : "Publish and verify"}
              </button>
            )}
          </div>
        </form>

        {readBack && (
          <section className="ma-readback" data-testid="published-readback" aria-label="Verified API read-back">
            <div className="ma-readback__check" aria-hidden="true">✓</div>
            <div>
              <h3>Published record verified</h3>
              <p>The follow-up GET returned the saved product with ACTIVE status.</p>
              <dl>
                <dt>Product ID</dt><dd data-testid="readback-id">{readBack.id}</dd>
                <dt>Title</dt><dd data-testid="readback-title">{readBack.title}</dd>
                <dt>Price (minor units)</dt><dd data-testid="readback-price">{readBack.priceMinor}</dd>
                <dt>Status</dt><dd data-testid="readback-status">{readBack.status}</dd>
              </dl>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
