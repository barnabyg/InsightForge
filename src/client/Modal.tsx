import { useEffect, useRef, type ReactNode } from 'react';
import styles from './App.module.css';

interface ModalProps {
  title: string;
  children: ReactNode;
  actions: ReactNode;
  onDismiss(): void;
}

export function Modal({ title, children, actions, onDismiss }: ModalProps) {
  const modal = useRef<HTMLElement>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const focusTarget = modal.current?.querySelector<HTMLElement>(
      'input, button, textarea, select, [tabindex]:not([tabindex="-1"])',
    );
    focusTarget?.focus();

    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss.current();
      }
    }
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('keydown', dismissOnEscape);
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
      }
    };
  }, []);

  return (
    <div className={styles['modal-backdrop']} role="presentation" onMouseDown={onDismiss}>
      <section
        ref={modal}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className={styles.eyebrow}>Project action</p>
        <h2 id="modal-title">{title}</h2>
        <div className={styles['modal-body']}>{children}</div>
        <div className={styles['modal-actions']}>{actions}</div>
      </section>
    </div>
  );
}
