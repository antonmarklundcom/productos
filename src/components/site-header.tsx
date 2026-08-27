import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { Truck } from "lucide-react";

import { TIENDA } from "@/config/tienda";
import { CartButton } from "@/components/cart-button";
import { CuentaHeaderEntry } from "@/components/cuenta/header-entry";
import { SearchBox } from "@/components/search-box";
import { getCategories } from "@/db/queries";
import { t } from "@/i18n";
import { categoryPlaceholderSrc } from "@/lib/images";

export async function SiteHeader() {
  let categories: Awaited<ReturnType<typeof getCategories>> = [];
  try {
    categories = await getCategories();
  } catch {
    // Sin base todavía: el header se dibuja igual, sin el menú.
  }

  return (
    <header className="border-border bg-background/95 sticky top-0 z-30 border-b backdrop-blur">
      {/* Franja de confianza: una tienda general sin una sola categoría de
          producto necesita decir de entrada "envío a todo el país" — es el
          motivo de compra que un rubro específico daría por sentado. */}
      <div className="bg-primary text-primary-foreground hidden text-xs sm:block">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-1.5">
          <Truck className="size-3.5" aria-hidden />
          <span>{t("header.topbar.envios")}</span>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg text-sm font-bold">
            {TIENDA.nombre.charAt(0).toUpperCase()}
          </span>
          <span className="text-lg font-semibold tracking-tight">{TIENDA.nombre}</span>
        </Link>

        <Suspense fallback={null}>
          <SearchBox className="ml-auto hidden w-full max-w-sm sm:block" />
        </Suspense>

        <div className="ml-auto flex items-center gap-3 sm:ml-0">
          {/* Devuelve null con `TIENDA.cuentasClientes` apagado: sin el flag,
              este header es idéntico al de antes de la feature. */}
          <Suspense fallback={null}>
            <CuentaHeaderEntry />
          </Suspense>
          <CartButton />
        </div>
      </div>

      <nav aria-label={t("header.categorias")} className="border-border/60 border-t">
        <div className="mx-auto flex w-full max-w-6xl gap-1.5 overflow-x-auto px-4 py-2 text-sm">
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/categoria/${category.slug}`}
              className="hover:bg-accent hover:text-accent-foreground text-muted-foreground flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors"
            >
              <Image
                src={categoryPlaceholderSrc(category.slug)}
                alt=""
                aria-hidden
                width={16}
                height={16}
                className="size-4 shrink-0 opacity-70"
              />
              {category.name}
            </Link>
          ))}
        </div>
      </nav>

      <div className="border-border/60 border-t px-4 py-2 sm:hidden">
        <Suspense fallback={null}>
          <SearchBox />
        </Suspense>
      </div>
    </header>
  );
}
