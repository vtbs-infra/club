import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import {
  createAddress,
  deleteAddress,
  getAddresses,
  updateAddress,
  type AddressPayload,
  type AddressRecord,
} from '../api/addresses';

const emptyPayload: AddressPayload = {
  city: '',
  countryRegion: '',
  detailedAddress: '',
  district: '',
  phone: '',
  postalCode: '',
  province: '',
  recipientName: '',
  userNote: '',
};

const fields: readonly { key: keyof AddressPayload; label: string; required?: boolean }[] = [
  { key: 'recipientName', label: 'Recipient', required: true },
  { key: 'phone', label: 'Phone', required: true },
  { key: 'countryRegion', label: 'Country / region', required: true },
  { key: 'province', label: 'Province', required: true },
  { key: 'city', label: 'City', required: true },
  { key: 'district', label: 'District' },
  { key: 'detailedAddress', label: 'Detailed address', required: true },
  { key: 'postalCode', label: 'Postal code' },
  { key: 'userNote', label: 'Delivery note' },
];

export function AddressBookPanel() {
  const queryClient = useQueryClient();
  const addresses = useQuery({ queryFn: getAddresses, queryKey: ['me', 'addresses'] });
  const [editing, setEditing] = useState<AddressRecord | null>(null);
  const [label, setLabel] = useState('Home');
  const [isDefault, setIsDefault] = useState(true);
  const [payload, setPayload] = useState<AddressPayload>(emptyPayload);
  const reset = () => {
    setEditing(null);
    setLabel('Home');
    setIsDefault(false);
    setPayload(emptyPayload);
  };
  const save = useMutation({
    mutationFn: () =>
      editing
        ? updateAddress(editing.id, { isDefault, label, payload })
        : createAddress({ isDefault, label, payload }),
    onSuccess: async () => {
      reset();
      await queryClient.invalidateQueries({ queryKey: ['me', 'addresses'] });
    },
  });
  const remove = useMutation({
    mutationFn: deleteAddress,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me', 'addresses'] }),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  const edit = (address: AddressRecord) => {
    setEditing(address);
    setLabel(address.label);
    setIsDefault(address.isDefault);
    setPayload(address.payload);
  };

  return (
    <section className="panel account-section">
      <p className="panel-label">ENCRYPTED ADDRESS BOOK</p>
      <h2>Delivery addresses</h2>
      <p className="muted">Address details are encrypted before they are stored.</p>
      <div className="address-list">
        {addresses.data?.map((address) => (
          <article className="address-card" key={address.id}>
            <div>
              <strong>{address.label}</strong>
              {address.isDefault ? <span className="role-chip">DEFAULT</span> : null}
            </div>
            <span>
              {address.payload.recipientName} · {address.payload.phone}
            </span>
            <small>
              {address.payload.province} {address.payload.city} {address.payload.detailedAddress}
            </small>
            <div className="button-row">
              <button className="button button-quiet" onClick={() => edit(address)} type="button">
                Edit
              </button>
              <button
                className="button button-quiet"
                disabled={remove.isPending}
                onClick={() => remove.mutate(address.id)}
                type="button"
              >
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
      <form className="address-form campaign-form" onSubmit={submit}>
        <h3>{editing ? `Edit ${editing.label}` : 'Add an address'}</h3>
        <label>
          Label
          <input required value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <label className="checkbox-label">
          <input
            checked={isDefault}
            type="checkbox"
            onChange={(event) => setIsDefault(event.target.checked)}
          />
          Use as default
        </label>
        <div className="address-fields">
          {fields.map((field) => (
            <label
              className={
                field.key === 'detailedAddress' || field.key === 'userNote' ? 'wide-field' : ''
              }
              key={field.key}
            >
              {field.label}
              <input
                required={field.required}
                value={payload[field.key]}
                onChange={(event) =>
                  setPayload((current) => ({ ...current, [field.key]: event.target.value }))
                }
              />
            </label>
          ))}
        </div>
        <div className="button-row">
          <button className="button button-small" disabled={save.isPending} type="submit">
            {editing ? 'Save address' : 'Add address'}
          </button>
          {editing ? (
            <button className="button button-quiet" onClick={reset} type="button">
              Cancel edit
            </button>
          ) : null}
        </div>
        {save.isError || remove.isError ? (
          <p className="form-message form-error">{save.error?.message ?? remove.error?.message}</p>
        ) : null}
      </form>
    </section>
  );
}
