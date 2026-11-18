/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AdminPage } from './components/admin-page';
import { ListsPage } from './components/lists-page';
import './index.css';

// The server answers every path with this page; the path picks what it shows. Pages link to each other with
// plain links, so there's no client-side routing to keep in step.
const PAGES: Record<string, () => React.JSX.Element> = {
    '/lists': ListsPage,
    '/admin': AdminPage
};
const Page = PAGES[location.pathname.replace(/\/+$/, '')] ?? App;

const elem = document.getElementById('root')!;
const app = (
    <StrictMode>
        <Page />
    </StrictMode>
);

if (import.meta.hot) {
    // With hot module reloading, `import.meta.hot.data` is persisted.
    const root = (import.meta.hot.data.root ??= createRoot(elem));
    root.render(app);
} else {
    // The hot module reloading API is not available in production.
    createRoot(elem).render(app);
}
