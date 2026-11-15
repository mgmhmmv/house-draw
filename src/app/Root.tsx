import { lazy, Suspense, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './lib/auth';
import { matchPath, RouterProvider, useRouter } from './lib/router';
import { Spinner, Toaster } from './ui';
import { AppShell } from './screens/AppShell';
import { AuthScreen } from './screens/AuthScreen';
import { NewProjectDialog } from './screens/NewProjectDialog';
import { ProjectsPage } from './screens/ProjectsPage';
import { SettingsPage, TemplatesPage } from './screens/SimplePages';
import { ClientsPage } from './screens/IsleposPages';

// The workspace carries three.js and the drawing engines; the dashboard should not wait for them.
const Workspace = lazy(() => import('./workspace/Workspace'));

function FullPageSpinner() {
  return (
    <div className="flex h-screen-safe items-center justify-center">
      <Spinner />
    </div>
  );
}

function Routes() {
  const { user, ready } = useAuth();
  const { path, navigate } = useRouter();
  const [newOpen, setNewOpen] = useState(false);
  const [newTemplate, setNewTemplate] = useState('blank');

  const isAuthRoute = path === '/login' || path === '/signup';

  useEffect(() => {
    if (!ready) return;
    if (!user && !isAuthRoute) navigate('/login', { replace: true });
    if (user && isAuthRoute) navigate('/', { replace: true });
  }, [ready, user, isAuthRoute, navigate]);

  if (!ready) return <FullPageSpinner />;
  if (!user) return <AuthScreen mode={path === '/signup' ? 'signup' : 'login'} />;

  const ws = matchPath('/p/:id/:sheet?', path);
  if (ws) {
    return (
      <Suspense fallback={<FullPageSpinner />}>
        <Workspace projectId={ws.id} sheetParam={ws.sheet} />
      </Suspense>
    );
  }

  const openNew = (template = 'blank') => {
    setNewTemplate(template);
    setNewOpen(true);
  };

  let page: React.ReactNode;
  if (path.startsWith('/templates')) page = <TemplatesPage onUse={openNew} />;
  else if (path.startsWith('/clients')) page = <ClientsPage />;
  else if (path.startsWith('/settings')) page = <SettingsPage />;
  else page = <ProjectsPage onNewProject={() => openNew()} />;

  return (
    <AppShell onNewProject={() => openNew()}>
      {page}
      <NewProjectDialog open={newOpen} onClose={() => setNewOpen(false)} initialTemplate={newTemplate} />
    </AppShell>
  );
}

export function Root() {
  return (
    <RouterProvider>
      <AuthProvider>
        <Routes />
        <Toaster />
      </AuthProvider>
    </RouterProvider>
  );
}
