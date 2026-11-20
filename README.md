# Simulador de empatía · Urgencias (piloto)

Web para entrenar la comunicación y la empatía del personal sanitario con pacientes y familiares simulados por IA.
Autor: Mauricio Valbuena.

## Cómo funciona

- **Web estática** (`index.html`), publicada con GitHub Pages.
- **Supabase** (proyecto `simulador-empatia`, región UE · París):
  - Acceso por enlace de un solo uso enviado al email. Solo pueden entrar los emails invitados.
  - Tablas `profiles` (seudónimo, estamento, consentimiento, rol de Docencia) y `sessions` (transcripción, informe, puntuaciones, valoración), protegidas con RLS.
  - Funciones de servidor (Edge Functions), que guardan las claves de API:
    - `llm`: personaje, pistas y evaluación con Claude (Anthropic) o GPT (OpenAI).
    - `tts`: voz del personaje (OpenAI).
    - `stt`: transcripción de lo que dice el profesional (OpenAI). El audio no se guarda.
    - `admin`: invitar participantes (solo Docencia), listar altas y baja propia.

## Configuración (una vez)

En Supabase → Edge Functions → Secrets: `ANTHROPIC_API_KEY` y `OPENAI_API_KEY`.
Opcionales: `ANTHROPIC_MODEL`, `ANTHROPIC_MODEL_QUICK`, `ANTHROPIC_MODEL_EVAL`, `OPENAI_CHAT_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_STT_MODEL`.

En Supabase → Authentication → URL Configuration: Site URL y Redirect URL = la dirección de GitHub Pages.

En Supabase → Authentication → Sign In / Providers → Email: desactivar "Allow new users to sign up".

El primer usuario dado de alta queda como administrador (Docencia).

## Uso de datos

Casos ficticios. No introducir datos de pacientes reales. Puntuaciones formativas: no evalúan el desempeño laboral.
