#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { EventBus } from '@opsis/core';
import { runAgentCommand, USAGE, type CliIo } from './agent-command.js';
import { loadConfig } from './config.js';
import { createAppContext } from './context.js';
import { Database } from './infrastructure/db/database.js';

const main = async (argv: readonly string[]): Promise<number> => {
  const [group, ...args] = argv;
  if (group === undefined || group === 'serve') {
    const { startServer } = await import('./main.js');
    await startServer();
    return 0;
  }
  const io: CliIo = {
    out: (line) => {
      console.log(line);
    },
    err: (line) => {
      console.error(line);
    },
  };
  if (group !== 'agent') {
    io.err(USAGE);
    return group === 'help' || group === '--help' ? 0 : 2;
  }
  const config = loadConfig();
  mkdirSync(config.dataDir, { recursive: true });
  const db = Database.open(join(config.dataDir, 'opsis.db'));
  try {
    const ctx = createAppContext(db, config.dataDir, new EventBus(() => undefined));
    return runAgentCommand(ctx, args, io, `http://${config.host}:${String(config.port)}/mcp`);
  } catch (error) {
    io.err(error instanceof Error ? `Error: ${error.message}` : String(error));
    return 1;
  } finally {
    db.close();
  }
};

process.exitCode = await main(process.argv.slice(2));
