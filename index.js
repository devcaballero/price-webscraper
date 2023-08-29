const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');


const app = express();
app.use(cors());
const port = 3000; // Choose a suitable port

app.get('/api/v1/dolar-oficial', async (req, res) => {
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
            res.status(200);
        } else {
            console.log('No se encontró la cotización del dólar oficial.');
        }

        res.send(retorno);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error en el servidor');
    }
});

app.get('/api/v1/dolar-blue', async (req, res) => {
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
            retorno = `${cotizacion}\n${retorno}`;
            
            // Usar una expresión regular para extraer el valor deseado
            const extractedValue = precioDolarBlueTexto.match(/\$([\d,]+)/);
            if (extractedValue && extractedValue[1]) {
                console.log(`Cotización del Dólar Blue Venta: ${extractedValue[1]}`);
                res.send(extractedValue[1]); // Enviar solo el valor extraído
                res.status(200);
            } else {
                console.log('No se pudo extraer el valor del dolar blue.');
                res.status(404).send('Cotización no encontrada');
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

app.get('/api/v1/oro', async (req, res) => {
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
            res.status(200);
        } else {
            console.log('No se encontró la cotización del oro.');
            res.status(404).send('Cotización del oro no encontrada');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error en el servidor');
    }
});

app.get('/api/v1/nafta-super', async (req, res) => {
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
        res.status(200);
      
    } catch (error) {
        console.error(error);
        res.status(500).send('Error en el servidor');
    }
});

app.get('/api/v1/bigmac', async (req, res) => {
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
            res.status(200);
        } else {
            console.log('No se encontró el precio del Big Mac en Buenos Aires');
            res.status(404).send('Precio del bigmac no encontrado');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error en el servidor');
    }
});

app.get('/api/v1/heineken', async (req, res) => {
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
            res.status(200);
        } else {
            console.log('No se encontró el precio de la Heineken');
            res.status(404).send('Precio de la heineken no encontrado');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error en el servidor');
    }
});

app.get('/api/v1/cocacola', async (req, res) => {
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
            res.status(200);
        } else {
            console.log('No se encontró el precio de la Coca-Cola');
            res.status(404).send('Precio de la cocacola no encontrado');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error en el servidor');
    }
});

app.get('/api/v1/forros-prime', async (req, res) => {
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
            res.status(200);
        } else {
            console.log('No se encontró el precio del prime');
            res.status(404).send('Precio del primex3 no encontrado');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error en el servidor');
    }
});

app.get('/api/v1/minimo-sube', async (req, res) => {
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
            res.status(200);
        } else {
            console.log('No se encontró la tarifa minima sube');
            res.status(404).send('Tarifa minimia sube no encontrada');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error en el servidor');
    }
});

app.get('/api/v1/inflacion-anualizada', async (req, res) => {
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
            res.status(200);
        } else {
            console.log('No se pudo extraer la inflación anualizada.');
            res.status(404).send('Inflación anualizada no encontrada');
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

app.get('/api/v1/phillipbox', async (req, res) => {
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
            res.status(200);
        } else {
            console.log('No se encontró el precio de PHILIP MORRIS BOX 20');
            res.status(404).send('Precio del phillipbox no encontrado');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error en el servidor');
    }
});




app.get('/api/v1/fernet', async (req, res) => {
    try {
        const url = 'https://www.cotodigital3.com.ar/sitios/cdigi/producto/-fernet-branca---botella-750-cc/_/A-00005525-00005525-200';
        const response = await axios.get(url);
        const html = response.data;
        const $ = cheerio.load(html);

        const precioText = $('span.atg_store_newPrice').text().trim();
        const precioMatches = precioText.match(/\d{1,3}(?:\.\d{3})*(?:,\d{2})?/);
        const precio = precioMatches[0].replace(/\./g, '')

        if (precio) {
            console.log(`Precio del Fernet x 750ml: ${precio}`);
            res.send(precio);
            res.status(200);
        } else {
            console.log('No se encontró el precio del Fernet');
            res.status(404).send('Precio no encontrado');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error en el servidor');
    }
});



app.get('/api/v1/inflacion-mensual', async (req, res) => {
    try {
        const url = 'http://estudiodelamo.com/inflacion-argentina-anual-mensual/';
        const response = await axios.get(url);
        const html = response.data;
        const $ = cheerio.load(html);

        // Buscar el elemento que contiene la información de inflación mensual
        const infoElement = $('div:contains("fue de ")').first();

        // Obtener el texto dentro del elemento
        const infoText = infoElement.text();

        // Extraer el valor de inflación mensual del texto
        const startIndex = infoText.indexOf('fue de ') + 7;
        const endIndex = infoText.indexOf('%', startIndex);
        const inflation = infoText.substring(startIndex, endIndex).trim();

        if (inflation) {
            console.log(`Inflación mensual: ${inflation}`);
            res.send(inflation);
            res.status(200);
        } else {
            console.log('No se pudo extraer la inflación mensual.');
            res.status(404).send('Inflación mensual no encontrada');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error en el servidor');
    }
});




  
app.get('/api/v1/temperatura', async (req, res) => {
    try {
        const apiUrl = 'https://api.tomorrow.io/v4/timelines?location=-34.603722,-58.381592&fields=temperature&timesteps=1h&units=metric&apikey=gteJfd5gUxIr6vDZNQMsTSkW5YI3wUJF';
        const response = await axios.get(apiUrl);

        const data = response.data.data;
        const timelines = data.timelines;

        if (timelines.length > 0) {
            const lastTimeline = timelines[timelines.length - 1];
            const intervals = lastTimeline.intervals;

            if (intervals.length > 0) {
                const lastInterval = intervals[intervals.length - 1];
                const temperature = lastInterval.values.temperature;

                console.log(`Last Timeline: ${lastTimeline.endTime}`);
                console.log(`Last Interval: ${lastInterval.startTime}`);
                console.log(`Temperatura: ${temperature}`);

                const temperatureString = temperature.toString(); // Convertir el valor a cadena
                res.send(temperatureString);
                res.status(200);
            } else {
                console.log('No intervals found.');
                res.status(404).send('No intervals found.');
            }
        } else {
            console.log('No timelines found.');
            res.status(404).send('No timelines found.');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error en el servidor');
    }
});



app.get('/api/v1/johnny-red', async (req, res) => {
    try {
        const url = 'https://www.craftmoments.com.ar/producto/red-label/';
        const response = await axios.get(url);
        const html = response.data;
        const $ = cheerio.load(html);

        const precioElement = $('span.woocommerce-Price-amount').first(); // Usamos .first() para seleccionar solo el primer elemento
        const precio = precioElement.text().trim();

        if (precio) {
            console.log(`Precio del Johnnie Walker Red Label: ${precio}`);
            res.send(precio);
            res.status(200);
        } else {
            console.log('No se encontró el precio del Johnnie Walker Red Label');
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
