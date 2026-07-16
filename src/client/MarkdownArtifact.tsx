import { useMemo, useState } from 'react';
import type { DesignBriefArtifact } from '../shared/generation.js';
import styles from './App.module.css';

interface MarkdownArtifactProps {
  artifact: DesignBriefArtifact;
  projectName: string;
}

type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] };

function markdownBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  for (const block of markdown.trim().split(/\n\s*\n/)) {
    const value = block.trim();
    const heading = /^(#{1,6})\s+(.+)$/.exec(value);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      continue;
    }
    const lines = value.split('\n');
    if (lines.every((line) => /^[-*]\s+/.test(line))) {
      blocks.push({
        type: 'list',
        items: lines.map((line) => line.replace(/^[-*]\s+/, '')),
      });
      continue;
    }
    blocks.push({ type: 'paragraph', text: value.replace(/\n/g, ' ') });
  }
  return blocks;
}

export function MarkdownArtifact({ artifact, projectName }: MarkdownArtifactProps) {
  const [raw, setRaw] = useState(false);
  const [query, setQuery] = useState('');
  const blocks = useMemo(() => markdownBlocks(artifact.markdown), [artifact.markdown]);
  const matches = query.trim()
    ? artifact.markdown.toLocaleLowerCase('en-GB')
      .split(query.trim().toLocaleLowerCase('en-GB')).length - 1
    : 0;

  function downloadMarkdown() {
    const blob = new Blob([artifact.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${projectName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'project'}-design-brief.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <article className={styles['markdown-artifact']} aria-label="Design Brief Artifact">
      <header className={styles['artifact-toolbar']}>
        <div>
          <span className={styles['readonly-badge']}>Read-only Artifact</span>
          <span>{artifact.validation.wordCount.toLocaleString('en-GB')} words</span>
        </div>
        <div className={styles['artifact-tools']}>
          <label>
            <span className={styles['visually-hidden']}>Search Design Brief</span>
            <input
              type="search"
              value={query}
              placeholder="Find in brief"
              aria-label="Search Design Brief"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {query && <span className={styles['match-count']}>{matches} matches</span>}
          <button type="button" onClick={() => setRaw((current) => !current)}>
            {raw ? 'Rendered' : 'Raw'}
          </button>
          <button type="button" onClick={() => void navigator.clipboard.writeText(artifact.markdown)}>
            Copy
          </button>
          <button type="button" onClick={downloadMarkdown}>Download .md</button>
        </div>
      </header>

      {raw ? (
        <pre className={styles['artifact-raw']}>{artifact.markdown}</pre>
      ) : (
        <div className={styles['artifact-document']}>
          {blocks.map((block, index) => {
            if (block.type === 'heading') {
              if (block.level === 1) return <h2 key={index}>{block.text}</h2>;
              return <h3 key={index}>{block.text}</h3>;
            }
            if (block.type === 'list') {
              return <ul key={index}>{block.items.map((item) => <li key={item}>{item}</li>)}</ul>;
            }
            return <p key={index}>{block.text}</p>;
          })}
        </div>
      )}
    </article>
  );
}
