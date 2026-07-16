import { ConnectivityIndicator } from './ConnectivityIndicator.js';
import styles from './App.module.css';
import { useBootstrap } from './useBootstrap.js';

const stages = [
  { number: '01', name: 'Insight', description: 'The product signal worth pursuing' },
  { number: '02', name: 'Design Brief', description: 'A focused response to the opportunity' },
  { number: '03', name: 'Concept Screens', description: 'Three coordinated interface directions' },
  { number: '04', name: 'PRD', description: 'The product definition, ready to share' },
];

function classes(...names: string[]): string {
  return names.map((name) => styles[name]).filter(Boolean).join(' ');
}

export function App() {
  const { shell, refreshConnectivity, refreshing } = useBootstrap();

  return (
    <div className={classes('app-frame')}>
      <header className={classes('topbar')}>
        <a className={classes('brand')} href="/" aria-label="InsightForge home">
          <span className={classes('brand-mark')} aria-hidden="true">IF</span>
          <span>InsightForge</span>
        </a>
        <ConnectivityIndicator
          shell={shell}
          refreshing={refreshing}
          onRefresh={refreshConnectivity}
        />
      </header>

      <div className={classes('workspace')}>
        <aside className={classes('sidebar')} aria-label="Project navigation">
          <div>
            <p className={classes('eyebrow')}>Workspace</p>
            <nav>
              <a className={classes('nav-item', 'nav-item--active')} href="#projects" aria-current="page">
                <span>Projects</span>
                <span aria-hidden="true">00</span>
              </a>
              <span className={classes('nav-item', 'nav-item--muted')}>
                <span>Prompts</span>
                <span aria-hidden="true">↗</span>
              </span>
            </nav>
          </div>
          <div className={classes('local-note')}>
            <span className={classes('local-note-icon')} aria-hidden="true">⌂</span>
            <div>
              <strong>Local workspace</strong>
              <span>Project data is stored locally</span>
            </div>
          </div>
        </aside>

        <main className={classes('main-content')} id="projects">
          <section className={classes('hero')} aria-labelledby="hero-title">
            <p className={classes('eyebrow')}>Product thinking, forged through iteration</p>
            <h1 id="hero-title">Turn an insight into a product direction.</h1>
            <p className={classes('hero-copy')}>
              Shape the prompts. Run the workflow. Refine the thinking behind every artifact.
            </p>
          </section>

          <aside className={classes('privacy-notice')} aria-label="Privacy and OpenAI boundary">
            <span className={classes('privacy-mark')} aria-hidden="true">◎</span>
            <div>
              <strong>Projects stay on this device.</strong>
              <p>
                When you generate, only the assembled prompt and required stage inputs are sent to OpenAI.
              </p>
            </div>
          </aside>

          <section className={classes('pipeline')} aria-labelledby="pipeline-title">
            <div className={classes('section-heading')}>
              <div>
                <p className={classes('eyebrow')}>The workflow</p>
                <h2 id="pipeline-title">One continuous line of thought</h2>
              </div>
              <span className={classes('section-meta')}>4 stages · locally saved</span>
            </div>

            <ol className={classes('stage-list')}>
              {stages.map((stage) => (
                <li className={classes('stage')} key={stage.number}>
                  <span className={classes('stage-number')}>{stage.number}</span>
                  <div className={classes('stage-copy')}>
                    <h3>{stage.name}</h3>
                    <p>{stage.description}</p>
                  </div>
                  <span className={classes('stage-state')}>Waiting</span>
                </li>
              ))}
            </ol>
          </section>

          <section className={classes('empty-state')} aria-labelledby="empty-title">
            <span className={classes('empty-glyph')} aria-hidden="true">✦</span>
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
