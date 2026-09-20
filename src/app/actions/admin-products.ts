"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  addProductImage,
  adjustStock,
  createProduct,
  deleteProductImage,
  saveVariant,
  updateProduct,
} from "@/domain/admin-products";
import {
  BULK_MAX_IDS,
  BULK_MIN_REASON,
  PERCENT_MAX,
  PERCENT_MIN,
  bulkAdjustPrices,
  bulkMoveCategory,
  bulkSetActive,
  duplicateProduct,
  previewPriceAdjustment,
} from "@/domain/admin-bulk";
import { validateProductImage } from "@/domain/product-images";
import { CLOUDINARY_PRODUCTS_FOLDER, cloudinary } from "@/lib/cloudinary";
import {
  actorLabel,
  adminActionError,
  requireOwnerSession,
  requireStaffSession,
  type AdminActionResult,
} from "@/lib/admin-guard";
import { t } from "@/i18n";

function revalidarVidriera() {
  revalidatePath("/", "layout");
}

/**
 * Alta y edición del catálogo (PLAN.md 4.6).
 *
 * Igual que en `admin-orders.ts`: **cada** acción vuelve a chequear el rol
 * antes de tocar nada. El middleware no cubre las server actions.
 */

const ProductSchema = z.object({
  productId: z.number().int().positive().optional(),
  slug: z
    .string()
    .trim()
    // El techo no es decorativo: `products.slug` es VARCHAR(160) y un slug más
    // largo se truncaba en la base, dejando dos productos distintos apuntando
    // a la misma URL (y el segundo guardado fallando por el índice único con
    // un error que no explica nada).
    .max(160, t("adminForm.slugLargo"))
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "El slug va en minúsculas y con guiones: remera-azul"),
  name: z.string().trim().min(2, t("adminForm.nombreProducto")).max(200),
  description: z.string().trim().max(5000).optional(),
  categoryId: z.number().int().positive(),
  brand: z.string().trim().max(120).optional(),
  // 10 | 5 | 0 y nada más: es la tasa que después se factura.
  ivaRate: z.union([z.literal(10), z.literal(5), z.literal(0)]),
  isActive: z.boolean(),
  published: z.boolean(),
  /**
   * Destacado de la home. Opcional a propósito: un formulario que no dibuja la
   * casilla manda `undefined` y `updateProduct` lo lee como "no tocar", así
   * que guardar el precio de un producto destacado no lo des-destaca de paso.
   * En el alta, `createProduct` lo resuelve como `false`.
   */
  isFeatured: z.boolean().optional(),
});

export async function saveProduct(
  input: unknown,
): Promise<AdminActionResult<{ productId: number }>> {
  try {
    await requireStaffSession();

    const parsed = ProductSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
    }

    const write = {
      slug: parsed.data.slug,
      name: parsed.data.name,
      description: parsed.data.description || null,
      categoryId: parsed.data.categoryId,
      brand: parsed.data.brand || null,
      ivaRate: parsed.data.ivaRate,
      isActive: parsed.data.isActive,
      published: parsed.data.published,
      isFeatured: parsed.data.isFeatured,
    };

    const productId = parsed.data.productId;
    if (productId === undefined) {
      const created = await createProduct(write);
      revalidatePath("/admin/productos");
      revalidarVidriera();
      return { ok: true, productId: created };
    }

    await updateProduct(productId, write);
    revalidatePath("/admin/productos");
    revalidatePath(`/admin/productos/${productId}`);
    revalidarVidriera();
    return { ok: true, productId };
  } catch (error) {
    return adminActionError("saveProduct", error);
  }
}

const VariantSchema = z.object({
  productId: z.number().int().positive(),
  variantId: z.number().int().positive().optional(),
  sku: z.string().trim().min(1, t("adminForm.sku")).max(64),
  label: z.string().trim().min(1, t("adminForm.etiquetaVariante")).max(120),
  // Enteros en guaraníes. Nada de decimales: el guaraní no tiene céntimos y un
  // float acá es el principio de un total que no cuadra.
  pricePyg: z.number().int(t("adminForm.precioEntero")).nonnegative(),
  compareAtPyg: z.number().int().nonnegative().nullable().optional(),
  isActive: z.boolean(),
  /**
   * Punto de reposición por variante (O6). Vacío = `null` = el umbral global.
   * El techo de 100.000 no es un número mágico: es lo que hace que un dedo
   * pesado sobre el teclado no deje una variante marcada como "stock bajo"
   * para siempre — el campo lo dibuja S10.
   */
  reorderPoint: z.number().int().nonnegative().max(100_000).nullable().optional(),
});

export async function saveProductVariant(input: unknown): Promise<AdminActionResult> {
  try {
    await requireStaffSession();

    const parsed = VariantSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
    }

    await saveVariant(parsed.data.productId, {
      id: parsed.data.variantId,
      sku: parsed.data.sku,
      label: parsed.data.label,
      pricePyg: parsed.data.pricePyg,
      compareAtPyg: parsed.data.compareAtPyg ?? null,
      isActive: parsed.data.isActive,
      reorderPoint: parsed.data.reorderPoint ?? null,
    });

    revalidatePath(`/admin/productos/${parsed.data.productId}`);
    return { ok: true };
  } catch (error) {
    return adminActionError("saveProductVariant", error);
  }
}

const AdjustSchema = z.object({
  variantId: z.number().int().positive(),
  delta: z.number().int().refine((value) => value !== 0, t("adminForm.ajusteCero")),
  // El motivo es obligatorio acá y otra vez en el dominio: este mensaje es
  // para el formulario, el del dominio es la regla real.
  reason: z.string().trim().min(4, t("adminForm.motivoAjuste")).max(300),
  productId: z.number().int().positive().optional(),
});

/** Ajuste de stock con motivo. Queda auditado en `stock_adjustments`. */
export async function adjustVariantStock(
  input: unknown,
): Promise<AdminActionResult<{ newOnHand: number }>> {
  try {
    const actor = await requireStaffSession();

    const parsed = AdjustSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
    }

    const result = await adjustStock({
      variantId: parsed.data.variantId,
      delta: parsed.data.delta,
      reason: parsed.data.reason,
      actor: actorLabel(actor),
      actorUserId: actor.userId,
    });

    if (parsed.data.productId) revalidatePath(`/admin/productos/${parsed.data.productId}`);
    revalidatePath("/admin/productos");
    revalidatePath("/admin");
    revalidarVidriera();
    return { ok: true, newOnHand: result.newOnHand };
  } catch (error) {
    return adminActionError("adjustVariantStock", error);
  }
}

/**
 * Subida de una foto de producto.
 *
 * Va a la carpeta pública `productos/` — al revés que los comprobantes, esto
 * tiene que servirse por CDN sin firmar. El tipo se valida por los bytes
 * antes de subir.
 */
export async function uploadProductImage(formData: FormData): Promise<AdminActionResult> {
  try {
    await requireStaffSession();

    const productId = Number(formData.get("productId"));
    if (!Number.isInteger(productId) || productId <= 0) {
      return { ok: false, error: t("adminError.productoInvalido") };
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return { ok: false, error: t("adminError.elegiFoto") };
    }

    const content = Buffer.from(await file.arrayBuffer());
    const { mime } = validateProductImage({ bytes: content.byteLength, content });

    const uploaded = await cloudinary.uploader.upload(
      `data:${mime};base64,${content.toString("base64")}`,
      { folder: CLOUDINARY_PRODUCTS_FOLDER, resource_type: "image", overwrite: false },
    );

    const alt = String(formData.get("alt") ?? "").trim();
    await addProductImage({
      productId,
      cloudinaryId: uploaded.public_id,
      alt: alt === "" ? null : alt.slice(0, 255),
    });

    revalidatePath(`/admin/productos/${productId}`);
    revalidarVidriera();
    return { ok: true };
  } catch (error) {
    return adminActionError("uploadProductImage", error);
  }
}

const RemoveImageSchema = z.object({
  imageId: z.number().int().positive(),
  productId: z.number().int().positive(),
});

export async function removeProductImage(input: unknown): Promise<AdminActionResult> {
  try {
    await requireStaffSession();

    const parsed = RemoveImageSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: t("adminError.imagenInvalida") };
    }

    // Se borra sólo la fila. El archivo queda en Cloudinary a propósito: si
    // la imagen está referenciada en otro lado, borrarla del CDN rompe esa
    // página, y el costo de una foto huérfana es despreciable.
    await deleteProductImage(parsed.data.imageId);

    revalidatePath(`/admin/productos/${parsed.data.productId}`);
    revalidarVidriera();
    return { ok: true };
  } catch (error) {
    return adminActionError("removeProductImage", error);
  }
}

/* ---------------------------------------------------------------------------
 * Acciones masivas y duplicar (O7, plan-operacion §5.3 B y C)
 *
 * Las tres primeras son `productos` (staff): publicar, despublicar y mover de
 * categoría es trabajo de catálogo. La de precios es **owner**, porque es la
 * única que mueve plata — ver el comentario de `precios.masivo` en
 * `permissions.ts`.
 * ------------------------------------------------------------------------- */

const BulkIdsSchema = z.object({
  productIds: z.array(z.number().int().positive()).min(1).max(BULK_MAX_IDS),
});

export async function bulkSetProductsActive(
  input: unknown,
): Promise<AdminActionResult<{ afectados: number }>> {
  try {
    await requireStaffSession();

    const parsed = BulkIdsSchema.extend({ isActive: z.boolean() }).safeParse(input);
    if (!parsed.success) return { ok: false, error: t("adminError.noEntendi.masivo") };

    const afectados = await bulkSetActive(parsed.data.productIds, parsed.data.isActive);

    revalidatePath("/admin/productos");
    revalidarVidriera();
    return { ok: true, afectados };
  } catch (error) {
    return adminActionError("bulkSetProductsActive", error);
  }
}

export async function bulkMoveProductsCategory(
  input: unknown,
): Promise<AdminActionResult<{ afectados: number }>> {
  try {
    await requireStaffSession();

    const parsed = BulkIdsSchema.extend({
      categoryId: z.number().int().positive(),
    }).safeParse(input);
    if (!parsed.success) return { ok: false, error: t("adminError.noEntendi.masivo") };

    const afectados = await bulkMoveCategory(parsed.data.productIds, parsed.data.categoryId);

    revalidatePath("/admin/productos");
    revalidarVidriera();
    return { ok: true, afectados };
  } catch (error) {
    return adminActionError("bulkMoveProductsCategory", error);
  }
}

/**
 * El porcentaje y los ids viajan; **los precios no**. Cada precio nuevo lo
 * calcula el servidor releyendo el viejo con la fila bloqueada.
 */
const BulkPriceSchema = z
  .object({
    variantIds: z.array(z.number().int().positive()).max(BULK_MAX_IDS).optional(),
    productIds: z.array(z.number().int().positive()).max(BULK_MAX_IDS).optional(),
    percent: z.number().int().min(PERCENT_MIN).max(PERCENT_MAX),
    roundTo: z.union([z.literal(100), z.literal(1000)]),
    reason: z.string().trim().min(BULK_MIN_REASON).max(500),
  })
  .refine(
    (data) => Boolean(data.variantIds?.length) !== Boolean(data.productIds?.length),
    // Una de las dos, no las dos ni ninguna: con las dos, no está claro cuál
    // gana, y "las dos" es siempre un error de quien llama.
    { message: "Elegí variantes o productos, no las dos cosas." },
  );

export async function bulkAdjustProductPrices(
  input: unknown,
): Promise<AdminActionResult<{ cambiadas: number; miradas: number; diferenciaPyg: number }>> {
  try {
    const actor = await requireOwnerSession();

    const parsed = BulkPriceSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? t("adminError.noEntendi.masivo") };
    }

    const result = await bulkAdjustPrices({
      variantIds: parsed.data.variantIds,
      productIds: parsed.data.productIds,
      percent: parsed.data.percent,
      roundTo: parsed.data.roundTo,
      reason: parsed.data.reason,
      actor: actorLabel(actor),
      actorUserId: actor.userId,
    });

    revalidatePath("/admin/productos");
    revalidarVidriera();
    return { ok: true, ...result };
  } catch (error) {
    return adminActionError("bulkAdjustProductPrices", error);
  }
}

/** La vista previa del ajuste. Owner también: muestra precios y no escribe. */
export async function previewBulkPriceAdjustment(
  input: unknown,
): Promise<
  AdminActionResult<{
    cambiadas: number;
    miradas: number;
    diferenciaPyg: number;
    ejemplos: Array<{ variantId: number; from: number; to: number }>;
  }>
> {
  try {
    await requireOwnerSession();

    const parsed = BulkPriceSchema.omit({ reason: true }).safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? t("adminError.noEntendi.masivo") };
    }

    const result = await previewPriceAdjustment({
      variantIds: parsed.data.variantIds,
      productIds: parsed.data.productIds,
      percent: parsed.data.percent,
      roundTo: parsed.data.roundTo,
    });

    return { ok: true, ...result };
  } catch (error) {
    return adminActionError("previewBulkPriceAdjustment", error);
  }
}

/**
 * Duplicar un producto. La copia nace despublicada y con stock 0; **no lleva
 * las fotos** (ver el comentario de `duplicateProduct`).
 */
export async function duplicateProductAction(
  input: unknown,
): Promise<AdminActionResult<{ productId: number }>> {
  try {
    await requireStaffSession();

    const parsed = z.object({ productId: z.number().int().positive() }).safeParse(input);
    if (!parsed.success) return { ok: false, error: t("adminError.noEntendi.masivo") };

    const productId = await duplicateProduct(parsed.data.productId);

    revalidatePath("/admin/productos");
    revalidarVidriera();
    return { ok: true, productId };
  } catch (error) {
    return adminActionError("duplicateProductAction", error);
  }
}
