# price-webscraper

API Node/Express que alimenta **Hola Argentina** (`panel-informativo-front`).

Expone cotizaciones, IPC INDEC, tasas BCRA, clima y precios varios bajo `/api/v1`.

## Requisitos

- Node.js 18+ (recomendado)

## Cómo correr

```bash
npm install
npm start
```

Por defecto escucha en el puerto **3000** (`PORT` opcional):

```bash
PORT=3000 npm start
```

Helper local (mata procesos en 3000/3001 y arranca):

```bash
./start-local.sh
```

Health check rápido:

```bash
curl http://localhost:3000/api/v1/dolar-blue
curl http://localhost:3000/api/v1/temperatura
```

## Endpoints principales (UI)

| Método | Path | Descripción |
|--------|------|-------------|
| GET | `/api/v1/dolar-oficial` | Spot + variación + historial 7 días |
| GET | `/api/v1/dolar-blue` | Idem blue |
| GET | `/api/v1/bitcoin` | Spot USD + variación + historial 7 días |
| GET | `/api/v1/oro` | Onza USD + variación + historial 7 días |
| GET | `/api/v1/inflacion-mensual` | IPC mensual + período + historial 6 meses |
| GET | `/api/v1/inflacion-anualizada` | IPC interanual + período |
| GET | `/api/v1/tasa-bcra` | BADLAR/TPM + historial mensual 6 meses |
| GET | `/api/v1/temperatura` | Clima BA + forecast 7 días |
| GET | `/api/v1/minimo-sube` | Tarifa mínima AMBA |
| GET | `/api/v1/nafta-super` | Nafta súper |
| GET | `/api/v1/promedio-precio-asado` | Asado $/kg |
| GET | `/api/v1/promedio-precio-pan` | Pan $/kg |
| GET | `/api/v1/bigmac` | Big Mac ARS |

Hay endpoints legacy adicionales (Fernet, Heineken, etc.) que el front actual puede no mostrar.

## Fuentes (resumen)

- Dólar: [dolarapi.com](https://dolarapi.com) + historial [ArgentinaDatos](https://api.argentinadatos.com)
- Bitcoin: [CoinGecko](https://www.coingecko.com/en/api) `market_chart`
- Oro: [goldprice.dev](https://goldprice.dev) spot + barras diarias
- Inflación: [apis.datos.gob.ar](https://apis.datos.gob.ar) (IPC nacional)
- Tasa: [API BCRA v4](https://api.bcra.gob.ar) monetarias — BADLAR → TPM
- Clima: [Open-Meteo](https://open-meteo.com) → [wttr.in](https://wttr.in) como alternativa
- Big Mac: [bigmacindex.com](https://bigmacindex.com) → CSV [The Economist](https://github.com/TheEconomist/big-mac-data)

Varias respuestas se cachean en memoria (dólar ~1h, BTC ~15m, oro ~30m, IPC ~6h) para no martillar las fuentes.

## Fallbacks

Helper reutilizable en `lib/fallbacks.js`:

- `withFallbacks(sources, { label })` — cadena secuencial (primera fuente válida gana). Usado en clima, Big Mac y tasa BCRA.
- `collectFromSources(sources, { label })` — acumula las que respondan (promedios asado/pan).

Para agregar una alternativa a un endpoint nuevo: definir `{ name, fetch }` y pasarlo a `withFallbacks`.

## Deploy

Prod típico en Render: `https://price-webscraper.onrender.com`.

El front de producción apunta a `…/api/v1` vía `environment.prod.ts`.

## CORS

`cors()` está habilitado de forma global para el front en local (`localhost:4200`) y en hosting.

## Relación con el front

```
panel-informativo-front  →  GET /api/v1/*
price-webscraper         →  scrapers / APIs públicas
```

Sin este servicio, el panel no tiene datos.
