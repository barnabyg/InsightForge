import { useEffect, useState } from 'react';
import './app.css';

type ConnectivityState = 'checking' | 'connected' | 'api_key_missing' | 'unavailable';

interface BootstrapResponse {
  app: { name: string; version: string };
  mode: 'live' | 'mock';
  connectivity: {
    state: Exclude<ConnectivityState, 'checking'>;
    checkedAt: string;
    message: string;
  };
  storage: { state: 'ready' };
}

interface ShellState {
  mode: 'live' | 'mock' | null;
  connectivity: ConnectivityState;
  message: string;
}

const stages = [
  { number: '01', name: 'Insight', description: 'The product signal worth pursuing' },
  { number: '02', name: 'Design Brief', description: 'A focused response to the opportunity' },
  { number: '03', name: 'Concept Screens', description: 'Three coordinated interface directions' },
  { number: '04', name: 'PRD', description: 'The product definition, ready to share' },
];

const connectivityLabels: Record<ConnectivityState, string> = {
  checking: 'Checking',
  connected: 'Connected',
  api_key_missing: 'API key needed',
  unavailable: 'Unavailable',
};

export function App() {
  const [shell, setShell] = useState<ShellState>({
    mode: null,
    connectivity: 'checking',
    message: 'Checking OpenAI connectivity',
  });

  useEffect(() => {
    const controller = new AbortController();

    async function bootstrap() {
      try {
        const response = await fetch('/api/bootstrap', { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Bootstrap failed with status ${response.status}`);
        }
        const result = await response.json() as BootstrapResponse;
        setShell({
          mode: result.mode,
          connectivity: result.connectivity.state,
          message: result.connectivity.message,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setShell({
          mode: null,
          connectivity: 'unavailable',
          message: 'The local InsightForge server could not be reached',
        });
      }
    }

    void bootstrap();
    return () => controller.abort();
  }, []);

  return (
    <div className="app-frame">
      <header className="topbar">
        <a className="brand" href="/" aria-label="InsightForge home">
          <span className="brand-mark" aria-hidden="true">IF</span>
          <span>InsightForge</span>
        </a>
        <div className="environment">
          {shell.mode === 'mock' && <span className="mode-badge">Mock mode</span>}
          <span
            className={`connectivity connectivity--${shell.connectivity}`}
            role="status"
            aria-label={`OpenAI ${shell.connectivity === 'api_key_missing' ? 'API key needed' : shell.connectivity}`}
            title={shell.message}
          >
            <span className="connectivity-dot" aria-hidden="true" />
            {connectivityLabels[shell.connectivity]}
          </span>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar" aria-label="Project navigation">
          <div>
            <p className="eyebrow">Workspace</p>
            <nav>
              <a className="nav-item nav-item--active" href="#projects" aria-current="page">
                <span>Projects</span>
                <span aria-hidden="true">00</span>
              </a>
              <span className="nav-item nav-item--muted">
                <span>Prompts</span>
                <span aria-hidden="true">↗</span>
              </span>
            </nav>
          </div>
          <div className="local-note">
            <span className="local-note-icon" aria-hidden="true">⌂</span>
            <div>
              <strong>Local workspace</strong>
              <span>Your work stays on this device</span>
            </div>
          </div>
        </aside>

        <main className="main-content" id="projects">
          <section className="hero" aria-labelledby="hero-title">
            <p className="eyebrow">Product thinking, forged through iteration</p>
            <h1 id="hero-title">Turn an insight into a product direction.</h1>
            <p className="hero-copy">
              Shape the prompts. Run the workflow. Refine the thinking behind every artifact.
            </p>
          </section>

          <section className="pipeline" aria-labelledby="pipeline-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">The workflow</p>
                <h2 id="pipeline-title">One continuous line of thought</h2>
              </div>
              <span className="section-meta">4 stages · locally saved</span>
            </div>

            <ol className="stage-list">
              {stages.map((stage) => (
                <li className="stage" key={stage.number}>
                  <span className="stage-number">{stage.number}</span>
                  <div className="stage-copy">
                    <h3>{stage.name}</h3>
                    <p>{stage.description}</p>
                  </div>
                  <span className="stage-state">Waiting</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="empty-state" aria-labelledby="empty-title">
            <span className="empty-glyph" aria-hidden="true">✦</span>
            <div>
              <h2 id="empty-title">Your first project starts with a signal.</h2>
              <p>Project creation arrives in the next implementation slice.</p>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

