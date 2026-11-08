# OPSIS

Visuelles UI-Spezifikationssystem mit MCP-Schnittstelle: KI-Agenten übergeben Screenshots,
Menschen markieren und beschreiben die Komponenten, OPSIS erzeugt eine versionierte,
maschinenlesbare Spezifikation und einen Implementierungsprompt.

Status: **Phase 2 – Komponentenmodell und Editor abgeschlossen.**

```sh
npm install
npm run build      # Server + Weboberfläche
npm start          # http://127.0.0.1:4777
npm run dev:web    # Vite-Dev-Server auf :5173 (Proxy auf den laufenden Server)
npm run check      # tsc, ESLint, Prettier, Vitest
```

Siehe [docs/architecture](docs/architecture/README.md).
