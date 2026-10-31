'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { CATEGORIES, CATEGORY_LABELS } from '@/shared/labels';
import { completeUpload, createRequest, getUploadTarget } from './actions';
import { MAX_PHOTOS, validateRequestForm, type FieldErrors, type FieldName } from './schema';
import { uploadToS3 } from './upload';

interface PhotoUpload {
  name: string;
  percent: number;
  state: 'waiting' | 'uploading' | 'done' | 'failed';
  error?: string;
}

const FIELD_LABELS: Record<FieldName, string> = {
  category: 'Category',
  orderNumber: 'Order number',
  description: 'Description',
  photos: 'Photos',
};

/** Describes a field by its hint and, when invalid, its error, so screen readers read both. */
const describedBy = (name: FieldName, errors: FieldErrors, hint = false) =>
  [hint && `${name}-hint`, errors[name] && `${name}-error`].filter(Boolean).join(' ') || undefined;

export function RequestForm() {
  const router = useRouter();
  const summaryRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState<string>();
  const [uploads, setUploads] = useState<PhotoUpload[]>([]);
  const [announcement, setAnnouncement] = useState('');
  // A file input replaces its selection on every pick, so chosen photos are kept here instead.
  const [photos, setPhotos] = useState<File[]>([]);

  const addPhotos = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = ''; // so the same file can be picked again after removing it
    setPhotos((list) => [
      ...list,
      ...picked.filter((f) => !list.some((p) => p.name === f.name && p.size === f.size)),
    ]);
    setAnnouncement(`${picked.length === 1 ? '1 photo' : `${picked.length} photos`} added`);
  };

  const removePhoto = (index: number) => {
    setAnnouncement(`${photos[index].name} removed`);
    setPhotos((list) => list.filter((_, i) => i !== index));
    photoInputRef.current?.focus(); // the button that had focus is gone
  };

  const showProblems = (fieldErrors: FieldErrors, message?: string) => {
    setErrors(fieldErrors);
    setFormError(message);
    // Move focus to the summary so keyboard and screen-reader users land on the errors.
    requestAnimationFrame(() => summaryRef.current?.focus());
  };

  const updateUpload = (index: number, change: Partial<PhotoUpload>) =>
    setUploads((list) => list.map((u, i) => (i === index ? { ...u, ...change } : u)));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const files = photos;
    const result = validateRequestForm(
      {
        category: data.get('category') || undefined,
        orderNumber: data.get('orderNumber'),
        description: data.get('description'),
      },
      files,
    );
    if (!result.ok) return showProblems(result.errors);

    setBusy(true);
    showProblems({});
    const created = await createRequest(result.data);
    if (!created.ok) {
      setBusy(false);
      return showProblems(created.fieldErrors ?? {}, created.fieldErrors ? undefined : created.error);
    }
    setRequestId(created.id);
    if (files.length === 0) return router.push(`/requests/${created.id}`);

    setUploads(files.map((f) => ({ name: f.name, percent: 0, state: 'waiting' })));
    let failed = 0;
    for (const [index, file] of files.entries()) {
      setAnnouncement(`Uploading photo ${index + 1} of ${files.length}`);
      updateUpload(index, { state: 'uploading' });
      try {
        const target = await getUploadTarget(created.id, { contentType: file.type, size: file.size });
        if (!target.ok) throw new Error(target.error);
        await uploadToS3(target.target, file, (percent) => updateUpload(index, { percent }));
        const done = await completeUpload(created.id, target.target.attachmentId);
        if (!done.ok) throw new Error(done.error);
        updateUpload(index, { state: 'done', percent: 100 });
      } catch (err) {
        failed++;
        updateUpload(index, { state: 'failed', error: (err as Error).message });
      }
    }
    setBusy(false);
    if (failed === 0) return router.push(`/requests/${created.id}`);
    setAnnouncement(`${failed} of ${files.length} photos could not be uploaded`);
  }

  const problems = Object.entries(errors) as [FieldName, string][];

  return (
    <form onSubmit={onSubmit} noValidate className="stack">
      <div ref={summaryRef} tabIndex={-1} className="summary-anchor">
        {(problems.length > 0 || formError) && (
          <div className="error-summary" role="alert" aria-labelledby="error-summary-title">
            <h2 id="error-summary-title">There is a problem</h2>
            {formError && <p>{formError}</p>}
            <ul>
              {problems.map(([field, message]) => (
                <li key={field}>
                  <a href={`#${field}`}>
                    {FIELD_LABELS[field]}: {message}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Locked once the request exists, so a second click can't create a duplicate. */}
      <fieldset disabled={busy || requestId !== undefined} className="stack plain">
        <div className="field">
          <label htmlFor="category">Category</label>
          <select
            id="category"
            name="category"
            defaultValue=""
            aria-invalid={!!errors.category}
            aria-describedby={describedBy('category', errors)}
          >
            <option value="" disabled>
              Choose a category
            </option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          {errors.category && (
            <p id="category-error" className="field-error">
              {errors.category}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="orderNumber">Order number</label>
          <p id="orderNumber-hint" className="hint">
            On your delivery note, for example SO-10234.
          </p>
          <input
            id="orderNumber"
            name="orderNumber"
            autoComplete="off"
            aria-invalid={!!errors.orderNumber}
            aria-describedby={describedBy('orderNumber', errors, true)}
          />
          {errors.orderNumber && (
            <p id="orderNumber-error" className="field-error">
              {errors.orderNumber}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="description">Description</label>
          <p id="description-hint" className="hint">
            What went wrong? Up to 2000 characters.
          </p>
          <textarea
            id="description"
            name="description"
            rows={6}
            aria-invalid={!!errors.description}
            aria-describedby={describedBy('description', errors, true)}
          />
          {errors.description && (
            <p id="description-error" className="field-error">
              {errors.description}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="photos">Photos (optional)</label>
          <p id="photos-hint" className="hint">
            Up to {MAX_PHOTOS} JPEG or PNG images, 5 MB each. Add them together or one at a time.
          </p>
          <input
            ref={photoInputRef}
            id="photos"
            type="file"
            accept="image/jpeg,image/png"
            multiple
            onChange={addPhotos}
            aria-invalid={!!errors.photos}
            aria-describedby={describedBy('photos', errors, true)}
          />
          {photos.length > 0 && (
            <>
              <p className="hint">
                {photos.length} of {MAX_PHOTOS} photos chosen
              </p>
              <ul className="chosen-photos" aria-label="Chosen photos">
                {photos.map((photo, i) => (
                  <li key={`${photo.name}-${photo.size}`}>
                    <span className="upload-name">{photo.name}</span>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => removePhoto(i)}
                      aria-label={`Remove ${photo.name}`}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {errors.photos && (
            <p id="photos-error" className="field-error">
              {errors.photos}
            </p>
          )}
        </div>

        <div>
          <button type="submit" className="button">
            {busy ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </fieldset>

      <p role="status" className="visually-hidden">
        {announcement}
      </p>

      {uploads.length > 0 && (
        <section aria-labelledby="uploads-title" className="stack">
          <h2 id="uploads-title">Photo uploads</h2>
          <ul className="uploads">
            {uploads.map((u, i) => (
              <li key={i}>
                <span className="upload-name">{u.name}</span>
                <progress max={100} value={u.percent} aria-label={`Upload progress for ${u.name}`} />
                <span>
                  {u.state === 'done' && 'Uploaded'}
                  {u.state === 'uploading' && `${u.percent}%`}
                  {u.state === 'waiting' && 'Waiting'}
                  {u.state === 'failed' && <span className="field-error">Failed: {u.error}</span>}
                </span>
              </li>
            ))}
          </ul>
          {!busy && requestId && uploads.some((u) => u.state === 'failed') && (
            <p className="notice">
              Your request was saved, but some photos could not be uploaded.{' '}
              <Link href={`/requests/${requestId}`}>Go to your request</Link>
            </p>
          )}
        </section>
      )}
    </form>
  );
}
