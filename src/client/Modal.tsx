import { useEffect, useId, useRef, type ReactNode } from 'react';
import styles from './App.module.css';

interface ModalProps {
  title: string;
  wide?: boolean;
  children: ReactNode;
  actions: ReactNode;
  onDismiss(): void;
}

export function Modal({ title, wide, children, actions, onDismiss }: ModalProps) {
  const modal = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = modal.current!;
    const previous = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return (
    <dialog
      ref={modal}
      className={wide ? `${styles.modal} ${styles['modal-wide']}` : styles.modal}
      aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); onDismiss(); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right
          || event.clientY < bounds.top || event.clientY > bounds.bottom) onDismiss();
      }}
      onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          'button:enabled, a[href], input:enabled, select:enabled, textarea:enabled, summary, [tabindex="0"]',
        )).filter(element => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <div className={styles['modal-body']}>{children}</div>
      <div className={styles['modal-actions']}>{actions}</div>
    </dialog>
  );
}
