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
                onClick={() => setFocused(screen)}
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
          title={`Concept Screen ${focused.ordinal}`}
          onDismiss={() => setFocused(null)}
          actions={<button className={styles['primary-action']} type="button" onClick={() => setFocused(null)}>Close</button>}
        >
          <img
            className={styles['concept-focus-image']}
            src={focused.downloadUrl}
            alt={`Concept Screen ${focused.ordinal}`}
            width={focused.width}
            height={focused.height}
          />
          <p className={styles['concept-focus-meta']}>
            Read-only PNG · {focused.width} × {focused.height} · generated as part of one coordinated set.
          </p>
        </Modal>
      )}
    </>
  );
}
