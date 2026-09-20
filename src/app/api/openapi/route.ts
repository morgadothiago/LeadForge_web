import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { spec } from "@/lib/openapi";

export const dynamic = "force-dynamic";

export async function GET() {
  // SPEC-021: docs do contrato mobile não são públicas em produção (exige sessão web).
  if (process.env.NODE_ENV === "production" && !(await getSession())) return new NextResponse("Not found", { status: 404 });
  const specJson = JSON.stringify(spec);

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LeadForge API Docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui.css" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0e11; color: #e9ecec; }
    .topbar { display: none !important; }
    .info { margin: 20px 0; }
    .info .title { color: #1fb390 !important; }
    .scheme-container { background: #131619 !important; border: 1px solid #202226 !important; }
    .opblock-summary { background: #131619 !important; border: 1px solid #202226 !important; }
    .opblock-summary:hover { background: #1a1d21 !important; }
    .opblock .opblock-summary-description { color: #747b82 !important; }
    .btn { background: #1fb390 !important; color: #0a0e11 !important; border: none !important; }
    .btn:hover { background: #1a9e7e !important; }
    .model-box { background: #131619 !important; border: 1px solid #202226 !important; }
    table { background: #131619 !important; }
    table td, table th { border-color: #202226 !important; }
    select, input[type=text], textarea { background: #0a0e11 !important; color: #e9ecec !important; border-color: #202226 !important; }
    .header { background: #131619; border-bottom: 1px solid #202226; padding: 16px 24px; }
    .header h1 { font-size: 20px; font-weight: 700; color: #1fb390; }
    .header p { font-size: 13px; color: #747b82; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>LeadForge API</h1>
    <p>Documentacao interativa — OpenAPI 3.1</p>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui-bundle.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      const spec = ${specJson};
      SwaggerUIBundle({
        spec: spec,
        dom_id: '#swagger-ui',
        deepLinking: true,
        docExpansion: 'list',
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 1,
        tryItOutEnabled: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: 'StandaloneLayout'
      });
    };
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
