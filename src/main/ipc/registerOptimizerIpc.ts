/**
 * @file src/main/ipc/registerOptimizerIpc.ts
 *
 * `optimizer:` IPC namespace registrar (PRD_Optimizer_MCP_Integration
 * D-M5/D-M6). Follows the namespace-registrar convention of
 * `registerCoreIpc` / `registerChatAiIpc` / `registerUpdateIpc`: `ctx` in,
 * null-service fallbacks everywhere, never throw at the renderer. The team
 * key never appears in any payload or log line (§5 grep contract).
 */

import { BrowserWindow, clipboard, ipcMain } from 'electron';
import type { AppContext } from '../appContext';
import {
  IPC_OPTIMIZER_CANCEL_JOB,
  IPC_OPTIMIZER_COPY_SETTINGS_CARD,
  IPC_OPTIMIZER_GET_JOB_STATE,
  IPC_OPTIMIZER_GET_STATUS,
  IPC_OPTIMIZER_JOB_STATE_CHANGED,
  IPC_OPTIMIZER_LIST_TOOLS,
  IPC_OPTIMIZER_RUN_BACKTEST,
  IPC_OPTIMIZER_START_OPTIMIZATION,
  IPC_OPTIMIZER_USE_IN_CHAT,
} from '../../shared/ipcChannels';
import type {
  OptimizerJobSnapshot,
  OptimizerStatus,
  OptimizerToolResult,
  OptimizerToolsInfo,
} from '../../shared/optimizerTypes';
import { isOptimizerJobRequest } from './typeGuards';

export function registerOptimizerIpc(ctx: AppContext): void {
  const log = ctx.logger;

  ipcMain.handle(IPC_OPTIMIZER_GET_STATUS, (): OptimizerStatus => {
    const store = ctx.optimizerStore;
    if (!store || !store.isConfigured()) {
      // Absent config ⇒ the feature is hidden everywhere (D-M8).
      return { configured: false, connected: false, mcpUrl: null };
    }
    return {
      configured: true,
      connected: ctx.optimizerService?.isConnected() ?? false,
      mcpUrl: store.getMcpUrl(),
    };
  });

  ipcMain.handle(IPC_OPTIMIZER_LIST_TOOLS, async (): Promise<OptimizerToolsInfo> => {
    const service = ctx.optimizerService;
    if (!service) return { toolNames: [], capabilities: null };
    return service.listTools();
  });

  ipcMain.handle(
    IPC_OPTIMIZER_RUN_BACKTEST,
    async (_e, args: unknown): Promise<OptimizerToolResult> => {
      const service = ctx.optimizerService;
      if (!service) return { ok: false, kind: 'not-configured' };
      if (typeof args !== 'object' || args === null) {
        return { ok: false, kind: 'engine', detail: 'invalid backtest arguments' };
      }
      return service.callTool('backtest', args as Record<string, unknown>);
    },
  );

  ipcMain.handle(
    IPC_OPTIMIZER_START_OPTIMIZATION,
    async (_e, request: unknown): Promise<OptimizerJobSnapshot | null> => {
      const tracker = ctx.optimizerJobTracker;
      if (!tracker || !isOptimizerJobRequest(request)) return null;
      return tracker.start(request);
    },
  );

  ipcMain.handle(IPC_OPTIMIZER_GET_JOB_STATE, (): OptimizerJobSnapshot | null => {
    return ctx.optimizerJobTracker?.getSnapshot() ?? null;
  });

  ipcMain.handle(IPC_OPTIMIZER_CANCEL_JOB, async (): Promise<boolean> => {
    const tracker = ctx.optimizerJobTracker;
    if (!tracker) return false;
    return tracker.cancel();
  });

  ipcMain.handle(IPC_OPTIMIZER_COPY_SETTINGS_CARD, (): boolean => {
    const card = ctx.optimizerJobTracker?.getSnapshot()?.result;
    if (!card) return false;
    clipboard.writeText(card.tradingviewTable);
    log.info('optimizer.settingsCardCopied', {
      ticker: card.ticker,
      timeframe: card.timeframe,
    });
    return true;
  });

  ipcMain.handle(IPC_OPTIMIZER_USE_IN_CHAT, (): boolean => {
    const tracker = ctx.optimizerJobTracker;
    if (!tracker) return false;
    return tracker.queueResultAsGrounding();
  });

  ctx.optimizerJobTracker?.onSnapshotChanged((snapshot) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IPC_OPTIMIZER_JOB_STATE_CHANGED, snapshot);
    }
  });
}
