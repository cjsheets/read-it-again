/** Open Library's cover endpoint publishes a three-second courtesy interval.
 * Metadata and cover requests share this clock so enabling both cannot double
 * the traffic rate. */
const REQUEST_GAP_MS = 3_100;
let lastRequestAt = 0;

export async function waitForCatalogRequest(): Promise<void> {
  const wait = REQUEST_GAP_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}
