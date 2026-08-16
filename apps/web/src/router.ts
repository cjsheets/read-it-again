import { useEffect, useState } from 'react';

/**
 * A hash router in about eighty lines, rather than a dependency.
 *
 * Why hash and not the History API: this ships as static files with an offline
 * service worker. Path routing would need either server rewrites — which a static
 * host may not offer, and which the deploy contract in `_headers` does not
 * describe — or a service-worker navigation fallback that has to stay correct for
 * every future route. A hash never leaves the document, so a deep link cannot 404,
 * works identically offline, and needs nothing from the host.
 *
 * Why not a router library: the requirement is five flat destinations with no
 * params, no nesting, and no data loading. A library would add bundle weight and
 * an upgrade surface for a `switch` statement. Revisit if nested routes with
 * parameters arrive — the book detail view in Increment 5 is the first candidate,
 * and it is a drawer over the shelf rather than a nested route.
 */
export const DESTINATIONS = [
  { id: 'shelf', label: 'Shelf', hint: 'Every book in the house' },
  { id: 'add', label: 'Add', hint: 'Put a book on the shelf' },
  { id: 'activity', label: 'Activity', hint: 'What you have read' },
  { id: 'discover', label: 'Discover', hint: 'What to bring home next' },
  { id: 'tasks', label: 'Tasks', hint: 'Anything needing a decision' },
] as const;

export type Destination = (typeof DESTINATIONS)[number]['id'];

/** Settings is reachable but is not a tab: it is administrative, not daily
 *  (audit §6.4), so it sits beside the destinations rather than among them. */
export type Route = Destination | 'settings';

const ROUTES: readonly Route[] = [...DESTINATIONS.map(({ id }) => id), 'settings'];

export function isRoute(value: string): value is Route {
  return (ROUTES as readonly string[]).includes(value);
}

export function routeFromLocation(location: { hash: string; search: string }): Route {
  const hash = location.hash.replace(/^#\/?/u, '');
  if (isRoute(hash)) return hash;
  // The installed app's "Add a book" shortcut historically used ?action=add.
  // Honour it so an already-installed shortcut keeps working.
  if (new URLSearchParams(location.search).get('action') === 'add') return 'add';
  return 'shelf';
}

export function useRoute(): readonly [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => routeFromLocation(window.location));

  useEffect(() => {
    const onHashChange = () => setRoute(routeFromLocation(window.location));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return [
    route,
    (next: Route) => {
      // Assigning the hash rather than calling setRoute directly keeps the URL the
      // single source of truth, so back/forward and a shared link behave the same.
      window.location.hash = `#${next}`;
      setRoute(next);
    },
  ] as const;
}
