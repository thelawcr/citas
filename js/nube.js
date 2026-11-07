/*
 * Capa de nube: cuentas y datos en Supabase.
 *
 * La app trabaja con la misma lista "grupos" de siempre. Al guardar, esta capa
 * la convierte en tres tablas (clases, inscripciones, pagos), la compara con lo
 * último que quedó guardado en el servidor y envía solo las diferencias.
 * Si algo falla, nada se marca como guardado y el siguiente intento reenvía
 * todo lo pendiente.
 */
(function () {
    'use strict';
    const cfg = window.CONFIG || {};
    const TABLAS = ['clases', 'inscripciones', 'pagos'];
    const LOTE_GUARDAR = 500;
    const LOTE_BORRAR = 150;

    let sb = null;
    let usuario = null;
    let base = vacio();
    let objetivo = null;
    let cola = Promise.resolve();
    let pendiente = false;
    let alEstado = () => { };

    function vacio() { return { clases: new Map(), inscripciones: new Map(), pagos: new Map() }; }

    function configurada() {
        return !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase && window.supabase.createClient);
    }

    function cliente() {
        if (!sb) {
            sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
                auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
            });
        }
        return sb;
    }

    const urlRetorno = () => location.origin + location.pathname;

    function trozos(lista, n) {
        const r = [];
        for (let i = 0; i < lista.length; i += n) r.push(lista.slice(i, i + n));
        return r;
    }

    /* ---------- Conversión grupos <-> tablas ---------- */
    function aTablas(grupos) {
        const t = vacio();
        grupos.forEach(g => {
            t.clases.set(g.id, {
                id: g.id, fecha: g.fecha, horario: g.horario, tipo: g.tipo,
                precio: Number(g.precio), notas: g.notas || '', finalizado: !!g.finalizado,
            });
            g.estudiantes.forEach((s, i) => {
                t.inscripciones.set(s.id, { id: s.id, clase_id: g.id, nombre: s.nombre, materia: s.materia || '', orden: i });
                s.pagos.forEach(p => {
                    t.pagos.set(p.id, { id: p.id, inscripcion_id: s.id, monto: Number(p.monto), fecha: p.fecha });
                });
            });
        });
        return t;
    }

    function aGrupos(clases, inscripciones, pagos) {
        const porClase = new Map();
        const porInscripcion = new Map();
        const grupos = clases.map(c => {
            const g = {
                id: c.id, fecha: c.fecha, horario: c.horario, tipo: c.tipo,
                precio: Number(c.precio), notas: c.notas || '', finalizado: !!c.finalizado, estudiantes: [],
            };
            porClase.set(c.id, g);
            return g;
        });
        inscripciones.slice().sort((a, b) => a.orden - b.orden).forEach(i => {
            const g = porClase.get(i.clase_id);
            if (!g) return;
            const s = { id: i.id, nombre: i.nombre, materia: i.materia || '', pagos: [] };
            porInscripcion.set(i.id, s);
            g.estudiantes.push(s);
        });
        pagos.slice().sort((a, b) => (a.fecha + a.id).localeCompare(b.fecha + b.id)).forEach(p => {
            const s = porInscripcion.get(p.inscripcion_id);
            if (s) s.pagos.push({ id: p.id, monto: Number(p.monto), fecha: p.fecha });
        });
        return grupos;
    }

    /* ---------- Lectura ---------- */
    async function todas(tabla) {
        let filas = [];
        for (let desde = 0; ; desde += 1000) {
            const { data, error } = await cliente().from(tabla).select('*').order('id').range(desde, desde + 999);
            if (error) throw error;
            filas = filas.concat(data);
            if (data.length < 1000) break;
        }
        return filas;
    }

    async function cargar() {
        const [c, i, p] = await Promise.all(TABLAS.map(todas));
        const grupos = aGrupos(c, i, p);
        base = aTablas(grupos);
        objetivo = null;
        pendiente = false;
        return grupos;
    }

    /* ---------- Escritura por diferencias ---------- */
    async function aplicar() {
        const meta = objetivo;
        // Primero altas y cambios, de padres a hijos.
        for (const t of TABLAS) {
            const cambios = [];
            for (const [id, fila] of meta[t]) {
                const antes = base[t].get(id);
                if (!antes || JSON.stringify(antes) !== JSON.stringify(fila)) cambios.push(fila);
            }
            for (const lote of trozos(cambios, LOTE_GUARDAR)) {
                const { error } = await cliente().from(t).upsert(lote.map(f => ({ ...f, tutor_id: usuario.id })));
                if (error) throw error;
                lote.forEach(f => base[t].set(f.id, f));
            }
        }
        // Después bajas, de hijos a padres.
        for (const t of [...TABLAS].reverse()) {
            const borrar = [...base[t].keys()].filter(id => !meta[t].has(id));
            for (const lote of trozos(borrar, LOTE_BORRAR)) {
                const { error } = await cliente().from(t).delete().in('id', lote);
                if (error) throw error;
                lote.forEach(id => base[t].delete(id));
            }
        }
    }

    function sincronizar(grupos) {
        if (!usuario) return Promise.resolve();
        objetivo = aTablas(grupos);
        pendiente = true;
        alEstado('guardando');
        const turno = cola.then(async () => {
            if (!pendiente) return;
            const meta = objetivo;
            await aplicar();
            if (objetivo === meta) {
                pendiente = false;
                alEstado('guardado');
            }
        });
        cola = turno.catch(error => {
            console.error('Error al guardar en la nube', error);
            alEstado('error', error);
        });
        return cola;
    }

    function reintentar() {
        if (!objetivo) return Promise.resolve();
        pendiente = true;
        alEstado('guardando');
        cola = cola.then(async () => {
            await aplicar();
            pendiente = false;
            alEstado('guardado');
        }).catch(error => {
            console.error('Error al guardar en la nube', error);
            alEstado('error', error);
        });
        return cola;
    }

    /* ---------- Perfil ---------- */
    async function perfil() {
        const { data, error } = await cliente().from('perfiles').select('*').eq('id', usuario.id).maybeSingle();
        if (error) throw error;
        return data;
    }

    async function guardarPerfil(campos) {
        const { error } = await cliente().from('perfiles').upsert({ id: usuario.id, ...campos });
        if (error) throw error;
    }

    /* ---------- Cuentas ---------- */
    function alCambiarSesion(fn) {
        cliente().auth.onAuthStateChange((evento, sesion) => {
            usuario = sesion ? sesion.user : null;
            if (!usuario) { base = vacio(); objetivo = null; pendiente = false; }
            // Supabase recomienda no llamar a la API dentro de este callback.
            setTimeout(() => fn(evento, sesion), 0);
        });
    }

    const resultado = ({ data, error }) => { if (error) throw error; return data; };

    window.Nube = {
        configurada,
        conGoogle: () => !!cfg.google,
        usuario: () => usuario,
        pendiente: () => pendiente,
        alEstado: fn => { alEstado = fn; },
        alCambiarSesion,
        cargar,
        sincronizar,
        reintentar,
        perfil,
        guardarPerfil,
        entrar: (email, password) => cliente().auth.signInWithPassword({ email, password }).then(resultado),
        registrar: (email, password, nombre) => cliente().auth.signUp({
            email, password, options: { data: { nombre }, emailRedirectTo: urlRetorno() },
        }).then(resultado),
        recuperar: email => cliente().auth.resetPasswordForEmail(email, { redirectTo: urlRetorno() }).then(resultado),
        cambiarClave: password => cliente().auth.updateUser({ password }).then(resultado),
        google: () => cliente().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: urlRetorno() } }).then(resultado),
        salir: () => cliente().auth.signOut().then(resultado),
    };
})();
