# Centrificador

## Tecnologias e interfaz

React 18, TypeScript, Vite y Tailwind 4, siguiendo la base de la Federacion.
Node.js conserva la API y `sharp` el procesamiento de imagenes. React permite
leer la carpeta, revisar texto e imagen y publicar esa misma vista previa.
Esta primera interfaz utiliza controles nativos; no incluye un diseño visual
personalizado ni una validacion visual completada.

Para desarrollo, ejecutar la API con `npm start` y la interfaz en otra terminal
con `npm run dev`. Ambos procesos necesitan el mismo `PUBLISH_API_KEY` en el
entorno del servidor. Vite lo agrega al proxy local `/api`; no lo incorpora al
JavaScript del navegador. Nunca usar prefijos `VITE_` para secretos de Google,
Meta o del servidor. `npm run build` comprueba TypeScript y genera `dist/`.

El proxy de Vite es solo para desarrollo local. Publicar el frontend requiere
un backend del mismo origen con autenticacion del operador antes de aceptar
`/api/*`; no exponer un proxy publico que agregue una credencial compartida.
`vite preview` sirve los archivos compilados, no la API. Actions sigue ejecutando
el backend sin necesitar que React este abierto.

Convierte el texto de un TXT o Google Doc y una imagen de una carpeta de Drive
en un post de Instagram. Lee ambos archivos en cada ejecucion y sustituye
`#EventoExterno` por `#TestDeAPI` solamente en la salida. No modifica Drive.

## Estado de esta entrega

Repositorio independiente preparado localmente. La creacion en GitHub fue
impedida por una politica administrada de acceso al navegador; no se ha creado
el remoto, cargado secrets, ejecutado Actions ni publicado un post.
El modulo procede del incremento de Federacion; no requiere el sitio web.

## GitHub Actions

Crear el repositorio **privado** `Centrificador` y subir este directorio completo,
incluida `.github`. En Settings > Secrets and variables > Actions guardar:

| Secrets                  | Uso                                                                |
| ------------------------ | ------------------------------------------------------------------ |
| `INSTAGRAM_ACCESS_TOKEN` | Token de Meta; nunca copiarlo al codigo, README o logs             |
| `GOOGLE_ACCESS_TOKEN`    | OAuth con lectura de Drive y Docs                                  |
| `PUBLISH_API_KEY`        | Secreto aleatorio de al menos 32 caracteres para el servidor local |

| Variables                 | Uso                                                              |
| ------------------------- | ---------------------------------------------------------------- |
| `DRIVE_FOLDER_ID`         | ID de la carpeta de entrada                                      |
| `INSTAGRAM_ACCOUNT_ID`    | ID numerico de la cuenta de Instagram                            |
| `META_API_VERSION`        | Version de Graph compatible con la app                           |
| `META_GRAPH_HOST`         | Host confirmado para el token; no inferirlo del nombre de la app |
| `PUBLIC_ORIGIN`           | Origen HTTPS del proxy que permite a Meta leer `/media/*`        |
| `CENTRIFICADOR_STATE_DIR` | Directorio absoluto privado y persistente, fuera del checkout    |
| `PORT`                    | Puerto local opcional, por defecto 8787                          |

El workflow **Verify** usa un runner de GitHub y datos ficticios. El workflow
**Instagram** se inicia manualmente con `preview` o `publish`, solo desde la
rama predeterminada. No publica al subir cambios ni instala una programacion.
`preview` no necesita el token de Instagram y deja el contenido en el disco
privado del runner. No sube textos, imagenes o tokens como artifacts.
`publish` vuelve a leer Drive y publica el contenido actual; no representa una
aprobacion de un preview de una ejecucion anterior.

La publicacion requiere un runner Linux propio con etiquetas `self-hosted`,
`linux`, `centrificador`, almacenamiento persistente y un proxy HTTPS existente
hacia `127.0.0.1:8787/media/*`. Esta infraestructura no esta desplegada. No basta
con guardar el token para que el workflow publique. El uso de ese runner conserva
el registro que impide duplicados entre ejecuciones y permite servir la imagen
privada a Meta mientras se procesa el post. No habilitar este runner para codigo
de terceros ni pull requests; la verificacion usa runners separados de GitHub.

En la app mostrada por el propietario, Meta indica inicio de sesion unificado
y configuracion SUAT. Falta verificar el host, la cuenta y los permisos efectivos
del token antes de ejecutar `publish`. El codigo no implementa el alta OAuth ni
renovacion automatica de tokens.

## Verificacion local

Node.js 22 o superior. Instalar dependencias con `npm install` y ejecutar
`npm test`. `sharp` esta fijado a 0.35.5; falta generar y revisar un lockfile
cuando la instalacion de dependencias este disponible.

La ejecucion previa aprobo cuatro pruebas de contenido/proveedores. Dos pruebas
HTTP quedaron impedidas por `EACCES` en el entorno del agente y siguen pendientes;
no se sustituyeron ni debilitaron. Actions tampoco se ha ejecutado.

La incorporacion de React tiene formato verificado, pero la compilacion y la
comprobacion de tipos siguen pendientes: el entorno denego crear el enlace a
las dependencias locales y no existe una instalacion propia en este checkout.
El frontend tampoco tiene una comprobacion visual o de navegacion completada.

[Contrato y funcionamiento de la API](scripts/instagram/README.md).
