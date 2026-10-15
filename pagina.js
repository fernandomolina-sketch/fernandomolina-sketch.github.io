// Aero C-Suite · página de firma. Sin red: lee el enlace, pide Face ID y prepara
// el commit en GitHub, que la persona confirma allí.
import { accionDeEnlace, aceptar, aceptarRiesgoResidual, comprobarLote, comprobarLoteRiesgo, enlaceCommit, identidadesConLlave,
  leerLote, resumenCasos, spkiDeCredencial } from './aero-firma.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...hijos) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const h of hijos) n.append(h);
  return n;
};
const estado = (msg, clase = '') => { $('estado').className = `aviso ${clase}`; $('estado').textContent = msg; };
const MOTIVOS = {
  enlace_invalido: 'El enlace está incompleto. Pida uno nuevo.',
  firma_del_robot_invalida: 'La propuesta no lleva una firma válida del robot. No firme.',
  verificador_sin_llave_de_acceso: 'Su llave de acceso aún no está dada de alta.',
  propuesta_caducada_relanzar_el_robot: 'La propuesta ha caducado (más de 72 horas). Hay que relanzar el robot.',
  informe_alterado: 'El informe no coincide con su huella o con el catálogo. No firme.',
  propietario_sin_llave_de_acceso: 'Su llave de acceso aún no está dada de alta.',
  NotAllowedError: 'Face ID cancelado o no disponible. No se ha firmado nada.',
};
const explicar = (e) => MOTIVOS[e?.name] ?? MOTIVOS[e?.message] ?? `No se ha podido completar: ${e?.message ?? e}`;
const aleatorio = (n) => crypto.getRandomValues(new Uint8Array(n));

async function alta(lote) {
  $('titulo').textContent = 'Alta de su llave de acceso';
  const rpId = location.hostname;
  $('contenido').append(el('p', { textContent: `Se creará una llave de acceso para «${lote.principal}» en este dispositivo, `
    + `protegida con Face ID. Sustituye a la clave del Mac como firma del verificador de Aero C-Suite.` }));
  estado('Listo para crear la llave.');
  const boton = el('button', { textContent: 'Crear llave de acceso con Face ID' });
  $('acciones').append(boton);
  boton.onclick = async () => {
    boton.disabled = true;
    try {
      const cred = await navigator.credentials.create({ publicKey: {
        rp: { id: rpId, name: 'Aero C-Suite' },
        user: { id: aleatorio(16), name: lote.principal, displayName: 'Verificador de Aero C-Suite' },
        challenge: aleatorio(32), pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        attestation: 'none', timeout: 120000 } });
      const r = await identidadesConLlave({ identidadesTexto: lote.identidades, principal: lote.principal, rpId,
        spki: spkiDeCredencial(cred.response) });
      $('acciones').replaceChildren(
        el('p', { textContent: '1 · Guarde la llave pública en GitHub (abre la pantalla de commit; pulse «Commit changes»):' }),
        el('a', { className: 'boton', textContent: 'Guardar en GitHub', target: '_blank', rel: 'noopener',
          href: enlaceCommit({ repo: lote.repo, rama: lote.rama, ruta: `docs/evidencia/qa-apps/alta/${lote.principal}.json`, contenido: r.fichero }) }),
        el('p', { textContent: '2 · Copie esta huella y péguela en GitHub → Settings → Environments → aero-qa → '
          + 'variable AERO_QA_IDENTIDADES_SHA256 (Edit):' }),
        el('div', { className: 'huella', textContent: r.huella }),
        Object.assign(el('button', { className: 'secundario', textContent: 'Copiar huella' }),
          { onclick: () => navigator.clipboard.writeText(r.huella).then(() => estado('Huella copiada.', 'ok')) }));
      estado('Llave creada en este dispositivo.', 'ok');
    } catch (e) { estado(explicar(e), 'mal'); boton.disabled = false; }
  };
}

function pintarCasos(propuesta, recibos) {
  const filas = resumenCasos(propuesta, recibos);
  const total = filas.flatMap((a) => a.casos);
  const cuenta = (r) => total.filter((c) => c.resultado === r).length;
  const noCuentan = total.filter((c) => c.alcance?.no_cuenta).length;
  $('contenido').append(el('p', { className: 'meta', textContent: `Suite ${propuesta.suite} · robot ${propuesta.actor} · `
    + `creada ${new Date(propuesta.creado_en).toLocaleString('es-ES')}` }),
  el('p', { className: 'meta', textContent: propuesta.entorno === 'replica'
    ? 'Entorno: réplica aislada de internet, con datos y autoridades ficticios. No es producción.' : 'Entorno: producción.' }),
  el('p', { textContent: `${total.length} casos · PASS ${cuenta('PASS')} · FAIL ${cuenta('FAIL')} · INCONCLUSIVE ${cuenta('INCONCLUSIVE')}` }));
  if (noCuentan) $('contenido').append(el('p', { className: 'nocuenta',
    textContent: `${noCuentan} caso(s) NO CUENTAN COMO FLUJO DE PRINCIPIO A FIN aunque pasen: aceptarlos no los cierra.` }));
  for (const a of filas) {
    const tarjeta = el('div', { className: 'app' }, el('h2', { textContent: a.app_id }));
    for (const w of a.wsgi) tarjeta.append(el('p', { className: 'meta',
      textContent: `Código desplegado ${w.file}: ${w.coincide ? 'igual al censo' : 'DISTINTO'} (${(w.sha256 ?? '').slice(0, 12)})` }));
    if (a.runtime) {
      const n = (e) => a.runtime.paquetes.filter((x) => x.estado === e).map((x) => x.paquete);
      tarjeta.append(el('p', { className: 'meta', textContent: `Python ${a.runtime.python} (producción `
        + `${a.runtime.python_produccion.join(', ')}) · ${n('IGUAL').length} paquete(s) con la versión de producción` }));
      if (n('DESCONOCIDA').length) tarjeta.append(el('p', { className: 'meta',
        textContent: `Versión de producción desconocida (paquetes del sistema de PythonAnywhere): ${n('DESCONOCIDA').join(', ')}` }));
      if (n('NO_INSTALADO').length) tarjeta.append(el('p', { className: 'nocuenta',
        textContent: `Paquetes que la réplica no pudo instalar: ${n('NO_INSTALADO').join(', ')}` }));
    }
    for (const c of a.casos) {
      const caso = el('div', { className: 'caso' },
        el('div', {}, el('span', { className: `res ${c.resultado}`, textContent: c.resultado }), ` ${c.caso_id}`),
        el('div', { className: 'meta', textContent: c.comprobaciones.join(' · ') }));
      const x = c.alcance;
      if (x) {
        caso.append(el('div', { className: 'meta', textContent: `Resultados documentados comprobados ${x.comprobados}/${x.documentados}`
          + ` (${x.pasos} pasos)` + (x.escribe ? ` · escribe: ${x.poscondiciones} comprobaciones en base` : '') }));
        if (x.no_cuenta) caso.append(el('div', { className: 'nocuenta', textContent: 'NO CUENTA COMO FLUJO DE PRINCIPIO A FIN' }));
        for (const r of x.sin_comprobar) caso.append(el('div', { className: 'pet', textContent: `sin comprobar: ${r}` }));
        for (const r of x.sin_handler) caso.append(el('div', { className: 'pet', textContent: `petición sin handler del censo: ${r}` }));
      }
      for (const p of c.peticiones) caso.append(el('div', { className: 'pet',
        textContent: `${p.method} ${p.path} → ${p.status}${p.location ? ' ' + p.location : ''}` }));
      for (const p of c.postcondiciones) caso.append(el('div', { className: 'pet',
        textContent: `${p.metodo} ${p.paso} → ${p.resultado}` }));
      tarjeta.append(caso);
    }
    $('contenido').append(tarjeta);
  }
}

async function firmarSuite(lote) {
  $('titulo').textContent = 'Aceptación de pruebas';
  const { propuesta, recibos, verificador } = await comprobarLote(lote);
  if (location.origin !== verificador.webauthn.origen) throw Error(`Esta página no es el origen de su llave (${verificador.webauthn.origen}).`);
  pintarCasos(propuesta, recibos);
  estado('Propuesta firmada por el robot y recibos íntegros. Revise los casos.', 'ok');
  const boton = el('button', { textContent: 'Acepto y firmo con Face ID' });
  $('acciones').append(boton);
  boton.onclick = async () => {
    boton.disabled = true;
    try {
      const aceptacion = await aceptar({ propuesta, obtenerAsercion: async (reto) => {
        const a = await navigator.credentials.get({ publicKey: { challenge: reto, rpId: verificador.webauthn.rp_id,
          userVerification: 'required', timeout: 120000 } });
        return a.response;
      } });
      $('acciones').replaceChildren(
        el('p', { textContent: 'Firmado. Último paso: guárdelo en GitHub (pulse «Commit changes»). El robot lo refrenda solo.' }),
        el('a', { className: 'boton', textContent: 'Guardar en GitHub', target: '_blank', rel: 'noopener',
          href: enlaceCommit({ repo: lote.repo, rama: `qa/${propuesta.suite}`,
            ruta: `docs/evidencia/qa-apps/${propuesta.suite}/aceptado.json`, contenido: JSON.stringify(aceptacion, null, 2) + '\n' }) }));
      estado('Aceptación firmada en este dispositivo.', 'ok');
    } catch (e) { estado(explicar(e), 'mal'); boton.disabled = false; }
  };
}

async function firmarRiesgo(lote) {
  $('titulo').textContent = 'Aceptación del riesgo residual';
  const { firmante } = await comprobarLoteRiesgo(lote);
  if (location.origin !== firmante.webauthn.origen) throw Error(`Esta página no es el origen de su llave (${firmante.webauthn.origen}).`);
  $('contenido').append(
    el('p', { className: 'meta', textContent: `Catálogo ${lote.catalogo_sha256.slice(0, 12)} · informe ${lote.informe.sha256.slice(0, 12)}` }),
    el('pre', { className: 'informe', textContent: lote.informe.texto }));
  estado('Informe íntegro. Léalo entero: es exactamente lo que firma.', 'ok');
  const boton = el('button', { textContent: 'Acepto el riesgo residual y firmo con Face ID' });
  $('acciones').append(boton);
  boton.onclick = async () => {
    boton.disabled = true;
    try {
      const aceptacion = await aceptarRiesgoResidual({ lote, obtenerAsercion: async (reto) => {
        const a = await navigator.credentials.get({ publicKey: { challenge: reto, rpId: firmante.webauthn.rp_id,
          userVerification: 'required', timeout: 120000 } });
        return a.response;
      } });
      $('acciones').replaceChildren(
        el('p', { textContent: 'Firmado. Último paso: guárdelo en GitHub (pulse «Commit changes»). El integrador lo lleva a producción.' }),
        el('a', { className: 'boton', textContent: 'Guardar en GitHub', target: '_blank', rel: 'noopener',
          href: enlaceCommit({ repo: lote.repo, rama: 'fase4/riesgo-residual',
            ruta: 'control-plane/config/fase4/riesgo-residual/aceptado.json', contenido: JSON.stringify(aceptacion, null, 2) + '\n' }) }));
      estado('Aceptación del riesgo residual firmada en este dispositivo.', 'ok');
    } catch (e) { estado(explicar(e), 'mal'); boton.disabled = false; }
  };
}

async function abrir({ accion, datos }) {
  if (!window.PublicKeyCredential) { estado('Este navegador no admite llaves de acceso. Use Safari en el iPhone.', 'mal'); return; }
  const lote = await leerLote(datos);
  if (accion === 'alta') await alta(lote); else if (accion === 'riesgo') await firmarRiesgo(lote); else await firmarSuite(lote);
}

// Sin enlace en la dirección (o roto al abrirlo desde otra app): la persona pega aquí el enlace
// completo. Así no hay límite de longitud y nada pasa por ningún servidor.
function pedirEnlace() {
  estado('Pegue aquí el enlace de firma que le envía Aero C-Suite.');
  const area = el('textarea', { id: 'enlace', rows: 4, spellcheck: false, autocomplete: 'off',
    placeholder: 'https://fernandomolina-sketch.github.io/#…' });
  area.setAttribute('autocapitalize', 'off');
  const boton = el('button', { textContent: 'Abrir el enlace pegado' });
  $('acciones').append(el('label', { htmlFor: 'enlace', className: 'meta', textContent: 'Enlace de firma' }), area, boton);
  boton.onclick = () => {
    const x = accionDeEnlace(area.value);
    if (!x) { estado(MOTIVOS.enlace_invalido, 'mal'); return; }
    $('acciones').replaceChildren();
    abrir(x).catch((e) => estado(explicar(e), 'mal'));
  };
}

async function inicio() {
  // La ruta cubre el enlace cuyo `#` llegó como `%23`: GitHub Pages sirve entonces 404.html, que carga esta página.
  const x = accionDeEnlace(location.hash) ?? accionDeEnlace(location.pathname);
  if (x) await abrir(x); else pedirEnlace();
}
inicio().catch((e) => estado(explicar(e), 'mal'));
