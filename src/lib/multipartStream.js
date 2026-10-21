// Streaming multipart/form-data builder (Web Streams only, no buffering of the body).

export function createBoundary() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let s = '';
  for (const b of bytes) s += chars[b % chars.length];
  return `----BambuddyExt${s}`;
}

export function buildMultipartStream({
  field,
  filename,
  contentType = 'application/octet-stream',
  body,
  boundary = createBoundary(),
}) {
  const enc = new TextEncoder();
  const safeName = String(filename).replace(/"/g, '%22').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const safeField = String(field).replace(/"/g, '%22').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const head = enc.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="${safeField}"; filename="${safeName}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  let reader;
  let started = false;
  const stream = new ReadableStream({
    async pull(ctl) {
      if (!started) { started = true; reader = body.getReader(); ctl.enqueue(head); return; }
      const { done, value } = await reader.read();
      if (done) { ctl.enqueue(tail); ctl.close(); return; }
      ctl.enqueue(value);
    },
    cancel(reason) { return reader ? reader.cancel(reason) : body.cancel(reason); },
  });
  return { stream, boundary };
}

// Optional cap: past maxBytes, onExceed() runs and the stream errors (no further bytes pass).
export function countingTransform(onBytes, { maxBytes, onExceed } = {}) {
  let total = 0;
  return new TransformStream({
    transform(chunk, ctl) {
      total += chunk.byteLength;
      if (maxBytes && total > maxBytes) {
        onExceed?.();
        ctl.error(new Error(`File exceeded the ${Math.round(maxBytes / (1024 * 1024))} MB limit during streaming`));
        return;
      }
      ctl.enqueue(chunk);
      onBytes?.(total);
    },
  });
}
