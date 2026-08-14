// @vitest-environment jsdom
/**
 * @file tests/optimizerPanel.smoke.spec.tsx
 *
 * Renderer smoke for the Optimizer panel (PRD_Optimizer_MCP_Integration
 * D-M6/D-M8): unconfigured ⇒ provisioning hint only; configured ⇒
 * server-derived selects; done snapshot ⇒ settings card with copy/use-in-chat.
 * Follows the chatPanel.smoke pattern: stub only the window.api members the
 * component touches.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, act } from '@testing-library/react';
import OptimizerPanel from '../src/renderer/optimizer/OptimizerPanel';
import { useOptimizerStore } from '../src/renderer/optimizer/optimizerStore';
import type {
  OptimizerJobSnapshot,
  OptimizerStatus,
  OptimizerToolsInfo,
} from '../src/shared/optimizerTypes';

type JobListener = (snapshot: OptimizerJobSnapshot) => void;

function stubApi(status: OptimizerStatus, toolsInfo?: OptimizerToolsInfo): {
  listeners: JobListener[];
} {
  const listeners: JobListener[] = [];
  Object.assign(globalThis.window, {
    api: {
      log: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      optimizer: {
        getStatus: async () => status,
        listTools: async () =>
          toolsInfo ?? { toolNames: [], capabilities: null },
        getJobState: async () => null,
        startOptimization: async () => null,
        cancelJob: async () => false,
        copySettingsCard: async () => true,
        useInChat: async () => true,
        onJobStateChanged: (cb: JobListener) => {
          listeners.push(cb);
          return () => undefined;
        },
      },
    },
  });
  return { listeners };
}

const CAPS: OptimizerToolsInfo = {
  toolNames: ['backtest'],
  capabilities: {
    tickers: ['NVDA', 'AAPL'],
    timeframes: ['1d', '1w'],
    objectives: ['max_sharpe', 'max_return'],
    objectiveDescriptions: { max_sharpe: 'Sharpe ratio' },
  },
};

beforeEach(() => {
  useOptimizerStore.setState({
    status: null,
    toolsInfo: null,
    snapshot: null,
    starting: false,
    copied: false,
    queuedForChat: false,
  });
});

afterEach(() => {
  cleanup();
});

describe('OptimizerPanel', () => {
  it('shows the provisioning hint when unconfigured (D-M8)', async () => {
    stubApi({ configured: false, connected: false, mcpUrl: null });
    await act(async () => {
      render(<OptimizerPanel />);
    });
    expect(screen.getByText(/not provisioned/)).toBeTruthy();
    expect(screen.getByText(/updated\s+team-config\.json/)).toBeTruthy();
    expect(screen.queryByText('Start optimization')).toBeNull();
  });

  it('populates selects from server capabilities, never hard-coded', async () => {
    stubApi(
      { configured: true, connected: true, mcpUrl: 'https://optimize.archpublic.com/mcp' },
      CAPS,
    );
    await act(async () => {
      render(<OptimizerPanel />);
    });
    expect(screen.getByRole('option', { name: 'NVDA' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '1w' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'max_return' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start optimization' })).toBeTruthy();
  });

  it('renders progress, then the settings card with actions on done', async () => {
    const { listeners } = stubApi(
      { configured: true, connected: true, mcpUrl: 'https://optimize.archpublic.com/mcp' },
      CAPS,
    );
    await act(async () => {
      render(<OptimizerPanel />);
    });
    const base: OptimizerJobSnapshot = {
      jobId: 'j1',
      kind: 'single',
      state: 'running',
      request: { kind: 'single', ticker: 'NVDA', timeframe: '1d', objective: 'max_sharpe', trials: 50 },
      done: 20,
      total: 50,
      best: 1.2,
      queuePosition: null,
      error: null,
      result: null,
      startedAt: '2026-08-14T00:00:00.000Z',
    };
    await act(async () => {
      listeners.forEach((cb) => {
        cb(base);
      });
    });
    expect(screen.getByTestId('job-progress')).toBeTruthy();
    expect(screen.getByText(/20\/50 trials/)).toBeTruthy();

    await act(async () => {
      listeners.forEach((cb) => {
        cb({
          ...base,
          state: 'done',
          done: 50,
          result: {
            ticker: 'NVDA',
            timeframe: '1d',
            objective: 'max_sharpe',
            objectiveValue: 1.87,
            tradingviewTable: '| Parameter | Value |',
            paramsTradingview: { iLongThreshold: 431 },
            metrics: { sharpe_ratio: 1.87 },
            zeroTrades: false,
          },
        });
      });
    });
    expect(screen.getByTestId('result-card')).toBeTruthy();
    expect(screen.getByText('iLongThreshold')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy settings card' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use in chat' })).toBeTruthy();
  });

  it('shows the expired copy when the server forgot the job', async () => {
    const { listeners } = stubApi(
      { configured: true, connected: true, mcpUrl: 'https://optimize.archpublic.com/mcp' },
      CAPS,
    );
    await act(async () => {
      render(<OptimizerPanel />);
    });
    await act(async () => {
      listeners.forEach((cb) => {
        cb({
          jobId: 'j2',
          kind: 'single',
          state: 'expired',
          request: { kind: 'single', ticker: 'NVDA', timeframe: '1d', objective: 'max_sharpe', trials: 50 },
          done: 10,
          total: 50,
          best: null,
          queuePosition: null,
          error: 'Unknown job — the server may have restarted. Start a new run.',
          result: null,
          startedAt: '2026-08-14T00:00:00.000Z',
        });
      });
    });
    expect(screen.getByTestId('job-error').textContent).toContain('server may have restarted');
  });
});
