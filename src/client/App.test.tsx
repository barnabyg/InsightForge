// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

describe('application shell', () => {
  afterEach(() => {
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
    expect(screen.getByText('Insight')).toBeInTheDocument();
    expect(screen.getByText('Design Brief')).toBeInTheDocument();
    expect(screen.getByText('Concept Screens')).toBeInTheDocument();
    expect(screen.getByText('PRD')).toBeInTheDocument();
  });
});
