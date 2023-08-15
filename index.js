const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());
const port = 3000; // Choose a suitable port

app.get('/dolaroficial', async (req, res) => {
    try {
        let retorno = '';

        // Obtener la cotización del dólar oficial
        const officialResponse = await axios.get('https://www.bna.com.ar/');
        const officialHtml = officialResponse.data;
        const official$ = cheerio.load(officialHtml);
        const cotizacionDolarOficial = official$('table.table.cotizacion tr:contains("Dolar U.S.A") td:nth-child(3)').text();
        
        if (cotizacionDolarOficial) {
            const cotizacionDolarOficialVenta = cotizacionDolarOficial.replace(',', '.');
            const cotizacionDouble = parseFloat(cotizacionDolarOficialVenta);
            const cotizacion = `$${cotizacionDouble.toFixed(2)}`;
            console.log(`Cotización del Dólar Oficial Venta: ${cotizacion}`);
            retorno = `${cotizacion}\n${retorno}`;
        } else {
            console.log('No se encontró la cotización del dólar oficial.');
        }

        res.send(retorno);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error en el servidor');
    }
});

app.get('/dolarblue', async (req, res) => {
    try {
        // Obtener el precio del dólar blue
        const blueResponse = await axios.get('https://dolarhoy.com/');
        const blueHtml = blueResponse.data;
        const blue$ = cheerio.load(blueHtml);
        const precioDolarBlueTexto = blue$('.venta .val').text();
        
        let retorno = '';

        if (precioDolarBlueTexto) {
            const cotizacionDouble = parseFloat(precioDolarBlueTexto);
            const cotizacion = `$${cotizacionDouble.toFixed(2)}`;
            console.log(`Cotización del Dólar Blue Venta: ${cotizacion}`);
            retorno = `${cotizacion}\n${retorno}`;
            
            // Usar una expresión regular para extraer el valor deseado
            const extractedValue = precioDolarBlueTexto.match(/\$([\d,]+)/);
            if (extractedValue && extractedValue[1]) {
                console.log(`Valor extraído: ${extractedValue[1]}`);
                res.send(extractedValue[1]); // Enviar solo el valor extraído
            } else {
                console.log('No se pudo extraer el valor.');
                res.status(404).send('Valor no encontrado');
            }
        } else {
            console.log('No se encontró la cotización del dólar blue.');
            res.status(404).send('Cotización no encontrada');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error en el servidor');
    }
});

app.get('/oro', async (req, res) => {
    try {
        const url = 'https://www.kitco.com/charts/livegold.html';
        let retorno = '';

        const response = await axios.get(url);
        const html = response.data;
        const $ = cheerio.load(html);

        const goldPriceElement = $('span#sp-ask').first();

        if (goldPriceElement) {
            const goldPrice = goldPriceElement.text();
            console.log(`Cotización del oro en dólares: ${goldPrice}`);
            
            // Formatear la cotización si es necesario
            const formattedGoldPrice = goldPrice.replace(',', '').replace('.', ',');
            retorno = formattedGoldPrice;

            res.send(retorno);
        } else {
            console.log('No se encontró la cotización del oro en la página.');
            res.status(404).send('Cotización del oro no encontrada');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error en el servidor');
    }
});

app.get('/naftasuper', async (req, res) => {
    try {
        const url = 'https://surtidores.com.ar/precios/';
        const fuelType = 'Super';
        const response = await axios.get(url);
        const html = response.data;
        const $ = cheerio.load(html);

        const table = $('table');
        const rows = table.find('tr');

        let fuelRow = null;
        rows.each((index, row) => {
            const rowText = $(row).text();
            if (rowText.includes(fuelType)) {
                fuelRow = $(row);
                return false; // Break out of the loop
            }
        });

        if (!fuelRow) {
            console.log(`No se encontró información para el tipo de combustible: ${fuelType}`);
            return res.status(404).send('Información no encontrada');
        }

        const priceCells = fuelRow.find('td');
        const currentMonth = new Date().getMonth();
        const priceIndex = currentMonth + 1;

        if (priceIndex < 1 || priceIndex >= priceCells.length) {
            console.log('No se encontró información para el mes anterior.');
            return res.status(404).send('Información no encontrada');
        }

        const price = priceCells.eq(priceIndex).text().trim();

        if (!price) {
            console.log(`El precio de la nafta 'Super' del mes anterior está vacío.`);
            return res.status(404).send('Precio no disponible');
        }
        console.log(`El precio de la nafta 'Super' es : ${price}`);
        res.send(price.replace('.', ','));
      
    } catch (error) {
        console.error(error);
        res.status(500).send('Error en el servidor');
    }
});

app.get('/bigmac', async (req, res) => {
    try {
        const url = 'https://www.expatistan.com/es/precio/big-mac/buenos-aires';
        const response = await axios.get(url);
        const html = response.data;
        const $ = cheerio.load(html);

        const precioElement = $('span.city-1');

        if (precioElement) {
            const precio = precioElement.text().trim().substring(5,10).replace(".", "");
            console.log(`El precio del bigmac es : ${precio}`);
            res.send(precio);
        } else {
            console.log('No se encontró el precio del Big Mac en Buenos Aires');
            res.status(404).send('Precio no encontrado');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error en el servidor');
    }
});

app.get('/heineken', async (req, res) => {
    try {
        const url = 'https://diaonline.supermercadosdia.com.ar/cerveza-heineken-envase-retornable-1-lt-61144/p';
        const response = await axios.get(url);
        const html = response.data;
        const $ = cheerio.load(html);

        const precioElement = $('span.vtex-product-price-1-x-currencyInteger');

        if (precioElement.length > 0) {
            const precio = precioElement.text().trim();
            console.log(`Precio de la Heineken de Litro: ${precio}`);
            res.send(precio);
        } else {
            console.log('No se encontró el precio de la Heineken');
            res.status(404).send('Precio no encontrado');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error en el servidor');
    }
});

app.get('/cocacola', async (req, res) => {
    try {
        const url = 'https://diaonline.supermercadosdia.com.ar/gaseosa-coca-cola-sabor-original-15-lts-16861/p';
        const response = await axios.get(url);
        const html = response.data;
        const $ = cheerio.load(html);

        const precioElement = $('span.vtex-product-price-1-x-currencyInteger');

        if (precioElement.length > 0) {
            const precio = precioElement.text().trim();
            console.log(`Precio de la Coca-Cola de 1,5L: ${precio}`);
            res.send(precio);
        } else {
            console.log('No se encontró el precio de la Coca-Cola');
            res.status(404).send('Precio no encontrado');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error en el servidor');
    }
});

app.get('/forrosprime', async (req, res) => {
    try {
        const url = 'https://www.farmalife.com.ar/prime-preserv-ultra-fino-x-3-/p';
        const response = await axios.get(url);
        const html = response.data;
        const $ = cheerio.load(html);

        const precioElement = $('strong.skuBestPrice');

        if (precioElement.length > 0) {
            const precio = precioElement.text().trim().replace('$', '').trim();
            console.log(`Precio del preservativos prime x3 unidades: ${precio}`);
            res.send(precio); 
        } else {
            console.log('No se encontró el precio del producto');
            res.status(404).send('Precio no encontrado');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error en el servidor');
    }
});

app.get('/minimosube', async (req, res) => {
    try {
        const url = 'https://www.argentina.gob.ar/redsube/tarifas-de-transporte-publico-amba-2021';
        const response = await axios.get(url);
        const html = response.data;
        const $ = cheerio.load(html);

        const tarifaElements = $('table.table tbody tr td');

        let tarifaEncontrada = false;
        let tarifa = '';

        // Iterar sobre los elementos de la tabla y encontrar el que contiene la tarifa
        tarifaElements.each((index, element) => {
            const texto = $(element).text().trim();
            if (texto.includes('$') && !tarifaEncontrada) {
                tarifa = texto.replace('$', '').trim();
                tarifaEncontrada = true;
            }
        });

        if (tarifaEncontrada) {
            console.log(`Tarifa mínima de tarjeta sube: ${tarifa}`);
            res.send(tarifa);
        } else {
            console.log('No se encontró la tarifa en la tabla');
            res.status(404).send('Tarifa no encontrada');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error en el servidor');
    }
});

app.get('/inflacionanualizada', async (req, res) => {
    try {
        const url = 'http://estudiodelamo.com/inflacion-argentina-anual-mensual/';
        const response = await axios.get(url);
        const html = response.data;
        const $ = cheerio.load(html);

        // Buscar el elemento que contiene la información de inflación anualizada
        const infoElement = $('div:contains("y la anualizada es de")').first();

        // Obtener el texto dentro del elemento
        const infoText = infoElement.text();

        // Extraer la inflación anualizada del texto
        const inflation = extractInflacionAnualizada(infoText);

        if (inflation) {
            console.log(`Inflación anualizada : %${inflation}`);
            res.send(inflation);
        } else {
            console.log('No se pudo extraer la inflación anualizada.');
            res.status(404).send('Inflación no encontrada');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error en el servidor');
    }
});

function extractInflacionAnualizada(text) {
    // Buscar la posición del porcentaje y extraer el valor numérico
    const startIndex = text.indexOf('anualizada es de') + 16;
    const endIndex = text.indexOf('%', startIndex);
    return text.substring(startIndex, endIndex).trim();
}

app.get('/phillipbox', async (req, res) => {
    try {
        const url = 'https://www.tarducciytordini.com.ar/nv/public/precios-de-cigarrillos';
        const response = await axios.get(url);
        const html = response.data;
        const $ = cheerio.load(html);

        // Buscar el elemento que contiene el nombre "PHILIP MORRIS BOX 20"
        const philipMorrisBox20Element = $('td:contains("PHILIP MORRIS BOX 20")').first();

        // Buscar el elemento que contiene el precio
        const priceElement = philipMorrisBox20Element.next();

        if (priceElement.length > 0) {
            const precio = priceElement.text().trim();
            console.log(`Precio de PHILIP MORRIS BOX 20: ${precio}`);
            res.send(precio.replace('$', '').trim());
        } else {
            console.log('No se encontró el precio de PHILIP MORRIS BOX 20');
            res.status(404).send('Precio no encontrado');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error en el servidor');
    }
});

app.listen(port, () => {
    console.log(`Servidor Express escuchando en el puerto ${port}`);
});
