import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  createBilibiliChallenge,
  getBilibiliBinding,
  getCurrentBilibiliChallenge,
  removeBilibiliBinding,
  type IssuedBilibiliChallenge,
} from '../api/identity';
import { ApiError } from '../api/http';

function useRemainingSeconds(expiresAt: string | undefined): number {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = setInterval(update, 1_000);
    return () => clearInterval(timer);
  }, []);
  if (!expiresAt || now === null) return 0;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
}

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function BilibiliBindingPanel() {
  const queryClient = useQueryClient();
  const [issued, setIssued] = useState<IssuedBilibiliChallenge | null>(null);
  const binding = useQuery({
    queryFn: getBilibiliBinding,
    queryKey: ['account', 'bilibili-binding'],
    refetchInterval: 2_000,
  });
  const challenge = useQuery({
    enabled: !binding.data,
    queryFn: getCurrentBilibiliChallenge,
    queryKey: ['account', 'bilibili-challenge'],
    refetchInterval: 2_000,
  });
  const create = useMutation({
    mutationFn: createBilibiliChallenge,
    onSuccess: async (created) => {
      setIssued(created);
      await queryClient.invalidateQueries({ queryKey: ['account', 'bilibili-challenge'] });
    },
  });
  const remove = useMutation({
    mutationFn: removeBilibiliBinding,
    onSuccess: async () => {
      setIssued(null);
      await queryClient.invalidateQueries({ queryKey: ['account'] });
    },
  });
  const expiresAt = issued?.expiresAt ?? challenge.data?.expiresAt;
  const remaining = useRemainingSeconds(expiresAt);

  if (binding.data) {
    return (
      <section className="panel account-section">
        <p className="panel-label">BILIBILI IDENTITY</p>
        <div className="binding-success">
          <div>
            <span className="status-active">Verified UID</span>
            <h2>{binding.data.biliDisplayName ?? `UID ${binding.data.biliUid}`}</h2>
            <p className="muted">Bilibili UID {binding.data.biliUid}</p>
          </div>
          <button
            className="button button-secondary"
            disabled={remove.isPending}
            type="button"
            onClick={() => remove.mutate()}
          >
            Unbind UID
          </button>
        </div>
      </section>
    );
  }

  const current = challenge.data;
  const active = current?.status === 'ACTIVE' && remaining > 0;
  return (
    <section className="panel account-section">
      <p className="panel-label">BILIBILI IDENTITY</p>
      <h2>Prove your Bilibili UID</h2>
      <p className="muted">
        Club assigns the verification room. Send the one-time code as a normal live message; never
        enter a UID here.
      </p>
      {active && issued ? (
        <div className="challenge-card">
          <div className="challenge-meta">
            <span
              className={`connection-state connection-${current.connectionState?.toLowerCase()}`}
            >
              {current.connectionState === 'HEALTHY'
                ? 'Listening'
                : current.connectionState === 'CONNECTING'
                  ? 'Connecting'
                  : 'Reconnecting'}
            </span>
            <strong>{formatCountdown(remaining)}</strong>
          </div>
          <code>{issued.code}</code>
          <a className="button" href={issued.room.link} rel="noreferrer" target="_blank">
            Open {issued.room.displayName}
          </a>
          <p>Send the code exactly as shown, then keep this page open.</p>
        </div>
      ) : (
        <div className="binding-actions">
          {current?.status === 'CONFLICT' ? (
            <div className="form-message form-error">
              That UID is already bound. Contact a platform administrator if this is unexpected.
            </div>
          ) : null}
          {active && !issued ? (
            <p className="muted">
              A challenge is active, but its secret code is never stored. Generate a replacement
              code to continue.
            </p>
          ) : null}
          <button
            className="button"
            disabled={create.isPending}
            type="button"
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Assigning room…' : active ? 'Replace code' : 'Start verification'}
          </button>
          {create.error ? (
            <div className="form-message form-error">
              {create.error instanceof ApiError
                ? create.error.message
                : 'Verification could not start.'}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
