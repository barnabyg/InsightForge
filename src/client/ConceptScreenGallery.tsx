import { useState } from 'react';
import type { ConceptScreen, ConceptScreenSetArtifact } from '../shared/generation.js';
import { Modal } from './Modal.js';
import styles from './App.module.css';

interface ConceptScreenGalleryProps {
  artifact: ConceptScreenSetArtifact;
  projectName: string;
}

function fileName(projectName: string, ordinal: number): string {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug || 'insightforge'}-concept-screen-${ordinal}.png`;
}

export function ConceptScreenGallery({ artifact, projectName }: ConceptScreenGalleryProps) {
  const [focused, setFocused] = useState<ConceptScreen | null>(null);
  const [zoom, setZoom] = useState<number | 'fit'>(100);
  function focusScreen(screen: ConceptScreen): void {
    setZoom(100);
    setFocused(screen);
  }
  return (
    <>
      <article className={styles['concept-gallery']} aria-label="Concept Screen Set">
        <header className={styles['concept-gallery-heading']}>
          <div>
            <span className={styles['readonly-badge']}>Read-only Artifact</span>
            <h2>Coordinated primary journey</h2>
          </div>
          <span>{artifact.validation.width} × {artifact.validation.height} · PNG</span>
        </header>
        <div className={styles['concept-grid']}>
          {artifact.screens.map((screen) => (
            <figure className={styles['concept-card']} key={screen.assetId}>
              <button
                className={styles['concept-image-button']}
                type="button"
                aria-label={`Inspect Concept Screen ${screen.ordinal}`}
                onClick={() => focusScreen(screen)}
              >
                <img
                  src={screen.downloadUrl}
                  alt={`Concept Screen ${screen.ordinal}`}
                  width={screen.width}
                  height={screen.height}
                />
                <span>Inspect full size</span>
              </button>
              <figcaption>
                <div>
                  <strong>Concept Screen {screen.ordinal}</strong>
                  <span>{screen.width} × {screen.height} · {(screen.byteSize / 1024).toFixed(0)} KB</span>
                </div>
                <a
                  href={screen.downloadUrl}
                  download={fileName(projectName, screen.ordinal)}
                  aria-label={`Download Concept Screen ${screen.ordinal}`}
                >Download PNG</a>
              </figcaption>
            </figure>
          ))}
        </div>
      </article>

      {focused && (
        <Modal
          wide
          title={`Concept Screen ${focused.ordinal}`}
          onDismiss={() => setFocused(null)}
          actions={<button className={styles['primary-action']} type="button" onClick={() => setFocused(null)}>Close</button>}
        >
          <div className={styles['concept-focus-toolbar']} aria-label="Zoom controls">
            <button type="button" disabled={focused.ordinal === 1}
              onClick={() => setFocused(artifact.screens[focused.ordinal - 2]!)}>Previous screen</button>
            <button type="button" disabled={focused.ordinal === artifact.screens.length}
              onClick={() => setFocused(artifact.screens[focused.ordinal]!)}>Next screen</button>
            <button type="button" aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>Fit</button>
            <button type="button" aria-pressed={zoom === 100} onClick={() => setZoom(100)}>Actual size</button>
            <button type="button" disabled={zoom === 'fit' || zoom <= 25}
              onClick={() => setZoom(Number(zoom) - 25)}>Zoom out</button>
            <output aria-live="polite">{zoom === 'fit' ? 'Fit to window' : `${zoom}%`}</output>
            <button type="button" disabled={zoom === 200}
              onClick={() => setZoom(zoom === 'fit' ? 100 : zoom + 25)}>Zoom in</button>
          </div>
          <div key={focused.assetId} className={styles['concept-focus-viewport']}
            tabIndex={0} role="region" aria-label={`Pan Concept Screen ${focused.ordinal}`}>
            <img
              className={styles['concept-focus-image']}
              src={focused.downloadUrl}
              alt={`Concept Screen ${focused.ordinal}`}
              width={focused.width}
              height={focused.height}
              style={zoom === 'fit'
                ? { width: 'auto', maxWidth: '100%', maxHeight: '56dvh' }
                : { width: focused.width * zoom / 100 }}
            />
          </div>
          <p className={styles['concept-focus-meta']}>
            Read-only PNG · {focused.width} × {focused.height} · generated as part of one coordinated set.
          </p>
        </Modal>
      )}
    </>
  );
}
