import Link from "next/link";
import { CreditCard, MessageCircle, Receipt, Truck } from "lucide-react";

import { TIENDA } from "@/config/tienda";
import { getCategories } from "@/db/queries";
import { t } from "@/i18n";
import { comercioWhatsApp } from "@/lib/comercio";
import { formatPhonePY } from "@/lib/py";

export async function SiteFooter() {
  let categories: Awaited<ReturnType<typeof getCategories>> = [];
  try {
    categories = await getCategories();
  } catch {
    // idem SiteHeader: el pie no debería tirar la página abajo.
  }
  const phone = comercioWhatsApp();

  return (
    <footer className="border-border bg-secondary/50 mt-16 border-t">
      <div className="text-muted-foreground mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-4">
        <div>
          <p className="text-foreground font-semibold">{TIENDA.nombre}</p>
          <p className="mt-2">{TIENDA.tagline}</p>
        </div>

        <div>
          <p className="text-foreground font-medium">{t("footer.categorias")}</p>
          <ul className="mt-2 space-y-1">
            {categories.map((category) => (
              <li key={category.id}>
                <Link href={`/categoria/${category.slug}`} className="hover:text-foreground">
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-foreground font-medium">{t("footer.contacto")}</p>
          <ul className="mt-2 space-y-1">
            {phone ? <li>{t("footer.whatsapp", { telefono: formatPhonePY(phone) })}</li> : null}
            <li>
              <Link href="/pedido/buscar" className="hover:text-foreground">
                {t("footer.seguirPedido")}
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <p className="text-foreground font-medium">{t("footer.confianza.titulo")}</p>
          <ul className="mt-2 space-y-2">
            <li className="flex items-center gap-2">
              <Truck className="size-4 shrink-0" aria-hidden />
              {t("footer.confianza.envios")}
            </li>
            <li className="flex items-center gap-2">
              <CreditCard className="size-4 shrink-0" aria-hidden />
              {t("footer.confianza.pago")}
            </li>
            <li className="flex items-center gap-2">
              <Receipt className="size-4 shrink-0" aria-hidden />
              {t("footer.confianza.iva")}
            </li>
            {phone ? (
              <li className="flex items-center gap-2">
                <MessageCircle className="size-4 shrink-0" aria-hidden />
                {formatPhonePY(phone)}
              </li>
            ) : null}
          </ul>
        </div>
      </div>

      <div className="border-border/60 text-muted-foreground mx-auto w-full max-w-6xl border-t px-4 py-4 text-xs">
        © {new Date().getFullYear()} {TIENDA.nombre} — {t("footer.derechos")}
      </div>
    </footer>
  );
}
