import type { ConnectivityStatus } from '../shared/bootstrap.js';
import styles from './App.module.css';
import type { ShellState } from './useBootstrap.js';

const presentation: Record<
  ConnectivityStatus,
  { visible: string; accessible: string }
> = {
  checking: { visible: 'Checking', accessible: 'checking' },
  connected: { visible: 'Connected', accessible: 'connected' },
  api_key_missing: { visible: 'API key needed', accessible: 'API key needed' },
  unavailable: { visible: 'Unavailable', accessible: 'unavailable' },
};

function formatCheckTime(checkedAt: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(checkedAt));
}
export interface ConnectivityIndicatorProps {
  shell: ShellState;
  refreshing: boolean;
  onRefresh(): Promise<void>;
}

export function ConnectivityIndicator({
  shell,
  refreshing,
  onRefresh,
}: ConnectivityIndicatorProps) {
  const labels = presentation[shell.connectivity];

  return (
    <div className={styles.environment}>
      {shell.mode === 'mock' && <span className={styles['mode-badge']}>Mock mode</span>}
      <span
        className={`${styles.connectivity} ${styles[`connectivity--${shell.connectivity}`]}`}
        role="status"
        aria-label={`OpenAI ${labels.accessible}`}
        title={shell.message}
      >
        <span className={styles['connectivity-dot']} aria-hidden="true" />
        {labels.visible}
      </span>
      {shell.checkedAt && (
        <span className={styles['last-check']}>
          <span>Last checked</span>
          <time
            dateTime={shell.checkedAt}
            aria-label={`Last checked at ${formatCheckTime(shell.checkedAt)}`}
          >
            {formatCheckTime(shell.checkedAt)}
          </time>
        </span>
      )}
      <button
        className={styles['refresh-connectivity']}
        type="button"
        aria-label="Refresh OpenAI connectivity"
        disabled={refreshing || shell.connectivity === 'checking'}
        onClick={() => void onRefresh()}
      >
        Refresh
      </button>
    </div>
  );
}
