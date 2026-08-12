const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(cors());
const port = process.env.PORT || 3000;

const browserHeaders = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/json,application/xhtml+xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
};

const http = axios.create({
  timeout: 20000,
  headers: browserHeaders,
  validateStatus: (status) => status >= 200 && status < 400,
});

/** Client JSON (APIs BCRA / Open-Meteo / etc.). Evita Accept: text/html que a veces rompe en hosting. */
const jsonHttp = axios.create({
  timeout: 25000,
  headers: {
    'User-Agent': 'hola-argentina-api/1.1 (+https://github.com/devcaballero/price-webscraper)',
    Accept: 'application/json',
  },
  httpsAgent: new https.Agent({
    keepAlive: true,
    minVersion: 'TLSv1.2',
  }),
  validateStatus: (status) => status >= 200 && status < 400,
});

function sendError(res, error, fallback = 'Error en el servidor') {
  console.error(error?.message || error);
  if (!res.headersSent) {
    res.status(500).send(fallback);
  }
}

function formatArs(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return n.toFixed(2);
}

// Fallback si el catálogo no responde. Si INDEC cambia la base del IPC, este ID puede invalidarse.
const IPC_NACIONAL_FALLBACK_ID = '148.3_INIVELNAL_DICI_M_26';
const DATOS_GOB_SERIES = 'https://apis.datos.gob.ar/series/api';

function formatIpcPercent(ratio) {
  const n = Number(ratio);
  if (Number.isNaN(n) || n === null) return null;
  // La API devuelve proporción (0.019 = 1,9%)
  return (n * 100).toFixed(1).replace('.', ',');
}

/** fecha IPC suele ser YYYY-MM-DD → "Julio 2026" */
function formatIpcPeriodo(fecha) {
  if (!fecha) return null;
  const iso = String(fecha).slice(0, 10);
  const [year, month] = iso.split('-').map(Number);
  if (!year || !month) return null;
  const meses = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];
  return `${meses[month - 1]} ${year}`;
}

async function resolveIpcNacionalSeriesId() {
  try {
    const { data } = await http.get(`${DATOS_GOB_SERIES}/search/`, {
      params: {
        q: 'IPC Nivel General Nacional',
        limit: 30,
      },
    });

    const match = (data?.data || []).find((item) => {
      const id = item?.field?.id || '';
      const description = `${item?.field?.description || ''} ${item?.dataset?.title || ''}`.toLowerCase();
      return (
        id === IPC_NACIONAL_FALLBACK_ID ||
        (description.includes('nivel general') &&
          description.includes('nacional') &&
          description.includes('diciembre 2016') &&
          item?.field?.frequency === 'R/P1M')
      );
    });

    return match?.field?.id || IPC_NACIONAL_FALLBACK_ID;
  } catch (error) {
    console.error('No se pudo resolver el ID de IPC en el catálogo, uso fallback:', error.message);
    return IPC_NACIONAL_FALLBACK_ID;
  }
}

async function getLatestIpcObservation(representationMode) {
  const series = await getIpcSeries(representationMode, 1);
  const latest = series.historial[series.historial.length - 1];
  if (!latest) {
    throw new Error(`Sin observaciones IPC para ${representationMode}`);
  }
  return {
    fecha: latest.fecha,
    valor: latest.valorRatio,
    seriesId: series.seriesId,
  };
}

const ipcSeriesCache = new Map();
const IPC_SERIES_TTL_MS = 6 * 60 * 60 * 1000;

async function getIpcSeries(representationMode, months = 6) {
  const cacheKey = `${representationMode}:${months}`;
  const cached = ipcSeriesCache.get(cacheKey);
  if (cached && Date.now() - cached.at < IPC_SERIES_TTL_MS) {
    return cached.payload;
  }

  const seriesId = await resolveIpcNacionalSeriesId();
  // percent_change_a_year_ago exige mucho lookback; si start_date es reciente, la API
  // puede devolver data: [] aunque existan observaciones.
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 2);

  const { data } = await http.get(`${DATOS_GOB_SERIES}/series/`, {
    params: {
      ids: `${seriesId}:${representationMode}`,
      format: 'json',
      start_date: startDate.toISOString().slice(0, 10),
      limit: 36,
    },
  });

  const rows = (data?.data || [])
    .filter((row) => {
      const valor = row?.[1];
      return valor !== null && valor !== undefined && !Number.isNaN(Number(valor));
    })
    .map((row) => {
      const fecha = String(row[0]).slice(0, 10);
      const valorRatio = Number(row[1]);
      return {
        fecha,
        valorRatio,
        valor: formatIpcPercent(valorRatio),
        periodo: formatIpcPeriodo(fecha),
      };
    });

  const historial = rows.slice(-months).map((row, index, arr) => {
    const prev = index === 0
      ? rows[rows.length - months - 1]
      : arr[index - 1];
    const deltaPp =
      prev && Number.isFinite(prev.valorRatio)
        ? Number(((row.valorRatio - prev.valorRatio) * 100).toFixed(1))
        : null;
    return {
      fecha: row.fecha,
      periodo: row.periodo,
      valor: row.valor,
      valorRatio: row.valorRatio,
      deltaPp,
    };
  });

  const payload = { seriesId, historial };
  ipcSeriesCache.set(cacheKey, { at: Date.now(), payload });
  return payload;
}

async function getDolarCotizacion(tipo) {
  const { data } = await http.get(`https://dolarapi.com/v1/dolares/${tipo}`);
  const compra = formatArs(data?.compra);
  const venta = formatArs(data?.venta);
  if (!compra || !venta) {
    throw new Error(`Cotización ${tipo} inválida`);
  }
  return {
    compra: compra.replace('.', ','),
    venta: venta.replace('.', ','),
  };
}

/** Serie diaria de ArgentinaDatos (cache 1h). */
const dolarHistorialCache = new Map();
const DOLAR_HISTORIAL_TTL_MS = 60 * 60 * 1000;

async function getDolarHistorialSeries(tipo) {
  const cached = dolarHistorialCache.get(tipo);
  if (cached && Date.now() - cached.at < DOLAR_HISTORIAL_TTL_MS) {
    return cached.series;
  }

  const { data } = await http.get(
    `https://api.argentinadatos.com/v1/cotizaciones/dolares/${tipo}`
  );
  if (!Array.isArray(data) || !data.length) {
    throw new Error(`Historial vacío para ${tipo}`);
  }

  const series = data
    .filter((row) => row && row.fecha && row.venta != null && !Number.isNaN(Number(row.venta)))
    .map((row) => ({
      fecha: String(row.fecha).slice(0, 10),
      compra: row.compra == null ? null : Number(row.compra),
      venta: Number(row.venta),
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  dolarHistorialCache.set(tipo, { at: Date.now(), series });
  return series;
}

function pctChange(from, to) {
  if (from == null || to == null || Number(from) === 0) return null;
  return ((Number(to) - Number(from)) / Number(from)) * 100;
}

function isoMinusDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

function buildDolarHistorial(series, days = 7) {
  if (!series.length) {
    return { historial: [], variacion: null };
  }

  const end = series[series.length - 1].fecha;
  const start = isoMinusDays(end, days - 1);
  const windowDays = series.filter((day) => day.fecha >= start && day.fecha <= end);

  const beforeIndex = series.findIndex((day) => day.fecha === windowDays[0]?.fecha) - 1;
  const before = beforeIndex >= 0 ? series[beforeIndex] : null;

  const historial = windowDays.map((day, index) => {
    const prev = index === 0 ? before : windowDays[index - 1];
    const variacionPct = pctChange(prev?.venta, day.venta);
    return {
      fecha: day.fecha,
      compra: day.compra,
      venta: day.venta,
      variacionPct: variacionPct == null ? null : Number(variacionPct.toFixed(2)),
    };
  });

  const hoy = historial[historial.length - 1] || null;
  const ayer = historial.length >= 2 ? historial[historial.length - 2] : null;
  const variacionPct = hoy ? hoy.variacionPct : null;

  return {
    historial,
    variacion:
      variacionPct == null || !hoy
        ? null
        : {
            porcentaje: variacionPct,
            absoluta: ayer ? Number((hoy.venta - ayer.venta).toFixed(2)) : null,
            direccion: variacionPct > 0 ? 'up' : variacionPct < 0 ? 'down' : 'flat',
          },
  };
}

async function getDolarPayload(tipo) {
  const [cotizacion, series] = await Promise.all([
    getDolarCotizacion(tipo),
    getDolarHistorialSeries(tipo).catch((error) => {
      console.error(`Historial ${tipo} no disponible:`, error.message);
      return [];
    }),
  ]);

  const { historial, variacion } = buildDolarHistorial(series, 7);
  return {
    ...cotizacion,
    variacion,
    historial,
  };
}

app.get('/api/v1/dolar-oficial', async (_req, res) => {
  try {
    const payload = await getDolarPayload('oficial');
    console.log(
      `Dólar Oficial C/V: $${payload.compra} / $${payload.venta}` +
        (payload.variacion ? ` (${payload.variacion.porcentaje}%)` : '')
    );
    res.status(200).json(payload);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/v1/dolar-blue', async (_req, res) => {
  try {
    const payload = await getDolarPayload('blue');
    console.log(
      `Dólar Blue C/V: $${payload.compra} / $${payload.venta}` +
        (payload.variacion ? ` (${payload.variacion.porcentaje}%)` : '')
    );
    res.status(200).json(payload);
  } catch (error) {
    sendError(res, error);
  }
});

const oroCache = { at: 0, payload: null };
const ORO_TTL_MS = 30 * 60 * 1000;

async function getOroPayload() {
  if (oroCache.payload && Date.now() - oroCache.at < ORO_TTL_MS) {
    return oroCache.payload;
  }

  const toIso = new Date().toISOString().slice(0, 10);
  const fromIso = isoMinusDays(toIso, 10);

  const [{ data: spotData }, { data: barsData }] = await Promise.all([
    http.get('https://api.goldprice.dev/v1/prices', {
      params: { symbol: 'XAU-USD-SPOT' },
    }),
    http.get('https://api.goldprice.dev/v1/bars', {
      params: {
        symbol: 'XAU-USD-SPOT',
        interval: '1d',
        from: fromIso,
        to: toIso,
      },
    }),
  ]);

  const byFecha = new Map();
  for (const bar of barsData?.bars || []) {
    const close = Number(bar?.close);
    const start = bar?.bar_start;
    if (!start || !Number.isFinite(close)) continue;
    const fecha = String(start).slice(0, 10);
    byFecha.set(fecha, close);
  }

  const live = Number(spotData?.symbols?.[0]?.price);
  if (Number.isFinite(live)) {
    byFecha.set(toIso, live);
  }

  const series = [...byFecha.entries()]
    .map(([fecha, precio]) => ({ fecha, precio }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  if (!series.length) {
    throw new Error('Historial de oro vacío');
  }

  const end = series[series.length - 1].fecha;
  const start = isoMinusDays(end, 6);
  const windowDays = series.filter((day) => day.fecha >= start && day.fecha <= end);
  const beforeIndex = series.findIndex((day) => day.fecha === windowDays[0]?.fecha) - 1;
  const before = beforeIndex >= 0 ? series[beforeIndex] : null;

  const historial = windowDays.map((day, index) => {
    const prev = index === 0 ? before : windowDays[index - 1];
    const variacionPct = pctChange(prev?.precio, day.precio);
    return {
      fecha: day.fecha,
      precio: Number(day.precio.toFixed(2)),
      variacionPct: variacionPct == null ? null : Number(variacionPct.toFixed(2)),
    };
  });

  const hoy = historial[historial.length - 1];
  const ayer = historial.length >= 2 ? historial[historial.length - 2] : null;
  const variacionPct = hoy?.variacionPct ?? null;

  const payload = {
    precio: hoy.precio,
    precioLabel: hoy.precio.toFixed(2).replace('.', ','),
    variacion:
      variacionPct == null
        ? null
        : {
            porcentaje: variacionPct,
            absoluta: ayer ? Number((hoy.precio - ayer.precio).toFixed(2)) : null,
            direccion: variacionPct > 0 ? 'up' : variacionPct < 0 ? 'down' : 'flat',
          },
    historial,
  };

  oroCache.at = Date.now();
  oroCache.payload = payload;
  return payload;
}

app.get('/api/v1/oro', async (_req, res) => {
  try {
    const payload = await getOroPayload();
    console.log(
      `Oro: U$S ${payload.precioLabel}` +
        (payload.variacion ? ` (${payload.variacion.porcentaje}%)` : '')
    );
    res.status(200).json(payload);
  } catch (error) {
    sendError(res, error);
  }
});

const bitcoinCache = { at: 0, payload: null };
const BITCOIN_TTL_MS = 15 * 60 * 1000;

async function getBitcoinPayload() {
  if (bitcoinCache.payload && Date.now() - bitcoinCache.at < BITCOIN_TTL_MS) {
    return bitcoinCache.payload;
  }

  const { data } = await http.get(
    'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart',
    {
      params: {
        vs_currency: 'usd',
        days: 7,
        interval: 'daily',
      },
    }
  );

  const byFecha = new Map();
  for (const row of data?.prices || []) {
    const [ts, price] = row;
    if (ts == null || price == null || Number.isNaN(Number(price))) continue;
    const fecha = new Date(Number(ts)).toISOString().slice(0, 10);
    byFecha.set(fecha, Number(price));
  }

  const series = [...byFecha.entries()]
    .map(([fecha, precio]) => ({ fecha, precio }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  if (!series.length) {
    throw new Error('Historial de Bitcoin vacío');
  }

  const end = series[series.length - 1].fecha;
  const start = isoMinusDays(end, 6);
  const windowDays = series.filter((day) => day.fecha >= start && day.fecha <= end);
  const beforeIndex = series.findIndex((day) => day.fecha === windowDays[0]?.fecha) - 1;
  const before = beforeIndex >= 0 ? series[beforeIndex] : null;

  const historial = windowDays.map((day, index) => {
    const prev = index === 0 ? before : windowDays[index - 1];
    const variacionPct = pctChange(prev?.precio, day.precio);
    return {
      fecha: day.fecha,
      precio: Number(day.precio.toFixed(2)),
      variacionPct: variacionPct == null ? null : Number(variacionPct.toFixed(2)),
    };
  });

  const hoy = historial[historial.length - 1];
  const ayer = historial.length >= 2 ? historial[historial.length - 2] : null;
  const variacionPct = hoy?.variacionPct ?? null;

  const payload = {
    precio: hoy.precio,
    precioLabel: hoy.precio.toFixed(2).replace('.', ','),
    variacion:
      variacionPct == null
        ? null
        : {
            porcentaje: variacionPct,
            absoluta: ayer ? Number((hoy.precio - ayer.precio).toFixed(2)) : null,
            direccion: variacionPct > 0 ? 'up' : variacionPct < 0 ? 'down' : 'flat',
          },
    historial,
  };

  bitcoinCache.at = Date.now();
  bitcoinCache.payload = payload;
  return payload;
}

app.get('/api/v1/bitcoin', async (_req, res) => {
  try {
    const payload = await getBitcoinPayload();
    console.log(
      `Bitcoin: U$S ${payload.precioLabel}` +
        (payload.variacion ? ` (${payload.variacion.porcentaje}%)` : '')
    );
    res.status(200).json(payload);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/v1/nafta-super', async (_req, res) => {
  try {
    const url = 'https://surtidores.com.ar/precios/';
    const { data: html } = await http.get(url);
    const $ = cheerio.load(html);
    const fuelType = 'Super';

    let fuelRow = null;
    $('table tr').each((_, row) => {
      if ($(row).text().includes(fuelType)) {
        fuelRow = $(row);
        return false;
      }
    });

    if (!fuelRow) {
      return res.status(404).send('Información no encontrada');
    }

    const priceCells = fuelRow.find('td');
    const priceIndex = new Date().getMonth() + 1;
    if (priceIndex < 1 || priceIndex >= priceCells.length) {
      return res.status(404).send('Información no encontrada');
    }

    const price = priceCells.eq(priceIndex).text().trim();
    if (!price) {
      return res.status(404).send('Precio no disponible');
    }

    console.log(`El precio de la nafta 'Super' es : ${price}`);
    res.status(200).send(price.replace('.', ','));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/v1/bigmac', async (_req, res) => {
  try {
    // 1) Precio local en ARS desde bigmacindex (actualización frecuente)
    try {
      const { data: html } = await http.get('https://bigmacindex.com/country/argentina');
      const match = String(html).match(/ARS\s*([\d.,]+)/i);
      if (match?.[1]) {
        const precio = match[1].replace(/[^\d]/g, '');
        if (precio) {
          console.log(`El precio del bigmac es : ${precio}`);
          return res.status(200).send(precio);
        }
      }
    } catch (error) {
      console.error('bigmacindex falló, pruebo dataset The Economist:', error.message);
    }

    // 2) Fallback: Big Mac Index de The Economist (CSV semi-anual)
    const { data: csv } = await http.get(
      'https://raw.githubusercontent.com/TheEconomist/big-mac-data/master/output-data/big-mac-raw-index.csv'
    );
    const rows = String(csv)
      .trim()
      .split('\n')
      .filter((line) => line.includes(',ARG,') || line.includes(',Argentina,'));
    const latest = rows[rows.length - 1];
    if (!latest) {
      return res.status(404).send('Precio del bigmac no encontrado');
    }
    // date,iso_a3,currency_code,name,local_price,...
    const parts = latest.split(',');
    const localPrice = parts[4];
    const precio = String(Math.round(Number(localPrice)));
    if (!precio || precio === 'NaN') {
      return res.status(404).send('Precio del bigmac no encontrado');
    }
    console.log(`El precio del bigmac (Economist) es : ${precio}`);
    res.status(200).send(precio);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/v1/heineken', async (_req, res) => {
  try {
    const url =
      'https://diaonline.supermercadosdia.com.ar/cerveza-heineken-envase-retornable-1-lt-61144/p';
    const { data: html } = await http.get(url);
    const $ = cheerio.load(html);
    const precioElement = $('span.vtex-product-price-1-x-currencyInteger');

    if (!precioElement.length) {
      return res.status(404).send('Precio de la heineken no encontrado');
    }

    const precio = precioElement.first().text().trim();
    console.log(`Precio de la Heineken de Litro: ${precio}`);
    res.status(200).send(precio);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/v1/cocacola', async (_req, res) => {
  try {
    const url =
      'https://diaonline.supermercadosdia.com.ar/gaseosa-coca-cola-sabor-original-15-lts-16861/p';
    const { data: html } = await http.get(url);
    const $ = cheerio.load(html);
    const precioElement = $('span.vtex-product-price-1-x-currencyInteger');

    if (!precioElement.length) {
      return res.status(404).send('Precio de la cocacola no encontrado');
    }

    const precio = precioElement.first().text().trim();
    console.log(`Precio de la Coca-Cola de 1,5L: ${precio}`);
    res.status(200).send(precio);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/v1/forros-prime', async (_req, res) => {
  try {
    const url = 'https://www.farmalife.com.ar/prime-preserv-ultra-fino-x-3-/p';
    const { data: html } = await http.get(url);
    const $ = cheerio.load(html);
    const precioElement = $('strong.skuBestPrice');

    if (!precioElement.length) {
      return res.status(404).send('Precio del primex3 no encontrado');
    }

    const precio = precioElement.text().trim().replace('$', '').trim();
    console.log(`Precio del preservativos prime x3 unidades: ${precio}`);
    res.status(200).send(precio);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/v1/minimo-sube', async (_req, res) => {
  try {
    // Tarifa mínima oficial AMBA (0-3 km, SUBE registrada)
    const url =
      'https://www.argentina.gob.ar/transporte/conoce-las-tarifas-vigentes-en-colectivos-y-trenes-del-amba';
    const { data: html } = await http.get(url);
    const $ = cheerio.load(html);
    let tarifa = '';

    $('table').each((_, table) => {
      if (tarifa) return false;
      $(table)
        .find('tr')
        .each((__, row) => {
          const cells = $(row).find('td');
          if (cells.length < 2) return;
          const distancia = $(cells[0]).text().replace(/\s+/g, ' ').trim().toLowerCase();
          if (distancia.includes('0') && distancia.includes('3') && distancia.includes('km')) {
            const raw = $(cells[1]).text().replace(/\s+/g, ' ').trim();
            const match = raw.match(/([\d.]+,\d{2})/);
            if (match) {
              tarifa = match[1];
              return false;
            }
          }
        });
    });

    if (!tarifa) {
      const text = $.text().replace(/\s+/g, ' ');
      const match = text.match(/0\s*[-–]\s*3\s*km[^$]*\$\s*([\d.]+,\d{2})/i);
      if (match) {
        tarifa = match[1];
      }
    }

    if (!tarifa) {
      return res.status(404).send('Tarifa minimia sube no encontrada');
    }

    console.log(`Tarifa mínima de tarjeta sube: ${tarifa}`);
    res.status(200).send(tarifa);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/v1/inflacion-anualizada', async (_req, res) => {
  try {
    // IPC Nacional INDEC — variación interanual (percent_change_a_year_ago)
    const { fecha, valor, seriesId } = await getLatestIpcObservation(
      'percent_change_a_year_ago'
    );
    const inflation = formatIpcPercent(valor);
    if (!inflation) {
      return res.status(404).send('Inflación anualizada no encontrada');
    }
    const periodo = formatIpcPeriodo(fecha);
    console.log(`IPC interanual INDEC (${seriesId}, ${fecha}): %${inflation}`);
    res.status(200).json({ valor: inflation, periodo, fecha });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/v1/phillipbox', async (_req, res) => {
  try {
    const url = 'https://www.tarducciytordini.com.ar/nv/public/precios-de-cigarrillos';
    const { data: html } = await http.get(url);
    const $ = cheerio.load(html);
    const philipMorrisBox20Element = $('td:contains("PHILIP MORRIS BOX 20")').first();
    const priceElement = philipMorrisBox20Element.next();

    if (!priceElement.length) {
      return res.status(404).send('Precio del phillipbox no encontrado');
    }

    const precio = priceElement.text().trim().replace('$', '').trim();
    console.log(`Precio de PHILIP MORRIS BOX 20: ${precio}`);
    res.status(200).send(precio);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/v1/fernet', async (_req, res) => {
  try {
    const url =
      'https://www.cotodigital3.com.ar/sitios/cdigi/producto/-fernet-branca---botella-750-cc/_/A-00005525-00005525-200';
    const { data: html } = await http.get(url);
    const $ = cheerio.load(html);
    const precioText = $('span.atg_store_newPrice').text().trim();
    const precioMatches = precioText.match(/\d{1,3}(?:\.\d{3})*(?:,\d{2})?/);

    if (!precioMatches) {
      return res.status(404).send('Precio no encontrado');
    }

    const precio = precioMatches[0].replace(/\./g, '');
    console.log(`Precio del Fernet x 750ml: ${precio}`);
    res.status(200).send(precio);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/v1/inflacion-mensual', async (_req, res) => {
  try {
    // IPC Nacional INDEC — variación mensual (percent_change), últimos 6 meses
    const { seriesId, historial } = await getIpcSeries('percent_change', 6);
    const latest = historial[historial.length - 1];
    if (!latest?.valor) {
      return res.status(404).send('Inflación mensual no encontrada');
    }

    const deltaPp = latest.deltaPp;
    const payload = {
      valor: latest.valor,
      periodo: latest.periodo,
      fecha: latest.fecha,
      variacion:
        deltaPp == null
          ? null
          : {
              porcentaje: deltaPp,
              unidad: 'pp',
              direccion: deltaPp > 0 ? 'up' : deltaPp < 0 ? 'down' : 'flat',
            },
      historial: historial.map(({ fecha, periodo, valor, deltaPp: d }) => ({
        fecha,
        periodo,
        valor,
        deltaPp: d,
      })),
    };

    console.log(`IPC mensual INDEC (${seriesId}, ${latest.fecha}): %${latest.valor}`);
    res.status(200).json(payload);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/v1/tasa-bcra', async (_req, res) => {
  try {
    // Preferimos BADLAR (viva). TPM (160) suele estar desactualizada y su serie a veces viene vacía.
    const candidates = [
      { idVariable: 7, codigo: 'BADLAR', nombre: 'BADLAR', meta: 'Referencia BCRA · TNA' },
      { idVariable: 160, codigo: 'TPM', nombre: 'Política monetaria', meta: 'Tasa BCRA · TNA' },
    ];

    let payload = null;
    let lastError = null;

    for (const meta of candidates) {
      try {
        payload = await buildTasaBcraPayload(meta);
        if (payload) break;
      } catch (error) {
        lastError = error;
        console.error(`Tasa BCRA ${meta.codigo} falló:`, error.message);
      }
    }

    if (!payload) {
      if (lastError) return sendError(res, lastError);
      return res.status(404).send('Tasa BCRA no encontrada');
    }

    console.log(`Tasa BCRA ${payload.codigo} (${payload.fecha}): %${payload.valor}`);
    res.status(200).json(payload);
  } catch (error) {
    sendError(res, error);
  }
});

async function buildTasaBcraPayload(selectedMeta) {
  let series = [];
  try {
    series = await getBcraVariableSeries(selectedMeta.idVariable, 220);
  } catch (error) {
    console.error(`Serie ${selectedMeta.codigo} no disponible:`, error.message);
  }

  let historial = buildBcraMonthlyHistorial(series, 6);
  let latest = historial[historial.length - 1];

  // Fallback: solo último valor si la serie falla o viene vacía
  if (!latest) {
    const point = await getBcraVariableLatest(selectedMeta.idVariable);
    if (!point || point.valor == null) return null;
    const valorNum = Number(point.valor);
    if (!Number.isFinite(valorNum)) return null;
    latest = {
      fecha: String(point.fecha).slice(0, 10),
      periodo: formatIpcPeriodo(point.fecha),
      valor: valorNum.toFixed(2).replace('.', ','),
      deltaPp: null,
    };
    historial = [latest];
  }

  const deltaPp = latest.deltaPp;
  return {
    valor: latest.valor,
    codigo: selectedMeta.codigo,
    nombre: selectedMeta.nombre,
    meta: selectedMeta.meta,
    fecha: latest.fecha,
    periodo: latest.periodo,
    variacion:
      deltaPp == null
        ? null
        : {
            porcentaje: deltaPp,
            unidad: 'pp',
            direccion: deltaPp > 0 ? 'up' : deltaPp < 0 ? 'down' : 'flat',
          },
    historial: historial.map(({ fecha, periodo, valor, deltaPp: d }) => ({
      fecha,
      periodo,
      valor,
      deltaPp: d,
    })),
  };
}

async function getBcraVariableLatest(idVariable) {
  const { data } = await jsonHttp.get(
    `https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias/${idVariable}`,
    { params: { limit: 1 } }
  );
  const row = data?.results?.[0]?.detalle?.[0];
  if (!row) {
    const list = await jsonHttp.get('https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias', {
      params: { IdVariable: idVariable },
    });
    const meta = list.data?.results?.[0];
    if (!meta) return null;
    return {
      fecha: meta.ultFechaInformada,
      valor: meta.ultValorInformado,
    };
  }
  return { fecha: row.fecha, valor: row.valor };
}

async function getBcraVariableSeries(idVariable, daysBack = 220) {
  const hasta = new Date().toISOString().slice(0, 10);
  const desde = isoMinusDays(hasta, daysBack);
  const { data } = await jsonHttp.get(
    `https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias/${idVariable}`,
    {
      params: {
        desde,
        hasta,
        limit: 1000,
      },
    }
  );

  const detalle = data?.results?.[0]?.detalle || [];
  return detalle
    .filter((row) => row?.fecha != null && row?.valor != null && Number.isFinite(Number(row.valor)))
    .map((row) => ({
      fecha: String(row.fecha).slice(0, 10),
      valorNum: Number(row.valor),
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Último valor informado de cada mes, últimos N meses. */
function buildBcraMonthlyHistorial(series, months = 6) {
  if (!series.length) return [];

  const byMonth = new Map();
  for (const row of series) {
    const key = row.fecha.slice(0, 7); // YYYY-MM
    byMonth.set(key, row);
  }

  const monthly = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, row]) => row);

  // Incluye un mes previo para calcular delta del primero visible
  const window = monthly.slice(-(months + 1));
  const visible = window.slice(-months);
  const before = window.length > months ? window[0] : null;

  return visible.map((row, index) => {
    const prev = index === 0 ? before : visible[index - 1];
    const deltaPp =
      prev && Number.isFinite(prev.valorNum)
        ? Number((row.valorNum - prev.valorNum).toFixed(2))
        : null;
    return {
      fecha: row.fecha,
      periodo: formatIpcPeriodo(row.fecha),
      valor: row.valorNum.toFixed(2).replace('.', ','),
      valorNum: row.valorNum,
      deltaPp,
    };
  });
}

function daysSince(isoDate) {
  const then = new Date(isoDate);
  if (Number.isNaN(then.getTime())) return Number.POSITIVE_INFINITY;
  const ms = Date.now() - then.getTime();
  return ms / (1000 * 60 * 60 * 24);
}

app.get('/api/v1/temperatura', async (_req, res) => {
  try {
    const payload = await getTemperaturaPayload();
    if (!payload) {
      return res.status(404).send('Temperatura no disponible');
    }
    console.log(
      `Temperatura: ${payload.temperature} | código: ${payload.weatherCode} | ${payload.condition}`
    );
    res.status(200).json(payload);
  } catch (error) {
    sendError(res, error);
  }
});

async function getTemperaturaPayload() {
  try {
    return await fetchOpenMeteoWeather();
  } catch (error) {
    console.error('Open-Meteo falló:', error.message);
  }

  try {
    return await fetchWttrWeather();
  } catch (error) {
    console.error('wttr.in falló:', error.message);
  }

  return null;
}

async function fetchOpenMeteoWeather() {
  const { data } = await jsonHttp.get('https://api.open-meteo.com/v1/forecast', {
    params: {
      latitude: -34.6037,
      longitude: -58.3816,
      current: 'temperature_2m,weather_code',
      daily:
        'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant',
      timezone: 'America/Argentina/Buenos_Aires',
      forecast_days: 7,
    },
  });

  const temperature = data?.current?.temperature_2m;
  const weatherCode = data?.current?.weather_code;
  if (temperature === undefined || temperature === null) {
    throw new Error('Open-Meteo sin temperatura actual');
  }

  const condition = mapWeatherCondition(weatherCode);
  return {
    temperature,
    weatherCode,
    condition,
    label: weatherLabel(condition),
    forecast: buildForecastDays(data?.daily),
  };
}

async function fetchWttrWeather() {
  const { data } = await jsonHttp.get('https://wttr.in/Buenos%20Aires', {
    params: { format: 'j1' },
    headers: { Accept: 'application/json' },
  });

  const current = data?.current_condition?.[0];
  const temperature = Number(current?.temp_C);
  if (!Number.isFinite(temperature)) {
    throw new Error('wttr.in sin temperatura');
  }

  const code = Number(current?.weatherCode);
  const condition = mapWttrCondition(code);
  return {
    temperature,
    weatherCode: code,
    condition,
    label: weatherLabel(condition),
    forecast: buildWttrForecast(data?.weather),
  };
}

function mapWttrCondition(code) {
  const n = Number(code);
  if ([113].includes(n)) return 'sunny';
  if ([116, 119].includes(n)) return 'partly';
  if ([122, 143, 248, 260].includes(n)) return 'cloudy';
  if (
    (n >= 176 && n <= 377) ||
    (n >= 386 && n <= 395) ||
    [293, 296, 299, 302, 305, 308, 353, 356, 359].includes(n)
  ) {
    return 'rainy';
  }
  return 'cloudy';
}

function buildWttrForecast(days) {
  if (!Array.isArray(days)) return [];
  return days.slice(0, 7).map((day) => {
    const hourly = day?.hourly || [];
    const mid = hourly[Math.min(4, hourly.length - 1)] || hourly[0] || {};
    const code = Number(mid.weatherCode ?? day.hourly?.[0]?.weatherCode);
    const condition = mapWttrCondition(code);
    const precipProb = Number(mid.chanceofrain ?? 0);
    const precipSum = Number(day.totalSnow_cm ?? 0) > 0 ? Number(day.totalSnow_cm) : Number(mid.precipMM ?? 0);
    const wind = Math.round(Number(mid.windspeedKmph ?? 0));
    return {
      date: day.date,
      weatherCode: code,
      condition,
      label: weatherLabel(condition),
      tempMax: Number(day.maxtempC),
      tempMin: Number(day.mintempC),
      precipProbability: precipProb,
      precipSum,
      showPrecip: condition === 'rainy' || precipProb >= 30 || precipSum > 0,
      windMin: wind,
      windMax: wind,
      windDirection: Number(mid.winddirDegree ?? 0),
    };
  });
}

function buildForecastDays(daily) {
  if (!daily?.time?.length) return [];

  return daily.time.map((date, index) => {
    const weatherCode = daily.weather_code?.[index];
    const condition = mapWeatherCondition(weatherCode);
    const precipProb = Number(daily.precipitation_probability_max?.[index] ?? 0);
    const precipSum = Number(daily.precipitation_sum?.[index] ?? 0);
    const windMin = Math.round(Number(daily.wind_speed_10m_max?.[index] ?? 0));
    const windMax = Math.round(Number(daily.wind_gusts_10m_max?.[index] ?? windMin));

    return {
      date,
      weatherCode,
      condition,
      label: weatherLabel(condition),
      tempMax: Number(daily.temperature_2m_max?.[index]),
      tempMin: Number(daily.temperature_2m_min?.[index]),
      precipProbability: precipProb,
      precipSum,
      showPrecip: condition === 'rainy' || precipProb >= 30 || precipSum > 0,
      windMin: Math.min(windMin, windMax),
      windMax: Math.max(windMin, windMax),
      windDirection: Number(daily.wind_direction_10m_dominant?.[index] ?? 0),
    };
  });
}

function mapWeatherCondition(code) {
  const n = Number(code);
  if (Number.isNaN(n)) return 'cloudy';
  if (n === 0) return 'sunny';
  if (n === 1 || n === 2) return 'partly';
  if (n === 3 || n === 45 || n === 48) return 'cloudy';
  if (
    (n >= 51 && n <= 67) ||
    (n >= 80 && n <= 82) ||
    (n >= 95 && n <= 99)
  ) {
    return 'rainy';
  }
  if ((n >= 71 && n <= 77) || n === 85 || n === 86) return 'rainy';
  return 'cloudy';
}

function weatherLabel(condition) {
  if (condition === 'sunny') return 'Soleado';
  if (condition === 'partly') return 'Parcialmente nublado';
  if (condition === 'rainy') return 'Lluvia';
  return 'Nublado';
}
app.get('/api/v1/johnny-red', async (_req, res) => {
  try {
    const url = 'https://www.craftmoments.com.ar/producto/red-label/';
    const { data: html } = await http.get(url);
    const $ = cheerio.load(html);
    const precio = $('span.woocommerce-Price-amount').first().text().trim();

    if (!precio) {
      return res.status(404).send('Precio no encontrado');
    }

    console.log(`Precio del Johnnie Walker Red Label: ${precio}`);
    res.status(200).send(precio);
  } catch (error) {
    sendError(res, error);
  }
});

async function averagePriceFromSources(sources) {
  const prices = [];

  for (const source of sources) {
    try {
      const { data: html } = await http.get(source.url);
      const $ = cheerio.load(html);
      const precioText = source.selector($);
      const precioMatches = String(precioText).match(/\d{1,3}(?:\.\d{3})*(?:,\d{2})?/);
      if (precioMatches?.length) {
        prices.push(parseFloat(precioMatches[0].replace(/\./g, '').replace(',', '.')));
      }
    } catch (error) {
      console.error(`Fuente falló (${source.url}):`, error.message);
    }
  }

  return prices;
}

app.get('/api/v1/promedio-precio-asado', async (_req, res) => {
  try {
    const prices = await averagePriceFromSources([
      {
        url: 'https://www.res.com.ar/asado.html',
        selector: ($) => $('span.price').text(),
      },
      {
        url: 'https://www.frigorifico90.com.ar/productos/asado-x-kg/',
        selector: ($) => $('h3.js-price-display').text(),
      },
      {
        url: 'https://www.briosa.com.ar/productos/asado-especial-x-kg/',
        selector: ($) => $('h2.js-price-display').text(),
      },
    ]);

    if (!prices.length) {
      return res.status(404).send('Precios del kilo de asado no encontrados');
    }

    const averagePrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const formatted = averagePrice.toFixed(2).replace('.', ',');
    console.log(`El promedio del precio del kilo de asado es: ${formatted}`);
    res.status(200).send(formatted);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/v1/promedio-precio-pan', async (_req, res) => {
  try {
    const prices = await averagePriceFromSources([
      {
        url: 'https://montevende.com.ar/?product=pan-por-k-g',
        selector: ($) => $('span.woocommerce-Price-amount').text(),
      },
      {
        url: 'https://productosfrontera.com.ar/producto/pan-de-mesa-mignon-x-kilo/',
        selector: ($) => $('span.woocommerce-Price-amount').text(),
      },
      {
        url: 'https://www.panaderiasanfrancisco.com.ar/productos/pan-mignon-x-1-kilo/',
        selector: ($) => $('span.price.product-price.js-price-display').text(),
      },
    ]);

    if (!prices.length) {
      return res.status(404).send('Precios del kilo de pan no encontrados');
    }

    const averagePrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const formatted = averagePrice.toFixed(2).replace('.', ',');
    console.log(`El promedio del precio del kilo de pan es: ${formatted}`);
    res.status(200).send(formatted);
  } catch (error) {
    sendError(res, error);
  }
});

app.listen(port, () => {
  console.log(`Servidor Express escuchando en el puerto ${port}`);
});
