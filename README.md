# Sistema de Tutorías

Agenda de clases, estudiantes y cobros para tutores y profesores.
Sitio publicado: https://thelawcr.github.io/citas/

## Dos modos de funcionamiento

| Modo | Cuándo | Dónde quedan los datos |
|------|--------|------------------------|
| **Local** | `js/config.js` está vacío (valor inicial) | Solo en el navegador de quien lo usa |
| **Nube** | `js/config.js` tiene los datos de Supabase | En la cuenta de cada tutor, desde cualquier dispositivo |

En modo nube cada tutor crea su cuenta y solo ve sus propias clases, estudiantes y pagos.
La base de datos lo garantiza con reglas de seguridad por fila (RLS), no solo el navegador.

## Activar las cuentas (modo nube)

### 1. Crear el proyecto
1. Cree una cuenta gratuita en https://supabase.com y luego **New project**.
2. Elija una región cercana (por ejemplo, *East US*) y guarde la contraseña de la base de datos en un lugar seguro.

### 2. Crear las tablas
1. En el proyecto, abra **SQL Editor → New query**.
2. Pegue todo el contenido de [`supabase/esquema.sql`](supabase/esquema.sql) y presione **Run**.
   Puede ejecutarlo de nuevo sin perder datos.

### 3. Configurar el inicio de sesión
En **Authentication → URL Configuration**:
- **Site URL:** `https://thelawcr.github.io/citas/`
- **Redirect URLs:** agregue `https://thelawcr.github.io/citas/` (y `http://localhost:8124/` si va a probar en su computadora).

En **Authentication → Sign In / Providers → Email**, deje activado **Confirm email** para que cada tutor confirme su correo.

> El servicio de correo incluido en Supabase envía pocos correos por hora y está pensado para pruebas.
> Antes de abrir el sistema a muchos tutores, configure un proveedor SMTP propio en
> **Authentication → Emails → SMTP Settings**.

### 4. Conectar el sitio
En **Project Settings → API** copie:
- **Project URL** → `supabaseUrl`
- La clave **anon / public** → `supabaseAnonKey`

y péguelos en [`js/config.js`](js/config.js). La clave *anon* es pública por diseño.
**Nunca** ponga la clave `service_role` en el sitio.

### 5. (Opcional) Entrar con Google
Active Google en **Authentication → Sign In / Providers → Google** siguiendo la guía de Supabase
y luego cambie `google: true` en `js/config.js`.

## Datos que ya existían en el navegador

Quien ya usaba la versión anterior verá, al entrar a su cuenta, el aviso
**"Subir a mi cuenta"**. Al aceptarlo, sus clases se copian a la nube.
Los datos del navegador no se borran.

## Estructura

```
index.html          Estructura de la página
css/estilos.css     Estilos
js/config.js        Conexión a Supabase (vacío = modo local)
js/nube.js          Cuentas y guardado en la nube
js/app.js           Lógica de la aplicación
supabase/esquema.sql  Tablas y reglas de seguridad
```

No necesita instalar nada ni compilar: GitHub Pages sirve los archivos tal cual.
