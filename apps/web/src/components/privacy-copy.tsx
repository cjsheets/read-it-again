/** Shared verbatim explanation for Settings and the first-run in-place dialog. */
export function PrivacyCopy() {
  return (
    <>
      <p>
        <strong>Your library stays in this browser</strong>. Your books, readers, ratings and
        reading history are stored on this device and are never uploaded. There is no account and no
        server holding them, which also means they cannot be recovered from one if this browser
        loses them — hence the backup above.
      </p>
      <p>
        One feature can reach the network, and only if you switch it on: cover lookup sends an ISBN
        to <strong>covers.openlibrary.org</strong> to fetch a picture. That is described in full
        under <em>Cover art from the internet</em>, it is off unless you turn it on, and while it is
        running the app says so at the top of the screen.
      </p>
      <p className="model-note">
        It cannot sign in to a library or read your borrowing history directly, because library
        systems do not permit browser access. A companion app on a computer does that work and hands
        the results over in a backup.
      </p>
    </>
  );
}
