# OPSIS

Visuelles UI-Spezifikationssystem mit MCP-Schnittstelle: KI-Agenten übergeben Screenshots,
Menschen markieren und beschreiben die Komponenten, OPSIS erzeugt eine versionierte,
maschinenlesbare Spezifikation und einen Implementierungsprompt.

Status: **v0.1 – Phasen 1–6 umgesetzt** (Editor, Versionierung, MCP-Schnittstelle, E2E-Tests).

```sh
npm install
npm run build      # Server + Weboberfläche
npm start          # http://127.0.0.1:4777
npm run dev:web    # Vite-Dev-Server auf :5173 (Proxy auf den laufenden Server)
npm run check      # tsc, ESLint, Prettier, Vitest
npm run e2e        # Playwright: Ende-zu-Ende-Ablauf und Performance-Messung
```

## Dokumentation

- [Agenten anbinden (MCP)](docs/mcp.md): Token, `.mcp.json`, Tools, Ablauf, Fehlercodes
- [Betrieb](docs/operations.md): Konfiguration, CLI, Daten, Sicherung
- [Sicherheit](docs/security.md): Bedrohungsmodell, Maßnahmen, Restrisiken
- [Beispiel für Claude Code](examples/claude-code/): Skill und CLAUDE.md-Abschnitt
- [Architektur](docs/architecture/README.md)
