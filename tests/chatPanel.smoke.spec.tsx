// @vitest-environment jsdom
/**
 * @file tests/chatPanel.smoke.spec.tsx
 *
 * Why it exists: PRD §5 DoD #25 — render smoke for the five `<ChatError>`
 * variants and the `<AssistantMessage />` happy path. We DON'T render the
 * full `<ChatPanel />` because it boots through `window.api.*` which would
 * require an extensive mock; the variants under test are stateless and
 * exercise the most critical UI paths.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatErrorView from '../src/renderer/chat/ChatError';
import AssistantMessage from '../src/renderer/chat/AssistantMessage';
import type { ChatTurn } from '../src/shared/types';

// jsdom: stub the chat IPC surface used by ApplySuggestion's onClick. The
// component is rendered but the user does not click "Copy" in this suite.
(globalThis as unknown as { window: Window & { api: unknown } }).window =
  Object.assign(globalThis.window, {
    api: {
      chat: {
        copySuggestion: async (): Promise<void> => Promise.resolve(),
      },
      log: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    },
  });

describe('<ChatError /> variants render', () => {
  it('renders no-api-key with a CTA', () => {
    render(<ChatErrorView error={{ variant: 'no-api-key' }} />);
    expect(screen.getByText(/No Gemini API key set/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Open AI Settings/ })).toBeTruthy();
  });

  it('renders no-harness with a CTA', () => {
    render(<ChatErrorView error={{ variant: 'no-harness' }} />);
    expect(screen.getByText(/No harness loaded/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Open Harness Settings/ })).toBeTruthy();
  });

  it('renders token-ceiling with the offending count', () => {
    render(
      <ChatErrorView
        error={{ variant: 'token-ceiling', approxTokens: 1_600_000, ceiling: 1_500_000 }}
      />,
    );
    expect(screen.getByText(/Request too large to send/)).toBeTruthy();
    expect(screen.getByText(/1,600,000/)).toBeTruthy();
  });

  it('renders transient with a Retry button when handler is supplied', () => {
    render(
      <ChatErrorView
        error={{ variant: 'transient', reason: 'timeout', retryable: true }}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByText(/Taking longer than expected/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Retry/ })).toBeTruthy();
  });

  it('renders fatal with the reason headline + detail JSON', () => {
    render(
      <ChatErrorView
        error={{ variant: 'fatal', reason: 'safety', detail: { blockReason: 'SAFETY' } }}
      />,
    );
    expect(screen.getByText(/Response blocked by safety filter/)).toBeTruthy();
    expect(screen.getByText(/blockReason/)).toBeTruthy();
  });
});

describe('<AssistantMessage /> happy path', () => {
  it('renders analysis + suggestion table + risk callout', () => {
    const turn: ChatTurn = {
      id: 'a1',
      role: 'assistant',
      text: '## Analysis\n\nlooks bullish',
      attachedScreenshotIds: [],
      structured: {
        schema_version: '2',
        analysis: '## Analysis\n\nlooks bullish',
        suggested_parameter_changes: [
          {
            parameter: 'volatility_filter',
            direction: 'increase',
            suggested_value: '~0.7× ATR',
            chart_context: 'chart shows choppy 5m swings',
            rationale: 'reduce noise',
          },
        ],
        confidence_score: 0.82,
        risk_notes: 'regime might shift',
      },
      createdAt: 0,
      latencyMs: 1234,
      modelUsed: 'gemini-3.1-pro-preview',
    };
    render(<AssistantMessage turn={turn} />);
    expect(screen.getByText(/looks bullish/)).toBeTruthy();
    expect(screen.getByText('volatility_filter')).toBeTruthy();
    expect(screen.getByText('~0.7× ATR')).toBeTruthy();
    expect(screen.getByText(/choppy 5m swings/)).toBeTruthy();
    expect(screen.getByText('regime might shift')).toBeTruthy();
    expect(screen.getByText(/High confidence/)).toBeTruthy();
    expect(screen.getByText(/gemini-3.1-pro-preview/)).toBeTruthy();
  });

  it('escapes raw HTML in the markdown body (XSS smoke)', () => {
    const turn: ChatTurn = {
      id: 'a2',
      role: 'assistant',
      text: 'safe <script>alert(1)</script> markdown',
      attachedScreenshotIds: [],
      structured: {
        schema_version: '2',
        analysis: 'safe <script>alert(1)</script> markdown',
        suggested_parameter_changes: [],
        confidence_score: 0.5,
        risk_notes: '',
      },
      createdAt: 0,
    };
    const { container } = render(<AssistantMessage turn={turn} />);
    expect(container.querySelector('script')).toBeNull();
  });
});
