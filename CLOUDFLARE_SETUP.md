# Cloudflare CMS einrichten

Das CMS läuft als Cloudflare Worker mit statischen Website-Dateien und einer D1-Datenbank. Der Verwaltungsbereich unter `/cms/index.html` und alle Verwaltungs-APIs müssen durch Cloudflare Access geschützt werden. Die Anfragespeicherung ist absichtlich deaktiviert, bis Datenschutz und Turnstile eingerichtet sind.

## Einmalig vorbereiten

1. Ein Cloudflare-Konto anlegen und die Domain der Website dort verbinden. Für ein produktives CMS ist eine eigene Domain empfehlenswert.
2. Node.js und npm installieren und im Projektordner ausführen:

   ```sh
   npm install
   npx wrangler login
   ```

3. Die Datenbank anlegen:

   ```sh
   npx wrangler d1 create hawo-cms
   ```

   Die ausgegebene `database_id` in `wrangler.jsonc` anstelle von `REPLACE_WITH_D1_DATABASE_ID` eintragen.

4. Datenbankschema anwenden:

   ```sh
   npm run db:migrate:remote
   ```

5. Unter **Zero Trust → Access → Applications** eine Self-hosted-Anwendung anlegen. Nur die CMS-Oberfläche und die Admin-API schützen:
   - Hostname und Pfad `/cms/*`
   - Hostname und Pfad `/api/admin/*`
   - Eine Allow-Regel nur für die zugelassenen persönlichen Konten einrichten.

   Die Audience (AUD) beider Access-Anwendungen und die Team-Domain bereithalten. Anschließend die Team-Domain und beide AUDs (kommagetrennt) als Werte setzen:

   ```sh
   npx wrangler secret put CF_ACCESS_TEAM_DOMAIN
   npx wrangler secret put CF_ACCESS_AUD
   ```

   Beim ersten Befehl den Team-Hostnamen wie `mein-team.cloudflareaccess.com` eingeben, beim zweiten beide AUDs kommasepariert eingeben. Das CMS prüft das Access-JWT zusätzlich serverseitig.

6. In **Cloudflare Turnstile** ein Widget für die Website-Domain anlegen und beide Schlüssel setzen:

   ```sh
   npx wrangler secret put TURNSTILE_SITE_KEY
   npx wrangler secret put TURNSTILE_SECRET_KEY
   ```

7. Vor Aktivierung des Anfrageformulars eine passende Datenschutzerklärung auf der Website veröffentlichen und im Formular verlinken. Darin müssen unter anderem Verantwortliche, Zweck, Speicherdauer und eingesetzte Dienstleister korrekt beschrieben sein. Keine sensiblen Gesundheitsdaten über das Formular erheben.
8. Erst danach in `wrangler.jsonc` `INQUIRIES_ENABLED` auf `"true"` setzen.
9. Worker bereitstellen:

   ```sh
   npm run deploy
   ```

   Die Konfiguration bindet nur `www.hawo-abdulle.com/api/*` an den Worker. Die übrige Website bleibt bei GitHub Pages; `workers.dev` ist deaktiviert.

10. Die CMS-Oberfläche unter `/cms/` und die geänderten Website-Dateien über den bestehenden GitHub-Pages-Workflow veröffentlichen. Die Access-Anwendungen schützen `/cms/*` und `/api/admin/*`; vor dem Livegang beide Pfade mit einem berechtigten und einem nicht berechtigten Konto prüfen.

## Betrieb

- Im CMS Anfragen als neu, in Bearbeitung, beantwortet oder abgeschlossen markieren und nicht mehr benötigte Einträge löschen.
- Artikel und Video-Links als Entwurf speichern oder veröffentlichen. Artikeltext wird direkt auf der Website gezeigt; Videos werden über HTTPS-Links geteilt. Datei-Uploads sind nicht eingerichtet.
- Für Inhalte gibt es getrennte Sprachversionen Deutsch und Englisch.
- Vor dem Livegang die Website, Access-Schutz, Turnstile, Datenschutzerklärung und Anfrage-Löschung mit echten Konten testen.
- Die Aufbewahrungsdauer für Anfragen ist organisatorisch festzulegen und regelmäßig einzuhalten.

## Lokal testen

```sh
npm test
npm run dev
```

Die lokale Vorschau benötigt ebenfalls die D1-Bindung; geheime Cloudflare-Werte und Access-Anmeldung müssen separat für lokale Entwicklung eingerichtet werden. Für den ersten sicheren Test bleibt die Anfrageannahme deaktiviert.
