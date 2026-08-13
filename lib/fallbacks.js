/**
 * Cadena secuencial de fuentes: prueba cada una hasta obtener un resultado válido.
 *
 * Uso típico por endpoint:
 *   const { value, source } = await withFallbacks([
 *     { name: 'primaria', fetch: () => fetchA() },
 *     { name: 'alternativa', fetch: () => fetchB() },
 *   ], { label: 'clima' });
 *
 * Para promedios multi-fuente (asado/pan) usá collectFromSources, no este helper.
 */

class AllSourcesFailedError extends Error {
  /**
   * @param {string} label
   * @param {{ name: string, error: Error }[]} failures
   */
  constructor(label, failures) {
    const chain = failures.map((f) => f.name).join(' → ') || '(sin fuentes)';
    super(`[${label}] todas las fuentes fallaron: ${chain}`);
    this.name = 'AllSourcesFailedError';
    this.label = label;
    this.failures = failures;
    this.lastError = failures[failures.length - 1]?.error || null;
  }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function defaultIsValid(value) {
  return value != null;
}

/**
 * @typedef {{ name: string, fetch: () => Promise<any> }} FallbackSource
 *
 * @param {FallbackSource[]} sources
 * @param {{
 *   label?: string,
 *   isValid?: (value: any) => boolean,
 * }} [options]
 * @returns {Promise<{ value: any, source: string }>}
 */
async function withFallbacks(sources, options = {}) {
  const label = options.label || 'fallback';
  const isValid = options.isValid || defaultIsValid;
  const list = Array.isArray(sources) ? sources : [];
  const failures = [];

  for (const source of list) {
    const name = source?.name || 'unnamed';
    try {
      if (typeof source?.fetch !== 'function') {
        throw new Error(`fuente "${name}" sin fetch()`);
      }
      const value = await source.fetch();
      if (!isValid(value)) {
        throw new Error(`resultado inválido desde ${name}`);
      }
      if (failures.length) {
        console.log(`[${label}] usando alternativa: ${name}`);
      } else {
        console.log(`[${label}] fuente: ${name}`);
      }
      return { value, source: name };
    } catch (error) {
      failures.push({ name, error });
      console.error(
        `[${label}] ${name} falló:`,
        error?.code || '',
        error?.message || error,
        error?.response?.status || ''
      );
    }
  }

  throw new AllSourcesFailedError(label, failures);
}

/**
 * Intenta varias fuentes en paralelo (o secuencial) y acumula las que respondan.
 * Pensado para promedios (asado/pan), no para “primera que gane”.
 *
 * @param {FallbackSource[]} sources
 * @param {{
 *   label?: string,
 *   isValid?: (value: any) => boolean,
 *   parallel?: boolean,
 * }} [options]
 * @returns {Promise<{ values: any[], sources: string[] }>}
 */
async function collectFromSources(sources, options = {}) {
  const label = options.label || 'collect';
  const isValid = options.isValid || defaultIsValid;
  const list = Array.isArray(sources) ? sources : [];
  const values = [];
  const okSources = [];

  const runOne = async (source) => {
    const name = source?.name || 'unnamed';
    try {
      if (typeof source?.fetch !== 'function') {
        throw new Error(`fuente "${name}" sin fetch()`);
      }
      const value = await source.fetch();
      if (!isValid(value)) {
        throw new Error(`resultado inválido desde ${name}`);
      }
      return { name, value };
    } catch (error) {
      console.error(
        `[${label}] ${name} falló:`,
        error?.code || '',
        error?.message || error,
        error?.response?.status || ''
      );
      return null;
    }
  };

  if (options.parallel) {
    const results = await Promise.all(list.map(runOne));
    for (const hit of results) {
      if (!hit) continue;
      values.push(hit.value);
      okSources.push(hit.name);
    }
  } else {
    for (const source of list) {
      const hit = await runOne(source);
      if (!hit) continue;
      values.push(hit.value);
      okSources.push(hit.name);
    }
  }

  return { values, sources: okSources };
}

module.exports = {
  withFallbacks,
  collectFromSources,
  AllSourcesFailedError,
};
