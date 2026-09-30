# AI Incident Assistant
Aplicación para que un analista autenticado pegue el texto de un incidente, reciba un análisis estructurado y haga preguntas sobre ese mismo texto. El resultado separa citas, hipótesis e información faltante. No ejecuta acciones sobre otros sistemas.

## Arquitectura
Monolito NestJS/TypeScript. React habla con una API REST. PostgreSQL guarda usuarios, análisis, mensajes, ejecuciones y auditoría. Los casos de uso de escritura (`crear`, `reintentar`, `preguntar`) están separados de las lecturas (`listar`, `detalle`).

La llamada al modelo sigue este camino: caso de uso, `PromptBuilder`, `LlmProvider`, `OutputValidator`, persistencia. La transacción de base no permanece abierta durante la llamada de red. Hay un proveedor `mock` determinístico y un proveedor `openai` detrás del mismo contrato. El SDK de OpenAI se usa directo, con `maxRetries: 0`: el único reintento lo decide la aplicación.

## Decisiones y límites
- Texto, no carga de archivos. Máximo 8000 caracteres; una pregunta, 1000.
- La sesión es un JWT en cookie `HttpOnly`, con un segundo cookie para CSRF en los POST.
- Cada análisis pertenece a un usuario. Un identificador ajeno responde 404.
- Las citas deben aparecer tal cual en el incidente. Si no hay citas, la salida tiene que declarar incertidumbre e información faltante.
- Un análisis en curso por usuario y una pregunta en curso por análisis. El segundo intento concurrente recibe 409.
- Timeout total configurable (`LLM_DEADLINE_MS`, 20 s en local) y como máximo un reintento ante red, 429 o 5xx. Un timeout no prueba que el proveedor no haya cobrado la solicitud.
- Retención local: 30 días por defecto. Al arrancar y cada hora se borran los análisis vencidos. La retención del proveedor de IA no la controla esta aplicación.
- No hay streaming de tokens, RAG ni herramientas con efectos.
- La calidad del mock no certifica al modelo real. La muestra con proveedor real queda bloqueada si no hay `OPENAI_API_KEY`.

El detalle está en [docs/architecture/RATIONALE.md](docs/architecture/RATIONALE.md), [docs/features/MVP.md](docs/features/MVP.md) y [docs/security/DATA_POLICY.md](docs/security/DATA_POLICY.md).

## Arranque local
Requisitos comprobados en esta máquina: Node.js 22 y Docker. PostgreSQL local usa el puerto **5432**. La API local usa el puerto **3001** porque 3000 ya respondía otro servicio.

```powershell
Copy-Item .env.example .env
docker compose up -d postgres
npm install
npm run db:migrate
npm run db:seed
npm run dev:api
npm run dev:web
```

Con la API en marcha, OpenAPI interactivo: http://127.0.0.1:3001/api/docs (JSON en `/api/docs-json`). Documenta cookies de sesión y header CSRF en mutaciones.

Abrí http://127.0.0.1:5173. Usuarios locales, solo para esta base de demostración:

- `analyst.a@example.test`
- `analyst.b@example.test`
- contraseña: `local-demo-password`

Esos valores están en `.env.example`. No sirven fuera de esta base local. Para usar OpenAI, en `.env` poné `LLM_PROVIDER=openai` y `OPENAI_API_KEY` sin commitear el archivo.

Si `npm run qa:ai:live` termina con `Provider: kind=network` pero `curl` autenticado a `https://api.openai.com/v1/models` responde 200, la clave suele estar bien y Node no confía en la cadena TLS (antivirus, VPN o `NODE_EXTRA_CA_CERTS` apuntando a un PEM incorrecto). Corregí el almacén de certificados de Windows o quitá esa variable y volvé a ejecutar el comando.

El stack completo, con la web publicada por nginx en http://localhost:8080, es:

```powershell
docker compose up --build
```

Ese comando construye las imágenes. En esta sesión `docker build` de la API falló dentro de `npm ci` (`Exit handler never called`). El arranque con Node en el host sí se usó para los tests y el navegador.

## Comandos de verificación
| Comando | Qué hace | Resultado 2026-09-29 |
|---|---|---|
| `npm test` | Unitarias e integración contra PostgreSQL en el puerto 5432 | PASS, 18 tests |
| `npm run build` | Typecheck y build de API y web | PASS |
| `npm run qa:eval` | Rúbrica sobre el proveedor mock | PASS, 5 fixtures |
| `npm run qa:ai:live` | Una muestra real | BLOCKED, sin `OPENAI_API_KEY` |
| `npm run qa:e2e` | Login, análisis, pregunta, historial, error, HTML y aislamiento en Chrome | PASS, 3 tests |
| `npm run qa:demo` | Recorrido con video | PASS. El video queda en `qa-artifacts/`, fuera de Git |
| `npm run check:web-docs` | El build de React no incluye documentos internos | PASS |

`npm run qa:e2e` necesita Docker con Postgres en 5432 y Chrome instalado. Playwright no pudo descargar su propio Chromium por un error de certificado TLS; usa el Chrome del sistema (`channel: chrome`).

### Operaciones: OpenAI y TLS en Windows

Si `npm run qa:ai:live` falla con `Provider: kind=network` pero `curl.exe https://api.openai.com/v1/models` con tu clave devuelve **200**, Node no confía en la misma cadena TLS (antivirus, inspección HTTPS o un `NODE_EXTRA_CA_CERTS` incorrecto). El script `qa:ai:live` arranca Node con `--use-system-ca` para alinear el almacén con Windows. Para la API en desarrollo con `LLM_PROVIDER=openai`, podés usar `set NODE_OPTIONS=--use-system-ca` en la misma terminal antes de `npm run dev:api`, o corregir/eliminar `NODE_EXTRA_CA_CERTS` si apunta a una CA obsoleta.

## Infraestructura
`infra/terraform` describe ECS Fargate, un balanceador, RDS PostgreSQL 16 y secretos en Secrets Manager. No se ejecutó `terraform apply`. `terraform init` descargó el provider AWS 5.100.0. `terraform validate` falló porque ese plugin no respondió; no quedó demostrado que el HCL esté libre de errores. No hay claves dentro del código de Terraform.

## Qué no está resuelto
- No hay medición de latencia ni costo del modelo real.
- El límite de concurrencia y de tasa vive en memoria del proceso. No se comparte entre réplicas.
- El certificado TLS del balanceador no está creado: el listener de ejemplo es HTTP.
- La comparación de calidad entre dos modelos reales no se ejecutó.
