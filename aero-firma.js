// Aero C-Suite · aceptación de la evidencia funcional con llave de acceso (Face ID).
//
// Módulo sin dependencias: el mismo código corre en la página de firma y en las
// pruebas de Node. La clave privada de la llave de acceso no sale nunca del
// dispositivo; una sola verificación (Face ID) autoriza una clave de sesión
// Ed25519 que firma los casos de ESTA suite y se descarta al terminar.
//
// Reproduce exactamente el contrato de control-plane/src/aero-os/evidencia-apps.js
// (contenidoFirmaApp, retoDelegacion) y de scripts/aero-evidencia/firmas.mjs
// (paqueteDesdePropuesta, contenidoPropuesta). Las pruebas lo comprueban.

export const CONTRATO_ACEPTACION = 'aero.apps.evidence.aceptacion';
export const VIGENCIA_MAXIMA_APPS_MS = 72 * 60 * 60 * 1000;
const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

const objeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const canonico = (v) => Array.isArray(v) ? v.map(canonico) : objeto(v)
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonico(v[k])])) : v;
const sinFirmas = (v) => Array.isArray(v) ? v.map(sinFirmas) : objeto(v)
  ? Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('firma_')).map(([k, x]) => [k, sinFirmas(x)])) : v;
const texto = (v) => JSON.stringify(canonico(v));
const exigir = (ok, motivo) => { if (!ok) throw Error(motivo); };
const fechaIso = (d) => new Date(d).toISOString();

// ── bytes ─────────────────────────────────────────────────────────────────
const aBytes = (v) => v instanceof Uint8Array ? v : new Uint8Array(v);
export const b64 = (v) => { let s = ''; for (const b of aBytes(v)) s += String.fromCharCode(b); return btoa(s); };
export const b64url = (v) => b64(v).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const deB64url = (s) => deB64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4));
export const hex = (v) => [...aBytes(v)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function sha256(v) { return new Uint8Array(await subtle().digest('SHA-256', typeof v === 'string' ? enc.encode(v) : v)); }

const pemDe = (der) => `-----BEGIN PUBLIC KEY-----\n${b64(der).match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----\n`;
const derDe = (pem) => deB64(pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, ''));

// ── contrato (idéntico al del servidor) ───────────────────────────────────
export async function huellaSuite(paquete) { return hex(await sha256(texto(sinFirmas(paquete)))); }

function contenidoConSuite(paquete, app, caso, tipo, suite) {
  const omitirFirmas = (v) => Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('firma_')));
  return enc.encode(JSON.stringify(canonico({ tipo: `aero.apps.evidence.${tipo}.v1`,
    entorno: paquete.entorno, censo: paquete.censo, emitido_en: paquete.emitido_en, vence_en: paquete.vence_en,
    app_id: app.app_id, codigo_sha256: app.codigo_sha256, suite_sha256: suite,
    evidencia: omitirFirmas(caso ?? app.despliegue) })));
}

export async function retoDelegacion(paquete, principal, claveSesionPem) {
  return sha256(JSON.stringify(canonico({ tipo: 'aero.apps.evidence.delegacion.v1',
    principal, clave_sesion_pem: claveSesionPem, suite_sha256: await huellaSuite(paquete) })));
}

/** El paquete que firman ambos: la propuesta, la hora real de verificación y la vigencia máxima. */
export function paqueteDesdePropuesta(propuesta, emitido) {
  const inicio = Math.min(...propuesta.apps.flatMap((a) => [Date.parse(a.despliegue.observado_en), ...a.casos.map((c) => Date.parse(c.ejecutado_en))]));
  const fin = Math.max(...propuesta.apps.flatMap((a) => a.casos.map((c) => Date.parse(c.ejecutado_en))));
  exigir(Date.parse(emitido) >= fin, 'verificacion_anterior_a_la_ejecucion');
  const vence = inicio + VIGENCIA_MAXIMA_APPS_MS;
  exigir(vence > Date.parse(emitido), 'propuesta_caducada_relanzar_el_robot');
  return { contrato: 'aero.apps.evidence', version: 1, entorno: propuesta.entorno, censo: propuesta.censo,
    ...(propuesta.catalogo ? { catalogo: propuesta.catalogo } : {}),
    emitido_en: emitido, vence_en: fechaIso(vence), apps: propuesta.apps.map((a) => ({ app_id: a.app_id, codigo_sha256: a.codigo_sha256,
      despliegue: { ...a.despliegue, comprobado_por: propuesta.verificador },
      casos: a.casos.map((c) => ({ ...c, actor: propuesta.actor, verificador: propuesta.verificador, verificado_en: emitido })) })) };
}

/** Clave de cada firma de la aceptación compacta: `<app_id> despliegue` o `<app_id> <caso_id>`. */
export const claveFirma = (app, caso) => `${app.app_id} ${caso ? caso.caso_id : 'despliegue'}`;

// ── comprobación de lo que se va a firmar ─────────────────────────────────

/**
 * La propuesta procede del robot (firma Ed25519 de su identidad) y cada recibo es
 * exactamente el que cita. Devuelve la propuesta y los recibos interpretados.
 */
export async function comprobarLote(lote) {
  exigir(lote?.v === 1 && typeof lote.propuesta === 'string' && typeof lote.identidades === 'string' && objeto(lote.recibos), 'enlace_invalido');
  const propuesta = JSON.parse(lote.propuesta), identidades = JSON.parse(lote.identidades);
  exigir(propuesta?.contrato === 'aero.apps.evidence.propuesta' && propuesta.version === 1, 'propuesta_invalida');
  const robot = identidades.find((i) => i.principal === propuesta.actor);
  exigir(robot?.rol === 'ejecutor' && typeof robot.public_key_pem === 'string', 'actor_no_es_el_robot_ejecutor');
  const verificador = identidades.find((i) => i.principal === propuesta.verificador);
  exigir(verificador?.rol === 'verificador' && objeto(verificador.webauthn), 'verificador_sin_llave_de_acceso');
  const clave = await subtle().importKey('spki', derDe(robot.public_key_pem), { name: 'Ed25519' }, false, ['verify']);
  const contenido = enc.encode(texto({ tipo: 'aero.apps.evidence.propuesta.v1', propuesta: sinFirmas(propuesta) }));
  exigir(typeof propuesta.firma_propuesta === 'string'
    && await subtle().verify({ name: 'Ed25519' }, clave, deB64(propuesta.firma_propuesta), contenido), 'firma_del_robot_invalida');
  const recibos = {};
  for (const a of propuesta.apps) for (const r of [a.despliegue, ...a.casos]) {
    const raw = lote.recibos[r.receipt_id];
    exigir(typeof raw === 'string' && hex(await sha256(raw)) === r.receipt_sha256, `recibo_distinto:${r.receipt_id}`);
    recibos[r.receipt_id] = JSON.parse(raw);
  }
  return { propuesta, recibos, identidades, verificador };
}

/**
 * Alcance de un caso de la réplica, como lo dice el resumen del robot: qué resultados exige el documento
 * de cada paso del flujo crítico (éxito, rechazo, rechazo sin permiso), cuáles se observaron y, si escribe,
 * cuántas comprobaciones en base hizo. `no_cuenta`: un PASS que no
 * es un flujo de principio a fin (el certificado tampoco lo contará).
 */
const alcanceDe = (a) => (a ? { comprobados: a.resultados_comprobados, documentados: a.resultados_documentados,
  pasos: a.pasos_documentados, sin_comprobar: a.sin_comprobar ?? [], sin_handler: a.peticiones_sin_handler_del_censo ?? [],
  escribe: a.escribe, poscondiciones: a.poscondiciones,
  no_cuenta: a.resultados_comprobados < a.resultados_documentados || (a.escribe && !a.poscondiciones) } : null);

/** Lo que la persona ve antes de aceptar: cada caso, su resultado, su alcance, sus peticiones y sus comprobaciones en base. */
export function resumenCasos(propuesta, recibos) {
  return propuesta.apps.map((a) => ({
    app_id: a.app_id,
    wsgi: (recibos[a.despliegue.receipt_id]?.wsgi ?? []).map((w) => ({ file: w.file, coincide: w.coincide, sha256: w.sha256_observado })),
    runtime: recibos[a.despliegue.receipt_id]?.runtime ?? null,
    casos: a.casos.map((c) => ({ caso_id: c.caso_id, resultado: c.resultado,
      comprobaciones: c.comprobaciones.map((x) => `${x.tipo}=${x.resultado}`),
      alcance: alcanceDe(recibos[c.receipt_id].alcance),
      peticiones: recibos[c.receipt_id].peticiones.map((p) => ({ method: p.method,
        path: `${p.path}${p.query ? '?' + p.query : ''}`, status: p.observado?.status ?? p.error ?? null, location: p.observado?.location ?? null })),
      postcondiciones: (recibos[c.receipt_id].postcondiciones ?? []).map((p) => ({ metodo: p.metodo, paso: p.paso,
        resultado: p.resultado })) })),
  }));
}

// ── aceptación ────────────────────────────────────────────────────────────

/**
 * Firma la aceptación: una aserción de la llave de acceso sobre el reto de la
 * delegación y, con la clave de sesión, cada lectura y verificación de la suite.
 * `obtenerAsercion(reto)` devuelve { authenticatorData, clientDataJSON, signature }.
 */
export async function aceptar({ propuesta, ahora = new Date(), obtenerAsercion }) {
  const emitido = fechaIso(ahora);
  const paquete = paqueteDesdePropuesta(propuesta, emitido);
  const principal = propuesta.verificador;
  const par = await subtle().generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
  const pem = pemDe(await subtle().exportKey('spki', par.publicKey));
  const reto = await retoDelegacion(paquete, principal, pem);
  const a = await obtenerAsercion(reto);
  const suite = await huellaSuite(paquete);
  const firmar = async (app, caso, tipo) => b64(await subtle().sign({ name: 'Ed25519' }, par.privateKey,
    contenidoConSuite(paquete, app, caso, tipo, suite)));
  const firmas = {};
  for (const app of paquete.apps) {
    firmas[claveFirma(app, null)] = await firmar(app, null, 'despliegue');
    for (const c of app.casos) firmas[claveFirma(app, c)] = await firmar(app, c, 'verificacion');
  }
  return { contrato: CONTRATO_ACEPTACION, version: 1, suite: propuesta.suite, verificador: principal, emitido_en: emitido,
    firma_delegacion: { principal, clave_sesion_pem: pem, authenticator_data: b64url(a.authenticatorData),
      client_data_json: b64url(a.clientDataJSON), firma: b64url(a.signature) }, firmas };
}

// ── alta de la llave de acceso ────────────────────────────────────────────

// Prefijo SPKI de una clave pública P-256 sin comprimir (RFC 5480).
const SPKI_P256 = Uint8Array.from([0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
  0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00]);

/** CBOR mínimo (RFC 8949) para leer la clave COSE del attestationObject cuando falta getPublicKey(). */
function cbor(bytes) {
  let i = 0;
  const leer = () => {
    const ib = bytes[i++], tipo = ib >> 5, info = ib & 31;
    let n = info;
    if (info === 24) n = bytes[i++];
    else if (info === 25) { n = (bytes[i] << 8) | bytes[i + 1]; i += 2; }
    else if (info === 26) { n = ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3]; i += 4; }
    else if (info > 26) throw Error('cbor_no_soportado');
    if (tipo === 0) return n;
    if (tipo === 1) return -1 - n;
    if (tipo === 2) { const v = bytes.subarray(i, i + n); i += n; return v; }
    if (tipo === 3) { const v = new TextDecoder().decode(bytes.subarray(i, i + n)); i += n; return v; }
    if (tipo === 4) return Array.from({ length: n }, leer);
    if (tipo === 5) { const m = new Map(); for (let k = 0; k < n; k++) m.set(leer(), leer()); return m; }
    throw Error('cbor_no_soportado');
  };
  return { valor: leer(), fin: () => i };
}

/** SPKI DER de la credencial recién creada (ES256), por getPublicKey() o por su attestationObject. */
export function spkiDeCredencial(respuesta) {
  if (typeof respuesta.getPublicKey === 'function') {
    const k = respuesta.getPublicKey();
    if (k) return new Uint8Array(k);
  }
  const att = cbor(aBytes(respuesta.attestationObject)).valor;
  const ad = att.get('authData');
  exigir(ad && (ad[32] & 0x40), 'sin_credencial_en_el_alta');
  const largo = (ad[53] << 8) | ad[54];
  const cose = cbor(ad.subarray(55 + largo)).valor;
  exigir(cose.get(3) === -7 && cose.get(-1) === 1, 'llave_no_es_es256');
  const x = cose.get(-2), y = cose.get(-3);
  exigir(x?.length === 32 && y?.length === 32, 'llave_mal_formada');
  return Uint8Array.from([...SPKI_P256, 0x04, ...x, ...y]);
}

/**
 * Sustituye la identidad del verificador por su llave de acceso. Devuelve el
 * fichero exacto y su huella (la que se fija en AERO_QA_IDENTIDADES_SHA256).
 */
export async function identidadesConLlave({ identidadesTexto, principal, rpId, spki }) {
  const ids = JSON.parse(identidadesTexto);
  exigir(Array.isArray(ids) && ids.some((i) => i.principal === principal && i.rol === 'verificador'), 'verificador_desconocido');
  const nuevas = ids.map((i) => i.principal !== principal ? i
    : { principal, rol: 'verificador', webauthn: { public_key_pem: pemDe(spki), rp_id: rpId, origen: `https://${rpId}` } });
  const fichero = JSON.stringify(nuevas, null, 2) + '\n';
  return { identidades: nuevas, fichero, huella: hex(await sha256(fichero)) };
}

// ── enlaces ───────────────────────────────────────────────────────────────

export async function leerLote(fragmento) {
  const bytes = deB64url(fragmento);
  const flujo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(flujo).text());
}

/** Enlace de GitHub que abre el commit del fichero con este contenido, listo para confirmar. */
export function enlaceCommit({ repo, rama, ruta, contenido }) {
  return `https://github.com/${repo}/new/${encodeURIComponent(rama).replace(/%2F/g, '/')}?filename=${encodeURIComponent(ruta)}`
    + `&value=${encodeURIComponent(contenido)}`;
}
