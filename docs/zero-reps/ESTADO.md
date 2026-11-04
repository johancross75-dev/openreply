# OpenReply · estado al 4-nov-2026 (pausado)

Rama: `zero-reps/railway-config-check` (sin merge a `main`, nada desplegado).

## Hecho
- Diagnóstico de variables vacías/mal escritas: `/api/health` → `checks.config`, log del worker, `npm run check:env`.
- Una sola respuesta automática por DM (evita mandar venta + guía al mismo mensaje).
- Campañas como config permanente: `config/zero-reps/campaigns.json` + `npm run zr:campaigns`.
  Gratis (Tally): RUTINA, GRASA, FLEXIÓN, DOMINADA, HOMBRO, MUNDO. Pago (landing Método Zero): SÍ, INFO, MARAVILLA.
- 449 tests, typecheck, lint y build en verde. Guía: `docs/zero-reps/railway-y-meta.md`.

## Pendiente (necesita al usuario)
1. Enlaces reales: 6 formularios de Tally, landing del Método Zero, textos de cada mensaje, ID del/los post(s) del Método Zero para SÍ.
2. Confirmar decisiones: SÍ solo en posts del MZ y nunca por DM; guía gratis gana si hay palabra gratis + de pago; plurales; INFO/MARAVILLA por DM.
3. Railway: volver a pegar EMAIL_SERVER, INSTAGRAM_APP_SECRET, FACEBOOK_APP_SECRET; añadir EMAIL_FROM, ALLOWED_EMAILS, COMMENT_POLL_LOOKBACK_HOURS=1 (web y worker).
4. URL pública de la app para revisar /api/health.
5. Aprobación para PR/merge a main (despliegue).
6. Con navegador/Railway (sesión local con `claude remote-control`): verificar webhook en Meta, publicar app, conectar Instagram, `zr:campaigns apply --confirm`.
7. Prioridad 2 (responder pendientes con el runbook local) — requiere la sesión local.
