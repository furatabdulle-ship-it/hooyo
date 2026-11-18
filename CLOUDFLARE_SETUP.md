# Cloudflare CMS einrichten

Das CMS läuft als Cloudflare Worker mit statischen Website-Dateien und einer D1-Datenbank. Der Verwaltungsbereich unter `/cms/index.html` und alle Verwaltungs-APIs müssen durch Cloudflare Access geschützt werden. Die Anfragespeicherung ist absichtlich deaktiviert, bis Datenschutz, Turnstile und Email Routing eingerichtet sind.

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

6. Unter **Compute → Email Service → Email Routing** `hawo-abdulle.com` einrichten. Das richtet MX-Einträge für den Empfang ein. Vorhandene Mail-Nutzung und MX-Einträge zuerst prüfen; wenn bereits ein anderer Mailanbieter verwendet wird, dessen Empfangs- und SPF-Konfiguration nicht überschreiben. Danach unter **Email Routing → Destination Addresses** beide Empfängeradressen einzeln hinzufügen und die Bestätigungslinks in den jeweiligen Postfächern öffnen. Sendungen an diese verifizierten Zieladressen sind laut Cloudflare auch im Workers-Free-Tarif kostenlos. Die Absenderdomain muss als Email-Routing-Domain eingerichtet sein; eine separate Email-Sending-Domain ist für diese beiden verifizierten Ziele nicht erforderlich.

   ```sh
   npx wrangler secret put INQUIRY_RECIPIENTS
   ```

   Beim Prompt die beiden verifizierten Empfängeradressen kommasepariert eingeben. Die Empfängeradressen nicht in die Versionsverwaltung eintragen. Die Website sendet eine Benachrichtigung an beide; die Antwortadresse der Anfrage wird als `Reply-To` gesetzt.

7. In **Cloudflare Turnstile** ein Widget für die Website-Domain anlegen und beide Schlüssel setzen:

   ```sh
   npx wrangler secret put TURNSTILE_SITE_KEY
   npx wrangler secret put TURNSTILE_SECRET_KEY
   ```

8. Die Datenschutzhinweise unter `/datenschutz.html` veröffentlichen und im Anfrageformular verlinken. Sie nennen Cloudflare Email Service als technischen Dienstleister. Das Formular darf erst freigeschaltet werden, wenn Email Routing, die beiden verifizierten Zieladressen, Turnstile und der Datenschutzhinweis eingerichtet sind. Keine sensiblen Gesundheitsdaten über das Formular erheben.
9. Erst nach Einrichtung von Email Routing und aller nötigen Secrets in `wrangler.jsonc` `INQUIRIES_ENABLED` auf `"true"` setzen.
10. Worker bereitstellen:

   ```sh
   npm run deploy
   ```

   Die Konfiguration bindet nur `www.hawo-abdulle.com/api/*` an den Worker. Die übrige Website bleibt bei GitHub Pages; `workers.dev` ist deaktiviert.

11. Die CMS-Oberfläche unter `/cms/` und die geänderten Website-Dateien über den bestehenden GitHub-Pages-Workflow veröffentlichen. Die Access-Anwendungen schützen `/cms/*` und `/api/admin/*`; vor dem Livegang beide Pfade mit einem berechtigten und einem nicht berechtigten Konto prüfen.

## Betrieb

- Im CMS Anfragen als neu, in Bearbeitung, beantwortet oder abgeschlossen markieren und nicht mehr benötigte Einträge löschen. Abgeschlossene Anfragen werden 180 Tage nach dem Abschließen automatisch aus D1 gelöscht.
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
