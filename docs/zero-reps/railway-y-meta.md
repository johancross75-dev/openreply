# Zero Reps: puesta en marcha en Railway y Meta

Guía para dejar OpenReply funcionando para Zero Reps. Nunca pegues secretos en
un chat: van solo en Railway (Variables) y se copian desde Meta.

## 1. Servicios en Railway

| Servicio | Comando de inicio | Pre-deploy |
| --- | --- | --- |
| web | `npm run start` | `npx prisma migrate deploy` (crea/actualiza las tablas en cada deploy) |
| worker | `npm run worker` | — |
| Postgres | (plugin de Railway) | — |
| Redis | (plugin de Railway) | — |

Si el pre-deploy de migraciones ya estaba configurado en el servicio web, déjalo
como está.

## 2. Variables (servicio web **y** servicio worker)

| Variable | Valor |
| --- | --- |
| `NEXTAUTH_URL` | La URL pública, sin barra final: `https://xxxx.up.railway.app` |
| `NEXTAUTH_SECRET`, `CRON_SECRET` | Texto aleatorio largo |
| `ENCRYPTION_KEY` | 64 caracteres hex (`openssl rand -hex 32`). **No la cambies** una vez conectado Instagram: los tokens guardados dejarían de poder leerse. |
| `DATABASE_URL`, `REDIS_URL` | Referencias a los plugins de Railway |
| `EMAIL_SERVER` | `smtps://TU_USUARIO%40gmail.com:CONTRASEÑA_DE_APLICACION@smtp.gmail.com:465` (16 letras, sin espacios; la `@` del usuario se escribe `%40`) |
| `EMAIL_FROM` | `Zero Reps <tu_correo@gmail.com>` (el mismo Gmail del usuario SMTP) |
| `ALLOWED_EMAILS` | Tu correo: así nadie más puede crear cuenta en tu instancia |
| `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` | Meta → Instagram → "Configuración de la API con inicio de sesión de Instagram" |
| `FACEBOOK_APP_SECRET` | Meta → Configuración de la app → Básica → Clave secreta |
| `WEBHOOK_VERIFY_TOKEN` | Texto aleatorio; el mismo se pega en Meta |
| `COMMENT_POLL_LOOKBACK_HOURS` | `1` durante el arranque (ver punto 5) |

### Comprobar que las variables llegan bien

Abre `https://TU-APP/api/health` y mira `checks.config`. Muestra qué variable
falta, está vacía, tiene espacios o comillas, o tiene un formato incorrecto,
**sin mostrar nunca los valores**. El log del worker imprime lo mismo al
arrancar, y en una consola del servicio puedes ejecutar `npm run check:env`.

`checks.config` no cambia el código HTTP de `/api/health`, así que no afecta a
ningún healthcheck de Railway.

## 3. Meta

1. Webhook (Instagram → Configurar webhooks): URL `https://TU-APP/api/webhook`,
   token = `WEBHOOK_VERIFY_TOKEN`. Pulsa "Verificar y guardar" **después** de que
   termine el deploy. Suscribe `comments` y `messages`.
2. URL de redirección OAuth: `https://TU-APP/api/instagram/callback`.
3. La app debe estar en modo **Live (publicada)**: en modo desarrollo los
   comentarios reales no llegan, solo el botón "Test".

## 4. Campañas (configuración permanente)

Las campañas viven en `config/zero-reps/campaigns.json`:

- **Guías gratuitas** (RUTINA, GRASA, FLEXIÓN, DOMINADA, HOMBRO, MUNDO): cada una
  envía **solo su propio formulario de Tally**. Nunca el PDF, nunca la landing.
- **El Método Zero (de pago)** (SÍ, INFO, MARAVILLA): envía **solo la landing de
  venta**, nunca un formulario de Tally.
- **SÍ** solo funciona en los posts del Método Zero indicados en `postIds` y no
  se activa por DM, porque es una palabra demasiado común.
- Si un mensaje contiene una palabra gratuita y una de pago ("info de la
  rutina"), responde solo la primera de la lista (las guías van primero). Cada
  comentario y cada DM recibe como máximo una respuesta automática.

Comandos (desde una consola del servicio web, o con `railway run`):

```bash
npm run zr:campaigns -- check
```

```bash
npm run zr:campaigns -- apply --account zeroreps.official
```

```bash
npm run zr:campaigns -- apply --account zeroreps.official --confirm
```

`check` valida el archivo y lista lo que falta. `apply` sin `--confirm` solo
simula. Con `--confirm` se niega a escribir mientras quede algún `PENDIENTE` o
haya otras campañas activas en la cuenta; para pausarlas (no se borran) añade
`--deactivate-others`. Se puede ejecutar varias veces: actualiza por nombre y
conserva las estadísticas de clics.

## 5. Evitar duplicados con lo que ya se respondió a mano

- Instagram permite **una sola respuesta privada por comentario**. Si ya se
  respondió desde Business Suite, OpenReply no puede volver a enviarla: queda
  registrada como fallida, sin llegarle nada a la persona.
- El barrido automático revisa comentarios de las últimas 72 h por defecto.
  Pon `COMMENT_POLL_LOOKBACK_HOURS=1` al activar las campañas y súbelo (o
  bórralo) unos días después.
- La respuesta pública en comentarios está desactivada en todas las campañas.
- Los DMs y respuestas a stories solo se procesan cuando llegan nuevos; los
  antiguos no se tocan.
