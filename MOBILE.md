# Gastos — versión iPhone

Una experiencia móvil nativa-iOS de Gastos, con **toda la funcionalidad** del
escritorio más una pestaña **Forense** de primera clase. Reusa tu mismo backend
(Supabase) y tu lógica (`db.js`, `uploadParser.js`). Empaquetable como app real
para tu iPhone vía **TestFlight**, e instalable como **PWA** hoy mismo.

---

## Qué se construyó

| Pieza | Archivo | Qué hace |
|-------|---------|----------|
| Shell móvil | `src/mobile/MobileApp.jsx` | 5 pestañas, orquesta datos y estado |
| Átomos UI | `src/mobile/MobileUI.jsx` | bottom sheet, tab bar, avatares, badges, chips, gráficos, swipe |
| Tokens | `src/mobile/mobileTheme.js` | paleta claro/oscuro (Dir. A + cian forense) |
| Helpers compartidos | `src/lib/shared.js` | formatos, categorías, colores (compartido con escritorio) |
| Selección de shell | `src/App.jsx` | móvil si es Capacitor o pantalla angosta |
| Login nativo | `src/Auth.jsx` | OAuth de Google vía navegador + deep link en Capacitor |
| PWA | `index.html`, `public/manifest.webmanifest`, `public/icons/*` | instalable en pantalla de inicio |
| Capacitor | `capacitor.config.json`, scripts en `package.json` | empaquetado iOS |
| CI sin Mac | `codemagic.yaml` | build de TestFlight en la nube |

**Pestañas:** Resumen · Movimientos · Revisar · **Forense** · Config.
Historial IA y Subir XLSX viven dentro de Config.

### Funcionalidad cubierta
- **Resumen** — saldo del mes, gasto mensual (tocá un mes → filtra), anillo por categoría, aviso de revisión.
- **Movimientos** — búsqueda; filtros por banco / sin categoría / categoría / mes; **Filtros** avanzados (rango de fechas, rango de monto USD, grupo de gastos); lista por fecha; **deslizar** para categorizar o borrar; tocar para editar todos los campos; botón + para agregar; **exportar/compartir** el filtro como XLSX.
- **Revisar** — cola de la IA como tarjetas: Aceptar / Cambiar / Rechazar.
- **Forense** — Fuentes y usos en USD (2020→hoy y 2020–2023), total "a rastrear", desglose por año, grandes movimientos con umbral $5k/$10k/$25k y marca de rastreo. Ver `FORENSIC.md`.
- **Config** — modo oscuro; presupuesto mensual; **grupos de gastos** (crear/editar/borrar, mostrar en Resumen); **papelera** (ver y restaurar borrados); **exportar XLSX**; subir XLSX (Santander); historial IA; agregar/renombrar/fusionar/vaciar categorías; cerrar sesión.
- **Resumen** — además de saldo/gráficos, tarjeta de **Grupos** con promedio mensual y total (para grupos marcados "mostrar en resumen").

---

## Opción rápida: usarla YA como PWA (sin cuenta de Apple)

1. Deploy normal a GitHub Pages (push a `main`).
2. En el iPhone, abrí la app en **Safari**: `https://brainpulp.github.io/gastos/?view=mobile`
3. Compartir → **Agregar a inicio**. Queda como app a pantalla completa, con ícono.

`?view=mobile` fuerza el shell móvil (se recuerda). `?view=desktop` vuelve al de escritorio.
Sin el parámetro, elige solo según el ancho de pantalla.

> La PWA en iOS no da push notifications ni build de App Store, pero es una app real
> a pantalla completa y no requiere nada de Apple. Ideal para probar el día a día.

---

## Opción completa: app de verdad en TestFlight (solo para vos)

Requiere una **cuenta Apple Developer** (US$99/año). No necesitás una Mac: el build
corre en la nube. TestFlight distribuye **solo a vos** — sin revisión de App Store,
sin testers externos, salvo que los agregues.

### 1. Preparar Apple (una sola vez)
- Cuenta en [developer.apple.com](https://developer.apple.com) (US$99/año).
- En [App Store Connect](https://appstoreconnect.apple.com): **Apps → +** → nueva app,
  bundle id `com.brainpulp.gastos`, plataforma iOS.
- **Users and Access → Integrations → App Store Connect API** → generá una API Key
  (rol *App Manager*). Guardá **Issuer ID**, **Key ID** y el archivo **.p8**.

### 2. Build en la nube con Codemagic (recomendado, sin Mac)
1. [codemagic.io](https://codemagic.io) → conectá este repo de GitHub.
2. **Team settings → Integrations → App Store Connect** → subí la API Key. Nombrala `gastos_asc`.
3. **Environment variables** → grupo `gastos_env`:
   - `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (los mismos de tus GitHub Secrets).
4. El repo ya trae `codemagic.yaml` (workflow **ios-testflight**). Corré el build.
5. Al terminar, aparece en **TestFlight** en tu iPhone (app TestFlight → Gastos).

> Alternativa con Mac: `npm run cap:add-ios` y después `npm run cap:open` abre Xcode →
> Product → Archive → Distribute → TestFlight. Requiere macOS + Xcode.

### 3. Íconos
`resources/icon.png` (1024×1024) ya está incluido. El CI corre
`npx @capacitor/assets generate --ios` para producir todos los tamaños. Para cambiar
el ícono, reemplazá ese archivo.

---

## Login de Google en la app nativa (importante)

En el navegador/PWA el login ya funciona. En la app nativa, el OAuth vuelve por un
**esquema de URL propio** en vez de una URL http. Configurá una sola vez:

1. **Supabase → Authentication → URL Configuration → Redirect URLs**: agregá
   `com.brainpulp.gastos://auth`
2. **Google Cloud Console** (el OAuth client que ya usás con Supabase): no requiere
   cambios extra — Supabase maneja el intercambio; el deep link solo trae los tokens.
3. Capacitor registra el esquema `com.brainpulp.gastos` en el `Info.plist` de iOS
   automáticamente al generar el proyecto (viene del `appId`).

El código de `src/Auth.jsx` ya abre el navegador del sistema y captura el deep link
(`appUrlOpen`) para setear la sesión. Si el login no vuelve a la app, verificá el
paso 1 (redirect URL exacta).

---

## Scripts

```bash
npm run dev          # dev server (abrí con ?view=mobile para el shell móvil)
npm run build        # build web para GitHub Pages (base /gastos/)
npm run build:app    # build web para Capacitor (base relativa ./)
npm run cap:add-ios  # genera el proyecto iOS (necesita Mac o CI)
npm run cap:sync     # build:app + cap sync ios
npm run cap:open     # abre Xcode (necesita Mac)
```

## Notas de arquitectura
- El shell móvil se carga con `React.lazy` → **no** infla el bundle de escritorio (chunk aparte ~41 kB).
- No se tocó `Finanzas.jsx` (el escritorio queda igual).
- Los paquetes `@capacitor/*` están en `package.json` pero se acceden por `window.Capacitor`
  en runtime, así que el build web compila sin tenerlos instalados.
- `blue_rates` se corta en 2026-05-11: actualizalo para que la subida de XLSX y las
  conversiones ARS→USD recientes sean exactas (ver conversación / `FORENSIC.md`).
