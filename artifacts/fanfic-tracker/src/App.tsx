/**
 * App.tsx — root of the React application
 *
 * Sets up three global providers that wrap the entire app:
 *  - QueryClientProvider: enables data fetching/caching via TanStack Query
 *  - TooltipProvider: makes Radix UI tooltips available anywhere in the tree
 *  - WouterRouter: lightweight client-side router; `base` is set to the
 *    Vite BASE_URL so the app works under a sub-path when hosted on Replit
 *    (e.g. /fanfic-tracker/ rather than just /)
 *
 * Routes:
 *  /          → Home     (reading log, stats, bookmarklet setup)
 *  /fics/:id  → FicDetail (single fic — rating, notes, delete)
 *  *          → NotFound
 */

import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import FicDetail from "@/pages/FicDetail";

// Single QueryClient instance shared across the whole app.
// refetchOnWindowFocus is disabled so the list doesn't re-fetch every time the
// user tabs back from AO3.  retry:1 means one automatic retry on transient errors.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    }
  }
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/fics/:id" component={FicDetail} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {/* Strip trailing slash from BASE_URL so wouter route matching works
            correctly whether the env var ends in "/" or not. */}
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        {/* Global toast notification outlet */}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
