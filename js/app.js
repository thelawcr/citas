'use strict';
/* ==========================================================
   Datos (localStorage)
   grupos: [{ id, fecha:"YYYY-MM-DD", horario:"14:00-16:00",
              tipo:"grupal"|"individual", precio, notas, finalizado,
              estudiantes:[{ id, nombre, materia, amountPaid,
                             pagos:[{ id, monto, fecha }] }] }]
   Se usa la misma clave de la versión anterior, así los datos
   existentes siguen disponibles. amountPaid se mantiene como
   suma de pagos para conservar compatibilidad.
========================================================== */
const LS_KEY = 'tutor_grupos_calendar_v1';
const LS_COPIA = 'tutor_grupos_calendar_v1_copia_previa';
const LS_AJUSTES = 'tutor_ajustes_v1';
const PRECIO_ANTERIOR = { grupal: 8000, individual: 16000 };
const HORARIOS = ['10:00-12:00', '14:00-16:00', '16:00-18:00', '18:00-20:00'];
const DIAS_RESPALDO = 14;

const $ = id => document.getElementById(id);
const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dinero = v => '₡' + Math.round(Number(v) || 0).toLocaleString('en-US');
const plano = s => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const icono = n => `<svg class="ico"><use href="#i-${n}"/></svg>`;

/* ---------- Fechas: siempre en hora local ---------- */
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoy = () => iso(new Date());
const aFecha = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const sumarDias = (s, n) => { const d = aFecha(s); d.setDate(d.getDate() + n); return iso(d); };
const fechaLarga = s => aFecha(s).toLocaleDateString('es-CR', { weekday: 'long', day: 'numeric', month: 'long' });
const fechaCorta = s => aFecha(s).toLocaleDateString('es-CR', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
const fechaAnio = s => aFecha(s).toLocaleDateString('es-CR', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '');
function hora12(t) {
    const [h, m] = t.split(':').map(Number);
    if (h === 12 && m === 0) return '12:00 md';
    return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'am' : 'pm'}`;
}
const rangoHoras = g => g.horario.split('-');
const textoHorario = h => h.split('-').map(hora12).join(' – ');
const inicio = g => new Date(`${g.fecha}T${rangoHoras(g)[0]}`);
const fin = g => new Date(`${g.fecha}T${rangoHoras(g)[1]}`);
const orden = (a, b) => (a.fecha + a.horario).localeCompare(b.fecha + b.horario);

/* ---------- Carga y guardado ---------- */
function normalizarEstudiante(s, fecha) {
    let pagos = [];
    if (Array.isArray(s.pagos)) {
        pagos = s.pagos.map(p => ({ id: String(p.id || uid()), monto: Number(p.monto) || 0, fecha: String(p.fecha || fecha) })).filter(p => p.monto);
    } else if (Number(s.amountPaid)) {
        pagos = [{ id: uid(), monto: Number(s.amountPaid), fecha }];
    }
    return { id: String(s.id || uid()), nombre: String(s.nombre || '').trim(), materia: String(s.materia || '').trim(), pagos };
}

function normalizarGrupo(g) {
    const tipo = g.tipo === 'individual' ? 'individual' : 'grupal';
    const tienePrecio = g.precio !== undefined && g.precio !== null && !isNaN(Number(g.precio));
    return {
        id: String(g.id || uid()),
        fecha: String(g.fecha),
        horario: String(g.horario),
        tipo,
        precio: tienePrecio ? Number(g.precio) : PRECIO_ANTERIOR[tipo],
        notas: String(g.notas || ''),
        // La versión anterior finalizaba por error las clases del día después de las 6 pm.
        finalizado: !!g.finalizado && (tienePrecio || g.fecha !== hoy()),
        estudiantes: (Array.isArray(g.estudiantes) ? g.estudiantes : []).map(s => normalizarEstudiante(s, String(g.fecha))),
    };
}

const grupoValido = g => g && /^\d{4}-\d{2}-\d{2}$/.test(g.fecha) && /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(g.horario);

function leerGrupos() {
    const crudo = localStorage.getItem(LS_KEY);
    if (!crudo) return [];
    const lista = JSON.parse(crudo);
    if (!Array.isArray(lista)) throw new Error('formato');
    if (lista.some(g => g.precio === undefined) && !localStorage.getItem(LS_COPIA)) {
        localStorage.setItem(LS_COPIA, crudo); // copia intacta antes de migrar
    }
    return lista.filter(grupoValido).map(normalizarGrupo);
}

function leerAjustes() {
    const base = { nombre: '', telefono: '', materias: '', precioGrupal: 8000, precioIndividual: 16000, maxGrupal: 5, ultimoRespaldo: null };
    try { return { ...base, ...JSON.parse(localStorage.getItem(LS_AJUSTES) || '{}') }; } catch { return base; }
}

// Modo nube: hay cuentas de tutores en Supabase. Modo local: un solo usuario y datos en este navegador.
const NUBE = !!(window.Nube && window.Nube.configurada());
let errorCarga = false;
let grupos = [];
if (!NUBE) { try { grupos = leerGrupos(); } catch { errorCarga = true; } }
let ajustes = leerAjustes();

function guardar() {
    if (NUBE) {
        Nube.sincronizar(grupos);
        return;
    }
    if (errorCarga) return; // nunca sobrescribir datos que no se pudieron leer
    grupos.forEach(g => g.estudiantes.forEach(s => { s.amountPaid = pagado(s); }));
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(grupos));
        localStorage.setItem(LS_AJUSTES, JSON.stringify(ajustes));
    } catch {
        aviso('No se pudo guardar. Descargue un respaldo para no perder cambios.');
    }
}

/* ---------- Cálculos ---------- */
const pagado = s => s.pagos.reduce((t, p) => t + p.monto, 0);
const saldo = (g, s) => g.precio - pagado(s);
const cupo = g => g.tipo === 'individual' ? 1 : ajustes.maxGrupal;
const grupo = id => grupos.find(g => g.id === id);
const alumno = (g, id) => g && g.estudiantes.find(s => s.id === id);
const pendienteGrupo = g => g.estudiantes.reduce((t, s) => t + Math.max(0, saldo(g, s)), 0);
const cobradoGrupo = g => g.estudiantes.reduce((t, s) => t + pagado(s), 0);
const terminada = g => g.finalizado || new Date() >= fin(g);
const enCurso = g => !g.finalizado && new Date() >= inicio(g) && new Date() < fin(g);
function estadoPago(g, s) {
    if (saldo(g, s) <= 0) return 'pagado';
    return pagado(s) > 0 ? 'parcial' : 'pendiente';
}
function deudas() {
    const mapa = new Map();
    grupos.forEach(g => g.estudiantes.forEach(s => {
        const monto = saldo(g, s);
        if (monto <= 0) return;
        const clave = plano(s.nombre);
        if (!mapa.has(clave)) mapa.set(clave, { nombre: s.nombre, total: 0, lineas: [] });
        const d = mapa.get(clave);
        d.total += monto;
        d.lineas.push({ g, s, monto });
    }));
    const lista = [...mapa.values()];
    lista.forEach(d => d.lineas.sort((a, b) => orden(a.g, b.g)));
    return lista.sort((a, b) => b.total - a.total);
}
function choques(fecha, horario, excluir) {
    const [a, b] = horario.split('-');
    return grupos.filter(g => {
        if (g.id === excluir || g.fecha !== fecha) return false;
        const [c, d] = rangoHoras(g);
        return a < d && c < b;
    });
}

/* ---------- Componentes ---------- */
function asientos(g) {
    const total = Math.max(cupo(g), g.estudiantes.length);
    const llenos = g.estudiantes.map(s => `<span class="seat ${estadoPago(g, s)}"></span>`);
    const libres = Array(total - g.estudiantes.length).fill('<span class="seat"></span>');
    const pagados = g.estudiantes.filter(s => saldo(g, s) <= 0).length;
    return `<span class="seats" role="img" aria-label="${g.estudiantes.length} de ${total} cupos, ${pagados} al día">${llenos.join('')}${libres.join('')}</span>`;
}

function titulo(g) {
    if (!g.estudiantes.length) return 'Sin estudiantes';
    return g.estudiantes.map(s => s.nombre).join(', ');
}

function subtitulo(g) {
    const materias = [...new Set(g.estudiantes.map(s => s.materia).filter(Boolean))];
    return [g.tipo === 'grupal' ? 'Grupal' : 'Individual', ...materias].join(' · ');
}

function filaClase(g, conFecha = false) {
    const [a, b] = rangoHoras(g);
    const pend = pendienteGrupo(g);
    const izq = conFecha
        ? `<b>${esc(fechaCorta(g.fecha))}</b><small>${hora12(a)}</small>`
        : `<b>${hora12(a)}</b><small>${hora12(b)}</small>`;
    let marca = '';
    if (enCurso(g)) marca = '<span class="tag brand">En curso</span>';
    else if (pend > 0) marca = `<span class="tag amber num">${dinero(pend)}</span>`;
    else if (g.estudiantes.length) marca = '<span class="tag green">Al día</span>';
    return `<button class="clase ${terminada(g) ? 'pasada' : ''}" data-act="abrir" data-id="${esc(g.id)}">
        <span class="clase-t">${izq}</span>
        <span class="clase-m"><b>${esc(titulo(g))}</b><small>${esc(subtitulo(g))}</small></span>
        <span class="clase-r">${asientos(g)}${marca}</span>
    </button>`;
}

const listaClases = (arr, conFecha) => `<div class="card lista">${arr.map(g => filaClase(g, conFecha)).join('')}</div>`;

/* ---------- Vista: Inicio ---------- */
function renderInicio() {
    if (errorCarga) {
        $('v-inicio').innerHTML = `<div class="card vacio"><b>No se pudieron leer los datos guardados</b>
            Sus datos no se modificaron. Restaure un respaldo desde la sección Perfil.</div>`;
        return;
    }
    const h = hoy(), manana = sumarDias(h, 1), limite = sumarDias(h, 7);
    const deHoy = grupos.filter(g => g.fecha === h).sort(orden);
    const deManana = grupos.filter(g => g.fecha === manana).sort(orden);
    const proximas = grupos.filter(g => g.fecha > manana && g.fecha <= limite).sort(orden);

    const d = aFecha(h);
    const lunes = sumarDias(h, -((d.getDay() + 6) % 7));
    const domingo = sumarDias(lunes, 6);
    const semana = grupos.filter(g => g.fecha >= lunes && g.fecha <= domingo).length;
    const mes = h.slice(0, 7);
    const cobrado = grupos.reduce((t, g) => t + g.estudiantes.reduce((u, s) => u + s.pagos.filter(p => p.fecha.startsWith(mes)).reduce((v, p) => v + p.monto, 0), 0), 0);
    const lista = deudas();
    const porCobrar = lista.reduce((t, x) => t + x.total, 0);

    const pendientesHoy = deHoy.filter(g => !terminada(g));
    let resumen = 'Hoy no hay clases.';
    if (deHoy.length) {
        resumen = `Hoy: ${plural(deHoy.length, 'clase', 'clases')}.`;
        if (pendientesHoy.length) resumen += ` La siguiente es a las ${hora12(rangoHoras(pendientesHoy[0])[0])}.`;
        else resumen += ' Ya terminaron todas.';
    }

    const respaldoViejo = !NUBE && grupos.length && (!ajustes.ultimoRespaldo ||
        (aFecha(h) - aFecha(ajustes.ultimoRespaldo)) / 864e5 >= DIAS_RESPALDO);
    const seccion = (nombre, arr) => arr.length ? `<div class="sec-h"><h2>${nombre}</h2></div>${listaClases(arr, false)}` : '';

    let agenda;
    if (!grupos.length) {
        agenda = `<div class="card vacio"><b>Empiece creando su primera clase</b>Después podrá agregar estudiantes y registrar pagos.<br>
            <button class="btn primary" data-act="nuevaClase">${icono('mas')}Nueva clase</button></div>`;
    } else if (!deHoy.length && !deManana.length && !proximas.length) {
        agenda = `<div class="card vacio"><b>Semana libre</b>No hay clases en los próximos 7 días.<br>
            <button class="btn primary" data-act="nuevaClase">${icono('mas')}Nueva clase</button></div>`;
    } else {
        agenda = seccion('Hoy', deHoy) + seccion('Mañana', deManana) +
            (proximas.length ? `<div class="sec-h"><h2>Próximos días</h2><button class="link" data-act="ir" data-view="clases">Ver todas</button></div>${listaClases(proximas, true)}` : '');
    }

    const lateral = lista.length ? `<div class="sec-h"><h2>Por cobrar</h2><button class="link" data-act="ir" data-view="cobros">Ver todo</button></div>
        <div class="card lista">${lista.slice(0, 6).map(x => `<button class="mini-deuda" data-act="ir" data-view="cobros"><span>${esc(x.nombre)}</span><b>${dinero(x.total)}</b></button>`).join('')}</div>`
        : (grupos.length ? `<div class="sec-h"><h2>Por cobrar</h2></div><div class="card vacio"><b>Todo al día</b>No hay saldos pendientes.</div>` : '');

    $('v-inicio').innerHTML = `
        ${respaldoViejo ? `<div class="banner"><span>Sus datos están solo en este navegador. Último respaldo: ${ajustes.ultimoRespaldo ? esc(fechaAnio(ajustes.ultimoRespaldo)) : 'nunca'}.</span><button class="btn small" data-act="exportarJSON">Descargar respaldo</button></div>` : ''}
        ${bannerLocal()}
        <div class="page-h">
            <div>${ajustes.nombre ? `<p class="saludo">Hola, ${esc(ajustes.nombre.trim().split(/\s+/)[0])}</p>` : ''}<h1>${esc(capital(fechaLarga(h)))}</h1><p>${esc(resumen)}</p></div>
            <button class="btn primary" data-act="nuevaClase">${icono('mas')}Nueva clase</button>
        </div>
        <div class="stats">
            <div class="card stat"><small>Cobrado este mes</small><b>${dinero(cobrado)}</b></div>
            <button class="card stat ${porCobrar > 0 ? 'alerta' : ''}" data-act="ir" data-view="cobros"><small>Por cobrar</small><b>${dinero(porCobrar)}</b></button>
            <div class="card stat"><small>Clases esta semana</small><b>${semana}</b></div>
        </div>
        <div class="cols"><div>${agenda}</div><div>${lateral}</div></div>`;
}
const capital = s => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- Vista: Calendario ---------- */
const hoyDate = new Date();
const E = {
    vista: 'inicio',
    anio: hoyDate.getFullYear(),
    mes: hoyDate.getMonth(),
    dia: iso(hoyDate),
    detalle: null,
    editando: null,
    alumno: null,
    pago: null,
};

function claseEvento(g) {
    if (!g.estudiantes.length) return 'vacia';
    return pendienteGrupo(g) > 0 ? 'debe' : '';
}

function renderCalendario() {
    const { anio, mes } = E;
    $('calMes').textContent = new Date(anio, mes, 1).toLocaleDateString('es-CR', { month: 'long', year: 'numeric' });
    const nombres = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const huecos = (new Date(anio, mes, 1).getDay() + 6) % 7;
    const dias = new Date(anio, mes + 1, 0).getDate();
    const h = hoy();
    let html = nombres.map(n => `<div class="cal-dow">${n}</div>`).join('');
    html += '<div class="cal-day fuera"></div>'.repeat(huecos);
    for (let d = 1; d <= dias; d++) {
        const f = `${anio}-${pad(mes + 1)}-${pad(d)}`;
        const delDia = grupos.filter(g => g.fecha === f).sort(orden);
        const clases = ['cal-day', f === h ? 'hoy' : '', f === E.dia ? 'sel' : ''].join(' ');
        const etiqueta = `${d}${delDia.length ? ', ' + plural(delDia.length, 'clase', 'clases') : ''}`;
        html += `<button class="${clases}" data-act="dia" data-fecha="${f}" aria-label="${etiqueta}" ${f === E.dia ? 'aria-pressed="true"' : 'aria-pressed="false"'}>
            <span class="cal-n">${d}</span>
            ${delDia.slice(0, 3).map(g => `<span class="cal-ev ${claseEvento(g)}">${hora12(rangoHoras(g)[0])}</span>`).join('')}
            ${delDia.length > 3 ? `<span class="cal-ev vacia">+${delDia.length - 3} más</span>` : ''}
            ${delDia.length ? `<span class="cal-dots">${delDia.slice(0, 4).map(g => `<span class="cal-dot ${claseEvento(g)}"></span>`).join('')}</span>` : ''}
        </button>`;
    }
    const resto = (7 - ((huecos + dias) % 7)) % 7;
    html += '<div class="cal-day fuera"></div>'.repeat(resto);
    $('calGrid').innerHTML = html;

    const delDia = grupos.filter(g => g.fecha === E.dia).sort(orden);
    $('dayPanel').innerHTML = `<div class="day-h"><h2>${esc(fechaLarga(E.dia))}</h2></div>
        ${delDia.length ? delDia.map(g => filaClase(g)).join('') : '<div class="vacio">Sin clases este día.</div>'}
        <div class="day-f"><button class="btn block" data-act="nuevaClase" data-fecha="${E.dia}">${icono('mas')}Agregar clase este día</button></div>`;
}

/* ---------- Vista: Clases ---------- */
function renderClases() {
    const q = plano($('fBuscar').value), tipo = $('fTipo').value, estado = $('fEstado').value,
        pago = $('fPago').value, desde = $('fDesde').value, hasta = $('fHasta').value;
    let arr = grupos.filter(g => {
        if (q && !g.estudiantes.some(s => plano(s.nombre).includes(q) || plano(s.materia).includes(q))) return false;
        if (tipo && g.tipo !== tipo) return false;
        if (estado === 'proxima' && terminada(g)) return false;
        if (estado === 'finalizada' && !terminada(g)) return false;
        if (pago === 'debe' && pendienteGrupo(g) <= 0) return false;
        if (pago === 'aldia' && pendienteGrupo(g) > 0) return false;
        if (desde && g.fecha < desde) return false;
        if (hasta && g.fecha > hasta) return false;
        return true;
    });
    const proximas = arr.filter(g => !terminada(g)).sort(orden);
    const pasadas = arr.filter(terminada).sort((a, b) => orden(b, a));
    const hayFiltros = q || tipo || estado || pago || desde || hasta;
    $('fConteo').textContent = plural(arr.length, 'clase', 'clases');
    $('fLimpiar').hidden = !hayFiltros;

    if (!arr.length) {
        $('clasesLista').innerHTML = `<div class="card vacio"><b>${hayFiltros ? 'Sin resultados' : 'Todavía no hay clases'}</b>${hayFiltros ? 'Pruebe con otros filtros.' : 'Cree la primera para empezar.'}</div>`;
        return;
    }
    const porMes = lista => {
        const bloques = new Map();
        lista.forEach(g => {
            const m = g.fecha.slice(0, 7);
            if (!bloques.has(m)) bloques.set(m, []);
            bloques.get(m).push(g);
        });
        return [...bloques].map(([m, l]) => `<div class="mes-h">${esc(capital(aFecha(m + '-01').toLocaleDateString('es-CR', { month: 'long', year: 'numeric' })))}</div>${listaClases(l, true)}`).join('');
    };
    $('clasesLista').innerHTML =
        (proximas.length ? `<div class="sec-h"><h2>Próximas</h2></div>${porMes(proximas)}` : '') +
        (pasadas.length ? `<div class="sec-h"><h2>Finalizadas</h2></div>${porMes(pasadas)}` : '');
}

/* ---------- Vista: Cobros ---------- */
function renderCobros() {
    const lista = deudas();
    const total = lista.reduce((t, x) => t + x.total, 0);
    const cabecera = `<div class="page-h"><div><h1>Cobros</h1>
        <p>${lista.length ? `${dinero(total)} por cobrar a ${plural(lista.length, 'estudiante', 'estudiantes')}.` : 'Saldos pendientes por estudiante.'}</p></div></div>`;
    if (!lista.length) {
        $('v-cobros').innerHTML = cabecera + '<div class="card vacio"><b>Todo al día</b>No hay saldos pendientes.</div>';
        return;
    }
    $('v-cobros').innerHTML = cabecera + lista.map(x => `<div class="card deuda">
        <div class="deuda-h"><b>${esc(x.nombre)}</b>
            <div class="linea-r"><span class="monto">${dinero(x.total)}</span>${x.lineas.length > 1 ? `<button class="btn small" data-act="cobrarTodo" data-nombre="${esc(plano(x.nombre))}">Cobrar todo</button>` : ''}</div></div>
        ${x.lineas.map(l => `<div class="linea">
            <button class="linea-a" data-act="abrir" data-id="${esc(l.g.id)}"><b>${esc(fechaCorta(l.g.fecha))} · ${hora12(rangoHoras(l.g)[0])}</b><small>${esc(l.s.materia)}${terminada(l.g) ? '' : ' · Clase próxima'}</small></button>
            <div class="linea-r"><span class="num">${dinero(l.monto)}</span><button class="btn small primary" data-act="pagar" data-id="${esc(l.g.id)}" data-sid="${esc(l.s.id)}">Cobrar</button></div>
        </div>`).join('')}
    </div>`).join('');
}

/* ---------- Vista: Datos ---------- */
function renderPerfil() {
    $('pNombre').value = ajustes.nombre || '';
    $('pTelefono').value = ajustes.telefono || '';
    $('pMaterias').value = ajustes.materias || '';
    $('aGrupal').value = ajustes.precioGrupal;
    $('aIndividual').value = ajustes.precioIndividual;
    $('aMax').value = ajustes.maxGrupal;
    $('perfilAvisos').innerHTML = bannerLocal();
    $('cardCuenta').hidden = !NUBE;
    if (NUBE && Nube.usuario()) $('pCorreo').textContent = `Sesión iniciada como ${Nube.usuario().email}.`;
    $('respaldoDesc').textContent = NUBE
        ? 'Sus datos se guardan en su cuenta y puede verlos desde cualquier dispositivo. Igual puede descargar una copia cuando quiera.'
        : 'Sus datos se guardan solo en este navegador. Descargue un respaldo con frecuencia y úselo para restaurarlos o pasarlos a otro dispositivo.';
    $('borrarDesc').textContent = NUBE
        ? 'Elimina todas las clases, estudiantes y pagos de su cuenta.'
        : 'Elimina todas las clases, estudiantes y pagos de este navegador.';
    $('ultimoRespaldo').textContent = `Último respaldo: ${ajustes.ultimoRespaldo ? fechaAnio(ajustes.ultimoRespaldo) : 'nunca'}.`;
    const estudiantes = grupos.reduce((t, g) => t + g.estudiantes.length, 0);
    const unicos = new Set(grupos.flatMap(g => g.estudiantes.map(s => plano(s.nombre)))).size;
    const cobrado = grupos.reduce((t, g) => t + cobradoGrupo(g), 0);
    const pendiente = grupos.reduce((t, g) => t + pendienteGrupo(g), 0);
    $('totales').innerHTML = [
        ['Clases', grupos.length],
        ['Cupos ocupados', estudiantes],
        ['Estudiantes distintos', unicos],
        ['Cobrado', dinero(cobrado)],
        ['Por cobrar', dinero(pendiente)],
    ].map(([k, v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`).join('');
}

/* ---------- Detalle de clase ---------- */
function renderDetalle() {
    const g = grupo(E.detalle);
    if (!g) { if ($('dlgDetalle').open) $('dlgDetalle').close(); return; }
    const total = g.precio * g.estudiantes.length;
    const lleno = g.estudiantes.length >= cupo(g);
    const estado = enCurso(g) ? '<span class="tag brand">En curso</span>'
        : terminada(g) ? '<span class="tag">Finalizada</span>' : '<span class="tag green">Próxima</span>';
    const reabrible = g.finalizado && new Date() < fin(g);

    const filas = g.estudiantes.map(s => {
        const sal = saldo(g, s), est = estadoPago(g, s);
        const texto = est === 'pagado'
            ? (sal < 0 ? `A favor ${dinero(-sal)}` : 'Pagado')
            : `Debe ${dinero(sal)}`;
        return `<div class="alumno">
            <span class="seat ${est}"></span>
            <div class="alumno-i"><b>${esc(s.nombre)}</b><small class="num">${esc(s.materia)} · ${texto}</small></div>
            <button class="btn small ${est === 'pagado' ? '' : 'primary'}" data-act="pagar" data-id="${esc(g.id)}" data-sid="${esc(s.id)}">${est === 'pagado' ? 'Pagos' : 'Cobrar'}</button>
            <button class="icon-btn" data-act="editarAlumno" data-sid="${esc(s.id)}" aria-label="Editar a ${esc(s.nombre)}">${icono('lapiz')}</button>
        </div>`;
    }).join('');

    $('detalle').innerHTML = `
        <header class="sheet-h">
            <div>
                <h2 id="dTitulo">${esc(fechaLarga(g.fecha))}</h2>
                <p class="num">${textoHorario(g.horario)} · ${g.tipo === 'grupal' ? 'Grupal' : 'Individual'} · ${dinero(g.precio)} ${g.tipo === 'grupal' ? 'por estudiante' : ''} ${estado}</p>
            </div>
            <button class="icon-btn" data-act="cerrar" aria-label="Cerrar">${icono('x')}</button>
        </header>
        <div class="sheet-b">
            <div class="resumen">
                <div><small>Total</small><b>${dinero(total)}</b></div>
                <div><small>Cobrado</small><b>${dinero(cobradoGrupo(g))}</b></div>
                <div><small>Pendiente</small><b>${dinero(pendienteGrupo(g))}</b></div>
            </div>
            <div>
                <div class="sec-h"><h2>Estudiantes</h2><span class="muted num">${g.estudiantes.length} de ${cupo(g)}</span></div>
                ${filas || '<p class="muted">Todavía no hay estudiantes en esta clase.</p>'}
                <div style="margin-top:10px">
                    ${lleno ? '<span class="muted">Cupo lleno.</span>' : `<button class="btn block" data-act="agregarAlumno">${icono('mas')}Agregar estudiante</button>`}
                </div>
            </div>
            <label class="field"><span>Notas</span><textarea class="input" id="dNotas" rows="2" placeholder="Temas vistos, tareas, observaciones…">${esc(g.notas)}</textarea></label>
            <div class="acciones">
                <button class="btn small" data-act="editarClase">${icono('lapiz')}Editar clase</button>
                <button class="btn small" data-act="googleCal">Agregar a Google Calendar</button>
                <button class="btn small" data-act="repetirClase">Repetir en 7 días</button>
                <button class="btn small" data-act="exportarGrupoCSV">Exportar CSV</button>
                ${reabrible ? '<button class="btn small" data-act="reabrir">Reabrir</button>'
            : (!terminada(g) ? '<button class="btn small" data-act="finalizar">Marcar finalizada</button>' : '')}
                <button class="btn small danger" data-act="eliminarClase">${icono('basura')}Eliminar</button>
            </div>
        </div>`;
}

function abrirDetalle(id) {
    E.detalle = id;
    renderDetalle();
    if (!$('dlgDetalle').open) $('dlgDetalle').showModal();
    $('dlgDetalle').append($('toast')); // el aviso debe seguir siendo clicable sobre el diálogo
}

/* ---------- Formulario de clase ---------- */
function pintarSlots() {
    $('cSlots').innerHTML = HORARIOS.map(h => `<label class="chip"><input type="radio" name="slot" value="${h}" /><span>${textoHorario(h)}</span></label>`).join('') +
        '<label class="chip"><input type="radio" name="slot" value="otro" /><span>Otro horario</span></label>';
}
const radio = nombre => document.querySelector(`input[name="${nombre}"]:checked`);
function leerHorario() {
    const r = radio('slot');
    if (!r) return '';
    if (r.value !== 'otro') return r.value;
    const a = $('cIni').value, b = $('cFin').value;
    return a && b ? `${a}-${b}` : '';
}
function revisarChoque() {
    const horario = leerHorario(), fecha = $('cFecha').value;
    const lista = fecha && horario ? choques(fecha, horario, E.editando) : [];
    $('cAviso').hidden = !lista.length;
    if (lista.length) $('cAviso').textContent = `Ya hay una clase de ${textoHorario(lista[0].horario)} ese día. Puede guardarla de todos modos.`;
}
function abrirFormClase(g, fecha) {
    E.editando = g ? g.id : null;
    $('formClase').reset();
    $('cError').hidden = true;
    $('dlgClaseT').textContent = g ? 'Editar clase' : 'Nueva clase';
    $('cGuardar').textContent = g ? 'Guardar cambios' : 'Crear clase';
    $('cRepetirBox').hidden = !!g;
    $('cFecha').value = g ? g.fecha : (fecha || hoy());
    const tipo = g ? g.tipo : 'grupal';
    document.querySelector(`input[name="tipo"][value="${tipo}"]`).checked = true;
    $('cPrecio').value = g ? g.precio : ajustes.precioGrupal;
    $('cNotas').value = g ? g.notas : '';
    if (g) {
        const estandar = HORARIOS.includes(g.horario);
        document.querySelector(`input[name="slot"][value="${estandar ? g.horario : 'otro'}"]`).checked = true;
        [$('cIni').value, $('cFin').value] = rangoHoras(g);
        $('cOtro').hidden = estandar;
    } else {
        $('cOtro').hidden = true;
    }
    revisarChoque();
    $('dlgClase').showModal();
}

/* ---------- Formulario de estudiante ---------- */
function abrirFormAlumno(g, s) {
    E.alumno = s ? s.id : null;
    $('formAlumno').reset();
    $('eError').hidden = true;
    $('dlgAlumnoT').textContent = s ? 'Editar estudiante' : 'Agregar estudiante';
    $('eGuardar').textContent = s ? 'Guardar' : 'Agregar';
    $('eQuitar').hidden = !s;
    $('ePagoBox').hidden = !!s;
    $('ePagoBtn').textContent = `Pagó completo: ${dinero(g.precio)}`;
    $('eNombre').value = s ? s.nombre : '';
    $('eMateria').value = s ? s.materia : '';
    const todos = grupos.flatMap(x => x.estudiantes);
    const unicos = l => [...new Set(l.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    $('listaNombres').innerHTML = unicos(todos.map(x => x.nombre)).map(n => `<option value="${esc(n)}"></option>`).join('');
    const materiasPerfil = String(ajustes.materias || '').split(',').map(m => m.trim());
    $('listaMaterias').innerHTML = unicos(todos.map(x => x.materia).concat(materiasPerfil)).map(n => `<option value="${esc(n)}"></option>`).join('');
    $('dlgAlumno').showModal();
}

/* ---------- Formulario de pago ---------- */
function abrirPago(g, s) {
    E.pago = { gid: g.id, sid: s.id };
    $('pError').hidden = true;
    const sal = Math.max(0, saldo(g, s));
    $('dlgPagoT').textContent = s.nombre;
    $('pInfo').textContent = sal > 0 ? `Saldo: ${dinero(sal)} de ${dinero(g.precio)}` : `Al día · ${dinero(pagado(s))} pagados`;
    $('pMonto').value = sal || '';
    $('pFecha').value = hoy();
    $('pAtajos').innerHTML = sal > 1 ? `<button type="button" class="btn small" data-act="montoPago" data-monto="${sal}">Todo: ${dinero(sal)}</button>
        <button type="button" class="btn small" data-act="montoPago" data-monto="${Math.round(sal / 2)}">Mitad: ${dinero(sal / 2)}</button>` : '';
    $('pHistorial').innerHTML = s.pagos.length ? `<div class="legend">Pagos registrados</div>` + s.pagos.map(p => `<div class="pago-h">
        <span class="num">${dinero(p.monto)} <span class="muted">· ${esc(fechaAnio(p.fecha))}</span></span>
        <button type="button" class="icon-btn" data-act="quitarPago" data-pid="${esc(p.id)}" aria-label="Eliminar pago de ${dinero(p.monto)}">${icono('basura')}</button>
    </div>`).join('') : '';
    if (!$('dlgPago').open) $('dlgPago').showModal();
    $('pMonto').select();
}

/* ---------- Google Calendar y exportaciones ---------- */
function fechaGoogle(fecha, h) { return `${fecha.replace(/-/g, '')}T${h.replace(':', '')}00`; }
function abrirGoogle(g) {
    const [a, b] = rangoHoras(g);
    const lineas = [`Tutoría ${g.tipo}`, ...g.estudiantes.map(s => `- ${s.nombre} (${s.materia})`)];
    if (g.notas) lineas.push('', `Notas: ${g.notas}`);
    const nombres = g.estudiantes.map(s => s.nombre).join(', ');
    const tituloEv = `Tutoría ${g.tipo}${nombres ? ': ' + nombres : ''}`;
    const url = 'https://calendar.google.com/calendar/render?action=TEMPLATE'
        + `&text=${encodeURIComponent(tituloEv)}`
        + `&dates=${fechaGoogle(g.fecha, a)}/${fechaGoogle(g.fecha, b)}`
        + '&ctz=America/Costa_Rica'
        + `&details=${encodeURIComponent(lineas.join('\n'))}`;
    window.open(url, '_blank', 'noopener');
}

function descargar(nombre, contenido, tipo) {
    const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function aCSV(filas) {
    return '﻿' + filas.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
}
const CSV_CABECERA = ['Fecha', 'Horario', 'Tipo', 'Estudiante', 'Materia', 'Precio', 'Pagado', 'Saldo'];
const filasCSV = g => g.estudiantes.map(s => [g.fecha, g.horario, g.tipo, s.nombre, s.materia, g.precio, pagado(s), saldo(g, s)]);

/* ---------- Avisos y confirmaciones ---------- */
let toastTimer;
function aviso(texto, deshacer) {
    const t = $('toast');
    const anfitrion = [...document.querySelectorAll('dialog[open]')].pop() || document.body;
    if (t.parentElement !== anfitrion) anfitrion.append(t);
    $('toastTxt').textContent = texto;
    const b = $('toastBtn');
    b.hidden = !deshacer;
    b.onclick = deshacer ? () => { deshacer(); t.hidden = true; } : null;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, deshacer ? 8000 : 3500);
}
document.addEventListener('close', e => {
    const t = $('toast');
    if (e.target.contains(t)) {
        ([...document.querySelectorAll('dialog[open]')].pop() || document.body).append(t);
    }
}, true);

function cambiar(mensaje, fn) {
    const antes = JSON.stringify(grupos);
    fn();
    guardar();
    render();
    aviso(mensaje, () => {
        grupos = JSON.parse(antes).map(normalizarGrupo);
        guardar();
        render();
    });
}

function preguntar(tituloQ, texto, botones) {
    return new Promise(resolver => {
        const d = $('dlgConfirmar');
        $('qTitulo').textContent = tituloQ;
        $('qTexto').textContent = texto;
        const pie = $('qBotones');
        pie.innerHTML = '';
        let valor = null;
        botones.forEach(b => {
            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'btn ' + (b.clase || '');
            el.textContent = b.texto;
            el.onclick = () => { valor = b.valor; d.close(); };
            pie.append(el);
        });
        d.addEventListener('close', () => resolver(valor), { once: true });
        d.showModal();
    });
}

/* ---------- Navegación y render ---------- */
const VISTAS = ['inicio', 'calendario', 'clases', 'cobros', 'perfil'];
const pintores = { inicio: renderInicio, calendario: renderCalendario, clases: renderClases, cobros: renderCobros, perfil: renderPerfil };

function render() {
    VISTAS.forEach(v => { $('v-' + v).hidden = v !== E.vista; });
    document.querySelector('.fab').hidden = E.vista === 'calendario' || E.vista === 'perfil';
    document.querySelectorAll('.nav button').forEach(b => {
        if (b.dataset.view === E.vista) b.setAttribute('aria-current', 'page');
        else b.removeAttribute('aria-current');
    });
    const n = deudas().length;
    $('navBadge').hidden = !n;
    $('navBadge').textContent = n;
    pintores[E.vista]();
    if (E.detalle && $('dlgDetalle').open) renderDetalle();
}

function irA(vista) {
    if (location.hash === '#' + vista) { window.scrollTo(0, 0); return; }
    location.hash = vista;
}
function leerRuta() {
    const v = location.hash.slice(1) === 'datos' ? 'perfil' : location.hash.slice(1);
    E.vista = VISTAS.includes(v) ? v : 'inicio';
    render();
    window.scrollTo(0, 0);
}
window.addEventListener('hashchange', leerRuta);

/* ---------- Acciones ---------- */
const actual = () => grupo(E.detalle);
const acciones = {
    ir: d => irA(d.view),
    nuevaClase: d => abrirFormClase(null, d.fecha),
    abrir: d => abrirDetalle(d.id),
    cerrar: (d, el) => el.closest('dialog').close(),
    dia: d => { E.dia = d.fecha; renderCalendario(); },
    mes: d => {
        const f = new Date(E.anio, E.mes + Number(d.delta), 1);
        E.anio = f.getFullYear();
        E.mes = f.getMonth();
        renderCalendario();
    },
    mesHoy: () => {
        const f = new Date();
        E.anio = f.getFullYear();
        E.mes = f.getMonth();
        E.dia = iso(f);
        renderCalendario();
    },
    limpiarFiltros: () => {
        ['fBuscar', 'fTipo', 'fEstado', 'fPago', 'fDesde', 'fHasta'].forEach(id => { $(id).value = ''; });
        renderClases();
    },
    agregarAlumno: () => abrirFormAlumno(actual()),
    editarAlumno: d => { const g = actual(); abrirFormAlumno(g, alumno(g, d.sid)); },
    quitarAlumno: () => {
        const g = actual();
        const s = alumno(g, E.alumno);
        $('dlgAlumno').close();
        cambiar(`${s.nombre} se quitó de la clase`, () => { g.estudiantes = g.estudiantes.filter(x => x.id !== s.id); });
    },
    ePagoCompleto: () => { $('ePago').value = actual().precio; },
    pagar: d => { const g = grupo(d.id); abrirPago(g, alumno(g, d.sid)); },
    montoPago: d => { $('pMonto').value = d.monto; },
    quitarPago: d => {
        const g = grupo(E.pago.gid), s = alumno(g, E.pago.sid);
        cambiar('Pago eliminado', () => { s.pagos = s.pagos.filter(p => p.id !== d.pid); });
        abrirPago(grupo(E.pago.gid), alumno(grupo(E.pago.gid), E.pago.sid));
    },
    cobrarTodo: d => {
        const x = deudas().find(y => plano(y.nombre) === d.nombre);
        cambiar(`${dinero(x.total)} cobrados a ${x.nombre}`, () => {
            x.lineas.forEach(l => l.s.pagos.push({ id: uid(), monto: l.monto, fecha: hoy() }));
        });
    },
    editarClase: () => abrirFormClase(actual()),
    googleCal: () => abrirGoogle(actual()),
    repetirClase: () => {
        const g = actual();
        const fecha = sumarDias(g.fecha, 7);
        cambiar(`Clase copiada al ${fechaCorta(fecha)}`, () => {
            grupos.push({
                ...g, id: uid(), fecha, finalizado: false,
                estudiantes: g.estudiantes.map(s => ({ id: uid(), nombre: s.nombre, materia: s.materia, pagos: [] })),
            });
        });
    },
    exportarGrupoCSV: () => {
        const g = actual();
        descargar(`clase-${g.fecha}.csv`, aCSV([CSV_CABECERA, ...filasCSV(g)]), 'text/csv;charset=utf-8');
    },
    finalizar: () => { const g = actual(); cambiar('Clase finalizada', () => { g.finalizado = true; }); },
    reabrir: () => { const g = actual(); cambiar('Clase reabierta', () => { g.finalizado = false; }); },
    eliminarClase: () => {
        const g = actual();
        $('dlgDetalle').close();
        cambiar('Clase eliminada', () => { grupos = grupos.filter(x => x.id !== g.id); });
    },
    exportarJSON: () => {
        const datos = { app: 'tutorias', version: 2, exportado: new Date().toISOString(), ajustes, grupos };
        descargar(`tutorias-respaldo-${hoy()}.json`, JSON.stringify(datos, null, 2), 'application/json');
        ajustes.ultimoRespaldo = hoy();
        guardar();
        render();
        aviso('Respaldo descargado');
    },
    exportarTodoCSV: () => {
        const filas = grupos.slice().sort(orden).flatMap(filasCSV);
        descargar(`tutorias-${hoy()}.csv`, aCSV([CSV_CABECERA, ...filas]), 'text/csv;charset=utf-8');
    },
    elegirImport: () => $('fileImport').click(),
    borrarTodo: async () => {
        const r = await preguntar('¿Borrar todos los datos?', `Se eliminarán ${plural(grupos.length, 'clase', 'clases')} con sus estudiantes y pagos.`, [
            { texto: 'Cancelar', valor: null },
            { texto: 'Borrar todo', valor: 'si', clase: 'danger-solid' },
        ]);
        if (r === 'si') cambiar('Datos borrados', () => { grupos = []; });
    },
};

document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (el && acciones[el.dataset.act]) acciones[el.dataset.act](el.dataset, el);
});

/* ---------- Formularios ---------- */
function error(id, texto) {
    $(id).textContent = texto;
    $(id).hidden = false;
}

$('dlgDetalle').addEventListener('click', e => { if (e.target === $('dlgDetalle')) $('dlgDetalle').close(); });
$('dlgDetalle').addEventListener('close', () => { E.detalle = null; });
$('detalle').addEventListener('change', e => {
    if (e.target.id !== 'dNotas') return;
    const g = actual();
    if (g) { g.notas = e.target.value; guardar(); }
});

$('formClase').addEventListener('change', e => {
    if (e.target.name === 'slot') {
        $('cOtro').hidden = e.target.value !== 'otro';
    }
    if (e.target.name === 'tipo') {
        $('cPrecio').value = e.target.value === 'individual' ? ajustes.precioIndividual : ajustes.precioGrupal;
    }
    revisarChoque();
});

$('formClase').addEventListener('submit', e => {
    e.preventDefault();
    $('cError').hidden = true;
    const fecha = $('cFecha').value;
    const horario = leerHorario();
    const tipo = radio('tipo').value;
    const precio = Number($('cPrecio').value);
    const notas = $('cNotas').value.trim();
    if (!fecha) return error('cError', 'Elija una fecha.');
    if (!horario) return error('cError', 'Elija un horario.');
    const [a, b] = horario.split('-');
    if (a >= b) return error('cError', 'La hora de fin debe ser después de la de inicio.');
    if ($('cPrecio').value === '' || precio < 0) return error('cError', 'Indique un precio válido.');

    if (E.editando) {
        const g = grupo(E.editando);
        if (tipo === 'individual' && g.estudiantes.length > 1) {
            return error('cError', 'Una clase individual solo admite 1 estudiante. Quite los demás primero.');
        }
        $('dlgClase').close();
        cambiar('Clase actualizada', () => { Object.assign(g, { fecha, horario, tipo, precio, notas }); });
        return;
    }
    const repetir = Number($('cRepetir').value);
    const nueva = { id: uid(), fecha, horario, tipo, precio, notas, finalizado: false, estudiantes: [] };
    $('dlgClase').close();
    cambiar(repetir ? `${repetir + 1} clases creadas` : 'Clase creada', () => {
        grupos.push(nueva);
        for (let i = 1; i <= repetir; i++) {
            grupos.push({ ...nueva, id: uid(), fecha: sumarDias(fecha, 7 * i), estudiantes: [] });
        }
    });
    abrirDetalle(nueva.id);
});

$('eNombre').addEventListener('change', () => {
    if ($('eMateria').value) return;
    const nombre = plano($('eNombre').value);
    const previo = grupos.slice().sort((a, b) => orden(b, a)).flatMap(g => g.estudiantes).find(s => plano(s.nombre) === nombre);
    if (previo) $('eMateria').value = previo.materia;
});

$('formAlumno').addEventListener('submit', e => {
    e.preventDefault();
    $('eError').hidden = true;
    const g = actual();
    const nombre = $('eNombre').value.trim(), materia = $('eMateria').value.trim();
    if (!nombre) return error('eError', 'Escriba el nombre.');
    if (!materia) return error('eError', 'Escriba la materia.');
    if (E.alumno) {
        const s = alumno(g, E.alumno);
        $('dlgAlumno').close();
        cambiar('Estudiante actualizado', () => { s.nombre = nombre; s.materia = materia; });
        return;
    }
    if (g.estudiantes.length >= cupo(g)) return error('eError', 'La clase ya tiene el cupo lleno.');
    const monto = Number($('ePago').value) || 0;
    if (monto < 0) return error('eError', 'El pago no puede ser negativo.');
    $('dlgAlumno').close();
    cambiar(`${nombre} agregado a la clase`, () => {
        g.estudiantes.push({ id: uid(), nombre, materia, pagos: monto ? [{ id: uid(), monto, fecha: hoy() }] : [] });
    });
});

$('formPago').addEventListener('submit', e => {
    e.preventDefault();
    $('pError').hidden = true;
    const monto = Number($('pMonto').value), fecha = $('pFecha').value;
    if (!(monto > 0)) return error('pError', 'Escriba un monto mayor a 0.');
    if (!fecha) return error('pError', 'Elija la fecha del pago.');
    const g = grupo(E.pago.gid), s = alumno(g, E.pago.sid);
    $('dlgPago').close();
    cambiar(`Pago de ${dinero(monto)} registrado`, () => { s.pagos.push({ id: uid(), monto, fecha }); });
});

async function guardarPerfilDesdeForm() {
    const grupal = Number($('aGrupal').value), individual = Number($('aIndividual').value), max = Number($('aMax').value);
    if ($('aGrupal').value === '' || $('aIndividual').value === '' || !(grupal >= 0) || !(individual >= 0) || !(max >= 1 && max <= 30)) {
        return aviso('Revise las tarifas: deben ser números válidos.');
    }
    const nuevos = {
        nombre: $('pNombre').value.trim(), telefono: $('pTelefono').value.trim(), materias: $('pMaterias').value.trim(),
        precioGrupal: grupal, precioIndividual: individual, maxGrupal: Math.floor(max),
    };
    if (NUBE) {
        try {
            await Nube.guardarPerfil({
                nombre: nuevos.nombre, telefono: nuevos.telefono, materias: nuevos.materias,
                precio_grupal: nuevos.precioGrupal, precio_individual: nuevos.precioIndividual, max_grupal: nuevos.maxGrupal,
            });
        } catch (e) {
            console.error(e);
            return aviso('No se pudo guardar el perfil. Revise su conexión.');
        }
        Object.assign(ajustes, nuevos);
    } else {
        Object.assign(ajustes, nuevos);
        guardar();
    }
    render();
    aviso('Perfil guardado');
}
['formAjustes', 'formPerfil'].forEach(id => {
    $(id).addEventListener('change', guardarPerfilDesdeForm);
    $(id).addEventListener('submit', e => e.preventDefault());
});

$('formClave').addEventListener('submit', async e => {
    e.preventDefault();
    const clave = $('pClave').value;
    if (clave.length < 8) return aviso('La contraseña debe tener al menos 8 caracteres.');
    try {
        await Nube.cambiarClave(clave);
        $('pClave').value = '';
        aviso('Contraseña actualizada');
    } catch (err) {
        aviso(errorAuth(err));
    }
});

['fBuscar', 'fTipo', 'fEstado', 'fPago', 'fDesde', 'fHasta'].forEach(id => $(id).addEventListener('input', renderClases));

$('fileImport').addEventListener('change', async e => {
    const archivo = e.target.files[0];
    e.target.value = '';
    if (!archivo) return;
    let lista, ajustesArchivo;
    try {
        const datos = JSON.parse(await archivo.text());
        lista = Array.isArray(datos) ? datos : datos.grupos;
        if (!Array.isArray(lista)) throw new Error('formato');
        ajustesArchivo = Array.isArray(datos) ? null : datos.ajustes;
        lista = lista.filter(grupoValido).map(normalizarGrupo);
    } catch {
        return aviso('Ese archivo no es un respaldo válido.');
    }
    const r = await preguntar('Restaurar respaldo', `El archivo tiene ${plural(lista.length, 'clase', 'clases')}. Actualmente hay ${grupos.length} guardadas.`, [
        { texto: 'Cancelar', valor: null },
        { texto: 'Reemplazar todo', valor: 'reemplazar' },
        { texto: 'Combinar', valor: 'combinar', clase: 'primary' },
    ]);
    if (!r) return;
    errorCarga = false;
    cambiar('Respaldo restaurado', () => {
        if (r === 'reemplazar') {
            grupos = lista;
            if (ajustesArchivo && !NUBE) ajustes = { ...ajustes, ...ajustesArchivo };
        } else {
            const ids = new Set(grupos.map(g => g.id));
            grupos.push(...lista.filter(g => !ids.has(g.id)));
        }
    });
});

/* ==========================================================
   Cuentas de tutores (solo en modo nube)
========================================================== */
let modoAuth = 'entrar';
let usuarioCargado = null;
let ultimaCarga = 0;

const TEXTOS_AUTH = {
    entrar: { titulo: 'Entrar', sub: 'Administre sus clases y cobros desde cualquier dispositivo.', boton: 'Entrar', campos: ['correo', 'clave'] },
    registro: { titulo: 'Crear cuenta', sub: 'Para tutores y profesores. Cada cuenta tiene sus propias clases y cobros.', boton: 'Crear cuenta', campos: ['nombre', 'correo', 'clave'] },
    recuperar: { titulo: 'Recuperar contraseña', sub: 'Le enviaremos un enlace para crear una nueva.', boton: 'Enviar enlace', campos: ['correo'] },
    nueva: { titulo: 'Nueva contraseña', sub: 'Escriba la contraseña que usará a partir de ahora.', boton: 'Guardar contraseña', campos: ['clave'] },
};

function pantalla(cual) { document.body.dataset.pantalla = cual; }

function mostrarAuth(modo, mensajeOk) {
    modoAuth = modo;
    const t = TEXTOS_AUTH[modo];
    $('authTitulo').textContent = t.titulo;
    $('authSub').textContent = t.sub;
    $('authEnviar').textContent = t.boton;
    ['nombre', 'correo', 'clave'].forEach(c => { $('authCampo-' + c).hidden = !t.campos.includes(c); });
    $('authClave').autocomplete = modo === 'entrar' ? 'current-password' : 'new-password';
    $('authClave').value = '';
    $('authError').hidden = true;
    $('authOk').hidden = !mensajeOk;
    $('authOk').textContent = mensajeOk || '';
    $('authGoogle').hidden = !(Nube.conGoogle() && (modo === 'entrar' || modo === 'registro'));
    const enlace = (m, texto) => `<button type="button" class="link" data-act="authModo" data-modo="${m}">${texto}</button>`;
    $('authLinks').innerHTML = {
        entrar: enlace('recuperar', '¿Olvidó su contraseña?') + `<span class="muted">¿No tiene cuenta? ${enlace('registro', 'Crear cuenta')}</span>`,
        registro: `<span class="muted">¿Ya tiene cuenta? ${enlace('entrar', 'Entrar')}</span>`,
        recuperar: enlace('entrar', 'Volver a entrar'),
        nueva: '',
    }[modo];
    pantalla('auth');
}

function errorAuth(e) {
    const m = String((e && (e.message || e.error_description)) || '');
    if (/invalid login/i.test(m)) return 'Correo o contraseña incorrectos.';
    if (/not confirmed/i.test(m)) return 'Confirme su correo antes de entrar. Revise su bandeja de entrada.';
    if (/already registered|already exists/i.test(m)) return 'Ya existe una cuenta con ese correo. Intente entrar.';
    if (/should be different|same.*password/i.test(m)) return 'La nueva contraseña debe ser distinta de la anterior.';
    if (/password/i.test(m) && /(least|short|characters|weak)/i.test(m)) return 'La contraseña es muy débil. Use al menos 8 caracteres.';
    if (/rate limit|too many|seconds/i.test(m)) return 'Demasiados intentos. Espere unos minutos y vuelva a probar.';
    if (/fetch|network|failed to/i.test(m)) return 'Sin conexión. Revise su internet.';
    return 'No se pudo completar la acción. ' + m;
}

async function cargarCuenta() {
    pantalla('carga');
    $('cargaTexto').textContent = 'Cargando sus datos…';
    $('cargaReintentar').hidden = true;
    try {
        const usuario = Nube.usuario();
        let [p, gs] = await Promise.all([Nube.perfil(), Nube.cargar()]);
        if (!p) {
            const nombre = (usuario.user_metadata && (usuario.user_metadata.nombre || usuario.user_metadata.full_name)) || '';
            await Nube.guardarPerfil({ nombre });
            p = { nombre, telefono: '', materias: '', precio_grupal: 8000, precio_individual: 16000, max_grupal: 5 };
        }
        ajustes = {
            ...leerAjustes(),
            nombre: p.nombre || '', telefono: p.telefono || '', materias: p.materias || '',
            precioGrupal: Number(p.precio_grupal), precioIndividual: Number(p.precio_individual), maxGrupal: Number(p.max_grupal),
        };
        grupos = gs;
        usuarioCargado = usuario.id;
        ultimaCarga = Date.now();
        pintarSync('guardado');
        pantalla('app');
        leerRuta();
    } catch (e) {
        console.error(e);
        $('cargaTexto').textContent = 'No se pudieron cargar sus datos. Revise su conexión.';
        $('cargaReintentar').hidden = false;
    }
}

function limpiarSesion() {
    usuarioCargado = null;
    grupos = [];
    ajustes = leerAjustes();
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    $('toast').hidden = true;
}

async function manejarSesion(evento, sesion) {
    if (evento === 'PASSWORD_RECOVERY') { mostrarAuth('nueva'); return; }
    if (!sesion) {
        limpiarSesion();
        mostrarAuth('entrar');
        return;
    }
    if (modoAuth === 'nueva') return; // primero debe guardar la contraseña nueva
    if (usuarioCargado === sesion.user.id) return;
    if (usuarioCargado) limpiarSesion();
    await cargarCuenta();
}

$('formAuth').addEventListener('submit', async e => {
    e.preventDefault();
    const t = TEXTOS_AUTH[modoAuth];
    const nombre = $('authNombre').value.trim(), correo = $('authCorreo').value.trim(), clave = $('authClave').value;
    $('authError').hidden = true;
    $('authOk').hidden = true;
    if (t.campos.includes('nombre') && !nombre) return error('authError', 'Escriba su nombre.');
    if (t.campos.includes('correo') && !/^\S+@\S+\.\S+$/.test(correo)) return error('authError', 'Escriba un correo válido.');
    if (t.campos.includes('clave') && clave.length < 8) return error('authError', 'La contraseña debe tener al menos 8 caracteres.');
    const boton = $('authEnviar');
    boton.disabled = true;
    try {
        if (modoAuth === 'entrar') {
            await Nube.entrar(correo, clave);
        } else if (modoAuth === 'registro') {
            const datos = await Nube.registrar(correo, clave, nombre);
            if (!datos.session) mostrarAuth('entrar', `Le enviamos un correo a ${correo}. Ábralo para confirmar su cuenta y luego entre.`);
        } else if (modoAuth === 'recuperar') {
            await Nube.recuperar(correo);
            mostrarAuth('entrar', 'Si ese correo tiene una cuenta, recibirá un enlace para crear una contraseña nueva.');
        } else if (modoAuth === 'nueva') {
            await Nube.cambiarClave(clave);
            modoAuth = 'entrar';
            history.replaceState(null, '', location.pathname);
            if (usuarioCargado) { pantalla('app'); leerRuta(); } else { await cargarCuenta(); }
            aviso('Contraseña actualizada');
        }
    } catch (err) {
        error('authError', errorAuth(err));
    } finally {
        boton.disabled = false;
    }
});

/* ---------- Estado de guardado ---------- */
function pintarSync(estado) {
    document.querySelectorAll('.sync').forEach(el => {
        el.hidden = !NUBE;
        el.dataset.estado = estado;
        el.innerHTML = estado === 'guardando' ? 'Guardando…'
            : estado === 'error' ? 'Cambios sin guardar · <button type="button" class="link" data-act="reintentarSync">Reintentar</button>'
                : 'Guardado en la nube';
    });
}

/* ---------- Datos que quedaron en este navegador ---------- */
const claveSubido = () => 'tutor_local_subido_' + usuarioCargado;
function datosLocales() {
    if (!NUBE || !usuarioCargado || localStorage.getItem(claveSubido())) return [];
    try { return leerGrupos(); } catch { return []; }
}
function bannerLocal() {
    const n = datosLocales().length;
    if (!n) return '';
    return `<div class="banner"><span>Este navegador tiene ${plural(n, 'clase guardada', 'clases guardadas')} de antes de usar cuentas.</span>
        <span class="acciones"><button class="btn small" data-act="ocultarLocal">No subir</button><button class="btn small primary" data-act="subirLocal">Subir a mi cuenta</button></span></div>`;
}

Object.assign(acciones, {
    authModo: d => mostrarAuth(d.modo),
    authGoogle: async () => {
        try { await Nube.google(); } catch (err) { error('authError', errorAuth(err)); }
    },
    reintentarCarga: () => cargarCuenta(),
    reintentarSync: () => Nube.reintentar(),
    salir: async () => {
        if (Nube.pendiente()) {
            const r = await preguntar('Hay cambios sin guardar', 'Si cierra la sesión ahora, podría perderlos.', [
                { texto: 'Cancelar', valor: null },
                { texto: 'Salir igual', valor: 'si', clase: 'danger-solid' },
            ]);
            if (r !== 'si') return;
        }
        try { await Nube.salir(); } catch (err) { aviso('No se pudo cerrar la sesión.'); }
    },
    ocultarLocal: () => {
        localStorage.setItem(claveSubido(), 'oculto');
        render();
    },
    subirLocal: async () => {
        const lista = datosLocales();
        if (!lista.length) return;
        const r = await preguntar('Subir datos de este navegador', `Se agregarán ${plural(lista.length, 'clase', 'clases')} a su cuenta. Los datos del navegador no se borran.`, [
            { texto: 'Cancelar', valor: null },
            { texto: 'Subir a mi cuenta', valor: 'si', clase: 'primary' },
        ]);
        if (r !== 'si') return;
        // Identificadores nuevos para que no choquen con los de otras cuentas.
        const nuevas = lista.map(g => ({
            ...g, id: uid(),
            estudiantes: g.estudiantes.map(s => ({ ...s, id: uid(), pagos: s.pagos.map(p => ({ ...p, id: uid() })) })),
        }));
        localStorage.setItem(claveSubido(), 'subido');
        cambiar(plural(nuevas.length, 'clase subida', 'clases subidas'), () => { grupos.push(...nuevas); });
    },
});

/* ---------- Mantener todo al día ---------- */
window.addEventListener('storage', e => {
    if (NUBE || e.key !== LS_KEY) return;
    try { grupos = leerGrupos(); render(); } catch { /* se conserva lo que hay en memoria */ }
});
document.addEventListener('visibilitychange', async () => {
    if (document.hidden || document.body.dataset.pantalla !== 'app') return;
    // En la nube, al volver a la pestaña se traen cambios hechos desde otro dispositivo.
    if (NUBE && usuarioCargado && !Nube.pendiente() && Date.now() - ultimaCarga > 60000 && !document.querySelector('dialog[open]')) {
        try { grupos = await Nube.cargar(); ultimaCarga = Date.now(); } catch { /* se mantiene lo que hay */ }
    }
    render();
});
window.addEventListener('online', () => { if (NUBE && Nube.pendiente()) Nube.reintentar(); });
window.addEventListener('beforeunload', e => {
    if (NUBE && Nube.pendiente()) { e.preventDefault(); e.returnValue = ''; }
});

/* ---------- Inicio ---------- */
pintarSlots();
if (NUBE) {
    Nube.alEstado(estado => {
        pintarSync(estado);
        if (estado === 'error') aviso('No se pudieron guardar los cambios. Revise su conexión y toque Reintentar.');
    });
    Nube.alCambiarSesion(manejarSesion);
} else {
    pantalla('app');
    guardar();
    leerRuta();
}
