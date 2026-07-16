// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

describe('application shell', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the workflow destination, connectivity, and an unmistakable mock-mode label', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        app: { name: 'InsightForge', version: '0.1.0' },
        mode: 'mock',
        connectivity: {
          state: 'connected',
          checkedAt: '2026-07-16T09:30:00.000Z',
          message: 'Mock OpenAI is ready',
        },
        storage: { state: 'ready' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ));

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Turn an insight into a product direction.' }))
      .toBeInTheDocument();
    expect(await screen.findByText('Mock mode')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'OpenAI connected' }))
      .toHaveTextContent('Connected');
    expect(screen.getByText('Last checked')).toBeInTheDocument();
    expect(screen.getByText('10:30')).toHaveAttribute(
      'datetime',
      '2026-07-16T09:30:00.000Z',
    );
    expect(screen.getByText('Insight')).toBeInTheDocument();
    expect(screen.getByText('Design Brief')).toBeInTheDocument();
    expect(screen.getByText('Concept Screens')).toBeInTheDocument();
    expect(screen.getByText('PRD')).toBeInTheDocument();
  });

  it('observes the result of an in-progress startup check without polling', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        app: { name: 'InsightForge', version: '0.1.0' },
        mode: 'live',
        connectivity: {
          state: 'checking',
          checkedAt: null,
          message: 'Checking OpenAI connectivity',
        },
        storage: { state: 'ready' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        state: 'unavailable',
        checkedAt: '2026-07-16T10:45:00.000Z',
        message: 'OpenAI could not be reached',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByRole('status', { name: 'OpenAI unavailable' }))
      .toHaveTextContent('Unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/connectivity',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
