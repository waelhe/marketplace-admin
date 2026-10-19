import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import {
  marketplaceApi,
  type PlatformProduct,
  type PlatformProductType,
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

const formatPrice = (minor: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);

const productTypeLabel = (type: PlatformProductType) =>
  type.nameEn || type.nameAr || type.code;

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

  const authenticationRequired = error?.includes("authenticated edge") ?? false;

  const selectedProductType = useMemo(
    () => productTypes.find(type => type.id === editor.productTypeId),
    [editor.productTypeId, productTypes],
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
    setError(null);
    setNotice(null);
  };

  const beginEdit = (product: PlatformProduct) => {
    setEditingId(product.id);
    setEditor({
      storeCategoryCode: product.storeCategoryCode,
      title: product.title,
      description: product.description || "",
      price: (product.priceMinor / 100).toFixed(2),
      currency: product.currency,
      productTypeId: product.productTypeId || "",
    });
    setReadBack(null);
    setNotice(null);
    setError(null);
    document.getElementById("platform-product-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const saveDraftOrChanges = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    setReadBack(null);
    try {
      const price = Number(editor.price);
      if (!Number.isFinite(price) || price < 0) throw new Error("Price must be a non-negative number.");
      const priceMinor = Math.round(price * 100);

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
          attributeValues: [],
        });
        setEditingId(created.id);
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
        persisted.priceMinor !== Math.round(Number(editor.price) * 100)
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
        <button className="ma-button ma-button--secondary" type="button" onClick={() => void refresh()} disabled={loading}>
          Refresh list
        </button>
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
                Product type (optional)
                <select
                  data-testid="product-type"
                  name="productTypeId"
                  value={editor.productTypeId}
                  onChange={event => setField("productTypeId", event.target.value)}
                >
                  <option value="">Legacy / untyped product</option>
                  {productTypes.map(type => (
                    <option key={type.id} value={type.id}>{productTypeLabel(type)} ({type.code})</option>
                  ))}
                </select>
                <small>For typed publishing, choose a ProductType whose required attributes can be supplied in this workflow.</small>
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
              <input data-testid="product-price" name="price" type="number" min="0" step="0.01" value={editor.price} onChange={event => setField("price", event.target.value)} required />
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
