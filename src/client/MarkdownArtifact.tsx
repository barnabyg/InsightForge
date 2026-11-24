import { useEffect, useMemo, useRef, useState } from 'react';
import type { DesignBriefArtifact, PrdArtifact } from '../shared/generation.js';
import styles from './App.module.css';

interface MarkdownArtifactProps {
  artifact: DesignBriefArtifact | PrdArtifact;
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
  const artifactName = artifact.stageId === 'prd' ? 'PRD' : 'Design Brief';
  const searchName = artifact.stageId === 'prd' ? 'PRD' : 'Design Brief';
  const fileSuffix = artifact.stageId === 'prd' ? 'prd' : 'design-brief';
  const [raw, setRaw] = useState(false);
  const [query, setQuery] = useState('');
  const blocks = useMemo(() => markdownBlocks(artifact.markdown), [artifact.markdown]);
  const [activeMatch, setActiveMatch] = useState(0);
  const documentRef = useRef<HTMLElement>(null);
  const term = query.trim();
  const pattern = term ? new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'giu') : null;
  let matches = 0;
  function highlight(text: string) {
    if (!pattern) return text;
    return text.split(pattern).map((part, index) => {
      if (index % 2 === 0) return part;
      const ordinal = matches++;
      return <mark key={index} aria-current={ordinal === activeMatch ? 'true' : undefined}>{part}</mark>;
    });
  }

  const content = raw ? highlight(artifact.markdown) : blocks.map((block, index) => {
    if (block.type === 'heading') {
      const Heading = block.level === 1 ? 'h2' : 'h3';
      return <Heading key={index}>{highlight(block.text)}</Heading>;
    }
    if (block.type === 'list') {
      return <ul key={index}>{block.items.map((item, i) => <li key={i}>{highlight(item)}</li>)}</ul>;
    }
    return <p key={index}>{highlight(block.text)}</p>;
  });

  useEffect(() => {
    documentRef.current?.querySelector('mark[aria-current]')?.scrollIntoView({ block: 'center' });
  }, [term, activeMatch, raw, artifact.id]);

  function moveMatch(direction: number) {
    if (matches) setActiveMatch(current => (current + direction + matches) % matches);
  }

  function downloadMarkdown() {
    const blob = new Blob([artifact.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${projectName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'project'}-${fileSuffix}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <article ref={documentRef} className={styles['markdown-artifact']} aria-label={`${artifactName} Artifact`}>
      <header className={styles['artifact-toolbar']}>
        <div>
          <span className={styles['readonly-badge']}>Read-only Artifact</span>
          <span>{artifact.validation.wordCount.toLocaleString('en-GB')} words</span>
        </div>
        <div className={styles['artifact-tools']}>
          <label>
            <span className={styles['visually-hidden']}>Search {searchName}</span>
            <input
              type="search"
              value={query}
              placeholder={artifact.stageId === 'prd' ? 'Find in PRD' : 'Find in brief'}
              aria-label={`Search ${searchName}`}
              onChange={event => { setQuery(event.target.value); setActiveMatch(0); }}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  moveMatch(event.shiftKey ? -1 : 1);
                }
              }}
            />
          </label>
          {term && <>
            <span className={styles['match-count']} role="status">{matches ? `${activeMatch + 1} of ${matches}` : 'No matches'}</span>
            <button type="button" disabled={!matches} onClick={() => moveMatch(-1)}>Previous match</button>
            <button type="button" disabled={!matches} onClick={() => moveMatch(1)}>Next match</button>
          </>}
          <button type="button" onClick={() => { setRaw(current => !current); setActiveMatch(0); }}>
            {raw ? 'Rendered' : 'Raw'}
          </button>
          <button type="button" onClick={() => void navigator.clipboard.writeText(artifact.markdown)}>
            Copy
          </button>
          <button type="button" onClick={downloadMarkdown}>Download .md</button>
        </div>
      </header>

      {raw ? <pre className={styles['artifact-raw']}>{content}</pre>
        : <div className={styles['artifact-document']}>{content}</div>}
    </article>
  );
}
