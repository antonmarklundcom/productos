# GO-LIVE — Productos.com.py (solo transferencia bancaria)

Lo que **sólo vos** podés hacer, en orden. El detalle de cada paso está en
`DEPLOY.md`; acá está la secuencia exacta para esta tienda. Todo lo que dice
`TU_…` es un dato tuyo: acá no hay ninguno inventado.

Esta tienda **no usa Pagopar ni tarjeta**: dejá vacías todas las `PAGOPAR_*` y
`PAGOPAR_MODE`. Con esas variables vacías el checkout ofrece sólo transferencia.

## 1. Sitio en Hostinger con deploy por git

1. hPanel → **Websites → Add website → Node.js Apps** → conectar GitHub →
   repo `antonmarklundcom/productos`, rama `main` (después de mergear la rama de
   trabajo; si querés probar antes, elegí esa rama).
2. Escribí a mano los tres campos (Hostinger propone `npm`, y eso está mal):
   - Install command: `pnpm install --frozen-lockfile`
   - Build command: `pnpm build`
   - Start command: `pnpm start`
3. Anotá la URL temporal del sitio (`https://algo-123456.hostingersite.com`):
   la usás hasta que el DNS resuelva (paso 5).

## 2. Base MySQL y `DATABASE_URL`

1. hPanel → **Databases → Management** → creá base **y** usuario. Cuidado de no
   transponer "MySQL Database" y "MySQL User".
2. Contraseña sin símbolos raros (`? # @ /`), o URL-encodeada.
3. `DATABASE_URL="mysql://TU_USUARIO:TU_CLAVE@TU_HOST:3306/TU_BASE"`

## 3. Variables de entorno (hPanel → Environment variables)

Generá los secretos vos (no reutilices ninguno, no los pegues en el repo):

```bash
node -e "const c=require('crypto');for(const n of ['SESSION_SECRET','CRON_SECRET','SETUP_SECRET'])console.log(n+'='+c.randomBytes(32).toString('base64'))"
```

| Variable | Valor |
|---|---|
| `DATABASE_URL` | el del paso 2 |
| `SESSION_SECRET` | generado arriba |
| `CRON_SECRET` | generado arriba (≥ 16 caracteres) |
| `SETUP_SECRET` | generado arriba — **temporal**, se borra en el paso 7 |
| `NEXT_PUBLIC_SITE_URL` | la URL **temporal** mientras la uses; luego `https://productos.com.py` |
| `WHATSAPP_NUMBER` | TU_WHATSAPP (formato `+5959XXXXXXXX`). **Bloquea el cobro si está vacío** |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | de tu cuenta de Cloudinary. **Bloquean el cobro**: sin esto el comprador no puede subir el comprobante |
| `NODE_ENV` | `production` |
| `PAGOPAR_*` | **vacías / sin cargar** |
| `BANCO_*` | vacías: los datos van por `/admin/banco` (paso 8) |

Opcionales (vacías = apagadas): `OWNER_EMAIL`, `NEXT_PUBLIC_GA4_ID`,
`NEXT_PUBLIC_META_PIXEL_ID`, `WHATSAPP_CLOUD_*` (avisos automáticos por WhatsApp;
ver `.env.example`).

Cambiar una variable **no rebuildea**: después de tocarlas, **Redeploy**.

## 4. Primer deploy

Push/Redeploy y esperá el build. Sin `DATABASE_URL` válida el sitio no levanta.

## 5. Dominio y DNS

1. hPanel → tu sitio → **Domains** → conectar `productos.com.py`.
2. En tu registrador, apuntá el DNS a lo que Hostinger te indique.
3. Cuando `productos.com.py` resuelva: cambiá `NEXT_PUBLIC_SITE_URL` a
   `https://productos.com.py` y **Redeploy** (se hornea en el build).
4. Repetí el paso 6 con el dominio final sólo si el primero se hizo contra la
   URL temporal y querés verificar.

## 6. Inicializar la tienda

Guardá un `setup.json` **fuera del repo**, con tu email/clave de dueño y tus
zonas de envío reales (sin `"seed": true`: eso siembra productos de mentira):

```json
{
  "owner": { "email": "TU_EMAIL", "password": "TU_CLAVE_LARGA" },
  "zonas": [
    { "slug": "asuncion", "name": "Asunción", "cities": ["Asunción"], "pricePyg": TU_PRECIO }
  ]
}
```

Las zonas no son opcionales: sin ninguna, el envío sale gratis a todo el país.

```bash
curl -X POST https://TU_DOMINIO_O_URL_TEMPORAL/api/setup/init \
  -H "Authorization: Bearer $SETUP_SECRET" \
  -H "content-type: application/json" \
  -d @setup.json
```

Leé el reporte de `preflight` que devuelve: no debe quedar nada en `bloquea`
salvo lo que sigue pendiente (banco, paso 8).

## 7. Sacar `SETUP_SECRET`

Borrá `SETUP_SECRET` de las Environment variables y apretá **Redeploy**. Hasta
el Redeploy la ruta sigue viva. Verificá:

```bash
curl -fsS https://productos.com.py/api/health
```

## 8. Datos bancarios — `/admin/banco`

Entrá a `/admin` con el dueño → **Banco** y cargá los cinco campos juntos:
banco, titular, RUC (se valida el dígito verificador), número de cuenta y tipo
de cuenta. Subí el QR del SPI (JPG/PNG/WebP, hasta 5 MB) si tenés. Ahí queda:
lo ven el checkout, la página del pedido y los mensajes de WhatsApp al comprador.

## 9. Las tres entradas de cron (hPanel → Advanced → Cron Jobs)

Hostinger usa hora **UTC**; Asunción es UTC−3 todo el año.

```
*/15 * * * *  curl -fsS -H "Authorization: Bearer TU_CRON_SECRET" https://productos.com.py/api/cron/vencer-pedidos
0 11 * * *    curl -fsS -H "Authorization: Bearer TU_CRON_SECRET" https://productos.com.py/api/cron/resumen-diario
0 6 * * *     curl -fsS -H "Authorization: Bearer TU_CRON_SECRET" https://productos.com.py/api/cron/backup
```

`vencer-pedidos` es la que vence las transferencias que nadie pagó y libera su
stock: **sin ella el stock queda reservado para siempre**. El resumen diario y
el backup se saltean solos si faltan WhatsApp Cloud / Cloudinary.

## 10. Catálogo, favicon y pedido de prueba

1. `/admin/productos` → Importar planilla (o cargar a mano). Nada de datos de
   ejemplo. Reemplazá `src/app/favicon.ico` por el de la marca.
2. Hacé un pedido real de prueba por transferencia: agregá un producto, checkout,
   elegí transferencia → tiene que abrir la página del pedido con **tus** datos
   bancarios y el QR.
3. Transferí, subí el comprobante, y desde `/admin/pedidos` verificá el pago.
   Confirmá que pasa a pagado.
4. Hacé otro pedido y no lo pagues: comprobá que vence (o esperá la ventana de
   reserva) y que `/api/health` devuelve `"cron":true`.
5. Cancelá/anulá los pedidos de prueba y `curl` a `/api/health` de nuevo.

## Lista de pendientes tuyos (placeholders)

- WhatsApp del comercio (`WHATSAPP_NUMBER`), vacío hoy → bloquea el cobro
- Credenciales de Cloudinary → bloquean el cobro
- Datos bancarios completos y QR (`/admin/banco`)
- Email/clave del dueño y zonas de envío con precios reales
- Favicon, fotos y catálogo reales
- Opcional: plantillas de WhatsApp Cloud, GA4, Meta Pixel
