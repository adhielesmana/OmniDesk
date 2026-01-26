import { Switch, Route, Redirect } from "wouter";
import { lazy, Suspense } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

const LandingPage = lazy(() => import("@/pages/landing"));
const InboxPage = lazy(() => import("@/pages/inbox"));
const ContactsPage = lazy(() => import("@/pages/contacts"));
const LoginPage = lazy(() => import("@/pages/login"));
const AdminPage = lazy(() => import("@/pages/admin"));
const BlastPage = lazy(() => import("@/pages/blast"));
const ApiMessagePage = lazy(() => import("@/pages/api-message"));
const AutoReplyPage = lazy(() => import("@/pages/autoreply"));
const TemplatesPage = lazy(() => import("@/pages/templates"));
const NotFound = lazy(() => import("@/pages/not-found"));

function ProtectedRoute({ component: Component, adminOnly = false }: { component: React.ComponentType; adminOnly?: boolean }) {
  const { isAuthenticated, isLoading, isAdmin } = useAuth();

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  if (adminOnly && !isAdmin) {
    return <Redirect to="/inbox" />;
  }

  return <Component />;
}

function PublicRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Redirect to="/inbox" />;
  }

  return <Component />;
}

function HomeRoute() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Redirect to="/inbox" />;
  }

  return <LandingPage />;
}

function Router() {
  return (
    <Switch>
      <Route path="/">
        <HomeRoute />
      </Route>
      <Route path="/login">
        <PublicRoute component={LoginPage} />
      </Route>
      <Route path="/inbox">
        <ProtectedRoute component={InboxPage} />
      </Route>
      <Route path="/contacts">
        <ProtectedRoute component={ContactsPage} />
      </Route>
      <Route path="/admin">
        <ProtectedRoute component={AdminPage} adminOnly />
      </Route>
      <Route path="/blast">
        <ProtectedRoute component={BlastPage} adminOnly />
      </Route>
      <Route path="/api-message">
        <ProtectedRoute component={ApiMessagePage} adminOnly />
      </Route>
      <Route path="/autoreply">
        <ProtectedRoute component={AutoReplyPage} adminOnly />
      </Route>
      <Route path="/templates">
        <ProtectedRoute component={TemplatesPage} adminOnly />
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function PageLoader() {
  return (
    <div className="h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          <Suspense fallback={<PageLoader />}>
            <Router />
          </Suspense>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
