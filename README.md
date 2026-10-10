# LangChain

A bilingual document and productivity workspace built as a Vite/React client and an Express API. The current implementation is a scaffold with a functional local-session UI. Authentication, durable document storage, parsing/generation, persistent history, OAuth and production deployment require provider credentials and additional service setup; those capabilities are surfaced as unconfigured instead of simulated.

## Run locally

Requirements: Node.js 20 or newer and npm.

1. Copy `.env.example` to `.env` and configure server-side values as needed.
2. Run `npm install`.
3. Run `npm run dev` to start Vite on port 5173 and the API on port 4000.
4. Open <http://localhost:5173>.

The UI works without credentials. DOCX and PDF uploads are processed in memory and are not stored by this API. DOCX extraction separates headings, paragraphs, list items, and table cells. PDF extraction reconstructs page lines from text positions; wide text gaps block translation until a person reviews and confirms the extracted order. Scanned PDFs need OCR, and columns/tables still need visual review. Original Word styling is not retained in the editable view.

Translation uses structural passages with nearby context, optional approved glossary terms, and schema-constrained Gemini output. The server checks passage coverage and unchanged numeric/link anchors and rejects a result when those checks fail. These checks cannot prove semantic accuracy. Translations stay in “Needs review” until a person confirms review; export is disabled before confirmation. The glossary and documents currently live only in the browser session. API keys are read by the Express server. Configure `GEMINI_MODEL` to a model currently available to your account; the code default is `gemini-3.8-flash`.

## Data and security setup

- Apply [`supabase/schema.sql`](supabase/schema.sql) to a Supabase project. It enables RLS for profiles, documents, translations, glossary, drafts and activity, and creates a private storage bucket scoped by user ID.
- Configure Supabase Auth providers and email recovery in the Supabase dashboard. Client-side protected routes and server token verification still need to be wired before deploying user data features.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the Vite client. Prefer owner-scoped Supabase sessions; keep any service role key on the server only.
- Set `MAX_UPLOAD_MB` and `WEB_ORIGIN` on the server. Upload route currently validates/counts files in memory then returns a setup error until private storage and format processors are connected.
- OCR, translated DOCX/PDF generation, CSV cell-aware translation, durable autosave/conflict checking, and persistent translation versions remain integration work. Current export is reviewed plain text; report layout and inline styling are not preserved.
- Gmail and Outlook are not connected. Add registered OAuth applications, minimal draft-only scopes, encrypted server-side token storage, consent and revocation paths before enabling account sync. Never send email without explicit confirmation.
- Voice Workspace is intentionally deferred and has no transcription implementation.

## Deployment

Build the client with `npm run build`. Deploy the static `dist` client and the Express server as separate services, configure the `/api` proxy or `VITE_API_URL` equivalent for the deployment, set server secrets in the hosting provider, restrict CORS to the deployed origin, enable HTTPS, and configure Supabase redirects, storage and auth. Do not expose unprocessed private uploads through a public bucket or public URL.
