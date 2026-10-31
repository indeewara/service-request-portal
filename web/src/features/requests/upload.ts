import type { UploadTarget } from '@/shared/api/types';

/**
 * Sends one file straight from the browser to S3 with the pre-signed POST.
 * XMLHttpRequest (not fetch) because only it reports upload progress.
 */
export function uploadToS3(
  target: UploadTarget,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  const body = new FormData();
  for (const [key, value] of Object.entries(target.fields)) body.append(key, value);
  body.append('file', file); // must be last: S3 ignores fields after the file

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', target.url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error('The storage service refused this file.'));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    xhr.send(body);
  });
}
