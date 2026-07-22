import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Navigate } from 'react-router-dom';

import {
  createVerificationRoom,
  listVerificationRooms,
  testVerificationRoom,
  updateVerificationRoom,
  type CreateVerificationRoomInput,
} from '../api/verification-rooms';
import { AuthenticatedPage } from '../components/AuthenticatedPage';

export function VerificationRoomsPage() {
  return (
    <AuthenticatedPage>
      {(identity) =>
        identity.user.platformRole === 'PLATFORM_ADMIN' ? (
          <VerificationRoomContent />
        ) : (
          <Navigate replace to="/organizations" />
        )
      }
    </AuthenticatedPage>
  );
}

function VerificationRoomContent() {
  const queryClient = useQueryClient();
  const rooms = useQuery({
    queryFn: listVerificationRooms,
    queryKey: ['platform', 'verification-rooms'],
    refetchInterval: 5_000,
  });
  const { formState, handleSubmit, register, reset } = useForm<CreateVerificationRoomInput>({
    defaultValues: { enabled: true, priority: 100 },
  });
  const refresh = async () =>
    queryClient.invalidateQueries({ queryKey: ['platform', 'verification-rooms'] });
  const create = useMutation({
    mutationFn: createVerificationRoom,
    onSuccess: async () => {
      reset({ enabled: true, priority: 100 });
      await refresh();
    },
  });
  const update = useMutation({
    mutationFn: ({ enabled, roomId }: { enabled: boolean; roomId: string }) =>
      updateVerificationRoom(roomId, { enabled }),
    onSuccess: refresh,
  });
  const test = useMutation({ mutationFn: testVerificationRoom, onSuccess: refresh });

  return (
    <section className="page-content">
      <p className="section-kicker">PLATFORM</p>
      <h1>Verification rooms.</h1>
      <p className="lede">
        Club assigns enabled rooms by health and priority. Users never choose a room themselves.
      </p>
      <div className="platform-grid">
        <form
          className="panel auth-form"
          onSubmit={handleSubmit(async (values) => create.mutateAsync(values))}
        >
          <div>
            <p className="panel-label">ADD ROOM</p>
            <h2>Platform-controlled room</h2>
          </div>
          <label>
            Display name
            <input {...register('displayName', { required: true })} />
          </label>
          <label>
            Bilibili room ID
            <input
              inputMode="numeric"
              pattern="[0-9]+"
              {...register('biliRoomId', { required: true })}
            />
          </label>
          <label>
            Room owner UID
            <input
              inputMode="numeric"
              pattern="[0-9]+"
              {...register('biliOwnerUid', { required: true })}
            />
          </label>
          <label>
            Priority
            <input
              min="0"
              type="number"
              {...register('priority', { min: 0, valueAsNumber: true })}
            />
          </label>
          <button className="button" disabled={formState.isSubmitting} type="submit">
            Add room
          </button>
        </form>
        <div className="room-list">
          {rooms.data?.map((room) => (
            <article className="panel room-card" key={room.id}>
              <div className="title-row compact-title">
                <div>
                  <span
                    className={`connection-state connection-${room.healthStatus.toLowerCase()}`}
                  >
                    {room.healthStatus}
                  </span>
                  <h2>{room.displayName}</h2>
                  <p className="muted">
                    Room {room.biliRoomId} · priority {room.priority}
                  </p>
                </div>
                <span className="role-chip">{room.enabled ? 'ENABLED' : 'DISABLED'}</span>
              </div>
              <div className="room-actions">
                <button
                  className="button button-secondary"
                  disabled={test.isPending}
                  type="button"
                  onClick={() => test.mutate(room.id)}
                >
                  Test connection
                </button>
                <button
                  className="button button-quiet"
                  disabled={update.isPending}
                  type="button"
                  onClick={() => update.mutate({ enabled: !room.enabled, roomId: room.id })}
                >
                  {room.enabled ? 'Disable' : 'Enable'}
                </button>
              </div>
            </article>
          ))}
          {rooms.data?.length === 0 ? (
            <div className="panel empty-state">
              <h2>No verification rooms</h2>
              <p>Add the first platform-controlled room to enable UID binding.</p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
