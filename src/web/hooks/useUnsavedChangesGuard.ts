import { useCallback, useEffect, useState } from 'react';
import { useBlocker } from 'react-router-dom';

export interface UnsavedChangesGuard {
  readonly blocked: boolean;
  readonly cancelDiscard: () => void;
  readonly confirmDiscard: () => void;
  readonly requestDiscard: (action: () => void) => void;
}

export function useUnsavedChangesGuard(dirty: boolean): UnsavedChangesGuard {
  const blocker = useBlocker(dirty);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  const requestDiscard = useCallback(
    (action: () => void) => {
      if (!dirty) {
        action();
        return;
      }
      setPendingAction(() => action);
    },
    [dirty],
  );
  const cancelDiscard = useCallback(() => {
    if (pendingAction) setPendingAction(null);
    else blocker.reset?.();
  }, [blocker, pendingAction]);
  const confirmDiscard = useCallback(() => {
    if (pendingAction) {
      setPendingAction(null);
      pendingAction();
      return;
    }
    blocker.proceed?.();
  }, [blocker, pendingAction]);

  return {
    blocked: pendingAction !== null || blocker.state === 'blocked',
    cancelDiscard,
    confirmDiscard,
    requestDiscard,
  };
}
