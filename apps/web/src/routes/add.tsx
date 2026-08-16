import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app-state.js';

/**
 * Every way a book gets onto the shelf, in one place, ordered by how often it is
 * used rather than by how the pipeline is built (audit §6.3). Typing a book in is
 * the journey that works for everyone, so it comes first; importing a file is a
 * power-user path, so it comes last.
 */
export function Add() {
  const { busy, importCsvFile, importLibbyFile } = useApp();
  return (
    <section aria-labelledby="add-title">
      <div className="section-heading">
        <div>
          <h2 id="add-title">Add a book</h2>
          <p className="model-note">Books land on your shelf straight away.</p>
        </div>
      </div>
      <div className="tool-grid">
        <TypeItIn />
        <article>
          <h3>Import a spreadsheet</h3>
          <p>A CSV with title, author, ISBN, date, and format columns.</p>
          <label className={busy ? 'file-button disabled' : 'file-button'}>
            <span>Choose CSV file</span>
            <input
              data-testid="csv-file"
              type="file"
              accept="text/csv,.csv"
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void importCsvFile(file);
                event.currentTarget.value = '';
              }}
            />
          </label>
        </article>
        <article>
          <h3>Import a Libby timeline</h3>
          <p>In Libby, choose Timeline → Export Timeline → Data (JSON).</p>
          <label className={busy ? 'file-button disabled' : 'file-button'}>
            <span>{busy ? 'Working…' : 'Choose JSON file'}</span>
            <input
              data-testid="libby-file"
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void importLibbyFile(file);
                event.currentTarget.value = '';
              }}
            />
          </label>
        </article>
      </div>
    </section>
  );
}

function TypeItIn() {
  const { busy, addBook } = useApp();
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [isbn, setIsbn] = useState('');
  const titleField = useRef<HTMLInputElement>(null);

  // Landing on Add — from the nav, the manifest shortcut, or a deep link — should
  // put the cursor where the work happens.
  useEffect(() => titleField.current?.focus(), []);

  return (
    <article>
      <h3>Type it in</h3>
      <form
        className="manual-form"
        onSubmit={(event) => {
          event.preventDefault();
          void addBook({ title, author: author || undefined, isbn: isbn || undefined }).then(() => {
            setTitle('');
            setAuthor('');
            setIsbn('');
            // Keep the cursor here: this is the rapid-entry surface (P2, J5).
            titleField.current?.focus();
          });
        }}
      >
        <input
          aria-label="Book title"
          placeholder="Title"
          ref={titleField}
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <input
          aria-label="Book author"
          placeholder="Author (optional)"
          value={author}
          onChange={(event) => setAuthor(event.target.value)}
        />
        <input
          aria-label="Book ISBN"
          placeholder="ISBN (optional)"
          inputMode="numeric"
          value={isbn}
          onChange={(event) => setIsbn(event.target.value)}
        />
        <button type="submit" disabled={busy}>
          Add to bookshelf
        </button>
      </form>
    </article>
  );
}
