# OPSIS – Architektur (Phase 0)

| Dokument                                                        | Inhalt                                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [01 Übersicht](01-overview.md)                                  | Bestandsaufnahme, Systemkontext, Schichten, Technologiestack mit Begründung, Sicherheit |
| [02 Domain-Modell](02-domain-model.md)                          | Entitäten, Beziehungen, Herkunft von Angaben, Vollständigkeit                           |
| [03 Datenbankschema](03-database-schema.md)                     | SQLite-DDL inkl. Unveränderlichkeits-Trigger                                            |
| [04 Session-Lifecycle](04-session-lifecycle.md)                 | Statusautomat, Konflikte paralleler Sessions, UI-Zuordnung, Zugriffskontrolle           |
| [05 Versionierung & History](05-versioning-history.md)          | Draft vs. Snapshot, Freigabe, Vergleich, Rekonstruktion, Export/Import                  |
| [06 MCP-Schnittstelle](06-mcp-api.md)                           | Transport, Tools, Ressourcen, Wartemechanismus                                          |
| [07 Implementierungsplan](07-implementation-plan.md)            | Phasen 1–6, Teststrategie                                                               |
| [08 Risiken & offene Entscheidungen](08-risks-and-decisions.md) | technische Risiken, fachliche Fragen E1–E10                                             |
