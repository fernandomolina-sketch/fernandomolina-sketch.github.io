// Aero C-Suite · página de firma. Sin red: lee el enlace, pide Face ID y prepara
// el commit en GitHub, que la persona confirma allí.
import { aceptar, comprobarLote, enlaceCommit, identidadesConLlave, leerLote, resumenCasos, spkiDeCredencial }
  from './aero-firma.js';

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
  $('contenido').append(el('p', { className: 'meta', textContent: `Suite ${propuesta.suite} · robot ${propuesta.actor} · `
    + `creada ${new Date(propuesta.creado_en).toLocaleString('es-ES')}` }),
  el('p', { textContent: `${total.length} casos · PASS ${cuenta('PASS')} · FAIL ${cuenta('FAIL')} · INCONCLUSIVE ${cuenta('INCONCLUSIVE')}` }));
  for (const a of filas) {
    const tarjeta = el('div', { className: 'app' }, el('h2', { textContent: a.app_id }));
    for (const w of a.wsgi) tarjeta.append(el('p', { className: 'meta',
      textContent: `Código desplegado ${w.file}: ${w.coincide ? 'igual al censo' : 'DISTINTO'} (${(w.sha256 ?? '').slice(0, 12)})` }));
    for (const c of a.casos) {
      const caso = el('div', { className: 'caso' },
        el('div', {}, el('span', { className: `res ${c.resultado}`, textContent: c.resultado }), ` ${c.caso_id}`),
        el('div', { className: 'meta', textContent: c.comprobaciones.join(' · ') }));
      for (const p of c.peticiones) caso.append(el('div', { className: 'pet',
        textContent: `${p.method} ${p.path} → ${p.status}${p.location ? ' ' + p.location : ''}` }));
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

async function inicio() {
  const m = /^#(alta|aceptar)=([A-Za-z0-9_-]+)$/.exec(location.hash);
  if (!m) { estado('Abra esta página desde el enlace que le envía Aero C-Suite.'); return; }
  if (!window.PublicKeyCredential) { estado('Este navegador no admite llaves de acceso. Use Safari en el iPhone.', 'mal'); return; }
  const lote = await leerLote(m[2]);
  if (m[1] === 'alta') await alta(lote); else await firmarSuite(lote);
}
inicio().catch((e) => estado(explicar(e), 'mal'));
