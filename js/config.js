/*
 * Configuración de la nube (Supabase).
 *
 * Mientras estos valores estén vacíos, el sistema funciona en "modo local":
 * un solo usuario y los datos guardados en este navegador.
 *
 * Para activar cuentas de tutores, copie los valores de
 * Supabase → Project Settings → API:
 *   - supabaseUrl:     "Project URL"
 *   - supabaseAnonKey: clave "anon" / "public"
 *
 * La clave anon es pública por diseño: la seguridad la dan las reglas RLS
 * de supabase/esquema.sql. NUNCA ponga aquí la clave "service_role".
 */
window.CONFIG = {
    supabaseUrl: '',
    supabaseAnonKey: '',
    // Ponga true solo después de activar Google en Supabase → Authentication → Providers.
    google: false,
};
